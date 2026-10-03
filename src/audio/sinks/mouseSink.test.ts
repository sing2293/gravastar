import { describe, expect, it } from 'vitest'
import type { RGB } from '@/model/device'
import type {
  DongleBar,
  MouseDriver,
  MouseLightEffect,
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
  pulseBrightness,
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
  readonly effects: MouseLightEffect[] = []
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
  async enterLightSession(): Promise<void> {
    this.calls.push('enterLightSession')
  }
  setLightOn(): Promise<void> {
    this.calls.push('setLightOn')
    return this.write()
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
  setLightEffect(effect: MouseLightEffect): Promise<void> {
    this.calls.push('setLightEffect')
    this.effects.push(effect)
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
    beatSensitivity: 1,
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

  it('falls back to the mouse pulse, then the receiver bar, then to none', async () => {
    // A mouse with its own light pulses; the bar is driven alongside it, not instead of it.
    const both = new MouseSink('m', 'Mouse', driverWith(new StubMusic({ dongleBar: true, flashLight: true })))
    await both.prepare()
    expect(both.status().mode).toBe('pulse (firmware breathing)')

    const pulse = new MouseSink('m', 'Mouse', driverWith(new StubMusic({ flashLight: true })))
    await pulse.prepare()
    expect(pulse.status().mode).toBe('pulse (firmware breathing)')

    const barOnly = new MouseSink('m', 'Mouse', driverWith(new StubMusic({ dongleBar: true })))
    await barOnly.prepare()
    expect(barOnly.status().mode).toBe('receiver bar')

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
    expect(wantAmplitude.status().mode).toBe('pulse (firmware breathing)')
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
    expect(strategyOrder(all)).toEqual(['amplitude', 'pulse', 'dongle', 'gentle'])
    expect(strategyOrder(all, 'gentle')).toEqual(['gentle', 'amplitude', 'pulse', 'dongle'])
    expect(strategyOrder(all, 'strobe')).toEqual(['strobe', 'amplitude', 'pulse', 'dongle', 'gentle']) // never automatic
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
    expect(fallback.status().mode).toBe('pulse (firmware breathing)') // the bar is still driven alongside it
    fallback.push(frame(0))
    await flush()
    expect(music.bars[1]).toMatchObject({ mode: 3, speed: 3, time: 1 })

    // The bar is read whenever it will be driven — including alongside a body-light strategy.
    const gentle = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'gentle' })
    await gentle.prepare()
    expect(music.reads).toBe(3)
  })
})

describe('MouseSink pulse mode (firmware breathing)', () => {
  const beat = { beat: true, beatStrength: 0.8 }

  it('writes the breathing block only when the look actually changes', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'pulse', pulseMinIntervalMs: 100 })
    await sink.prepare()
    // Same accent and loudness frame after frame: the firmware keeps breathing, the host stays quiet. The only
    // rewrites are the one that starts it and the one that applies the speed once the tempo is known.
    await sweep(sink, 0, 2000, 50, beat)
    expect(music.effects.length).toBeLessThanOrEqual(2) // 41 frames pushed
    expect(music.effects[0]).toMatchObject({ mode: 2, color: ACCENT, brightness: 6 })
    expect(sink.status()).toMatchObject({ mode: 'pulse (firmware breathing)' })
    expect(sink.status().memoryWrites).toBe(music.effects.length)

    // A different colour is worth a write; a barely different one is not.
    const before = music.effects.length
    sink.push(frame(3000, beat, { accent: { r: 0, g: 0, b: 255 } }))
    await flush()
    expect(music.effects).toHaveLength(before + 1)
    sink.push(frame(4000, beat, { accent: { r: 0, g: 10, b: 245 } }))
    await flush()
    expect(music.effects).toHaveLength(before + 1)
  })

  it('derives the firmware speed from the detected tempo', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'pulse', pulseMinIntervalMs: 0 })
    await sink.prepare()
    expect(sink.tempoEstimate.bpm).toBeUndefined()
    // 120 BPM: a beat every 500 ms.
    for (let t = 0; t <= 4000; t += 500) {
      sink.push(frame(t, beat))
      await flush()
    }
    expect(sink.tempoEstimate.bpm).toBe(120)
    const last = music.effects[music.effects.length - 1]!
    expect(last.speed).toBe(7) // 120 BPM → mid of the 0..9 range
    expect(last.mode).toBe(2)

    const fast = new MouseSink('m', 'Mouse', driverWith(new StubMusic({ flashLight: true })), {
      prefer: 'pulse',
      pulseMinIntervalMs: 0,
      pulseSpeedOffset: 2,
    })
    await fast.prepare()
    for (let t = 0; t <= 4000; t += 500) {
      fast.push(frame(t, beat))
      await flush()
    }
    expect(fast.tempoEstimate.bpm).toBe(120)
    expect((fast as unknown as { lastEffect: { speed: number } }).lastEffect.speed).toBe(9) // offset applied
  })

  it('does not spend a write on every loudness wobble', async () => {
    expect([0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => pulseBrightness(v))).toEqual([3, 3, 6, 6, 9, 9])
    expect(pulseBrightness(0.3, 6)).toBe(6) // inside the dead band: stays where it is
    expect(pulseBrightness(0.2, 6)).toBe(3) // below it: falls back
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'pulse', pulseMinIntervalMs: 0 })
    await sink.prepare()
    // One steady colour, loudness breathing around the middle of the range: the firmware keeps the movement.
    for (let t = 0; t < 30_000; t += 20) {
      sink.push(frame(t, {}, { intensity: 0.45 + 0.1 * Math.sin(t / 300) }))
      await Promise.resolve()
    }
    await flush()
    expect(sink.status().memoryWrites).toBeLessThanOrEqual(2)
  })

  it('keeps writes far below a host-driven animation over a three-minute track', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'pulse' })
    await sink.prepare()
    // 60 fps of audio for 180 s, colour drifting slowly through the spectrum as a preset would move it.
    for (let t = 0; t < 180_000; t += 16) {
      const hue = (t / 180_000) * 255
      sink.push(frame(t, t % 500 < 16 ? beat : {}, { accent: { r: Math.round(hue), g: 255 - Math.round(hue), b: 90 } }))
      await Promise.resolve()
    }
    await flush()
    expect(sink.status().memoryWrites).toBeLessThan(60) // ≈ one write every 3 s
    expect(sink.status().memoryWrites).toBeGreaterThan(2)
  })
})

