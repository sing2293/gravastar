/**
 * Mouse contracts (Compx-based GravaStar mice: Mercury M1 Pro / M2 / X / X Pro).
 * Units, ranges and enums follow docs/reverse-engineering/mouse/*.md.
 */
import type { CommonEvents, DriverBase, Modifier, NumericRange, RGB } from './device'

// DPI ------------------------------------------------------------------------

export interface DpiStage {
  dpiX: number
  dpiY: number
  color: RGB
}

export interface DpiSettings {
  /** Active stages, 1..maxStages. */
  stageCount: number
  /** 0-based. */
  current: number
  /** Always `maxStages` entries; only the first `stageCount` are active. */
  stages: DpiStage[]
}

export interface DpiCapabilities {
  range: NumericRange
  maxStages: number
  separateXY: boolean
  stageColors: boolean
}

export interface DpiService {
  capabilities(): Promise<DpiCapabilities>
  get(): Promise<DpiSettings>
  setStageCount(count: number): Promise<void>
  setCurrent(index: number): Promise<void>
  setStage(index: number, stage: Partial<DpiStage>): Promise<void>
}

// Report rate ----------------------------------------------------------------

export type ReportRate = 125 | 250 | 500 | 1000 | 2000 | 4000 | 8000

export interface ReportRateService {
  options(): Promise<ReportRate[]>
  get(): Promise<ReportRate>
  set(rate: ReportRate): Promise<void>
}

// Sensor ---------------------------------------------------------------------

export type SensorMode = 'lowPower' | 'highPerformance' | 'corded'

export interface SensorSettings {
  /** Lift-off distance code (see `SensorCapabilities.lodOptions`). */
  lod: number
  motionSync: boolean
  rippleControl: boolean
  angleSnap: boolean
  /** "Highest performance" mode and how long it stays on, in seconds. */
  performanceMode: boolean
  performanceSeconds: number
  sensorMode: SensorMode
  angleTune?: number
}

export interface SensorCapabilities {
  sensor: string
  lodOptions: { value: number; label: string }[]
  performanceSecondsOptions: number[]
  supports: {
    lod: boolean
    motionSync: boolean
    rippleControl: boolean
    angleSnap: boolean
    performanceMode: boolean
    sensorMode: boolean
    angleTune: boolean
  }
}

export interface SensorService {
  capabilities(): Promise<SensorCapabilities>
  get(): Promise<SensorSettings>
  update<K extends keyof SensorSettings>(key: K, value: NonNullable<SensorSettings[K]>): Promise<void>
  /** What the mode selector may show/edit given the current rate and link (vendor rule). */
  sensorModeState(): Promise<{ value: SensorMode; editable: boolean }>
}

// Keys -----------------------------------------------------------------------

export type MouseButton = 'left' | 'right' | 'middle' | 'back' | 'forward'

export type MacroCycles = number | 'untilPressedAgain' | 'untilReleased' | 'untilAnyKey'

export type MouseKeyFunction =
  | { type: 'disabled' }
  | { type: 'button'; button: MouseButton }
  | { type: 'dpi'; action: 'loop' | 'up' | 'down' }
  | { type: 'scroll'; direction: 'left' | 'right' | 'up' | 'down' }
  | { type: 'fire'; times: number; interval: number }
  | { type: 'combo'; modifiers: Modifier[]; usage: number }
  | { type: 'media'; usage: number }
  | { type: 'macro'; cycles: MacroCycles }
  | { type: 'reportRateSwitch' }
  | { type: 'dpiLock'; dpi: number }
  | { type: 'raw'; functionType: number; param: number }

export interface MouseKeySlot {
  /** Firmware slot 0..15. */
  slot: number
  label: string
  fn: MouseKeyFunction
  /** Present when `fn.type === 'macro'`; stored in the same slot. */
  macro?: MouseMacro
}

export interface MouseMacroEvent {
  kind: 'key' | 'modifier' | 'mouse'
  code: number
  state: 'down' | 'up'
  delayMs: number
}

export interface MouseMacro {
  name: string
  events: MouseMacroEvent[]
}

export interface MouseMacroCapabilities {
  maxEvents: number
  maxNameBytes: number
  delayRange: NumericRange
}

export interface MouseKeyService {
  /** Physical keys of this model with their current functions. */
  list(): Promise<MouseKeySlot[]>
  set(slot: number, fn: MouseKeyFunction, macro?: MouseMacro): Promise<void>
  restore(slot: number): Promise<void>
  macroCapabilities(): MouseMacroCapabilities
  /** Debounce in ms plus the model's allowed range and warning threshold. */
  getDebounce(): Promise<number>
  setDebounce(ms: number): Promise<void>
  debounceRange: NumericRange & { warnBelow?: number }
}

// Lighting -------------------------------------------------------------------

