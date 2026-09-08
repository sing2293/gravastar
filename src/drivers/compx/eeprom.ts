/**
 * Compx mouse settings live in a 16 KiB EEPROM image; this module knows the address map and the record encodings.
 * Verified against HIDHandle.js (`MouseEepromAddr` 255–298, `Update_Mouse_Info` 2803–2912, DPI 2690–2800 /
 * 3138–3270, key slots 4048–4072, shortcuts 4075–4151, macros 4170–4372, light 3525–3606).
 * Doc: docs/reverse-engineering/mouse/02-features.md.
 */
import type { Modifier, RGB } from '@/model/device'
import { MODIFIERS } from '@/model/device'
import type { MacroCycles, MouseButton, MouseKeyFunction, MouseMacro, MouseMacroEvent } from '@/model/mouse'
import { complementPair, recordCrc, sumsTo55, withRecordCrc } from './frame'

export const FLASH_SIZE = 0x4000

export const enum Addr {
  ReportRate = 0x00,
  MaxDpiStage = 0x02,
  CurrentDpi = 0x04,
  KeyOperation = 0x08,
  Lod = 0x0a,
  DpiValue = 0x0c,
  DpiColor = 0x2c,
  DpiEffectMode = 0x4c,
  DpiEffectBrightness = 0x4e,
  DpiEffectSpeed = 0x50,
  DpiEffectState = 0x52,
  KeyFunction = 0x60,
  Light = 0xa0,
  LightState = 0xa7,
  DebounceTime = 0xa9,
  MotionSync = 0xab,
  SleepTime = 0xad,
  Angle = 0xaf,
  Ripple = 0xb1,
  MovingOffLight = 0xb3,
  PerformanceState = 0xb5,
  PerformanceTime = 0xb7,
  SensorMode = 0xb9,
  AngleTune = 0xbd,
  AngleTuneState = 0xbf,
  SensorFps20k = 0xe1,
  WheelDebounce = 0xe3,
  DebounceRelease = 0xe5,
  FlywheelState = 0xe9,
  ShortcutKey = 0x0100,
  Macro = 0x0300,
  Sensor3955Dpi = 0x1b00,
  VirtualCenter = 0x1b48,
  VirtualCenterLocation = 0x1b4a,
}

export const SHORTCUT_STRIDE = 0x20
export const MACRO_STRIDE = 0x180
export const KEY_SLOTS = 16
export const MACRO_NAME_MAX_BYTES = 30
export const MACRO_MAX_EVENTS = 70

// ---------------------------------------------------------------------------
// Sensors and DPI
// ---------------------------------------------------------------------------

export interface DpiRange {
  min: number
  max: number
  step: number
  /** Multiplier flag bits stored with the raw value (0x00 or 0x11). */
  dpiEx: number
}

export interface SensorSpec {
  type: string
  ranges: DpiRange[]
  lodOptions: { value: number; label: string }[]
  supports: { lod: boolean; motionSync: boolean; ripple: boolean; angleSnap: boolean }
}

/** From the live sensor.json / lang/en.json used by controlhub.top. */
export const SENSORS: Record<string, SensorSpec> = {
  '3395': {
    type: '3395',
    ranges: [
      { min: 50, max: 26000, step: 50, dpiEx: 0x00 },
      { min: 26100, max: 52000, step: 100, dpiEx: 0x11 },
    ],
    lodOptions: [
      { value: 1, label: '1 mm' },
      { value: 2, label: '2 mm' },
    ],
    supports: { lod: true, motionSync: true, ripple: true, angleSnap: true },
  },
  '3950': {
    type: '3950',
    ranges: [
      { min: 50, max: 30000, step: 50, dpiEx: 0x00 },
      { min: 30100, max: 60000, step: 100, dpiEx: 0x11 },
    ],
    lodOptions: [
      { value: 3, label: '0.7 mm' },
      { value: 1, label: '1 mm' },
      { value: 2, label: '2 mm' },
    ],
    supports: { lod: true, motionSync: true, ripple: true, angleSnap: true },
  },
}

/** `DPIValue_To_EepromValue` for range-table sensors (3395 / 3950): raw step index and multiplier flags. */
export function dpiToRaw(sensor: SensorSpec, dpi: number): { raw: number; dpiEx: number } {
  let idx = sensor.ranges.length - 1
  while (idx > 0 && dpi < sensor.ranges[idx]!.min) idx--
  const range = sensor.ranges[idx]!
  const div = idx === 3 ? 4 : idx === 1 || idx === 2 ? 2 : 1
  const raw = Math.round(dpi / div / sensor.ranges[0]!.step) - 1
  return { raw: Math.max(0, raw), dpiEx: range.dpiEx }
}

