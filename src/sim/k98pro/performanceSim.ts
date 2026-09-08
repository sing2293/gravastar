import { readU16be, u16be } from '@/hid/core/bytes'
import { decodeLayerAndSystem, decodePayload } from '@/drivers/k98pro/codec'
import { AdvancedKeyWire, Cmd } from '@/drivers/k98pro/enums'
import type { K98ProFirmware } from './firmware'

/** Per-key performance tables and advanced-key records for the simulated firmware. */
export class PerformanceSimState {
  readonly switchTypes = new Map<number, number>()
  readonly safeAreas = new Map<number, number[]>() // id → [top hi, lo, bottom hi, lo, 0, enable]
  readonly travel = new Map<string, number>() // `${layer}-${system}-${id}` → travel
  readonly rapidTrigger = new Map<string, number[]>() // → [enable, pressHi, pressLo, relHi, relLo, 0]
  readonly adcRanges = new Map<number, { min: number; max: number }>()
  /** `${layer}-${system}` → Map(id → {type, payload}) */
  readonly advanced = new Map<string, Map<number, { type: number; payload: number[] }>>()
  monitoring = false
  calibrating = false

  key(layer: number, system: number, id: number | string): string {
    return `${layer}-${system}-${id}`
  }

  advancedTable(layer: number, system: number): Map<number, { type: number; payload: number[] }> {
    const k = `${layer}-${system}`
    let t = this.advanced.get(k)
    if (!t) this.advanced.set(k, (t = new Map()))
    return t
  }
}

export function installPerformanceSim(fw: K98ProFirmware, state = new PerformanceSimState()): PerformanceSimState {
  fw.extensions.push((p, raw) => {
    const { layer, system } = decodeLayerAndSystem(p.param)
    const data = decodePayload(raw)
    const ids = (): number[] => {
      const out: number[] = []
      for (let i = 0; i + 1 < data.length; i += 2) out.push(readU16be(data, i))
      return out
    }
    switch (p.commandId) {
      case Cmd.SetSwitchType:
        for (let i = 0; i + 2 < data.length; i += 3) state.switchTypes.set(readU16be(data, i), data[i + 2]!)
        return [fw.reply(raw)]
      case Cmd.GetSwitchType:
        return [fw.reply(raw, ids().flatMap((id) => [...u16be(id), state.switchTypes.get(id) ?? 0]))]
      case Cmd.SetSafeArea:
        for (let i = 0; i + 7 < data.length; i += 8) state.safeAreas.set(readU16be(data, i), Array.from(data.subarray(i + 2, i + 8)))
        return [fw.reply(raw)]
      case Cmd.GetSafeArea:
        return [fw.reply(raw, ids().flatMap((id) => [...u16be(id), ...(state.safeAreas.get(id) ?? [0, 0, 0, 0, 0, 0])]))]
      case Cmd.SetKeyTravel:
        for (let i = 0; i + 4 < data.length; i += 5) state.travel.set(state.key(layer, system, readU16be(data, i)), readU16be(data, i + 2))
        return [fw.reply(raw)]
      case Cmd.GetKeyTravel:
        return [fw.reply(raw, ids().flatMap((id) => [...u16be(id), ...u16be(state.travel.get(state.key(layer, system, id)) ?? 2000), 0]))]
      case Cmd.SetRapidTrigger:
        for (let i = 0; i + 7 < data.length; i += 8) state.rapidTrigger.set(state.key(layer, system, readU16be(data, i)), Array.from(data.subarray(i + 2, i + 8)))
        return [fw.reply(raw)]
      case Cmd.GetRapidTrigger:
        return [fw.reply(raw, ids().flatMap((id) => [...u16be(id), ...(state.rapidTrigger.get(state.key(layer, system, id)) ?? [0, 0, 0, 0, 0, 0])]))]
      case Cmd.KeyTravelMonitor:
        state.monitoring = p.param !== 2
        return [fw.reply(raw)]
      case Cmd.Calibration:
        if (p.param === 5) return [fw.reply(raw, ids().flatMap((id) => {
          const r = state.adcRanges.get(id) ?? { min: 100, max: 3000 }
          return [...u16be(id), ...u16be(r.max), ...u16be(r.min)]
        }))]
        state.calibrating = p.param === 0
        return [fw.reply(raw)]
      case Cmd.SetAdvancedKey: {
        const table = state.advancedTable(layer, system)
        const type = raw[2]!
        if (type === AdvancedKeyWire.None) {
          table.delete(readU16be(data, 0))
        } else if (type === AdvancedKeyWire.SOCD) {
          const count = data[0]!
          for (let i = 0; i < count; i++) table.set(readU16be(data, 1 + 2 * i), { type, payload: Array.from(data) })
        } else if (type === AdvancedKeyWire.RS) {
          table.set(readU16be(data, 0), { type, payload: Array.from(data) })
          table.set(readU16be(data, 2), { type, payload: Array.from(data) })
        } else {
          table.set(readU16be(data, 0), { type, payload: Array.from(data) })
        }
        return [fw.reply(raw)]
      }
      case Cmd.GetAdvancedKey: {
        const table = state.advancedTable(layer, system)
        if (p.length === 0) {
          // id listing (single page in the simulator)
          return [fw.reply(raw, [...table.keys()].flatMap((id) => u16be(id)))]
        }
        const rec = table.get(readU16be(data, 0))
        return [fw.reply(raw, rec?.payload ?? [], rec?.type ?? AdvancedKeyWire.None)]
      }
      default:
        return undefined
    }
  })
  return state
}
