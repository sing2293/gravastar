/**
 * Compx mouse link: 16-byte frames on report ID 0x08 with echo matching and retries, unsolicited status reports,
 * and the flash (EEPROM) primitives with a local shadow image.
 * Verified against HIDHandle.js `Send_HID_Buffer` 1632–1690, `Set_Device_Eeprom_*` 2314–2380, `Read_Device_Flash`
 * 2554–2625. Doc: docs/reverse-engineering/mouse/01-transport-commands.md §4, §9.
 */
import { SerialQueue, TimeoutError, deferred, withTimeout } from '@/hid/core/request'
import type { Transport } from '@/hid/core/transport'
import type { Unsubscribe } from '@/model/device'
import { FLASH_SIZE } from './eeprom'
import { Command, PAYLOAD_MAX, REPORT_ID, buildFrame, complementPair, echoMatches, parseFrame, type ParsedFrame } from './frame'

export interface CompxLinkOptions {
  /** Per-attempt echo wait (vendor: 200 ms). */
  timeoutMs: number
  /** Total attempts (vendor: 5). */
  attempts: number
}

export const DEFAULT_COMPX_LINK: CompxLinkOptions = { timeoutMs: 200, attempts: 5 }

/** Per-request override of the link defaults. */
export interface RequestOptions {
  timeoutMs?: number
  attempts?: number
}

/**
 * Profile for real-time writes (music sync): wait a little longer for the echo — a busy flash can take its time —
 * but never retry. The vendor's 5 × 200 ms would hold the serial queue for a full second, during which nothing
 * else reaches the mouse and the animation stops dead.
 */
export const STREAM_REQUEST: RequestOptions = { timeoutMs: 350, attempts: 1 }

export type StatusListener = (frame: Uint8Array) => void

export class CompxLink {
  readonly flash = new Uint8Array(FLASH_SIZE).fill(0xff)
  private readonly queue = new SerialQueue()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly unsubscribe: Unsubscribe

  constructor(
    readonly transport: Transport,
    readonly options: CompxLinkOptions = DEFAULT_COMPX_LINK,
  ) {
    this.unsubscribe = transport.onInputReport((r) => {
      if (r.reportId !== REPORT_ID || r.data[0] !== Command.StatusChanged) return
      for (const l of this.statusListeners) l(r.data)
    })
  }

  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /** Sends a frame and resolves with the device's echo (status byte 1 = OK, 1 = error/unsupported). */
  request(frame: Uint8Array, opts: RequestOptions = {}): Promise<ParsedFrame> {
    const attempts = opts.attempts ?? this.options.attempts
    const timeoutMs = opts.timeoutMs ?? this.options.timeoutMs
    return this.queue.run(async () => {
      let lastError: unknown
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const reply = deferred<Uint8Array>()
        const unsub = this.transport.onInputReport((r) => {
          if (r.reportId === REPORT_ID && r.data[0] !== Command.StatusChanged && echoMatches(frame, r.data)) reply.resolve(r.data)
        })
        try {
          await this.transport.send(frame)
          return parseFrame(await withTimeout(reply.promise, timeoutMs, `mouse command 0x${frame[0]!.toString(16)}`))
        } catch (error) {
          lastError = error
          if (!(error instanceof TimeoutError)) throw error
        } finally {
          unsub()
        }
      }
      throw lastError
    })
  }

  command(command: number, payload: number[] = [], opts?: RequestOptions): Promise<ParsedFrame> {
    return this.request(buildFrame({ command, payload }), opts)
  }

  /** Fire-and-forget (used for factory reset and OLED streaming by the vendor). */
  send(frame: Uint8Array): Promise<void> {
    return this.queue.run(() => this.transport.send(frame))
  }

  // -- flash --------------------------------------------------------------------

  /** `ReadFlashData` of ≤ 10 bytes; mirrored into `flash`. */
  async readBytes(addr: number, length: number): Promise<Uint8Array> {
    if (length <= 0) return new Uint8Array(0)
    if (length > PAYLOAD_MAX) throw new RangeError(`read length ${length} > ${PAYLOAD_MAX}`)
    const reply = await this.request(buildFrame({ command: Command.ReadFlashData, address: addr, payload: new Array<number>(length).fill(0) }))
    if (reply.status !== 0) throw new Error(`flash read at 0x${addr.toString(16)} rejected`)
    const data = Uint8Array.from(reply.payload.subarray(0, length))
    this.flash.set(data, addr)
    return data
  }

  /** Reads `[start, end)` in 10-byte steps. */
  async readRange(start: number, end: number): Promise<Uint8Array> {
    for (let a = start; a < end; a += PAYLOAD_MAX) await this.readBytes(a, Math.min(PAYLOAD_MAX, end - a))
    return this.flash.subarray(start, end)
  }

  /** `WriteFlashData` of one value with its 0x55 complement. */
  async writeValue(addr: number, value: number, opts?: RequestOptions): Promise<void> {
    const pair = complementPair(value)
    const reply = await this.request(buildFrame({ command: Command.WriteFlashData, address: addr, payload: pair }), opts)
    if (reply.status !== 0) throw new Error(`flash write at 0x${addr.toString(16)} rejected`)
    this.flash.set(pair, addr)
  }

  /** `WriteFlashData` of an arbitrary record in 10-byte chunks. */
  async writeArray(addr: number, bytes: ArrayLike<number>, opts?: RequestOptions): Promise<void> {
    const data = Uint8Array.from(bytes)
    for (let i = 0; i < data.length; i += PAYLOAD_MAX) {
      const chunk = data.subarray(i, i + PAYLOAD_MAX)
      const reply = await this.request(buildFrame({ command: Command.WriteFlashData, address: addr + i, payload: Array.from(chunk) }), opts)
      if (reply.status !== 0) throw new Error(`flash write at 0x${(addr + i).toString(16)} rejected`)
      this.flash.set(chunk, addr + i)
    }
  }

  async close(): Promise<void> {
    this.unsubscribe()
    this.statusListeners.clear()
    await this.transport.close()
  }
}
