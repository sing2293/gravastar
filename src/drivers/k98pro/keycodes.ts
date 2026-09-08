/**
 * K98 Pro keycode scheme ⇄ device-agnostic `KeyAction`, plus the picker catalog.
 * Scheme: docs/reverse-engineering/k98pro/03-keymap-layout.md §4. Tables: ./data/keycodes.json, labels from the
 * vendor's English i18n (./data/keyLabels.json).
 */
import { MODIFIERS, type Modifier } from '@/model/device'
import type { KeyAction, KeyActionCodec, KeyCatalogEntry, Keycode, Layer, LightZone, LightingOp, LightingParam, MacroLoop } from '@/model/keyboard'
import labelsJson from './data/keyLabels.json'
import keycodesJson from './data/keycodes.json'

interface KeycodesData {
  hidUsageNames: Record<string, number>
  modifierBits32: Record<string, number>
  consumerControl32: Record<string, number>
  mouse32: Record<string, number>
  lighting32: Record<string, number>
  combos32: Record<string, number>
  combos32Legends: Record<string, string>
  legacy16ByCategory: Record<string, Record<string, number>>
  uiPickerCategoryLists: Record<string, number[]>
}

const DATA = keycodesJson as unknown as KeycodesData
const LABELS = labelsJson as Record<string, string>

export const enum KeycodeType {
  Keyboard = 0x00,
  Mouse = 0x01,
  Consumer = 0x02,
  Macro = 0x03,
  Lighting = 0x08,
  Layer = 0x0d,
  RapidFire = 0x10,
}

export const KEYCODE_NONE = 0
export const KEYCODE_TRANSPARENT = 1
const HID_USAGE_MAX = 0xe7

export const typeOf = (kc: Keycode): number => (kc >>> 24) & 0xff

const MACRO_LOOP_TO_WIRE: Record<MacroLoop, number> = { count: 1, untilKeyDown: 2, untilKeyUp: 4 }
/** Loop type 0 appears in the vendor's G1–G5 picker codes (0x03000000…); treat it as a plain count. */
const MACRO_LOOP_FROM_WIRE: Record<number, MacroLoop> = { 0: 'count', 1: 'count', 2: 'untilKeyDown', 4: 'untilKeyUp' }
const LIGHT_PARAMS: readonly LightingParam[] = ['effect', 'direction', 'color', 'brightness', 'speed']
const LIGHT_OPS: readonly LightingOp[] = ['cycle', 'increase', 'decrease']
const LIGHT_ZONES: readonly LightZone[] = ['main', 'side', 'logo']

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

/** HID usage → browser `KeyboardEvent.code` (first name wins for duplicated usages). */
const USAGE_TO_CODE = new Map<number, string>()
for (const [name, usage] of Object.entries(DATA.hidUsageNames)) if (!USAGE_TO_CODE.has(usage)) USAGE_TO_CODE.set(usage, name)

/** Firmware 16-bit special codes → label/category (vendor table `E9`). */
const LEGACY16 = new Map<number, { label: string; category: string }>()
for (const [category, entries] of Object.entries(DATA.legacy16ByCategory)) {
  for (const [label, code] of Object.entries(entries)) if (!LEGACY16.has(code)) LEGACY16.set(code, { label, category })
}

const COMBO_LEGENDS = new Map<number, string>()
for (const [name, code] of Object.entries(DATA.combos32)) if (!COMBO_LEGENDS.has(code)) COMBO_LEGENDS.set(code, DATA.combos32Legends[name] ?? name)

const CONSUMER_NAMES = new Map<number, string>()
for (const [name, code] of Object.entries(DATA.consumerControl32)) if (!CONSUMER_NAMES.has(code)) CONSUMER_NAMES.set(code, name)

const MOD_SHORT: Record<Modifier, string> = { lctrl: 'Ctrl', lshift: 'Shift', lalt: 'Alt', lgui: 'Win', rctrl: 'R-Ctrl', rshift: 'R-Shift', ralt: 'R-Alt', rgui: 'R-Win' }
const MOD_ALONE: Record<Modifier, string> = { lctrl: 'L-Ctrl', lshift: 'L-Shift', lalt: 'L-Alt', lgui: 'L-Win', rctrl: 'R-Ctrl', rshift: 'R-Shift', ralt: 'R-Alt', rgui: 'R-Win' }

