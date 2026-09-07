/** Device selection: which HID interface (collection) and which output report ID a driver should use. */

export interface HidFilter {
  vendorId?: number
  productId?: number
  usagePage?: number
  usage?: number
}

type CollectionLike = Pick<HIDCollectionInfo, 'usagePage' | 'usage'> & {
  outputReports?: ReadonlyArray<Pick<HIDReportInfo, 'reportId'>>
  inputReports?: ReadonlyArray<Pick<HIDReportInfo, 'reportId'>>
}

export interface DeviceLike {
  vendorId: number
  productId: number
  collections: ReadonlyArray<CollectionLike>
}

function collectionMatches(c: CollectionLike, f: HidFilter): boolean {
  return (f.usagePage === undefined || c.usagePage === f.usagePage) && (f.usage === undefined || c.usage === f.usage)
}

/** Same semantics as `navigator.hid.requestDevice` filters: VID/PID on the device, usage page/usage on any collection. */
export function matchesFilter(device: DeviceLike, filter: HidFilter): boolean {
  if (filter.vendorId !== undefined && device.vendorId !== filter.vendorId) return false
  if (filter.productId !== undefined && device.productId !== filter.productId) return false
  if (filter.usagePage === undefined && filter.usage === undefined) return true
  return device.collections.some((c) => collectionMatches(c, filter))
}

export function matchesAny(device: DeviceLike, filters: readonly HidFilter[]): boolean {
  return filters.some((f) => matchesFilter(device, f))
}

/**
 * Report ID of the first output report in the collection matching `usagePage`/`usage`.
 * Returns 0 when the collection has un-numbered reports, `undefined` when there is no such collection.
 */
export function findOutputReportId(device: DeviceLike, filter: Pick<HidFilter, 'usagePage' | 'usage'>): number | undefined {
  for (const c of device.collections) {
    if (!collectionMatches(c, filter)) continue
    const first = c.outputReports?.[0]
    return first ? (first.reportId ?? 0) : 0
  }
  return undefined
}

export function hidSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator
}

/** Shows the browser's device picker (must be called from a user gesture). */
export async function requestDevices(filters: readonly HidFilter[]): Promise<HIDDevice[]> {
  if (!hidSupported()) throw new Error('WebHID is not available in this browser')
  return navigator.hid.requestDevice({ filters: filters.map((f) => ({ ...f })) })
}

/** Devices the user already authorized in a previous session. */
export async function getAuthorizedDevices(filters: readonly HidFilter[]): Promise<HIDDevice[]> {
  if (!hidSupported()) return []
  const devices = await navigator.hid.getDevices()
  return devices.filter((d) => matchesAny(d, filters))
}

export type HidConnectionEvent = { type: 'connect' | 'disconnect'; device: HIDDevice }

export function onHidConnectionChange(listener: (event: HidConnectionEvent) => void): () => void {
  if (!hidSupported()) return () => undefined
  const onConnect = (e: HIDConnectionEvent) => listener({ type: 'connect', device: e.device })
  const onDisconnect = (e: HIDConnectionEvent) => listener({ type: 'disconnect', device: e.device })
  navigator.hid.addEventListener('connect', onConnect)
  navigator.hid.addEventListener('disconnect', onDisconnect)
  return () => {
    navigator.hid.removeEventListener('connect', onConnect)
    navigator.hid.removeEventListener('disconnect', onDisconnect)
  }
}
