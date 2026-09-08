import { describe, expect, it } from 'vitest'
import { LAYOUTS, expandLedAliases, ledIds } from './layout'

describe('LED aliases across legend variants', () => {
  it('US space bar owns the four JP key positions under it (five LEDs in total)', () => {
    expect(LAYOUTS.us.ledAliases?.[70]).toEqual([106, 107, 109, 110])
    expect(expandLedAliases(LAYOUTS.us, [{ id: 70, color: { r: 1, g: 2, b: 3 } }])).toEqual([70, 106, 107, 109, 110].map((id) => ({ id, color: { r: 1, g: 2, b: 3 } })))
    expect(ledIds(LAYOUTS.us).length).toBe(98 + Object.values(LAYOUTS.us.ledAliases!).reduce((n, l) => n + (l?.length ?? 0), 0))
  })
  it('never aliases a visible id and keeps explicit colours', () => {
    for (const layout of Object.values(LAYOUTS)) {
      const visible = new Set(layout.keys.map((k) => k.id))
      for (const [host, list] of Object.entries(layout.ledAliases ?? {})) {
        expect(visible.has(Number(host))).toBe(true)
        for (const id of list ?? []) expect(visible.has(id)).toBe(false)
      }
    }
    const out = expandLedAliases(LAYOUTS.us, [{ id: 70, color: { r: 9, g: 9, b: 9 } }, { id: 106, color: { r: 0, g: 0, b: 0 } }])
    expect(out.find((c) => c.id === 106)!.color).toEqual({ r: 0, g: 0, b: 0 })
  })
  it('JP space bar has no aliases from the smaller ANSI space', () => {
    expect(LAYOUTS.jp.ledAliases?.[70] ?? []).toEqual([])
  })
})
