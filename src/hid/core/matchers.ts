/** Device selection: which HID interface (collection) and which output report ID a driver should use. */

export interface HidFilter {
  vendorId?: number
  productId?: number
  usagePage?: number
  usage?: number
}

export type CollectionLike = Pick<HIDCollectionInfo, 'usagePage' | 'usage'> & {
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

/**
 * Compx HUB's interface rule (HIDHandle.js `Request_Device`): a mouse exposes several HID interfaces (pointer,
 * keyboard/consumer, vendor) and `requestDevice` returns one `HIDDevice` per interface; the configurable one is the
 * interface with a top-level collection that has exactly one input and one output report, the output being
 * `reportId`. Writing to any other interface fails with "Failed to write the report".
 */
export function hasReportPair(device: Pick<DeviceLike, 'collections'>, reportId: number): boolean {
  return device.collections.some((c) => c.inputReports?.length === 1 && c.outputReports?.length === 1 && (c.outputReports[0]!.reportId ?? 0) === reportId)
}

/** Whether any collection declares an output report with this id (0 = un-numbered). */
export function hasOutputReport(device: Pick<DeviceLike, 'collections'>, reportId: number): boolean {
  return device.collections.some((c) => (c.outputReports ?? []).some((r) => (r.reportId ?? 0) === reportId))
}

/** One line per collection, for error messages: `usagePage/usage in[ids] out[ids]`. */
export function describeCollections(device: Pick<DeviceLike, 'collections'>): string {
  const ids = (list?: ReadonlyArray<Pick<HIDReportInfo, 'reportId'>>) => (list ?? []).map((r) => `0x${(r.reportId ?? 0).toString(16).padStart(2, '0')}`).join(',')
  return device.collections.map((c) => `0x${(c.usagePage ?? 0).toString(16)}/0x${(c.usage ?? 0).toString(16)} in[${ids(c.inputReports)}] out[${ids(c.outputReports)}]`).join('; ')
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
