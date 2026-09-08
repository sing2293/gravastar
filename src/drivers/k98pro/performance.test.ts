import { afterEach, describe, expect, it, vi } from 'vitest'
import { hex } from '@/hid/core/bytes'
import { WebHidTransport } from '@/hid/core/transport'
import { FakeHidDevice } from '@/hid/core/testing/fakeHidDevice'
import { K98ProFirmware } from '@/sim/k98pro/firmware'
import { installPerformanceSim } from '@/sim/k98pro/performanceSim'
import { K98AdvancedKeys, decodeAdvancedKey, encodeAdvancedKey } from './advancedKeys'
import { buildPackets, withChecksum } from './codec'
import { K98Config } from './config'
import { K98Performance } from './performance'
import { K98Link } from './transport'

async function setup() {
  const fake = new FakeHidDevice('K98 Pro', 0x372e, 0x10e5, 0)
  const fw = new K98ProFirmware().attach(fake)
  const state = installPerformanceSim(fw)
  const link = new K98Link(await WebHidTransport.open(fake, 0), { timeoutMs: 50, retries: 0 })
  const config = new K98Config(link)
  return { fake, fw, state, link, perf: new K98Performance(link, config), adv: new K98AdvancedKeys(link, config) }
}

const WIN: { layer: 0; os: 'windows' } = { layer: 0, os: 'windows' }

describe('K98Performance', () => {
  afterEach(() => vi.useRealTimers())

  it('produces the worked byte examples from the doc', async () => {
    const { perf, fake } = await setup()
    await perf.setTravel(WIN, [{ id: 43, actuation: 1500 }])
    expect(hex(fake.sent[0]!.data.subarray(0, 11))).toBe('13 00 00 01 00 05 00 2b 05 dc 00')
    expect(fake.sent[0]!.data[62]).toBe(0xda)
    await perf.setRapidTriggers({ layer: 1, os: 'macos' }, [{ id: 43, enabled: true, press: 300, release: 300 }])
    expect(hex(fake.sent[1]!.data.subarray(0, 14))).toBe('19 05 00 01 00 08 00 2b 01 01 2c 01 2c 00')
    expect(fake.sent[1]!.data[62]).toBe(0x52)
    await perf.getSwitchTypes([1, 2, 3])
    expect(hex(fake.sent[2]!.data.subarray(0, 12))).toBe('95 00 00 01 00 06 00 01 00 02 00 03')
    await perf.getAdcRanges([43])
    expect(hex(fake.sent[3]!.data.subarray(0, 8))).toBe('94 05 00 01 00 02 00 2b')
  })

  it('round-trips switch types, safe areas, travel, rapid trigger and ADC ranges through the simulator', async () => {
    const { perf, state } = await setup()
    await perf.setSwitchTypes([{ id: 1, switchType: 2 }, { id: 2, switchType: 5 }])
    expect(await perf.getSwitchTypes([1, 2, 3])).toEqual([{ id: 1, switchType: 2 }, { id: 2, switchType: 5 }, { id: 3, switchType: 0 }])
    await perf.setSafeAreas([{ id: 43, top: 120, bottom: 300, enabled: true }])
    expect(await perf.getSafeAreas([43])).toEqual([{ id: 43, top: 120, bottom: 300, enabled: true }])
    await perf.setTravel(WIN, [{ id: 43, actuation: 800 }, { id: 44, actuation: 1200 }])
    expect(await perf.getTravel(WIN, [43, 44, 45])).toEqual([{ id: 43, actuation: 800 }, { id: 44, actuation: 1200 }, { id: 45, actuation: 2000 }])
    await perf.setRapidTriggers(WIN, [{ id: 43, enabled: true, press: 250, release: 150 }])
    expect(await perf.getRapidTriggers(WIN, [43])).toEqual([{ id: 43, enabled: true, press: 250, release: 150 }])
    state.adcRanges.set(43, { min: 400, max: 3200 })
    expect(await perf.getAdcRanges([43])).toEqual([{ id: 43, min: 400, max: 3200 }])
    // 20 keys → chunked so records never straddle packets (11 travel records per packet)
    const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, actuation: 1000 + i }))
    await perf.setTravel(WIN, many)
    expect(await perf.getTravel(WIN, many.map((m) => m.id))).toEqual(many)
  })

  it('keeps monitoring alive every second and stops with 0x98/0x02', async () => {
    vi.useFakeTimers()
    const { perf, fw, state } = await setup()
    await perf.startMonitoring([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(state.monitoring).toBe(true)
    expect(fw.log.filter((l) => l === '98/00')).toHaveLength(2) // start + key selection
    await vi.advanceTimersByTimeAsync(2100)
    expect(fw.log.filter((l) => l === '98/00')).toHaveLength(4)
    await perf.stopMonitoring()
    expect(state.monitoring).toBe(false)
    await vi.advanceTimersByTimeAsync(3000)
    expect(fw.log.filter((l) => l === '98/00')).toHaveLength(4)
    await perf.startCalibration()
    expect(state.calibrating).toBe(true)
    await perf.stopCalibration()
    expect(fw.log[fw.log.length - 1]).toBe('94/04')
    expect(state.calibrating).toBe(false)
  })
})

