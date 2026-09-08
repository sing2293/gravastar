/**
 * Advanced keys (TGL / MT / DKS / SOCD / MPT / END / RS). Verified against vendor class `Na` (deob 1969–2243)
 * and `buildAdvancedKeyCommands` (885–890): command 0x12 writes, 0x92 reads, type in packet byte 2.
 * Doc: docs/reverse-engineering/k98pro/04-performance-advanced-keys.md §4.
 */
import { clamp, readU16be, u16be } from '@/hid/core/bytes'
import type { AdvancedKey, AdvancedKeyService, AdvancedKeyType, DksTrigger, KeyId, LayerSelector, SocdMode } from '@/model/keyboard'
import { PAYLOAD_MAX, buildPackets, decodePayload, withChecksum } from './codec'
import type { K98Config } from './config'
import { AdvancedKeyWire, Cmd } from './enums'
import { readU32be, selectorParam, u32be } from './keymap'
import type { K98Link } from './transport'

const TYPE_TO_WIRE: Record<AdvancedKeyType, AdvancedKeyWire> = { TGL: AdvancedKeyWire.TGL, MT: AdvancedKeyWire.MT, DKS: AdvancedKeyWire.DKS, SOCD: AdvancedKeyWire.SOCD, MPT: AdvancedKeyWire.MPT, END: AdvancedKeyWire.END, RS: AdvancedKeyWire.RS }
const TYPE_FROM_WIRE: Record<number, AdvancedKeyType> = { 1: 'TGL', 2: 'MT', 3: 'DKS', 4: 'SOCD', 5: 'MPT', 6: 'END', 7: 'RS' }

export const SOCD_TO_WIRE: Record<SocdMode, number> = { neutral: 0, lastWins: 1, firstWins: 2, key1Wins: 3, key2Wins: 4, bothActive: 0x3f }
const SOCD_FROM_WIRE: Record<number, SocdMode> = { 0: 'neutral', 1: 'lastWins', 2: 'firstWins', 3: 'key1Wins', 4: 'key2Wins', 0x3f: 'bothActive' }

export const DKS_TRIGGER_TO_WIRE: Record<DksTrigger, number> = { none: 0, duringPress: 4, startPress: 6, instant: 10, endPress: 12, startAndEnd: 14 }
const DKS_TRIGGER_FROM_WIRE: Record<number, DksTrigger> = { 0: 'none', 4: 'duringPress', 6: 'startPress', 10: 'instant', 12: 'endPress', 14: 'startAndEnd' }

export const MPT_DISTANCE = { min: 10, max: 4000 } as const

const validId = (id: number): boolean => Number.isInteger(id) && id > 0 && id < 2 ** 32

/** Payload after the 6-byte header for each type (doc §4.1). */
export function encodeAdvancedKey(key: AdvancedKey): number[] {
  switch (key.type) {
    case 'TGL':
      return [...u16be(key.id), ...u32be(key.keycode), ...u16be(key.delayMs)]
    case 'MT':
      return [...u16be(key.id), ...u32be(key.holdKeycode), ...u32be(key.clickKeycode), ...u16be(key.delayMs)]
    case 'DKS':
      return [
        ...u16be(key.id),
        ...u16be(key.depths.start),
        ...u16be(key.depths.bottom),
        ...u16be(key.depths.bottomRelease),
        ...u16be(key.depths.fullRelease),
        ...key.groups.flatMap((g) => [
          ...u32be(g.keycode),
          DKS_TRIGGER_TO_WIRE[g.triggers.start],
          DKS_TRIGGER_TO_WIRE[g.triggers.bottom],
          DKS_TRIGGER_TO_WIRE[g.triggers.bottomRelease],
          DKS_TRIGGER_TO_WIRE[g.triggers.fullRelease],
        ]),
      ]
    case 'SOCD':
      if (!key.ids.length) throw new Error('Ids cannot be empty')
      return [key.ids.length, ...key.ids.flatMap((id) => u16be(id)), SOCD_TO_WIRE[key.mode]]
    case 'MPT':
      return [...u16be(key.id), key.points.length, ...key.points.flatMap((p) => [...u32be(p.keycode), ...u16be(clamp(p.distance, MPT_DISTANCE.min, MPT_DISTANCE.max))])]
    case 'END':
      return [...u16be(key.id), ...u32be(key.keycode)]
    case 'RS':
      return [...u16be(key.ids[0]), ...u16be(key.ids[1])]
  }
}

