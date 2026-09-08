import { describe, expect, it } from 'vitest'
import { concat, hex } from '@/hid/core/bytes'
import { TimeoutError } from '@/hid/core/request'
import { WebHidTransport } from '@/hid/core/transport'
import { FakeHidDevice } from '@/hid/core/testing/fakeHidDevice'
import { buildPackets } from './codec'
import { buildAckFrame, buildFrame, isAckFrame, parseFrame } from './frames'
import { DONGLE_LINK, FramedTransport, K98Link, SendError } from './transport'

const REPORT_ID = 0

/** Echoes the 6-byte header and puts `payload` in the reply, like the firmware does for reads. */
function reply(request: Uint8Array, payload: number[] = []): Uint8Array {
  const r = new Uint8Array(63)
  r.set(request.subarray(0, 6))
  r[5] = payload.length
  r.set(payload, 6)
  return r
}

async function wiredLink(respond?: FakeHidDevice['respond']) {
  const fake = new FakeHidDevice('K98 Pro', 0x372e, 0x10e5, REPORT_ID)
  fake.respond = respond
  const transport = await WebHidTransport.open(fake, REPORT_ID)
  return { fake, link: new K98Link(transport, { timeoutMs: 30, retries: 1 }) }
}

describe('K98Link (wired)', () => {
  it('pairs each packet with its header-matched reply and reports progress', async () => {
    const { fake, link } = await wiredLink((_id, data) => [reply(data, [data[4]! + 10])])
    const packets = buildPackets(0x83, 0x00, new Array(80).fill(1), REPORT_ID, 18)
    const progress: number[] = []
    const replies = await link.request(packets, { onProgress: (f) => progress.push(f) })
    expect(replies).toHaveLength(packets.length)
    expect(replies.map((r) => r[6])).toEqual(packets.map((_, i) => i + 10))
    expect(progress[progress.length - 1]).toBe(1)
    expect(fake.sent).toHaveLength(packets.length)
  })

  it('ignores replies for other headers and bubbles, retries on timeout, then fails', async () => {
    let calls = 0
    const { fake, link } = await wiredLink((_id, data) => {
      calls++
      const wrong = reply(data)
      wrong[1] = 0x77 // param mismatch → must not be matched
      return [Uint8Array.from([0xfe, 0x05, 55, 0x10]), wrong]
    })
    const bubbles: Uint8Array[] = []
    link.onBubble((b) => bubbles.push(b))
    const [pkt] = buildPackets(0x87, 0, [], REPORT_ID)
    await expect(link.request([pkt!])).rejects.toBeInstanceOf(TimeoutError)
    expect(calls).toBe(2) // 1 + 1 retry
    expect(fake.sent).toHaveLength(2)
    expect(bubbles).toHaveLength(2)
    expect(hex(bubbles[0]!)).toBe('fe 05 37 10')
  })

  it('sendCommand does not wait for a reply', async () => {
    const { fake, link } = await wiredLink()
    const [pkt] = buildPackets(0x08, 0x02, [255, 0, 0], REPORT_ID)
    await link.sendCommand(pkt!)
    expect(fake.sent).toHaveLength(1)
  })

  it('surfaces send failures as SendError after retries', async () => {
    const fake = new FakeHidDevice('K98 Pro', 0x372e, 0x10e5, REPORT_ID)
    const transport = await WebHidTransport.open(fake, REPORT_ID)
    await fake.close()
    const link = new K98Link(transport, { timeoutMs: 10, retries: 0 })
    await expect(link.request(buildPackets(0x87, 0, [], REPORT_ID))).rejects.toBeInstanceOf(SendError)
  })
})

