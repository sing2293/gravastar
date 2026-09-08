import { afterEach, describe, expect, it } from 'vitest'
import { musicEngine } from '@/audio/musicSync'
import { KeyboardSink } from '@/audio/sinks/keyboardSink'
import { MouseSink } from '@/audio/sinks/mouseSink'
import { useDevices } from './devices'

const store = () => useDevices.getState()

describe('device store ↔ music engine', () => {
  afterEach(async () => {
    for (const id of [...store().order]) await store().forget(id)
    await musicEngine.stop()
  })

  it('registers one sink per connected device and drops it on disconnect / forget', async () => {
    const kb = await store().addSimulated('keyboard')
    const mouse = await store().addSimulated('mouse', 'dongle')
    expect(musicEngine.getSink(kb)).toBeInstanceOf(KeyboardSink)
    expect(musicEngine.getSink(mouse)).toBeInstanceOf(MouseSink)
    expect(musicEngine.getStatus().sinks.map((s) => [s.id, s.kind, s.enabled])).toEqual([
      [kb, 'keyboard', true],
      [mouse, 'mouse', true],
    ])
    // The keyboard sink carries the layout the driver reported.
    expect((musicEngine.getSink(kb) as KeyboardSink).layout.keys.length).toBeGreaterThan(80)

    await store().disconnect(kb)
    expect(musicEngine.getSink(kb)).toBeUndefined()
    expect(store().devices[kb]?.state).toBe('authorized')
    expect(musicEngine.getSink(mouse)).toBeInstanceOf(MouseSink)

    await store().forget(mouse)
    expect(musicEngine.getStatus().sinks).toEqual([])
    expect(store().devices[mouse]).toBeUndefined()
  })

  it('never double-registers a device', async () => {
    const id = await store().addSimulated('keyboard')
    const first = musicEngine.getSink(id)
    expect(await store().addSimulated('keyboard')).toBe(id)
    expect(musicEngine.getSink(id)).toBe(first)
    expect(musicEngine.getStatus().sinks).toHaveLength(1)
  })

  it('restores the keyboard lighting before the transport closes when a session is running', async () => {
    const id = await store().addSimulated('keyboard')
    const sink = musicEngine.getSink(id) as KeyboardSink
    let released = 0
    const original = sink.release.bind(sink)
    sink.release = async () => {
      released++
      await original()
    }
    // A scripted source and a no-op scheduler so the engine "runs" without Web Audio or animation frames.
    const engine = musicEngine as unknown as { hooks: { openSource?: unknown; schedule?: unknown; cancel?: unknown } }
    engine.hooks.openSource = async () => ({
      source: {
        frame: (time: number) => ({ time, level: 0, bands: new Float32Array(24), bass: 0, mid: 0, treble: 0, beat: false, beatStrength: 0 }),
        close: async () => undefined,
      },
      stop: () => undefined,
    })
    engine.hooks.schedule = () => 0
    engine.hooks.cancel = () => undefined
    try {
      await musicEngine.start('system')
      expect(sink.status().active).toBe(true)
      await store().disconnect(id)
      expect(released).toBeGreaterThanOrEqual(1)
      expect(musicEngine.getSink(id)).toBeUndefined()
    } finally {
      await musicEngine.stop()
      delete engine.hooks.openSource
      delete engine.hooks.schedule
      delete engine.hooks.cancel
    }
  })
})
