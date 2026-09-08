import { describe, expect, it } from 'vitest'
import { catalog, describe as describeKeycode, fromKeycode, toKeycode, usageLabel } from './keycodes'
import { LAYOUTS, keyIds, layoutBounds, variantForUuid } from './layout'

describe('keycodes', () => {
  it('decodes the keycode families from the doc', () => {
    expect(fromKeycode(0)).toEqual({ type: 'none' })
    expect(fromKeycode(1)).toEqual({ type: 'transparent' })
    expect(fromKeycode(4)).toEqual({ type: 'key', usage: 4 })
    expect(fromKeycode(0x00010000)).toEqual({ type: 'key', usage: 0, modifiers: ['lctrl'] })
    expect(fromKeycode(0x00800000)).toEqual({ type: 'key', usage: 0, modifiers: ['rgui'] })
    expect(fromKeycode(0x00010400)).toEqual({ type: 'key', usage: 4, modifiers: ['lctrl'] }) // preset form, key in bits 15..8
    expect(fromKeycode(0x00032900)).toEqual({ type: 'key', usage: 0x29, modifiers: ['lctrl', 'lshift'] })
    expect(fromKeycode(0x0008000f)).toEqual({ type: 'key', usage: 0x0f, modifiers: ['lgui'] }) // Win+L
    expect(fromKeycode(0x020000e9)).toEqual({ type: 'consumer', usage: 0xe9 })
    expect(fromKeycode(0x01010100)).toEqual({ type: 'mouse', button: 1 })
    expect(fromKeycode(0x01050100)).toEqual({ type: 'mouse', button: 5 })
    expect(fromKeycode(0x03040203)).toEqual({ type: 'macro', index: 3, loop: 'untilKeyUp', count: 2 })
    expect(fromKeycode(0x08030100)).toEqual({ type: 'lighting', zone: 'main', param: 'brightness', op: 'increase' })
    expect(fromKeycode(0x08040202)).toEqual({ type: 'lighting', zone: 'logo', param: 'speed', op: 'decrease' })
    expect(fromKeycode(0x0d000000)).toEqual({ type: 'layer', layer: 1 })
    expect(fromKeycode(0x0d010000)).toEqual({ type: 'layer', layer: 2 })
    expect(fromKeycode(0xf201)).toMatchObject({ type: 'firmware', keycode: 0xf201, category: 'control' })
    expect(fromKeycode(0x20e9)).toMatchObject({ type: 'firmware', category: 'media' })
    expect(fromKeycode(0xf505)).toMatchObject({ type: 'firmware', label: 'M5', category: 'macro' })
  })

  it('encodes actions and round-trips', () => {
    expect(toKeycode({ type: 'key', usage: 4 })).toBe(4)
    expect(toKeycode({ type: 'key', usage: 4, modifiers: ['lctrl'] })).toBe(0x00010004)
    expect(toKeycode({ type: 'key', usage: 0, modifiers: ['lshift'] })).toBe(0x00020000)
    expect(toKeycode({ type: 'consumer', usage: 0xcd })).toBe(0x020000cd)
    expect(toKeycode({ type: 'mouse', button: 2 })).toBe(0x01020100)
    expect(toKeycode({ type: 'macro', index: 0, loop: 'count', count: 1 })).toBe(0x03010100)
    expect(toKeycode({ type: 'layer', layer: 1 })).toBe(0x0d000000)
    expect(toKeycode({ type: 'lighting', zone: 'side', param: 'effect', op: 'cycle' })).toBe(0x08000001)
    for (const kc of [0, 1, 4, 0x00010004, 0x00030029, 0x020000e9, 0x01010100, 0x03010100, 0x08030100, 0x0d000000, 0xf201, 0x4100]) {
      expect(toKeycode(fromKeycode(kc))).toBe(kc)
    }
    // The preset form re-encodes to the editor form; both decode to the same action.
    expect(toKeycode(fromKeycode(0x00010400))).toBe(0x00010004)
    expect(toKeycode(fromKeycode(0x00032900))).toBe(0x00030029)
    expect(fromKeycode(0x03000002)).toEqual({ type: 'macro', index: 2, loop: 'count', count: 0 })
  })

  it('labels keycodes', () => {
    expect(describeKeycode(4)).toBe('A')
    expect(describeKeycode(0x29)).toBe('Esc')
    expect(describeKeycode(0x59)).toBe('Num 1')
    expect(describeKeycode(0x00010000)).toBe('L-Ctrl')
    expect(describeKeycode(0x00010004)).toBe('Ctrl+A')
    expect(describeKeycode(0x00010400)).toBe('Ctrl + A') // vendor legend for the preset
    expect(describeKeycode(0x020000e9)).toBe('Volume +')
    expect(describeKeycode(0x01010100)).toBe('Left Mouse Button')
    expect(describeKeycode(0xf201)).toBe('Switch to Windows Layout (hold to activate)')
    expect(describeKeycode(0x08030100)).toBe('Lighting Brightness +')
    expect(describeKeycode(0x0d000000)).toBe('Fn')
    expect(describeKeycode(0x03000002)).toBe('Macro 3')
    expect(usageLabel(0x50)).toBe('←')
    expect(usageLabel(0x1e)).toBe('1')
  })

  it('builds a catalog with browser codes for basic keys', () => {
    const entries = catalog()
    expect(entries.length).toBeGreaterThan(250)
    const a = entries.find((e) => e.category === 'basic' && e.keycode === 4)
    expect(a).toMatchObject({ label: 'A', browserCode: 'KeyA' })
    expect(entries.some((e) => e.category === 'media' && e.keycode === 0x206f)).toBe(true) // vendor picker lists 16-bit media codes
    expect(entries.some((e) => e.category === 'control' && e.keycode === 0x020000e9)).toBe(true)
    expect(entries.some((e) => e.category === 'combos')).toBe(true)
    expect(entries.filter((e) => e.category === 'modifiers')).toHaveLength(8)
    const cats = new Set(entries.map((e) => e.category))
    expect([...cats]).toEqual(expect.arrayContaining(['basic', 'modifiers', 'media', 'mouse', 'control', 'lighting', 'combos', 'system', 'special', 'macro', 'triMode', 'gamepadXbox', 'gamepad']))
  })
})

describe('layouts', () => {
  it('has 98 US keys with unique ids and vendor geometry', () => {
    const us = LAYOUTS.us
    expect(us.keys).toHaveLength(98)
    expect(new Set(keyIds(us)).size).toBe(98)
    const space = us.keys.find((k) => k.id === 70)!
    expect(space).toMatchObject({ label: 'Space', w: 7, splittable: true, x: 3.75, y: 5.357 })
    const esc = us.keys.find((k) => k.id === 1)!
    expect(esc).toMatchObject({ x: 0, y: 0, defaultKeycode: 0x29, row: 0, col: 0 })
    expect(layoutBounds(us).width).toBeGreaterThan(19)
  })

  it('uk/jp variants carry ISO enter and extra keys', () => {
    expect(LAYOUTS.uk.keys).toHaveLength(99)
    expect(LAYOUTS.uk.keys.find((k) => k.id === 54)).toMatchObject({ shape: 'iso-enter', h: 2.1 })
    expect(LAYOUTS.jp.keys).toHaveLength(104)
    expect(variantForUuid('0x14000000000c')).toBe('us')
    expect(variantForUuid('0x14000000000E')).toBe('uk')
    expect(variantForUuid('0x14000000000f')).toBe('jp')
    expect(variantForUuid(undefined)).toBe('us')
  })
})
