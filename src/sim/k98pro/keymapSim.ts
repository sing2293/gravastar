import { readU16be } from '@/hid/core/bytes'
import { decodeLayerAndSystem, decodePayload } from '@/drivers/k98pro/codec'
import { Cmd, ResetType } from '@/drivers/k98pro/enums'
import { readU32be, u32be } from '@/drivers/k98pro/keymap'
import type { K98ProFirmware } from './firmware'

/** Keymap tables (layer × system × key id → keycode) and onboard profiles for the simulated firmware. */
export class KeymapSimState {
  /** `layer-system-id` → keycode; absent = factory default. */
  readonly bindings = new Map<string, number>()
  profile = 0
  readonly profileNames = ['', '', '']

  constructor(private readonly defaults: ReadonlyMap<number, number> = new Map()) {}

  key(layer: number, system: number, id: number): string {
    return `${layer}-${system}-${id}`
  }

  get(layer: number, system: number, id: number): number {
    return this.bindings.get(this.key(layer, system, id)) ?? this.defaults.get(id) ?? 0
  }
}

export function installKeymapSim(fw: K98ProFirmware, state = new KeymapSimState()): KeymapSimState {
  fw.extensions.push((p, raw) => {
    const { layer, system } = decodeLayerAndSystem(p.param)
    switch (p.commandId) {
      case Cmd.SetKeymap: {
        const data = decodePayload(raw)
        for (let i = 0; i + 5 < data.length; i += 6) state.bindings.set(state.key(layer, system, readU16be(data, i)), readU32be(data, i + 2))
        return [fw.reply(raw)]
      }
      case Cmd.GetKeymap: {
        const ids = decodePayload(raw)
        const out: number[] = []
        for (let i = 0; i + 1 < ids.length; i += 2) {
          const id = readU16be(ids, i)
          out.push(ids[i]!, ids[i + 1]!, ...u32be(state.get(layer, system, id)))
        }
        return [fw.reply(raw, out)]
      }
      case Cmd.Reset: {
        if (decodePayload(raw)[0] !== ResetType.Keymap) return undefined
        for (const k of [...state.bindings.keys()]) if (k.startsWith(`${layer}-${system}-`)) state.bindings.delete(k)
        return [fw.reply(raw)]
      }
      case Cmd.GetProfile:
        return [fw.reply(raw, [state.profile])]
      case Cmd.SetProfile:
        state.profile = decodePayload(raw)[0] ?? 0
        return [fw.reply(raw)]
      case Cmd.GetProfileName: {
        const name = new TextEncoder().encode(state.profileNames[p.param] ?? '')
        return [fw.reply(raw, name.length ? [name.length, ...name] : [0])]
      }
      case Cmd.SetProfileName: {
        const data = decodePayload(raw)
        state.profileNames[p.param] = new TextDecoder().decode(data.subarray(1, 1 + (data[0] ?? 0)))
        return [fw.reply(raw)]
      }
      default:
        return undefined
    }
  })
  return state
}
