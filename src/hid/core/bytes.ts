/** Small byte helpers shared by every driver. Pure functions only. */

export function concat(...parts: ArrayLike<number>[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** Right-pads (or truncates) to exactly `length` bytes. */
export function padTo(bytes: ArrayLike<number>, length: number, fill = 0): Uint8Array {
  const out = new Uint8Array(length).fill(fill)
  out.set(Array.prototype.slice.call(bytes, 0, length))
  return out
}

/** 8-bit additive checksum: sum of all bytes, modulo 256. */
export function sum8(bytes: ArrayLike<number>, seed = 0): number {
  let acc = seed
  for (let i = 0; i < bytes.length; i++) acc = (acc + bytes[i]!) & 0xff
  return acc
}

export function u16be(value: number): [number, number] {
  return [(value >> 8) & 0xff, value & 0xff]
}

export function u16le(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff]
}

export function readU16be(bytes: ArrayLike<number>, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) & 0xffff
}

export function readU16le(bytes: ArrayLike<number>, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8)) & 0xffff
}

export function toBytes(data: ArrayLike<number> | ArrayBuffer | DataView): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (data instanceof DataView) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return Uint8Array.from(data)
}

/** `[0x66, 0x01, ...]` style rendering for logs and test failures. */
export function hex(bytes: ArrayLike<number>, separator = ' '): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(separator)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function chunk(bytes: Uint8Array, size: number): Uint8Array[] {
  if (size <= 0) throw new RangeError('chunk size must be positive')
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size))
  return out
}