const CODE_LABELS: Record<string, string> = {
  Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab', Space: 'Space', Enter: 'Enter', CapsLock: 'Caps', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlHash: '#', Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',',
  Period: '.', Slash: '/', PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause', Insert: 'Ins', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn', Delete: 'Del', NumLock: 'NumLk', ContextMenu: 'Menu', Power: 'Power', IntlBackslash: '<>',
  IntlRo: 'Ro', IntlYen: '¥', KanaMode: 'かな', Convert: '変換', NonConvert: '無変換', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ControlLeft: 'L-Ctrl', ShiftLeft: 'L-Shift', AltLeft: 'L-Alt', MetaLeft: 'L-Win', ControlRight: 'R-Ctrl', ShiftRight: 'R-Shift', AltRight: 'R-Alt', MetaRight: 'R-Win',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter',
  NumpadEqual: 'Num =', NumpadComma: 'Num ,', NumpadParenLeft: 'Num (', NumpadParenRight: 'Num )', AudioVolumeUp: 'Vol +', AudioVolumeDown: 'Vol -', AudioVolumeMute: 'Mute',
}

export function usageLabel(usage: number): string {
  const code = USAGE_TO_CODE.get(usage)
  if (!code) return `0x${usage.toString(16).padStart(2, '0')}`
  if (CODE_LABELS[code]) return CODE_LABELS[code]
  const m = /^(Key|Digit|Numpad)(.+)$/.exec(code)
  if (m) return m[1] === 'Numpad' ? `Num ${m[2]}` : m[2]!
  return code
}

const humanize = (name: string): string => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

function modifierMask(mods: Modifier[] | undefined): number {
  let mask = 0
  for (const m of mods ?? []) mask |= 1 << MODIFIERS.indexOf(m)
  return mask & 0xff
}

function modifiersFromMask(mask: number): Modifier[] {
  return MODIFIERS.filter((_, i) => (mask >> i) & 1)
}

export function toKeycode(action: KeyAction): Keycode {
  switch (action.type) {
    case 'none':
      return KEYCODE_NONE
    case 'transparent':
      return KEYCODE_TRANSPARENT
    case 'key': {
      const mods = modifierMask(action.modifiers)
      if (!mods && !action.secondaryUsage) return action.usage & 0xff
      return ((mods << 16) | (((action.secondaryUsage ?? 0) & 0xff) << 8) | (action.usage & 0xff)) >>> 0
    }
    case 'consumer':
      return ((KeycodeType.Consumer << 24) | (action.usage & 0xffff)) >>> 0
    case 'mouse':
      return ((KeycodeType.Mouse << 24) | ((action.button & 0xff) << 16) | 0x0100) >>> 0
    case 'macro':
      return ((KeycodeType.Macro << 24) | (MACRO_LOOP_TO_WIRE[action.loop] << 16) | ((action.count & 0xff) << 8) | (action.index & 0xff)) >>> 0
    case 'layer':
      return ((KeycodeType.Layer << 24) | ((Math.max(0, action.layer - 1) & 0xff) << 16)) >>> 0
    case 'lighting':
      return ((KeycodeType.Lighting << 24) | (LIGHT_PARAMS.indexOf(action.param) << 16) | (LIGHT_OPS.indexOf(action.op) << 8) | LIGHT_ZONES.indexOf(action.zone)) >>> 0
    case 'firmware':
      return action.keycode >>> 0
  }
}

export function fromKeycode(kc: Keycode): KeyAction {
  kc = kc >>> 0
  if (kc === KEYCODE_NONE) return { type: 'none' }
  if (kc === KEYCODE_TRANSPARENT) return { type: 'transparent' }
  const type = typeOf(kc)
  switch (type) {
    case KeycodeType.Keyboard: {
      if (kc < 0x10000) {
        if (kc <= HID_USAGE_MAX) return { type: 'key', usage: kc }
        const legacy = LEGACY16.get(kc)
        return { type: 'firmware', keycode: kc, label: legacy?.label ?? `0x${kc.toString(16)}`, category: legacy?.category ?? 'unknown' }
      }
      const modifiers = modifiersFromMask((kc >> 16) & 0xff)
      const usage = kc & 0xff
      const secondary = (kc >> 8) & 0xff
      // Vendor combo presets carry the key in bits 15..8 with bits 7..0 clear; the editor puts it in bits 7..0.
      if (usage === 0 && secondary !== 0) return { type: 'key', usage: secondary, modifiers }
      return secondary ? { type: 'key', usage, modifiers, secondaryUsage: secondary } : { type: 'key', usage, modifiers }
    }
    case KeycodeType.Mouse: {
      const button = (kc >> 16) & 0xff
      if (button >= 1 && button <= 5) return { type: 'mouse', button: button as 1 | 2 | 3 | 4 | 5 }
      break
    }
    case KeycodeType.Consumer:
      return { type: 'consumer', usage: kc & 0xffff }
    case KeycodeType.Macro: {
      const loop = MACRO_LOOP_FROM_WIRE[(kc >> 16) & 0xff]
      if (loop) return { type: 'macro', index: kc & 0xff, loop, count: (kc >> 8) & 0xff }
      break
    }
    case KeycodeType.Layer:
      return { type: 'layer', layer: Math.min(3, ((kc >> 16) & 0xff) + 1) as Layer }
    case KeycodeType.Lighting: {
      const param = LIGHT_PARAMS[(kc >> 16) & 0xff]
      const op = LIGHT_OPS[(kc >> 8) & 0xff]
      const zone = LIGHT_ZONES[kc & 0xff]
      if (param && op && zone) return { type: 'lighting', zone, param, op }
      break
    }
  }
  return { type: 'firmware', keycode: kc, label: LABELS[String(kc)] ?? `0x${kc.toString(16).padStart(8, '0')}`, category: 'unknown' }
}

