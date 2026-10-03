import type { DeviceKind, RGB } from '@/model/device'
import type { PerKeyColor } from '@/model/keyboard'

export type AudioSourceKind = 'system' | 'tab' | 'microphone'

export interface AudioSourceInfo {
  kind: AudioSourceKind
  label: string
  /** Whether this browser/OS can offer the source at all (system audio needs Chrome ≥ 141 on macOS ≥ 14.2). */
  available: boolean
  hint?: string
}

/** One analysis frame, produced on every animation frame while a source is active. */
export interface AudioFrame {
  /** `performance.now()` of the frame. */
  time: number
  /** Overall loudness 0..1 (normalised RMS with slow AGC). */
  level: number
  /** N equal-log-width bands, each 0..1. */
  bands: Float32Array
  bass: number
  mid: number
  treble: number
  /** True on frames where an onset was detected. */
  beat: boolean
  /** 0..1 strength of the detected onset (0 when `beat` is false). */
  beatStrength: number
}

/** What a preset asks a keyboard to show for one frame. Either per-key colours or one colour for everything. */
export type LightingFrame = { keys: PerKeyColor[] } | { all: RGB }

/** What every sink receives per tick; keyboard sinks render the preset themselves (they own a layout). */
export interface MusicFrame {
  audio: AudioFrame
  /** Seconds since the session started. */
  t: number
  /** Preset id and user options, so sinks can render or derive colours consistently. */
  preset: string
  color: RGB
  sensitivity: number
  /** The onset-sensitivity knob, for sinks that run their own per-band detector. */
  beatSensitivity: number
  /** Single accent colour + intensity for devices with one light (mouse bar, receiver). */
  accent: RGB
  intensity: number
}

export interface SinkStatus {
  id: string
  label: string
  kind: DeviceKind
  enabled: boolean
  /** Prepared and receiving frames. */
  active: boolean
  /** Device writes per second actually achieved. */
  fps: number
  /** Total writes this session (matters for memory-backed devices). */
  writes: number
  /** Of those, writes that landed in the device's settings memory (the mouse light block). */
  memoryWrites?: number
  /** How the sink drives the device, e.g. "per-key streaming", "receiver bar", "gentle (memory-safe)". */
  mode?: string
  note?: string
  error?: string
}

/**
 * A device the engine can light up. Sinks own their pacing: `push` must return immediately and drop frames when
 * the device is busy or when the sink's rate limit / write budget says so.
 */
export interface LightingSink {
  readonly id: string
  readonly label: string
  readonly kind: DeviceKind
  /** Snapshot the current lighting and put the device in a mode where pushed frames are visible. */
  prepare(): Promise<void>
  push(frame: MusicFrame): void
  /** Restore the snapshot taken by `prepare`. */
  release(): Promise<void>
  status(): Omit<SinkStatus, 'enabled'>
}

export interface MusicSyncStatus {
  running: boolean
  source?: AudioSourceKind
  preset: string
  /** Analysis frames per second. */
  fps: number
  /** Onsets detected this session, and the tempo derived from them. */
  beats: number
  bpm?: number
  sinks: SinkStatus[]
  /** `audio`: ticks come from the audio thread and survive the tab going to the background; `frame`: page-driven. */
  clock?: 'audio' | 'frame'
  error?: string
}