export interface MouseLightModeInfo {
  id: number
  name: string
  supportsColor: boolean
  supportsSpeed: boolean
  supportsBrightness: boolean
}

export interface MouseLighting {
  on: boolean
  mode: number
  color: RGB
  /** 0..9 */
  speed: number
  /** 0..9 */
  brightness: number
  offWhileMoving: boolean
}

export interface MouseLightingService {
  modes(): Promise<MouseLightModeInfo[]>
  get(): Promise<MouseLighting>
  set(lighting: Partial<MouseLighting>): Promise<void>
  supported(): Promise<boolean>
}

// Power / misc ---------------------------------------------------------------

export interface MousePowerService {
  /** Idle time before sleep / light-off, in seconds; `options()` lists the model's choices. */
  getSleepSeconds(): Promise<number>
  setSleepSeconds(seconds: number): Promise<void>
  options(): number[]
}

export interface MouseProfileService {
  count: number
  get(): Promise<{ current: number; supported: boolean }>
  select(index: number): Promise<void>
}

export interface DongleService {
  version(): Promise<string | undefined>
  longRange(): Promise<{ supported: boolean; enabled: boolean }>
  setLongRange(enabled: boolean): Promise<void>
  pair(onStatus: (status: 'pairing' | 'success' | 'failed', secondsLeft: number) => void): Promise<'success' | 'failed'>
}

// Music sync --------------------------------------------------------------

/**
 * How a mouse can follow music, discovered at run time (docs/reverse-engineering/mouse/02-features.md §16 and
 * 01-transport-commands.md §11: commands 0xB2/0xB6 exist for keyboards; the mouse light bar is memory-backed).
 */
export interface MouseMusicCapabilities {
  /** Firmware acknowledged the amplitude command (0xB6): real-time, no memory wear. */
  amplitudeStream: boolean
  /** The receiver's RGB bar answers 0x19: command-driven, safe to update a few times per second. */
  dongleBar: boolean
  /** The light bar itself: settings-memory writes — usable only with a strict write budget. */
  flashLight: boolean
}

export interface MusicAmplitudeParams {
  mode: number
  speed: number
  brightness: number
  colorMode: number
  forward: RGB
  backward: RGB
}

export interface DongleBar {
  mode: number
  color: RGB
  speed: number
  brightness: number
  time: number
}

/** One light-block write: the firmware animates `mode` itself (2 = breathing, 3 = fixed colour). */
export interface MouseLightEffect {
  mode: number
  color: RGB
  /** 0..9; only animated modes use it. */
  speed: number
  /** 0..9 */
  brightness: number
}

export interface MouseMusicService {
  probe(): Promise<MouseMusicCapabilities>
  /** Remember lighting / receiver state so `restore` can put it back. */
  snapshot(): Promise<void>
  restore(): Promise<void>
  /** 0xB2: enter amplitude-driven mode with the given look. */
  startAmplitude(params: MusicAmplitudeParams): Promise<void>
  /** 0xB6: 20 levels 0..15, packed two per byte. Fire-and-forget; callers pace to ≤ ~10/s. */
  sendAmplitudes(levels: ArrayLike<number>): Promise<void>
  /** 0x18: receiver RGB bar. */
  setDongleBar(bar: DongleBar): Promise<void>
  /**
   * Light-bar block write in settings memory (mode included, so the firmware's own breathing can be used instead of
   * driving every frame from the host). Callers MUST rate-limit and budget these writes.
   */
  setLightEffect(effect: MouseLightEffect): Promise<void>
  /** `setLightEffect` with the stored speed and the fixed-colour mode. */
  setLightColor(color: RGB, brightness: number): Promise<void>
}

export interface MouseInfo {
  cid: number
  mid: number
  sensor: string
  maxReportRate: ReportRate
}

export interface MouseCapabilities {
  model: MouseInfo
  keys: { slot: number; label: string }[]
  hasLighting: boolean
  hasDongle: boolean
}

export interface MouseEvents extends CommonEvents {
  'dpi-change': number
  'report-rate-change': ReportRate
  'profile-change': number
  'lighting-change': MouseLighting
  'sensor-change': Partial<SensorSettings>
}

export interface MouseDriver extends DriverBase<MouseEvents> {
  readonly kind: 'mouse'
  capabilities(): Promise<MouseCapabilities>
  readonly dpi: DpiService
  readonly reportRate: ReportRateService
  readonly sensor: SensorService
  readonly keys: MouseKeyService
  readonly lighting: MouseLightingService
  readonly power: MousePowerService
  readonly profiles: MouseProfileService
  readonly dongle?: DongleService
  readonly music?: MouseMusicService
  factoryReset(): Promise<void>
  /** Raw 16 KiB settings image, for export/import (`.bin`, Compx-compatible). */
  exportSettings(): Promise<Uint8Array>
  importSettings(image: Uint8Array): Promise<void>
}
