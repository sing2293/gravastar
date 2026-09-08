import { describe, expect, it } from 'vitest'
import type { RGB } from '@/model/device'
import type {
  DongleBar,
  MouseDriver,
  MouseMusicCapabilities,
  MouseMusicService,
  MusicAmplitudeParams,
} from '@/model/mouse'
import { createSimCompxMouse } from '@/sim/compx/device'
import type { MusicFrame } from '../types'
import {
  BUDGET_NOTE,
  MouseSink,
  bandsToLevels,
  barColor,
  strategyOrder,
  type MouseMusicSnapshotReader,
} from './mouseSink'

/** Records every service call; `manual` holds writes open until `settle()` so the in-flight guard can be observed. */
class StubMusic implements MouseMusicService {
  caps: MouseMusicCapabilities
  manual = false
  rejectStart = false
  rejectWrites = false
  readonly calls: string[] = []
  readonly amplitudes: number[][] = []
  readonly bars: DongleBar[] = []
  readonly lights: { color: RGB; brightness: number }[] = []
  amplitudeParams: MusicAmplitudeParams | undefined
  private readonly pending: (() => void)[] = []

  constructor(caps: Partial<MouseMusicCapabilities> = {}) {
    this.caps = { amplitudeStream: false, dongleBar: false, flashLight: false, ...caps }
  }
  async probe(): Promise<MouseMusicCapabilities> {
    this.calls.push('probe')
    return this.caps
  }
  async snapshot(): Promise<void> {
    this.calls.push('snapshot')
  }
  async restore(): Promise<void> {
    this.calls.push('restore')
  }
  async startAmplitude(params: MusicAmplitudeParams): Promise<void> {
    this.calls.push('startAmplitude')
    if (this.rejectStart) throw new Error('mouse command 0xb2 rejected')
    this.amplitudeParams = params
  }
  sendAmplitudes(levels: ArrayLike<number>): Promise<void> {
    this.calls.push('sendAmplitudes')
    this.amplitudes.push(Array.from(levels))
    return this.write()
  }
  setDongleBar(bar: DongleBar): Promise<void> {
    this.calls.push('setDongleBar')
    this.bars.push(bar)
    return this.write()
  }
  setLightColor(color: RGB, brightness: number): Promise<void> {
    this.calls.push('setLightColor')
    this.lights.push({ color, brightness })
    return this.write()
  }
  /** Completes the oldest pending write. */
  settle(): void {
    this.pending.shift()?.()
  }
  private write(): Promise<void> {
    if (this.rejectWrites) return Promise.reject(new Error('device gone'))
    return this.manual ? new Promise((resolve) => this.pending.push(resolve)) : Promise.resolve()
  }
}

const driverWith = (music?: MouseMusicService): MouseDriver => ({ kind: 'mouse', music }) as unknown as MouseDriver

const ACCENT: RGB = { r: 200, g: 100, b: 0 }
const RAMP = Float32Array.from({ length: 24 }, (_, i) => i / 23)

function frame(
  time: number,
  audio: Partial<MusicFrame['audio']> = {},
  rest: Partial<Omit<MusicFrame, 'audio'>> = {},
): MusicFrame {
  return {
    audio: { time, level: 0.5, bands: RAMP, bass: 0.5, mid: 0.5, treble: 0.5, beat: false, beatStrength: 0, ...audio },
    t: time / 1000,
    preset: 'spectrum',
    color: { r: 255, g: 0, b: 0 },
    sensitivity: 1,
    accent: ACCENT,
    intensity: 0.5,
    ...rest,
  }
}

/** Lets a resolved write run its then/catch/finally chain — microtasks only, no timers. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

/** Pushes frames `stepMs` apart from `from` to `to` inclusive, letting each write settle in between. */
async function sweep(
  sink: MouseSink,
  from: number,
  to: number,
  stepMs: number,
  audio: Partial<MusicFrame['audio']> = {},
): Promise<void> {
  for (let t = from; t <= to; t += stepMs) {
    sink.push(frame(t, audio))
    await flush()
  }
}

