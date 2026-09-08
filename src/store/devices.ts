/**
 * Device store: authorized/connected devices, their drivers, and the WebHID lifecycle.
 * Drivers are kept in a module-level map (they hold sockets and timers, not state to render).
 * Every connected device is also registered with the music engine as a lighting sink, and unregistered when it
 * goes away, so the Music Sync page never has to create sinks itself.
 */
import { create } from 'zustand'
import { musicEngine } from '@/audio/musicSync'
import { KeyboardSink } from '@/audio/sinks/keyboardSink'
import { MouseSink } from '@/audio/sinks/mouseSink'
import { getAuthorizedDevices, hidSupported, onHidConnectionChange, requestDevices } from '@/hid/core/matchers'
import { CompxMouseDriver } from '@/drivers/compx/driver'
import { K98ProDriver } from '@/drivers/k98pro/driver'
import { HID_FILTERS, K98_PRO, MICE, identify } from '@/drivers/registry'
import type { BatteryStatus, DeviceSummary, ProductInfo } from '@/model/device'
import type { KeyboardDriver } from '@/model/keyboard'
import type { MouseDriver } from '@/model/mouse'

export type AnyDriver = KeyboardDriver | MouseDriver

const drivers = new Map<string, AnyDriver>()
const hidDevices = new Map<string, HIDDevice>()

export function getDriver(id: string): AnyDriver | undefined {
  return drivers.get(id)
}

export function getKeyboardDriver(id: string): KeyboardDriver | undefined {
  const d = drivers.get(id)
  return d?.kind === 'keyboard' ? d : undefined
}

export function getMouseDriver(id: string): MouseDriver | undefined {
  const d = drivers.get(id)
  return d?.kind === 'mouse' ? d : undefined
}

function deviceId(d: HIDDevice, product: ProductInfo): string {
  return `${product.slug}:${d.vendorId.toString(16)}:${d.productId.toString(16)}`
}

/**
 * Registers `driver` with the music engine. A keyboard sink needs the layout, so the capabilities are read first;
 * if the driver was replaced or dropped meanwhile (reconnect race) nothing is added. `addSink` releases a previous
 * sink with the same id, so a reconnect never leaves two sinks for one device.
 */
async function registerSink(id: string, driver: AnyDriver, label: string): Promise<void> {
  try {
    const sink =
      driver.kind === 'keyboard'
        ? new KeyboardSink(id, label, driver, (await driver.capabilities()).layout)
        : new MouseSink(id, label, driver)
    if (drivers.get(id) !== driver) return
    musicEngine.addSink(sink)
  } catch {
    /* a device that cannot report its layout is still usable for everything else */
  }
}

/** Restores the device's own lighting while its transport is still open, then drops the sink. */
async function unregisterSink(id: string): Promise<void> {
  const sink = musicEngine.getSink(id)
  if (!sink) return
  if (musicEngine.getStatus().running) await sink.release().catch(() => undefined)
  musicEngine.removeSink(id)
}

interface DevicesState {
  devices: Record<string, DeviceSummary>
  order: string[]
  busy: boolean
  error?: string
  hidSupported: boolean
  init(): Promise<void>
  requestDevice(): Promise<string | undefined>
  connect(id: string): Promise<void>
  disconnect(id: string): Promise<void>
  forget(id: string): Promise<void>
  addSimulated(kind: 'keyboard' | 'mouse', link?: 'wired' | 'dongle'): Promise<string>
  patch(id: string, patch: Partial<DeviceSummary>): void
}

let initialized = false

