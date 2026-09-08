import { describe, expect, it } from 'vitest'
import { COMPX_VID, HID_FILTERS, identify, isControlInterface } from './registry'

describe('registry', () => {
  const mouse = { vendorId: COMPX_VID, productId: 0xf54b, productName: 'Mercury M1 Pro' }
  it('identifies a Compx mouse by PID and name', () => {
    const ident = identify(mouse)!
    expect(ident.link).toBe('dongle')
    expect(ident.product.slug).toBe('mercury-m1-pro')
    expect(HID_FILTERS.some((f) => f.vendorId === COMPX_VID && f.productId === 0xf54b)).toBe(true)
  })
  it('accepts only the interface carrying report 0x08 for a mouse', () => {
    const ident = identify(mouse)!
    const pointer = { usagePage: 1, usage: 2, inputReports: [{ reportId: 1 }], outputReports: [] }
    const vendor = { usagePage: 0xff00, usage: 1, inputReports: [{ reportId: 8 }], outputReports: [{ reportId: 8 }] }
    expect(isControlInterface({ collections: [pointer] }, ident)).toBe(false)
    expect(isControlInterface({ collections: [vendor] }, ident)).toBe(true)
    expect(isControlInterface({ collections: [pointer, vendor] }, ident)).toBe(true)
    expect(isControlInterface({}, ident)).toBe(true) // fakes without descriptors
  })
  it('accepts only the raw-HID collection for the K98 Pro', () => {
    const ident = identify({ vendorId: 0x372e, productId: 0x10e5 })!
    expect(isControlInterface({ collections: [{ usagePage: 1, usage: 6, inputReports: [{ reportId: 0 }], outputReports: [{ reportId: 0 }] }] }, ident)).toBe(false)
    expect(isControlInterface({ collections: [{ usagePage: 0xff60, usage: 0x61, inputReports: [{ reportId: 0 }], outputReports: [{ reportId: 0 }] }] }, ident)).toBe(true)
  })
})
