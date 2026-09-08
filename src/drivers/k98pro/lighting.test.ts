import { describe, expect, it } from 'vitest'
import { hex } from '@/hid/core/bytes'
import { WebHidTransport } from '@/hid/core/transport'
import { FakeHidDevice } from '@/hid/core/testing/fakeHidDevice'
import { K98ProFirmware } from '@/sim/k98pro/firmware'
import { installLightingSim } from '@/sim/k98pro/lightingSim'
import { K98Config } from './config'
import { K98Lighting, buildWirelessLightReports, encodeGroupedRgb, groupColors, rgb565 } from './lighting'
import { K98Macros, decodeMacroImage, encodeAction, encodeMacroImage, macroStorageSize } from './macros'
import { K98Link } from './transport'

async function setup(linkType: 'wired' | 'dongle' = 'wired') {
  const fake = new FakeHidDevice('K98 Pro', 0x372e, 0x10e5, 0)
  const fw = new K98ProFirmware().attach(fake)
  const state = installLightingSim(fw)
  const link = new K98Link(await WebHidTransport.open(fake, 0), { timeoutMs: 50, retries: 0 })
  const config = new K98Config(link)
  return { fake, fw, state, link, lighting: new K98Lighting(link, config, linkType), macros: new K98Macros(link) }
}

describe('K98Lighting', () => {
  it('reports capabilities from the support probe and feature bitmap', async () => {
    const { lighting, state } = await setup()
    state.logoLight = true
    const caps = await lighting.capabilities()
    expect(caps.zones).toEqual(['main', 'side', 'logo'])
    expect(caps.effects.main).toHaveLength(20)
    expect(caps.customEffectId).toBe(19)
    expect(caps.streaming).toEqual({ perKey: true, fullKeys: true, experimental: true })
    expect(caps.sideLightCount).toBe(2)
    expect(await lighting.support()).toMatchObject({ musicMain: true, musicSpectrum: true, musicSide: false })
  })

  it('reads and writes zone records and effect ids', async () => {
    const { lighting, state, fake } = await setup()
    expect(await lighting.get('main')).toEqual({ effectId: 3, colorIndex: 7, color: { r: 0, g: 0, b: 0 }, brightness: 20, speed: 2 })
    await lighting.set('side', { effectId: 4, colorIndex: 0, color: { r: 155, g: 255, b: 49 }, brightness: 9, speed: 1 })
    expect(hex(fake.sent[1]!.data.subarray(0, 13))).toBe('04 06 00 01 00 07 04 00 9b ff 31 04 01') // brightness clamped to 4
    await lighting.setEffect('main', 19)
    expect(hex(fake.sent[2]!.data.subarray(0, 7))).toBe('04 02 00 01 00 01 13')
    expect(state.zones.get(1)![0]).toBe(19)
    // custom mode + random index + black → red (vendor quirk)
    state.zones.set(1, [19, 7, 0, 0, 0, 20, 0])
    expect((await lighting.get('main')).color).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('round-trips per-key colours in 5-byte records (11 per packet)', async () => {
    const { lighting, fake } = await setup()
    const colors = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, color: { r: i, g: 2 * i, b: 3 * i } }))
    await lighting.setCustomColors(colors)
    expect(fake.sent.map((s) => s.data[5])).toEqual([55, 55, 15])
    expect(hex(fake.sent[0]!.data.subarray(0, 11))).toBe('06 00 00 03 00 37 00 01 00 00 00')
    const back = await lighting.getCustomColors(colors.map((c) => c.id))
    expect(back).toEqual(colors)
    expect(fake.sent.length).toBe(3 + 3) // 22-byte id chunks → 11 ids per packet
  })

  it('streams grouped colours with 0x08/0x01 and full colour with 0x08/0x02', async () => {
    const { lighting, state, fake } = await setup()
    await lighting.stream([
      { id: 1, color: { r: 255, g: 0, b: 0 } },
      { id: 2, color: { r: 250, g: 3, b: 2 } },
      { id: 3, color: { r: 0, g: 0, b: 255 } },
    ])
    expect(state.streamed).toHaveLength(1)
    expect(state.streamed[0]!.sub).toBe(1)
    expect(state.streamed[0]!.data).toEqual([253, 2, 1, 2, 1, 2, 0, 0, 255, 1, 3])
    await lighting.streamAll({ r: 1, g: 2, b: 3 })
    expect(hex(fake.sent[1]!.data.subarray(0, 9))).toBe('08 02 00 01 00 03 01 02 03')
  })

  it('uses raw report-0x09 packets on the dongle link', async () => {
    const { lighting, fake } = await setup('dongle')
    await lighting.streamAll({ r: 10, g: 20, b: 30 })
    expect(fake.sent[0]!.reportId).toBe(9)
    expect(fake.sent[0]!.data.length).toBe(19)
    expect(hex(fake.sent[0]!.data.subarray(0, 7))).toBe('08 01 00 23 0a 14 1e')
    const reports = buildWirelessLightReports(1, new Array(30).fill(1))
    expect(reports).toHaveLength(3)
    expect(reports[0]![4]).toBe(0x10 | 13)
    expect(reports[2]![4]).toBe(0x10 | 4)
    for (const r of reports) expect(r.reduce((a, b) => a + b, 0) % 256).toBe(255)
  })

  it('helpers: colour grouping, grouped payload, rgb565', () => {
    const groups = groupColors([
      { id: 1, color: { r: 0, g: 0, b: 0 } },
      { id: 2, color: { r: 10, g: 10, b: 10 } },
      { id: 3, color: { r: 200, g: 200, b: 200 } },
    ])
    expect(groups).toEqual([{ ids: [1, 2], color: { r: 5, g: 5, b: 5 } }, { ids: [3], color: { r: 200, g: 200, b: 200 } }])
    expect(encodeGroupedRgb(groups)).toEqual([5, 5, 5, 2, 1, 2, 200, 200, 200, 1, 3])
    expect(rgb565({ r: 255, g: 255, b: 255 })).toBe(0xffff)
    expect(rgb565({ r: 255, g: 0, b: 0 })).toBe(0xf800)
  })
})

