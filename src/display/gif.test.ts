import { describe, expect, it } from 'vitest'
import { R3G3B2_PALETTE, encodeGif, lzwDecode, lzwEncode, quantizeR3G3B2 } from './gif'

describe('gif', () => {
  it('R3G3B2 palette and quantizer agree', () => {
    expect(quantizeR3G3B2(255, 255, 255)).toBe(255)
    expect(quantizeR3G3B2(0, 0, 0)).toBe(0)
    expect(quantizeR3G3B2(255, 0, 0)).toBe(0xe0)
    const i = quantizeR3G3B2(155, 255, 49)
    const [r, g, b] = [R3G3B2_PALETTE[i * 3]!, R3G3B2_PALETTE[i * 3 + 1]!, R3G3B2_PALETTE[i * 3 + 2]!]
    expect(Math.abs(r - 155)).toBeLessThan(40)
    expect(g).toBe(255)
    expect(Math.abs(b - 49)).toBeLessThan(70)
  })

  it('LZW round-trips random and repetitive data, including dictionary resets', () => {
    const rnd = Uint8Array.from({ length: 20000 }, (_, i) => (i * 7919 + (i >> 3)) & 0xff)
    expect(Array.from(lzwDecode(lzwEncode(rnd), 8, rnd.length))).toEqual(Array.from(rnd))
    const rep = new Uint8Array(428 * 142).fill(0x1c)
    const enc = lzwEncode(rep)
    expect(enc.length).toBeLessThan(2000)
    expect(Array.from(lzwDecode(enc, 8, rep.length))).toEqual(Array.from(rep))
    const gradient = Uint8Array.from({ length: 10000 }, (_, i) => (i / 39) & 0xff)
    expect(Array.from(lzwDecode(lzwEncode(gradient), 8, gradient.length))).toEqual(Array.from(gradient))
  })

  it('writes a valid GIF89a structure with loop extension and per-frame delays', () => {
    const frames = [
      { indices: Uint8Array.from([0, 1, 2, 3]), delayCs: 10 },
      { indices: Uint8Array.from([3, 2, 1, 0]), delayCs: 5 },
    ]
    const gif = encodeGif({ width: 2, height: 2, palette: R3G3B2_PALETTE, frames })
    expect(String.fromCharCode(...gif.subarray(0, 6))).toBe('GIF89a')
    expect(gif[6]! | (gif[7]! << 8)).toBe(2)
    expect(gif[8]! | (gif[9]! << 8)).toBe(2)
    expect(gif[10]).toBe(0xf7)
    expect(String.fromCharCode(...gif.subarray(13 + 768 + 3, 13 + 768 + 3 + 11))).toBe('NETSCAPE2.0')
    expect(gif[gif.length - 1]).toBe(0x3b)
    // first image descriptor follows the loop block (19 bytes) and the GCE (8 bytes)
    const gce = 13 + 768 + 19
    expect(gif[gce]).toBe(0x21)
    expect(gif[gce + 1]).toBe(0xf9)
    expect(gif[gce + 4]! | (gif[gce + 5]! << 8)).toBe(10)
    const desc = gce + 8
    expect(gif[desc]).toBe(0x2c)
    expect(gif[desc + 9]).toBe(0) // no local palette
    expect(gif[desc + 10]).toBe(8) // LZW minimum code size
    expect(Array.from(lzwDecode(gif.subarray(desc + 11), 8, 4))).toEqual([0, 1, 2, 3])
  })
})
