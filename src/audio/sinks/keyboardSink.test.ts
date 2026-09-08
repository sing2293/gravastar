import { describe, expect, it } from 'vitest'
import { Setting } from '@/drivers/k98pro/enums'
import { createSimK98Pro } from '@/sim/k98pro/device'
import type { MusicFrame } from '../types'
import { KeyboardSink } from './keyboardSink'

/** Lets the fire-and-forget stream (serial queue → fake HID device) settle before the next push. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function setup(maxFps = 30) {
  const sim = createSimK98Pro()
  const driver = await sim.openDriver()
  const caps = await driver.capabilities()
  const sink = new KeyboardSink('kb', 'K98 Pro', driver, caps.layout, { maxFps })
  return { sim, driver, sink }
}

function frame(time: number, preset = 'pulse'): MusicFrame {
  return {
    audio: {
      time,
      level: 0.6,
      bands: new Float32Array(24).fill(0.6),
      bass: 0.6,
      mid: 0.6,
      treble: 0.6,
      beat: false,
      beatStrength: 0,
    },
    t: time / 1000,
    preset,
    color: { r: 155, g: 255, b: 49 },
    sensitivity: 1,
    accent: { r: 155, g: 255, b: 49 },
    intensity: 0.6,
  }
}

describe('KeyboardSink over the simulated K98 Pro', () => {
  it('prepare switches the main zone to the custom effect and release restores the previous record', async () => {
    const { sim, sink } = await setup()
    const before = [...sim.lighting.zones.get(Setting.MainEffect)!]
    expect(before[0]).toBe(3) // Dream Rainbow by default
    expect(sink.status()).toMatchObject({ id: 'kb', kind: 'keyboard', active: false, writes: 0 })

    await sink.prepare()
    expect(sim.lighting.zones.get(Setting.MainEffect)![0]).toBe(19)
    // the simulated firmware exposes its LED-bead table, so the sink addresses LEDs (Space owns three)
    expect(sink.status()).toMatchObject({ active: true, mode: 'per-LED streaming', writes: 0, error: undefined })
    expect(sink.status().note).toMatch(/104 LEDs on 98 keys — .*Space ×3/)

    await sink.release()
    expect(sim.lighting.zones.get(Setting.MainEffect)).toEqual(before)
    expect(sink.status().active).toBe(false)
    expect(sink.lastLighting).toBeUndefined()
  })

  it('paces streamed frames at maxFps and counts writes', async () => {
    const { sim, sink } = await setup(30)
    await sink.prepare()
    for (let t = 1000; t <= 2000; t += 5) {
      sink.push(frame(t))
      await tick()
    }
    const streamed = sim.lighting.streamed
    expect(streamed.length).toBeGreaterThanOrEqual(25)
    expect(streamed.length).toBeLessThanOrEqual(31) // 30 Hz over one second, inclusive of the first frame
    expect(streamed.every((s) => s.sub === 2)).toBe(true) // pulse renders one colour → whole-board stream
    expect(sink.status().writes).toBe(streamed.length)
    expect(sink.lastLighting).toBeDefined()
    expect('all' in sink.lastLighting!).toBe(true)
    await sink.release()
  })

  it('streams per-key frames for per-key presets and drops pushes while not active', async () => {
    const { sim, sink } = await setup(30)
    sink.push(frame(1000, 'spectrum'))
    await tick()
    expect(sim.lighting.streamed).toHaveLength(0)
    expect(sink.status().writes).toBe(0)

    await sink.prepare()
    sink.push(frame(1000, 'spectrum'))
    await tick()
    expect(sim.lighting.streamed.length).toBeGreaterThan(0)
    expect(sim.lighting.streamed[0]!.sub).toBe(4) // grouped bead ids (0x08/0x04)
    const beadIds = sim.lighting.streamed.flatMap((s) => s.data)
    for (const b of sim.lighting.beads(70)) expect(beadIds).toContain((b.row & 7) | ((b.col & 31) << 3)) // every LED of Space
    expect(sink.status().writes).toBe(1)
    await sink.release()
  })

  it('falls back to per-key streaming when the firmware has no bead table', async () => {
    const { sim, sink } = await setup(30)
    sim.lighting.beadsSupported = false
    await sink.prepare()
    expect(sink.status().mode).toBe('per-key streaming')
    sink.push(frame(1000, 'spectrum'))
    await tick()
    expect(sim.lighting.streamed[0]!.sub).toBe(1)
    await sink.release()
  })
})
