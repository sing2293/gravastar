import { describe, expect, it } from 'vitest'
import { hex } from '@/hid/core/bytes'
import { WebHidTransport } from '@/hid/core/transport'
import { createSimCompxMouse } from '@/sim/compx/device'
import { CompxMouseDriver } from './driver'
import { Addr } from './eeprom'
import { complementPair, sumsTo55 } from './frame'
import { CompxLink } from './link'
import {
  SENSOR_MODE_HIGH,
  SESSION_PERFORMANCE_TIME,
  SESSION_SLEEP_BYTE,
  decodeDongleBar,
  encodeDongleBar,
  encodeMusicParams,
  packAmplitudes,
  unpackAmplitudes,
} from './music'

const PARAMS = {
  mode: 2,
  speed: 5,
  brightness: 8,
  colorMode: 1,
  forward: { r: 10, g: 20, b: 30 },
  backward: { r: 40, g: 50, b: 60 },
}
const BAR = { mode: 3, color: { r: 1, g: 2, b: 3 }, speed: 4, brightness: 6, time: 7 }

/** Frames the host sent for one command, as `[5..15)` payload hex. */
function sentPayloads(sim: ReturnType<typeof createSimCompxMouse>, command: number): string[] {
  return sim.device.sent.filter((s) => s.data[0] === command).map((s) => hex(s.data.subarray(5, 15)))
}

describe('music codecs', () => {
  it('packs 20 amplitudes two per byte, high nibble first (HIDHandle.js:2278-2285)', () => {
    expect(hex(packAmplitudes([1, 2, 15, 0]))).toBe('12 f0 00 00 00 00 00 00 00 00')
    expect(hex(packAmplitudes(Array.from({ length: 20 }, (_, i) => i)))).toBe('01 23 45 67 89 ab cd ef ff ff')
    // Rounds, clamps to 0..15, ignores extras and NaN.
    expect(hex(packAmplitudes([16, -1, 7.4, 7.5, NaN, 3, ...new Array<number>(14).fill(0), 9, 9, 9]))).toBe(
      'f0 78 03 00 00 00 00 00 00 00',
    )
    expect(unpackAmplitudes([0x12, 0xf0])).toEqual([1, 2, 15, 0, ...new Array<number>(16).fill(0)])
  })

  it('encodes the 0xB2 parameter and 0x18 bar payloads in the documented order', () => {
    expect(encodeMusicParams(PARAMS)).toEqual([2, 5, 8, 1, 10, 20, 30, 40, 50, 60])
    expect(encodeDongleBar(BAR)).toEqual([3, 1, 2, 3, 4, 6, 7, 0, 0, 0])
    expect(decodeDongleBar(encodeDongleBar(BAR))).toEqual(BAR)
    expect(encodeMusicParams({ ...PARAMS, mode: 300, speed: -4 }).slice(0, 2)).toEqual([255, 0])
  })
})

