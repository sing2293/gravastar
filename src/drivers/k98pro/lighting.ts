/**
 * Lighting service: zone effects, per-key custom colours and real-time colour streaming (music sync).
 * Verified against vendor class `Ya` (deob 3017–3216) and helpers `Tr`/`qa`/`Ft`/`Pt`.
 * Doc: docs/reverse-engineering/k98pro/05-lighting-macros.md §2–§5.
 */
import { clamp, readU16be, u16be } from '@/hid/core/bytes'
import type { LinkType, NumericRange, RGB } from '@/model/device'
import type { KeyId, LightZone, LightingCapabilities, LightingEffectInfo, LightingService, PerKeyColor, ZoneLighting } from '@/model/keyboard'
import { alignedChunk, buildPackets, decodePayload } from './codec'
import type { K98Config } from './config'
import { Cmd, Info, Setting } from './enums'
import type { K98Link } from './transport'

const effect = (id: number, name: string, opts: Partial<Omit<LightingEffectInfo, 'id' | 'name'>> = {}): LightingEffectInfo => ({
  id,
  name,
  supportsColor: opts.supportsColor ?? true,
  supportsSpeed: opts.supportsSpeed ?? true,
  supportsRandomColor: opts.supportsRandomColor ?? true,
})

/** Main-light effect ids (`v0`) with the vendor UI's rules for which controls apply. */
export const MAIN_EFFECTS: LightingEffectInfo[] = [
  effect(0, 'Off', { supportsColor: false, supportsSpeed: false, supportsRandomColor: false }),
  effect(1, 'Always On (Static)', { supportsSpeed: false }),
  effect(2, 'Breathing'),
  effect(3, 'Dream Rainbow', { supportsColor: false, supportsRandomColor: false }),
  effect(4, 'Instant Trigger'),
  effect(5, 'Walking in Rain'),
  effect(6, 'Rainbow Wheel'),
  effect(7, 'Ripple'),
  effect(8, 'Starry Night'),
  effect(9, 'Snow Trail'),
  effect(10, 'Endless Flow'),
  effect(11, 'Drifting Waves'),
  effect(12, 'Shadow Follow'),
  effect(13, 'Sine Wave'),
  effect(14, 'Left-Right Scan'),
  effect(15, 'Spinning Windmill', { supportsColor: false, supportsRandomColor: false }),
  effect(16, 'Rainbow Waterfall', { supportsColor: false, supportsRandomColor: false }),
  effect(17, 'Blossom'),
  effect(18, 'Spinning Storm'),
  effect(19, 'Custom (Static)', { supportsColor: false, supportsSpeed: false, supportsRandomColor: false }),
]

/** Side-light effect ids (`rt`) — note they differ from the main ids for the same names. */
export const SIDE_EFFECTS: LightingEffectInfo[] = [
  effect(0, 'Off', { supportsColor: false, supportsSpeed: false, supportsRandomColor: false }),
  effect(1, 'Endless Flow'),
  effect(2, 'Dream Rainbow', { supportsColor: false, supportsRandomColor: false }),
  effect(3, 'Always On (Static)', { supportsSpeed: false }),
  effect(4, 'Breathing'),
  effect(5, 'Marquee'),
]

export const CUSTOM_EFFECT_ID = 19
export const RANDOM_COLOR_INDEX = 7
export const BRIGHTNESS: Record<LightZone, NumericRange> = { main: { min: 0, max: 20, step: 1 }, side: { min: 0, max: 4, step: 1 }, logo: { min: 0, max: 4, step: 1 } }
export const SPEED: NumericRange = { min: 0, max: 4, step: 1 }

/** Setting index of the whole effect record (`Tr`) and of the effect id alone (`qa`) per zone. */
const RECORD_PARAM: Record<LightZone, number> = { main: Setting.MainEffect, side: Setting.SideEffect, logo: Setting.LogoEffect }
const EFFECT_ID_PARAM: Record<LightZone, number> = { main: Setting.MainEffectId, side: Setting.SideEffectId, logo: Setting.LogoEffectId }

export interface LightingSupport {
  musicMain: boolean
  musicSpectrum: boolean
  musicSide: boolean
  sideLight: boolean
  logoLight: boolean
  sideLightCount: number
}

export interface ColorGroup {
  ids: number[]
  color: RGB
}

/**
 * Vendor `Ft`: clusters keys whose colour is within `threshold` (Euclidean RGB) of a cluster's running average,
 * then merges clusters with identical rounded averages. Streams are RLE-by-colour, not per key.
 */
