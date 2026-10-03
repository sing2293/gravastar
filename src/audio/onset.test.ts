import { describe, expect, it } from 'vitest'
import { OnsetDetector } from './onset'

/** Feeds `frames` samples 20 ms apart; `pulse` returns the band level for a frame index. */
function run(d: OnsetDetector, frames: number, pulse: (i: number) => number, sensitivity = 1): number {
  let onsets = 0
  for (let i = 0; i < frames; i++) if (d.feed(pulse(i), i * 20, sensitivity).onset) onsets++
  return onsets
}

describe('OnsetDetector', () => {
  it('triggers on attacks and not on a steady level', () => {
    const steady = new OnsetDetector()
    expect(run(steady, 100, () => 0.6)).toBe(0)

    const pulsed = new OnsetDetector()
    expect(run(pulsed, 100, (i) => (i % 10 === 0 ? 0.9 : 0.15))).toBeGreaterThanOrEqual(8)
  })

  it('works the same on a quiet band as a loud one', () => {
    const loud = run(new OnsetDetector(), 100, (i) => (i % 10 === 0 ? 0.9 : 0.1))
    const quiet = run(new OnsetDetector(), 100, (i) => (i % 10 === 0 ? 0.09 : 0.01))
    expect(Math.abs(loud - quiet)).toBeLessThanOrEqual(1)
  })

  it('honours the refractory period and reports a normalized level', () => {
    const d = new OnsetDetector({ window: 40, threshold: 1.4, refractoryMs: 500, floor: 0.2 })
    const onsets = run(d, 100, (i) => (i % 5 === 0 ? 0.9 : 0.1)) // an attack every 100 ms
    expect(onsets).toBeLessThanOrEqual(5) // but at most one per 500 ms
    expect(d.feed(0.9, 10_000).normalized).toBeCloseTo(1, 1)
  })

  it('sensitivity trades misses for extra triggers', () => {
    const shy = run(new OnsetDetector(), 200, (i) => (i % 10 === 0 ? 0.3 : 0.2), 0.4)
    const eager = run(new OnsetDetector(), 200, (i) => (i % 10 === 0 ? 0.3 : 0.2), 2.5)
    expect(eager).toBeGreaterThanOrEqual(shy)
  })
})