describe('CompxMusic.enterLightSession', () => {
  it('turns the light on, stops the firmware blanking it while the mouse moves, and puts both back', async () => {
    const sim = createSimCompxMouse({ link: 'dongle' })
    const driver = await sim.openDriver()
    const fw = sim.firmware.flash
    // Vendor default on most models: light off, and blanked whenever the mouse moves.
    fw.set(complementPair(1), Addr.MovingOffLight)
    fw.set(complementPair(0), Addr.LightState)
    await driver.hid.readRange(Addr.Light, Addr.MovingOffLight + 2) // refresh the host shadow
    expect((await driver.lighting.get()).offWhileMoving).toBe(true)

    const sleepBefore = fw[Addr.SleepTime]
    const perfBefore = fw[Addr.PerformanceState]
    const perfTimeBefore = fw[Addr.PerformanceTime]
    const sensorModeBefore = fw[Addr.SensorMode]
    expect(sleepBefore).toBeLessThan(SESSION_SLEEP_BYTE) // the model ships with a short idle light-off

    await driver.music.enterLightSession()
    expect(fw[Addr.MovingOffLight]).toBe(0) // a hand on the mouse no longer blanks the light
    expect(fw[Addr.LightState]).toBe(1)
    expect(fw[Addr.SleepTime]).toBe(SESSION_SLEEP_BYTE) // …and it no longer goes out part-way through a track
    // …and the mouse is held awake, or it stops servicing writes a few seconds after it stops moving.
    expect(fw[Addr.PerformanceState]).toBe(1)
    expect(fw[Addr.PerformanceTime]).toBe(SESSION_PERFORMANCE_TIME)
    expect(fw[Addr.SensorMode]).toBe(SENSOR_MODE_HIGH)
    expect(driver.music.flashWrites).toBe(6)

    await driver.music.setLightEffect({ mode: 3, color: { r: 255, g: 255, b: 255 }, speed: 0, brightness: 9 })
    await driver.music.restore()
    expect(fw[Addr.MovingOffLight]).toBe(1)
    expect(fw[Addr.LightState]).toBe(0)
    expect(fw[Addr.SleepTime]).toBe(sleepBefore)
    expect(fw[Addr.PerformanceState]).toBe(perfBefore)
    expect(fw[Addr.PerformanceTime]).toBe(perfTimeBefore)
    expect(fw[Addr.SensorMode]).toBe(sensorModeBefore)
    await driver.disconnect()
  })

  it('writes nothing when the light is already on, stays on while moving, and never idles out', async () => {
    const sim = createSimCompxMouse({ link: 'dongle' })
    const driver = await sim.openDriver()
    const fw = sim.firmware.flash
    fw.set(complementPair(0), Addr.MovingOffLight)
    fw.set(complementPair(1), Addr.LightState)
    fw.set(complementPair(SESSION_SLEEP_BYTE), Addr.SleepTime)
    fw.set(complementPair(1), Addr.PerformanceState)
    fw.set(complementPair(SESSION_PERFORMANCE_TIME), Addr.PerformanceTime)
    fw.set(complementPair(SENSOR_MODE_HIGH), Addr.SensorMode)
    await driver.hid.readRange(Addr.Light, Addr.SensorMode + 2)
    await driver.music.enterLightSession()
    expect(driver.music.flashWrites).toBe(0) // everything already as a session wants it
    await driver.disconnect()
  })

  it('setLightOn re-asserts the on byte for a bar the firmware blanked', async () => {
    const sim = createSimCompxMouse({ link: 'dongle' })
    const driver = await sim.openDriver()
    sim.firmware.flash.set(complementPair(0), Addr.LightState)
    await driver.music.setLightOn()
    expect(sim.firmware.flash[Addr.LightState]).toBe(1)
    expect(driver.music.flashWrites).toBe(1)
    await driver.disconnect()
  })
})

