import { afterEach, describe, expect, it, vi } from 'vitest'
import { hex } from '@/hid/core/bytes'
import { createSimCompxMouse } from '@/sim/compx/device'
import { CompxMouseFirmware } from '@/sim/compx/firmware'
import {
  Addr,
  SENSORS,
  decodeDpiStage,
  decodeKeySlot,
  decodeMacroRecord,
  decodeShortcut,
  dpiToRaw,
  encodeCombo,
  encodeDpiStage,
  encodeKeySlot,
  encodeMacroRecord,
  encodeMedia,
  reportRateFromByte,
  reportRateToByte,
  snapDpi,
} from './eeprom'

const s3950 = SENSORS['3950']!

describe('Compx EEPROM records', () => {
  it('encodes DPI stages like the vendor (3950 worked examples)', () => {
    expect(hex(encodeDpiStage(s3950, 800))).toBe('0f 0f 00 37')
    expect(hex(encodeDpiStage(s3950, 1600))).toBe('1f 1f 00 17')
    expect(hex(encodeDpiStage(s3950, 6400))).toBe('7f 7f 00 57')
    expect(hex(encodeDpiStage(s3950, 26000))).toBe('07 07 88 bf')
    expect(hex(encodeDpiStage(s3950, 32000))).toBe('3f 3f 55 82')
    expect(dpiToRaw(s3950, 32000)).toEqual({ raw: 319, dpiEx: 0x11 })
    for (const dpi of [50, 800, 1600, 6400, 26000, 30000, 32000]) expect(decodeDpiStage(s3950, encodeDpiStage(s3950, dpi))).toEqual({ dpiX: dpi, dpiY: dpi })
    expect(decodeDpiStage(s3950, encodeDpiStage(s3950, 800, 1600))).toEqual({ dpiX: 800, dpiY: 1600 })
    expect(snapDpi(s3950, 823)).toBe(850)
    expect(snapDpi(s3950, 31234)).toBe(31300)
    expect(snapDpi(s3950, 999999)).toBe(60000)
  })

  it('report rate bytes', () => {
    expect([125, 250, 500, 1000, 2000, 4000, 8000].map(reportRateToByte)).toEqual([8, 4, 2, 1, 0x10, 0x20, 0x40])
    expect([8, 4, 2, 1, 0x10, 0x20, 0x40].map(reportRateFromByte)).toEqual([125, 250, 500, 1000, 2000, 4000, 8000])
  })

  it('key slots, shortcuts and macros match the doc byte examples', () => {
    expect(hex(encodeKeySlot(s3950, 0, { type: 'button', button: 'left' }))).toBe('01 01 00 53')
    expect(hex(encodeKeySlot(s3950, 5, { type: 'dpi', action: 'loop' }))).toBe('02 01 00 52')
    expect(hex(encodeKeySlot(s3950, 3, { type: 'fire', times: 3, interval: 10 }))).toBe('04 0a 03 44')
    expect(hex(encodeKeySlot(s3950, 5, { type: 'macro', cycles: 1 }))).toBe('06 05 01 49')
    expect(hex(encodeKeySlot(s3950, 4, { type: 'dpiLock', dpi: 400 }))).toBe('0a 07 00 44')
    expect(decodeKeySlot(s3950, [0x0a, 0x07, 0x00, 0x44])).toEqual({ type: 'dpiLock', dpi: 400 })
    expect(decodeKeySlot(s3950, [0x04, 0x0a, 0x03, 0x44])).toEqual({ type: 'fire', interval: 10, times: 3 })
    expect(decodeKeySlot(s3950, [0x06, 0x05, 0xfd, 0x00])).toEqual({ type: 'macro', cycles: 'untilPressedAgain' })
    expect(hex(encodeCombo(['lctrl'], 0x04))).toBe('04 80 01 00 81 04 00 41 04 00 40 01 00 c5')
    expect(hex(encodeMedia(0xe9))).toBe('02 82 e9 00 42 e9 00 bd')
    expect(decodeShortcut(encodeCombo(['lctrl', 'lshift'], 0x04))).toEqual({ type: 'combo', modifiers: ['lctrl', 'lshift'], usage: 4 })
    expect(decodeShortcut(encodeMedia(0xe9))).toEqual({ type: 'media', usage: 0xe9 })
    const macro = { name: 'ab', events: [{ kind: 'key' as const, code: 4, state: 'down' as const, delayMs: 50 }, { kind: 'key' as const, code: 4, state: 'up' as const, delayMs: 0 }] }
    const rec = encodeMacroRecord(macro)
    expect(hex(rec.subarray(0, 3))).toBe('02 61 62')
    expect(rec[31]).toBe(2)
    expect(hex(rec.subarray(32))).toBe('81 04 00 00 32 41 04 00 00 00 57')
    expect(decodeMacroRecord(rec)).toEqual(macro)
    expect(() => encodeMacroRecord({ name: '', events: [] })).toThrow()
  })
})

