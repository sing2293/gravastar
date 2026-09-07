import type { HidDeviceLike } from '../transport'

type Listener = (event: HIDInputReportEvent) => void

/**
 * In-memory stand-in for `HIDDevice`. Records every output report and lets a test (or a simulator) inject
 * input reports. `respond` can be set to auto-reply to sent reports, which is how `sim/` devices are built.
 */
export class FakeHidDevice implements HidDeviceLike {
  opened = false
  readonly sent: { reportId: number; data: Uint8Array }[] = []
  private readonly listeners = new Set<Listener>()
  /** Optional auto-responder: return input report payloads to deliver after a send. */
  respond?: (reportId: number, data: Uint8Array) => Uint8Array[] | Promise<Uint8Array[]>

  constructor(
    readonly productName = 'Fake device',
    readonly vendorId = 0x1234,
    readonly productId = 0x5678,
    readonly inputReportId = 0,
  ) {}

  async open(): Promise<void> {
    this.opened = true
  }

  async close(): Promise<void> {
    this.opened = false
  }

  async sendReport(reportId: number, data: BufferSource): Promise<void> {
    if (!this.opened) throw new DOMException('Device not opened', 'InvalidStateError')
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    this.sent.push({ reportId, data: Uint8Array.from(bytes) })
    if (this.respond) {
      const replies = await this.respond(reportId, bytes)
      // Deliver asynchronously, like the real event loop would.
      queueMicrotask(() => replies.forEach((r) => this.dispatchInputReport(r)))
    }
  }

  addEventListener(_type: 'inputreport', listener: Listener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'inputreport', listener: Listener): void {
    this.listeners.delete(listener)
  }

  /** Injects an input report as if the device had sent it. */
  dispatchInputReport(data: Uint8Array, reportId = this.inputReportId): void {
    const event = { reportId, data: new DataView(data.buffer, data.byteOffset, data.byteLength), device: this } as unknown as HIDInputReportEvent
    for (const listener of this.listeners) listener(event)
  }

  lastSent(): Uint8Array | undefined {
    return this.sent[this.sent.length - 1]?.data
  }
}