export const useDevices = create<DevicesState>((set, get) => ({
  devices: {},
  order: [],
  busy: false,
  hidSupported: hidSupported(),

  patch(id, patch) {
    set((s) => (s.devices[id] ? { devices: { ...s.devices, [id]: { ...s.devices[id]!, ...patch } } } : s))
  },

  async init() {
    if (initialized) return
    initialized = true
    if (!hidSupported()) return
    const authorized = await getAuthorizedDevices(HID_FILTERS)
    for (const d of authorized) register(d, set)
    onHidConnectionChange(({ type, device }) => {
      const ident = identify(device)
      if (!ident) return
      const id = deviceId(device, ident.product)
      if (type === 'connect') {
        register(device, set)
        void get().connect(id)
      } else if (get().devices[id]) {
        // The transport is already gone: no restore possible, just drop the sink.
        musicEngine.removeSink(id)
        drivers.get(id)?.disconnect().catch(() => undefined)
        drivers.delete(id)
        get().patch(id, { state: 'disconnected', battery: undefined })
      }
    })
    for (const id of get().order) void get().connect(id)
  },

  async requestDevice() {
    set({ error: undefined })
    try {
      const picked = await requestDevices(HID_FILTERS)
      let last: string | undefined
      for (const d of picked) {
        const id = register(d, set)
        if (id) {
          last = id
          await get().connect(id)
        }
      }
      return last
    } catch (error) {
      set({ error: (error as Error).message })
      return undefined
    }
  },

  async connect(id) {
    const summary = get().devices[id]
    if (!summary || summary.state === 'connecting' || summary.state === 'connected') return
    const hid = hidDevices.get(id)
    if (!hid) return
    get().patch(id, { state: 'connecting', error: undefined })
    try {
      const existing = drivers.get(id)
      if (existing) {
        await unregisterSink(id)
        await existing.disconnect().catch(() => undefined)
      }
      const driver: AnyDriver = summary.kind === 'keyboard' ? await K98ProDriver.open(hid) : await CompxMouseDriver.open(hid, summary.link)
      drivers.set(id, driver)
      await driver.connect()
      const [info, battery] = await Promise.all([driver.info(), driver.battery().catch(() => undefined)])
      driver.on('battery', (b: BatteryStatus) => get().patch(id, { battery: b }))
      driver.on('disconnected', () => {
        musicEngine.removeSink(id)
        get().patch(id, { state: 'disconnected' })
      })
      get().patch(id, { state: 'connected', info, battery })
      await registerSink(id, driver, summary.product.displayName)
    } catch (error) {
      drivers.delete(id)
      get().patch(id, { state: 'error', error: (error as Error).message })
    }
  },

  async disconnect(id) {
    await unregisterSink(id)
    const d = drivers.get(id)
    drivers.delete(id)
    if (d) await d.disconnect().catch(() => undefined)
    get().patch(id, { state: 'authorized', battery: undefined })
  },

  async forget(id) {
    await get().disconnect(id)
    const hid = hidDevices.get(id)
    hidDevices.delete(id)
    if (hid && 'forget' in hid && typeof hid.forget === 'function') await hid.forget().catch(() => undefined)
    set((s) => {
      const devices = { ...s.devices }
      delete devices[id]
      return { devices, order: s.order.filter((x) => x !== id) }
    })
  },

  async addSimulated(kind, link = 'wired') {
    const id = `sim-${kind}-${link}`
    if (get().devices[id]) return id
    const product = kind === 'keyboard' ? K98_PRO : MICE[0]!.product
    const summary: DeviceSummary = {
      id,
      product,
      kind,
      link,
      state: 'connecting',
      identity: { vendorId: product.vendorId, productId: product.productIds[link][0] ?? 0, productName: `${product.displayName} (simulated)` },
    }
    set((s) => ({ devices: { ...s.devices, [id]: summary }, order: [...s.order, id] }))
    const driver: AnyDriver = kind === 'keyboard' ? await (await import('@/sim/k98pro/device')).createSimK98Pro({ link }).openDriver() : await (await import('@/sim/compx/device')).createSimCompxMouse({ link }).openDriver()
    drivers.set(id, driver)
    const [info, battery] = await Promise.all([driver.info(), driver.battery().catch(() => undefined)])
    driver.on('battery', (b: BatteryStatus) => get().patch(id, { battery: b }))
    get().patch(id, { state: 'connected', info, battery })
    await registerSink(id, driver, product.displayName)
    return id
  },
}))

function register(d: HIDDevice, set: (fn: (s: DevicesState) => Partial<DevicesState>) => void): string | undefined {
  const ident = identify(d)
  if (!ident) return undefined
  const id = deviceId(d, ident.product)
  hidDevices.set(id, d)
  set((s) => {
    if (s.devices[id]) return { devices: { ...s.devices, [id]: { ...s.devices[id]!, state: s.devices[id]!.state === 'disconnected' ? 'authorized' : s.devices[id]!.state } } }
    const summary: DeviceSummary = {
      id,
      product: ident.product,
      kind: ident.product.kind,
      link: ident.link,
      state: 'authorized',
      identity: { vendorId: d.vendorId, productId: d.productId, productName: d.productName },
    }
    return { devices: { ...s.devices, [id]: summary }, order: [...s.order, id] }
  })
  return id
}
