import { describe, expect, it } from 'vitest'
import { WebHidTransport } from '@/hid/core/transport'
import { FakeHidDevice } from '@/hid/core/testing/fakeHidDevice'
import { K98ProFirmware } from '@/sim/k98pro/firmware'
import { parseBubble } from './bubbles'
import { K98Config, bitmapToIndices, parseFirmwareVersion } from './config'
import { K98Link } from './transport'

async function setup() {
  const fake = new FakeHidDevice('K98 Pro', 0x372e, 0x10e5, 0)
  const fw = new K98ProFirmware().attach(fake)
  const link = new K98Link(await WebHidTransport.open(fake, 0), { timeoutMs: 50, retries: 0 })
  return { fake, fw, link, config: new K98Config(link) }
}

describe('K98Config', () => {
  it('reads uuid and firmware version', async () => {
    const { config, fw } = await setup()
    expect(await config.getUuid()).toEqual({ value: 0x14000000000c, hex: '0x14000000000c' })
    expect(await config.getFirmwareVersion()).toMatchObject({ raw: 0x0117, major: 1, minor: 1, subminor: 7, text: '1.1.7' })
    expect(fw.log.slice(0, 2)).toEqual(['82/01', '82/02'])
  })

  it('decodes capability bitmaps and the feature struct', async () => {
    const { config, fw } = await setup()
    fw.supportedSwitches = [0, 5]
    fw.supportedAdvancedKeyTypes = [0, 1, 3, 5]
    expect(await config.getSupportedSwitches()).toEqual([0, 5])
    expect(await config.getSupportedAdvancedKeyTypes()).toEqual(['TGL', 'MT', 'SOCD', 'END'])
    const f = await config.features()
    expect(f).toMatchObject({ lcdDisplay: true, dotMatrixDisplay: false, lowPowerMode: true, winMode: true, macMode: true, keyIdRGB: true, fullKeysRGB: true, ledBeadRGB565: true, twoStageTrigger: true, switchMixing: false })
    expect(await config.getMinRapidTrigger()).toBe(10)
    expect(await config.isLowPowerModeSupported()).toBe(true)
  })

  it('round-trips settings through 0x84/0x04', async () => {
    const { config, fw } = await setup()
    const s = await config.read()
    expect(s).toEqual({ osMode: 'windows', pollingRate: 1000, sleepSeconds: 60, winKeyLock: false, comboOptimization: false, adaptiveCalibration: true, debounceMode: 'normal', debounceUs: 8000 })
    await config.update('osMode', 'macos')
    await config.update('pollingRate', 8000)
    await config.update('sleepSeconds', 300)
    await config.update('debounceMode', 'trailing')
    await config.update('debounceUs', 12000)
    await config.update('winKeyLock', true)
    expect(fw.settings.get(0x11)).toEqual([1])
    expect(fw.settings.get(0x17)).toEqual([4])
    expect(fw.settings.get(0x13)).toEqual([0x01, 0x2c])
    expect(fw.settings.get(0x1d)).toEqual([2])
    expect(fw.settings.get(0x1e)).toEqual([0x2e, 0xe0])
    const again = await config.read()
    expect(again).toMatchObject({ osMode: 'macos', pollingRate: 8000, sleepSeconds: 300, debounceMode: 'trailing', debounceUs: 12000, winKeyLock: true })
  })

  it('reads battery, matrix positions and sends resets', async () => {
    const { config, fw } = await setup()
    fw.battery = { level: 42, charging: true, full: false }
    expect(await config.battery()).toEqual({ level: 42, charging: true, full: false })
    const pos = await config.keyMatrixPositions([1, 22, 43])
    expect(pos).toEqual([
      { id: 1, row: 0, col: 0 },
      { id: 22, row: 1, col: 0 },
      { id: 43, row: 2, col: 0 },
    ])
    await config.reset('keymap', { layer: 1, os: 'macos' })
    expect(fw.log[fw.log.length - 1]).toBe('11/05')
    await config.reset('usb')
    expect(fw.log[fw.log.length - 1]).toBe('11/00')
  })

  it('delivers bubble events to link listeners', async () => {
    const { fake, link } = await setup()
    const events: unknown[] = []
    link.onBubble((b) => events.push(parseBubble(b)))
    K98ProFirmware.bubble(fake, K98ProFirmware.batteryBubble(77, true))
    K98ProFirmware.bubble(fake, [0xfe, 0x09, 2])
    K98ProFirmware.bubble(fake, [0xfe, 0x07, 1])
    K98ProFirmware.bubble(fake, [0xfe, 0x0b, 4, 15, 1, 2, 3])
    K98ProFirmware.bubble(fake, [0x98, 0x01, 0, 1, 0, 6, 0x00, 0x2b, 0x04, 0xb0, 0x83, 0x45])
    K98ProFirmware.bubble(fake, [0x94, 0x02, 0, 1, 0, 6, 0x00, 0x2b, 0x02, 0x10, 0x01, 0x00])
    expect(events).toEqual([
      { type: 'battery', status: { level: 77, charging: true, full: false } },
      { type: 'profile-change', profile: 2 },
      { type: 'os-change', os: 'macos' },
      { type: 'lighting-change', change: { zone: 'main', param: 'color', value: 15, color: { r: 1, g: 2, b: 3 } } },
      { type: 'travel', samples: [{ id: 43, distance: 1200, adc: 0x0345, pressed: true }] },
      { type: 'calibration', samples: [{ id: 43, adc: 0x0210, min: 256, pressed: false, finished: true }] },
    ])
  })
})

describe('helpers', () => {
  it('parses firmware version nibbles', () => {
    expect(parseFirmwareVersion(0x17, 0x01).text).toBe('1.1.7')
    expect(parseFirmwareVersion(0xff, 0x02)).toMatchObject({ major: 2, minor: 15, subminor: 15, hex: '0x02ff' })
  })
  it('bitmapToIndices is LSB-first per byte', () => {
    expect(bitmapToIndices(Uint8Array.from([0b00000101, 0b10000000]))).toEqual([0, 2, 15])
  })
})

describe('feature-bitmap caching', () => {
  it('reads once and reuses it, but never remembers a failure', async () => {
    const { config, fake } = await setup()
    const reads = () => fake.sent.filter((p) => p.data[0] === 0x82 && p.data[1] === 0x0f).length
    await config.features()
    await config.features()
    expect(reads()).toBe(1) // streaming consults this per frame: one round-trip, not thousands

    // A device that does not answer must not poison the cache for the rest of the session.
    const broken = await setup()
    let answer = false
    broken.fw.extensions.push((p) => (p.commandId === 0x82 && p.param === 0x0f && !answer ? [] : undefined))
    await expect(broken.config.features()).rejects.toThrow()
    answer = true
    await expect(broken.config.features()).resolves.toBeTruthy()
  })
})
