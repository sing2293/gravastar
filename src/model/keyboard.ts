/**
 * Keyboard contracts (currently one implementation: the GravaStar K98 Pro).
 * Units, ranges and enums follow docs/reverse-engineering/k98pro/*.md.
 */
import type { BatteryStatus, CommonEvents, DriverBase, Experimental, Modifier, NumericRange, RGB } from './device'

// ---------------------------------------------------------------------------
// Layers, OS tables, keys
// ---------------------------------------------------------------------------

/** Firmware layer index: 0 Normal, 1 Fn1, 2 Fn2, 3 "Tap" (exists in firmware, never exposed by the vendor UI). */
export type Layer = 0 | 1 | 2 | 3
export const LAYERS: ReadonlyArray<{ id: Layer; name: string; exposed: boolean }> = [
  { id: 0, name: 'Default', exposed: true },
  { id: 1, name: 'Fn', exposed: true },
  { id: 2, name: 'Fn1', exposed: true },
  { id: 3, name: 'Layer 3', exposed: false },
]

export type OsMode = 'windows' | 'macos'

/** Which keymap table a command addresses. */
export interface LayerSelector {
  layer: Layer
  os: OsMode
}

/** 16-bit device key id (1-based physical position), the address used by every per-key command. */
export type KeyId = number

/** 32-bit typed keycode exactly as the firmware stores it. Opaque to the UI; use `KeyActionCodec`. */
export type Keycode = number

export type LayoutVariant = 'us' | 'uk' | 'jp'

export interface LayoutKey {
  id: KeyId
  label: string
  /** Position and size in key units (1u = one standard keycap). */
  x: number
  y: number
  w: number
  h: number
  /** Indices into the padded UI grid (not the electrical matrix). */
  row: number
  col: number
  defaultKeycode: Keycode
  shape?: 'rect' | 'iso-enter'
  /** Only the space bar on the K98 Pro. */
  splittable?: boolean
}

export interface KeyboardLayout {
  variant: LayoutVariant
  keys: LayoutKey[]
  rows: number
  columns: number
}

export interface KeyBinding {
  id: KeyId
  keycode: Keycode
}

// ---------------------------------------------------------------------------
// Key actions — what a keycode *means*, device-agnostic
// ---------------------------------------------------------------------------

export type LightZone = 'main' | 'side' | 'logo'
export type LightingParam = 'effect' | 'direction' | 'color' | 'brightness' | 'speed'
export type LightingOp = 'cycle' | 'increase' | 'decrease'

export type MacroLoop = 'count' | 'untilKeyUp' | 'untilKeyDown'

export type KeyAction =
  | { type: 'none' }
  | { type: 'transparent' }
  | { type: 'key'; usage: number; modifiers?: Modifier[]; secondaryUsage?: number }
  | { type: 'consumer'; usage: number }
  | { type: 'mouse'; button: 1 | 2 | 3 | 4 | 5 }
  | { type: 'macro'; index: number; loop: MacroLoop; count: number }
  | { type: 'layer'; layer: Layer }
  | { type: 'lighting'; zone: LightZone; param: LightingParam; op: LightingOp }
  /** Any firmware-defined 16-bit or typed code the picker offers verbatim (media, system combos, gamepad, tri-mode…). */
  | { type: 'firmware'; keycode: Keycode; label: string; category: string }

export interface KeyCatalogEntry {
  action: KeyAction
  keycode: Keycode
  label: string
  /** Picker grouping, e.g. `basic`, `media`, `mouse`, `lighting`, `layer`, `profile`, `system`, `game`, `triMode`. */
  category: string
  /** `KeyboardEvent.code` for the on-screen key test / picker, when the action is a plain key. */
  browserCode?: string
}