/** `EepromValue_To_DPIValue`. */
export function rawToDpi(sensor: SensorSpec, raw: number, dpiEx: number): number {
  let dpi = (raw + 1) * sensor.ranges[0]!.step
  if (dpiEx & 0x01) dpi *= 2
  if (dpiEx & 0x02) dpi *= 2
  return dpi
}

/** Clamps a DPI to the sensor's grid: rounds up to the step of the range it falls in (vendor slider rule). */
export function snapDpi(sensor: SensorSpec, dpi: number): number {
  const first = sensor.ranges[0]!
  const last = sensor.ranges[sensor.ranges.length - 1]!
  const clamped = Math.min(Math.max(dpi, first.min), last.max)
  const range = [...sensor.ranges].reverse().find((r) => clamped >= r.min) ?? first
  return Math.min(last.max, Math.ceil(clamped / range.step) * range.step)
}

/** 4-byte stage record at `0x0C + stage*4`: `[xLo, yLo, flags/high bits, crc]`. */
export function encodeDpiStage(sensor: SensorSpec, dpiX: number, dpiY = dpiX): Uint8Array {
  const x = dpiToRaw(sensor, dpiX)
  const y = dpiToRaw(sensor, dpiY)
  const hx = (x.raw >> 8) & 0x03
  const hy = (y.raw >> 8) & 0x03
  const flags = ((hx << 2) | (hy << 6) | (x.dpiEx & 0x03) | ((y.dpiEx & 0x03) << 4)) & 0xff
  return withRecordCrc([x.raw & 0xff, y.raw & 0xff, flags])
}

export function decodeDpiStage(sensor: SensorSpec, rec: ArrayLike<number>): { dpiX: number; dpiY: number } {
  const flags = rec[2]!
  const x = rec[0]! + (((flags & 0x0c) >> 2) << 8)
  const y = rec[1]! + (((flags & 0xc0) >> 6) << 8)
  return { dpiX: rawToDpi(sensor, x, flags & 0x03), dpiY: rawToDpi(sensor, y, (flags & 0x30) >> 4) }
}

export function encodeDpiColor(c: RGB): Uint8Array {
  return withRecordCrc([c.r & 0xff, c.g & 0xff, c.b & 0xff])
}

// ---------------------------------------------------------------------------
// Report rate
// ---------------------------------------------------------------------------

export function reportRateToByte(hz: number): number {
  return hz <= 1000 ? Math.round(1000 / hz) : (hz / 2000) * 0x10
}

export function reportRateFromByte(b: number): number {
  return b >= 0x10 ? (b / 0x10) * 2000 : b > 0 ? Math.round(1000 / b) : 1000
}

// ---------------------------------------------------------------------------
// Key slots, shortcuts, macros
// ---------------------------------------------------------------------------

export const enum KeyFn {
  Disable = 0x00,
  MouseButton = 0x01,
  DpiSwitch = 0x02,
  ScrollLeftRight = 0x03,
  FireKey = 0x04,
  Shortcut = 0x05,
  Macro = 0x06,
  ReportRateSwitch = 0x07,
  LightSwitch = 0x08,
  ProfileSwitch = 0x09,
  DpiLock = 0x0a,
  ScrollUpDown = 0x0b,
}

const BUTTON_PARAM: Record<MouseButton, number> = { left: 0x0100, right: 0x0200, middle: 0x0400, back: 0x0800, forward: 0x1000 }
const DPI_PARAM = { loop: 0x0100, up: 0x0200, down: 0x0300 } as const
const SCROLL_PARAM = { left: 0x0100, right: 0x0200, up: 0x0100, down: 0x0200 } as const

/** HIDKey modifier bits (type 0 entries). */
export const MODIFIER_BITS: Record<Modifier, number> = { lctrl: 0x01, lshift: 0x02, lalt: 0x04, lgui: 0x08, rctrl: 0x10, rshift: 0x20, ralt: 0x40, rgui: 0x80 }

export function cyclesToByte(c: MacroCycles): number {
  if (c === 'untilPressedAgain') return 253
  if (c === 'untilReleased') return 254
  if (c === 'untilAnyKey') return 255
  return Math.min(250, Math.max(1, Math.round(c)))
}

export function cyclesFromByte(b: number): MacroCycles {
  return b === 253 ? 'untilPressedAgain' : b === 254 ? 'untilReleased' : b === 255 ? 'untilAnyKey' : Math.max(1, b)
}

