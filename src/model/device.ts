/**
 * Device-agnostic contracts. The UI renders from these; drivers implement them.
 * Nothing in this folder may import from `drivers/`.
 */

export type DeviceKind = 'keyboard' | 'mouse'

/** How the device is attached: USB cable, or the 2.4 GHz receiver ("dongle"). */
export type LinkType = 'wired' | 'dongle'

export type ConnectionState = 'authorized' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface ProductInfo {
  /** Stable slug, e.g. `k98-pro`, `mercury-m1-pro`. */
  slug: string
  kind: DeviceKind
  displayName: string
  vendorId: number
  /** HID product IDs per link type. A PID may appear under both when the device does not distinguish. */
  productIds: { wired: number[]; dongle: number[] }
  /** Path of the product image in `public/`, if we have one. */
  image?: string
}

export interface DeviceIdentity {
  vendorId: number
  productId: number
  productName: string
}

export interface BatteryStatus {
  /** 0–100. */
  level: number
  charging: boolean
  full?: boolean
  voltageMv?: number
}

export interface DeviceInfo {
  firmwareVersion?: string
  /** Vendor-specific unique id (K98 Pro: 48-bit UUID as `0x…`; Compx: 3-byte address). */
  uniqueId?: string
  dongleFirmwareVersion?: string
}

export interface DeviceSummary {
  /** Session-unique id. */
  id: string
  product: ProductInfo
  kind: DeviceKind
  link: LinkType
  state: ConnectionState
  identity: DeviceIdentity
  info?: DeviceInfo
  battery?: BatteryStatus
  error?: string
}

export type Unsubscribe = () => void

/** Typed event subscription shared by every driver. */
export interface EventSource<Events extends Record<string, unknown>> {
  on<K extends keyof Events & string>(event: K, listener: (payload: Events[K]) => void): Unsubscribe
}

export interface CommonEvents extends Record<string, unknown> {
  /** Battery changed (device push or poll). */
  battery: BatteryStatus
  /** Dongle link to the peripheral came up / went down (dongle link only). */
  'dongle-link': boolean
  /** Transport lost; the driver is unusable until reconnected. */
  disconnected: undefined
}

/** Base surface every driver exposes; kind-specific services are declared in `keyboard.ts` / `mouse.ts`. */
export interface DriverBase<Events extends CommonEvents> extends EventSource<Events> {
  readonly kind: DeviceKind
  readonly link: LinkType
  /** Opens the transport and performs the vendor handshake; resolves once commands can be sent. */
  connect(): Promise<void>
  disconnect(): Promise<void>
  info(): Promise<DeviceInfo>
  /** `undefined` when the device does not report a battery (e.g. wired keyboard without one). */
  battery(): Promise<BatteryStatus | undefined>
}

export interface RGB {
  r: number
  g: number
  b: number
}

/** Standard HID modifier keys, left/right. */
export type Modifier = 'lctrl' | 'lshift' | 'lalt' | 'lgui' | 'rctrl' | 'rshift' | 'ralt' | 'rgui'
export const MODIFIERS: readonly Modifier[] = ['lctrl', 'lshift', 'lalt', 'lgui', 'rctrl', 'rshift', 'ralt', 'rgui']

/** A range the UI can build a slider from. */
export interface NumericRange {
  min: number
  max: number
  step: number
  unit?: string
}

/** Marks a value the UI should present as experimental (protocol not yet validated on hardware). */
export interface Experimental {
  experimental?: true
}