export function groupColors(list: PerKeyColor[], threshold = 48): ColorGroup[] {
  const t2 = threshold * threshold
  const clusters: { ids: number[]; sum: [number, number, number]; count: number }[] = []
  for (const { id, color } of list) {
    let placed = false
    for (const c of clusters) {
      const dr = c.sum[0] / c.count - color.r
      const dg = c.sum[1] / c.count - color.g
      const db = c.sum[2] / c.count - color.b
      if (dr * dr + dg * dg + db * db < t2) {
        c.ids.push(id)
        c.sum[0] += color.r
        c.sum[1] += color.g
        c.sum[2] += color.b
        c.count++
        placed = true
        break
      }
    }
    if (!placed) clusters.push({ ids: [id], sum: [color.r, color.g, color.b], count: 1 })
  }
  const merged = new Map<number, { ids: number[]; sum: [number, number, number]; count: number }>()
  for (const c of clusters) {
    const key = (Math.round(c.sum[0] / c.count) << 16) | (Math.round(c.sum[1] / c.count) << 8) | Math.round(c.sum[2] / c.count)
    const m = merged.get(key)
    if (m) {
      m.ids.push(...c.ids)
      m.sum[0] += c.sum[0]
      m.sum[1] += c.sum[1]
      m.sum[2] += c.sum[2]
      m.count += c.count
    } else merged.set(key, { ids: [...c.ids], sum: [...c.sum], count: c.count })
  }
  return [...merged.values()].map((m) => ({ ids: m.ids, color: { r: Math.round(m.sum[0] / m.count), g: Math.round(m.sum[1] / m.count), b: Math.round(m.sum[2] / m.count) } }))
}

/** Vendor `Pt`: RGB888 → RGB565. */
export function rgb565(c: RGB): number {
  return (((c.r >> 3) & 31) << 11) | (((c.g >> 2) & 63) << 5) | ((c.b >> 3) & 31)
}

/** Grouped payload for `0x08/0x01`: `[r, g, b, n, id0…]` per group (ids are single bytes here). */
export function encodeGroupedRgb(groups: ColorGroup[]): number[] {
  return groups.flatMap((g) => [g.color.r & 0xff, g.color.g & 0xff, g.color.b & 0xff, g.ids.length & 0xff, ...g.ids.map((id) => id & 0xff)])
}

export const WIRELESS_LIGHT_REPORT_ID = 0x09
const WIRELESS_CHUNK = 20 - 6 - 1 // 13

/**
 * Raw dongle report form (`*ByWireless`): 20-byte buffers `[0x09, 0x08, total, index, kind<<4 | len, payload…, pad, checksum]`
 * where checksum = `255 − Σ bytes[0..18] mod 256` — the leading report id is part of the sum. Returned buffers
 * still include byte 0 (the report id); send `buf.subarray(1)` on report id 0x09.
 */
export function buildWirelessLightReports(kind: 1 | 2 | 3, payload: number[]): Uint8Array[] {
  const chunks: number[][] = []
  if (kind === 2) chunks.push(payload)
  else for (let i = 0; i < payload.length; i += WIRELESS_CHUNK) chunks.push(payload.slice(i, i + WIRELESS_CHUNK))
  if (!chunks.length) chunks.push([])
  return chunks.map((chunk, i) => {
    const u = [WIRELESS_LIGHT_REPORT_ID, 0x08, chunks.length, i, (kind << 4) | (chunk.length & 0x0f), ...chunk]
    while (u.length < 19) u.push(0)
    const sum = u.reduce((a, b) => a + b, 0)
    u.push((255 - (sum % 256)) & 0xff)
    return Uint8Array.from(u)
  })
}

export class K98Lighting implements LightingService {
  constructor(
    private readonly link: K98Link,
    private readonly config: K98Config,
    private readonly linkType: LinkType = 'wired',
  ) {}

  private get reportId(): number {
    return this.link.reportId
  }

  /** `0x82/0x09`: the vendor reads the first reply's raw bytes 6…61 and looks at offsets 17–20. */
  async support(): Promise<LightingSupport> {
    const [reply] = await this.link.request(buildPackets(Cmd.DeviceInfo, Info.LightingSupport, [], this.reportId))
    const a = reply ? reply.subarray(6, 62) : new Uint8Array(56)
    const flags = a[17] ?? 0
    return {
      musicMain: (flags & 1) !== 0,
      musicSpectrum: (flags & 2) !== 0,
      musicSide: (flags & 4) !== 0,
      sideLight: (a[18] ?? 0) !== 0,
      logoLight: (a[19] ?? 0) !== 0,
      sideLightCount: a[20] ?? 0,
    }
  }

