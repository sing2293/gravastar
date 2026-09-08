/**
 * Minimal GIF89a encoder (global 256-colour palette, LZW) and an indexed-frame decoder used by tests.
 * The K98 Pro LCD accepts a GIF file as a single "dynamic" frame; the vendor tool re-encodes uploads to exactly the
 * panel size with an R3G3B2 palette, which is what `prepare.ts` produces with this encoder.
 */

export interface IndexedFrame {
  /** One palette index per pixel, row-major, `width × height`. */
  indices: Uint8Array
  /** Frame delay in hundredths of a second. */
  delayCs: number
}

export interface GifSpec {
  width: number
  height: number
  /** 256 × RGB. */
  palette: Uint8Array
  frames: IndexedFrame[]
  /** 0 = loop forever. */
  loops?: number
}

/** R3G3B2: index = rrrgggbb; the natural palette for a 256-entry global colour table. */
export const R3G3B2_PALETTE: Uint8Array = (() => {
  const p = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const r = (i >> 5) & 7
    const g = (i >> 2) & 7
    const b = i & 3
    p[i * 3] = (r << 5) | (r << 2) | (r >> 1)
    p[i * 3 + 1] = (g << 5) | (g << 2) | (g >> 1)
    p[i * 3 + 2] = (b << 6) | (b << 4) | (b << 2) | b
  }
  return p
})()

export const quantizeR3G3B2 = (r: number, g: number, b: number): number => ((r & 0xe0) | ((g & 0xe0) >> 3) | (b >> 6)) & 0xff

class ByteWriter {
  private buf = new Uint8Array(1 << 16)
  private len = 0

  byte(b: number): void {
    if (this.len >= this.buf.length) {
      const n = new Uint8Array(this.buf.length * 2)
      n.set(this.buf)
      this.buf = n
    }
    this.buf[this.len++] = b & 0xff
  }

  bytes(bs: ArrayLike<number>): void {
    for (let i = 0; i < bs.length; i++) this.byte(bs[i]!)
  }

  u16(v: number): void {
    this.byte(v & 0xff)
    this.byte((v >> 8) & 0xff)
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i))
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

/** LZW-compresses palette indices into GIF sub-blocks (minimum code size 8). */
export function lzwEncode(indices: Uint8Array, minCodeSize = 8): Uint8Array {
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  const out = new ByteWriter()
  let block: number[] = []
  let bitBuf = 0
  let bitCount = 0
  const flushBlock = () => {
    if (!block.length) return
    out.byte(block.length)
    out.bytes(block)
    block = []
  }
  const emit = (code: number, size: number) => {
    bitBuf |= code << bitCount
    bitCount += size
    while (bitCount >= 8) {
      block.push(bitBuf & 0xff)
      bitBuf >>>= 8
      bitCount -= 8
      if (block.length === 255) flushBlock()
    }
  }
  let dict = new Map<number, number>()
  let next = eoi + 1
  let codeSize = minCodeSize + 1
  emit(clear, codeSize)
  let prefix = -1
  for (let i = 0; i < indices.length; i++) {
    const c = indices[i]!
    if (prefix < 0) {
      prefix = c
      continue
    }
    const key = (prefix << 8) | c
    const found = dict.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }
    emit(prefix, codeSize)
    if (next < 4096) {
      dict.set(key, next++)
      if (next > 1 << codeSize && codeSize < 12) codeSize++
    } else {
      emit(clear, codeSize)
      dict = new Map()
      next = eoi + 1
      codeSize = minCodeSize + 1
    }
    prefix = c
  }
  if (prefix >= 0) emit(prefix, codeSize)
  emit(eoi, codeSize)
  if (bitCount > 0) {
    block.push(bitBuf & 0xff)
    if (block.length === 255) flushBlock()
  }
  flushBlock()
  out.byte(0)
  return out.result()
}

export function encodeGif(spec: GifSpec): Uint8Array {
  const { width, height, palette, frames } = spec
  if (palette.length !== 256 * 3) throw new Error('palette must have 256 RGB entries')
  if (!frames.length) throw new Error('a GIF needs at least one frame')
  const w = new ByteWriter()
  w.ascii('GIF89a')
  w.u16(width)
  w.u16(height)
  w.byte(0xf7) // global colour table, 8 bits/colour, 256 entries
  w.byte(0)
  w.byte(0)
  w.bytes(palette)
  if (frames.length > 1) {
    w.bytes([0x21, 0xff, 0x0b])
    w.ascii('NETSCAPE2.0')
    w.bytes([0x03, 0x01])
    w.u16(spec.loops ?? 0)
    w.byte(0)
  }
  for (const f of frames) {
    if (f.indices.length !== width * height) throw new Error(`frame has ${f.indices.length} pixels, expected ${width * height}`)
    w.bytes([0x21, 0xf9, 0x04, 0x04]) // graphic control: disposal 1 (leave), no transparency
    w.u16(Math.max(0, Math.min(0xffff, Math.round(f.delayCs))))
    w.byte(0)
    w.byte(0)
    w.byte(0x2c)
    w.u16(0)
    w.u16(0)
    w.u16(width)
    w.u16(height)
    w.byte(0) // no local colour table, not interlaced
    w.byte(8)
    w.bytes(lzwEncode(f.indices, 8))
  }
  w.byte(0x3b)
  return w.result()
}

/** LZW decoder for the sub-block stream that follows the minimum-code-size byte; used by tests. */
export function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  const out = new Uint8Array(pixelCount)
  let outLen = 0
  // Concatenate sub-blocks.
  const stream: number[] = []
  let pos = 0
  while (pos < data.length) {
    const n = data[pos++]!
    if (n === 0) break
    for (let i = 0; i < n; i++) stream.push(data[pos++]!)
  }
  let bitPos = 0
  const read = (size: number): number => {
    let v = 0
    for (let i = 0; i < size; i++) {
      const byte = stream[bitPos >> 3] ?? 0
      v |= ((byte >> (bitPos & 7)) & 1) << i
      bitPos++
    }
    return v
  }
  let dict: number[][] = []
  let codeSize = minCodeSize + 1
  let prev: number[] | undefined
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, i) => (i < clear ? [i] : []))
    codeSize = minCodeSize + 1
    prev = undefined
  }
  reset()
  for (;;) {
    const code = read(codeSize)
    if (code === clear) {
      reset()
      continue
    }
    if (code === eoi) break
    let entry: number[]
    if (code < dict.length) entry = dict[code]!
    else if (prev) entry = [...prev, prev[0]!]
    else throw new Error('bad LZW stream')
    for (const px of entry) if (outLen < pixelCount) out[outLen++] = px
    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]!])
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize++
    }
    prev = entry
    if (outLen >= pixelCount) break
  }
  return out
}
