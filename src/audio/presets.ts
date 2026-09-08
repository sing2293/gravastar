import type { RGB } from '@/model/device'
import type { KeyboardLayout, LayoutKey, PerKeyColor } from '@/model/keyboard'
import { layoutBounds } from '@/drivers/k98pro/layout'
import type { AudioFrame, LightingFrame } from './types'

export interface PresetContext {
  layout: KeyboardLayout
  /** Seconds since the sync started. */
  t: number
  /** User colour, used by presets that are not rainbow-based. */
  color: RGB
  /** 0..2, multiplies levels. */
  sensitivity: number
}

export interface Accent {
  color: RGB
  /** 0..1 */
  intensity: number
}

export interface MusicPreset {
  id: string
  name: string
  description: string
  usesColor: boolean
  render(frame: AudioFrame, ctx: PresetContext): LightingFrame
  /** One colour + intensity for single-light devices (mouse bar, receiver), consistent with `render`. */
  accent(frame: AudioFrame, ctx: Omit<PresetContext, 'layout'>): Accent
}

export function hsv(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6]!
  return { r: Math.round(r! * 255), g: Math.round(g! * 255), b: Math.round(b! * 255) }
}

const scale = (c: RGB, k: number): RGB => ({ r: Math.round(c.r * k), g: Math.round(c.g * k), b: Math.round(c.b * k) })
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Index of the loudest band, weighted toward the low end, as a hue source. */
function dominantHue(frame: AudioFrame): number {
  let best = 0
  let bestV = -1
  for (let i = 0; i < frame.bands.length; i++) {
    const v = frame.bands[i]! * (1 - (i / frame.bands.length) * 0.4)
    if (v > bestV) {
      bestV = v
      best = i
    }
  }
  return frame.bands.length ? best / frame.bands.length : 0
}

function columnsOf(layout: KeyboardLayout): { key: LayoutKey; x: number; y: number }[] {
  const b = layoutBounds(layout)
  return layout.keys.map((key) => ({ key, x: (key.x + key.w / 2) / b.width, y: 1 - (key.y + key.h / 2) / b.height }))
}

const cache = new WeakMap<KeyboardLayout, ReturnType<typeof columnsOf>>()
const positions = (layout: KeyboardLayout) => {
  let p = cache.get(layout)
  if (!p) cache.set(layout, (p = columnsOf(layout)))
  return p
}

export const PRESETS: MusicPreset[] = [
  {
    id: 'rise',
    name: 'Rise (bottom → top)',
    description: 'Light climbs from the bottom row to the top with loudness; bass warms the low rows, highs cool the top, beats pulse the bottom.',
    usesColor: false,
    render(frame, ctx) {
      const level = clamp01(frame.level * ctx.sensitivity)
      const n = frame.bands.length
      const keys: PerKeyColor[] = []
      for (const { key, y } of positions(ctx.layout)) {
        // Low frequencies live at the bottom of the board, high ones at the top.
        const band = Math.min(n - 1, Math.floor(y * n))
        const energy = clamp01(frame.bands[band]! * ctx.sensitivity * 1.5)
        const lit = y <= level
        const edge = lit && level - y < 0.12 // the crest of the rising light
        let glow = lit ? 0.35 + 0.65 * energy : 0
        if (!lit && frame.beat && y < 0.18) glow = 0.6 * frame.beatStrength
        const hue = 0.04 + 0.56 * y // orange at the bottom → blue at the top
        keys.push({ id: key.id, color: scale(edge ? hsv(hue, 0.35, 1) : hsv(hue, 1, 1), glow) })
      }
      return { keys }
    },
    accent(frame, ctx) {
      const level = clamp01(frame.level * ctx.sensitivity)
      return { color: hsv(0.04 + 0.56 * level, 1, 1), intensity: level }
    },
  },
  {
    id: 'spectrum',
    name: 'Spectrum columns (side → side)',
    description: 'One frequency band per column, left → right, each rising with its loudness; rainbow across the board.',
    usesColor: false,
    render(frame, ctx) {
      const keys: PerKeyColor[] = []
      const n = frame.bands.length
      for (const { key, x, y } of positions(ctx.layout)) {
        const band = Math.min(n - 1, Math.floor(x * n))
        const level = clamp01(frame.bands[band]! * ctx.sensitivity * 1.6)
        const lit = y <= level
        const glow = lit ? 0.35 + 0.65 * (1 - y / Math.max(level, 0.01)) : 0
        keys.push({ id: key.id, color: scale(hsv((x + ctx.t * 0.05) % 1, 1, 1), glow) })
      }
      return { keys }
    },
    accent(frame, ctx) {
      return { color: hsv((dominantHue(frame) + ctx.t * 0.05) % 1, 1, 1), intensity: clamp01(frame.level * ctx.sensitivity) }
    },
  },
  {
    id: 'pulse',
    name: 'Pulse',
    description: 'Whole board breathes with the beat in your colour.',
    usesColor: true,
    render(frame, ctx) {
      const v = clamp01(frame.level * ctx.sensitivity * 0.9 + (frame.beat ? 0.5 * frame.beatStrength : 0))
      return { all: scale(ctx.color, 0.08 + 0.92 * v) }
    },
    accent(frame, ctx) {
      return { color: ctx.color, intensity: clamp01(frame.level * ctx.sensitivity * 0.9 + (frame.beat ? 0.5 * frame.beatStrength : 0)) }
    },
  },
  {
    id: 'vu',
    name: 'VU meter (bottom → top)',
    description: 'Fills the board from the bottom row upward with loudness: green → yellow → red.',
    usesColor: false,
    render(frame, ctx) {
      const level = clamp01(frame.level * ctx.sensitivity)
      const keys: PerKeyColor[] = []
      for (const { key, y } of positions(ctx.layout)) {
        const lit = y <= level
        keys.push({ id: key.id, color: lit ? hsv((1 - y) * 0.33, 1, 1) : { r: 0, g: 0, b: 0 } })
      }
      return { keys }
    },
    accent(frame, ctx) {
      const level = clamp01(frame.level * ctx.sensitivity)
      return { color: hsv((1 - level) * 0.33, 1, 1), intensity: level }
    },
  },
  {
    id: 'bassdrop',
    name: 'Bass wave',
    description: 'Bass lights the bottom rows, treble the top; beats flash the F-row.',
    usesColor: true,
    render(frame, ctx) {
      const keys: PerKeyColor[] = []
      const hue = (ctx.t * 0.03) % 1
      for (const { key, y } of positions(ctx.layout)) {
        const weight = y < 0.5 ? frame.bass * (1 - y * 2) : frame.treble * ((y - 0.5) * 2)
        let v = clamp01(weight * ctx.sensitivity * 1.8)
        if (frame.beat && y > 0.85) v = 1
        keys.push({ id: key.id, color: scale(y > 0.85 && frame.beat ? { r: 255, g: 255, b: 255 } : hsv((hue + y * 0.2) % 1, 0.9, 1), v) })
      }
      return { keys }
    },
    accent(frame, ctx) {
      const hue = (ctx.t * 0.03) % 1
      return { color: frame.beat ? { r: 255, g: 255, b: 255 } : hsv(hue, 0.9, 1), intensity: clamp01(frame.bass * ctx.sensitivity * 1.8) }
    },
  },
]

export const presetById = (id: string): MusicPreset => PRESETS.find((p) => p.id === id) ?? PRESETS[0]!
