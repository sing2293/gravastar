/**
 * K98 Pro 63-byte command packets — pure functions.
 * Spec: docs/reverse-engineering/k98pro/02-commands-config.md §2–§5, §9.
 *
 *   0: commandId   1: param   2: reserved (advanced keys: type; macro reads: offset low byte)
 *   3: totalPackets   4: packetIndex   5: payloadLength   6..61: payload   62: checksum
 */
import { chunk as chunkBytes, sum8 } from '@/hid/core/bytes'

export const PACKET_SIZE = 63
export const HEADER_LENGTH = 6
export const CHECKSUM_INDEX = 62
export const PAYLOAD_MAX = PACKET_SIZE - HEADER_LENGTH - 1 // 56

export interface ParsedPacket {
  commandId: number
  param: number
  byte2: number
  total: number
  index: number
  length: number
  payload: Uint8Array
  checksum: number
}

/**
 * `0xFF − ((reportId + Σ bytes[0..61]) mod 256)`. The HID report ID is part of the sum even though it is not
 * inside the 63 bytes, so the same packet has a different checksum on a device exposing a different report ID.
 */
export function checksum(packet: Uint8Array, reportId: number): number {
  return (0xff - sum8(packet.subarray(0, CHECKSUM_INDEX), reportId & 0xff)) & 0xff
}

export function withChecksum(packet: Uint8Array, reportId: number): Uint8Array {
  packet[CHECKSUM_INDEX] = checksum(packet, reportId)
  return packet
}

/** Chunk size that keeps fixed-size records from straddling packets: `floor(56 / responseRecord) * requestRecord`. */
export function alignedChunk(requestRecord: number, responseRecord: number = requestRecord): number {
  return Math.floor(PAYLOAD_MAX / responseRecord) * requestRecord
}

/**
 * Splits `payload` into `max(ceil(len / chunk), 1)` packets that all repeat `commandId`/`param`.
 * An empty payload still yields one packet.
 */
export function buildPackets(commandId: number, param: number, payload: ArrayLike<number>, reportId: number, chunk = PAYLOAD_MAX): Uint8Array[] {
  if (chunk <= 0 || chunk > PAYLOAD_MAX) throw new RangeError(`chunk must be 1..${PAYLOAD_MAX}, got ${chunk}`)
  const data = Uint8Array.from(payload)
  const parts = data.length ? chunkBytes(data, chunk) : [new Uint8Array(0)]
  if (parts.length > 255) throw new RangeError(`payload of ${data.length} bytes needs ${parts.length} packets (max 255)`)
  return parts.map((part, i) => {
    const pkt = new Uint8Array(PACKET_SIZE)
    pkt[0] = commandId & 0xff
    pkt[1] = param & 0xff
    pkt[2] = 0
    pkt[3] = parts.length
    pkt[4] = i
    pkt[5] = part.length
    pkt.set(part, HEADER_LENGTH)
    return withChecksum(pkt, reportId)
  })
}

export function parsePacket(bytes: Uint8Array): ParsedPacket {
  if (bytes.length < HEADER_LENGTH) throw new RangeError(`packet too short: ${bytes.length}`)
  const length = Math.min(bytes[5]!, PAYLOAD_MAX)
  return {
    commandId: bytes[0]!,
    param: bytes[1]!,
    byte2: bytes[2]!,
    total: bytes[3]!,
    index: bytes[4]!,
    length,
    payload: bytes.subarray(HEADER_LENGTH, HEADER_LENGTH + length),
    checksum: bytes[CHECKSUM_INDEX] ?? 0,
  }
}

/** Response matching: bytes 0 (command), 1 (param), 3 (total) and 4 (index) must equal the request's. */
export function isResponseTo(request: Uint8Array, response: Uint8Array): boolean {
  return response.length >= 5 && request[0] === response[0] && request[1] === response[1] && request[3] === response[3] && request[4] === response[4]
}

/**
 * Payload of one packet or the concatenation of several. `expectedLength` overrides the device's length byte
 * (the vendor library uses this for fixed-size replies such as 32-byte bitmaps).
 */
export function decodePayload(packets: Uint8Array | Uint8Array[], expectedLength?: number): Uint8Array {
  const list = Array.isArray(packets) ? packets : [packets]
  const slices = list.map((p) => {
    const len = Math.min(expectedLength ?? p[5] ?? 0, PAYLOAD_MAX)
    return p.subarray(HEADER_LENGTH, HEADER_LENGTH + len)
  })
  const out = new Uint8Array(slices.reduce((n, s) => n + s.length, 0))
  let offset = 0
  for (const s of slices) {
    out.set(s, offset)
    offset += s.length
  }
  return out
}

export const enum System {
  Windows = 0,
  MacOS = 1,
}

/** Param byte for layered commands: `(layer & 3) | ((system & 7) << 2)`. */
export function encodeLayerAndSystem(layer: number, system: number): number {
  return ((layer & 0x03) | ((system & 0x07) << 2)) & 0xff
}

export function decodeLayerAndSystem(param: number): { layer: number; system: number } {
  return { layer: param & 0x03, system: (param >> 2) & 0x07 }
}

/** Command IDs pushed by the device on its own (`docs/.../02-commands-config.md` §8). */
export const BUBBLE_COMMANDS = { common: 0xfe, keyTravel: 0x98, calibration: 0x94 } as const

/** True for device-initiated reports that must never be matched against the pending request. */
export function isBubble(bytes: Uint8Array): boolean {
  if (bytes.length === 19 && bytes[0] === 0x0a) return true // dongle report
  const cmd = bytes[0]
  if (cmd === BUBBLE_COMMANDS.common) return true
  if (cmd === BUBBLE_COMMANDS.keyTravel) return bytes[1] === 0x01
  if (cmd === BUBBLE_COMMANDS.calibration) return bytes[1] === 0x02
  return false
}

/** Read command IDs are the write ID with bit 7 set (0x04 ↔ 0x84, 0x10 ↔ 0x90 …). */
export const readId = (writeId: number): number => writeId | 0x80
