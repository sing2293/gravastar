import { describe, expect, it } from 'vitest'
import type { DeviceKind } from '@/model/device'
import { MusicSyncEngine, type FrameSource } from './musicSync'
import type { AudioFrame, LightingSink, MusicFrame, SinkStatus } from './types'

class FakeSink implements LightingSink {
  prepares = 0
  releases = 0
  failPrepare = false
  readonly frames: MusicFrame[] = []

  constructor(
    readonly id: string,
    readonly label: string,
    readonly kind: DeviceKind = 'keyboard',
  ) {}
  async prepare(): Promise<void> {
    this.prepares++
    if (this.failPrepare) throw new Error('boom')
  }
  push(frame: MusicFrame): void {
    this.frames.push(frame)
  }
  async release(): Promise<void> {
    this.releases++
  }
  status(): Omit<SinkStatus, 'enabled'> {
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      active: this.prepares > this.releases,
      fps: 0,
      writes: this.frames.length,
    }
  }
}

function audioFrame(time: number): AudioFrame {
  return {
    time,
    level: 0.5,
    bands: new Float32Array(24).fill(0.5),
    bass: 0.5,
    mid: 0.5,
    treble: 0.5,
    beat: true,
    beatStrength: 0.5,
  }
}

interface Opened {
  kind: string
  closed: number
  stopped: number
  ended?: () => void
}

/** Engine with a scripted source and manual scheduling; nothing here touches Web Audio or timers. */
function harness(startAt = 1000) {
  let now = startAt
  const scheduled: (() => void)[] = []
  const cancelled: number[] = []
  const opened: Opened[] = []
  const engine = new MusicSyncEngine(
    { preset: 'pulse', color: { r: 255, g: 0, b: 0 } },
    {
      openSource: async (kind) => {
        const rec: Opened = { kind, closed: 0, stopped: 0 }
        opened.push(rec)
        const source: FrameSource = {
          frame: (t) => audioFrame(t),
          close: async () => {
            rec.closed++
          },
        }
        return { source, stop: () => rec.stopped++, onEnded: (cb) => (rec.ended = cb) }
      },
      schedule: (cb) => {
        scheduled.push(cb)
        return scheduled.length
      },
      cancel: (h) => cancelled.push(h),
      now: () => now,
    },
  )
  return { engine, scheduled, cancelled, opened, setNow: (t: number) => (now = t) }
}

