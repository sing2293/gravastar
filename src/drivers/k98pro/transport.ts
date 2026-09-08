/**
 * K98 Pro link layer: request/response over a `Transport`, plus the dongle framing.
 * Mirrors the vendor classes `Mo` (wired queue), `n3` (framing) and `r3` (framed queue) — see
 * docs/reverse-engineering/k98pro/01-transport.md and 02-commands-config.md §6–§7.
 */
import { concat, hex } from '@/hid/core/bytes'
import { SerialQueue, TimeoutError, deferred, retry, withTimeout, type Deferred } from '@/hid/core/request'
import type { InputReport, InputReportListener, Transport } from '@/hid/core/transport'
import type { Unsubscribe } from '@/model/device'
import { PACKET_SIZE, isBubble, isResponseTo } from './codec'
import { FRAME_HEADER, buildAckFrame, buildFrame, frameKey, isAckFrame, isValidDataFrame, parseFrame, splitPayload } from './frames'

export interface LinkOptions {
  /** Time to wait for the header-matched reply of one packet. */
  timeoutMs: number
  /** Extra attempts after the first (vendor: wired 1, dongle 3). */
  retries: number
}

export const WIRED_LINK: LinkOptions = { timeoutMs: 1000, retries: 1 }
export const DONGLE_LINK: LinkOptions = { timeoutMs: 2000, retries: 3 }

export interface RequestOptions {
  timeoutMs?: number
  retries?: number
  /** Called with `(packetsDone / packetsTotal)` after every reply. */
  onProgress?: (fraction: number) => void
}

export type PacketListener = (packet: Uint8Array) => void

/**
 * Sends 63-byte command packets one at a time and pairs each with the reply whose bytes 0/1/3/4 echo the request.
 * Device-initiated ("bubble") packets never match a request; they are handed to `onBubble` listeners instead.
 */
export class K98Link {
  private readonly queue = new SerialQueue()
  private readonly bubbleListeners = new Set<PacketListener>()
  private readonly unsubscribe: Unsubscribe

  constructor(
    readonly transport: Transport,
    readonly options: LinkOptions = WIRED_LINK,
  ) {
    this.unsubscribe = transport.onInputReport((report) => {
      if (!isBubble(report.data)) return
      for (const listener of this.bubbleListeners) listener(report.data)
    })
  }

  get reportId(): number {
    return this.transport.reportId
  }

  onBubble(listener: PacketListener): Unsubscribe {
    this.bubbleListeners.add(listener)
    return () => this.bubbleListeners.delete(listener)
  }

  /** Sends every packet in order, awaiting one reply per packet; resolves with the replies in the same order. */
  async request(packets: Uint8Array[], opts: RequestOptions = {}): Promise<Uint8Array[]> {
    const timeoutMs = opts.timeoutMs ?? this.options.timeoutMs
    const attempts = (opts.retries ?? this.options.retries) + 1
    const replies: Uint8Array[] = []
    for (let i = 0; i < packets.length; i++) {
      const packet = packets[i]!
      const reply = await this.queue.run(() =>
        retry(() => this.exchange(packet, timeoutMs), {
          attempts,
          shouldRetry: (error) => error instanceof TimeoutError || error instanceof SendError,
        }),
      )
      replies.push(reply)
      opts.onProgress?.((i + 1) / packets.length)
    }
    return replies
  }

  /** Fire-and-forget (vendor `sendCommand`): no reply is awaited, used for real-time colour streaming. */
  sendCommand(packet: Uint8Array): Promise<void> {
    return this.queue.run(() => this.transport.send(packet))
  }

  private async exchange(packet: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    const reply = deferred<Uint8Array>()
    const unsubscribe = this.transport.onInputReport((report) => {
      if (!isBubble(report.data) && isResponseTo(packet, report.data)) reply.resolve(report.data)
    })
    try {
      try {
        await this.transport.send(packet)
      } catch (error) {
        throw new SendError(`sending command 0x${packet[0]!.toString(16)} failed: ${(error as Error).message}`)
      }
      return await withTimeout(reply.promise, timeoutMs, `command ${hex(packet.subarray(0, 2))}`)
    } finally {
      unsubscribe()
    }
  }

  async close(): Promise<void> {
    this.unsubscribe()
    this.bubbleListeners.clear()
    await this.transport.close()
  }
}

export class SendError extends Error {
  override readonly name = 'SendError'
}

export interface FramingOptions {
  ackTimeoutMs: number
  /** Total attempts per frame (vendor: 10). */
  ackAttempts: number
}

export const DEFAULT_FRAMING: FramingOptions = { ackTimeoutMs: 100, ackAttempts: 10 }

