/**
 * Music sync engine: one audio source, one analysis loop, any number of device sinks (keyboard per-key RGB, mouse
 * light bar / receiver) that each pace their own writes. See docs/ARCHITECTURE.md → audio.
 */
import type { RGB } from '@/model/device'
import { AudioAnalyzer, DEFAULT_ANALYZER, type AnalyzerOptions } from './analyzer'
import { captureAudio, type CapturedAudio } from './capture'
import type { TickSource } from './clock'
import { PRESETS, hsv, presetById, type MusicPreset } from './presets'
import { TempoTracker } from './tempo'
import type { AudioFrame, AudioSourceKind, LightingSink, MusicFrame, MusicSyncStatus, SinkStatus } from './types'

export interface MusicSyncOptions {
  preset: string
  color: RGB
  sensitivity: number
  /** How readily onsets are reported; >1 finds more beats (quiet or bass-light material needs it). */
  beatSensitivity: number
  /** Pick a new colour on every beat instead of using `color` / the preset's own palette. */
  randomColor: boolean
  analyzer?: Partial<AnalyzerOptions>
}

export const DEFAULT_MUSIC_OPTIONS: MusicSyncOptions = {
  preset: 'rise',
  color: { r: 155, g: 255, b: 49 },
  sensitivity: 1,
  beatSensitivity: 1,
  randomColor: false,
}

/**
 * Golden-angle hue stepping: successive colours are as far apart as possible, so a random sequence never repeats a
 * shade twice in a row the way plain `Math.random()` RGB does.
 */
const GOLDEN_ANGLE = 0.618033988749895
export function nextRandomColor(previousHue: number): { hue: number; color: RGB } {
  const hue = (previousHue + GOLDEN_ANGLE + Math.random() * 0.08) % 1
  return { hue, color: hsv(hue, 0.95, 1) }
}

export type StatusListener = (status: MusicSyncStatus) => void

/** Frame source abstraction so the engine can be driven without Web Audio in tests. */
export interface FrameSource {
  frame(now: number): AudioFrame
  close(): Promise<void>
  /** Live onset-sensitivity knob, when the source has one. */
  setBeatSensitivity?(value: number): void
}

export interface EngineHooks {
  /** Replaces `captureAudio` + `AudioAnalyzer` (tests). */
  openSource?: (kind: AudioSourceKind, deviceId?: string) => Promise<OpenedSource>
  /** Replaces `requestAnimationFrame` when the source provides no clock (tests). */
  schedule?: (cb: () => void) => number
  cancel?: (handle: number) => void
  now?: () => number
}

export interface OpenedSource {
  source: FrameSource
  stop(): void
  onEnded?: (cb: () => void) => void
  /** Drives `step`; without one the engine falls back to animation frames (which pause in background tabs). */
  clock?: TickSource
}

export class MusicSyncEngine {
  private readonly sinks = new Map<string, { sink: LightingSink; enabled: boolean }>()
  private source: FrameSource | undefined
  private stopSource: (() => void) | undefined
  private clock: TickSource | undefined
  private handle = 0
  private startedAt = 0
  private frames = 0
  private fpsWindow = 0
  private preset: MusicPreset
  private status: MusicSyncStatus
  private readonly tempoTracker = new TempoTracker()
  private beats = 0
  private beatsPublished = 0
  private randomHue = Math.random()
  private randomColor: RGB = { r: 255, g: 0, b: 0 }
  private readonly listeners = new Set<StatusListener>()
  lastFrame: AudioFrame | undefined
  options: MusicSyncOptions

  constructor(
    options: Partial<MusicSyncOptions> = {},
    private readonly hooks: EngineHooks = {},
  ) {
    this.options = { ...DEFAULT_MUSIC_OPTIONS, ...options }
    this.preset = presetById(this.options.preset)
    this.status = { running: false, preset: this.preset.id, fps: 0, beats: 0, sinks: [] }
  }

  static presets(): MusicPreset[] {
    return PRESETS
  }

  // -- sinks -------------------------------------------------------------------

