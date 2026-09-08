/**
 * Macro storage service. Verified against vendor class `Oa` (deob 1826–1972) and `buildMacroCommands` (879–884).
 * Doc: docs/reverse-engineering/k98pro/05-lighting-macros.md §11.
 *
 * Storage image:  [N × (offset u16 LE, length u16 LE)]  then bodies  [nameLen, name…, actions × 4 bytes]
 * Action:         b0 = state<<7 | type<<4 | delay[19..16],  b1 = delay[15..8],  b2 = delay[7..0],  b3 = value
 */
import type { Macro, MacroAction, MacroCapabilities, MacroService } from '@/model/keyboard'
import { PAYLOAD_MAX, buildPackets, decodePayload, withChecksum } from './codec'
import { Cmd, Info } from './enums'
import type { K98Link } from './transport'

export const MACRO_MAX_DELAY_MS = 0xfffff
export const MACRO_MAX_COUNT = 16
export const MACRO_MAX_NAME_BYTES = 255

const enum ActionType {
  Key = 0,
  Modifier = 1,
  Mouse = 2,
}

const KIND_TO_TYPE: Record<MacroAction['kind'], ActionType> = { key: ActionType.Key, modifier: ActionType.Modifier, mouse: ActionType.Mouse }
const TYPE_TO_KIND: Record<number, MacroAction['kind']> = { 0: 'key', 1: 'modifier', 2: 'mouse' }

/** Mouse button masks used inside macro actions (`Cr`). */
export const MACRO_MOUSE_BUTTONS = { left: 1, right: 2, middle: 4, back: 8, forward: 16 } as const

export function encodeAction(a: MacroAction): number[] {
  const delay = Math.min(Math.max(Math.floor(a.delayMs), 0), MACRO_MAX_DELAY_MS)
  const b0 = ((a.state === 'up' ? 1 : 0) << 7) | ((KIND_TO_TYPE[a.kind] & 7) << 4) | ((delay >> 16) & 0x0f)
  return [b0, (delay >> 8) & 0xff, delay & 0xff, a.code & 0xff]
}

export function decodeAction(b: ArrayLike<number>, i: number): MacroAction {
  const b0 = b[i]!
  return {
    state: (b0 >> 7) & 1 ? 'up' : 'down',
    kind: TYPE_TO_KIND[(b0 >> 4) & 7] ?? 'key',
    delayMs: ((b0 & 0x0f) << 16) | (b[i + 1]! << 8) | b[i + 2]!,
    code: b[i + 3]!,
  }
}

export function encodeMacroBody(m: Macro): number[] {
  const name = new TextEncoder().encode(m.name)
  if (name.length > MACRO_MAX_NAME_BYTES) throw new Error(`Macro name "${m.name}" is too long. Maximum length is ${MACRO_MAX_NAME_BYTES} bytes.`)
  return [name.length, ...name, ...m.actions.flatMap(encodeAction)]
}

/** Whole storage image: header table followed by the bodies. */
export function encodeMacroImage(macros: Macro[]): Uint8Array {
  const bodies = macros.map(encodeMacroBody)
  const header: number[] = []
  let offset = bodies.length * 4
  for (const body of bodies) {
    header.push(offset & 0xff, (offset >> 8) & 0xff, body.length & 0xff, (body.length >> 8) & 0xff)
    offset += body.length
  }
  return Uint8Array.from([...header, ...bodies.flat()])
}

export function decodeMacroImage(image: Uint8Array): Macro[] {
  if (!image.length) return []
  const headerLen = image[0]! // vendor reads only the low byte of the first offset
  const headers: { offset: number; length: number }[] = []
  for (let i = 0; i + 3 < headerLen; i += 4) headers.push({ offset: image[i]! | (image[i + 1]! << 8), length: image[i + 2]! | (image[i + 3]! << 8) })
  return headers.map(({ offset, length }) => {
    const body = image.subarray(offset, offset + length)
    const nameLen = body[0] ?? 0
    const name = new TextDecoder().decode(body.subarray(1, 1 + nameLen))
    const actions: MacroAction[] = []
    for (let i = 1 + nameLen; i + 3 < body.length; i += 4) actions.push(decodeAction(body, i))
    return { name, actions }
  })
}

export function macroStorageSize(macros: Macro[]): number {
  return macros.reduce((n, m) => n + 4 + 1 + new TextEncoder().encode(m.name).length + 4 * m.actions.length, 0)
}

export class K98Macros implements MacroService {
  constructor(private readonly link: K98Link) {}

  private get reportId(): number {
    return this.link.reportId
  }

  async maxStorageBytes(): Promise<number> {
    const d = decodePayload(await this.link.request(buildPackets(Cmd.DeviceInfo, Info.MacroStorageSize, [], this.reportId)), 4)
    return ((d[0]! << 24) | (d[1]! << 16) | (d[2]! << 8) | d[3]!) >>> 0
  }

  async capabilities(): Promise<MacroCapabilities> {
    return { maxStorageBytes: await this.maxStorageBytes(), maxCount: MACRO_MAX_COUNT, maxNameBytes: MACRO_MAX_NAME_BYTES, maxDelayMs: MACRO_MAX_DELAY_MS }
  }

  /**
   * `0x85` reads `count` bytes of macro storage from offset 0. Each packet carries its byte offset (`index × 56`)
   * in header bytes 1–2 (the vendor's `buildMacroCommands`), replacing the param byte.
   */
  async readStorage(count: number): Promise<Uint8Array> {
    if (count <= 0) return new Uint8Array(0)
    const packets = buildPackets(Cmd.ReadMacros, 0, new Array<number>(count).fill(0), this.reportId)
    packets.forEach((p, i) => {
      const offset = i * PAYLOAD_MAX
      p[1] = (offset >> 8) & 0xff
      p[2] = offset & 0xff
      withChecksum(p, this.reportId)
    })
    return decodePayload(await this.link.request(packets)).subarray(0, count)
  }

  async list(): Promise<Macro[]> {
    const head = await this.readStorage(2)
    if (head.length < 2 || (head[0] === 0xff && head[1] === 0xff)) return []
    const headerLen = head[0]! | (head[1]! << 8)
    if (headerLen === 0 || headerLen % 4 !== 0) return []
    const table = await this.readStorage(headerLen)
    const last = headerLen - 4
    const end = (table[last]! | (table[last + 1]! << 8)) + (table[last + 2]! | (table[last + 3]! << 8))
    return decodeMacroImage(await this.readStorage(end))
  }

  async save(macros: Macro[]): Promise<void> {
    if (macros.length > MACRO_MAX_COUNT) throw new Error(`At most ${MACRO_MAX_COUNT} macros are supported`)
    const image = encodeMacroImage(macros)
    await this.link.request(buildPackets(Cmd.WriteMacros, 0, image, this.reportId))
  }

  storageSize(macros: Macro[]): number {
    return macroStorageSize(macros)
  }
}