describe('CompxMusic over the simulator', () => {
  it('probes a wired mouse: no amplitude stream, no receiver bar (0x19 not even sent), light bar available', async () => {
    const sim = createSimCompxMouse()
    const driver = await sim.openDriver()
    const before = sim.firmware.log.length
    expect(await driver.music.probe()).toEqual({ amplitudeStream: false, dongleBar: false, flashLight: true })
    expect(sim.firmware.log.slice(before)).toEqual(['b6'])
    // Cached: probing again costs nothing; reprobe asks again.
    expect(await driver.music.probe()).toEqual({ amplitudeStream: false, dongleBar: false, flashLight: true })
    expect(sim.firmware.log.length).toBe(before + 1)
    sim.firmware.supportsMusicAmplitude = true
    expect((await driver.music.reprobe()).amplitudeStream).toBe(true)
    expect(sim.firmware.log.slice(before)).toEqual(['b6', 'b6'])
    await driver.disconnect()
  })

  it('probes a dongle mouse: receiver bar answers, amplitude only when the firmware accepts 0xB6', async () => {
    const plain = createSimCompxMouse({ link: 'dongle', typeByte: 5 })
    const d1 = await plain.openDriver()
    expect(await d1.music.probe()).toEqual({ amplitudeStream: false, dongleBar: true, flashLight: true })
    expect(plain.firmware.amplitudes).toEqual([])
    await d1.disconnect()

    const capable = createSimCompxMouse({ link: 'dongle', typeByte: 0, supportsMusicAmplitude: true })
    const d2 = await capable.openDriver()
    const flashBefore = capable.firmware.flashWrites
    expect(await d2.music.probe()).toEqual({ amplitudeStream: true, dongleBar: true, flashLight: true })
    // The probe is a frame of 20 zero amplitudes and touches nothing else.
    expect(capable.firmware.amplitudes).toEqual([new Array<number>(20).fill(0)])
    expect(capable.firmware.musicParams).toBeUndefined()
    expect(capable.firmware.flashWrites).toBe(flashBefore)
    await d2.disconnect()

    const noBar = createSimCompxMouse({ link: 'dongle', typeByte: 0, supportsDongleBar: false })
    const d3 = await noBar.openDriver()
    expect((await d3.music.probe()).dongleBar).toBe(false)
    await d3.disconnect()
  })

  it('streams amplitudes as 0xB6 frames without waiting for an echo', async () => {
    const sim = createSimCompxMouse({ supportsMusicAmplitude: true })
    const driver = await sim.openDriver()
    await driver.music.startAmplitude(PARAMS)
    expect(sim.firmware.musicParams).toEqual([2, 5, 8, 1, 10, 20, 30, 40, 50, 60])
    expect(sentPayloads(sim, 0xb2)).toEqual(['02 05 08 01 0a 14 1e 28 32 3c'])
    await driver.music.sendAmplitudes([1, 2, 15, 0])
    await driver.music.sendAmplitudes(new Uint8Array([9, 9, 9]))
    expect(sentPayloads(sim, 0xb6)).toEqual(['12 f0 00 00 00 00 00 00 00 00', '99 90 00 00 00 00 00 00 00 00'])
    expect(sim.firmware.amplitudes).toEqual([
      [1, 2, 15, 0, ...new Array<number>(16).fill(0)],
      [9, 9, 9, ...new Array<number>(17).fill(0)],
    ])
    expect(driver.music.amplitudeFrames).toBe(2)
    await driver.disconnect()
  })

  it('rejects startAmplitude when the firmware NAKs 0xB2, and restore then sends no 0xB7', async () => {
    const sim = createSimCompxMouse()
    const driver = await sim.openDriver()
    await driver.music.snapshot()
    await expect(driver.music.startAmplitude(PARAMS)).rejects.toThrow('0xB2')
    const before = sim.firmware.log.length
    await driver.music.restore()
    expect(sim.firmware.log.slice(before)).toEqual([])
    await driver.disconnect()
  })

  it('sets the receiver bar with 0x18 and reads it back with 0x19', async () => {
    const sim = createSimCompxMouse({ link: 'dongle', typeByte: 5 })
    const driver = await sim.openDriver()
    expect(await driver.music.readDongleBar()).toEqual({
      mode: 1,
      color: { r: 0, g: 0, b: 255 },
      speed: 5,
      brightness: 9,
      time: 0,
    })
    await driver.music.setDongleBar(BAR)
    expect(sentPayloads(sim, 0x18)).toEqual(['03 01 02 03 04 06 07 00 00 00'])
    expect(sim.firmware.dongleBar).toEqual([3, 1, 2, 3, 4, 6, 7])
    expect(await driver.music.readDongleBar()).toEqual(BAR)
    await driver.disconnect()

    const wired = createSimCompxMouse()
    const d2 = await wired.openDriver()
    await expect(d2.music.setDongleBar(BAR)).rejects.toThrow('0x18')
    expect(await d2.music.readDongleBar()).toBeUndefined()
    await d2.disconnect()
  })

  it('writes the light bar as one fixed-colour block, toggling 0xA7 only when the bar was off', async () => {
    const sim = createSimCompxMouse() // model default: light off
    const driver = await sim.openDriver()
    expect((await driver.lighting.get()).on).toBe(false)
    const writesBefore = sim.firmware.flashWrites
    await driver.music.setLightColor({ r: 10, g: 200, b: 30 }, 12)
    expect(driver.music.flashWrites).toBe(2)
    expect(sim.firmware.flashWrites).toBe(writesBefore + 2)
    expect(sim.firmware.flash[Addr.LightState]).toBe(1)
    const block = sim.firmware.flash.subarray(Addr.Light, Addr.Light + 7)
    expect(hex(block.subarray(0, 6))).toBe('03 0a c8 1e 07 09') // mode 3, colour, speed kept (7), brightness clamped to 9
    expect(sumsTo55(block)).toBe(true)
    expect(await driver.lighting.get()).toMatchObject({
      on: true,
      mode: 3,
      color: { r: 10, g: 200, b: 30 },
      speed: 7,
      brightness: 9,
    })

    await driver.music.setLightColor({ r: 0, g: 0, b: 255 }, -3)
    expect(driver.music.flashWrites).toBe(3)
    expect(sim.firmware.flashWrites).toBe(writesBefore + 3)
    expect(hex(sim.firmware.flash.subarray(Addr.Light, Addr.Light + 6))).toBe('03 00 00 ff 07 00')
    await driver.disconnect()
  })

  it('snapshot/restore puts the light block and receiver bar back and leaves amplitude mode with 0xB7', async () => {
    const sim = createSimCompxMouse({ link: 'dongle', typeByte: 5, supportsMusicAmplitude: true })
    const driver = await sim.openDriver()
    await driver.lighting.set({ mode: 2, color: { r: 200, g: 100, b: 50 }, speed: 3, brightness: 6 })
    const original = await driver.lighting.get()
    expect(original.on).toBe(true)
    const originalBlock = hex(sim.firmware.flash.subarray(Addr.Light, Addr.Light + 7))
    const originalBar = [...sim.firmware.dongleBar]

    await driver.music.snapshot()
    await driver.music.snapshot() // held snapshots are kept
    await driver.music.startAmplitude(PARAMS)
    await driver.music.sendAmplitudes([15, 15])
    await driver.music.setDongleBar(BAR)
    await driver.music.setLightColor({ r: 0, g: 255, b: 0 }, 9)
    expect(sim.firmware.dongleBar).toEqual([3, 1, 2, 3, 4, 6, 7])
    expect(hex(sim.firmware.flash.subarray(Addr.Light, Addr.Light + 7))).not.toBe(originalBlock)

    const before = sim.firmware.log.length
    await driver.music.restore()
    const restoreLog = sim.firmware.log.slice(before)
    expect(restoreLog[0]).toBe('b7')
    expect(restoreLog.indexOf('18')).toBeGreaterThan(0)
    expect(restoreLog.indexOf('07')).toBeGreaterThan(restoreLog.indexOf('18'))
    expect(sim.firmware.customLightState).toEqual([0, 0])
    expect(sim.firmware.dongleBar).toEqual(originalBar)
    expect(hex(sim.firmware.flash.subarray(Addr.Light, Addr.Light + 7))).toBe(originalBlock)
    expect(await driver.lighting.get()).toEqual(original)

    // Idempotent: a second restore sends nothing.
    await driver.music.restore()
    expect(sim.firmware.log.length).toBe(before + restoreLog.length)
    await driver.disconnect()
  })

  it('restore turns the bar back off when it was off, and re-applies the block after amplitude mode even if unchanged', async () => {
    const sim = createSimCompxMouse({ supportsMusicAmplitude: true }) // wired, light off
    const driver = await sim.openDriver()
    const original = await driver.lighting.get()
    expect(original.on).toBe(false)
    const originalBlock = hex(sim.firmware.flash.subarray(Addr.Light, Addr.Light + 7))

    await driver.music.snapshot()
    await driver.music.setLightColor({ r: 255, g: 255, b: 255 }, 9)
    expect((await driver.lighting.get()).on).toBe(true)
    await driver.music.restore()
    expect(hex(sim.firmware.flash.subarray(Addr.Light, Addr.Light + 7))).toBe(originalBlock)
    expect(await driver.lighting.get()).toEqual(original)

    // Nothing changed since this snapshot: restore writes nothing.
    await driver.music.snapshot()
    const writes = sim.firmware.flashWrites
    await driver.music.restore()
    expect(sim.firmware.flashWrites).toBe(writes)

    // Amplitude mode alone (flash untouched) still re-applies the block, then turns the bar off again.
    await driver.music.snapshot()
    await driver.music.startAmplitude(PARAMS)
    const before = sim.firmware.log.length
    await driver.music.restore()
    expect(sim.firmware.log.slice(before)[0]).toBe('b7')
    expect(sim.firmware.log.slice(before).filter((c) => c === '07').length).toBeGreaterThan(0)
    expect(sim.firmware.flashWrites).toBeGreaterThan(writes)
    expect(await driver.lighting.get()).toEqual(original)
    await driver.disconnect()
  })

  it('restore keeps what it could not put back and retries it on the next call', async () => {
    const sim = createSimCompxMouse()
    const transport = await WebHidTransport.open(sim.device, 8)
    const driver = new CompxMouseDriver(new CompxLink(transport, { timeoutMs: 5, attempts: 1 }), 'wired')
    await driver.connect()
    const originalBlock = hex(sim.firmware.flash.subarray(Addr.Light, Addr.Light + 7))
    await driver.music.snapshot()
    await driver.music.setLightColor({ r: 1, g: 2, b: 3 }, 5)

    const respond = sim.device.respond
    sim.device.respond = () => [] // mouse asleep
    await expect(driver.music.restore()).rejects.toThrow('timed out')
    sim.device.respond = respond
    await driver.music.restore()
    expect(hex(sim.firmware.flash.subarray(Addr.Light, Addr.Light + 7))).toBe(originalBlock)
    expect((await driver.lighting.get()).on).toBe(false)
    await driver.disconnect()
  })
})