/** 4-byte slot record `[type, paramHi, paramLo, crc]` (DPI lock stores the raw DPI little-endian). */
export function encodeKeySlot(sensor: SensorSpec, slot: number, fn: MouseKeyFunction): Uint8Array {
  let type: number
  let param: number
  switch (fn.type) {
    case 'disabled':
      type = KeyFn.Disable
      param = 0
      break
    case 'button':
      type = KeyFn.MouseButton
      param = BUTTON_PARAM[fn.button]
      break
    case 'dpi':
      type = KeyFn.DpiSwitch
      param = DPI_PARAM[fn.action]
      break
    case 'scroll':
      type = fn.direction === 'left' || fn.direction === 'right' ? KeyFn.ScrollLeftRight : KeyFn.ScrollUpDown
      param = SCROLL_PARAM[fn.direction]
      break
    case 'fire':
      type = KeyFn.FireKey
      param = ((Math.min(255, Math.max(10, fn.interval)) & 0xff) << 8) | (Math.min(3, Math.max(0, fn.times)) & 0xff)
      break
    case 'combo':
    case 'media':
      type = KeyFn.Shortcut
      param = 0
      break
    case 'macro':
      type = KeyFn.Macro
      param = ((slot & 0xff) << 8) | cyclesToByte(fn.cycles)
      break
    case 'reportRateSwitch':
      type = KeyFn.ReportRateSwitch
      param = 0
      break
    case 'dpiLock': {
      const raw = dpiToRaw(sensor, fn.dpi).raw
      return withRecordCrc([KeyFn.DpiLock, raw & 0xff, (raw >> 8) & 0xff])
    }
    case 'raw':
      type = fn.functionType
      param = fn.param
      break
  }
  return withRecordCrc([type & 0xff, (param >> 8) & 0xff, param & 0xff])
}

/** Decodes a slot record; shortcut slots need the shortcut block via `decodeShortcut`. */
export function decodeKeySlot(sensor: SensorSpec, rec: ArrayLike<number>, shortcut?: ArrayLike<number>): MouseKeyFunction {
  const type = rec[0]!
  const param = ((rec[1]! << 8) | rec[2]!) & 0xffff
  switch (type) {
    case KeyFn.Disable:
      return { type: 'disabled' }
    case KeyFn.MouseButton: {
      const button = (Object.keys(BUTTON_PARAM) as MouseButton[]).find((b) => BUTTON_PARAM[b] === param)
      return button ? { type: 'button', button } : { type: 'raw', functionType: type, param }
    }
    case KeyFn.DpiSwitch:
      return param === 0x0100 ? { type: 'dpi', action: 'loop' } : param === 0x0200 ? { type: 'dpi', action: 'up' } : param === 0x0300 ? { type: 'dpi', action: 'down' } : { type: 'raw', functionType: type, param }
    case KeyFn.ScrollLeftRight:
      return { type: 'scroll', direction: param === 0x0200 ? 'right' : 'left' }
    case KeyFn.ScrollUpDown:
      return { type: 'scroll', direction: param === 0x0200 ? 'down' : 'up' }
    case KeyFn.FireKey:
      return { type: 'fire', interval: (param >> 8) & 0xff, times: param & 0xff }
    case KeyFn.Shortcut:
      return shortcut ? decodeShortcut(shortcut) : { type: 'raw', functionType: type, param }
    case KeyFn.Macro:
      return { type: 'macro', cycles: cyclesFromByte(param & 0xff) }
    case KeyFn.ReportRateSwitch:
      return { type: 'reportRateSwitch' }
    case KeyFn.DpiLock:
      return { type: 'dpiLock', dpi: rawToDpi(sensor, rec[1]! | (rec[2]! << 8), 0) }
    default:
      return { type: 'raw', functionType: type, param }
  }
}

/** Shortcut block: `[N*2, (type|0x80, lo, hi)×N presses, (type|0x40, lo, hi)×N releases reversed, crc]`. */
export function encodeCombo(modifiers: Modifier[], usage: number): Uint8Array {
  const entries: { type: number; value: number }[] = [...modifiers.map((m) => ({ type: 0, value: MODIFIER_BITS[m] })), { type: 1, value: usage & 0xff }]
  const out: number[] = [entries.length * 2]
  for (const e of entries) out.push(e.type | 0x80, e.value & 0xff, (e.value >> 8) & 0xff)
  for (const e of [...entries].reverse()) out.push(e.type | 0x40, e.value & 0xff, (e.value >> 8) & 0xff)
  return withRecordCrc(out)
}

/** Multimedia (consumer usage) shortcut block: `[02, 82, lo, hi, 42, lo, hi, crc]`. */
export function encodeMedia(usage: number): Uint8Array {
  return withRecordCrc([0x02, 0x82, usage & 0xff, (usage >> 8) & 0xff, 0x42, usage & 0xff, (usage >> 8) & 0xff])
}

