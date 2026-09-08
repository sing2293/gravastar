import { describe, expect, it } from 'vitest'
import { hex } from '@/hid/core/bytes'
import { REPORT_ID, buildFrame, complementPair, echoMatches, frameChecksum, parseFrame, recordCrc, sumsTo55, withRecordCrc } from './frame'

// Byte examples from docs/reverse-engineering/mouse/02-features.md §5.3, §1.2 and 01-transport-commands.md §3.
describe('Compx frame codec', () => {
  it('EEPROM records sum to 0x55: Left click 01 01 00 53, DPI loop 02 01 00 52, fire key 04 0A 03 44', () => {
    expect(hex(withRecordCrc([0x01, 0x01, 0x00]))).toBe('01 01 00 53')
    expect(hex(withRecordCrc([0x02, 0x01, 0x00]))).toBe('02 01 00 52')
    expect(hex(withRecordCrc([0x04, 0x0a, 0x03]))).toBe('04 0a 03 44')
    expect(hex(withRecordCrc([0x06, 0x05, 0x01]))).toBe('06 05 01 49')
    expect(sumsTo55([0x01, 0x01, 0x00, 0x53])).toBe(true)
    expect(recordCrc([0x7f, 0x7f, 0x00])).toBe(0x57)
  })

  it('single values are stored with their 0x55 complement', () => {
    expect(complementPair(0x08)).toEqual([0x08, 0x4d])
    expect(complementPair(0x80)).toEqual([0x80, 0xd5])
    expect(sumsTo55(complementPair(0x80))).toBe(true)
  })

  it('frames sum to 0x55 including the report id', () => {
    const f = buildFrame({ command: 0x02, payload: [1] })
    expect(f.length).toBe(16)
    expect(hex(f)).toBe('02 00 00 00 01 01 00 00 00 00 00 00 00 00 00 49')
    let s = REPORT_ID
    for (const b of f) s += b
    expect(s & 0xff).toBe(0x55)
    expect(frameChecksum(f)).toBe(0x49)
  })

  it('flash write of value 0x08 at 0x0000 → 07 00 00 00 02 08 4d … crc', () => {
    const f = buildFrame({ command: 0x07, address: 0x0000, payload: complementPair(0x08) })
    expect(hex(f.subarray(0, 7))).toBe('07 00 00 00 02 08 4d')
    const p = parseFrame(f)
    expect(p).toMatchObject({ command: 0x07, status: 0, address: 0, length: 2 })
    expect(Array.from(p.payload)).toEqual([0x08, 0x4d])
  })

  it('keyboard type flag and address are placed correctly', () => {
    const f = buildFrame({ command: 0x08, address: 0x1b48, payload: [], typeFlag: 0x80 })
    expect(hex(f.subarray(0, 5))).toBe('08 00 1b 48 80')
    expect(parseFrame(f).length).toBe(0)
    expect(() => buildFrame({ command: 1, payload: new Array(11).fill(0) })).toThrow()
  })

  it('echo matching: 3 bytes normally, 5 for flash reads, status 1 always matches', () => {
    const req = buildFrame({ command: 0x0e })
    const ok = Uint8Array.from(req)
    ok[5] = 2
    expect(echoMatches(req, ok)).toBe(true)
    const read = buildFrame({ command: 0x08, address: 0x00a0, payload: new Array(7).fill(0) })
    const wrongLen = Uint8Array.from(read)
    wrongLen[4] = 2
    expect(echoMatches(read, wrongLen)).toBe(false)
    const nak = new Uint8Array(16)
    nak[0] = 0x17
    nak[1] = 1
    expect(echoMatches(buildFrame({ command: 0x17 }), nak)).toBe(true)
  })
})
