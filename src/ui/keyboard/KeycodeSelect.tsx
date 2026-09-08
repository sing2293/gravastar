import { useMemo } from 'react'
import type { KeyActionCodec, Keycode } from '@/model/keyboard'

/** Compact keycode chooser for advanced keys / macros: basic keys, modifiers and media, grouped. */
export function KeycodeSelect({ actions, value, onChange, disabled, categories = ['basic', 'modifiers', 'media', 'mouse'] }: { actions: KeyActionCodec; value: Keycode; onChange: (kc: Keycode) => void; disabled?: boolean; categories?: string[] }) {
  const groups = useMemo(() => {
    const catalog = actions.catalog()
    return categories.map((c) => ({ category: c, entries: catalog.filter((e) => e.category === c) })).filter((g) => g.entries.length)
  }, [actions, categories])
  const known = groups.some((g) => g.entries.some((e) => e.keycode === value))
  return (
    <select className="select" value={String(value)} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
      {!known && <option value={String(value)}>{actions.describe(value)}</option>}
      {groups.map((g) => (
        <optgroup key={g.category} label={g.category}>
          {g.entries.map((e) => (
            <option key={`${g.category}:${e.keycode}`} value={String(e.keycode)}>
              {e.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
