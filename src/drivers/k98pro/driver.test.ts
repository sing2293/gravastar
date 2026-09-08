import { describe, expect, it } from 'vitest'
import { createSimK98Pro } from '@/sim/k98pro/device'
import { K98ProFirmware } from '@/sim/k98pro/firmware'
import { HID_FILTERS, identify } from '@/drivers/registry'
import type { KeyboardEvents } from '@/model/keyboard'
import { K98ProDriver } from './driver'

describe('K98ProDriver over the simulator', () => {
  it('connects, reports info/capabilities and exercises every service', async () => {
    const sim = createSimK98Pro({ variant: 'uk' })
    const driver = await sim.openDriver()
    expect(driver.link).toBe('wired')
    expect(await driver.info()).toEqual({ firmwareVersion: 'V1.1.7', uniqueId: '0x14000000000e' })
    const caps = await driver.capabilities()
    expect(caps.layout.variant).toBe('uk')
    expect(caps.layout.keys).toHaveLength(99)
    expect(caps.profiles).toBe(3)
    expect(caps.features.lcdDisplay).toBe(true)
    expect((await driver.battery())?.level).toBe(100)
    const esc = await driver.keymap.read({ layer: 0, os: 'windows' }, [1])
    expect(esc).toEqual([{ id: 1, keycode: 0x29 }])
    expect(driver.actions.describe(esc[0]!.keycode)).toBe('Esc')
    await driver.keymap.write({ layer: 0, os: 'windows' }, [{ id: 1, keycode: driver.actions.toKeycode({ type: 'consumer', usage: 0xe9 }) }])
    expect(sim.keymap.get(0, 0, 1)).toBe(0x020000e9)
    expect((await driver.lighting.get('main')).effectId).toBe(3)
    expect((await driver.profiles.get()).count).toBe(3)
    expect(await driver.macros.list()).toEqual([])
    expect((await driver.performance.capabilities()).experimental).toBe(true)
    expect(await driver.advancedKeys.list({ layer: 0, os: 'windows' })).toEqual([])
    expect((await driver.display.capabilities()).lcd).toBe(true)
    await driver.reset('all')
    expect(sim.firmware.log[sim.firmware.log.length - 1]).toBe('11/00')
  })

  it('turns device pushes into typed events', async () => {
    const sim = createSimK98Pro()
    const driver = await sim.openDriver()
    const seen: string[] = []
    const events: (keyof KeyboardEvents & string)[] = ['battery', 'profile-change', 'os-change', 'travel', 'calibration', 'lighting-change', 'dongle-link']
    for (const e of events) driver.on(e, (payload) => seen.push(`${e}:${JSON.stringify(payload)}`))
    K98ProFirmware.bubble(sim.device, K98ProFirmware.batteryBubble(50, false))
    K98ProFirmware.bubble(sim.device, [0xfe, 0x09, 1])
    K98ProFirmware.bubble(sim.device, [0xfe, 0x02, 1])
    expect(seen).toEqual(['battery:{"level":50,"charging":false,"full":false}', 'profile-change:1', 'dongle-link:true'])
    await driver.disconnect()
    expect(sim.device.opened).toBe(false)
  })

  it('runs the same services over the framed dongle link', async () => {
    const sim = createSimK98Pro({ link: 'dongle' })
    await new Promise((r) => setTimeout(r, 0)) // let the framing responder attach
    const driver = await sim.openDriver()
    expect(driver.link).toBe('dongle')
    expect(await driver.info()).toEqual({ firmwareVersion: 'V1.1.7', uniqueId: '0x14000000000c' })
    const read = await driver.keymap.read({ layer: 0, os: 'windows' }, [1, 2, 3])
    expect(read.map((b) => b.keycode)).toEqual([0x29, 0x3a, 0x3b])
    await driver.lighting.streamAll({ r: 1, g: 2, b: 3 })
    expect(sim.device.sent.some((s) => s.reportId === 9)).toBe(true)
  })
})

describe('registry', () => {
  it('identifies products and link types', () => {
    expect(identify({ vendorId: 0x372e, productId: 0x10e5 })).toMatchObject({ product: { slug: 'k98-pro' }, link: 'wired' })
    expect(identify({ vendorId: 0x372e, productId: 0x106c })).toMatchObject({ product: { slug: 'k98-pro' }, link: 'dongle' })
    expect(identify({ vendorId: 0x3554, productId: 0xf549, productName: 'GravaStar M1 Pro' })).toMatchObject({ product: { slug: 'mercury-m1-pro' }, link: 'wired' })
    expect(identify({ vendorId: 0x3554, productId: 0xf549, productName: 'Mercury X Pro' })).toMatchObject({ product: { slug: 'mercury-x-pro' }, link: 'wired' })
    expect(identify({ vendorId: 0x3554, productId: 0xf575, productName: 'Mercury X' })).toMatchObject({ product: { slug: 'mercury-x' }, link: 'dongle' })
    expect(identify({ vendorId: 0x3554, productId: 0xf577 })).toMatchObject({ product: { slug: 'mercury-m2' }, link: 'dongle' })
    expect(identify({ vendorId: 0x1234, productId: 1 })).toBeUndefined()
    expect(K98ProDriver.linkTypeFor(0x106c)).toBe('dongle')
    expect(HID_FILTERS.length).toBe(8)
  })
})
