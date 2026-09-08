/**
 * K98 Pro `KeyboardDriver`: composes the services over one link and turns device pushes into typed events.
 * Session bring-up mirrors the vendor manager (`M3`): read UUID + firmware, then battery.
 */
import { Emitter } from '@/hid/core/emitter'
import { findOutputReportId, type DeviceLike } from '@/hid/core/matchers'
import { WebHidTransport, type HidDeviceLike, type Transport } from '@/hid/core/transport'
import type { BatteryStatus, DeviceInfo, LinkType } from '@/model/device'
import type { KeyboardCapabilities, KeyboardDriver, KeyboardEvents, LayerSelector, LayoutVariant, ResetScope } from '@/model/keyboard'
import { K98AdvancedKeys } from './advancedKeys'
import { parseBubble } from './bubbles'
import { K98Config, type DeviceUuid, type FirmwareVersion } from './config'
import { K98Display } from './display'
import { PID_DONGLE, USAGE, USAGE_PAGE } from './enums'
import { k98Actions } from './keycodes'
import { K98Keymap, K98Profiles, PROFILE_COUNT } from './keymap'
import { LAYOUTS, variantForUuid } from './layout'
import { K98Lighting } from './lighting'
import { K98Macros } from './macros'
import { K98Performance } from './performance'
import { DONGLE_LINK, FramedTransport, K98Link, WIRED_LINK } from './transport'

export interface K98ProSession {
  uuid: DeviceUuid
  firmware: FirmwareVersion
  layoutVariant: LayoutVariant
}

export class K98ProDriver implements KeyboardDriver {
  readonly kind = 'keyboard' as const
  readonly actions = k98Actions
  readonly config: K98Config
  readonly keymap: K98Keymap
  readonly lighting: K98Lighting
  readonly profiles: K98Profiles
  readonly macros: K98Macros
  readonly performance: K98Performance
  readonly advancedKeys: K98AdvancedKeys
  readonly display: K98Display
  private readonly emitter = new Emitter<KeyboardEvents>()
  private session: K98ProSession | undefined
  private unsubscribeBubbles: (() => void) | undefined

  constructor(
    readonly hid: K98Link,
    readonly link: LinkType,
  ) {
    this.config = new K98Config(hid)
    this.keymap = new K98Keymap(hid)
    this.lighting = new K98Lighting(hid, this.config, link)
    this.profiles = new K98Profiles(hid)
    this.macros = new K98Macros(hid)
    this.performance = new K98Performance(hid, this.config)
    this.advancedKeys = new K98AdvancedKeys(hid, this.config)
    this.display = new K98Display(hid)
  }

  /** Link type from the HID product id: the 2.4 GHz receiver enumerates as PID 0x106C. */
  static linkTypeFor(productId: number): LinkType {
    return productId === PID_DONGLE ? 'dongle' : 'wired'
  }

  /** Opens a WebHID device, choosing the raw-HID collection's output report id and the framed transport on the dongle. */
  static async open(device: HidDeviceLike & DeviceLike): Promise<K98ProDriver> {
    const reportId = findOutputReportId(device, { usagePage: USAGE_PAGE, usage: USAGE }) ?? findOutputReportId(device, {}) ?? 0
    const link = K98ProDriver.linkTypeFor(device.productId)
    const raw = await WebHidTransport.open(device, reportId)
    return K98ProDriver.fromTransport(raw, link)
  }

  static fromTransport(transport: Transport, link: LinkType): K98ProDriver {
    const framed = link === 'dongle' ? new FramedTransport(transport) : transport
    return new K98ProDriver(new K98Link(framed, link === 'dongle' ? DONGLE_LINK : WIRED_LINK), link)
  }

  on: KeyboardDriver['on'] = (event, listener) => this.emitter.on(event, listener)

  get current(): K98ProSession | undefined {
    return this.session
  }

  async connect(): Promise<void> {
    this.unsubscribeBubbles?.()
    this.unsubscribeBubbles = this.hid.onBubble((packet) => {
      const ev = parseBubble(packet)
      if (!ev) return
      switch (ev.type) {
        case 'battery':
          return this.emitter.emit('battery', ev.status)
        case 'dongle-link':
          return this.emitter.emit('dongle-link', ev.connected)
        case 'os-change':
          return this.emitter.emit('os-change', ev.os)
        case 'profile-change':
          return this.emitter.emit('profile-change', ev.profile)
        case 'lighting-change':
          return this.emitter.emit('lighting-change', ev.change)
        case 'travel':
          return this.emitter.emit('travel', ev.samples)
        case 'calibration':
          return this.emitter.emit('calibration', ev.samples)
      }
    })
    const uuid = await this.config.getUuid()
    const firmware = await this.config.getFirmwareVersion()
    this.session = { uuid, firmware, layoutVariant: variantForUuid(uuid.hex) }
  }

  async disconnect(): Promise<void> {
    this.performance.destroy()
    this.unsubscribeBubbles?.()
    this.unsubscribeBubbles = undefined
    this.emitter.emit('disconnected', undefined)
    this.emitter.clear()
    await this.hid.close()
  }

  async info(): Promise<DeviceInfo> {
    if (!this.session) await this.connect()
    const s = this.session!
    return { firmwareVersion: `V${s.firmware.text}`, uniqueId: s.uuid.hex }
  }

  battery(): Promise<BatteryStatus | undefined> {
    return this.config.battery()
  }

  async capabilities(): Promise<KeyboardCapabilities> {
    if (!this.session) await this.connect()
    const features = await this.config.features()
    return { layout: LAYOUTS[this.session!.layoutVariant], layers: [0, 1, 2], osModes: ['windows', 'macos'], profiles: PROFILE_COUNT, features }
  }

  get settings(): K98Config {
    return this.config
  }

  reset(scope: ResetScope, sel?: LayerSelector): Promise<void> {
    return this.config.reset(scope, sel)
  }
}