  /** Registers a device; new sinks start enabled and are prepared immediately if a session is running. */
  addSink(sink: LightingSink, enabled = true): void {
    const existing = this.sinks.get(sink.id)
    if (existing) {
      if (existing.sink !== sink) void existing.sink.release().catch(() => undefined)
      this.sinks.set(sink.id, { sink, enabled })
    } else this.sinks.set(sink.id, { sink, enabled })
    if (this.status.running && enabled) void this.prepareSink(sink)
    this.refresh()
  }

  removeSink(id: string): void {
    const entry = this.sinks.get(id)
    if (!entry) return
    this.sinks.delete(id)
    if (this.status.running) void entry.sink.release().catch(() => undefined)
    this.refresh()
  }

  setEnabled(id: string, enabled: boolean): void {
    const entry = this.sinks.get(id)
    if (!entry || entry.enabled === enabled) return
    entry.enabled = enabled
    if (this.status.running) {
      if (enabled) void this.prepareSink(entry.sink)
      else void entry.sink.release().catch(() => undefined)
    }
    this.refresh()
  }

  getSink(id: string): LightingSink | undefined {
    return this.sinks.get(id)?.sink
  }

  /**
   * Applies a sink's changed options to a running session: releases it and prepares it again. Without this a
   * strategy picked mid-session would only take effect at the next start.
   */
  async refreshSink(id: string): Promise<void> {
    const entry = this.sinks.get(id)
    if (!entry || !this.status.running || !entry.enabled) return
    await entry.sink.release().catch(() => undefined)
    await this.prepareSink(entry.sink)
  }

  private async prepareSink(sink: LightingSink): Promise<void> {
    try {
      await sink.prepare()
    } catch (error) {
      this.setStatus({ error: `${sink.label}: ${(error as Error).message}` })
    }
    this.refresh()
  }

  // -- lifecycle --------------------------------------------------------------

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  getStatus(): MusicSyncStatus {
    return this.status
  }

  update(patch: Partial<MusicSyncOptions>): void {
    this.options = { ...this.options, ...patch }
    if (patch.preset) this.preset = presetById(patch.preset)
    if (patch.beatSensitivity !== undefined) this.source?.setBeatSensitivity?.(patch.beatSensitivity)
    this.setStatus({ preset: this.preset.id })
  }

  /** `deviceId`: a specific input device for `kind === 'microphone'` (see `audioInputDevices`). */
  async start(kind: AudioSourceKind, deviceId?: string): Promise<void> {
    await this.stop()
    this.setStatus({ error: undefined })
    const opened = await (this.hooks.openSource ?? ((k, d) => defaultOpenSource(k, d, this.options.analyzer)))(kind, deviceId)
    this.source = opened.source
    this.stopSource = opened.stop
    opened.onEnded?.(() => void this.stop('Audio sharing ended'))
    this.source.setBeatSensitivity?.(this.options.beatSensitivity)
    const now = this.now()
    this.startedAt = now
    this.fpsWindow = now
    this.frames = 0
    this.beats = 0
    this.beatsPublished = 0
    this.tempoTracker.reset()
    this.setStatus({ running: true, source: kind, fps: 0, beats: 0, bpm: undefined, clock: opened.clock?.kind ?? 'frame' })
    await Promise.all([...this.sinks.values()].filter((e) => e.enabled).map((e) => this.prepareSink(e.sink)))
    if (!this.source) return // stopped while the sinks were being prepared
    if (opened.clock) {
      this.clock = opened.clock
      this.clock.start(() => this.step())
    } else this.tick()
  }

  async stop(reason?: string): Promise<void> {
    if (this.handle) (this.hooks.cancel ?? cancelAnimationFrame)(this.handle)
    this.handle = 0
    this.clock?.stop()
    this.clock = undefined
    const wasRunning = this.status.running
    this.stopSource?.()
    this.stopSource = undefined
    await this.source?.close().catch(() => undefined)
    this.source = undefined
    if (wasRunning) await Promise.all([...this.sinks.values()].map((e) => e.sink.release().catch(() => undefined)))
    this.lastFrame = undefined
    this.beats = 0
    this.tempoTracker.reset()
    this.setStatus({ running: false, source: undefined, fps: 0, beats: 0, bpm: undefined, clock: undefined, ...(reason ? { error: reason } : {}) })
  }

