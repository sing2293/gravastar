/**
 * Simulated K98 Pro firmware: answers the same 63-byte packets the real board does, with in-memory state.
 * It exists so drivers and UI can be exercised without hardware; every reply format follows
 * docs/reverse-engineering/k98pro/*.md. Extend `handle()` as services are added.
 */
import { readU16be, u16be } from '@/hid/core/bytes'
import type { FakeHidDevice } from '@/hid/core/testing/fakeHidDevice'
import { PACKET_SIZE, checksum, decodePayload, parsePacket } from '@/drivers/k98pro/codec'
import { Cmd, Info, PID_WIRED, Setting, VENDOR_ID } from '@/drivers/k98pro/enums'

export interface SimOptions {
  reportId?: number
  uuid?: bigint
  firmware?: number
}

export class K98ProFirmware {
  readonly reportId: number
  readonly uuid: bigint
  readonly firmware: number
  /** Settings by `Setting` index → bytes. */
  readonly settings = new Map<number, number[]>()
  battery = { level: 100, charging: false, full: true }
  featureBytes = new Uint8Array(56)
  supportedSwitches = [0, 1, 2]
  supportedAdvancedKeyTypes = [0, 1, 2, 3, 4, 5, 6]
  readonly log: string[] = []
  /** Extra handlers registered by other sim modules (keymap, lighting …). Return replies or `undefined` to pass. */
  readonly extensions: Array<(packet: ReturnType<typeof parsePacket>, raw: Uint8Array) => Uint8Array[] | undefined> = []

  constructor(options: SimOptions = {}) {
    this.reportId = options.reportId ?? 0
    this.uuid = options.uuid ?? 0x14000000000cn
    this.firmware = options.firmware ?? 0x0117
    this.settings.set(Setting.OsMode, [0])
    this.settings.set(Setting.SleepTime, [0, 60])
    this.settings.set(Setting.WinKeyLock, [0])
    this.settings.set(Setting.PollingRate, [0])
    this.settings.set(Setting.ComboOptimization, [0])
    this.settings.set(Setting.AdaptiveCalibration, [1])
    this.settings.set(Setting.DebounceMode, [0])
    this.settings.set(Setting.DebounceTime, [0x1f, 0x40]) // 8000 µs
    this.settings.set(Setting.LowPowerMode, [0])
    this.settings.set(Setting.WasdArrowSwap, [0])
    this.featureBytes[0] = 0b01 // lcd
    this.featureBytes[1] = 1
    this.featureBytes[3] = 0b11
    this.featureBytes[4] = 1
    this.featureBytes[9] = 0b11111
    this.featureBytes[12] = 0x02
  }

  /** Wires this firmware to a fake HID device so `sendReport` produces the device's replies. */
  attach(device: FakeHidDevice): this {
    device.respond = (_reportId, data) => this.handle(data)
    return this
  }

  /** Builds a reply that echoes the request header and carries `payload` (like the firmware does). */
  reply(request: Uint8Array, payload: ArrayLike<number> = [], byte2?: number): Uint8Array {
    const r = new Uint8Array(PACKET_SIZE)
    r.set(request.subarray(0, 6))
    if (byte2 !== undefined) r[2] = byte2
    r[5] = Math.min(payload.length, 56)
    r.set(Array.prototype.slice.call(payload, 0, 56), 6)
    r[62] = checksum(r, this.reportId)
    return r
  }

  handle(raw: Uint8Array): Uint8Array[] {
    if (raw.length !== PACKET_SIZE) return []
    const p = parsePacket(raw)
    this.log.push(`${p.commandId.toString(16).padStart(2, '0')}/${p.param.toString(16).padStart(2, '0')}`)
    for (const ext of this.extensions) {
      const r = ext(p, raw)
      if (r) return r
    }
    switch (p.commandId) {
      case Cmd.DeviceInfo:
        return [this.reply(raw, this.deviceInfo(p.param))]
      case Cmd.ReadSetting:
        return [this.reply(raw, this.settings.get(p.param) ?? [0])]
      case Cmd.WriteSetting:
        this.settings.set(p.param, Array.from(decodePayload(raw)))
        return [this.reply(raw)]
      case Cmd.Battery:
        return [this.reply(raw, [this.battery.level, (this.battery.charging ? 0x10 : 0) | (this.battery.full ? 0x01 : 0)])]
      case Cmd.KeyMatrixPositions: {
        const ids = decodePayload(raw)
        const out: number[] = []
        for (let i = 0; i + 1 < ids.length; i += 2) {
          const id = readU16be(ids, i)
          out.push((id - 1) % 21, Math.floor((id - 1) / 21)) // [col, row]
        }
        return [this.reply(raw, out)]
      }
      case Cmd.Reset:
        return [this.reply(raw)]
      default:
        return [this.reply(raw)] // unknown commands: echo the header (ack)
    }
  }

  private deviceInfo(sub: number): number[] {
    switch (sub) {
      case Info.Uuid: {
        const out: number[] = []
        for (let i = 5; i >= 0; i--) out.push(Number((this.uuid >> BigInt(8 * i)) & 0xffn))
        return out
      }
      case Info.FirmwareVersion:
        return [this.firmware & 0xff, (this.firmware >> 8) & 0xff]
      case Info.SupportedSwitches:
        return bitmap(this.supportedSwitches, 32)
      case Info.SupportedAdvancedKeyTypes:
        return [0, ...bitmap(this.supportedAdvancedKeyTypes, 31)]
      case Info.MinRapidTrigger:
        return [10]
      case Info.TravelPrecision:
        return [1]
      case Info.LowPowerSupported:
        return [1]
      case Info.WirelessDedicatedSupported:
        return [0]
      case Info.Features:
        return Array.from(this.featureBytes)
      case Info.MacroStorageSize:
        return [0, 0, 0x08, 0x00]
      default:
        return []
    }
  }

  /** Emits a device-initiated packet through the attached fake device. */
  static bubble(device: FakeHidDevice, bytes: number[]): void {
    const r = new Uint8Array(PACKET_SIZE)
    r.set(bytes)
    device.dispatchInputReport(r)
  }

  static batteryBubble(level: number, charging: boolean): number[] {
    return [0xfe, 0x05, level, charging ? 0x10 : 0x00]
  }
}

function bitmap(indices: number[], bytes: number): number[] {
  const out = new Array<number>(bytes).fill(0)
  for (const i of indices) out[i >> 3]! |= 1 << (i & 7)
  return out
}

export { PID_WIRED, VENDOR_ID, u16be }
