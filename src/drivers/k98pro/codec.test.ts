import { describe, expect, it } from 'vitest'
import { hex } from '@/hid/core/bytes'
import {
  alignedChunk,
  buildPackets,
  checksum,
  decodeLayerAndSystem,
  decodePayload,
  encodeLayerAndSystem,
  isBubble,
  isResponseTo,
  parsePacket,
  readId,
} from './codec'
import { buildAckFrame, buildFrame, frameKey, isAckFrame, isValidDataFrame, parseFrame, splitPayload } from './frames'

// Worked examples come from docs/reverse-engineering/k98pro/04-performance-advanced-keys.md §3.4/§4.7 (reportId 0).
describe('K98 Pro packet codec', () => {
  it('builds the "set actuation of key 43 to 1500" packet with checksum 0xDA', () => {
    const [pkt] = buildPackets(0x13, 0x00, [0x00, 0x2b, 0x05, 0xdc, 0x00], 0)
    expect(pkt).toBeDefined()
    expect(pkt!.length).toBe(63)
    expect(hex(pkt!.subarray(0, 11))).toBe('13 00 00 01 00 05 00 2b 05 dc 00')
    expect(pkt![62]).toBe(0xda)
  })

  it('SOCD on keys 43/44, last-input priority → checksum 0x88 (byte 2 carries the type, set by the caller)', () => {
    const [pkt] = buildPackets(0x12, 0x00, [0x02, 0x00, 0x2b, 0x00, 0x2c, 0x01], 0)
    pkt![2] = 0x04
    pkt![62] = checksum(pkt!, 0)
    expect(hex(pkt!.subarray(0, 12))).toBe('12 00 04 01 00 06 02 00 2b 00 2c 01')
    expect(pkt![62]).toBe(0x88)
  })

  it('folds the HID report id into the checksum', () => {
    const [a] = buildPackets(0x87, 0, [], 0)
    const [b] = buildPackets(0x87, 0, [], 8)
    expect(a![62]).toBe((b![62]! + 8) & 0xff)
  })

  it('an empty payload still yields one packet; larger payloads split at the chunk size', () => {
    expect(buildPackets(0x82, 0x02, [], 0)).toHaveLength(1)
    const ids = Array.from({ length: 40 }, (_, i) => [0, i + 1]).flat() // 40 u16 ids = 80 bytes
    const pkts = buildPackets(0xa5, 0x00, ids, 0, alignedChunk(2, 2))
    expect(pkts).toHaveLength(2)
    expect(pkts.map((p) => hex(p.subarray(0, 6)))).toEqual(['a5 00 00 02 00 38', 'a5 00 00 02 01 18'])
  })

  it('alignedChunk keeps records inside one packet', () => {
    expect(alignedChunk(2, 2)).toBe(56)
    expect(alignedChunk(2, 6)).toBe(18)
    expect(alignedChunk(6)).toBe(54)
    expect(alignedChunk(2, 5)).toBe(22)
  })

  it('parses, matches and decodes responses', () => {
    const [req] = buildPackets(0x92, 0x00, [0x00, 0x2b], 0)
    const resp = new Uint8Array(63)
    resp.set([0x92, 0x00, 0x02, 0x01, 0x00, 0x0c, 0x00, 0x2b, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x9b])
    expect(isResponseTo(req!, resp)).toBe(true)
    const parsed = parsePacket(resp)
    expect(parsed.byte2).toBe(0x02)
    expect(parsed.length).toBe(12)
    expect(hex(decodePayload(resp))).toBe('00 2b 00 01 00 00 00 00 00 04 00 9b')
    expect(decodePayload(resp, 2)).toEqual(Uint8Array.from([0x00, 0x2b]))
    const other = Uint8Array.from(resp)
    other[4] = 1
    expect(isResponseTo(req!, other)).toBe(false)
  })

  it('concatenates multi-packet payloads in order', () => {
    const p0 = new Uint8Array(63)
    p0.set([0x83, 0, 0, 2, 0, 3, 1, 2, 3])
    const p1 = new Uint8Array(63)
    p1.set([0x83, 0, 0, 2, 1, 2, 4, 5])
    expect(Array.from(decodePayload([p0, p1]))).toEqual([1, 2, 3, 4, 5])
  })

  it('layer/system byte', () => {
    expect(encodeLayerAndSystem(0, 0)).toBe(0x00)
    expect(encodeLayerAndSystem(1, 0)).toBe(0x01)
    expect(encodeLayerAndSystem(0, 1)).toBe(0x04)
    expect(encodeLayerAndSystem(2, 1)).toBe(0x06)
    expect(decodeLayerAndSystem(0x06)).toEqual({ layer: 2, system: 1 })
  })

  it('recognises device-initiated reports', () => {
    expect(isBubble(Uint8Array.from([0xfe, 0x05, 80, 0x10]))).toBe(true)
    expect(isBubble(Uint8Array.from([0x98, 0x01]))).toBe(true)
    expect(isBubble(Uint8Array.from([0x98, 0x00]))).toBe(false)
    expect(isBubble(Uint8Array.from([0x94, 0x02]))).toBe(true)
    expect(isBubble(Uint8Array.from([0x94, 0x05]))).toBe(false)
    const dongle = new Uint8Array(19)
    dongle[0] = 0x0a
    expect(isBubble(dongle)).toBe(true)
    expect(readId(0x04)).toBe(0x84)
  })
})

describe('K98 Pro dongle frames', () => {
  it('builds and parses a data frame with sync bits in the header high bits', () => {
    const data = Uint8Array.from([1, 2, 3])
    const f = buildFrame(5, 2, data, 0b101)
    expect(f.length).toBe(19)
    expect(hex(f.subarray(0, 8))).toBe('66 85 02 83 01 02 03 76')
    const p = parseFrame(f)
    expect(p).toMatchObject({ header: 0x66, total: 5, current: 2, length: 3, syncFlag: 5, checksumIndex: 7 })
    expect(Array.from(p.data)).toEqual([1, 2, 3])
    expect(isValidDataFrame(f)).toBe(true)
    expect(frameKey(p)).toBe('5-5-2')
    f[5] = 9
    expect(isValidDataFrame(f)).toBe(false)
  })

  it('ACK frames repeat the header with length 0', () => {
    const f = buildFrame(1, 1, Uint8Array.from([0xaa]), 1)
    const ack = buildAckFrame(f)
    expect(hex(ack.subarray(0, 5))).toBe('66 01 01 80 e8')
    expect(isAckFrame(ack)).toBe(true)
    expect(isAckFrame(f)).toBe(false)
    expect(frameKey(parseFrame(ack))).toBe(frameKey(parseFrame(f)))
  })

  it('splits a 64-byte payload into 5 frames of ≤14 bytes', () => {
    const parts = splitPayload(new Uint8Array(64))
    expect(parts.map((p) => p.length)).toEqual([14, 14, 14, 14, 8])
    expect(() => splitPayload(new Uint8Array(65))).toThrow()
  })
})