describe('K98Macros', () => {
  const macros = [
    { name: 'ab', actions: [{ kind: 'key' as const, code: 4, state: 'down' as const, delayMs: 50 }, { kind: 'key' as const, code: 4, state: 'up' as const, delayMs: 0 }] },
    { name: 'Ctrl', actions: [{ kind: 'modifier' as const, code: 0xe0, state: 'down' as const, delayMs: 0x12345 }, { kind: 'mouse' as const, code: 1, state: 'up' as const, delayMs: 10 }] },
  ]

  it('encodes the storage image described in the doc', () => {
    expect(encodeAction(macros[0]!.actions[0]!)).toEqual([0x00, 0x00, 0x32, 0x04])
    expect(encodeAction(macros[0]!.actions[1]!)).toEqual([0x80, 0x00, 0x00, 0x04])
    expect(encodeAction(macros[1]!.actions[0]!)).toEqual([0x11, 0x23, 0x45, 0xe0])
    expect(encodeAction(macros[1]!.actions[1]!)).toEqual([0xa0, 0x00, 0x0a, 0x01])
    const image = encodeMacroImage(macros)
    // header: two entries, offsets 8 and 8+11
    expect(Array.from(image.subarray(0, 8))).toEqual([8, 0, 11, 0, 19, 0, 13, 0])
    expect(Array.from(image.subarray(8, 19))).toEqual([2, 0x61, 0x62, 0, 0, 0x32, 4, 0x80, 0, 0, 4])
    expect(decodeMacroImage(image)).toEqual(macros)
    expect(macroStorageSize(macros)).toBe(image.length)
  })

  it('reads storage size, writes and reads back through the simulator', async () => {
    const { macros: svc, state, fake } = await setup()
    expect(await svc.maxStorageBytes()).toBe(0x800)
    expect(await svc.list()).toEqual([])
    await svc.save(macros)
    expect(hex(fake.sent[fake.sent.length - 1]!.data.subarray(0, 6))).toBe('05 00 00 01 00 20')
    expect(state.macroImage.length).toBe(32)
    expect(await svc.list()).toEqual(macros)
    // read packets carry the byte offset in header bytes 1-2
    const big = Array.from({ length: 3 }, (_, i) => ({ name: `m${i}`, actions: Array.from({ length: 20 }, (_, j) => ({ kind: 'key' as const, code: 4 + j, state: (j % 2 ? 'up' : 'down') as 'up' | 'down', delayMs: j })) }))
    await svc.save(big)
    fake.sent.length = 0
    expect(await svc.list()).toEqual(big)
    const reads = fake.sent.filter((s) => s.data[0] === 0x85)
    expect(reads.map((s) => ((s.data[1]! << 8) | s.data[2]!)).slice(-5)).toEqual([0, 56, 112, 168, 224])
  })
})
