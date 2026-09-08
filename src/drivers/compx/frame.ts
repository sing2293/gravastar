/**
 * Compx mouse 16-byte report frames on report ID 0x08 — pure functions.
 * Spec: docs/reverse-engineering/mouse/01-transport-commands.md §2–§3.
 *
 *   0: command   1: status (0 on send; reply 0 = OK, 1 = error/unsupported)   2..3: address (BE) or chunk index
 *   4: payload length (+0x80 on keyboards)   5..14: payload (≤10 bytes)   15: checksum
 *
 * Invariant: (reportId + Σ frame[0..15]) mod 256 == 0x55.
 */
export const REPORT_ID = 0x08
export const FRAME_SIZE = 16
export const PAYLOAD_MAX = 10
/** EEPROM sub-records (DPI stages, key slots, light block …) satisfy Σ record mod 256 == 0x55 on their own. */
export const CRC_TARGET = 0x55

export interface FrameFields {
  command: number
  address?: number
  payload?: ArrayLike<number>
  /** 0 for mice, 0x80 for Compx keyboards. */
  typeFlag?: number
}

export interface ParsedFrame {
  command: number
  status: number
  address: number
  length: number
  payload: Uint8Array
  checksum: number
}

function sum(bytes: ArrayLike<number>, end = bytes.length): number {
  let s = 0
  for (let i = 0; i < end; i++) s += bytes[i]!
  return s
}

/** Checksum that makes a record sum to 0x55 (mod 256). */
export function recordCrc(bytes: ArrayLike<number>): number {
  return (CRC_TARGET - (sum(bytes) & 0xff)) & 0xff
}

/** Appends `recordCrc` to a record. */
export function withRecordCrc(bytes: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(bytes.length + 1)
  out.set(bytes)
  out[bytes.length] = recordCrc(bytes)
  return out
}

export function sumsTo55(bytes: ArrayLike<number>): boolean {
  return (sum(bytes) & 0xff) === CRC_TARGET
}

/** A single EEPROM value is stored with its complement so the pair sums to 0x55. */
export function complementPair(value: number): [number, number] {
  return [value & 0xff, (CRC_TARGET - (value & 0xff)) & 0xff]
}

export function buildFrame({ command, address = 0, payload = [], typeFlag = 0 }: FrameFields): Uint8Array {
  if (payload.length > PAYLOAD_MAX) throw new RangeError(`payload too long: ${payload.length} > ${PAYLOAD_MAX}`)
  const f = new Uint8Array(FRAME_SIZE)
  f[0] = command & 0xff
  f[1] = 0
  f[2] = (address >> 8) & 0xff
  f[3] = address & 0xff
  f[4] = (payload.length + typeFlag) & 0xff
  f.set(Array.prototype.slice.call(payload), 5)
  f[15] = frameChecksum(f)
  return f
}

/** `(0x55 − Σ frame[0..14] − reportId) mod 256`. */
export function frameChecksum(frame: Uint8Array, reportId = REPORT_ID): number {
  return (CRC_TARGET - (sum(frame, 15) & 0xff) - reportId) & 0xff
}

export function parseFrame(bytes: Uint8Array): ParsedFrame {
  if (bytes.length < 5) throw new RangeError(`frame too short: ${bytes.length}`)
  const length = Math.min(bytes[4]! & 0x0f, PAYLOAD_MAX)
  return {
    command: bytes[0]!,
    status: bytes[1]!,
    address: ((bytes[2]! << 8) | bytes[3]!) & 0xffff,
    length,
    payload: bytes.subarray(5, 5 + length),
    checksum: bytes[15] ?? 0,
  }
}

/**
 * The device echoes the request; the vendor driver treats a reply as the answer when its first 3 bytes match
 * (5 bytes for flash reads, so address and length are verified), or immediately when status == 1.
 */
export function echoMatches(request: Uint8Array, response: Uint8Array): boolean {
  if (response[1] === 1) return true
  const n = request[0] === 0x08 ? 5 : 3
  for (let i = 0; i < n; i++) if (request[i] !== response[i]) return false
  return true
}

export const enum Command {
  EncryptionData = 0x01,
  PCDriverStatus = 0x02,
  DeviceOnLine = 0x03,
  BatteryLevel = 0x04,
  DongleEnterPair = 0x05,
  GetPairState = 0x06,
  WriteFlashData = 0x07,
  ReadFlashData = 0x08,
  ClearSetting = 0x09,
  StatusChanged = 0x0a,
  GetCurrentConfig = 0x0e,
  SetCurrentConfig = 0x0f,
  ReadVersionID = 0x12,
  Set4KDongleRGB = 0x14,
  Get4KDongleRGBValue = 0x15,
  SetLongRangeMode = 0x16,
  GetLongRangeMode = 0x17,
  SetDongleRGBBarMode = 0x18,
  GetDongleRGBBarMode = 0x19,
  GetDongleVersion = 0x1d,
  SetDongle3RGBMode = 0x2c,
  GetDongle3RGBMode = 0x2d,
  SetMotorParam = 0x2e,
  GetMotorParam = 0x2f,
  RestoreMotorParam = 0x30,
  SetOLEDPicture = 0x31,
  RestoreOLEDPicture = 0x32,
}
