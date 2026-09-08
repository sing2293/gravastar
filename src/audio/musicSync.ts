/**
 * Music sync engine: captures audio, analyses it on every animation frame, renders a preset into a lighting frame
 * and streams it to the keyboard at a bounded rate (docs/ARCHITECTURE.md → audio).
 */
import type { RGB } from '@/model/device'
import type { KeyboardDriver, KeyboardLayout, ZoneLighting } from '@/model/keyboard'
import { AudioAnalyzer, DEFAULT_ANALYZER, type AnalyzerOptions } from './analyzer'
import { captureAudio, type CapturedAudio } from './capture'
import { PRESETS, presetById, type MusicPreset } from './presets'
import type { AudioFrame, AudioSourceKind, LightingFrame, MusicSyncStatus } from './types'

export interface MusicSyncOptions {
  preset: string
  color: RGB
  sensitivity: number
  /** Device writes per second, upper bound. */
  maxFps: number
  analyzer?: Partial<AnalyzerOptions>
}

export const DEFAULT_MUSIC_OPTIONS: MusicSyncOptions = { preset: 'spectrum', color: { r: 155, g: 255, b: 49 }, sensitivity: 1, maxFps: 30 }

export type StatusListener = (status: MusicSyncStatus) => void

export class MusicSyncEngine {
  private capture: CapturedAudio | undefined
  private analyzer: AudioAnalyzer | undefined
  private raf = 0
  private startedAt = 0
  private lastSend = 0
  private sending = false
  private sentCount = 0
  private fpsWindowStart = 0
  private previousLighting: ZoneLighting | undefined
  private preset: MusicPreset
  private status: MusicSyncStatus
  private readonly listeners = new Set<StatusListener>()
  lastFrame: AudioFrame | undefined
  lastLighting: LightingFrame | undefined
  options: MusicSyncOptions

  constructor(
    private readonly driver: KeyboardDriver,
    private readonly layout: KeyboardLayout,
    options: Partial<MusicSyncOptions> = {},
  ) {
    this.options = { ...DEFAULT_MUSIC_OPTIONS, ...options }
    this.preset = presetById(this.options.preset)
    this.status = { running: false, preset: this.preset.id, fps: 0 }
  }

  static presets(): MusicPreset[] {
    return PRESETS
  }

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
    if (patch.preset) {
      this.preset = presetById(patch.preset)
      this.setStatus({ preset: this.preset.id })
    }
  }

  async start(source: AudioSourceKind): Promise<void> {
    await this.stop()
    this.setStatus({ error: undefined })
    const capture = await captureAudio(source)
    try {
      this.analyzer = new AudioAnalyzer(capture.stream, { ...DEFAULT_ANALYZER, ...this.options.analyzer })
      await this.analyzer.resume()
      // Put the keyboard in per-key ("custom") mode so streamed colours are visible; remember what to restore.
      const caps = await this.driver.lighting.capabilities()
      this.previousLighting = await this.driver.lighting.get('main')
      if (caps.customEffectId !== undefined && this.previousLighting.effectId !== caps.customEffectId) await this.driver.lighting.setEffect('main', caps.customEffectId)
    } catch (error) {
      capture.stop()
      await this.analyzer?.close().catch(() => undefined)
      this.analyzer = undefined
      this.setStatus({ running: false, error: (error as Error).message })
      throw error
    }
    this.capture = capture
    capture.stream.getAudioTracks()[0]?.addEventListener('ended', () => void this.stop('Audio sharing ended'))
    this.startedAt = performance.now()
    this.fpsWindowStart = this.startedAt
    this.sentCount = 0
    this.setStatus({ running: true, source, fps: 0 })
    this.loop()
  }

  async stop(reason?: string): Promise<void> {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    const wasRunning = this.status.running
    this.capture?.stop()
    this.capture = undefined
    await this.analyzer?.close().catch(() => undefined)
    this.analyzer = undefined
    if (wasRunning && this.previousLighting) {
      try {
        await this.driver.lighting.set('main', this.previousLighting)
      } catch {
        /* keyboard may be gone */
      }
    }
    this.previousLighting = undefined
    this.lastFrame = undefined
    this.setStatus({ running: false, source: undefined, fps: 0, ...(reason ? { error: reason } : {}) })
  }

  private loop = (): void => {
    if (!this.analyzer) return
    const now = performance.now()
    const frame = this.analyzer.frame(now)
    this.lastFrame = frame
    const interval = 1000 / this.options.maxFps
    if (!this.sending && now - this.lastSend >= interval) {
      const lighting = this.preset.render(frame, { layout: this.layout, t: (now - this.startedAt) / 1000, color: this.options.color, sensitivity: this.options.sensitivity })
      this.lastLighting = lighting
      this.lastSend = now
      this.sending = true
      const send = 'all' in lighting ? this.driver.lighting.streamAll(lighting.all) : this.driver.lighting.stream(lighting.keys)
      send
        .then(() => {
          this.sentCount++
          if (now - this.fpsWindowStart >= 1000) {
            this.setStatus({ fps: Math.round((this.sentCount * 1000) / (now - this.fpsWindowStart)) })
            this.fpsWindowStart = now
            this.sentCount = 0
          }
        })
        .catch((error: Error) => this.setStatus({ error: error.message }))
        .finally(() => {
          this.sending = false
        })
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  private setStatus(patch: Partial<MusicSyncStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const l of this.listeners) l(this.status)
  }
}

const engines = new Map<string, MusicSyncEngine>()

/** One engine per device so the panel can be closed and reopened without stopping the music. */
export function musicEngineFor(id: string, driver: KeyboardDriver, layout: KeyboardLayout): MusicSyncEngine {
  let e = engines.get(id)
  if (!e) engines.set(id, (e = new MusicSyncEngine(driver, layout)))
  return e
}
