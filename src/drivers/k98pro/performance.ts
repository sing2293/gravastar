/**
 * Hall-effect performance service: switch type, safe area, actuation travel, rapid trigger, live travel monitor,
 * calibration and ADC ranges. Verified against vendor class `Ua` (deob 2245–2376).
 * Doc: docs/reverse-engineering/k98pro/04-performance-advanced-keys.md §3.
 */
import { readU16be, u16be } from '@/hid/core/bytes'
import type { NumericRange } from '@/model/device'
import type { AdcRange, KeyId, KeySwitchType, KeyTravel, LayerSelector, PerformanceCapabilities, PerformanceService, RapidTrigger, SafeArea } from '@/model/keyboard'
import { alignedChunk, buildPackets, decodePayload } from './codec'
import type { K98Config } from './config'
import { Cmd } from './enums'
import { selectorParam } from './keymap'
import type { K98Link } from './transport'

/** Travel values are 0.001 mm per unit (inferred from the vendor's vestigial tooltip math; UNVERIFIED). */
export const TRAVEL_UNIT_MM = 0.001
export const TRAVEL_RANGE: NumericRange = { min: 100, max: 4000, step: 10, unit: '0.001 mm' }
export const MONITOR_MAX_KEYS = 9
const KEEPALIVE_MS = 1000

const enum Monitor {
  Start = 0,
  Read = 1,
  Stop = 2,
}

const enum Calibration {
  Start = 0,
  Push = 2,
  Stop = 4,
  AdRange = 5,
}

