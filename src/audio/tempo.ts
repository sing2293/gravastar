/**
 * Tempo tracking for devices that can only be updated a few times per second.
 *
 * The analyzer reports onsets frame by frame; a light that animates in firmware (the Compx mouse's breathing mode)
 * needs a *period* instead. `TempoTracker` turns beat timestamps into a stable BPM by taking the median of recent
 * inter-onset intervals, folding obvious double/half-time detections back into the base range, and reporting how
 * consistent those intervals are so callers can ignore a guess made from noise.
 */
export interface Tempo {
  /** Beats per minute, or `undefined` until enough consistent onsets have been seen. */
  bpm?: number
  /** Beat period in milliseconds. */
  periodMs?: number
  /** 0..1: the share of recent intervals agreeing with the median. */
  confidence: number
}

export interface TempoOptions {
  /** Intervals kept for the median. */
  window: number
  minBpm: number
  maxBpm: number
  /** Intervals within this fraction of the median count as agreeing. */
  tolerance: number
  /** Intervals needed before a tempo is reported at all. */
  minIntervals: number
}

export const DEFAULT_TEMPO: TempoOptions = { window: 10, minBpm: 60, maxBpm: 190, tolerance: 0.18, minIntervals: 4 }

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export class TempoTracker {
  private last: number | undefined
  private readonly intervals: number[] = []

  constructor(readonly options: TempoOptions = DEFAULT_TEMPO) {}

  /** Call once per detected onset with the frame's timestamp (ms). */
  beat(now: number): void {
    const { minBpm, maxBpm, window } = this.options
    const longest = 60000 / minBpm
    const shortest = 60000 / maxBpm
    if (this.last !== undefined) {
      let gap = now - this.last
      // Missed onsets double the gap and off-beat detections halve it: fold both into the base range.
      while (gap > longest * 1.5) gap /= 2
      while (gap > 0 && gap < shortest) gap *= 2
      if (gap >= shortest && gap <= longest * 1.5) {
        this.intervals.push(gap)
        if (this.intervals.length > window) this.intervals.shift()
      }
    }
    this.last = now
  }

  /** Forget the history (a new source, or a long silence). */
  reset(): void {
    this.last = undefined
    this.intervals.length = 0
  }

  get tempo(): Tempo {
    const { minIntervals, tolerance } = this.options
    if (this.intervals.length < minIntervals) return { confidence: 0 }
    const periodMs = median(this.intervals)
    if (!periodMs) return { confidence: 0 }
    const agreeing = this.intervals.filter((i) => Math.abs(i - periodMs) <= periodMs * tolerance).length
    return { bpm: Math.round(60000 / periodMs), periodMs, confidence: agreeing / this.intervals.length }
  }
}

/** Firmware speed byte range of the mouse light block (`0xA4`). */
export const LIGHT_SPEED_MAX = 9

/**
 * Tempo → the mouse's 0..9 breathing speed. The firmware's period at each step is **UNVERIFIED**, so this is a
 * linear guess over the musical range (60 BPM → 4, 180 BPM → 9) assuming higher = faster, plus a user offset for
 * tuning it against the real device. Without a tempo the vendor default (7) is used.
 */
export function breathingSpeed(bpm: number | undefined, offset = 0, fallback = 7): number {
  const base = bpm === undefined ? fallback : 4 + ((bpm - 60) / 120) * 5
  return Math.max(0, Math.min(LIGHT_SPEED_MAX, Math.round(base + offset)))
}
