import { describe, expect, it } from 'vitest'
import { hex } from '@/hid/core/bytes'
import { WebHidTransport } from '@/hid/core/transport'
import { FakeHidDevice } from '@/hid/core/testing/fakeHidDevice'
import { K98ProFirmware } from '@/sim/k98pro/firmware'
import { installDisplaySim } from '@/sim/k98pro/displaySim'
import { buildPackets } from './codec'
import { DynamicFormat, K98Display, encodeDynamicHeader, parseDynamicHeader, rewriteTransferPackets, transferControlByte } from './display'
import { K98Link } from './transport'

async function setup() {
  const fake = new FakeHidDevice('K98 Pro', 0x372e, 0x10e5, 0)
  const fw = new K98ProFirmware().attach(fake)
  const state = installDisplaySim(fw)
  const link = new K98Link(await WebHidTransport.open(fake, 0), { timeoutMs: 50, retries: 0 })
  return { fake, fw, state, link, display: new K98Display(link) }
}

describe('K98Display', () => {
  it('encodes headers, control bytes and rewritten packet counters', () => {
    expect(transferControlByte(2, 1)).toBe(0x42)
    expect(transferControlByte(3, 0)).toBe(0x03)
    const h = encodeDynamicHeader({ frameCount: 1, fps: 10, width: 428, height: 142, bitDepth: 24 }, DynamicFormat.CompressedGif, 0x12345)
    expect(hex(h)).toBe('00 01 0a 01 ac 00 8e 18 00 10 00 01 23 45 00 00 00 00')
    expect(parseDynamicHeader(h)).toEqual({ frameCount: 1, fps: 10, width: 428, height: 142, bitDepth: 24 })
    expect(() => encodeDynamicHeader({ frameCount: 1, fps: 1, width: 1, height: 1, bitDepth: 24 }, DynamicFormat.CompressedGif, 0)).toThrow()
    const packets = rewriteTransferPackets(buildPackets(0x1f, 0, new Array(300).fill(7), 0), 0)
    expect(packets).toHaveLength(6)
    expect(hex(packets[5]!.subarray(0, 6))).toBe('1f 00 06 00 05 14')
  })

  it('probes support and reads the JSON profile', async () => {
    const { display, state } = await setup()
    expect(await display.isSupported()).toEqual({ lcd: true, led: false })
    expect(await display.profile()).toEqual({ displaySize: { w: 428, h: 142 }, name: 'K98 Pro LCD' })
    state.profile = { displaySize: { w: 320, h: 100 }, pad: 'x'.repeat(200) } // multi-packet body
    expect(await display.capabilities()).toEqual({ lcd: true, led: false, width: 320, height: 100, maxFileBytes: 3 * 1024 * 1024 })
  })

  it('uploads a GIF as one dynamic frame between Start and End handshakes', async () => {
    const { display, state } = await setup()
    const gif = Uint8Array.from({ length: 150 }, (_, i) => i & 0xff)
    const progress: number[] = []
    await display.upload({ gif, width: 428, height: 142, fps: 10 }, (f) => progress.push(f))
    expect(state.transfers).toEqual([[0x43, 0, 1, 0], [0x03, 0, 1]])
    expect(state.received.length).toBe(18 + 150)
    expect(parseDynamicHeader(state.received)).toEqual({ frameCount: 1, fps: 10, width: 428, height: 142, bitDepth: 24 })
    expect(Array.from(state.received.subarray(18))).toEqual(Array.from(gif))
    expect(progress[progress.length - 1]).toBe(1)
    expect(progress.length).toBe(3)
  })

  it('uploads a real-size GIF (thousands of packets) with 16-bit packet counters', async () => {
    const { display, state, fake } = await setup()
    const gif = Uint8Array.from({ length: 60_000 }, (_, i) => (i * 7) & 0xff)
    let last = 0
    await display.upload({ gif, width: 428, height: 142, fps: 1 }, (f) => (last = f))
    const packets = Math.ceil((18 + gif.length) / 56)
    expect(packets).toBeGreaterThan(255)
    expect(last).toBe(1)
    expect(state.received.length).toBe(18 + gif.length)
    expect(Array.from(state.received.subarray(18))).toEqual(Array.from(gif))
    // pixel packet 300: count and index are 16-bit big-endian in bytes 1–4
    const p300 = fake.sent.find((s) => s.data[0] === 0x1f && ((s.data[3]! << 8) | s.data[4]!) === 300)!
    expect(hex(p300.data.subarray(0, 6))).toBe(`1f ${(packets >> 8).toString(16).padStart(2, '0')} ${(packets & 0xff).toString(16).padStart(2, '0')} 01 2c 38`)
  })

  it('sends the time payload', async () => {
    const { display, state } = await setup()
    await display.syncTime(new Date(2026, 8, 7, 16, 45, 30)) // Mon 7 Sep 2026
    expect(state.time).toEqual([0, 0, 0, 2026 & 0xff, 2026 >> 8, 9, 7, 16, 45, 30, 1, 12, 12, 12])
  })
})