describe('MouseSink strobe mode', () => {
  it('blinks once per beat: lit on the onset, dark again after strobeOnMs', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'strobe', strobeFps: 50, strobeOnMs: 90 })
    await sink.prepare()
    expect(music.calls).toContain('enterLightSession') // the light must not blank itself while the mouse moves

    // Quiet frames before any beat write nothing at all.
    await sweep(sink, 0, 200, 20, { beat: false })
    expect(music.effects).toHaveLength(0)

    sink.push(frame(300, { beat: true, beatStrength: 1 }, { intensity: 0 }))
    await flush()
    expect(music.effects[0]).toEqual({ mode: 3, color: ACCENT, speed: 0, brightness: 9 })

    // Still lit inside the flash window, dark once it has passed — and then nothing until the next beat.
    sink.push(frame(350, {}, { intensity: 0 }))
    await flush()
    expect(music.effects).toHaveLength(1)
    sink.push(frame(420, {}, { intensity: 0 }))
    await flush()
    expect(music.effects[1]).toMatchObject({ mode: 3, brightness: 0 })
    await sweep(sink, 460, 900, 20)
    expect(music.effects).toHaveLength(2)

    sink.push(frame(1000, { beat: true, beatStrength: 1 }))
    await flush()
    expect(music.effects).toHaveLength(3)
    expect(music.effects[2]!.brightness).toBe(9)
    expect(sink.status()).toMatchObject({ mode: 'strobe (beat writes)', memoryWrites: 3 })
  })

  it('ignores a weak onset and reports the measured write round-trip', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'strobe', strobeBeatThreshold: 0.5 })
    await sink.prepare()
    sink.push(frame(0, { beat: true, beatStrength: 0.2 }))
    await flush()
    expect(music.effects).toHaveLength(0)
    sink.push(frame(500, { beat: true, beatStrength: 0.9 }))
    await flush()
    expect(music.effects).toHaveLength(1)
    expect(sink.writeLatencyMs).toBeGreaterThanOrEqual(0)
  })

  it('flashTest blinks without any audio so the path can be checked on its own', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music))
    const result = await sink.flashTest({ r: 255, g: 0, b: 0 }, 3, 1, 1)
    expect(result.writes).toBe(6) // three blinks: lit + dark
    expect(music.effects.map((e) => e.brightness)).toEqual([9, 0, 9, 0, 9, 0])
    expect(music.calls.slice(0, 3)).toEqual(['probe', 'snapshot', 'enterLightSession'])
    await sink.release()
    expect(music.calls).toContain('restore') // the test owns the snapshot, so it is put back
  })

  it('is never chosen automatically, and only stops when a write budget is set', async () => {
    expect(strategyOrder({ amplitudeStream: false, dongleBar: false, flashLight: true })).toEqual(['pulse', 'gentle'])
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'strobe', strobeFps: 100, writeBudget: 5 })
    await sink.prepare()
    for (let t = 0; t <= 2000; t += 50) {
      sink.push(frame(t, { beat: t % 400 === 0, beatStrength: 1 }))
      await flush()
    }
    expect(music.effects).toHaveLength(5)
    expect(sink.status()).toMatchObject({ memoryWrites: 5, note: BUDGET_NOTE })
  })
})

