/**
 * Config/base service: device info, features, settings, battery, matrix positions and resets.
 * Verified against the vendor class `za` (deob 2485–2686), `Ga` (2414–2445) and `Za` (2456–2483).
 */
import { clamp, readU16be, u16be } from '@/hid/core/bytes'
import type { BatteryStatus, NumericRange } from '@/model/device'
import type { AdvancedKeyType, KeyId, KeyboardFeatures, KeyboardSettings, LayerSelector, PollingRate, ResetScope, SettingsService } from '@/model/keyboard'
import { decodeBatteryFlags } from './bubbles'
import { alignedChunk, buildPackets, decodePayload, encodeLayerAndSystem } from './codec'
import {
  Cmd,
  DEBOUNCE_FROM_WIRE,
  DEBOUNCE_US,
  Info,
  POLLING_RATE_FROM_WIRE,
  POLLING_RATE_TO_WIRE,
  RESET_TYPES,
  SLEEP_OPTIONS_SECONDS,
  Setting,
  debounceToWire,
  osFromWire,
  osToWire,
} from './enums'
import type { K98Link } from './transport'

export interface FirmwareVersion {
  raw: number
  major: number
  minor: number
  subminor: number
  hex: string
  text: string
}

export function parseFirmwareVersion(lo: number, hi: number): FirmwareVersion {
  const raw = ((hi << 8) | lo) & 0xffff
  return {
    raw,
    major: (raw >> 8) & 0xff,
    minor: (raw >> 4) & 0x0f,
    subminor: raw & 0x0f,
    hex: '0x' + raw.toString(16).padStart(4, '0'),
    text: `${(raw >> 8) & 0xff}.${(raw >> 4) & 0x0f}.${raw & 0x0f}`,
  }
}

/** Bit positions set in a little-endian-per-byte bitmap → ascending index list (vendor `zt`). */
export function bitmapToIndices(bytes: Uint8Array): number[] {
  const out: number[] = []
  for (let i = 0; i < bytes.length; i++) for (let b = 0; b < 8; b++) if ((bytes[i]! >> b) & 1) out.push(i * 8 + b)
  return out
}

export interface DeviceUuid {
  /** 48-bit value. */
  value: number
  /** `0x` + 12 hex digits, the form the vendor uses for prefix rules and layout selection. */
  hex: string
}

const ADVANCED_KEY_BITS: readonly AdvancedKeyType[] = ['TGL', 'MT', 'DKS', 'SOCD', 'MPT', 'END', 'RS']

export class K98Config implements SettingsService {
  readonly debounceRange: NumericRange = { min: DEBOUNCE_US.min, max: DEBOUNCE_US.max, step: DEBOUNCE_US.step, unit: 'µs' }

  constructor(private readonly link: K98Link) {}

  private get reportId(): number {
    return this.link.reportId
  }

  private async info(sub: Info, payload: number[] = [], expectedLength?: number, retries?: number): Promise<Uint8Array> {
    const replies = await this.link.request(buildPackets(Cmd.DeviceInfo, sub, payload, this.reportId), retries === undefined ? {} : { retries })
    return decodePayload(replies, expectedLength)
  }

  private async readSetting(index: Setting, expectedLength?: number): Promise<Uint8Array> {
    const replies = await this.link.request(buildPackets(Cmd.ReadSetting, index, [], this.reportId))
    return decodePayload(replies, expectedLength)
  }

  private async writeSetting(index: Setting, value: number[]): Promise<void> {
    await this.link.request(buildPackets(Cmd.WriteSetting, index, value, this.reportId))
  }

  // -- static info ------------------------------------------------------------

  /** `0x82/0x01`; sent without retries like the vendor does (it doubles as the liveness probe). */
  async getUuid(): Promise<DeviceUuid> {
    const data = await this.info(Info.Uuid, [0, 0, 0, 0, 0, 0], undefined, 0)
    let value = 0n
    for (const byte of data) value = (value << 8n) | BigInt(byte)
    return { value: Number(value), hex: '0x' + value.toString(16).padStart(12, '0') }
  }