describe('K98AdvancedKeys', () => {
  it('encodes the worked examples (SOCD 0x88, MT 0x13, TGL 0xEC, delete 0xBF)', () => {
    const socd = buildPackets(0x12, 0, encodeAdvancedKey({ type: 'SOCD', ids: [43, 44], mode: 'lastWins' }), 0)[0]!
    socd[2] = 4
    withChecksum(socd, 0)
    expect(hex(socd.subarray(0, 12))).toBe('12 00 04 01 00 06 02 00 2b 00 2c 01')
    expect(socd[62]).toBe(0x88)
    const mt = buildPackets(0x12, 0, encodeAdvancedKey({ type: 'MT', id: 43, holdKeycode: 0x00010000, clickKeycode: 4, delayMs: 155 }), 0)[0]!
    mt[2] = 2
    withChecksum(mt, 0)
    expect(hex(mt.subarray(0, 18))).toBe('12 00 02 01 00 0c 00 2b 00 01 00 00 00 00 00 04 00 9b')
    expect(mt[62]).toBe(0x13)
    const tgl = buildPackets(0x12, 0, encodeAdvancedKey({ type: 'TGL', id: 43, keycode: 4, delayMs: 200 }), 0)[0]!
    tgl[2] = 1
    withChecksum(tgl, 0)
    expect(tgl[62]).toBe(0xec)
    expect(encodeAdvancedKey({ type: 'END', id: 43, keycode: 22 })).toEqual([0, 43, 0, 0, 0, 22])
    expect(encodeAdvancedKey({ type: 'RS', ids: [43, 44] })).toEqual([0, 43, 0, 44])
    expect(encodeAdvancedKey({ type: 'MPT', id: 43, points: [{ keycode: 4, distance: 5 }, { keycode: 22, distance: 9000 }] })).toEqual([0, 43, 2, 0, 0, 0, 4, 0, 10, 0, 0, 0, 22, 0x0f, 0xa0])
    const dks = encodeAdvancedKey({ type: 'DKS', id: 43, depths: { start: 500, bottom: 3000, bottomRelease: 2500, fullRelease: 300 }, groups: [{ keycode: 4, triggers: { start: 'instant', bottom: 'none', bottomRelease: 'none', fullRelease: 'none' } }] })
    expect(hex(dks)).toBe('00 2b 01 f4 0b b8 09 c4 01 2c 00 00 00 04 0a 00 00 00')
    expect(decodeAdvancedKey(3, Uint8Array.from(dks))).toEqual({ type: 'DKS', id: 43, depths: { start: 500, bottom: 3000, bottomRelease: 2500, fullRelease: 300 }, groups: [{ keycode: 4, triggers: { start: 'instant', bottom: 'none', bottomRelease: 'none', fullRelease: 'none' } }] })
  })

  it('writes, lists, reads back and deletes keys through the simulator', async () => {
    const { adv, fake } = await setup()
    await adv.set(WIN, { type: 'SOCD', ids: [43, 44], mode: 'key1Wins' })
    await adv.set(WIN, { type: 'MT', id: 45, holdKeycode: 0x00010000, clickKeycode: 4, delayMs: 155 })
    await adv.set(WIN, { type: 'END', id: 46, keycode: 22 })
    expect(fake.sent[0]!.data[2]).toBe(4)
    const keys = await adv.list(WIN)
    expect(keys).toEqual([
      { type: 'SOCD', ids: [43, 44], mode: 'key1Wins' },
      { type: 'SOCD', ids: [43, 44], mode: 'key1Wins' },
      { type: 'MT', id: 45, holdKeycode: 0x00010000, clickKeycode: 4, delayMs: 155 },
      { type: 'END', id: 46, keycode: 22 },
    ])
    await adv.delete(WIN, keys[0]!)
    await adv.delete(WIN, keys[2]!)
    expect(await adv.list(WIN)).toEqual([{ type: 'END', id: 46, keycode: 22 }])
    expect(await adv.get(WIN, 43)).toBeUndefined()
    await expect(adv.set(WIN, { type: 'RS', ids: [0, 44] })).rejects.toThrow('Invalid id')
  })
})
