/**
 * Keymap and profile services. Verified against vendor classes `Ba` (deob 1329–1424) and `ja` (2378–2412).
 * Doc: docs/reverse-engineering/k98pro/03-keymap-layout.md §3, §5.
 */
import { readU16be, u16be } from '@/hid/core/bytes'
import type { KeyBinding, KeyId, KeymapService, LayerSelector, ProfileService, ProfilesInfo } from '@/model/keyboard'
import { alignedChunk, buildPackets, decodePayload, encodeLayerAndSystem } from './codec'
import { Cmd, ResetType, osToWire } from './enums'
import type { K98Link } from './transport'

export const u32be = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
export const readU32be = (b: ArrayLike<number>, i: number): number => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0

export const selectorParam = (sel: LayerSelector): number => encodeLayerAndSystem(sel.layer, osToWire(sel.os))

/** Records per read packet: 9 ids (18 bytes) so the 9 six-byte answers fit one 56-byte reply. */
export const KEYMAP_READ_CHUNK = alignedChunk(2, 6)

export class K98Keymap implements KeymapService {
  constructor(private readonly link: K98Link) {}

  async read(sel: LayerSelector, ids: KeyId[]): Promise<KeyBinding[]> {
    if (!ids.length) return []
    const packets = buildPackets(Cmd.GetKeymap, selectorParam(sel), ids.flatMap((id) => u16be(id)), this.link.reportId, KEYMAP_READ_CHUNK)
    const data = decodePayload(await this.link.request(packets))
    const out: KeyBinding[] = []
    for (let i = 0; i + 5 < data.length; i += 6) out.push({ id: readU16be(data, i), keycode: readU32be(data, i + 2) })
    return out
  }

  /**
   * Writes bindings in one command. The vendor writes one key per packet for interactive edits; batches are cut at
   * 56-byte boundaries by the codec, so we keep records whole by chunking at 9 records (54 bytes) ourselves.
   */
  async write(sel: LayerSelector, bindings: KeyBinding[]): Promise<void> {
    if (!bindings.length) throw new Error('Keycaps cannot be empty')
    const payload = bindings.flatMap((b) => [...u16be(b.id), ...u32be(b.keycode)])
    await this.link.request(buildPackets(Cmd.SetKeymap, selectorParam(sel), payload, this.link.reportId, alignedChunk(6)))
  }

  async reset(sel: LayerSelector): Promise<void> {
    await this.link.request(buildPackets(Cmd.Reset, selectorParam(sel), [ResetType.Keymap], this.link.reportId))
  }
}

export const PROFILE_COUNT = 3
export const PROFILE_NAME_MAX_BYTES = 55

export class K98Profiles implements ProfileService {
  readonly maxNameLength = 10 // vendor UI limit; the wire allows 55 UTF-8 bytes

  constructor(private readonly link: K98Link) {}

  async get(): Promise<ProfilesInfo> {
    const current = decodePayload(await this.link.request(buildPackets(Cmd.GetProfile, 0, [], this.link.reportId)), 1)[0] ?? 0
    const names: string[] = []
    for (let i = 0; i < PROFILE_COUNT; i++) names.push(await this.name(i))
    return { count: PROFILE_COUNT, current, names }
  }

  async name(index: number): Promise<string> {
    const data = decodePayload(await this.link.request(buildPackets(Cmd.GetProfileName, index, [], this.link.reportId)))
    const len = data[0] ?? 0
    if (len === 0 || len === 0xff) return ''
    return new TextDecoder('utf-8').decode(data.subarray(1, 1 + len))
  }

  async select(index: number): Promise<void> {
    await this.link.request(buildPackets(Cmd.SetProfile, 0, [index], this.link.reportId))
  }

  async rename(index: number, name: string): Promise<void> {
    const bytes = new TextEncoder().encode(name)
    if (bytes.length > PROFILE_NAME_MAX_BYTES) throw new Error(`Profile name is too long (max: ${PROFILE_NAME_MAX_BYTES} bytes)`)
    await this.link.request(buildPackets(Cmd.SetProfileName, index, [bytes.length, ...bytes], this.link.reportId))
  }
}
