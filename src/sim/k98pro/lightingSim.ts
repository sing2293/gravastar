import { readU16be, u16be } from '@/hid/core/bytes'
import { PAYLOAD_MAX, decodePayload } from '@/drivers/k98pro/codec'
import { Cmd, Info, Setting } from '@/drivers/k98pro/enums'
import type { K98ProFirmware } from './firmware'

export class LightingSimState {
  /** Setting index (1/6/11) → 7-byte effect record. */
  readonly zones = new Map<number, number[]>([
    [Setting.MainEffect, [3, 7, 0, 0, 0, 20, 2]],
    [Setting.SideEffect, [1, 7, 0, 0, 0, 4, 2]],
    [Setting.LogoEffect, [0, 0, 0, 0, 0, 0, 0]],
  ])
  readonly customColors = new Map<number, [number, number, number]>()
  /** Every streamed `0x08` payload, for tests. */
  readonly streamed: { sub: number; data: number[] }[] = []
  /** LED-bead table (`0xA1`): every key owns one bead except the wide keys listed here (key id → LED count). */
  beadsSupported = true
  wideKeys: Record<number, number> = { 70: 3, 27: 2, 54: 2, 55: 2, 66: 2 } // Space ×3; Backspace, Enter, both Shifts ×2
  beads(id: number): { row: number; col: number }[] {
    const n = this.wideKeys[id] ?? 1
    const base = (id - 1) * 3
    return Array.from({ length: n }, (_, k) => ({ row: Math.floor((base + k) / 32) & 7, col: (base + k) % 32 }))
  }
  sideLight = true
  logoLight = false
  sideLightCount = 2
  /** Macro storage image (little-endian header table + bodies), initially empty. */
  macroImage = new Uint8Array(0)
}

export function installLightingSim(fw: K98ProFirmware, state = new LightingSimState()): LightingSimState {
  if (state.beadsSupported) fw.featureBytes[9] = fw.featureBytes[9]! | 0b11100 // ledBeadTable565 + ledBeadRGB565
  fw.extensions.push((p, raw) => {
    const data = decodePayload(raw)
    switch (p.commandId) {
      case Cmd.GetLedBeads: {
        if (!state.beadsSupported) return [fw.reply(raw, Array.from(data))] // firmware without a table echoes the request
        const out: number[] = []
        for (let i = 0; i + 1 < data.length; i += 2) {
          const id = readU16be(data, i)
          const beads = state.beads(id)
          out.push(...u16be(id), beads.length, ...beads.map((b) => (b.row & 7) | ((b.col & 31) << 3)))
        }
        return [fw.reply(raw, out)]
      }
      case Cmd.DeviceInfo:
        if (p.param !== Info.LightingSupport) return undefined
        {
          const a = new Array<number>(56).fill(0)
          a[17] = 0b011
          a[18] = state.sideLight ? 1 : 0
          a[19] = state.logoLight ? 1 : 0
          a[20] = state.sideLightCount
          return [fw.reply(raw, a)]
        }
      case Cmd.ReadSetting:
        return state.zones.has(p.param) ? [fw.reply(raw, state.zones.get(p.param)!)] : undefined
      case Cmd.WriteSetting: {
        if (state.zones.has(p.param)) {
          state.zones.set(p.param, Array.from(data))
          return [fw.reply(raw)]
        }
        const idParams = [Setting.MainEffectId, Setting.SideEffectId, Setting.LogoEffectId] as number[]
        const idx = idParams.indexOf(p.param)
        if (idx < 0) return undefined
        const rec = state.zones.get([Setting.MainEffect, Setting.SideEffect, Setting.LogoEffect][idx]!)!
        rec[0] = data[0] ?? 0
        return [fw.reply(raw)]
      }
      case Cmd.GetCustomColors: {
        const out: number[] = []
        for (let i = 0; i + 1 < data.length; i += 2) {
          const id = readU16be(data, i)
          out.push(...u16be(id), ...(state.customColors.get(id) ?? [0, 0, 0]))
        }
        return [fw.reply(raw, out)]
      }
      case Cmd.SetCustomColors:
        for (let i = 0; i + 4 < data.length; i += 5) state.customColors.set(readU16be(data, i), [data[i + 2]!, data[i + 3]!, data[i + 4]!])
        return [fw.reply(raw)]
      case Cmd.StreamRGB:
        state.streamed.push({ sub: p.param, data: Array.from(data) })
        return [] // fire-and-forget: the firmware does not answer
      case Cmd.ReadMacros: {
        const offset = (raw[1]! << 8) | raw[2]!
        const want = raw[5]!
        return [fw.reply(raw, Array.from(state.macroImage.subarray(offset, offset + want)).concat(new Array(Math.max(0, want - Math.max(0, state.macroImage.length - offset))).fill(0xff)).slice(0, want))]
      }
      case Cmd.WriteMacros: {
        if (p.index === 0) state.macroImage = new Uint8Array(p.total * PAYLOAD_MAX)
        state.macroImage.set(data, p.index * PAYLOAD_MAX)
        if (p.index === p.total - 1) state.macroImage = state.macroImage.subarray(0, (p.total - 1) * PAYLOAD_MAX + p.length)
        return [fw.reply(raw)]
      }
      default:
        return undefined
    }
  })
  return state
}