/**
 * The 2.4 GHz dongle link ("Wireless8K"). A 63-byte packet is sent as `[reportId, ...packet]` cut into ≤14-byte
 * `0x66` frames, each acknowledged by the receiver; incoming frames are ACKed and reassembled into one packet that
 * is delivered to listeners as if it were a wired input report. 19-byte `0x0A` dongle status reports pass through.
 */
export class FramedTransport implements Transport {
  private syncFlag = 0
  private receiveSyncFlag = 0
  private received: Uint8Array[] = []
  private readonly pendingAcks = new Map<string, Deferred<void>>()
  private readonly listeners = new Set<InputReportListener>()
  private readonly sendQueue = new SerialQueue()
  private readonly unsubscribe: Unsubscribe

  constructor(
    private readonly raw: Transport,
    private readonly options: FramingOptions = DEFAULT_FRAMING,
  ) {
    this.unsubscribe = raw.onInputReport((report) => void this.handleRaw(report))
  }

  get reportId(): number {
    return this.raw.reportId
  }

  get opened(): boolean {
    return this.raw.opened
  }

  onInputReport(listener: InputReportListener): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async send(packet: Uint8Array): Promise<void> {
    if (packet.length > PACKET_SIZE) throw new RangeError(`packet too long for framing: ${packet.length}`)
    const payload = concat([this.reportId], packet)
    await this.sendQueue.run(async () => {
      const parts = splitPayload(payload)
      for (let i = 0; i < parts.length; i++) {
        this.syncFlag = (this.syncFlag + 1) & 7
        await this.sendAndWaitAck(buildFrame(parts.length, i + 1, parts[i]!, this.syncFlag))
      }
    })
  }

  /** Raw reports on another report ID (the vendor's wireless colour streaming uses report ID 0x09) bypass framing. */
  sendWithReportId(reportId: number, bytes: Uint8Array): Promise<void> {
    if (!this.raw.sendWithReportId) throw new Error('underlying transport cannot send arbitrary report IDs')
    return this.raw.sendWithReportId(reportId, bytes)
  }

  async close(): Promise<void> {
    this.unsubscribe()
    for (const pending of this.pendingAcks.values()) pending.reject(new Error('transport closed'))
    this.pendingAcks.clear()
    this.listeners.clear()
    await this.raw.close()
  }

  private async sendAndWaitAck(frame: Uint8Array): Promise<void> {
    const key = frameKey(parseFrame(frame))
    const ack = deferred<void>()
    this.pendingAcks.set(key, ack)
    try {
      for (let attempt = 1; ; attempt++) {
        await this.raw.send(frame)
        try {
          await withTimeout(ack.promise, this.options.ackTimeoutMs, `frame ${key} ack`)
          return
        } catch (error) {
          if (!(error instanceof TimeoutError)) throw error
          if (attempt >= this.options.ackAttempts) throw new SendError(`frame ${key} not acknowledged after ${attempt} attempts`)
        }
      }
    } finally {
      this.pendingAcks.delete(key)
    }
  }

  private emit(report: InputReport): void {
    for (const listener of this.listeners) {
      try {
        listener(report)
      } catch (error) {
        console.error('framed input listener failed', error)
      }
    }
  }

  private async handleRaw(report: InputReport): Promise<void> {
    const data = report.data
    if (data[0] === 0x08) return // vendor drops these unconditionally; purpose unknown
    if (report.reportId !== this.reportId || data[0] !== FRAME_HEADER) {
      // Dongle link status report (`0x0A … byte4 == 2`) is not framed; forward it untouched.
      if (data[0] === 0x0a && data[4] === 2) this.emit(report)
      return
    }
    if (isAckFrame(data)) {
      this.pendingAcks.get(frameKey(parseFrame(data)))?.resolve()
      return
    }
    if (!isValidDataFrame(data)) return
    const frame = parseFrame(data)
    try {
      await this.raw.send(buildAckFrame(data))
    } catch {
      return
    }
    const first = frame.current === 1
    if (this.receiveSyncFlag === frame.syncFlag) {
      // Same sync flag as the last accepted frame: a retransmission. Only a repeated first frame restarts reassembly.
      if (!first) return
      this.received = []
    }
    if (first && this.received.length) this.received = []
    if (frame.current !== this.received.length + 1) return // out of order
    this.receiveSyncFlag = frame.syncFlag
    this.received.push(Uint8Array.from(frame.data))
    if (frame.current === frame.total && this.received.length === frame.total) {
      const packet = concat(...this.received)
      this.received = []
      this.emit({ reportId: this.reportId, data: packet })
    }
  }
}
