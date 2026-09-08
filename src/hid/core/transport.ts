import { describeCollections, hasOutputReport, type CollectionLike } from './matchers'
import { deferred, withTimeout } from './request'
import { toBytes } from './bytes'

export interface InputReport {
  reportId: number
  data: Uint8Array
}

export type InputReportListener = (report: InputReport) => void

/**
 * The only thing drivers talk to. Sends output reports with a fixed report ID and streams input reports.
 * `WebHidTransport` is the real one; `sim/` and tests provide in-memory implementations.
 */
export interface Transport {
  readonly reportId: number
  readonly opened: boolean
  /** Sends one output report (the report ID is prepended by the transport, not included in `bytes`). */
  send(bytes: Uint8Array): Promise<void>
  /** Subscribes to input reports; returns an unsubscribe function. */
  onInputReport(listener: InputReportListener): () => void
  /** Optional: sends an output report on a different report ID (some vendor paths use a second report). */
  sendWithReportId?(reportId: number, bytes: Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface WaitOptions {
  timeoutMs: number
  label?: string
}

/**
 * Resolves with the first input report for which `match` returns a value other than `undefined`.
 * Subscribe *before* sending the request so a fast reply cannot be missed.
 */
export function waitForReport<T>(
  transport: Transport,
  match: (report: InputReport) => T | undefined,
  options: WaitOptions,
): Promise<T> {
  const result = deferred<T>()
  const unsubscribe = transport.onInputReport((report) => {
    const value = match(report)
    if (value !== undefined) result.resolve(value)
  })
  return withTimeout(result.promise, options.timeoutMs, options.label ?? 'waiting for device response').finally(
    unsubscribe,
  )
}

/** Minimal surface of `HIDDevice` the transport needs — lets tests pass a fake without the whole DOM type. */
export interface HidDeviceLike {
  readonly opened: boolean
  readonly productName: string
  readonly vendorId: number
  readonly productId: number
  /** Report descriptor summary (real `HIDDevice`s always have it; fakes may omit it). */
  readonly collections?: ReadonlyArray<CollectionLike>
  open(): Promise<void>
  close(): Promise<void>
  sendReport(reportId: number, data: BufferSource): Promise<void>
  addEventListener(type: 'inputreport', listener: (event: HIDInputReportEvent) => void): void
  removeEventListener(type: 'inputreport', listener: (event: HIDInputReportEvent) => void): void
}

export class WebHidTransport implements Transport {
  private readonly listeners = new Set<InputReportListener>()
  private readonly onEvent = (event: HIDInputReportEvent) => {
    const report: InputReport = { reportId: event.reportId, data: toBytes(event.data) }
    for (const listener of this.listeners) {
      try {
        listener(report)
      } catch (error) {
        console.error('input report listener failed', error)
      }
    }
  }

  private constructor(
    readonly device: HidDeviceLike,
    readonly reportId: number,
  ) {
    device.addEventListener('inputreport', this.onEvent)
  }

  /**
   * Opens the device if needed and attaches the input-report listener. Refuses an interface that does not declare
   * output report `reportId` — Chrome would otherwise fail every write with the unhelpful "Failed to write the report".
   */
  static async open(device: HidDeviceLike, reportId: number): Promise<WebHidTransport> {
    if (device.collections && !hasOutputReport({ collections: device.collections }, reportId)) {
      throw new Error(`${device.productName}: this HID interface has no output report 0x${reportId.toString(16).padStart(2, '0')} (collections: ${describeCollections({ collections: device.collections }) || 'none'})`)
    }
    if (!device.opened) await device.open()
    return new WebHidTransport(device, reportId)
  }

  get opened(): boolean {
    return this.device.opened
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (!this.device.opened) throw new Error(`${this.device.productName}: device is not open`)
    // Copy into a plain ArrayBuffer-backed view: TS 7's BufferSource rejects views over SharedArrayBuffer.
    await this.device.sendReport(this.reportId, Uint8Array.from(bytes))
  }

  onInputReport(listener: InputReportListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async sendWithReportId(reportId: number, bytes: Uint8Array): Promise<void> {
    if (!this.device.opened) throw new Error(`${this.device.productName}: device is not open`)
    await this.device.sendReport(reportId, Uint8Array.from(bytes))
  }

  async close(): Promise<void> {
    this.device.removeEventListener('inputreport', this.onEvent)
    this.listeners.clear()
    if (this.device.opened) await this.device.close()
  }
}
