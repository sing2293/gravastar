/**
 * Onset detection for a single scalar signal — one frequency band, rather than the whole spectrum the analyzer
 * watches. A device that should react to the bass line or to the hi-hats needs its own trigger: the same adaptive
 * rule as `FeatureExtractor` (recent mean plus a few standard deviations, with a refractory period) applied to
 * whichever band the user picked.
 */
export interface OnsetOptions {
  /** Samples kept for the running statistics. */
  window: number
  /** How many standard deviations above the mean counts as an onset. Lower = more triggers. */
  threshold: number
  /** Shortest gap between two onsets, ms. */
  refractoryMs: number
  /** Fraction of the running peak a value must also reach, so steady noise never triggers. */
  floor: number
}

export const DEFAULT_ONSET: OnsetOptions = { window: 40, threshold: 1.4, refractoryMs: 110, floor: 0.2 }

export interface OnsetResult {
  onset: boolean
  /** 0..1 — how far past the threshold this sample was. */
  strength: number
  /** The sample scaled by the running peak: a level that fills the range on quiet and loud material alike. */
  normalized: number
}

export class OnsetDetector {
  private readonly history: number[] = []
  private peak = 1e-4
  private last = -Infinity
  private previous = 0

  constructor(readonly options: OnsetOptions = DEFAULT_ONSET) {}

  reset(): void {
    this.history.length = 0
    this.peak = 1e-4
    this.last = -Infinity
    this.previous = 0
  }

  /** `value`: the band's current level (0..1). `sensitivity` > 1 makes onsets easier. */
  feed(value: number, now: number, sensitivity = 1): OnsetResult {
    const v = Math.max(0, value)
    // Rises only: a band falling away is not an attack.
    const rise = Math.max(0, v - this.previous)
    this.previous = v
    this.peak = Math.max(v, this.peak * 0.999, 1e-4)
    const hist = this.history
    let mean = 0
    for (const h of hist) mean += h
    mean = hist.length ? mean / hist.length : 0
    let variance = 0
    for (const h of hist) variance += (h - mean) * (h - mean)
    const sd = hist.length ? Math.sqrt(variance / hist.length) : 0
    const k = Math.max(0.2, sensitivity)
    const threshold = mean + sd * (this.options.threshold / k)
    let onset = false
    let strength = 0
    if (
      hist.length >= 8 &&
      rise > threshold &&
      v >= this.peak * (this.options.floor / k) &&
      now - this.last >= this.options.refractoryMs
    ) {
      onset = true
      strength = Math.min(1, (rise - threshold) / Math.max(threshold, this.peak * 0.2))
      this.last = now
    }
    hist.push(rise)
    if (hist.length > this.options.window) hist.shift()
    return { onset, strength, normalized: Math.min(1, v / this.peak) }
  }
}