export interface KeyActionCodec {
  toKeycode(action: KeyAction): Keycode
  fromKeycode(keycode: Keycode): KeyAction
  /** Short human label for any keycode (falls back to hex). */
  describe(keycode: Keycode): string
  catalog(): KeyCatalogEntry[]
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export interface KeymapService {
  read(sel: LayerSelector, ids: KeyId[]): Promise<KeyBinding[]>
  write(sel: LayerSelector, bindings: KeyBinding[]): Promise<void>
  reset(sel: LayerSelector): Promise<void>
}

export interface ProfilesInfo {
  count: number
  current: number
  names: string[]
}

export interface ProfileService {
  get(): Promise<ProfilesInfo>
  select(index: number): Promise<void>
  rename(index: number, name: string): Promise<void>
  maxNameLength: number
}

export type PollingRate = 125 | 250 | 500 | 1000 | 2000 | 4000 | 8000
export type DebounceMode = 'normal' | 'leading' | 'trailing' | 'auto'

export interface KeyboardSettings {
  osMode: OsMode
  pollingRate: PollingRate
  /** 0 = never. */
  sleepSeconds: number
  winKeyLock: boolean
  comboOptimization: boolean
  adaptiveCalibration: boolean
  debounceMode: DebounceMode
  debounceUs: number
  lowPowerMode?: boolean
  wasdArrowSwap?: boolean
}

export interface KeyboardFeatures {
  lcdDisplay: boolean
  dotMatrixDisplay: boolean
  lowPowerMode: boolean
  wirelessDedicatedChannel: boolean
  winMode: boolean
  macMode: boolean
  wasdArrowSwap: boolean
  wheel: boolean
  slider: boolean
  keyIdRGB: boolean
  fullKeysRGB: boolean
  ledBeadTable565: boolean
  ledBeadRGB565: boolean
  switchMixing: boolean
  twoStageTrigger: boolean
  maxPollingRate: PollingRate
}

export interface SettingsService {
  read(): Promise<KeyboardSettings>
  update<K extends keyof KeyboardSettings>(key: K, value: NonNullable<KeyboardSettings[K]>): Promise<void>
  features(): Promise<KeyboardFeatures>
  pollingRates(): PollingRate[]
  sleepOptions(): number[]
  debounceRange: NumericRange
}

export type ResetScope = 'all' | 'keymap' | 'lighting' | 'usb'

// Lighting -------------------------------------------------------------------

export interface LightingEffectInfo {
  id: number
  name: string
  supportsColor: boolean
  supportsSpeed: boolean
  supportsRandomColor: boolean
}

export interface ZoneLighting {
  effectId: number
  /** 0 = use `color`; ≥ 7 = random / mixed colours. */
  colorIndex: number
  color: RGB
  brightness: number
  speed: number
}

export interface PerKeyColor {
  id: KeyId
  color: RGB
}

export interface LightingCapabilities {
  zones: LightZone[]
  effects: Partial<Record<LightZone, LightingEffectInfo[]>>
  brightness: Partial<Record<LightZone, NumericRange>>
  speed: NumericRange
  /** Effect id that shows the per-key custom colours (K98 Pro: 19). */
  customEffectId?: number
  randomColorIndex: number
  /** Real-time colour streaming for music sync — reported by the device feature bitmap. */
  streaming: { perKey: boolean; fullKeys: boolean } & Experimental
  sideLightCount?: number
}

export interface LightingService {
  capabilities(): Promise<LightingCapabilities>
  get(zone: LightZone): Promise<ZoneLighting>
  set(zone: LightZone, lighting: ZoneLighting): Promise<void>
  setEffect(zone: LightZone, effectId: number): Promise<void>
  getCustomColors(ids: KeyId[]): Promise<PerKeyColor[]>
  setCustomColors(colors: PerKeyColor[]): Promise<void>
  /** Fire-and-forget frame for music sync; no reply is awaited. */
  stream(frame: PerKeyColor[]): Promise<void>
  streamAll(color: RGB): Promise<void>
}

// Macros ---------------------------------------------------------------------

export interface MacroAction {
  kind: 'key' | 'modifier' | 'mouse'
  /** HID usage (key), modifier usage 0xE0–0xE7, or mouse button bit mask. */
  code: number
  state: 'down' | 'up'
  /** Wait before this action, in ms. */
  delayMs: number
}

export interface Macro {
  name: string
  actions: MacroAction[]
}

export interface MacroCapabilities {
  maxStorageBytes: number
  maxCount: number
  maxNameBytes: number
  maxDelayMs: number
}

export interface MacroService {
  capabilities(): Promise<MacroCapabilities>
  list(): Promise<Macro[]>
  /** Rewrites the whole macro store. */
  save(macros: Macro[]): Promise<void>
  /** Storage bytes a macro list would occupy (for the UI's limit indicator). */
  storageSize(macros: Macro[]): number
}

// Performance (Hall-effect) --------------------------------------------------

/** Travel distances are in device units; `travelUnitMm` in the capabilities converts them (0.001 mm inferred). */
export interface KeyTravel {
  id: KeyId
  actuation: number
}

export interface RapidTrigger {
  id: KeyId
  enabled: boolean
  press: number
  release: number
}

export interface SafeArea {
  id: KeyId
  top: number
  bottom: number
  enabled: boolean
}

export interface KeySwitchType {
  id: KeyId
  switchType: number
}

export interface TravelSample {
  id: KeyId
  distance: number
  adc: number
  pressed: boolean
}

export interface CalibrationSample {
  id: KeyId
  adc: number
  min: number
  pressed: boolean
  finished: boolean
}

export interface AdcRange {
  id: KeyId
  min: number
  max: number
}

export interface PerformanceCapabilities extends Experimental {
  travelUnitMm: number
  travel: NumericRange
  rapidTrigger: NumericRange
  supportedSwitchTypes: number[]
  twoStageTrigger: boolean
}

export interface PerformanceService {
  capabilities(): Promise<PerformanceCapabilities>
  getTravel(sel: LayerSelector, ids: KeyId[]): Promise<KeyTravel[]>
  setTravel(sel: LayerSelector, travels: KeyTravel[]): Promise<void>
  getRapidTriggers(sel: LayerSelector, ids: KeyId[]): Promise<RapidTrigger[]>
  setRapidTriggers(sel: LayerSelector, triggers: RapidTrigger[]): Promise<void>
  getSafeAreas(ids: KeyId[]): Promise<SafeArea[]>
  setSafeAreas(areas: SafeArea[]): Promise<void>
  getSwitchTypes(ids: KeyId[]): Promise<KeySwitchType[]>
  setSwitchTypes(types: KeySwitchType[]): Promise<void>
  getAdcRanges(ids: KeyId[]): Promise<AdcRange[]>
  /** Streams `travel` events until stopped; optionally limited to ≤ 9 keys. */
  startMonitoring(ids?: KeyId[]): Promise<void>
  stopMonitoring(): Promise<void>
  /** Streams `calibration` events until stopped. */
  startCalibration(): Promise<void>
  stopCalibration(): Promise<void>
}

// Advanced keys --------------------------------------------------------------

export type AdvancedKeyType = 'TGL' | 'MT' | 'DKS' | 'SOCD' | 'MPT' | 'END' | 'RS'

export type SocdMode = 'neutral' | 'lastWins' | 'firstWins' | 'key1Wins' | 'key2Wins' | 'bothActive'

export type DksTrigger = 'none' | 'duringPress' | 'startPress' | 'instant' | 'endPress' | 'startAndEnd'

export interface DksGroup {
  keycode: Keycode
  triggers: { start: DksTrigger; bottom: DksTrigger; bottomRelease: DksTrigger; fullRelease: DksTrigger }
}

export type AdvancedKey =
  | { type: 'TGL'; id: KeyId; keycode: Keycode; delayMs: number }
  | { type: 'MT'; id: KeyId; holdKeycode: Keycode; clickKeycode: Keycode; delayMs: number }
  | { type: 'DKS'; id: KeyId; depths: { start: number; bottom: number; bottomRelease: number; fullRelease: number }; groups: DksGroup[] }
  | { type: 'SOCD'; ids: KeyId[]; mode: SocdMode }
  | { type: 'MPT'; id: KeyId; points: { keycode: Keycode; distance: number }[] }
  | { type: 'END'; id: KeyId; keycode: Keycode }
  | { type: 'RS'; ids: [KeyId, KeyId] }

export interface AdvancedKeyService {
  supportedTypes(): Promise<AdvancedKeyType[]>
  list(sel: LayerSelector): Promise<AdvancedKey[]>
  set(sel: LayerSelector, key: AdvancedKey): Promise<void>
  delete(sel: LayerSelector, key: AdvancedKey): Promise<void>
}

// Display --------------------------------------------------------------------

export interface DisplayCapabilities {
  lcd: boolean
  led: boolean
  width: number
  height: number
  maxFileBytes: number
}

/** A GIF (single- or multi-frame) already scaled to the panel size. */
export interface DisplayImage {
  gif: Uint8Array
  width: number
  height: number
  fps: number
}

export interface DisplayService {
  capabilities(): Promise<DisplayCapabilities>
  upload(image: DisplayImage, onProgress?: (fraction: number) => void): Promise<void>
  syncTime(date?: Date): Promise<void>
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export interface KeyboardCapabilities {
  layout: KeyboardLayout
  layers: Layer[]
  osModes: OsMode[]
  profiles: number
  features: KeyboardFeatures
}

export interface LightingChangeEvent {
  zone: LightZone
  param: LightingParam
  value: number
  color?: RGB
}

export interface KeyboardEvents extends CommonEvents {
  travel: TravelSample[]
  calibration: CalibrationSample[]
  'profile-change': number
  'os-change': OsMode
  'lighting-change': LightingChangeEvent
  battery: BatteryStatus
}

export interface KeyboardDriver extends DriverBase<KeyboardEvents> {
  readonly kind: 'keyboard'
  capabilities(): Promise<KeyboardCapabilities>
  readonly actions: KeyActionCodec
  readonly keymap: KeymapService
  readonly lighting: LightingService
  readonly profiles: ProfileService
  readonly settings: SettingsService
  readonly macros?: MacroService
  readonly performance?: PerformanceService
  readonly advancedKeys?: AdvancedKeyService
  readonly display?: DisplayService
  reset(scope: ResetScope, sel?: LayerSelector): Promise<void>
}