describe('MouseSink reaction source', () => {
  const band = (bass: number, mid: number, treble: number) => ({ bass, mid, treble, beat: false, beatStrength: 0 })

  it('flashes on a treble onset while ignoring the bass line, and the other way round', async () => {
    const treble = new StubMusic({ flashLight: true })
    const trebleSink = new MouseSink('m', 'Mouse', driverWith(treble), { prefer: 'strobe', reactTo: 'treble' })
    await trebleSink.prepare()
    const bass = new StubMusic({ flashLight: true })
    const bassSink = new MouseSink('m', 'Mouse', driverWith(bass), { prefer: 'strobe', reactTo: 'bass' })
    await bassSink.prepare()

    // A steady bass line with hi-hats on top: only the treble moves.
    for (let i = 0; i < 80; i++) {
      const f = frame(i * 25, band(0.6, 0.2, i % 8 === 0 ? 0.8 : 0.05))
      trebleSink.push(f)
      bassSink.push(f)
      await flush()
    }
    const lit = (m: StubMusic) => m.effects.filter((e) => e.brightness === 9).length
    expect(lit(treble)).toBeGreaterThanOrEqual(5)
    expect(lit(bass)).toBe(0) // the bass never attacks, so nothing fires

    // Now a kick pattern with steady highs: the roles swap.
    const kick = new StubMusic({ flashLight: true })
    const kickSink = new MouseSink('m', 'Mouse', driverWith(kick), { prefer: 'strobe', reactTo: 'bass' })
    await kickSink.prepare()
    for (let i = 0; i < 80; i++) {
      kickSink.push(frame(i * 25, band(i % 8 === 0 ? 0.9 : 0.1, 0.2, 0.5)))
      await flush()
    }
    expect(kick.effects.filter((e) => e.brightness === 9).length).toBeGreaterThanOrEqual(5)
  })

  it('switching bands starts detection over instead of going dead', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'strobe', reactTo: 'bass' })
    await sink.prepare()
    // Loud bass hits teach the bass detector a high peak…
    for (let i = 0; i < 60; i++) {
      sink.push(frame(i * 25, band(i % 8 === 0 ? 1 : 0.1, 0.1, 0.05)))
      await flush()
    }
    const bassFlashes = music.effects.filter((e) => e.brightness === 9).length
    expect(bassFlashes).toBeGreaterThan(2)

    // …switching to the much quieter treble must not inherit that peak, or nothing would fire for seconds.
    sink.options = { ...sink.options, reactTo: 'treble' }
    const before = music.effects.length
    for (let i = 60; i < 120; i++) {
      sink.push(frame(i * 25, band(0.1, 0.1, i % 8 === 0 ? 0.08 : 0.01)))
      await flush()
    }
    expect(music.effects.filter((e) => e.brightness === 9).length).toBeGreaterThan(bassFlashes)
    expect(music.effects.length).toBeGreaterThan(before)
  })

  it('a band also drives the pulse brightness', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), {
      prefer: 'pulse',
      reactTo: 'bass',
      pulseMinIntervalMs: 0,
    })
    await sink.prepare()
    // Loud bass, silent elsewhere: brightness follows the bass even though `intensity` stays low.
    for (let i = 0; i < 40; i++) {
      sink.push(frame(i * 25, band(0.9, 0, 0), { intensity: 0.05 }))
      await flush()
    }
    expect(music.effects[music.effects.length - 1]!.brightness).toBe(9)
  })

  it('writes on every beat when no budget is set', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'strobe' })
    await sink.prepare()
    expect(sink.options.writeBudget).toBe(Number.POSITIVE_INFINITY)
    // 150 beats at 200 BPM, faster than strobeFps would allow: every one still gets its flash.
    for (let i = 0; i < 150; i++) {
      sink.push(frame(i * 300, { beat: true, beatStrength: 1 }))
      await flush()
      sink.push(frame(i * 300 + 150)) // the dark frame between beats
      await flush()
    }
    expect(music.effects.filter((e) => e.brightness === 9).length).toBe(150)
    expect(sink.status().note).toBeUndefined() // never paused
  })
})

