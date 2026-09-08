/**
 * A complete simulated K98 Pro: fake HID device + firmware model with every service installed.
 * Used by tests and by the UI's `?sim=1` mode so the whole app runs without hardware.
 */
import { FakeHidDevice } from '@/hid/core/testing/fakeHidDevice'
import { WebHidTransport } from '@/hid/core/transport'
import { K98ProDriver } from '@/drivers/k98pro/driver'
import { PID_DONGLE, PID_WIRED, VENDOR_ID } from '@/drivers/k98pro/enums'
import { LAYOUTS } from '@/drivers/k98pro/layout'
import type { LinkType } from '@/model/device'
import type { LayoutVariant } from '@/model/keyboard'
import { DisplaySimState, installDisplaySim } from './displaySim'
import { K98ProFirmware, type SimOptions } from './firmware'
import { KeymapSimState, installKeymapSim } from './keymapSim'
import { LightingSimState, installLightingSim } from './lightingSim'
import { PerformanceSimState, installPerformanceSim } from './performanceSim'

export interface SimK98Pro {
  device: FakeHidDevice
  firmware: K98ProFirmware
  keymap: KeymapSimState
  performance: PerformanceSimState
  lighting: LightingSimState
  display: DisplaySimState
  link: LinkType
  /** Opens a driver over the simulated device (wired unless `link: 'dongle'`). */
  openDriver(): Promise<K98ProDriver>
}

export interface SimK98ProOptions extends SimOptions {
  link?: LinkType
  variant?: LayoutVariant
}

const VARIANT_UUID: Record<LayoutVariant, bigint> = { us: 0x14000000000cn, uk: 0x14000000000en, jp: 0x14000000000fn }

export function createSimK98Pro(options: SimK98ProOptions = {}): SimK98Pro {
  const link = options.link ?? 'wired'
  const variant = options.variant ?? 'us'
  const device = new FakeHidDevice('K98 Pro', VENDOR_ID, link === 'dongle' ? PID_DONGLE : PID_WIRED, options.reportId ?? 0)
  const firmware = new K98ProFirmware({ ...options, uuid: options.uuid ?? VARIANT_UUID[variant] }).attach(device)
  const defaults = new Map(LAYOUTS[variant].keys.map((k) => [k.id, k.defaultKeycode]))
  const keymap = installKeymapSim(firmware, new KeymapSimState(defaults))
  const performance = installPerformanceSim(firmware)
  const lighting = installLightingSim(firmware)
  const display = installDisplaySim(firmware)
  if (link === 'dongle') attachDongleFraming(device, firmware)
  return {
    device,
    firmware,
    keymap,
    performance,
    lighting,
    display,
    link,
    async openDriver() {
      const transport = await WebHidTransport.open(device, device.inputReportId)
      const driver = K98ProDriver.fromTransport(transport, link)
      await driver.connect()
      return driver
    },
  }
}

/** Makes the fake device speak the 0x66 framing (ACK every frame, reassemble, answer with framed replies). */
function attachDongleFraming(device: FakeHidDevice, firmware: K98ProFirmware): void {
  // Lazy import to keep the wired path free of framing code.
  void import('@/drivers/k98pro/frames').then(({ buildAckFrame, buildFrame, isAckFrame, parseFrame }) => {
    let received: Uint8Array[] = []
    let sync = 0
    device.respond = (_reportId, data) => {
      if (data[0] !== 0x66 || isAckFrame(data)) return []
      const f = parseFrame(data)
      const out: Uint8Array[] = [buildAckFrame(data)]
      if (f.current === 1) received = []
      received.push(Uint8Array.from(f.data))
      if (f.current === f.total) {
        const payload = new Uint8Array(received.reduce((n, c) => n + c.length, 0))
        let o = 0
        for (const c of received) {
          payload.set(c, o)
          o += c.length
        }
        for (const reply of firmware.handle(payload.subarray(1, 64))) {
          const parts: Uint8Array[] = []
          for (let i = 0; i < reply.length; i += 14) parts.push(reply.subarray(i, i + 14))
          parts.forEach((p, i) => {
            sync = (sync + 1) & 7
            out.push(buildFrame(parts.length, i + 1, p, sync))
          })
        }
      }
      return out
    }
  })
}
