/**
 * Simulated Compx mouse firmware: a 16 KiB EEPROM image with the GravaStar defaults and the command set of
 * docs/reverse-engineering/mouse/01-transport-commands.md §11. Every reply echoes the request frame, as the real
 * firmware does, with reply data at the documented absolute offsets.
 */
import type { FakeHidDevice } from '@/hid/core/testing/fakeHidDevice'
import { Addr, FLASH_SIZE, encodeDpiColor, encodeDpiStage, encodeKeySlot, encodeLightBlock, reportRateToByte, writeValue } from '@/drivers/compx/eeprom'
import { Command, FRAME_SIZE, REPORT_ID, frameChecksum, parseFrame } from '@/drivers/compx/frame'
import { MODELS, type MouseModel } from '@/drivers/compx/models'
import { MusicCommand, unpackAmplitudes } from '@/drivers/compx/music'

export interface CompxSimOptions {
  model?: MouseModel
  /** `EncryptionData` type byte: 0 dongle 1K, 1 dongle 4K, 2 wired 1K, 3 wired 8K, 4 dongle 2K, 5 dongle 8K. */
  typeByte?: number
  online?: boolean
  /** Accept the office-keyboard music commands 0xB2/0xB6/0xB7 (UNVERIFIED on mouse firmware; default false). */
  supportsMusicAmplitude?: boolean
  /** Answer 0x18/0x19 for the receiver RGB bar (default: true for dongle type bytes, false for wired). */
  supportsDongleBar?: boolean
}

export class CompxMouseFirmware {
  readonly flash = new Uint8Array(FLASH_SIZE).fill(0xff)
  readonly model: MouseModel
  typeByte: number
  online: boolean
  profile = 0
  battery = { level: 80, charging: false, voltageMv: 3900 }
  firmware = { major: 1, minor: 0x02 }
  dongleFirmware = { major: 2, minor: 0x05 }
  longRange = false
  supportsLongRange: boolean
  pairState: 1 | 2 | 3 = 3
  readonly log: string[] = []
  // Music sync (docs/reverse-engineering/mouse/01-transport-commands.md §11): unsupported commands echo with status 1.
  supportsMusicAmplitude: boolean
  supportsDongleBar: boolean
  /** Every accepted 0xB6 frame, unpacked to its 20 levels. */
  readonly amplitudes: number[][] = []
  /** Last accepted 0xB2 payload `[mode, speed, brightness, colourMode, fwd RGB, back RGB]`. */
  musicParams: number[] | undefined
  /** Last accepted 0xB7 `[lightState, macroState]`. */
  customLightState: number[] | undefined
  /** Receiver bar `[mode, r, g, b, speed, brightness, time]`: 0x18 replaces it, 0x19 reports it at reply `[5..11]`. */
  dongleBar: number[] = [1, 0, 0, 255, 5, 9, 0]
  /** `WriteFlashData` frames accepted (settings-memory wear). */
  flashWrites = 0

  constructor(options: CompxSimOptions = {}) {
    this.model = options.model ?? MODELS[2]!
    this.typeByte = options.typeByte ?? 2
    this.online = options.online ?? true
    const wired = this.typeByte === 2 || this.typeByte === 3
    this.supportsLongRange = !wired
    this.supportsMusicAmplitude = options.supportsMusicAmplitude ?? false
    this.supportsDongleBar = options.supportsDongleBar ?? !wired
    this.loadDefaults()
  }

  loadDefaults(): void {
    const f = this.flash
    const m = this.model
    f.fill(0xff)
    writeValue(f, Addr.ReportRate, reportRateToByte(m.reportRate))
    writeValue(f, Addr.MaxDpiStage, m.dpiStages.length)
    writeValue(f, Addr.CurrentDpi, m.currentStage)
    writeValue(f, Addr.KeyOperation, 0)
    writeValue(f, Addr.Lod, 1)
    for (let i = 0; i < 8; i++) {
      const stage = m.dpiStages[i] ?? m.dpiStages[m.dpiStages.length - 1]!
      f.set(encodeDpiStage(m.sensor, stage.dpi), Addr.DpiValue + i * 4)
      f.set(encodeDpiColor(stage.color), Addr.DpiColor + i * 4)
    }
    writeValue(f, Addr.DpiEffectMode, 1)
    writeValue(f, Addr.DpiEffectBrightness, 0x80)
    writeValue(f, Addr.DpiEffectSpeed, 3)
    writeValue(f, Addr.DpiEffectState, 0)
    for (let slot = 0; slot < 16; slot++) f.set(encodeKeySlot(m.sensor, slot, { type: 'disabled' }), Addr.KeyFunction + slot * 4)
    for (const k of m.keys) f.set(encodeKeySlot(m.sensor, k.slot, k.defaultFn), Addr.KeyFunction + k.slot * 4)
    f.set(encodeLightBlock({ mode: m.lightDefault.mode || 1, color: { r: 255, g: 0, b: 0 }, speed: m.lightDefault.speed, brightness: m.lightDefault.brightness }), Addr.Light)
    writeValue(f, Addr.LightState, m.lightDefault.mode ? 1 : 0)
    writeValue(f, Addr.DebounceTime, m.debounce.default)
    writeValue(f, Addr.MotionSync, 1)
    writeValue(f, Addr.SleepTime, m.sleepDefault)
    writeValue(f, Addr.Angle, 0)
    writeValue(f, Addr.Ripple, 0)
    writeValue(f, Addr.MovingOffLight, m.lightDefault.movingOff ? 1 : 0)
    writeValue(f, Addr.PerformanceState, 0)
    writeValue(f, Addr.PerformanceTime, 6)
    writeValue(f, Addr.SensorMode, 0)
    writeValue(f, Addr.VirtualCenter, 0)
    writeValue(f, Addr.VirtualCenterLocation, 100)
  }

