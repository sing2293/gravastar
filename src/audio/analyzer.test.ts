import { describe, expect, it } from 'vitest'
import { DEFAULT_ANALYZER, FeatureExtractor } from './analyzer'
import { PRESETS, hsv } from './presets'
import { LAYOUTS } from '@/drivers/k98pro/layout'

function spectrum(binCount: number, fill: (hz: number) => number, sampleRate = 48000): Uint8Array {
  const out = new Uint8Array(binCount)
  for (let i = 0; i < binCount; i++) out[i] = Math.round(255 * Math.max(0, Math.min(1, fill((i * sampleRate) / 2 / binCount))))
  return out
}

describe('FeatureExtractor', () => {
  it('maps bins to log bands and detects a bass onset once', () => {
    const fx = new FeatureExtractor(DEFAULT_ANALYZER, 48000, 1024)
    const silence = new Uint8Array(1024)
    const flat = new Uint8Array(2048).fill(128)
    for (let i = 0; i < 20; i++) fx.extract(silence, flat, i * 16)
    const quiet = fx.extract(silence, flat, 400)
    expect(quiet.level).toBe(0)
    expect(quiet.beat).toBe(false)
    const bassy = spectrum(1024, (hz) => (hz < 150 ? 1 : 0.05))
    const loud = new Uint8Array(2048).map((_, i) => 128 + Math.round(100 * Math.sin(i / 10)))
    const f1 = fx.extract(bassy, loud, 500)
    expect(f1.bass).toBeGreaterThan(0.8)
    expect(f1.treble).toBeLessThan(0.1)
    expect(f1.beat).toBe(true)
    expect(f1.level).toBeGreaterThan(0.5)
    expect(f1.bands.length).toBe(24)
    expect(f1.bands[0]).toBeGreaterThan(f1.bands[23]!)
    const f2 = fx.extract(bassy, loud, 520) // within the refractory period → no second beat
    expect(f2.beat).toBe(false)
  })
})

describe('onset detection on difficult material', () => {
  /** Frames of a track: `attack` frames are a transient, the rest steady. Everything scaled by `gain`. */
  function play(fx: FeatureExtractor, frames: number, gain: number, attackEvery: number, bassy: boolean): number {
    let beats = 0
    const time = new Uint8Array(2048).fill(130)
    for (let i = 0; i < frames; i++) {
      const attack = i % attackEvery === 0 && i > 0
      const shape = (hz: number) => {
        const base = bassy ? (hz < 150 ? 0.7 : 0.1) : hz > 1200 && hz < 6000 ? 0.5 : 0.08
        return base * gain * (attack ? 2.6 : 1)
      }
      if (fx.extract(spectrum(1024, shape), time, i * 20).beat) beats++
    }
    return beats
  }

  it('finds beats in quiet, bass-light music that a raw bass gate would miss', () => {
    // 10 % of full scale, energy only in the upper mids — the old `bass > 0.08` gate never fired here.
    const quiet = new FeatureExtractor(DEFAULT_ANALYZER, 48000, 1024)
    const beats = play(quiet, 120, 0.1, 10, false)
    expect(beats).toBeGreaterThanOrEqual(8)
    expect(beats).toBeLessThanOrEqual(12)
  })

  it('finds the same beats whether the source is loud or quiet', () => {
    const loud = play(new FeatureExtractor(DEFAULT_ANALYZER, 48000, 1024), 120, 1, 10, true)
    const quiet = play(new FeatureExtractor(DEFAULT_ANALYZER, 48000, 1024), 120, 0.12, 10, true)
    expect(Math.abs(loud - quiet)).toBeLessThanOrEqual(1)
  })

  it('does not fire on steady sound, and sensitivity trades misses for false positives', () => {
    const steady = new FeatureExtractor(DEFAULT_ANALYZER, 48000, 1024)
    expect(play(steady, 120, 0.6, 10_000, true)).toBe(0)

    const shy = new FeatureExtractor(DEFAULT_ANALYZER, 48000, 1024)
    shy.beatSensitivity = 0.4
    const eager = new FeatureExtractor(DEFAULT_ANALYZER, 48000, 1024)
    eager.beatSensitivity = 2.5
    expect(play(eager, 200, 0.2, 10, false)).toBeGreaterThanOrEqual(play(shy, 200, 0.2, 10, false))
  })
})