  /** Runs one analysis step and pushes to every enabled sink (public for tests). */
  step(now = this.now()): void {
    if (!this.source) return
    const audio = this.source.frame(now)
    this.lastFrame = audio
    const t = (now - this.startedAt) / 1000
    if (audio.beat) {
      this.beats++
      this.tempoTracker.beat(now)
      // Published often enough to read as live, but not on every onset: `step` runs on the audio thread, and a
      // React render per beat there risks stalling it (and with it the whole animation).
      if (now - this.beatsPublished >= 200) {
        this.beatsPublished = now
        this.setStatus({ beats: this.beats, bpm: this.tempoTracker.tempo.bpm })
      }
      // A new colour per beat; the sinks' own rate limits decide how often the device actually follows it.
      if (this.options.randomColor) {
        const next = nextRandomColor(this.randomHue)
        this.randomHue = next.hue
        this.randomColor = next.color
      }
    }
    const color = this.options.randomColor ? this.randomColor : this.options.color
    const ctx = { t, color, sensitivity: this.options.sensitivity }
    const accent = this.preset.accent(audio, ctx)
    const frame: MusicFrame = {
      audio,
      t,
      preset: this.preset.id,
      color,
      sensitivity: this.options.sensitivity,
      beatSensitivity: this.options.beatSensitivity,
      accent: this.options.randomColor ? color : accent.color,
      intensity: accent.intensity,
    }
    for (const { sink, enabled } of this.sinks.values()) {
      if (!enabled) continue
      try {
        sink.push(frame)
      } catch (error) {
        this.setStatus({ error: `${sink.label}: ${(error as Error).message}` })
      }
    }
    this.frames++
    if (now - this.fpsWindow >= 1000) {
      this.setStatus({
        fps: Math.round((this.frames * 1000) / (now - this.fpsWindow)),
        beats: this.beats,
        bpm: this.tempoTracker.tempo.bpm,
        sinks: this.sinkStatuses(),
      })
      this.fpsWindow = now
      this.frames = 0
    }
  }

  private tick = (): void => {
    if (!this.source) return
    this.step()
    this.handle = (this.hooks.schedule ?? requestAnimationFrame)(this.tick)
  }

  private now(): number {
    return (this.hooks.now ?? (() => performance.now()))()
  }

  private sinkStatuses(): SinkStatus[] {
    return [...this.sinks.values()].map(({ sink, enabled }) => ({ ...sink.status(), enabled }))
  }

  private refresh(): void {
    this.setStatus({ sinks: this.sinkStatuses() })
  }

  private setStatus(patch: Partial<MusicSyncStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) l(this.status)
  }
}

async function defaultOpenSource(kind: AudioSourceKind, deviceId?: string, analyzerOptions?: Partial<AnalyzerOptions>): Promise<OpenedSource> {
  const capture: CapturedAudio = await captureAudio(kind, deviceId)
  let analyzer: AudioAnalyzer
  try {
    analyzer = new AudioAnalyzer(capture.stream, { ...DEFAULT_ANALYZER, ...analyzerOptions })
    await analyzer.resume()
  } catch (error) {
    capture.stop()
    throw error
  }
  return {
    source: {
      frame: (now: number) => analyzer.frame(now),
      close: () => analyzer.close(),
      setBeatSensitivity: (v: number) => analyzer.setBeatSensitivity(v),
    },
    clock: analyzer.clock(),
    stop: () => capture.stop(),
    onEnded: (cb: () => void) => capture.stream.getAudioTracks()[0]?.addEventListener('ended', cb),
  }
}

/** The app has one engine; devices register sinks with it. */
export const musicEngine = new MusicSyncEngine()
