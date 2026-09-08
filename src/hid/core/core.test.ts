import { describe, expect, it } from 'vitest'
import { chunk, concat, hex, padTo, readU16be, readU16le, sum8, u16be, u16le } from './bytes'
import { SerialQueue, TimeoutError, retry, sleep, withTimeout } from './request'
import { describeCollections, findOutputReportId, hasOutputReport, hasReportPair, matchesFilter } from './matchers'
import { WebHidTransport, waitForReport } from './transport'
import { FakeHidDevice } from './testing/fakeHidDevice'

describe('bytes', () => {
  it('concat / padTo / chunk', () => {
    expect(Array.from(concat([1, 2], new Uint8Array([3])))).toEqual([1, 2, 3])
    expect(Array.from(padTo([1, 2], 4))).toEqual([1, 2, 0, 0])
    expect(Array.from(padTo([1, 2, 3, 4, 5], 3))).toEqual([1, 2, 3])
    expect(chunk(new Uint8Array([1, 2, 3, 4, 5]), 2).map((c) => Array.from(c))).toEqual([[1, 2], [3, 4], [5]])
  })
  it('sum8 wraps at 256 and accepts a seed', () => {
    expect(sum8([0xff, 0x02])).toBe(0x01)
    expect(sum8([1, 2, 3], 10)).toBe(16)
  })
  it('16-bit helpers', () => {
    expect(u16be(0x1234)).toEqual([0x12, 0x34])
    expect(u16le(0x1234)).toEqual([0x34, 0x12])
    expect(readU16be([0x12, 0x34], 0)).toBe(0x1234)
    expect(readU16le([0x34, 0x12], 0)).toBe(0x1234)
    expect(hex([0x66, 0x01])).toBe('66 01')
  })
})

describe('request primitives', () => {
  it('withTimeout rejects with TimeoutError', async () => {
    await expect(withTimeout(sleep(50), 5, 'x')).rejects.toBeInstanceOf(TimeoutError)
    await expect(withTimeout(Promise.resolve(7), 5)).resolves.toBe(7)
  })
  it('retry stops after N attempts and honours shouldRetry', async () => {
    let calls = 0
    await expect(
      retry(async () => {
        calls++
        throw new Error('nope')
      }, { attempts: 3 }),
    ).rejects.toThrow('nope')
    expect(calls).toBe(3)
    calls = 0
    await expect(
      retry(async () => {
        calls++
        throw new Error('fatal')
      }, { attempts: 3, shouldRetry: () => false }),
    ).rejects.toThrow('fatal')
    expect(calls).toBe(1)
  })
  it('SerialQueue runs tasks one at a time, even after failures', async () => {
    const q = new SerialQueue()
    const order: string[] = []
    const a = q.run(async () => {
      order.push('a:start')
      await sleep(10)
      order.push('a:end')
      throw new Error('a failed')
    })
    const b = q.run(async () => {
      order.push('b')
      return 2
    })
    await expect(a).rejects.toThrow('a failed')
    await expect(b).resolves.toBe(2)
    expect(order).toEqual(['a:start', 'a:end', 'b'])
    expect(q.size).toBe(0)
  })
})

describe('matchers', () => {
  const device = {
    vendorId: 0x372e,
    productId: 0x10e5,
    collections: [
      { usagePage: 0x01, usage: 0x06, outputReports: [{ reportId: 0 }] },
      { usagePage: 0xff60, usage: 0x61, outputReports: [{ reportId: 0 }] },
    ],
  }
  it('matches VID/PID and usage page on any collection', () => {
    expect(matchesFilter(device, { vendorId: 0x372e, productId: 0x10e5, usagePage: 0xff60, usage: 0x61 })).toBe(true)
    expect(matchesFilter(device, { vendorId: 0x372e, productId: 0x106c })).toBe(false)
    expect(matchesFilter(device, { usagePage: 0xff60, usage: 0x62 })).toBe(false)
  })
  it('finds the output report id of the raw-HID collection', () => {
    expect(findOutputReportId(device, { usagePage: 0xff60, usage: 0x61 })).toBe(0)
    expect(findOutputReportId(device, { usagePage: 0xff61 })).toBeUndefined()
  })
})

describe('mouse interface selection', () => {
  // A Compx mouse: pointer interface, keyboard/consumer interface, vendor interface with report 0x08 (in + out).
  const pointer = { usagePage: 1, usage: 2, inputReports: [{ reportId: 1 }], outputReports: [] }
  const consumer = { usagePage: 1, usage: 6, inputReports: [{ reportId: 2 }, { reportId: 3 }], outputReports: [{ reportId: 2 }] }
  const vendor = { usagePage: 0xff00, usage: 1, inputReports: [{ reportId: 8 }], outputReports: [{ reportId: 8 }] }
  it('picks the interface with one input + one output report 0x08, like Compx HUB', () => {
    expect(hasReportPair({ collections: [pointer] }, 8)).toBe(false)
    expect(hasReportPair({ collections: [consumer] }, 8)).toBe(false)
    expect(hasReportPair({ collections: [vendor] }, 8)).toBe(true)
    expect(hasOutputReport({ collections: [pointer, consumer] }, 8)).toBe(false)
    expect(hasOutputReport({ collections: [vendor] }, 8)).toBe(true)
    expect(describeCollections({ collections: [consumer] })).toBe('0x1/0x6 in[0x02,0x03] out[0x02]')
  })
  it('the transport refuses an interface that cannot carry the report', async () => {
    const fake = Object.assign(new FakeHidDevice('Mouse (pointer interface)'), { collections: [pointer] })
    await expect(WebHidTransport.open(fake, 8)).rejects.toThrow(/no output report 0x08/)
    const ok = Object.assign(new FakeHidDevice('Mouse (vendor interface)'), { collections: [vendor] })
    const t = await WebHidTransport.open(ok, 8)
    expect(t.opened).toBe(true)
    await t.close()
  })
})

describe('WebHidTransport', () => {
  it('opens the device, sends with the fixed report id and streams input reports', async () => {
    const fake = new FakeHidDevice('K98 Pro')
    fake.respond = (_id, data) => [Uint8Array.from([0xaa, data[0]!])]
    const transport = await WebHidTransport.open(fake, 8)
    expect(fake.opened).toBe(true)

    const reply = waitForReport(transport, (r) => (r.data[0] === 0xaa ? r.data[1] : undefined), { timeoutMs: 100 })
    await transport.send(Uint8Array.from([0x42]))
    expect(fake.sent[0]).toEqual({ reportId: 8, data: Uint8Array.from([0x42]) })
    await expect(reply).resolves.toBe(0x42)

    await transport.close()
    expect(fake.opened).toBe(false)
    await expect(transport.send(Uint8Array.from([1]))).rejects.toThrow('not open')
  })
  it('waitForReport times out and unsubscribes', async () => {
    const fake = new FakeHidDevice()
    const transport = await WebHidTransport.open(fake, 0)
    await expect(waitForReport(transport, () => undefined, { timeoutMs: 5 })).rejects.toBeInstanceOf(TimeoutError)
    await transport.close()
  })
})