describe('presets', () => {
  const frame = { time: 0, level: 0.8, bands: Float32Array.from({ length: 24 }, (_, i) => (i < 12 ? 0.9 : 0.1)), bass: 0.9, mid: 0.3, treble: 0.1, beat: true, beatStrength: 0.7 }
  it('render a lighting frame for every key or a single colour', () => {
    const ctx = { layout: LAYOUTS.us, t: 1, color: { r: 255, g: 0, b: 0 }, sensitivity: 1 }
    for (const p of PRESETS) {
      const out = p.render(frame, ctx)
      if ('all' in out) expect(out.all.r).toBeGreaterThan(0)
      else {
        expect(out.keys).toHaveLength(98)
        for (const k of out.keys) for (const v of [k.color.r, k.color.g, k.color.b]) expect(v).toBeGreaterThanOrEqual(0)
      }
    }
    const spectrum = PRESETS.find((p) => p.id === 'spectrum')!.render(frame, ctx)
    if ('keys' in spectrum) {
      const left = spectrum.keys.find((k) => k.id === 43)! // A — left half, lower row → lit
      const right = spectrum.keys.find((k) => k.id === 13)! // F12 — right half, top row → dark
      expect(left.color.r + left.color.g + left.color.b).toBeGreaterThan(0)
      expect(right.color.r + right.color.g + right.color.b).toBe(0)
    }
  })
  it('Rise lights the board from the bottom row upward', () => {
    const ctx = { layout: LAYOUTS.us, t: 0, color: { r: 255, g: 0, b: 0 }, sensitivity: 1 }
    const half = { ...frame, level: 0.5, beat: false, beatStrength: 0 }
    const out = PRESETS.find((p) => p.id === 'rise')!.render(half, ctx)
    if (!('keys' in out)) throw new Error('rise renders per key')
    const sum = (id: number) => {
      const c = out.keys.find((k) => k.id === id)!.color
      return c.r + c.g + c.b
    }
    expect(sum(70)).toBeGreaterThan(0) // Space — bottom row
    expect(sum(43)).toBeGreaterThan(0) // A — home row (≈ 40% up)
    expect(sum(1)).toBe(0) // Esc — top row stays dark at half loudness
    expect(sum(13)).toBe(0) // F12
    const loud = PRESETS.find((p) => p.id === 'rise')!.render({ ...half, level: 1 }, ctx)
    if ('keys' in loud) expect(loud.keys.every((k) => k.color.r + k.color.g + k.color.b > 0)).toBe(true)
    const vu = PRESETS.find((p) => p.id === 'vu')!.render(half, ctx)
    if ('keys' in vu) {
      expect(vu.keys.find((k) => k.id === 70)!.color.g).toBe(255) // bottom = green
      expect(vu.keys.find((k) => k.id === 1)!.color).toEqual({ r: 0, g: 0, b: 0 })
    }
  })

  it('Spectrum rows puts bass at the bottom and treble at the top', () => {
    const ctx = { layout: LAYOUTS.us, t: 0, color: { r: 255, g: 0, b: 0 }, sensitivity: 1 }
    const bassy = { ...frame, bands: Float32Array.from({ length: 24 }, (_, i) => (i < 6 ? 0.9 : 0)), beat: false, beatStrength: 0 }
    const out = PRESETS.find((p) => p.id === 'spectrumRows')!.render(bassy, ctx)
    if (!('keys' in out)) throw new Error('per key')
    const sum = (id: number) => {
      const c = out.keys.find((k) => k.id === id)!.color
      return c.r + c.g + c.b
    }
    expect(sum(70)).toBeGreaterThan(0) // Space — bottom row lit by the bass bands
    expect(sum(1)).toBe(0) // Esc — no treble → top row dark
    const trebly = { ...bassy, bands: Float32Array.from({ length: 24 }, (_, i) => (i >= 18 ? 0.9 : 0)) }
    const top = PRESETS.find((p) => p.id === 'spectrumRows')!.render(trebly, ctx)
    if ('keys' in top) {
      const esc = top.keys.find((k) => k.id === 1)!.color
      const space = top.keys.find((k) => k.id === 70)!.color
      expect(esc.r + esc.g + esc.b).toBeGreaterThan(0)
      expect(space.r + space.g + space.b).toBe(0)
    }
    expect(PRESETS.map((p) => p.id).slice(0, 3)).toEqual(['rise', 'spectrumRows', 'spectrum'])
  })

  it('hsv converts primaries', () => {
    expect(hsv(0, 1, 1)).toEqual({ r: 255, g: 0, b: 0 })
    expect(hsv(1 / 3, 1, 1)).toEqual({ r: 0, g: 255, b: 0 })
    expect(hsv(2 / 3, 1, 0.5)).toEqual({ r: 0, g: 0, b: 128 })
  })
})