describe('MouseSink when the mouse cannot keep up', () => {
  it('backs off on write timeouts instead of hammering, and recovers', async () => {
    class SlowMouse extends StubMusic {
      timeout = false
      setLightEffect(effect: MouseLightEffect): Promise<void> {
        this.calls.push('setLightEffect')
        this.effects.push(effect)
        return this.timeout ? Promise.reject(new Error('mouse command 0x7 timed out after 200ms')) : Promise.resolve()
      }
    }
    const music = new SlowMouse({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'strobe', strobeFps: 20 })
    await sink.prepare()
    music.timeout = true
    // A beat every 200 ms with quiet frames between, so each blink is a lit write and a dark one.
    for (let i = 0; i < 80; i++) {
      sink.push(frame(i * 50, { beat: i % 4 === 0, beatStrength: 1 }))
      await flush()
    }
    const during = music.effects.length
    expect(during).toBeLessThan(20) // not one write per beat while the device is failing
    expect(sink.status().note).toMatch(/not keeping up/)
    expect(sink.status().error).toBeUndefined() // a timeout is a pacing signal, not a session-breaking error
    expect(sink.status().active).toBe(true)

    // Once it answers again the sink keeps going rather than staying throttled forever.
    music.timeout = false
    for (let i = 80; i < 400; i++) {
      sink.push(frame(i * 50, { beat: i % 4 === 0, beatStrength: 1 }))
      await flush()
    }
    expect(music.effects.length).toBeGreaterThan(during + 5)
  })
})

describe('MouseSink keeping the light awake', () => {
  it('re-asserts the light periodically so the firmware idle timer cannot kill the session', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'pulse', keepAwakeMs: 1000 })
    await sink.prepare()
    await sweep(sink, 0, 900, 100)
    expect(music.calls.filter((c) => c === 'setLightOn')).toHaveLength(0) // not in the first interval
    await sweep(sink, 1000, 4000, 100)
    const wakes = music.calls.filter((c) => c === 'setLightOn').length
    expect(wakes).toBeGreaterThanOrEqual(2)
    expect(wakes).toBeLessThanOrEqual(4)
  })

  it('does not wake anything in receiver-bar mode or when disabled', async () => {
    const bar = new StubMusic({ dongleBar: true })
    const barSink = new MouseSink('m', 'Mouse', driverWith(bar), { prefer: 'dongle', keepAwakeMs: 500 })
    await barSink.prepare()
    await sweep(barSink, 0, 3000, 100)
    expect(bar.calls).not.toContain('setLightOn')

    const off = new StubMusic({ flashLight: true })
    const offSink = new MouseSink('m', 'Mouse', driverWith(off), { prefer: 'pulse', keepAwakeMs: 0 })
    await offSink.prepare()
    await sweep(offSink, 0, 3000, 100)
    expect(off.calls).not.toContain('setLightOn')
  })
})

describe('MouseSink receiver bar alongside the mouse light', () => {
  it('drives the bar and the body light together without spending the memory budget', async () => {
    const music = new StubMusic({ dongleBar: true, flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { dongleFps: 10, pulseMinIntervalMs: 100 })
    await sink.prepare()
    expect(sink.status().mode).toBe('pulse (firmware breathing)')
    await sweep(sink, 0, 1000, 50, { beat: true, beatStrength: 0.8 })
    expect(music.bars.length).toBeGreaterThan(5) // the bar keeps moving every frame budget allows
    expect(music.effects.length).toBeLessThanOrEqual(2) // …while the mouse block is barely written
    expect(sink.status().memoryWrites).toBe(music.effects.length)
  })

  it('a receiver that stops answering does not take the body light down', async () => {
    const music = new StubMusic({ dongleBar: true, flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { dongleFps: 100, pulseMinIntervalMs: 0 })
    await sink.prepare()
    music.rejectWrites = true
    sink.push(frame(0, { beat: true, beatStrength: 1 }))
    await flush()
    music.rejectWrites = false
    sink.push(frame(500, { beat: true, beatStrength: 1 }, { accent: { r: 0, g: 0, b: 255 } }))
    await flush()
    const barsAfter = music.bars.length
    sink.push(frame(1000, { beat: true, beatStrength: 1 }, { accent: { r: 255, g: 255, b: 0 } }))
    await flush()
    expect(music.bars).toHaveLength(barsAfter) // bar disabled after its failure
    expect(music.effects.length).toBeGreaterThan(1) // body light still being written
    expect(sink.status().active).toBe(true)
  })
})

describe('MouseSink gentle mode', () => {
  it('writes the light bar only on strong beats', async () => {
    const music = new StubMusic({ flashLight: true })
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'gentle', gentleBeatThreshold: 0.45 })
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
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'gentle', gentleMinIntervalMs: 1500 })
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
    const sink = new MouseSink('m', 'Mouse', driverWith(music), { prefer: 'gentle', writeBudget: 3, gentleMinIntervalMs: 1000 })
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
    const sink = new MouseSink('m', 'Mercury', driver, { maxFps: 100, dongleFps: 100, gentleMinIntervalMs: 0, pulseMinIntervalMs: 0 })
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
