import { audioClock, frameClock, supportsAudioClock, type TickSource } from './clock'
import type { AudioFrame } from './types'

export interface AnalyzerOptions {
  bands: number
  fftSize: number
  /** AnalyserNode smoothing (0..1). */
  smoothing: number
/**
   * How far above the running spectral-flux average an onset must rise, in standard deviations. Lower = more beats.
   */
  beatThreshold: number
  minBeatIntervalMs: number
}

export const DEFAULT_ANALYZER: AnalyzerOptions = { bands: 24, fftSize: 2048, smoothing: 0.55, beatThreshold: 1.6, minBeatIntervalMs: 140 }

/** Frames of spectral flux kept for the adaptive threshold (≈ 1 s at the audio-thread tick rate). */
const FLUX_WINDOW = 48

/** Pure FFT-bin → log-spaced band mapping and feature extraction, kept separate from Web Audio for tests. */
export class FeatureExtractor {
  private readonly edges: number[]
  private readonly bandBuf: Float32Array
  private readonly prevBands: Float32Array
  private readonly fluxHistory: number[] = []
  private fluxPeak = 1e-4
  private lastBeat = -Infinity
  private peak = 0.05
  /**
   * Multiplies how easily onsets are reported: 1 = as configured, >1 = more beats. The user can move this while a
   * session runs (quiet or bass-light material needs a higher value).
   */
  beatSensitivity = 1

  constructor(
    readonly options: AnalyzerOptions,
    readonly sampleRate: number,
    readonly binCount: number,
  ) {
    const nyquist = sampleRate / 2
    const lo = 40
    const hi = Math.min(16000, nyquist)
    this.edges = Array.from({ length: options.bands + 1 }, (_, i) => Math.round((lo * Math.pow(hi / lo, i / options.bands)) / (nyquist / binCount)))
    this.bandBuf = new Float32Array(options.bands)
    this.prevBands = new Float32Array(options.bands)
  }

  private bandLevel(mag: Uint8Array, fromHz: number, toHz: number): number {
    const perBin = this.sampleRate / 2 / this.binCount
    const a = Math.max(0, Math.floor(fromHz / perBin))
    const b = Math.min(mag.length, Math.ceil(toHz / perBin))
    let sum = 0
    for (let i = a; i < b; i++) sum += mag[i]! / 255
    return b > a ? sum / (b - a) : 0
  }

  /** `mag`: AnalyserNode byte frequency data, `time`: byte time-domain data. */
  extract(mag: Uint8Array, time: Uint8Array, now: number): AudioFrame {
    const bands = this.bandBuf
    for (let i = 0; i < this.options.bands; i++) {
      const a = this.edges[i]!
      const b = Math.max(a + 1, this.edges[i + 1]!)
      let sum = 0
      for (let k = a; k < b && k < mag.length; k++) sum += mag[k]! / 255
      bands[i] = Math.min(1, sum / (b - a))
    }
    let sq = 0
    for (let i = 0; i < time.length; i++) {
      const v = (time[i]! - 128) / 128
      sq += v * v
    }
    const rms = Math.sqrt(sq / Math.max(1, time.length))
    // Slow automatic gain: track the peak with decay so quiet and loud sources both fill the range.
    this.peak = Math.max(rms, this.peak * 0.995, 0.02)
    const level = Math.min(1, rms / this.peak)
    const bass = this.bandLevel(mag, 40, 160)
    const mid = this.bandLevel(mag, 160, 2000)
    const treble = this.bandLevel(mag, 2000, 12000)
    /*
     * Onset detection by spectral flux: the sum of how much each band *rose* since the last frame, weighted toward
     * the low end. Unlike a raw bass-energy gate this needs no absolute loudness — a quiet stream or a bass-light
     * track produces the same flux shape as a loud one — and it fires on any percussive attack, not only kicks.
     * The threshold follows the recent average plus a few standard deviations, so it adapts to the material.
     */
    let flux = 0
    for (let i = 0; i < bands.length; i++) {
      const rise = bands[i]! - this.prevBands[i]!
      if (rise > 0) flux += rise * (i < bands.length / 3 ? 1.5 : 1)
    }
    flux /= bands.length
    this.prevBands.set(bands)
    const hist = this.fluxHistory
    let mean = 0
    for (const f of hist) mean += f
    mean = hist.length ? mean / hist.length : 0
    let variance = 0
    for (const f of hist) variance += (f - mean) * (f - mean)
    const sd = hist.length ? Math.sqrt(variance / hist.length) : 0
    const k = Math.max(0.2, this.beatSensitivity)
    const threshold = mean + sd * (this.options.beatThreshold / k)
    // Peak-relative floor (decaying, like the level AGC) so steady noise never registers as a stream of onsets.
    this.fluxPeak = Math.max(flux, this.fluxPeak * 0.998, 1e-4)
    const floor = this.fluxPeak * (0.12 / k)
    let beat = false
    let beatStrength = 0
    if (hist.length >= 8 && flux > Math.max(threshold, floor) && now - this.lastBeat > this.options.minBeatIntervalMs) {
      beat = true
      beatStrength = Math.min(1, (flux - threshold) / Math.max(threshold, this.fluxPeak * 0.25))
      this.lastBeat = now
    }
    hist.push(flux)
    if (hist.length > FLUX_WINDOW) hist.shift()
    return { time: now, level, bands: Float32Array.from(bands), bass, mid, treble, beat, beatStrength }
  }
}

/** Web Audio wrapper around `FeatureExtractor`. */
export class AudioAnalyzer {
  private readonly ctx: AudioContext
  private readonly analyser: AnalyserNode
  private readonly source: MediaStreamAudioSourceNode
  private readonly mag: Uint8Array<ArrayBuffer>
  private readonly time: Uint8Array<ArrayBuffer>
  private readonly extractor: FeatureExtractor

  constructor(stream: MediaStream, options: AnalyzerOptions = DEFAULT_ANALYZER) {
    this.ctx = new AudioContext()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = options.fftSize
    this.analyser.smoothingTimeConstant = options.smoothing
    this.source = this.ctx.createMediaStreamSource(stream)
    this.source.connect(this.analyser)
    this.mag = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
    this.time = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))
    this.extractor = new FeatureExtractor(options, this.ctx.sampleRate, this.analyser.frequencyBinCount)
  }

  /** Live knob: >1 reports more onsets. */
  setBeatSensitivity(value: number): void {
    this.extractor.beatSensitivity = value
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume()
  }

  /** A tick source that keeps its cadence while the tab is in the background (see clock.ts). */
  clock(targetMs = 20): TickSource {
    return supportsAudioClock(this.ctx) ? audioClock(this.ctx, this.source, targetMs) : frameClock(targetMs)
  }

  frame(now = performance.now()): AudioFrame {
    this.analyser.getByteFrequencyData(this.mag)
    this.analyser.getByteTimeDomainData(this.time)
    return this.extractor.extract(this.mag, this.time, now)
  }

  async close(): Promise<void> {
    this.source.disconnect()
    await this.ctx.close()
  }
}