export function decodeShortcut(block: ArrayLike<number>): MouseKeyFunction {
  const count = block[0]! >> 1
  const entries: { type: number; value: number }[] = []
  for (let i = 0; i < count; i++) entries.push({ type: block[1 + i * 3]! & 0x0f, value: block[2 + i * 3]! | (block[3 + i * 3]! << 8) })
  if (entries.length === 1 && entries[0]!.type === 2) return { type: 'media', usage: entries[0]!.value }
  const modifiers: Modifier[] = []
  let usage = 0
  for (const e of entries) {
    if (e.type === 0) modifiers.push(...MODIFIERS.filter((m) => e.value & MODIFIER_BITS[m]))
    else if (e.type === 1) usage = e.value & 0xff
  }
  return { type: 'combo', modifiers, usage }
}

const MACRO_KIND_TYPE: Record<MouseMacroEvent['kind'], number> = { modifier: 0, key: 1, mouse: 4 }
const MACRO_TYPE_KIND: Record<number, MouseMacroEvent['kind']> = { 0: 'modifier', 1: 'key', 4: 'mouse' }

function encodeMacroEntry(e: MouseMacroEvent): number[] {
  const status = e.state === 'down' ? 2 : 1
  const delay = Math.min(0xffff, Math.max(0, Math.round(e.delayMs)))
  return [((status << 6) | (MACRO_KIND_TYPE[e.kind] & 0x0f)) & 0xff, e.code & 0xff, (e.code >> 8) & 0xff, (delay >> 8) & 0xff, delay & 0xff]
}

/**
 * Macro record (`Get_Macro_Value`): `[nameLen, name (0xFF-padded to 30), count @0x1F, entries×5 @0x20, crc]` where
 * the CRC makes `count + entries + crc` sum to 0x55.
 */
export function encodeMacroRecord(m: MouseMacro): Uint8Array {
  const name = new TextEncoder().encode(m.name)
  if (name.length === 0 || name.length > MACRO_NAME_MAX_BYTES) throw new Error(`macro name must be 1..${MACRO_NAME_MAX_BYTES} UTF-8 bytes`)
  if (m.events.length > MACRO_MAX_EVENTS) throw new Error(`macro has more than ${MACRO_MAX_EVENTS} events`)
  const out = new Uint8Array(33 + m.events.length * 5).fill(0xff)
  out[0] = name.length
  out.set(name, 1)
  out[31] = m.events.length
  const entries = m.events.flatMap(encodeMacroEntry)
  out.set(entries, 32)
  out[32 + entries.length] = (recordCrc(entries) - m.events.length) & 0xff
  return out
}

export function decodeMacroRecord(block: ArrayLike<number>): MouseMacro | undefined {
  const nameLen = block[0] ?? 0
  const count = block[31] ?? 0
  if (nameLen === 0 || nameLen > MACRO_NAME_MAX_BYTES || count > MACRO_MAX_EVENTS) return undefined
  const name = new TextDecoder().decode(Uint8Array.from(Array.prototype.slice.call(block, 1, 1 + nameLen)))
  const events: MouseMacroEvent[] = []
  for (let i = 0; i < count; i++) {
    const o = 32 + i * 5
    const b = block[o]!
    events.push({ state: b >> 6 === 2 ? 'down' : 'up', kind: MACRO_TYPE_KIND[b & 0x0f] ?? 'key', code: block[o + 1]! | (block[o + 2]! << 8), delayMs: (block[o + 3]! << 8) | block[o + 4]! })
  }
  return { name, events }
}

// ---------------------------------------------------------------------------
// Light block
// ---------------------------------------------------------------------------

export interface LightBlock {
  mode: number
  color: RGB
  speed: number
  brightness: number
}

export function encodeLightBlock(l: LightBlock): Uint8Array {
  return withRecordCrc([l.mode & 0xff, l.color.r & 0xff, l.color.g & 0xff, l.color.b & 0xff, Math.min(9, l.speed) & 0xff, Math.min(9, l.brightness) & 0xff])
}

export function decodeLightBlock(b: ArrayLike<number>): LightBlock {
  return { mode: b[0]!, color: { r: b[1]!, g: b[2]!, b: b[3]! }, speed: Math.min(9, b[4]!), brightness: Math.min(9, b[5]!) }
}

/** Optional single-value fields exist only when `[value, complement]` sums to 0x55. */
export function readOptional(flash: Uint8Array, addr: number): number | undefined {
  return sumsTo55([flash[addr]!, flash[addr + 1]!]) ? flash[addr] : undefined
}

export function writeValue(flash: Uint8Array, addr: number, value: number): void {
  flash.set(complementPair(value), addr)
}
