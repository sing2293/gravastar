import { decodePayload } from '@/drivers/k98pro/codec'
import { Cmd, Info } from '@/drivers/k98pro/enums'
import type { K98ProFirmware } from './firmware'

export class DisplaySimState {
  lcd = true
  led = false
  profile: Record<string, unknown> = { displaySize: { w: 428, h: 142 }, name: 'K98 Pro LCD' }
  /** Transfer control bytes seen (`[status<<6|kind, ...extra]`). */
  readonly transfers: number[][] = []
  /** Reassembled pixel payload of the last upload (header + gif). */
  received = new Uint8Array(0)
  time: number[] | undefined
  chunks = new Map<number, Uint8Array>()
}

export function installDisplaySim(fw: K98ProFirmware, state = new DisplaySimState()): DisplaySimState {
  const profileJson = () => new TextEncoder().encode(JSON.stringify(state.profile))
  fw.extensions.push((p, raw) => {
    const data = decodePayload(raw)
    switch (p.commandId) {
      case Cmd.DeviceInfo:
        return p.param === Info.DisplaySupport ? [fw.reply(raw, [(state.lcd ? 1 : 0) | (state.led ? 2 : 0)])] : undefined
      case Cmd.LcdRead:
      case Cmd.LedRead: {
        if (p.param === 0x05) {
          const json = profileJson()
          if (p.length === 0) return [fw.reply(raw, [(json.length >>> 24) & 0xff, (json.length >> 16) & 0xff, (json.length >> 8) & 0xff, json.length & 0xff])]
          return [fw.reply(raw, Array.from(json.subarray(p.index * 56, p.index * 56 + p.length)))]
        }
        if (p.param === 0x06) {
          state.transfers.push(Array.from(data))
          return [fw.reply(raw, [0, 0, 0, 0])]
        }
        return undefined
      }
      case Cmd.LcdTransfer:
      case Cmd.LedTransfer:
        if (p.param !== 0x06) return undefined
        state.transfers.push(Array.from(data))
        if ((data[0]! >> 6) === 1) state.chunks = new Map()
        return [fw.reply(raw, [0, 0, 0, 0])]
      case Cmd.LcdPixelsWrite:
      case Cmd.LedPixelsWrite: {
        const total = (raw[1]! << 8) | raw[2]!
        const index = (raw[3]! << 8) | raw[4]!
        state.chunks.set(index, Uint8Array.from(data))
        if (state.chunks.size === total) {
          const parts = [...state.chunks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])
          const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0))
          let o = 0
          for (const c of parts) {
            out.set(c, o)
            o += c.length
          }
          state.received = out
        }
        return [] // pixel packets are fire-and-forget
      }
      case Cmd.SetTime:
        state.time = Array.from(data)
        return [fw.reply(raw)]
      default:
        return undefined
    }
  })
  return state
}