describe('FramedTransport (dongle)', () => {
  const DONGLE_ID = 0

  /** Firmware-side model: ACK every data frame, reassemble, and answer a request with a framed reply. */
  function makeDongleFake(onPacket: (packet: Uint8Array, send: (bytes: Uint8Array) => void) => void) {
    const fake = new FakeHidDevice('K98 Pro dongle', 0x372e, 0x106c, DONGLE_ID)
    let received: Uint8Array[] = []
    let sync = 0
    fake.respond = (_id, data) => {
      if (data[0] !== 0x66 || isAckFrame(data)) return []
      const f = parseFrame(data)
      const out: Uint8Array[] = [buildAckFrame(data)]
      if (f.current === 1) received = []
      received.push(Uint8Array.from(f.data))
      if (f.current === f.total) {
        const packet = concat(...received)
        onPacket(packet, (bytes) => {
          const parts: Uint8Array[] = []
          for (let i = 0; i < bytes.length; i += 14) parts.push(bytes.subarray(i, i + 14))
          parts.forEach((p, i) => {
            sync = (sync + 1) & 7
            out.push(buildFrame(parts.length, i + 1, p, sync))
          })
        })
      }
      return out
    }
    return fake
  }

  it('sends [reportId, packet] as ACKed frames and reassembles the framed reply', async () => {
    const seen: Uint8Array[] = []
    const fake = makeDongleFake((packet, send) => {
      seen.push(packet)
      send(reply(packet.subarray(1), [0x17, 0x01]))
    })
    const raw = await WebHidTransport.open(fake, DONGLE_ID)
    const framed = new FramedTransport(raw, { ackTimeoutMs: 20, ackAttempts: 3 })
    const link = new K98Link(framed, DONGLE_LINK)
    const [pkt] = buildPackets(0x82, 0x02, [0, 0], DONGLE_ID)
    const [resp] = await link.request([pkt!])
    expect(seen).toHaveLength(1)
    expect(seen[0]!.length).toBe(64)
    expect(seen[0]![0]).toBe(DONGLE_ID)
    expect(hex(seen[0]!.subarray(1, 7))).toBe('82 02 00 01 00 02')
    expect(hex(resp!.subarray(0, 8))).toBe('82 02 00 01 00 02 17 01')
    // 5 data frames + 5 ACKs for the reply frames
    const dataFrames = fake.sent.filter((s) => !isAckFrame(s.data))
    expect(dataFrames).toHaveLength(5)
    expect(dataFrames.map((s) => parseFrame(s.data).current)).toEqual([1, 2, 3, 4, 5])
    expect(new Set(dataFrames.map((s) => parseFrame(s.data).syncFlag)).size).toBe(5)
    expect(fake.sent.filter((s) => isAckFrame(s.data)).length).toBeGreaterThan(0)
  })

  it('retries un-ACKed frames and gives up after ackAttempts', async () => {
    const fake = new FakeHidDevice('K98 Pro dongle', 0x372e, 0x106c, DONGLE_ID)
    const raw = await WebHidTransport.open(fake, DONGLE_ID)
    const framed = new FramedTransport(raw, { ackTimeoutMs: 5, ackAttempts: 3 })
    await expect(framed.send(new Uint8Array(63))).rejects.toBeInstanceOf(SendError)
    expect(fake.sent).toHaveLength(3)
  })

  it('drops duplicates and out-of-order frames, forwards dongle status reports', async () => {
    const fake = new FakeHidDevice('K98 Pro dongle', 0x372e, 0x106c, DONGLE_ID)
    const raw = await WebHidTransport.open(fake, DONGLE_ID)
    const framed = new FramedTransport(raw)
    const got: Uint8Array[] = []
    framed.onInputReport((r) => got.push(r.data))
    const a = buildFrame(2, 1, Uint8Array.from([1, 2, 3]), 1)
    const b = buildFrame(2, 2, Uint8Array.from([4, 5]), 2)
    fake.dispatchInputReport(b) // out of order → ignored
    fake.dispatchInputReport(a)
    fake.dispatchInputReport(a) // duplicate first frame → restarts, harmless
    fake.dispatchInputReport(b)
    await new Promise((r) => setTimeout(r, 5))
    expect(got).toHaveLength(1)
    expect(Array.from(got[0]!)).toEqual([1, 2, 3, 4, 5])
    const dongle = new Uint8Array(19)
    dongle[0] = 0x0a
    dongle[4] = 2
    dongle[5] = 1
    fake.dispatchInputReport(dongle)
    expect(got).toHaveLength(2)
    expect(got[1]![0]).toBe(0x0a)
    const ignored = new Uint8Array(19)
    ignored[0] = 0x08
    fake.dispatchInputReport(ignored)
    expect(got).toHaveLength(2)
  })
})
