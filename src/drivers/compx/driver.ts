/**
 * Compx (GravaStar Mercury) mouse `MouseDriver`. Connection sequence and command usage follow HIDHandle.js
 * (`Get_Device_Info` 1761, `Device_Connect` 933, `Get_Online_Interval` 2629, `Update_Device_Param` 2382,
 * `read_HID_Buffer` 1223). Doc: docs/reverse-engineering/mouse/01-transport-commands.md §6–§10, 02-features.md.
 */
import { Emitter } from '@/hid/core/emitter'
import { sleep } from '@/hid/core/request'
import { WebHidTransport, type HidDeviceLike, type Transport } from '@/hid/core/transport'
import type { BatteryStatus, DeviceInfo, LinkType, NumericRange, RGB } from '@/model/device'
import type {
  DongleService,
  DpiCapabilities,
  DpiService,
  DpiSettings,
  MouseCapabilities,
  MouseDriver,
  MouseEvents,
  MouseInfo,
  MouseKeyFunction,
  MouseKeyService,
  MouseKeySlot,
  MouseLightModeInfo,
  MouseLighting,
  MouseLightingService,
  MouseMacro,
  MouseMacroCapabilities,
  MousePowerService,
  MouseProfileService,
  ReportRate,
  ReportRateService,
  SensorCapabilities,
  SensorMode,
  SensorService,
  SensorSettings,
} from '@/model/mouse'
import {
  Addr,
  KEY_SLOTS,
  KeyFn,
  MACRO_MAX_EVENTS,
  MACRO_NAME_MAX_BYTES,
  MACRO_STRIDE,
  SHORTCUT_STRIDE,
  decodeDpiStage,
  decodeKeySlot,
  decodeLightBlock,
  decodeMacroRecord,
  encodeCombo,
  encodeDpiColor,
  encodeDpiStage,
  encodeKeySlot,
  encodeLightBlock,
  encodeMacroRecord,
  encodeMedia,
  readOptional,
  reportRateFromByte,
  reportRateToByte,
  snapDpi,
} from './eeprom'
import { Command, REPORT_ID, buildFrame } from './frame'
import { CompxLink } from './link'
import { FALLBACK_MODEL, LIGHT_MODES, PERFORMANCE_OPTIONS_SECONDS, SLEEP_OPTIONS_SECONDS, findModel, type MouseModel } from './models'
import { CompxMusic } from './music'

/** `EncryptionData` reply byte 11 → link and ceiling report rate. */
const DEVICE_TYPES: Record<number, { wired: boolean; maxReportRate: ReportRate }> = {
  0: { wired: false, maxReportRate: 1000 },
  1: { wired: false, maxReportRate: 4000 },
  2: { wired: true, maxReportRate: 1000 },
  3: { wired: true, maxReportRate: 8000 },
  4: { wired: false, maxReportRate: 2000 },
  5: { wired: false, maxReportRate: 8000 },
}

const ALL_RATES: ReportRate[] = [125, 250, 500, 1000, 2000, 4000, 8000]
const BATTERY_POLL_MS = 5000
const ONLINE_POLL_MS = 1500
const ONLINE_ATTEMPTS = 20

export interface CompxSession {
  cid: number
  mid: number
  typeByte: number
  wired: boolean
  maxReportRate: ReportRate
  model: MouseModel
  firmware?: string
  dongleFirmware?: string
  address?: string
}

function versionString(major: number, minor: number): string {
  return `v${major}.${minor.toString(16).padStart(2, '0')}`
}

export class CompxMouseDriver implements MouseDriver {
  readonly kind = 'mouse' as const
  readonly dpi: DpiService
  readonly reportRate: ReportRateService
  readonly sensor: SensorService
  readonly keys: MouseKeyService
  readonly lighting: MouseLightingService
  readonly power: MousePowerService
  readonly profiles: MouseProfileService
  /** Music sync; what the firmware accepts is probed at run time (`music.probe()`), not assumed from the model. */
  readonly music: CompxMusic
  dongle?: DongleService
  private readonly emitter = new Emitter<MouseEvents>()
  private session: CompxSession | undefined
  private batteryTimer: ReturnType<typeof setInterval> | undefined
  private lastBattery: BatteryStatus | undefined
  private unsubscribeStatus: (() => void) | undefined

