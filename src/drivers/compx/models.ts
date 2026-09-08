/**
 * Per-model configuration the vendor ships as `cfg.json` (GravaStar entries: CID 18, MID 1–5).
 * Doc: docs/reverse-engineering/mouse/02-features.md §2.1, §5.1, §7.2, §8.
 */
import type { RGB } from '@/model/device'
import type { MouseKeyFunction, ReportRate } from '@/model/mouse'
import { SENSORS, type SensorSpec } from './eeprom'

export interface KeyDef {
  slot: number
  label: string
  defaultFn: MouseKeyFunction
}

export interface MouseModel {
  cid: number
  mid: number
  sensor: SensorSpec
  maxDpi: number
  dpiStages: { dpi: number; color: RGB }[]
  currentStage: number
  reportRate: ReportRate
  keys: KeyDef[]
  debounce: { default: number; max: number; warnBelow: number }
  sleepDefault: number
  lightDefault: { mode: number; brightness: number; speed: number; movingOff: boolean }
  hasLighting: boolean
}

const RED: RGB = { r: 255, g: 0, b: 0 }
const BLUE: RGB = { r: 0, g: 0, b: 255 }
const GREEN: RGB = { r: 0, g: 255, b: 0 }
const YELLOW: RGB = { r: 255, g: 255, b: 0 }
const CYAN: RGB = { r: 0, g: 255, b: 255 }
const MAGENTA: RGB = { r: 255, g: 0, b: 255 }

const DEFAULT_STAGES = [
  { dpi: 800, color: RED },
  { dpi: 1200, color: BLUE },
  { dpi: 1600, color: GREEN },
  { dpi: 2400, color: YELLOW },
  { dpi: 3200, color: CYAN },
  { dpi: 6400, color: MAGENTA },
]

/** Six physical keys; slot order follows the firmware, labels are ours. */
export const GRAVASTAR_KEYS: KeyDef[] = [
  { slot: 0, label: 'Left', defaultFn: { type: 'button', button: 'left' } },
  { slot: 1, label: 'Right', defaultFn: { type: 'button', button: 'right' } },
  { slot: 2, label: 'Wheel click', defaultFn: { type: 'button', button: 'middle' } },
  { slot: 3, label: 'Side back', defaultFn: { type: 'button', button: 'back' } },
  { slot: 4, label: 'Side forward', defaultFn: { type: 'button', button: 'forward' } },
  { slot: 5, label: 'DPI', defaultFn: { type: 'dpi', action: 'loop' } },
]

function model(mid: number, sensor: SensorSpec, maxDpi: number, sleepDefault: number, light: MouseModel['lightDefault']): MouseModel {
  return {
    cid: 18,
    mid,
    sensor,
    maxDpi,
    dpiStages: DEFAULT_STAGES,
    currentStage: 2,
    reportRate: 1000,
    keys: GRAVASTAR_KEYS,
    debounce: { default: 8, max: 15, warnBelow: 8 },
    sleepDefault,
    lightDefault: light,
    hasLighting: true,
  }
}

export const MODELS: MouseModel[] = [
  model(1, SENSORS['3395']!, 26000, 6, { mode: 0, brightness: 9, speed: 7, movingOff: true }),
  model(2, SENSORS['3395']!, 26000, 6, { mode: 0, brightness: 9, speed: 7, movingOff: false }),
  model(3, SENSORS['3950']!, 32000, 1, { mode: 0, brightness: 4, speed: 7, movingOff: true }),
  model(4, SENSORS['3950']!, 32000, 1, { mode: 0, brightness: 4, speed: 7, movingOff: true }),
  model(5, SENSORS['3950']!, 32000, 1, { mode: 1, brightness: 4, speed: 7, movingOff: true }),
]

export function findModel(cid: number, mid: number): MouseModel | undefined {
  return MODELS.find((m) => m.cid === cid && m.mid === mid)
}

/** Reasonable stand-in for an unknown Compx mouse (3950-class sensor). */
export const FALLBACK_MODEL: MouseModel = model(0, SENSORS['3950']!, 30000, 1, { mode: 0, brightness: 4, speed: 7, movingOff: true })

/** Idle timer choices (units of 10 s on the wire) → seconds. */
export const SLEEP_OPTIONS_SECONDS = [10, 30, 60, 120, 300, 600, 900]
export const PERFORMANCE_OPTIONS_SECONDS = [10, 30, 60, 120, 300, 600, 900]

export const LIGHT_MODES = [
  { id: 0, name: 'Off', supportsColor: false, supportsSpeed: false, supportsBrightness: false },
  { id: 1, name: 'Rainbow', supportsColor: false, supportsSpeed: true, supportsBrightness: true },
  { id: 2, name: 'Single-colour breathing', supportsColor: true, supportsSpeed: true, supportsBrightness: true },
  { id: 3, name: 'Fixed colour', supportsColor: true, supportsSpeed: false, supportsBrightness: true },
  { id: 4, name: 'Neon', supportsColor: false, supportsSpeed: true, supportsBrightness: true },
  { id: 5, name: 'Rainbow breathing', supportsColor: false, supportsSpeed: true, supportsBrightness: true },
]