export function describe(kc: Keycode): string {
  kc = kc >>> 0
  const i18n = LABELS[String(kc)]
  if (i18n) return i18n
  const legend = COMBO_LEGENDS.get(kc)
  if (legend) return legend
  const action = fromKeycode(kc)
  switch (action.type) {
    case 'none':
      return 'Blank'
    case 'transparent':
      return '△'
    case 'key': {
      const mods = action.modifiers ?? []
      if (action.usage === 0 && !action.secondaryUsage) return mods.map((m) => MOD_ALONE[m]).join('+') || 'Blank'
      const parts = mods.map((m) => MOD_SHORT[m])
      parts.push(usageLabel(action.usage))
      if (action.secondaryUsage) parts.push(usageLabel(action.secondaryUsage))
      return parts.join('+')
    }
    case 'consumer': {
      const name = CONSUMER_NAMES.get(kc)
      return name ? humanize(name) : `Consumer 0x${action.usage.toString(16)}`
    }
    case 'mouse':
      return ['', 'Left Mouse Button', 'Right Mouse Button', 'Middle Mouse Button', 'Mouse Back', 'Mouse Forward'][action.button]!
    case 'macro':
      return `Macro ${action.index + 1}`
    case 'layer':
      return action.layer === 1 ? 'Fn' : `Fn${action.layer - 1}`
    case 'lighting':
      return `${humanize(action.zone)} light ${action.param} ${action.op}`
    case 'firmware':
      return action.label
  }
}

/** Picker categories in display order → vendor list name. */
const PICKER_CATEGORIES: ReadonlyArray<[category: string, vendorList: string]> = [
  ['media', 'media'],
  ['mouse', 'mouse'],
  ['control', 'control'],
  ['lighting', 'light'],
  ['combos', 'combine'],
  ['system', 'system'],
  ['special', 'special'],
  ['macro', 'macro'],
  ['triMode', 'triMode'],
  ['gamepadXbox', 'xboxHandle'],
  ['gamepad', 'classHandle'],
  ['decorative1', 'decorativeLighting1'],
  ['decorative2', 'decorativeLighting2'],
  ['decorative3', 'decorativeLighting3'],
]

let catalogCache: KeyCatalogEntry[] | undefined

export function catalog(): KeyCatalogEntry[] {
  if (catalogCache) return catalogCache
  const out: KeyCatalogEntry[] = []
  const seen = new Set<string>()
  const add = (category: string, keycode: number, label?: string) => {
    const key = `${category}:${keycode}`
    if (seen.has(key)) return
    seen.add(key)
    const action = fromKeycode(keycode)
    const entry: KeyCatalogEntry = { action, keycode, label: label ?? describe(keycode), category }
    const code = action.type === 'key' && !action.modifiers?.length ? USAGE_TO_CODE.get(action.usage) : undefined
    if (code) entry.browserCode = code
    out.push(entry)
  }
  // Vendor legends for the basic table are inconsistent ("PEnter", "Nubs"…); label from the HID usage instead.
  for (const code of Object.values(DATA.legacy16ByCategory['basic'] ?? {})) add('basic', code, code <= HID_USAGE_MAX ? usageLabel(code) : undefined)
  for (const code of Object.values(DATA.modifierBits32)) add('modifiers', code)
  for (const [category, list] of PICKER_CATEGORIES) for (const code of DATA.uiPickerCategoryLists[list] ?? []) add(category, code)
  catalogCache = out
  return out
}

export const k98Actions: KeyActionCodec = { toKeycode, fromKeycode, describe, catalog }