  constructor(
    readonly hid: CompxLink,
    readonly link: LinkType,
  ) {
    this.dpi = new DpiSvc(this)
    this.reportRate = new ReportRateSvc(this)
    this.sensor = new SensorSvc(this)
    this.keys = new KeySvc(this)
    this.lighting = new LightingSvc(this)
    this.power = new PowerSvc(this)
    this.profiles = new ProfileSvc(this)
    this.music = new CompxMusic(this)
  }

  static async open(device: HidDeviceLike, link: LinkType): Promise<CompxMouseDriver> {
    return CompxMouseDriver.fromTransport(await WebHidTransport.open(device, REPORT_ID), link)
  }

  static fromTransport(transport: Transport, link: LinkType): CompxMouseDriver {
    return new CompxMouseDriver(new CompxLink(transport), link)
  }

  on: MouseDriver['on'] = (event, listener) => this.emitter.on(event, listener)

  get current(): CompxSession {
    if (!this.session) throw new Error('mouse is not connected')
    return this.session
  }

  get model(): MouseModel {
    return this.current.model
  }

  get flash(): Uint8Array {
    return this.hid.flash
  }

  // -- connection ------------------------------------------------------------

  async connect(): Promise<void> {
    // 1. Handshake: 4 random bytes; reply carries CID/MID/type.
    const rnd = Array.from({ length: 4 }, () => Math.floor(Math.random() * 256))
    const info = await this.hid.command(Command.EncryptionData, [...rnd, 0, 0, 0, 0])
    const raw = infoBytes(info)
    const cid = raw[9] ?? 0
    const mid = raw[10] ?? 0
    const typeByte = raw[11] ?? 0
    const type = DEVICE_TYPES[typeByte] ?? { wired: this.link === 'wired', maxReportRate: 1000 as ReportRate }
    const model = findModel(cid, mid) ?? FALLBACK_MODEL
    this.session = { cid, mid, typeByte, wired: type.wired, maxReportRate: type.maxReportRate, model }
    if (!type.wired) this.dongle = new DongleSvc(this)
    else this.dongle = undefined

    // 2. Wait for the peripheral to be online (dongle without a paired mouse answers offline).
    let online = false
    for (let i = 0; i < ONLINE_ATTEMPTS && !online; i++) {
      online = await this.isOnline()
      if (!online) await sleep(ONLINE_POLL_MS)
    }
    if (!online) throw new Error('Mouse is offline (asleep or not paired with the receiver)')

    // 3. Settings image, profile, versions, battery.
    await this.syncFromDevice()
    await this.readVersions()
    this.lastBattery = await this.readBattery()

    this.unsubscribeStatus?.()
    this.unsubscribeStatus = this.hid.onStatus((f) => void this.handleStatus(f))
    if (this.batteryTimer) clearInterval(this.batteryTimer)
    this.batteryTimer = setInterval(() => void this.pollBattery(), BATTERY_POLL_MS)
  }

  private async isOnline(): Promise<boolean> {
    const reply = await this.hid.command(Command.DeviceOnLine)
    const b = infoBytes(reply)
    if (b[5] === 1 && this.session) this.session.address = [b[8], b[7], b[6]].map((x) => (x ?? 0).toString(16).padStart(2, '0')).join('')
    return b[5] === 1
  }

  /** Re-reads the low flash page (+ sensor-specific blocks) like `Update_Device_Param`. */
  async syncFromDevice(): Promise<void> {
    this.hid.flash.fill(0xff)
    await this.hid.readRange(0x000, 0x100)
    if (this.model.sensor.type === '3955') await this.hid.readRange(Addr.Sensor3955Dpi, Addr.Sensor3955Dpi + 0x30)
    await this.hid.readRange(Addr.VirtualCenter, Addr.VirtualCenter + 4)
    // Shortcut / macro blocks only for slots that use them.
    for (const key of this.model.keys) {
      const type = this.hid.flash[Addr.KeyFunction + key.slot * 4]
      if (type === KeyFn.Shortcut) await this.readShortcut(key.slot)
      if (type === KeyFn.Macro) await this.readMacro(key.slot)
    }
  }