/** `setEnabled` / `removeSink` fire prepare/release without awaiting them. */
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('MusicSyncEngine', () => {
  it('start prepares only enabled sinks and pushes the first frame from the tick', async () => {
    const { engine, opened, scheduled } = harness()
    const a = new FakeSink('a', 'A')
    const b = new FakeSink('b', 'B', 'mouse')
    engine.addSink(a)
    engine.addSink(b, false)
    expect(engine.getStatus().sinks.map((s) => [s.id, s.enabled])).toEqual([
      ['a', true],
      ['b', false],
    ])
    await engine.start('system')
    expect(opened).toHaveLength(1)
    expect(opened[0]!.kind).toBe('system')
    expect(a.prepares).toBe(1)
    expect(b.prepares).toBe(0)
    expect(engine.getStatus()).toMatchObject({ running: true, source: 'system', preset: 'pulse', error: undefined })
    expect(scheduled).toHaveLength(1) // tick armed the next frame
    expect(a.frames).toHaveLength(1)
    expect(b.frames).toHaveLength(0)
  })

  it('step pushes a MusicFrame with session time and preset accent to enabled sinks only', async () => {
    const { engine, setNow } = harness(1000)
    const a = new FakeSink('a', 'A')
    const b = new FakeSink('b', 'B')
    engine.addSink(a)
    engine.addSink(b, false)
    await engine.start('tab')
    setNow(1500)
    engine.step()
    expect(a.frames).toHaveLength(2)
    expect(b.frames).toHaveLength(0)
    const f = a.frames[1]!
    expect(f.audio.time).toBe(1500)
    expect(f.t).toBe(0.5)
    expect(f.preset).toBe('pulse')
    expect(f.color).toEqual({ r: 255, g: 0, b: 0 })
    expect(f.accent).toEqual({ r: 255, g: 0, b: 0 }) // pulse: accent is the user colour
    expect(f.intensity).toBeCloseTo(0.5 * 0.9 + 0.25)
    expect(f.sensitivity).toBe(1)
    expect(engine.lastFrame).toBe(f.audio)
    engine.step(1600)
    expect(a.frames[2]!.audio.time).toBe(1600)
  })

  it('setEnabled while running prepares or releases that sink', async () => {
    const { engine } = harness()
    const a = new FakeSink('a', 'A')
    const b = new FakeSink('b', 'B')
    engine.addSink(a)
    engine.addSink(b, false)
    await engine.start('system')
    engine.setEnabled('b', true)
    await settle()
    expect(b.prepares).toBe(1)
    engine.setEnabled('a', false)
    await settle()
    expect(a.releases).toBe(1)
    engine.setEnabled('a', false) // no change → no second release
    await settle()
    expect(a.releases).toBe(1)
    const before = a.frames.length
    engine.step(2000)
    expect(a.frames).toHaveLength(before)
    expect(b.frames).toHaveLength(1)
    expect(engine.getStatus().sinks.map((s) => [s.id, s.enabled, s.active])).toEqual([
      ['a', false, false],
      ['b', true, true],
    ])
  })

  it('setEnabled while stopped only flips the flag', async () => {
    const { engine } = harness()
    const a = new FakeSink('a', 'A')
    engine.addSink(a)
    engine.setEnabled('a', false)
    engine.setEnabled('a', true)
    await settle()
    expect(a.prepares).toBe(0)
    expect(a.releases).toBe(0)
  })

  it('removeSink releases a running sink and drops it from status', async () => {
    const { engine } = harness()
    const a = new FakeSink('a', 'A')
    const b = new FakeSink('b', 'B')
    engine.addSink(a)
    engine.addSink(b)
    await engine.start('system')
    engine.removeSink('a')
    await settle()
    expect(a.releases).toBe(1)
    expect(engine.getSink('a')).toBeUndefined()
    expect(engine.getStatus().sinks.map((s) => s.id)).toEqual(['b'])
    engine.step(2000)
    expect(a.frames).toHaveLength(1)
    expect(b.frames).toHaveLength(2)
    engine.removeSink('missing') // no-op
  })

  it('replacing a sink under the same id releases the old one while running', async () => {
    const { engine } = harness()
    const a1 = new FakeSink('a', 'A')
    engine.addSink(a1)
    await engine.start('system')
    const a2 = new FakeSink('a', 'A2')
    engine.addSink(a2)
    await settle()
    expect(a1.releases).toBe(1)
    expect(a2.prepares).toBe(1)
    expect(engine.getSink('a')).toBe(a2)
  })

  it('stop releases every sink, closes the source and clears frames', async () => {
    const { engine, opened, cancelled, scheduled } = harness()
    const a = new FakeSink('a', 'A')
    const b = new FakeSink('b', 'B')
    engine.addSink(a)
    engine.addSink(b, false)
    await engine.start('microphone')
    expect(engine.lastFrame).toBeDefined()
    await engine.stop()
    expect(a.releases).toBe(1)
    expect(b.releases).toBe(1)
    expect(opened[0]).toMatchObject({ closed: 1, stopped: 1 })
    expect(cancelled).toEqual([scheduled.length])
    expect(engine.lastFrame).toBeUndefined()
    expect(engine.getStatus()).toMatchObject({ running: false, source: undefined, fps: 0 })
    const frames = a.frames.length
    engine.step(5000) // no source → nothing happens
    expect(a.frames).toHaveLength(frames)
    await engine.stop() // idempotent: not running, so no second release
    expect(a.releases).toBe(1)
  })

  it('a sink whose prepare throws sets status.error but does not break the others', async () => {
    const { engine } = harness()
    const good = new FakeSink('good', 'Good')
    const bad = new FakeSink('bad', 'Bad')
    bad.failPrepare = true
    engine.addSink(bad)
    engine.addSink(good)
    await engine.start('system')
    expect(engine.getStatus().running).toBe(true)
    expect(engine.getStatus().error).toBe('Bad: boom')
    expect(good.prepares).toBe(1)
    expect(good.frames).toHaveLength(1)
    engine.step(2000)
    expect(good.frames).toHaveLength(2)
  })

  it('a sink whose push throws is reported without stopping the loop', async () => {
    const { engine } = harness()
    const good = new FakeSink('good', 'Good')
    const bad = new FakeSink('bad', 'Bad')
    bad.push = () => {
      throw new Error('push failed')
    }
    engine.addSink(bad)
    engine.addSink(good)
    await engine.start('system')
    expect(engine.getStatus().error).toBe('Bad: push failed')
    expect(good.frames).toHaveLength(1)
  })

  it('reports analysis fps and refreshed sink statuses once a second', async () => {
    const { engine, setNow } = harness(1000)
    const a = new FakeSink('a', 'A')
    engine.addSink(a)
    await engine.start('system')
    for (let t = 1100; t < 2000; t += 100) engine.step(t)
    expect(engine.getStatus().fps).toBe(0)
    setNow(2000)
    engine.step()
    expect(engine.getStatus().fps).toBe(11) // 11 frames over the first second (tick at 1000 + steps 1100…2000)
    expect(engine.getStatus().sinks[0]).toMatchObject({ id: 'a', writes: 11, active: true })
  })

  it('stops with a reason when the shared audio track ends and notifies listeners', async () => {
    const { engine, opened } = harness()
    const seen: boolean[] = []
    const off = engine.onStatus((s) => seen.push(s.running))
    await engine.start('tab')
    opened[0]!.ended?.()
    await settle()
    expect(engine.getStatus()).toMatchObject({ running: false, error: 'Audio sharing ended' })
    expect(seen[0]).toBe(false)
    expect(seen).toContain(true)
    off()
  })

  it('update switches presets and restarting replaces the source', async () => {
    const { engine, opened } = harness()
    engine.update({ preset: 'spectrum', sensitivity: 1.5 })
    expect(engine.getStatus().preset).toBe('spectrum')
    await engine.start('system')
    await engine.start('tab')
    expect(opened).toHaveLength(2)
    expect(opened[0]).toMatchObject({ closed: 1, stopped: 1 })
    expect(engine.getStatus().source).toBe('tab')
    const a = new FakeSink('a', 'A')
    engine.addSink(a)
    await settle()
    expect(a.prepares).toBe(1) // added while running → prepared immediately
    engine.step(1500)
    expect(a.frames[0]!.preset).toBe('spectrum')
    expect(a.frames[0]!.sensitivity).toBe(1.5)
  })
})
