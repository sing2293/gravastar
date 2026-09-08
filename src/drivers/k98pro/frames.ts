/**
 * Framing used on the 2.4 GHz dongle link ("Wireless8K"): a 64-byte buffer (report ID + 63-byte packet) is cut
 * into ≤14-byte frames, each ACKed by the receiver. Pure functions only.
 * Spec: docs/reverse-engineering/k98pro/02-commands-config.md §7, 01-transport.md §5.
 *
 *   0: 0x66   1: total | sync.bit2<<7   2: current(1-based) | sync.bit1<<7   3: len | sync.bit0<<7
 *   4..4+len-1: data   4+len: checksum = Σ bytes[0..4+len-1] & 0xFF   — zero-padded to 19 bytes on the wire
 */
import { sum8 } from '@/hid/core/bytes'

export const FRAME_HEADER = 0x66
export const FRAME_REPORT_SIZE = 19
export const FRAME_DATA_MAX = 14
export const FRAME_MAX_PAYLOAD = 64

export interface ParsedFrame {
  header: number
  total: number
  current: number
  length: number
  syncFlag: number
  data: Uint8Array
  checksum: number
  checksumIndex: number
}

export function buildFrame(total: number, current: number, data: Uint8Array, syncFlag: number): Uint8Array {
  if (data.length > FRAME_DATA_MAX) throw new RangeError(`frame data too long: ${data.length}`)
  const head = [
    FRAME_HEADER,
    (total & 0x7f) | ((syncFlag & 4) << 5),
    (current & 0x7f) | ((syncFlag & 2) << 6),
    (data.length & 0x7f) | ((syncFlag & 1) << 7),
  ]
  const body = Uint8Array.from([...head, ...data])
  const out = new Uint8Array(FRAME_REPORT_SIZE)
  out.set(body)
  out[body.length] = sum8(body)
  return out
}

export function parseFrame(bytes: Uint8Array): ParsedFrame {
  if (bytes.length < 5) throw new RangeError(`frame too short: ${bytes.length}`)
  const b1 = bytes[1]!, b2 = bytes[2]!, b3 = bytes[3]!
  const length = b3 & 0x7f
  const checksumIndex = 4 + length
  return {
    header: bytes[0]!,
    total: b1 & 0x7f,
    current: b2 & 0x7f,
    length,
    syncFlag: ((b1 & 0x80) >> 5) | ((b2 & 0x80) >> 6) | ((b3 & 0x80) >> 7),
    data: bytes.subarray(4, checksumIndex),
    checksum: bytes[checksumIndex] ?? 0,
    checksumIndex,
  }
}

export function isValidDataFrame(bytes: Uint8Array): boolean {
  if (bytes[0] !== FRAME_HEADER) return false
  const f = parseFrame(bytes)
  if (f.length === 0 || f.current < 1 || f.current > f.total || f.checksumIndex >= bytes.length) return false
  return sum8(bytes.subarray(0, f.checksumIndex)) === f.checksum
}

/** An ACK repeats the 4 header bytes with the length cleared (sync bit kept) plus their checksum. */
export function buildAckFrame(received: Uint8Array): Uint8Array {
  const head = Uint8Array.from([received[0]!, received[1]!, received[2]!, received[3]! & 0x80])
  const out = new Uint8Array(FRAME_REPORT_SIZE)
  out.set(head)
  out[4] = sum8(head)
  return out
}

export function isAckFrame(bytes: Uint8Array): boolean {
  if (bytes.length < 5 || bytes[0] !== FRAME_HEADER) return false
  const f = parseFrame(bytes)
  return f.length === 0 && bytes[4] === sum8(bytes.subarray(0, 4))
}

/** Key identifying a pending frame while waiting for its ACK. */
export function frameKey(f: Pick<ParsedFrame, 'syncFlag' | 'total' | 'current'>): string {
  return `${f.syncFlag}-${f.total}-${f.current}`
}

/** Splits a ≤64-byte buffer into frame-sized chunks (14 bytes each). */
export function splitPayload(payload: Uint8Array): Uint8Array[] {
  if (payload.length > FRAME_MAX_PAYLOAD) throw new RangeError(`payload too long for framing: ${payload.length}`)
  const out: Uint8Array[] = []
  for (let i = 0; i < payload.length; i += FRAME_DATA_MAX) out.push(payload.subarray(i, i + FRAME_DATA_MAX))
  return out
}