  private async readVersions(): Promise<void> {
    const v = infoBytes(await this.hid.command(Command.ReadVersionID))
    this.current.firmware = versionString(v[5] ?? 0, v[6] ?? 0)
    if (!this.current.wired) {
      const d = await this.hid.command(Command.GetDongleVersion)
      this.current.dongleFirmware = d.status === 1 ? 'v1.0' : versionString(infoBytes(d)[5] ?? 0, infoBytes(d)[6] ?? 0)
    }
  }

  async readShortcut(slot: number): Promise<Uint8Array> {
    const base = Addr.ShortcutKey + slot * SHORTCUT_STRIDE
    await this.hid.readBytes(base, 10)
    const count = this.hid.flash[base]!
    const end = count * 3 + 2
    for (let start = 10; start < end; start += 10) await this.hid.readBytes(base + start, Math.min(10, end - start))
    return this.hid.flash.subarray(base, base + SHORTCUT_STRIDE)
  }

  async readMacro(slot: number): Promise<Uint8Array> {
    const base = Addr.Macro + slot * MACRO_STRIDE
    await this.hid.readBytes(base, 10)
    const nameLen = this.hid.flash[base]!
    for (let start = 10; start < nameLen + 1; start += 10) await this.hid.readBytes(base + start, Math.min(10, nameLen + 1 - start))
    await this.hid.readBytes(base + 0x1f, 10)
    const count = this.hid.flash[base + 0x1f]!
    const end = 0x1f + count * 5 + 2
    for (let start = 0x1f + 10; start < end; start += 10) await this.hid.readBytes(base + start, Math.min(10, end - start))
    return this.hid.flash.subarray(base, base + MACRO_STRIDE)
  }

  private async readBattery(): Promise<BatteryStatus> {
    const b = infoBytes(await this.hid.command(Command.BatteryLevel))
    return { level: b[5] ?? 0, charging: b[6] === 1, voltageMv: ((b[7] ?? 0) << 8) | (b[8] ?? 0) }
  }

  private async pollBattery(): Promise<void> {
    try {
      if (!(await this.isOnline())) return
      const status = await this.readBattery()
      if (JSON.stringify(status) !== JSON.stringify(this.lastBattery)) this.emitter.emit('battery', status)
      this.lastBattery = status
    } catch {
      /* transient */
    }
  }

  /** `StatusChanged` (0x0A): re-read what the mouse changed on its own and emit events. */
  private async handleStatus(frame: Uint8Array): Promise<void> {
    const f5 = frame[5] ?? 0
    const f6 = frame[6] ?? 0
    try {
      if (f5 & 0x01) {
        await this.hid.readBytes(Addr.CurrentDpi, 2)
        this.emitter.emit('dpi-change', this.hid.flash[Addr.CurrentDpi]!)
      }
      if (f5 & 0x02) {
        await this.hid.readBytes(Addr.ReportRate, 2)
        this.emitter.emit('report-rate-change', reportRateFromByte(this.hid.flash[Addr.ReportRate]!) as ReportRate)
      }
      if (f5 & 0x04) {
        const p = infoBytes(await this.hid.command(Command.GetCurrentConfig))
        await this.syncFromDevice()
        this.emitter.emit('profile-change', p[5] ?? 0)
      }
      if (f5 & 0x20) {
        await this.hid.readBytes(Addr.Light, 7)
        this.emitter.emit('lighting-change', await this.lighting.get())
      }
      if (f5 & 0x40) await this.pollBattery()
      if (f6 & 0x01) {
        await this.hid.readBytes(Addr.Lod, 2)
        this.emitter.emit('sensor-change', { lod: this.hid.flash[Addr.Lod]! })
      }
      if (f6 & 0x04) {
        await this.hid.readBytes(Addr.MotionSync, 2)
        this.emitter.emit('sensor-change', { motionSync: this.hid.flash[Addr.MotionSync] === 1 })
      }
    } catch {
      /* the mouse may have gone to sleep mid-refresh */
    }
  }