export class K98Performance implements PerformanceService {
  private monitorTimer: ReturnType<typeof setInterval> | undefined
  private calibrationTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly link: K98Link,
    private readonly config: K98Config,
  ) {}

  private get reportId(): number {
    return this.link.reportId
  }

  async capabilities(): Promise<PerformanceCapabilities> {
    const [switches, minRt] = await Promise.all([this.config.getSupportedSwitches(), this.config.getMinRapidTrigger()])
    const features = await this.config.features()
    return {
      experimental: true,
      travelUnitMm: TRAVEL_UNIT_MM,
      travel: TRAVEL_RANGE,
      rapidTrigger: { min: Math.max(minRt, 1), max: TRAVEL_RANGE.max, step: 10, unit: '0.001 mm' },
      supportedSwitchTypes: switches,
      twoStageTrigger: features.twoStageTrigger,
    }
  }

  async getSwitchTypes(ids: KeyId[]): Promise<KeySwitchType[]> {
    if (!ids.length) return []
    const data = await this.read(Cmd.GetSwitchType, 0, ids, alignedChunk(2, 3))
    const out: KeySwitchType[] = []
    for (let i = 0; i + 2 < data.length; i += 3) out.push({ id: readU16be(data, i), switchType: data[i + 2]! })
    return out
  }

  async setSwitchTypes(types: KeySwitchType[]): Promise<void> {
    if (!types.length) return
    const payload = types.flatMap((t) => [...u16be(t.id), t.switchType & 0xff])
    await this.link.request(buildPackets(Cmd.SetSwitchType, 0, payload, this.reportId, alignedChunk(3)))
  }

  async getSafeAreas(ids: KeyId[]): Promise<SafeArea[]> {
    if (!ids.length) return []
    const data = await this.read(Cmd.GetSafeArea, 0, ids, alignedChunk(2, 8))
    const out: SafeArea[] = []
    for (let i = 0; i + 7 < data.length; i += 8) out.push({ id: readU16be(data, i), top: readU16be(data, i + 2), bottom: readU16be(data, i + 4), enabled: data[i + 7] !== 0 })
    return out
  }

  async setSafeAreas(areas: SafeArea[]): Promise<void> {
    if (!areas.length) return
    const payload = areas.flatMap((a) => [...u16be(a.id), ...u16be(a.top), ...u16be(a.bottom), 0, a.enabled ? 1 : 0])
    await this.link.request(buildPackets(Cmd.SetSafeArea, 0, payload, this.reportId, alignedChunk(8)))
  }

  async getTravel(sel: LayerSelector, ids: KeyId[]): Promise<KeyTravel[]> {
    if (!ids.length) return []
    const data = await this.read(Cmd.GetKeyTravel, selectorParam(sel), ids, alignedChunk(2, 5))
    const out: KeyTravel[] = []
    for (let i = 0; i + 4 < data.length; i += 5) out.push({ id: readU16be(data, i), actuation: readU16be(data, i + 2) })
    return out
  }

  async setTravel(sel: LayerSelector, travels: KeyTravel[]): Promise<void> {
    if (!travels.length) return
    const payload = travels.flatMap((t) => [...u16be(t.id), ...u16be(t.actuation), 0])
    await this.link.request(buildPackets(Cmd.SetKeyTravel, selectorParam(sel), payload, this.reportId, alignedChunk(5)))
  }

  async getRapidTriggers(sel: LayerSelector, ids: KeyId[]): Promise<RapidTrigger[]> {
    if (!ids.length) return []
    const data = await this.read(Cmd.GetRapidTrigger, selectorParam(sel), ids, alignedChunk(2, 8))
    const out: RapidTrigger[] = []
    for (let i = 0; i + 7 < data.length; i += 8) out.push({ id: readU16be(data, i), enabled: data[i + 2] === 1, press: readU16be(data, i + 3), release: readU16be(data, i + 5) })
    return out
  }

  async setRapidTriggers(sel: LayerSelector, triggers: RapidTrigger[]): Promise<void> {
    if (!triggers.length) return
    const payload = triggers.flatMap((t) => [...u16be(t.id), t.enabled ? 1 : 0, ...u16be(t.press), ...u16be(t.release), 0])
    await this.link.request(buildPackets(Cmd.SetRapidTrigger, selectorParam(sel), payload, this.reportId, alignedChunk(8)))
  }

  async getAdcRanges(ids: KeyId[]): Promise<AdcRange[]> {
    if (!ids.length) return []
    const data = await this.read(Cmd.Calibration, Calibration.AdRange, ids, alignedChunk(2, 6))
    const out: AdcRange[] = []
    for (let i = 0; i + 5 < data.length; i += 6) out.push({ id: readU16be(data, i), max: readU16be(data, i + 2), min: readU16be(data, i + 4) })
    return out
  }

  /**
   * `0x98/Start` immediately and every second as a keep-alive; the device then pushes `0x98/Read` packets (see
   * `bubbles.ts`). With `ids`, at most 9 keys are selected; extra ids are dropped like the vendor does.
   */
  async startMonitoring(ids?: KeyId[]): Promise<void> {
    await this.stopTimers('monitor')
    const send = () => this.link.request(buildPackets(Cmd.KeyTravelMonitor, Monitor.Start, [], this.reportId)).catch(() => undefined)
    this.monitorTimer = setInterval(send, KEEPALIVE_MS)
    await this.link.request(buildPackets(Cmd.KeyTravelMonitor, Monitor.Start, [], this.reportId))
    if (ids?.length) {
      const selected = ids.slice(0, MONITOR_MAX_KEYS)
      await this.link.request(buildPackets(Cmd.KeyTravelMonitor, Monitor.Start, selected.flatMap((id) => u16be(id)), this.reportId, alignedChunk(6)))
    }
  }

  async stopMonitoring(): Promise<void> {
    await this.stopTimers('monitor')
    await this.link.request(buildPackets(Cmd.KeyTravelMonitor, Monitor.Stop, [], this.reportId))
  }

  async startCalibration(): Promise<void> {
    await this.stopTimers('calibration')
    const send = () => this.link.request(buildPackets(Cmd.Calibration, Calibration.Start, [], this.reportId)).catch(() => undefined)
    this.calibrationTimer = setInterval(send, KEEPALIVE_MS)
    await this.link.request(buildPackets(Cmd.Calibration, Calibration.Start, [], this.reportId))
  }

  async stopCalibration(): Promise<void> {
    await this.stopTimers('calibration')
    await this.link.request(buildPackets(Cmd.Calibration, Calibration.Stop, [], this.reportId))
  }

  destroy(): void {
    void this.stopTimers('monitor')
    void this.stopTimers('calibration')
  }

  private async stopTimers(which: 'monitor' | 'calibration'): Promise<void> {
    if (which === 'monitor' && this.monitorTimer) {
      clearInterval(this.monitorTimer)
      this.monitorTimer = undefined
    }
    if (which === 'calibration' && this.calibrationTimer) {
      clearInterval(this.calibrationTimer)
      this.calibrationTimer = undefined
    }
  }

  private async read(cmd: number, param: number, ids: KeyId[], chunk: number): Promise<Uint8Array> {
    const packets = buildPackets(cmd, param, ids.flatMap((id) => u16be(id)), this.reportId, chunk)
    return decodePayload(await this.link.request(packets))
  }
}