describe('MouseSink strategy selection', () => {
  it('reports mode none when the driver has no music service and ignores pushes', async () => {
    const sink = new MouseSink('m', 'Mouse', driverWith(undefined))
    await sink.prepare()
    expect(sink.status()).toMatchObject({ mode: 'none', active: false, writes: 0 })
    expect(sink.status().note).toBeTruthy()
    sink.push(frame(0))
    await flush()
    expect(sink.status().writes).toBe(0)
    await sink.release()
  })

  it('picks amplitude first and sends the 0xB2 look only after the snapshot', async () => {
    const music = new StubMusic({ amplitudeStream: true, dongleBar: true, flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music))
    await sink.prepare()
    expect(sink.status()).toMatchObject({ mode: 'amplitude', active: true })
    expect(music.calls).toEqual(['probe', 'snapshot', 'startAmplitude'])
    expect(music.amplitudeParams).toEqual({
      mode: 1,
      speed: 5,
      brightness: 9,
      colorMode: 0,
      forward: { r: 155, g: 255, b: 49 },
      backward: { r: 0, g: 0, b: 0 },
    })
  })

  it('uses the accent option as the amplitude forward colour', async () => {
    const music = new StubMusic({ amplitudeStream: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { accent: { r: 1, g: 2, b: 3 } })
    await sink.prepare()
    expect(music.amplitudeParams?.forward).toEqual({ r: 1, g: 2, b: 3 })
  })

  it('falls back to the receiver bar, then to gentle mode, then to none', async () => {
    const bar = new MouseSink('m', 'Mouse', driverWith(new StubMusic({ dongleBar: true, flashLight: true })))
    await bar.prepare()
    expect(bar.status().mode).toBe('receiver bar')

    const gentle = new MouseSink('m', 'Mouse', driverWith(new StubMusic({ flashLight: true })))
    await gentle.prepare()
    expect(gentle.status().mode).toBe('gentle (memory-safe)')

    const none = new StubMusic()
    const nothing = new MouseSink('m', 'Mouse', driverWith(none))
    await nothing.prepare()
    expect(nothing.status()).toMatchObject({ mode: 'none', active: false })
    expect(nothing.status().note).toBeTruthy()
    expect(none.calls).toEqual(['probe']) // nothing to snapshot when nothing will be changed
    await nothing.release()
    expect(none.calls).toEqual(['probe']) // and nothing to restore
  })

  it('honours prefer when available and falls back with a note otherwise', async () => {
    const all = { amplitudeStream: true, dongleBar: true, flashLight: true }
    const gentle = new MouseSink('m', 'Mouse', driverWith(new StubMusic(all)), { prefer: 'gentle' })
    await gentle.prepare()
    expect(gentle.status()).toMatchObject({ mode: 'gentle (memory-safe)', note: undefined })

    const dongle = new MouseSink('m', 'Mouse', driverWith(new StubMusic(all)), { prefer: 'dongle' })
    await dongle.prepare()
    expect(dongle.status().mode).toBe('receiver bar')

    const wantAmplitude = new MouseSink(
      'm',
      'Mouse',
      driverWith(new StubMusic({ dongleBar: true, flashLight: true })),
      { prefer: 'amplitude' },
    )
    await wantAmplitude.prepare()
    expect(wantAmplitude.status().mode).toBe('receiver bar')
    expect(wantAmplitude.status().note).toMatch(/amplitude/)
  })

  it('drops to the next strategy when 0xB2 is NAKed after a positive probe', async () => {
    const music = new StubMusic({ amplitudeStream: true, dongleBar: true })
    music.rejectStart = true
    const sink = new MouseSink('m', 'Mouse', driverWith(music))
    await sink.prepare()
    expect(sink.status().mode).toBe('receiver bar')
    expect(sink.status().note).toMatch(/rejected/)
    expect(music.calls).toEqual(['probe', 'snapshot', 'startAmplitude'])
  })

  it('strategyOrder keeps only probed capabilities, preferred first', () => {
    const all = { amplitudeStream: true, dongleBar: true, flashLight: true }
    expect(strategyOrder(all)).toEqual(['amplitude', 'dongle', 'gentle'])
    expect(strategyOrder(all, 'gentle')).toEqual(['gentle', 'amplitude', 'dongle'])
    expect(strategyOrder({ amplitudeStream: false, dongleBar: true, flashLight: false }, 'amplitude')).toEqual([
      'dongle',
    ])
    expect(strategyOrder({ amplitudeStream: false, dongleBar: false, flashLight: false })).toEqual([])
  })
})

describe('MouseSink amplitude mode', () => {
  it('paces 0xB6 writes to maxFps and reports the achieved rate', async () => {
    const music = new StubMusic({ amplitudeStream: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { maxFps: 10 })
    await sink.prepare()
    await sweep(sink, 0, 2000, 5)
    expect(music.amplitudes).toHaveLength(21) // t = 0, 100, …, 2000
    expect(sink.status()).toMatchObject({ writes: 21, fps: 10, error: undefined })
  })

  it('maps 24 bands onto 20 four-bit levels with sensitivity and clamping', async () => {
    const music = new StubMusic({ amplitudeStream: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music))
    await sink.prepare()
    sink.push(frame(0))
    await flush()
    const levels = music.amplitudes[0]!
    expect(levels).toHaveLength(20)
    expect(levels[0]).toBe(0)
    expect(levels[19]).toBe(15)
    for (let i = 1; i < 20; i++) expect(levels[i]!).toBeGreaterThanOrEqual(levels[i - 1]!)
    for (const v of levels) expect(Number.isInteger(v) && v >= 0 && v <= 15).toBe(true)

    sink.push(frame(1000, {}, { sensitivity: 2 }))
    await flush()
    expect(music.amplitudes[1]![10]).toBe(15) // 0.43 × 2 × 15 clamps at the nibble ceiling
    expect(music.amplitudes[1]![19]).toBe(15)
  })

  it('bandsToLevels interpolates and clamps', () => {
    expect(bandsToLevels([0, 1], 1)).toEqual(Array.from({ length: 20 }, (_, i) => Math.round((i * 15) / 19)))
    expect(bandsToLevels(new Array(24).fill(1), 0.5)).toEqual(new Array(20).fill(8))
    expect(bandsToLevels(new Array(24).fill(1), 3)).toEqual(new Array(20).fill(15))
    expect(bandsToLevels([], 1)).toEqual(new Array(20).fill(0))
    expect(bandsToLevels([0.5], 1)).toEqual(new Array(20).fill(8))
  })

  it('never queues a second write while one is in flight', async () => {
    const music = new StubMusic({ amplitudeStream: true })
    music.manual = true
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { maxFps: 10 })
    await sink.prepare()
    sink.push(frame(0))
    sink.push(frame(500))
    await flush()
    expect(music.amplitudes).toHaveLength(1)
    music.settle()
    await flush()
    sink.push(frame(600))
    await flush()
    expect(music.amplitudes).toHaveLength(2)
  })

  it('surfaces write failures in status.error and keeps going', async () => {
    const music = new StubMusic({ amplitudeStream: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music))
    await sink.prepare()
    music.rejectWrites = true
    sink.push(frame(0))
    await flush()
    expect(sink.status().error).toBe('device gone')
    music.rejectWrites = false
    sink.push(frame(500))
    await flush()
    expect(sink.status().error).toBeUndefined()
    expect(sink.status().writes).toBe(2)
  })
})

describe('MouseSink receiver-bar mode', () => {
  it('paces 0x18 to dongleFps', async () => {
    const music = new StubMusic({ dongleBar: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { dongleFps: 4 })
    await sink.prepare()
    await sweep(sink, 0, 1000, 5)
    expect(music.bars).toHaveLength(5) // t = 0, 250, 500, 750, 1000
    expect(sink.status().fps).toBe(4)
  })

  it('scales the accent by intensity with a floor and uses vendor defaults for mode/speed/time', async () => {
    const music = new StubMusic({ dongleBar: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { dongleFps: 100 })
    await sink.prepare()
    sink.push(frame(0, {}, { intensity: 0 }))
    await flush()
    sink.push(frame(500, {}, { intensity: 1 }))
    await flush()
    sink.push(frame(1000, {}, { intensity: 0.5 }))
    await flush()
    expect(music.bars[0]).toEqual({ mode: 3, color: { r: 30, g: 15, b: 0 }, speed: 3, brightness: 1, time: 1 })
    expect(music.bars[1]).toEqual({ mode: 3, color: ACCENT, speed: 3, brightness: 9, time: 1 })
    expect(music.bars[2]).toMatchObject({ color: { r: 100, g: 50, b: 0 }, brightness: 5 })
    expect(barColor({ r: 100, g: 100, b: 100 }, 0)).toEqual({ r: 15, g: 15, b: 15 })
    expect(barColor({ r: 100, g: 100, b: 100 }, 2)).toEqual({ r: 100, g: 100, b: 100 })
  })

  it('keeps the snapshotted receiver mode/speed/time when the service exposes them', async () => {
    class Reader extends StubMusic implements MouseMusicSnapshotReader {
      bar: DongleBar | undefined
      dongleBarSnapshot() {
        return this.bar
      }
    }
    const music = new Reader({ dongleBar: true })
    music.bar = { mode: 2, color: { r: 255, g: 0, b: 0 }, speed: 7, brightness: 3, time: 4 }
    const sink = new MouseSink('m', 'Mouse', driverWith(music))
    await sink.prepare()
    sink.push(frame(0))
    await flush()
    expect(music.bars[0]).toMatchObject({ mode: 2, speed: 7, time: 4 })

    music.bar = { mode: 0, color: { r: 255, g: 0, b: 0 }, speed: 3, brightness: 3, time: 1 } // off → fixed colour
    const off = new MouseSink('m', 'Mouse', driverWith(music))
    await off.prepare()
    off.push(frame(0))
    await flush()
    expect(music.bars[1]!.mode).toBe(3)
  })

  it('falls back to an async 0x19 read (CompxMusic.readDongleBar) and to defaults when that fails', async () => {
    class AsyncReader extends StubMusic implements MouseMusicSnapshotReader {
      reads = 0
      fail = false
      async readDongleBar(): Promise<DongleBar | undefined> {
        this.reads++
        if (this.fail) throw new Error('receiver asleep')
        return { mode: 5, color: { r: 0, g: 0, b: 255 }, speed: 1, brightness: 2, time: 9 }
      }
    }
    const music = new AsyncReader({ dongleBar: true, flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music))
    await sink.prepare()
    sink.push(frame(0))
    await flush()
    expect(music.reads).toBe(1)
    expect(music.bars[0]).toMatchObject({ mode: 5, speed: 1, time: 9 })
    await sink.release()

    music.fail = true
    const fallback = new MouseSink('m', 'Mouse', driverWith(music))
    await fallback.prepare()
    expect(fallback.status().mode).toBe('receiver bar')
    fallback.push(frame(0))
    await flush()
    expect(music.bars[1]).toMatchObject({ mode: 3, speed: 3, time: 1 })

    // The bar is only read when the receiver strategy is the one in use.
    const gentle = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'gentle' })
    await gentle.prepare()
    expect(music.reads).toBe(2)
  })
})

describe('MouseSink gentle mode', () => {
  it('writes the light bar only on strong beats', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { gentleBeatThreshold: 0.45 })
    await sink.prepare()
    sink.push(frame(0, { beat: false, beatStrength: 0.9 }))
    await flush()
    sink.push(frame(2000, { beat: true, beatStrength: 0.3 }))
    await flush()
    expect(music.lights).toHaveLength(0)
    sink.push(frame(4000, { beat: true, beatStrength: 0.6 }))
    await flush()
    expect(music.lights).toEqual([{ color: ACCENT, brightness: 9 }])
  })

  it('respects the minimum interval between flash writes', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { gentleMinIntervalMs: 1500 })
    await sink.prepare()
    for (const t of [0, 500, 1000, 1499, 1500, 2000, 3000]) {
      sink.push(frame(t, { beat: true, beatStrength: 1 }))
      await flush()
    }
    expect(music.lights).toHaveLength(3) // t = 0, 1500, 3000
    expect(music.calls.filter((c) => c === 'setLightColor')).toHaveLength(3)
  })

  it('stops at the write budget and says so', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { writeBudget: 3, gentleMinIntervalMs: 1000 })
    await sink.prepare()
    expect(sink.status().note).toBeUndefined()
    for (const t of [0, 2000, 4000]) {
      sink.push(frame(t, { beat: true, beatStrength: 1 }))
      await flush()
    }
    expect(music.lights).toHaveLength(3)
    expect(sink.status()).toMatchObject({ writes: 3, note: BUDGET_NOTE, active: true })
    sink.push(frame(6000, { beat: true, beatStrength: 1 }))
    await flush()
    sink.push(frame(8000, { beat: true, beatStrength: 1 }))
    await flush()
    expect(music.lights).toHaveLength(3)
    expect(sink.status().writes).toBe(3)
    await sink.release()
    expect(music.calls.filter((c) => c === 'restore')).toHaveLength(1)
  })
})