  async disconnect(): Promise<void> {
    if (this.batteryTimer) clearInterval(this.batteryTimer)
    this.batteryTimer = undefined
    this.unsubscribeStatus?.()
    this.emitter.emit('disconnected', undefined)
    this.emitter.clear()
    await this.hid.close()
  }

  async info(): Promise<DeviceInfo> {
    if (!this.session) await this.connect()
    return { firmwareVersion: this.current.firmware, dongleFirmwareVersion: this.current.dongleFirmware, uniqueId: this.current.address }
  }

  async battery(): Promise<BatteryStatus | undefined> {
    return this.lastBattery ?? (await this.readBattery())
  }

  async capabilities(): Promise<MouseCapabilities> {
    if (!this.session) await this.connect()
    const s = this.current
    const model: MouseInfo = { cid: s.cid, mid: s.mid, sensor: s.model.sensor.type, maxReportRate: s.maxReportRate }
    return { model, keys: s.model.keys.map((k) => ({ slot: k.slot, label: k.label })), hasLighting: s.model.hasLighting, hasDongle: !s.wired }
  }

  /** `ClearSetting` (0x09) is fire-and-forget; wait for the mouse to come back, then re-sync. */
  async factoryReset(): Promise<void> {
    await this.hid.send(buildFrame({ command: Command.ClearSetting }))
    let online = false
    for (let i = 0; i < 20 && !online; i++) {
      await sleep(300)
      try {
        online = await this.isOnline()
      } catch {
        online = false
      }
    }
    await this.syncFromDevice()
  }

  /** Compx-compatible `.bin`: the 16 KiB image plus a 64-byte trailer (`Compx Inc`, device type, sensor). */
  async exportSettings(): Promise<Uint8Array> {
    const out = new Uint8Array(this.hid.flash.length + 64)
    out.set(this.hid.flash)
    const enc = new TextEncoder()
    out.set(enc.encode('Compx Inc'), this.hid.flash.length)
    out.set(enc.encode('mouse'), this.hid.flash.length + 0x20)
    out.set(enc.encode(this.model.sensor.type), this.hid.flash.length + 0x30)
    return out
  }

  async importSettings(image: Uint8Array): Promise<void> {
    const size = this.hid.flash.length
    if (image.length !== size + 64) throw new Error('not a Compx settings file')
    const dec = new TextDecoder()
    const str = (o: number, n: number) => dec.decode(image.subarray(size + o, size + o + n)).replace(/\0+$/, '')
    if (str(0, 9) !== 'Compx Inc' || str(0x20, 5) !== 'mouse') throw new Error('settings file is not for a mouse')
    if (str(0x30, 4) !== this.model.sensor.type) throw new Error(`settings file is for sensor ${str(0x30, 4)}, this mouse has ${this.model.sensor.type}`)
    const data = image.subarray(0, size)
    // Clamp the report rate to what this link supports, keeping the complement byte valid.
    const rate = Math.min(reportRateFromByte(data[Addr.ReportRate]!), this.current.maxReportRate)
    data.set([reportRateToByte(rate), (0x55 - reportRateToByte(rate)) & 0xff], Addr.ReportRate)
    await this.hid.writeArray(0, data.subarray(0, 0x100))
    if (this.model.sensor.type === '3955') await this.hid.writeArray(Addr.Sensor3955Dpi, data.subarray(Addr.Sensor3955Dpi, Addr.Sensor3955Dpi + 0x30))
    await this.hid.writeArray(Addr.VirtualCenter, data.subarray(Addr.VirtualCenter, Addr.VirtualCenter + 4))
    for (let slot = 0; slot < KEY_SLOTS; slot++) {
      const sc = Addr.ShortcutKey + slot * SHORTCUT_STRIDE
      const mc = Addr.Macro + slot * MACRO_STRIDE
      if (!same(data, this.hid.flash, sc, SHORTCUT_STRIDE)) await this.hid.writeArray(sc, data.subarray(sc, sc + SHORTCUT_STRIDE))
      if (!same(data, this.hid.flash, mc, MACRO_STRIDE)) await this.hid.writeArray(mc, data.subarray(mc, mc + MACRO_STRIDE))
    }
    await this.syncFromDevice()
  }