  attach(device: FakeHidDevice): this {
    device.respond = (reportId, data) => (reportId === REPORT_ID ? this.handle(data) : [])
    return this
  }

  /** Echo of the request with `set` applied at absolute offsets, checksum recomputed. */
  private echo(req: Uint8Array, set: Record<number, number> = {}, status = 0): Uint8Array {
    const r = Uint8Array.from(req)
    r[1] = status
    for (const [i, v] of Object.entries(set)) r[Number(i)] = v & 0xff
    r[15] = frameChecksum(r)
    return r
  }

  handle(data: Uint8Array): Uint8Array[] {
    if (data.length !== FRAME_SIZE) return []
    const f = parseFrame(data)
    this.log.push(f.command.toString(16).padStart(2, '0'))
    switch (f.command) {
      case Command.EncryptionData:
        return [this.echo(data, { 9: this.model.cid, 10: this.model.mid, 11: this.typeByte })]
      case Command.PCDriverStatus:
        return [this.echo(data)]
      case Command.DeviceOnLine:
        return [this.echo(data, { 5: this.online ? 1 : 0, 6: 0xaa, 7: 0xbb, 8: 0xcc })]
      case Command.BatteryLevel:
        return [this.echo(data, { 5: this.battery.level, 6: this.battery.charging ? 1 : 0, 7: this.battery.voltageMv >> 8, 8: this.battery.voltageMv & 0xff })]
      case Command.DongleEnterPair:
        this.pairState = 1
        return [this.echo(data)]
      case Command.GetPairState:
        return [this.echo(data, { 5: this.pairState, 6: 12 })]
      case Command.WriteFlashData: {
        this.flash.set(f.payload, f.address)
        this.flashWrites++
        return [this.echo(data)]
      }
      case Command.ReadFlashData: {
        const set: Record<number, number> = {}
        for (let i = 0; i < f.length; i++) set[5 + i] = this.flash[f.address + i]!
        return [this.echo(data, set)]
      }
      case Command.ClearSetting:
        this.loadDefaults()
        return [this.echo(data)]
      case Command.GetCurrentConfig:
        return [this.echo(data, { 5: this.profile })]
      case Command.SetCurrentConfig:
        this.profile = f.payload[0] ?? 0
        return [this.echo(data)]
      case Command.ReadVersionID:
        return [this.echo(data, { 5: this.firmware.major, 6: this.firmware.minor })]
      case Command.GetDongleVersion:
        return [this.echo(data, { 5: this.dongleFirmware.major, 6: this.dongleFirmware.minor })]
      case Command.SetLongRangeMode:
        this.longRange = f.payload[0] === 1
        return [this.echo(data, {}, this.supportsLongRange ? 0 : 1)]
      case Command.GetLongRangeMode:
        return [this.echo(data, { 5: this.longRange ? 1 : 0 }, this.supportsLongRange ? 0 : 1)]
      case Command.GetMotorParam:
        return [this.echo(data, { 5: 0 })]
      case Command.SetDongleRGBBarMode:
        if (this.supportsDongleBar) this.dongleBar = Array.from(f.payload.subarray(0, 7))
        return [this.echo(data, {}, this.supportsDongleBar ? 0 : 1)]
      case Command.GetDongleRGBBarMode: {
        if (!this.supportsDongleBar) return [this.echo(data, {}, 1)]
        const set: Record<number, number> = {}
        this.dongleBar.forEach((v, i) => (set[5 + i] = v))
        return [this.echo(data, set)]
      }
      case MusicCommand.OfficeMusicParameter:
        if (this.supportsMusicAmplitude) this.musicParams = Array.from(f.payload)
        return [this.echo(data, {}, this.supportsMusicAmplitude ? 0 : 1)]
      case MusicCommand.OfficeMusicAmplitude:
        if (this.supportsMusicAmplitude) this.amplitudes.push(unpackAmplitudes(f.payload))
        return [this.echo(data, {}, this.supportsMusicAmplitude ? 0 : 1)]
      case MusicCommand.OfficeCustomLightState:
        if (this.supportsMusicAmplitude) this.customLightState = [f.payload[0] ?? 0, f.payload[1] ?? 0]
        return [this.echo(data, {}, this.supportsMusicAmplitude ? 0 : 1)]
      default:
        return [this.echo(data)]
    }
  }

  /** Emits an unsolicited `StatusChanged` report with the given flag bytes. */
  static statusChanged(device: FakeHidDevice, flags5: number, flags6 = 0): void {
    const r = new Uint8Array(FRAME_SIZE)
    r[0] = Command.StatusChanged
    r[5] = flags5
    r[6] = flags6
    r[15] = frameChecksum(r)
    device.dispatchInputReport(r, REPORT_ID)
  }
}