  async capabilities(): Promise<LightingCapabilities> {
    const [support, features] = await Promise.all([this.support(), this.config.features()])
    const zones: LightZone[] = ['main']
    if (support.sideLight) zones.push('side')
    if (support.logoLight) zones.push('logo')
    return {
      zones,
      effects: { main: MAIN_EFFECTS, side: SIDE_EFFECTS, logo: SIDE_EFFECTS },
      brightness: BRIGHTNESS,
      speed: SPEED,
      customEffectId: CUSTOM_EFFECT_ID,
      randomColorIndex: RANDOM_COLOR_INDEX,
      streaming: { perKey: features.keyIdRGB, fullKeys: features.fullKeysRGB, experimental: true },
      sideLightCount: support.sideLightCount,
    }
  }

  async get(zone: LightZone): Promise<ZoneLighting> {
    const a = decodePayload(await this.link.request(buildPackets(Cmd.ReadSetting, RECORD_PARAM[zone], [], this.reportId)))
    const out: ZoneLighting = { effectId: a[0] ?? 0, colorIndex: a[1] ?? 0, color: { r: a[2] ?? 0, g: a[3] ?? 0, b: a[4] ?? 0 }, brightness: a[5] ?? 0, speed: a[6] ?? 0 }
    // Vendor quirk: custom mode with a random colour index and black reports as red.
    if (out.effectId === CUSTOM_EFFECT_ID && out.colorIndex >= RANDOM_COLOR_INDEX && !out.color.r && !out.color.g && !out.color.b) out.color.r = 255
    return out
  }

  async set(zone: LightZone, l: ZoneLighting): Promise<void> {
    const range = BRIGHTNESS[zone]
    const payload = [l.effectId & 0xff, l.colorIndex & 0xff, l.color.r & 0xff, l.color.g & 0xff, l.color.b & 0xff, clamp(l.brightness, range.min, range.max), clamp(l.speed, SPEED.min, SPEED.max)]
    await this.link.request(buildPackets(Cmd.WriteSetting, RECORD_PARAM[zone], payload, this.reportId))
  }

  async setEffect(zone: LightZone, effectId: number): Promise<void> {
    await this.link.request(buildPackets(Cmd.WriteSetting, EFFECT_ID_PARAM[zone], [effectId & 0xff], this.reportId))
  }

  async getCustomColors(ids: KeyId[]): Promise<PerKeyColor[]> {
    if (!ids.length) return []
    const packets = buildPackets(Cmd.GetCustomColors, 0, ids.flatMap((id) => u16be(id)), this.reportId, alignedChunk(2, 5))
    const data = decodePayload(await this.link.request(packets))
    const out: PerKeyColor[] = []
    for (let i = 0; i + 4 < data.length; i += 5) out.push({ id: readU16be(data, i), color: { r: data[i + 2]!, g: data[i + 3]!, b: data[i + 4]! } })
    return out
  }

  async setCustomColors(colors: PerKeyColor[]): Promise<void> {
    if (!colors.length) return
    const payload = colors.flatMap((c) => [...u16be(c.id), c.color.r & 0xff, c.color.g & 0xff, c.color.b & 0xff])
    await this.link.request(buildPackets(Cmd.SetCustomColors, 0, payload, this.reportId, alignedChunk(5)))
  }

  /** Real-time per-key frame; grouped by colour and sent without waiting for replies. */
  async stream(frame: PerKeyColor[]): Promise<void> {
    if (!frame.length) return
    const payload = encodeGroupedRgb(groupColors(frame))
    if (this.linkType === 'dongle') return this.sendWireless(1, payload)
    for (const p of buildPackets(Cmd.StreamRGB, 0x01, payload, this.reportId)) await this.link.sendCommand(p)
  }

  async streamAll(color: RGB): Promise<void> {
    const payload = [color.r & 0xff, color.g & 0xff, color.b & 0xff]
    if (this.linkType === 'dongle') return this.sendWireless(2, payload)
    for (const p of buildPackets(Cmd.StreamRGB, 0x02, payload, this.reportId)) await this.link.sendCommand(p)
  }

  private async sendWireless(kind: 1 | 2 | 3, payload: number[]): Promise<void> {
    const send = this.link.transport.sendWithReportId?.bind(this.link.transport)
    if (!send) throw new Error('transport cannot send raw lighting reports')
    for (const report of buildWirelessLightReports(kind, payload)) await send(WIRELESS_LIGHT_REPORT_ID, report.subarray(1))
  }
}