  /** @internal */ emit<K extends keyof MouseEvents & string>(event: K, payload: MouseEvents[K]): void {
    this.emitter.emit(event, payload)
  }
}

function same(a: Uint8Array, b: Uint8Array, offset: number, length: number): boolean {
  for (let i = 0; i < length; i++) if (a[offset + i] !== b[offset + i]) return false
  return true
}

/** Whole 16-byte reply for commands whose data sits at fixed absolute offsets. */
function infoBytes(f: { command: number; status: number; address: number; length: number; payload: Uint8Array }): number[] {
  const out = new Array<number>(16).fill(0)
  out[0] = f.command
  out[1] = f.status
  out[2] = (f.address >> 8) & 0xff
  out[3] = f.address & 0xff
  out[4] = f.length
  // `payload` is a view of the raw frame; recover the raw bytes 5..14 from its buffer.
  const raw = new Uint8Array(f.payload.buffer, f.payload.byteOffset - 5, Math.min(16, f.payload.buffer.byteLength - (f.payload.byteOffset - 5)))
  for (let i = 5; i < raw.length; i++) out[i] = raw[i]!
  return out
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

class DpiSvc implements DpiService {
  constructor(private readonly d: CompxMouseDriver) {}

  async capabilities(): Promise<DpiCapabilities> {
    const m = this.d.model
    const first = m.sensor.ranges[0]!
    return { range: { min: first.min, max: Math.min(m.maxDpi, m.sensor.ranges[m.sensor.ranges.length - 1]!.max), step: first.step, unit: 'DPI' }, maxStages: 8, separateXY: true, stageColors: true }
  }

  async get(): Promise<DpiSettings> {
    const f = this.d.flash
    const stages = []
    for (let i = 0; i < 8; i++) {
      const v = decodeDpiStage(this.d.model.sensor, f.subarray(Addr.DpiValue + i * 4, Addr.DpiValue + i * 4 + 4))
      const c = f.subarray(Addr.DpiColor + i * 4, Addr.DpiColor + i * 4 + 3)
      stages.push({ dpiX: v.dpiX, dpiY: v.dpiY, color: { r: c[0]!, g: c[1]!, b: c[2]! } })
    }
    return { stageCount: Math.min(8, Math.max(1, f[Addr.MaxDpiStage]!)), current: f[Addr.CurrentDpi]!, stages }
  }

  async setStageCount(count: number): Promise<void> {
    await this.d.hid.writeValue(Addr.MaxDpiStage, Math.min(8, Math.max(1, count)))
  }

  async setCurrent(index: number): Promise<void> {
    await this.d.hid.writeValue(Addr.CurrentDpi, Math.min(7, Math.max(0, index)))
  }

  async setStage(index: number, stage: { dpiX?: number; dpiY?: number; color?: RGB }): Promise<void> {
    const cur = (await this.get()).stages[index]
    if (!cur) throw new RangeError(`no DPI stage ${index}`)
    const sensor = this.d.model.sensor
    if (stage.dpiX !== undefined || stage.dpiY !== undefined) {
      const x = snapDpi(sensor, stage.dpiX ?? cur.dpiX)
      const y = snapDpi(sensor, stage.dpiY ?? stage.dpiX ?? cur.dpiY)
      await this.d.hid.writeArray(Addr.DpiValue + index * 4, encodeDpiStage(sensor, x, y))
    }
    if (stage.color) await this.d.hid.writeArray(Addr.DpiColor + index * 4, encodeDpiColor(stage.color))
  }
}

class ReportRateSvc implements ReportRateService {
  constructor(private readonly d: CompxMouseDriver) {}

  async options(): Promise<ReportRate[]> {
    return ALL_RATES.filter((r) => r <= this.d.current.maxReportRate)
  }

  async get(): Promise<ReportRate> {
    return Math.min(reportRateFromByte(this.d.flash[Addr.ReportRate]!), this.d.current.maxReportRate) as ReportRate
  }

  async set(rate: ReportRate): Promise<void> {
    if (rate > this.d.current.maxReportRate) throw new RangeError(`${rate} Hz exceeds this link's maximum of ${this.d.current.maxReportRate} Hz`)
    await this.d.hid.writeValue(Addr.ReportRate, reportRateToByte(rate))
  }
}

class SensorSvc implements SensorService {
  constructor(private readonly d: CompxMouseDriver) {}

  async capabilities(): Promise<SensorCapabilities> {
    const s = this.d.model.sensor
    return {
      sensor: s.type,
      lodOptions: s.lodOptions,
      performanceSecondsOptions: PERFORMANCE_OPTIONS_SECONDS,
      supports: { ...s.supports, rippleControl: s.supports.ripple, performanceMode: true, sensorMode: true, angleTune: readOptional(this.d.flash, Addr.AngleTune) !== undefined },
    }
  }

  async get(): Promise<SensorSettings> {
    const f = this.d.flash
    const angle = readOptional(f, Addr.AngleTune)
    return {
      lod: f[Addr.Lod]!,
      motionSync: f[Addr.MotionSync] === 1,
      rippleControl: f[Addr.Ripple] === 1,
      angleSnap: f[Addr.Angle] === 1,
      performanceMode: f[Addr.PerformanceState] === 1,
      performanceSeconds: f[Addr.PerformanceTime]! * 10,
      sensorMode: (await this.sensorModeState()).value,
      ...(angle !== undefined ? { angleTune: angle >= 0x80 ? angle - 0x100 : angle } : {}),
    }
  }

  async update<K extends keyof SensorSettings>(key: K, value: NonNullable<SensorSettings[K]>): Promise<void> {
    const hid = this.d.hid
    switch (key) {
      case 'lod':
        return hid.writeValue(Addr.Lod, value as number)
      case 'motionSync':
        return hid.writeValue(Addr.MotionSync, value ? 1 : 0)
      case 'rippleControl':
        return hid.writeValue(Addr.Ripple, value ? 1 : 0)
      case 'angleSnap':
        return hid.writeValue(Addr.Angle, value ? 1 : 0)
      case 'performanceMode':
        return hid.writeValue(Addr.PerformanceState, value ? 1 : 0)
      case 'performanceSeconds':
        return hid.writeValue(Addr.PerformanceTime, Math.round((value as number) / 10))
      case 'sensorMode':
        if (value === 'corded') throw new Error('"corded" is reported by the mouse, not settable')
        return hid.writeValue(Addr.SensorMode, value === 'highPerformance' ? 1 : 0)
      case 'angleTune': {
        const v = Math.max(-30, Math.min(30, Math.round(value as number)))
        await hid.writeValue(Addr.AngleTune, v < 0 ? v + 0x100 : v)
        return hid.writeValue(Addr.AngleTuneState, v === 0 ? 0 : 1)
      }
      default:
        throw new Error(`unknown sensor setting ${String(key)}`)
    }
  }

  /** `Update_MS_SensorModeDisplay`: wired or ≥ 2 kHz forces the mode. */
  async sensorModeState(): Promise<{ value: SensorMode; editable: boolean }> {
    const s = this.d.current
    const rate = reportRateFromByte(this.d.flash[Addr.ReportRate]!)
    const fps20k = readOptional(this.d.flash, Addr.SensorFps20k) === 1
    if (s.wired || fps20k) return { value: 'corded', editable: false }
    if (rate <= 1000) return { value: this.d.flash[Addr.SensorMode] === 1 ? 'highPerformance' : 'lowPower', editable: true }
    if (rate < 8000 && s.model.sensor.type === '3955') return { value: 'highPerformance', editable: false }
    return { value: 'corded', editable: false }
  }
}

class KeySvc implements MouseKeyService {
  readonly debounceRange: NumericRange & { warnBelow?: number }

  constructor(private readonly d: CompxMouseDriver) {
    this.debounceRange = { min: 0, max: 15, step: 1, unit: 'ms', warnBelow: 8 }
  }

  async list(): Promise<MouseKeySlot[]> {
    const m = this.d.model
    ;(this.debounceRange as NumericRange).max = m.debounce.max
    this.debounceRange.warnBelow = m.debounce.warnBelow
    const out: MouseKeySlot[] = []
    for (const key of m.keys) {
      const rec = this.d.flash.subarray(Addr.KeyFunction + key.slot * 4, Addr.KeyFunction + key.slot * 4 + 4)
      const shortcut = rec[0] === KeyFn.Shortcut ? this.d.flash.subarray(Addr.ShortcutKey + key.slot * SHORTCUT_STRIDE, Addr.ShortcutKey + (key.slot + 1) * SHORTCUT_STRIDE) : undefined
      const fn = decodeKeySlot(m.sensor, rec, shortcut)
      const slot: MouseKeySlot = { slot: key.slot, label: key.label, fn }
      if (fn.type === 'macro') {
        const macro = decodeMacroRecord(this.d.flash.subarray(Addr.Macro + key.slot * MACRO_STRIDE, Addr.Macro + (key.slot + 1) * MACRO_STRIDE))
        if (macro) slot.macro = macro
      }
      out.push(slot)
    }
    return out
  }

  async set(slot: number, fn: MouseKeyFunction, macro?: MouseMacro): Promise<void> {
    const hid = this.d.hid
    if (fn.type === 'combo') await hid.writeArray(Addr.ShortcutKey + slot * SHORTCUT_STRIDE, encodeCombo(fn.modifiers, fn.usage))
    if (fn.type === 'media') await hid.writeArray(Addr.ShortcutKey + slot * SHORTCUT_STRIDE, encodeMedia(fn.usage))
    if (fn.type === 'macro') {
      if (!macro) throw new Error('a macro binding needs the macro')
      await hid.writeArray(Addr.Macro + slot * MACRO_STRIDE, encodeMacroRecord(macro))
    }
    await hid.writeArray(Addr.KeyFunction + slot * 4, encodeKeySlot(this.d.model.sensor, slot, fn))
  }

  async restore(slot: number): Promise<void> {
    const key = this.d.model.keys.find((k) => k.slot === slot)
    if (!key) throw new RangeError(`no key in slot ${slot}`)
    const current = this.d.flash[Addr.KeyFunction + slot * 4]
    if (current === KeyFn.Macro) await this.d.hid.writeArray(Addr.Macro + slot * MACRO_STRIDE, new Uint8Array(MACRO_STRIDE))
    await this.set(slot, key.defaultFn)
  }

  macroCapabilities(): MouseMacroCapabilities {
    return { maxEvents: MACRO_MAX_EVENTS, maxNameBytes: MACRO_NAME_MAX_BYTES, delayRange: { min: 10, max: 65535, step: 1, unit: 'ms' } }
  }

  async getDebounce(): Promise<number> {
    return this.d.flash[Addr.DebounceTime]!
  }

  async setDebounce(ms: number): Promise<void> {
    await this.d.hid.writeValue(Addr.DebounceTime, Math.min(this.d.model.debounce.max, Math.max(0, Math.round(ms))))
  }
}

class LightingSvc implements MouseLightingService {
  constructor(private readonly d: CompxMouseDriver) {}

  async modes(): Promise<MouseLightModeInfo[]> {
    return LIGHT_MODES
  }

  async supported(): Promise<boolean> {
    return this.d.model.hasLighting
  }

  async get(): Promise<MouseLighting> {
    const f = this.d.flash
    const block = decodeLightBlock(f.subarray(Addr.Light, Addr.Light + 6))
    return { on: f[Addr.LightState] === 1, mode: block.mode, color: block.color, speed: block.speed, brightness: block.brightness, offWhileMoving: f[Addr.MovingOffLight] === 1 }
  }

  /** Mode 0 only turns the light off (stored mode untouched), like the vendor. */
  async set(patch: Partial<MouseLighting>): Promise<void> {
    const hid = this.d.hid
    const cur = await this.get()
    const next = { ...cur, ...patch }
    if (patch.mode === 0 || patch.on === false) {
      if (cur.on) await hid.writeValue(Addr.LightState, 0)
    } else {
      if (!cur.on && (patch.on || (patch.mode !== undefined && patch.mode !== 0))) await hid.writeValue(Addr.LightState, 1)
      await hid.writeArray(Addr.Light, encodeLightBlock({ mode: next.mode || cur.mode || 1, color: next.color, speed: next.speed, brightness: next.brightness }))
    }
    if (patch.offWhileMoving !== undefined && patch.offWhileMoving !== cur.offWhileMoving) await hid.writeValue(Addr.MovingOffLight, patch.offWhileMoving ? 1 : 0)
  }
}

class PowerSvc implements MousePowerService {
  constructor(private readonly d: CompxMouseDriver) {}

  async getSleepSeconds(): Promise<number> {
    // A music session parks the hardware byte at its maximum so the light does not idle out; report the user's own
    // value meanwhile, or the panel would show "15 min" and writing it back would be a no-op.
    return (this.d.music.heldSleepByte ?? this.d.flash[Addr.SleepTime]!) * 10
  }

  async setSleepSeconds(seconds: number): Promise<void> {
    const value = Math.max(1, Math.round(seconds / 10))
    if (this.d.music.heldSleepByte !== undefined) {
      this.d.music.setHeldSleepByte(value) // applied when the session releases the byte
      return
    }
    await this.d.hid.writeValue(Addr.SleepTime, value)
  }

  options(): number[] {
    return SLEEP_OPTIONS_SECONDS
  }
}

class ProfileSvc implements MouseProfileService {
  readonly count = 4

  constructor(private readonly d: CompxMouseDriver) {}

  async get(): Promise<{ current: number; supported: boolean }> {
    const r = await this.d.hid.command(Command.GetCurrentConfig)
    return { current: r.status === 0 ? infoBytes(r)[5]! : 0, supported: r.status === 0 }
  }

  async select(index: number): Promise<void> {
    await this.d.hid.command(Command.SetCurrentConfig, [Math.min(3, Math.max(0, index))])
    await this.d.syncFromDevice()
    this.d.emit('profile-change', index)
  }
}

class DongleSvc implements DongleService {
  constructor(private readonly d: CompxMouseDriver) {}

  async version(): Promise<string | undefined> {
    return this.d.current.dongleFirmware
  }

  async longRange(): Promise<{ supported: boolean; enabled: boolean }> {
    const r = await this.d.hid.command(Command.GetLongRangeMode)
    return { supported: r.status === 0, enabled: r.status === 0 && infoBytes(r)[5] === 1 }
  }

  async setLongRange(enabled: boolean): Promise<void> {
    await this.d.hid.command(Command.SetLongRangeMode, [enabled ? 1 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  }

  /** Enter pairing on the receiver, then poll `GetPairState` once a second (≤ 20 s). */
  async pair(onStatus: (status: 'pairing' | 'success' | 'failed', secondsLeft: number) => void): Promise<'success' | 'failed'> {
    await this.d.hid.command(Command.DongleEnterPair, [0, 0, this.d.current.cid])
    for (let i = 0; i < 20; i++) {
      await sleep(1000)
      const b = infoBytes(await this.d.hid.command(Command.GetPairState))
      const state = b[5]
      const left = b[6] ?? 0
      if (state === 3) {
        onStatus('success', left)
        return 'success'
      }
      if (state === 2) {
        onStatus('failed', left)
        return 'failed'
      }
      onStatus('pairing', left)
    }
    onStatus('failed', 0)
    return 'failed'
  }
}
