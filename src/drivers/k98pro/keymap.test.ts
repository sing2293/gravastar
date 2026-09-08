import { describe, expect, it } from 'vitest'
import { hex } from '@/hid/core/bytes'
import { WebHidTransport } from '@/hid/core/transport'
import { FakeHidDevice } from '@/hid/core/testing/fakeHidDevice'
import { K98ProFirmware } from '@/sim/k98pro/firmware'
import { KeymapSimState, installKeymapSim } from '@/sim/k98pro/keymapSim'
import { K98Keymap, K98Profiles, KEYMAP_READ_CHUNK } from './keymap'
import { K98Link } from './transport'

async function setup() {
  const fake = new FakeHidDevice('K98 Pro', 0x372e, 0x10e5, 0)
  const fw = new K98ProFirmware().attach(fake)
  const state = installKeymapSim(fw, new KeymapSimState(new Map([[43, 4], [44, 22]])))
  const link = new K98Link(await WebHidTransport.open(fake, 0), { timeoutMs: 50, retries: 0 })
  return { fake, fw, state, link, keymap: new K98Keymap(link), profiles: new K98Profiles(link) }
}

describe('K98Keymap', () => {
  it('reads 9 ids per packet and decodes 6-byte records', async () => {
    const { keymap, fake } = await setup()
    expect(KEYMAP_READ_CHUNK).toBe(18)
    const ids = Array.from({ length: 20 }, (_, i) => i + 40)
    const bindings = await keymap.read({ layer: 0, os: 'windows' }, ids)
    expect(bindings).toHaveLength(20)
    expect(bindings.find((b) => b.id === 43)).toEqual({ id: 43, keycode: 4 })
    expect(bindings.find((b) => b.id === 50)).toEqual({ id: 50, keycode: 0 })
    expect(fake.sent).toHaveLength(3) // ceil(20 / 9)
    expect(hex(fake.sent[0]!.data.subarray(0, 6))).toBe('83 00 00 03 00 12')
  })

  it('writes one 6-byte record per key with the layer/system param', async () => {
    const { keymap, state, fake } = await setup()
    await keymap.write({ layer: 1, os: 'macos' }, [{ id: 43, keycode: 0x00010000 }])
    expect(hex(fake.sent[0]!.data.subarray(0, 12))).toBe('03 05 00 01 00 06 00 2b 00 01 00 00')
    expect(state.get(1, 1, 43)).toBe(0x00010000)
    expect(state.get(0, 0, 43)).toBe(4)
    const back = await keymap.read({ layer: 1, os: 'macos' }, [43])
    expect(back).toEqual([{ id: 43, keycode: 0x00010000 }])
    await expect(keymap.write({ layer: 0, os: 'windows' }, [])).rejects.toThrow()
  })

  it('splits large writes at whole records and resets a layer', async () => {
    const { keymap, state, fake } = await setup()
    const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, keycode: 0x1000 + i }))
    await keymap.write({ layer: 0, os: 'windows' }, many)
    expect(fake.sent).toHaveLength(3)
    expect(fake.sent.map((s) => s.data[5])).toEqual([54, 54, 12])
    expect(state.get(0, 0, 20)).toBe(0x1000 + 19)
    await keymap.reset({ layer: 0, os: 'windows' })
    expect(hex(fake.sent[3]!.data.subarray(0, 7))).toBe('11 00 00 01 00 01 01')
    expect(state.get(0, 0, 20)).toBe(0)
  })
})

describe('K98Profiles', () => {
  it('reads current profile and names, switches and renames', async () => {
    const { profiles, state } = await setup()
    state.profile = 1
    state.profileNames[2] = 'Gaming'
    expect(await profiles.get()).toEqual({ count: 3, current: 1, names: ['', '', 'Gaming'] })
    await profiles.select(2)
    expect(state.profile).toBe(2)
    await profiles.rename(0, 'Wörk')
    expect(state.profileNames[0]).toBe('Wörk')
    expect(await profiles.name(0)).toBe('Wörk')
    await expect(profiles.rename(0, 'x'.repeat(56))).rejects.toThrow('too long')
  })
})