describe('MouseSink over the simulated Compx mouse', () => {
  it('prepares through the real CompxMusic service and leaves the light block untouched after release', async () => {
    const sim = createSimCompxMouse({ link: 'dongle' })
    const driver = await sim.openDriver()
    const lightBlock = () => Array.from(sim.firmware.flash.subarray(0xa0, 0xa9))
    const before = lightBlock()
    const sink = new MouseSink('m', 'Mercury', driver, { maxFps: 100, dongleFps: 100, gentleMinIntervalMs: 0 })
    await sink.prepare()
    expect(sink.status().active).toBe(true)
    expect(sink.status().mode).not.toBe('none')
    for (let t = 0; t <= 200; t += 50) {
      sink.push(frame(t, { beat: true, beatStrength: 1 }))
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    expect(sink.status().writes).toBeGreaterThan(0)
    expect(sink.status().error).toBeUndefined()
    await sink.release()
    expect(sink.status().active).toBe(false)
    expect(lightBlock()).toEqual(before)
    await driver.disconnect()
  })
})

describe('MouseSink lifecycle', () => {
  it('restores exactly once even when released twice, and not at all before prepare', async () => {
    const music = new StubMusic({ amplitudeStream: true })
    const early = new MouseSink('m', 'Mouse', driverWith(music))
    await early.release()
    expect(music.calls).toEqual([])

    const sink = new MouseSink('m', 'Mouse', driverWith(music))
    await sink.prepare()
    await Promise.all([sink.release(), sink.release()])
    await sink.release()
    expect(music.calls.filter((c) => c === 'restore')).toHaveLength(1)
    expect(sink.status()).toMatchObject({ active: false, mode: 'none' })
    sink.push(frame(0))
    await flush()
    expect(music.amplitudes).toHaveLength(0)
  })

  it('push before prepare is a no-op', async () => {
    const music = new StubMusic({ amplitudeStream: true, dongleBar: true, flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music))
    sink.push(frame(0, { beat: true, beatStrength: 1 }))
    await flush()
    expect(music.calls).toEqual([])
    expect(sink.status()).toMatchObject({ active: false, mode: 'none', writes: 0, fps: 0 })
  })

  it('prepare is idempotent while active and re-probes after release', async () => {
    const music = new StubMusic({ amplitudeStream: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music))
    await sink.prepare()
    await sink.prepare()
    expect(music.calls.filter((c) => c === 'probe')).toHaveLength(1)
    await sink.release()
    await sink.prepare()
    expect(music.calls.filter((c) => c === 'probe')).toHaveLength(2)
    expect(music.calls.filter((c) => c === 'snapshot')).toHaveLength(2)
  })
})