  async getFirmwareVersion(): Promise<FirmwareVersion> {
    const [lo = 0, hi = 0] = await this.info(Info.FirmwareVersion, [0, 0])
    return parseFirmwareVersion(lo, hi)
  }

  async getSupportedSwitches(): Promise<number[]> {
    return bitmapToIndices(await this.info(Info.SupportedSwitches, [], 32))
  }

  /** Byte 0 of the 32-byte reply is skipped by the vendor; bits 0..6 of the rest map to TGL…RS. */
  async getSupportedAdvancedKeyTypes(): Promise<AdvancedKeyType[]> {
    const bits = new Set(bitmapToIndices((await this.info(Info.SupportedAdvancedKeyTypes, [], 32)).slice(1)))
    return ADVANCED_KEY_BITS.filter((_, i) => bits.has(i))
  }

  async getMinRapidTrigger(): Promise<number> {
    return (await this.info(Info.MinRapidTrigger, [], 1))[0] ?? 0
  }

  async getTravelPrecision(): Promise<number> {
    return (await this.info(Info.TravelPrecision, [], 1))[0] ?? 0
  }

  async isLowPowerModeSupported(): Promise<boolean> {
    return (await this.info(Info.LowPowerSupported, [], 1))[0] === 1
  }

  async isWirelessDedicatedSupported(): Promise<boolean> {
    return (await this.info(Info.WirelessDedicatedSupported, [], 1))[0] === 1
  }

  /**
   * The feature bitmap never changes while the device is open, and real-time colour streaming consults it on every
   * frame — so it is read once and the promise reused. Without this, each streamed frame costs an extra
   * request/response round-trip and the lighting visibly stutters.
   */
  features(): Promise<KeyboardFeatures> {
    // A failed read must not be remembered: one timeout would otherwise break lighting until the device reopens.
    return (this.featuresPromise ??= this.readFeatures().catch((error: unknown) => {
      this.featuresPromise = undefined
      throw error
    }))
  }

  private featuresPromise: Promise<KeyboardFeatures> | undefined

  private async readFeatures(): Promise<KeyboardFeatures> {
    const a = new Uint8Array(56)
    a.set((await this.info(Info.Features, [], 56)).subarray(0, 56))
    const bit = (byte: number, n: number) => ((byte >> n) & 1) === 1
    const wheelSlider = (a[5]! << 8) | a[6]!
    return {
      lcdDisplay: bit(a[0]!, 0),
      dotMatrixDisplay: bit(a[0]!, 1),
      lowPowerMode: a[1] !== 0,
      wirelessDedicatedChannel: a[2] !== 0,
      winMode: bit(a[3]!, 0),
      macMode: bit(a[3]!, 1),
      wasdArrowSwap: a[4] !== 0,
      wheel: bit(wheelSlider, 0),
      slider: bit(wheelSlider, 1),
      keyIdRGB: bit(a[9]!, 0),
      fullKeysRGB: bit(a[9]!, 1),
      ledBeadTable565: bit(a[9]!, 2),
      ledBeadRGB565: bit(a[9]!, 3) && bit(a[9]!, 4),
      switchMixing: bit(a[12]!, 7),
      twoStageTrigger: (a[12]! & 7) === 2,
      // The vendor derives this from the UUID prefix (0x16 → 1000 Hz, else 8000); every registered K98 Pro is 0x14.
      maxPollingRate: 8000,
    }
  }

  // -- settings --------------------------------------------------------------

  async read(): Promise<KeyboardSettings> {
    const osMode = osFromWire((await this.readSetting(Setting.OsMode))[0] ?? 0)
    const pollingRate = POLLING_RATE_FROM_WIRE[(await this.readSetting(Setting.PollingRate))[0] ?? 0] ?? 1000
    const sleep = await this.readSetting(Setting.SleepTime)
    const winKeyLock = (await this.readSetting(Setting.WinKeyLock))[0] === 1
    const comboOptimization = (await this.readSetting(Setting.ComboOptimization))[0] === 1
    const adaptiveCalibration = (await this.readSetting(Setting.AdaptiveCalibration))[0] === 1
    const debounceMode = DEBOUNCE_FROM_WIRE[(await this.readSetting(Setting.DebounceMode))[0] ?? 0] ?? 'normal'
    const debounce = await this.readSetting(Setting.DebounceTime)
    return {
      osMode,
      pollingRate,
      sleepSeconds: sleep.length >= 2 ? readU16be(sleep, 0) : 0,
      winKeyLock,
      comboOptimization,
      adaptiveCalibration,
      debounceMode,
      debounceUs: debounce.length >= 2 ? readU16be(debounce, 0) : 0,
    }
  }

