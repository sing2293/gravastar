/**
 * Physical layouts rendered by the vendor UI (US / "uk" = German ISO / JP), converted to the device model.
 * Data: ./data/layout*.json, extracted from the bundle (docs/reverse-engineering/k98pro/03-keymap-layout.md §6).
 */
import type { KeyId, KeyboardLayout, LayoutKey, LayoutVariant, PerKeyColor } from '@/model/keyboard'
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

const BASE: Record<LayoutVariant, KeyboardLayout> = {
  us: convert('us', us as RawKey[]),
  uk: convert('uk', uk as RawKey[]),
  jp: convert('jp', jp as RawKey[]),
}

/**
 * The PCB is shared between legend variants, so LEDs exist at every key position of every variant — the US/UK
 * space bar covers the positions of the JP 無変換/変換/かな/英数 keys (ids 106/107/109/110) and shows five LEDs,
 * while its keymap only knows id 70. For each key id missing from `layout` but present in another variant, find the
 * visible key whose area contains that key's centre and make it an LED alias of it.
 */
function ledAliases(layout: KeyboardLayout, others: KeyboardLayout[]): Partial<Record<KeyId, KeyId[]>> {
  const visible = new Set(layout.keys.map((k) => k.id))
  const out: Partial<Record<KeyId, KeyId[]>> = {}
  const seen = new Set<KeyId>()
  for (const other of others) {
    for (const hidden of other.keys) {
      if (visible.has(hidden.id) || seen.has(hidden.id)) continue
      const cx = hidden.x + hidden.w / 2
      const cy = hidden.y + hidden.h / 2
      const host = layout.keys.find((k) => cx >= k.x && cx < k.x + k.w && cy >= k.y && cy < k.y + k.h)
      if (!host) continue
      seen.add(hidden.id)
      ;(out[host.id] ??= []).push(hidden.id)
    }
  }
  return out
}

const withAliases = (variant: LayoutVariant): KeyboardLayout => {
  const others = (['jp', 'uk', 'us'] as LayoutVariant[]).filter((v) => v !== variant).map((v) => BASE[v])
  return { ...BASE[variant], ledAliases: ledAliases(BASE[variant], others) }
}

export const LAYOUTS: Record<LayoutVariant, KeyboardLayout> = { us: withAliases('us'), uk: withAliases('uk'), jp: withAliases('jp') }

/** Adds the alias ids' LEDs (same colour) to a per-key colour list; ids already present are left alone. */
export function expandLedAliases(layout: KeyboardLayout, colors: PerKeyColor[]): PerKeyColor[] {
  const aliases = layout.ledAliases
  if (!aliases) return colors
  const present = new Set(colors.map((c) => c.id))
  const out = [...colors]
  for (const c of colors) for (const id of aliases[c.id] ?? []) if (!present.has(id)) out.push({ id, color: c.color })
  return out
}

/** Every id that has an LED on this variant: the visible keys plus their aliases. */
export function ledIds(layout: KeyboardLayout): KeyId[] {
  const ids = layout.keys.map((k) => k.id)
  for (const list of Object.values(layout.ledAliases ?? {})) ids.push(...(list ?? []))
  return ids
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
