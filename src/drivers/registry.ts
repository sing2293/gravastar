/**
 * Known products → HID filters and identification. IDs come from the vendor tools:
 * K98 Pro from GS HUB (docs/reverse-engineering/k98pro/01-transport.md §1), mice from GS HUB's device registry
 * and Compx HUB's live `cfg.json` (docs/reverse-engineering/mouse/01-transport-commands.md §1).
 */
import type { HidFilter } from '@/hid/core/matchers'
import type { LinkType, ProductInfo } from '@/model/device'
import { PID_DONGLE, PID_WIRED, USAGE, USAGE_PAGE, VENDOR_ID as K98_VID } from './k98pro/enums'

export const COMPX_VID = 0x3554

export const K98_PRO: ProductInfo = {
  slug: 'k98-pro',
  kind: 'keyboard',
  displayName: 'K98 Pro',
  vendorId: K98_VID,
  productIds: { wired: [PID_WIRED], dongle: [PID_DONGLE] },
}

/** PIDs overlap between models; the HID product name tells them apart (GS HUB `productNameMatchers`). */
interface MouseModel {
  product: ProductInfo
  nameMatchers: string[]
}

const mouse = (slug: string, displayName: string, dongle: number[], wired: number[], nameMatchers: string[]): MouseModel => ({
  product: { slug, kind: 'mouse', displayName, vendorId: COMPX_VID, productIds: { wired, dongle } },
  nameMatchers,
})

export const MICE: MouseModel[] = [
  mouse('mercury-m1-pro', 'Mercury M1 Pro', [0xf54b, 0xf548], [0xf549], ['M1PRO', 'M1']),
  mouse('mercury-x-pro', 'Mercury X Pro', [0xf54b], [0xf549], ['XPRO']),
  mouse('mercury-m2', 'Mercury M2', [0xf575, 0xf577], [0xf576], ['M2']),
  mouse('mercury-x', 'Mercury X', [0xf575, 0xf577], [0xf576], ['MERCURYX', 'GRAVASTARX']),
]

/** Compx HUB's live config lists these under `pid.mouse`; anything not matched above is a generic Compx mouse. */
export const COMPX_MOUSE_PIDS = { dongle: [0xf54b, 0xf575, 0xf548, 0xf577], wired: [0xf576, 0xf549] }

export const GENERIC_COMPX_MOUSE: ProductInfo = {
  slug: 'compx-mouse',
  kind: 'mouse',
  displayName: 'GravaStar mouse',
  vendorId: COMPX_VID,
  productIds: COMPX_MOUSE_PIDS,
}

export const PRODUCTS: ProductInfo[] = [K98_PRO, ...MICE.map((m) => m.product), GENERIC_COMPX_MOUSE]

/** Filters for `navigator.hid.requestDevice`. */
export const HID_FILTERS: HidFilter[] = [
  { vendorId: K98_VID, productId: PID_WIRED, usagePage: USAGE_PAGE, usage: USAGE },
  { vendorId: K98_VID, productId: PID_DONGLE, usagePage: USAGE_PAGE, usage: USAGE },
  ...[...COMPX_MOUSE_PIDS.dongle, ...COMPX_MOUSE_PIDS.wired].map((productId) => ({ vendorId: COMPX_VID, productId })),
]

export interface Identification {
  product: ProductInfo
  link: LinkType
}

const normalize = (name: string | undefined): string => (name ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase()

export function identify(device: { vendorId: number; productId: number; productName?: string }): Identification | undefined {
  if (device.vendorId === K98_VID) {
    if (K98_PRO.productIds.wired.includes(device.productId)) return { product: K98_PRO, link: 'wired' }
    if (K98_PRO.productIds.dongle.includes(device.productId)) return { product: K98_PRO, link: 'dongle' }
    return undefined
  }
  if (device.vendorId === COMPX_VID) {
    const link: LinkType | undefined = COMPX_MOUSE_PIDS.wired.includes(device.productId) ? 'wired' : COMPX_MOUSE_PIDS.dongle.includes(device.productId) ? 'dongle' : undefined
    if (!link) return undefined
    const name = normalize(device.productName)
    const candidates = MICE.filter((m) => m.product.productIds[link].includes(device.productId))
    const byName = name ? candidates.find((m) => m.nameMatchers.some((n) => name.includes(n))) : undefined
    const model = byName ?? candidates[0]
    return { product: model ? model.product : GENERIC_COMPX_MOUSE, link }
  }
  return undefined
}