describe('CompxMouseDriver over the simulator', () => {
  afterEach(() => vi.useRealTimers())

  it('connects (handshake, online, flash sync, versions, battery) and reports capabilities', async () => {
    const sim = createSimCompxMouse()
    const driver = await sim.openDriver()
    expect(sim.firmware.log.slice(0, 3)).toEqual(['01', '03', '08'])
    expect(driver.current).toMatchObject({ cid: 18, mid: 3, wired: true, maxReportRate: 1000, firmware: 'v1.02' })
    expect(await driver.info()).toEqual({ firmwareVersion: 'v1.02', dongleFirmwareVersion: undefined, uniqueId: 'ccbbaa' })
    expect(await driver.battery()).toEqual({ level: 80, charging: false, voltageMv: 3900 })
    const caps = await driver.capabilities()
    expect(caps.model).toEqual({ cid: 18, mid: 3, sensor: '3950', maxReportRate: 1000 })
    expect(caps.keys).toHaveLength(6)
    expect(caps.hasDongle).toBe(false)
    expect(driver.dongle).toBeUndefined()
    await driver.disconnect()
  })

  it('reads and writes DPI, report rate, sensor, keys, lighting, power, profile', async () => {
    const sim = createSimCompxMouse({ link: 'dongle', typeByte: 5 })
    const driver = await sim.openDriver()
    expect(driver.current.maxReportRate).toBe(8000)
    expect(await driver.reportRate.options()).toEqual([125, 250, 500, 1000, 2000, 4000, 8000])

    const dpi = await driver.dpi.get()
    expect(dpi.stageCount).toBe(6)
    expect(dpi.current).toBe(2)
    expect(dpi.stages.slice(0, 3).map((s) => s.dpiX)).toEqual([800, 1200, 1600])
    expect(dpi.stages[0]!.color).toEqual({ r: 255, g: 0, b: 0 })
    await driver.dpi.setStage(0, { dpiX: 1234, color: { r: 1, g: 2, b: 3 } })
    await driver.dpi.setCurrent(0)
    await driver.dpi.setStageCount(4)
    const dpi2 = await driver.dpi.get()
    expect(dpi2.stages[0]).toEqual({ dpiX: 1250, dpiY: 1250, color: { r: 1, g: 2, b: 3 } })
    expect(dpi2.current).toBe(0)
    expect(dpi2.stageCount).toBe(4)

    await driver.reportRate.set(4000)
    expect(await driver.reportRate.get()).toBe(4000)
    expect(sim.firmware.flash[Addr.ReportRate]).toBe(0x20)
    expect((await driver.sensor.sensorModeState())).toEqual({ value: 'corded', editable: false })
    await driver.reportRate.set(1000)
    expect((await driver.sensor.sensorModeState())).toEqual({ value: 'lowPower', editable: true })
    await driver.sensor.update('sensorMode', 'highPerformance')
    await driver.sensor.update('lod', 2)
    await driver.sensor.update('rippleControl', true)
    expect(await driver.sensor.get()).toMatchObject({ lod: 2, motionSync: true, rippleControl: true, angleSnap: false, performanceMode: false, performanceSeconds: 60, sensorMode: 'highPerformance' })
    expect((await driver.sensor.capabilities()).lodOptions.map((o) => o.value)).toEqual([3, 1, 2])

    const keys = await driver.keys.list()
    expect(keys.map((k) => k.fn)).toEqual([
      { type: 'button', button: 'left' },
      { type: 'button', button: 'right' },
      { type: 'button', button: 'middle' },
      { type: 'button', button: 'back' },
      { type: 'button', button: 'forward' },
      { type: 'dpi', action: 'loop' },
    ])
    await driver.keys.set(3, { type: 'combo', modifiers: ['lctrl'], usage: 0x06 })
    await driver.keys.set(4, { type: 'media', usage: 0xe9 })
    const macro = { name: 'hi', events: [{ kind: 'key' as const, code: 0x0b, state: 'down' as const, delayMs: 20 }, { kind: 'key' as const, code: 0x0b, state: 'up' as const, delayMs: 20 }] }
    await driver.keys.set(5, { type: 'macro', cycles: 3 }, macro)
    await driver.syncFromDevice()
    const keys2 = await driver.keys.list()
    expect(keys2[3]!.fn).toEqual({ type: 'combo', modifiers: ['lctrl'], usage: 6 })
    expect(keys2[4]!.fn).toEqual({ type: 'media', usage: 0xe9 })
    expect(keys2[5]!.fn).toEqual({ type: 'macro', cycles: 3 })
    expect(keys2[5]!.macro).toEqual(macro)
    await driver.keys.restore(5)
    expect((await driver.keys.list())[5]!.fn).toEqual({ type: 'dpi', action: 'loop' })
    await driver.keys.setDebounce(12)
    expect(await driver.keys.getDebounce()).toBe(12)

    expect(await driver.lighting.get()).toMatchObject({ on: false, mode: 1, speed: 7, brightness: 4, offWhileMoving: true })
    await driver.lighting.set({ mode: 3, color: { r: 0, g: 255, b: 0 }, brightness: 9 })
    expect(await driver.lighting.get()).toMatchObject({ on: true, mode: 3, color: { r: 0, g: 255, b: 0 }, brightness: 9 })
    await driver.lighting.set({ mode: 0 })
    expect((await driver.lighting.get()).on).toBe(false)

    expect(await driver.power.getSleepSeconds()).toBe(10)
    await driver.power.setSleepSeconds(300)
    expect(sim.firmware.flash[Addr.SleepTime]).toBe(30)

    expect(await driver.profiles.get()).toEqual({ current: 0, supported: true })
    const events: string[] = []
    driver.on('profile-change', (p) => events.push(`profile:${p}`))
    await driver.profiles.select(2)
    expect(sim.firmware.profile).toBe(2)
    expect(events).toEqual(['profile:2'])

    expect(await driver.dongle!.longRange()).toEqual({ supported: true, enabled: false })
    await driver.dongle!.setLongRange(true)
    expect(sim.firmware.longRange).toBe(true)
    expect(await driver.dongle!.version()).toBe('v2.05')
    await driver.disconnect()
  })

  it('reacts to StatusChanged pushes and exports/imports settings', async () => {
    const sim = createSimCompxMouse()
    const driver = await sim.openDriver()
    const seen: string[] = []
    driver.on('dpi-change', (i) => seen.push(`dpi:${i}`))
    driver.on('report-rate-change', (r) => seen.push(`rate:${r}`))
    sim.firmware.flash[Addr.CurrentDpi] = 4
    sim.firmware.flash[Addr.ReportRate] = 2
    CompxMouseFirmware.statusChanged(sim.device, 0x01 | 0x02)
    await new Promise((r) => setTimeout(r, 30))
    expect(seen).toEqual(['dpi:4', 'rate:500'])

    const image = await driver.exportSettings()
    expect(image.length).toBe(0x4000 + 64)
    expect(new TextDecoder().decode(image.subarray(0x4000, 0x4009))).toBe('Compx Inc')
    image[Addr.DebounceTime] = 3
    image[Addr.DebounceTime + 1] = 0x52
    await driver.importSettings(image)
    expect(await driver.keys.getDebounce()).toBe(3)
    await expect(driver.importSettings(new Uint8Array(10))).rejects.toThrow('not a Compx')
    await driver.disconnect()
  })

  it('times out cleanly when the mouse never answers', async () => {
    const sim = createSimCompxMouse()
    sim.device.respond = () => []
    const { WebHidTransport } = await import('@/hid/core/transport')
    const { CompxLink } = await import('./link')
    const link = new CompxLink(await WebHidTransport.open(sim.device, 8), { timeoutMs: 5, attempts: 2 })
    await expect(link.command(0x03)).rejects.toThrow('timed out')
    expect(sim.device.sent).toHaveLength(2)
  })
})
