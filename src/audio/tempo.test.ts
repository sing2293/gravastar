import { describe, expect, it } from 'vitest'
import { TempoTracker, breathingSpeed } from './tempo'

const feed = (t: TempoTracker, periods: number[], start = 0): number => {
  let now = start
  t.beat(now)
  for (const p of periods) {
    now += p
    t.beat(now)
  }
  return now
}

describe('TempoTracker', () => {
  it('needs several consistent onsets before reporting a tempo', () => {
    const t = new TempoTracker()
    expect(t.tempo).toEqual({ confidence: 0 })
    feed(t, [500, 500])
    expect(t.tempo.bpm).toBeUndefined()
    feed(t, [500, 500], 1000)
    expect(t.tempo.bpm).toBe(120)
    expect(t.tempo.periodMs).toBe(500)
    expect(t.tempo.confidence).toBe(1)
  })

  it('survives jitter and a missed beat, and folds a half-time gap back', () => {
    const t = new TempoTracker()
    feed(t, [498, 505, 1000, 495, 502, 500]) // 1000 = one onset missed at 120 BPM
    expect(t.tempo.bpm).toBeCloseTo(120, 0)
    expect(t.tempo.confidence).toBeGreaterThan(0.8)
  })

  it('doubles an implausibly fast gap into the musical range', () => {
    const t = new TempoTracker()
    feed(t, [150, 150, 150, 150, 150]) // 400 BPM: doubled twice → 600 ms = 100 BPM
    expect(t.tempo.bpm).toBe(100)
    expect(t.tempo.confidence).toBe(1)
  })

  it('reports low confidence for erratic onsets and resets', () => {
    const t = new TempoTracker()
    feed(t, [400, 900, 450, 820, 380, 700])
    expect(t.tempo.confidence).toBeLessThan(0.8)
    t.reset()
    expect(t.tempo).toEqual({ confidence: 0 })
  })
})

describe('breathingSpeed', () => {
  it('maps the musical range onto the 0..9 speed byte and clamps', () => {
    expect(breathingSpeed(undefined)).toBe(7)
    expect(breathingSpeed(undefined, 0, 5)).toBe(5)
    expect(breathingSpeed(60)).toBe(4)
    expect(breathingSpeed(120)).toBe(7)
    expect(breathingSpeed(180)).toBe(9)
    expect(breathingSpeed(180, 3)).toBe(9)
    expect(breathingSpeed(60, -9)).toBe(0)
  })
})
