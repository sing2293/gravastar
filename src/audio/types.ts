import type { RGB } from '@/model/device'
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

/** What a preset asks the device to show for one frame. Either per-key colours or one colour for everything. */
export type LightingFrame = { keys: PerKeyColor[] } | { all: RGB }

export interface MusicSyncStatus {
  running: boolean
  source?: AudioSourceKind
  preset: string
  /** Device writes per second actually achieved. */
  fps: number
  error?: string
}