  async getLowPowerMode(): Promise<boolean> {
    return (await this.readSetting(Setting.LowPowerMode, 1))[0] === 1
  }

  async getWasdArrowSwap(): Promise<boolean> {
    return (await this.readSetting(Setting.WasdArrowSwap, 1))[0] === 1
  }

  async update<K extends keyof KeyboardSettings>(key: K, value: NonNullable<KeyboardSettings[K]>): Promise<void> {
    switch (key) {
      case 'osMode':
        return this.writeSetting(Setting.OsMode, [osToWire(value as KeyboardSettings['osMode'])])
      case 'pollingRate':
        return this.writeSetting(Setting.PollingRate, [POLLING_RATE_TO_WIRE[value as PollingRate]])
      case 'sleepSeconds':
        return this.writeSetting(Setting.SleepTime, u16be(clamp(value as number, 0, 0xffff)))
      case 'winKeyLock':
        return this.writeSetting(Setting.WinKeyLock, [value ? 1 : 0])
      case 'comboOptimization':
        return this.writeSetting(Setting.ComboOptimization, [value ? 1 : 0])
      case 'adaptiveCalibration':
        return this.writeSetting(Setting.AdaptiveCalibration, [value ? 1 : 0])
      case 'debounceMode':
        return this.writeSetting(Setting.DebounceMode, [debounceToWire(value as KeyboardSettings['debounceMode'])])
      case 'debounceUs':
        return this.writeSetting(Setting.DebounceTime, u16be(clamp(value as number, DEBOUNCE_US.min, DEBOUNCE_US.max)))
      case 'lowPowerMode':
        return this.writeSetting(Setting.LowPowerMode, [value ? 1 : 0])
      case 'wasdArrowSwap':
        return this.writeSetting(Setting.WasdArrowSwap, [value ? 1 : 0])
      default:
        throw new Error(`unknown setting ${String(key)}`)
    }
  }

  pollingRates(): PollingRate[] {
    return [125, 250, 500, 1000, 2000, 4000, 8000]
  }

  sleepOptions(): number[] {
    return [...SLEEP_OPTIONS_SECONDS]
  }

  // -- misc ------------------------------------------------------------------

  async battery(): Promise<BatteryStatus> {
    const replies = await this.link.request(buildPackets(Cmd.Battery, 0, [], this.reportId))
    const [level = 0, flags = 0] = decodePayload(replies)
    return { level, ...decodeBatteryFlags(flags) }
  }

  /** `0xA5`: electrical matrix position of each key id; the reply carries `[col, row]` pairs. */
  async keyMatrixPositions(ids: KeyId[]): Promise<{ id: KeyId; row: number; col: number }[]> {
    if (!ids.length) return []
    const payload = ids.flatMap((id) => u16be(id))
    const replies = await this.link.request(buildPackets(Cmd.KeyMatrixPositions, 0, payload, this.reportId, alignedChunk(2, 2)))
    const data = decodePayload(replies)
    const out: { id: KeyId; row: number; col: number }[] = []
    for (let i = 0; i + 1 < data.length && i / 2 < ids.length; i += 2) out.push({ id: ids[i / 2]!, col: data[i]!, row: data[i + 1]! })
    return out
  }

  async reset(scope: ResetScope, sel?: LayerSelector): Promise<void> {
    const param = encodeLayerAndSystem(sel?.layer ?? 0, sel ? osToWire(sel.os) : 0)
    await this.link.request(buildPackets(Cmd.Reset, param, [RESET_TYPES[scope]], this.reportId))
  }
}