export function decodeAdvancedKey(type: number, d: Uint8Array): AdvancedKey | undefined {
  switch (TYPE_FROM_WIRE[type]) {
    case 'TGL':
      return { type: 'TGL', id: readU16be(d, 0), keycode: readU32be(d, 2), delayMs: readU16be(d, 6) }
    case 'MT':
      return { type: 'MT', id: readU16be(d, 0), holdKeycode: readU32be(d, 2), clickKeycode: readU32be(d, 6), delayMs: readU16be(d, 10) }
    case 'DKS': {
      const groups = []
      for (let i = 10; i + 7 < d.length; i += 8) {
        groups.push({
          keycode: readU32be(d, i),
          triggers: {
            start: DKS_TRIGGER_FROM_WIRE[d[i + 4]!] ?? 'none',
            bottom: DKS_TRIGGER_FROM_WIRE[d[i + 5]!] ?? 'none',
            bottomRelease: DKS_TRIGGER_FROM_WIRE[d[i + 6]!] ?? 'none',
            fullRelease: DKS_TRIGGER_FROM_WIRE[d[i + 7]!] ?? 'none',
          },
        })
      }
      return { type: 'DKS', id: readU16be(d, 0), depths: { start: readU16be(d, 2), bottom: readU16be(d, 4), bottomRelease: readU16be(d, 6), fullRelease: readU16be(d, 8) }, groups }
    }
    case 'SOCD': {
      const count = d[0] ?? 0
      const ids: KeyId[] = []
      for (let i = 0; i < count; i++) ids.push(readU16be(d, 1 + 2 * i))
      return { type: 'SOCD', ids, mode: SOCD_FROM_WIRE[d[1 + 2 * count] ?? 0] ?? 'neutral' }
    }
    case 'MPT': {
      const count = d[2] ?? 0
      const points = []
      for (let i = 0; i < count; i++) points.push({ keycode: readU32be(d, 3 + 6 * i), distance: readU16be(d, 7 + 6 * i) })
      return { type: 'MPT', id: readU16be(d, 0), points }
    }
    case 'END':
      return { type: 'END', id: readU16be(d, 0), keycode: readU32be(d, 2) }
    case 'RS':
      return { type: 'RS', ids: [readU16be(d, 0), readU16be(d, 2)] }
    default:
      return undefined
  }
}

export function advancedKeyIds(key: AdvancedKey): KeyId[] {
  return 'ids' in key ? [...key.ids] : [key.id]
}

export class K98AdvancedKeys implements AdvancedKeyService {
  constructor(
    private readonly link: K98Link,
    private readonly config: K98Config,
  ) {}

  private get reportId(): number {
    return this.link.reportId
  }

  supportedTypes(): Promise<AdvancedKeyType[]> {
    return this.config.getSupportedAdvancedKeyTypes()
  }

  async list(sel: LayerSelector): Promise<AdvancedKey[]> {
    const ids = await this.listIds(sel)
    const out: AdvancedKey[] = []
    for (const id of ids) {
      const key = await this.get(sel, id)
      if (key) out.push(key)
    }
    return out
  }

  async get(sel: LayerSelector, id: KeyId): Promise<AdvancedKey | undefined> {
    const [reply] = await this.link.request(buildPackets(Cmd.GetAdvancedKey, selectorParam(sel), u16be(id), this.reportId))
    if (!reply) return undefined
    return decodeAdvancedKey(reply[2]!, decodePayload(reply))
  }

  async set(sel: LayerSelector, key: AdvancedKey): Promise<void> {
    for (const id of advancedKeyIds(key)) if (!validId(id)) throw new Error(`Invalid id for advanced key: ${id}`)
    if (key.type === 'RS' && key.ids.length !== 2) throw new Error('RS needs exactly 2 ids')
    await this.send(sel, TYPE_TO_WIRE[key.type], encodeAdvancedKey(key))
  }

  /** Deleting sends type NONE with the key id; SOCD/RS pairs are deleted one id at a time. */
  async delete(sel: LayerSelector, key: AdvancedKey): Promise<void> {
    for (const id of advancedKeyIds(key)) await this.send(sel, AdvancedKeyWire.None, u16be(id))
  }

  private async send(sel: LayerSelector, type: AdvancedKeyWire, payload: number[]): Promise<void> {
    const packets = buildPackets(Cmd.SetAdvancedKey, selectorParam(sel), payload, this.reportId)
    for (const p of packets) {
      p[2] = type
      withChecksum(p, this.reportId)
    }
    await this.link.request(packets)
  }

  /** `0x92` with an empty payload lists configured key ids; paged through bytes 3/4 (doc §4.3). */
  private async listIds(sel: LayerSelector, total = 1, current = 0): Promise<KeyId[]> {
    const [packet] = buildPackets(Cmd.GetAdvancedKey, selectorParam(sel), [], this.reportId)
    packet![3] = total
    packet![4] = current
    withChecksum(packet!, this.reportId)
    const [reply] = await this.link.request([packet!])
    if (!reply) return []
    const data = decodePayload(reply)
    const ids: KeyId[] = []
    for (let i = 0; i + 1 < data.length; i += 2) ids.push(readU16be(data, i))
    const pageTotal = total === 1 ? Math.ceil(reply[5]! / PAYLOAD_MAX) : total
    if (reply[4]! + 1 < pageTotal) ids.push(...(await this.listIds(sel, pageTotal, reply[4]! + 1)))
    return ids
  }
}
