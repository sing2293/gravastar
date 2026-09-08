/**
 * Physical layouts rendered by the vendor UI (US / "uk" = German ISO / JP), converted to the device model.
 * Data: ./data/layout*.json, extracted from the bundle (docs/reverse-engineering/k98pro/03-keymap-layout.md §6).
 */
import type { KeyId, KeyboardLayout, LayoutKey, LayoutVariant } from '@/model/keyboard'
import jp from './data/layout-jp.json'
import uk from './data/layout-uk.json'
import us from './data/layout.json'

interface RawKey {
  label: string
  row: number
  col: number
  keyIndex: number
  x: number
  y: number
  xUnits: number
  yUnits: number
  w: number
  h: number
  defaultKeycode: number
  browserCode?: string
  lShaped?: boolean
  isSplittableSpace?: boolean
}

/** Pixels per key unit in the vendor's geometry. */
export const UNIT_PX = 56
export const GRID = { rows: 6, columns: 21 } as const

function convert(variant: LayoutVariant, raw: RawKey[]): KeyboardLayout {
  const keys: LayoutKey[] = raw.map((k) => ({
    id: k.keyIndex,
    label: k.label,
    x: Math.round((k.x / UNIT_PX) * 1000) / 1000,
    y: Math.round((k.y / UNIT_PX) * 1000) / 1000,
    w: k.w,
    h: k.h,
    row: k.row,
    col: k.col,
    defaultKeycode: k.defaultKeycode,
    ...(k.lShaped ? { shape: 'iso-enter' as const } : {}),
    ...(k.isSplittableSpace ? { splittable: true } : {}),
  }))
  return { variant, keys, rows: GRID.rows, columns: GRID.columns }
}

export const LAYOUTS: Record<LayoutVariant, KeyboardLayout> = {
  us: convert('us', us as RawKey[]),
  uk: convert('uk', uk as RawKey[]),
  jp: convert('jp', jp as RawKey[]),
}

/** Device UUID → legend variant, as the vendor store maps it (`_u`). Unknown UUIDs fall back to US. */
export const UUID_TO_VARIANT: Readonly<Record<string, LayoutVariant>> = {
  '0x14000000000c': 'us',
  '0x14000000000e': 'uk',
  '0x14000000000f': 'jp',
}

export function variantForUuid(uuidHex: string | undefined): LayoutVariant {
  return (uuidHex && UUID_TO_VARIANT[uuidHex.toLowerCase()]) || 'us'
}

export function keyIds(layout: KeyboardLayout): KeyId[] {
  return layout.keys.map((k) => k.id)
}

/** Total width/height of a layout in key units, for the renderer. */
export function layoutBounds(layout: KeyboardLayout): { width: number; height: number } {
  let width = 0
  let height = 0
  for (const k of layout.keys) {
    width = Math.max(width, k.x + k.w)
    height = Math.max(height, k.y + k.h)
  }
  return { width, height }
}
