/**
 * LCD display service: capability probe, display profile, image upload (GIF payload as one "dynamic" frame, the
 * way the vendor UI does it) and time sync. Verified against vendor class `Qa` (deob 3231–3473) and the `I9`
 * fast path (7769–7805). Doc: docs/reverse-engineering/k98pro/06-display-reset-firmware.md §2–§3.
 */
import { sleep } from '@/hid/core/request'
import { u16be } from '@/hid/core/bytes'
import type { DisplayCapabilities, DisplayImage, DisplayService } from '@/model/keyboard'
import { buildPackets, decodePayload, withChecksum } from './codec'
import { Cmd, Info } from './enums'
import { u32be } from './keymap'
import type { K98Link } from './transport'

export const enum ImageKind {
  Logo = 0,
  FixedDynamic = 1,
  Static = 2,
  Dynamic = 3,
}

export const enum TransferStatus {
  End = 0,
  Start = 1,
  Cancel = 2,
}

export const enum DynamicFormat {
  Uncompressed = 0x00,
  CompressedGif = 0x10,
}

export const DEFAULT_DISPLAY_SIZE = { w: 428, h: 142 } as const
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024
/** Gap the vendor leaves between fire-and-forget pixel packets. */
const PACKET_GAP_MS = 2

export interface DynamicHeader {
  frameCount: number
  fps: number
  width: number
  height: number
  bitDepth: number
}

/** 18-byte header preceding frame 0 of a dynamic image. */
export function encodeDynamicHeader(h: DynamicHeader, format: DynamicFormat, fileSize = 0): number[] {
  if (format === DynamicFormat.CompressedGif && fileSize <= 0) throw new Error('When using CompressedGif format, dynamicImageFileSize must be greater than 0')
  const tail = format === DynamicFormat.CompressedGif ? [...u32be(fileSize), 0, 0, 0, 0] : new Array<number>(8).fill(0)
  return [...u16be(h.frameCount), h.fps & 0xff, ...u16be(h.width), ...u16be(h.height), h.bitDepth & 0xff, 0, format, ...tail]
}

export function parseDynamicHeader(b: ArrayLike<number>): DynamicHeader {
  return { frameCount: (b[0]! << 8) | b[1]!, fps: b[2]!, width: (b[3]! << 8) | b[4]!, height: (b[5]! << 8) | b[6]!, bitDepth: b[7]! }
}

/** Pixel-data packets carry a 16-bit packet count in bytes 1–2 and a 16-bit index in bytes 3–4. */
export function rewriteTransferPackets(packets: Uint8Array[], reportId: number): Uint8Array[] {
  const [totalHi, totalLo] = u16be(packets.length)
  packets.forEach((p, i) => {
    const [idxHi, idxLo] = u16be(i)
    p[1] = totalHi
    p[2] = totalLo
    p[3] = idxHi
    p[4] = idxLo
    withChecksum(p, reportId)
  })
  return packets
}

export function transferControlByte(kind: ImageKind, status: TransferStatus): number {
  return ((status << 6) | (kind & 0x3f)) & 0xff
}

export interface DisplayProfile {
  displaySize?: { w: number; h: number }
  [key: string]: unknown
}

export class K98Display implements DisplayService {
  constructor(private readonly link: K98Link) {}

  private get reportId(): number {
    return this.link.reportId
  }

  async isSupported(): Promise<{ lcd: boolean; led: boolean }> {
    const [b = 0] = decodePayload(await this.link.request(buildPackets(Cmd.DeviceInfo, Info.DisplaySupport, [], this.reportId)), 1)
    return { lcd: (b & 1) !== 0, led: (b & 2) !== 0 }
  }

  /** `0xA0/0x05` (LCD) — length first, then the JSON body in as many packets as needed. */
  async profile(target: 'lcd' | 'led' = 'lcd'): Promise<DisplayProfile> {
    const cmd = target === 'lcd' ? Cmd.LcdRead : Cmd.LedRead
    const len = decodePayload(await this.link.request(buildPackets(cmd, 0x05, [], this.reportId)))
    const length = ((len[0]! << 24) | (len[1]! << 16) | (len[2]! << 8) | len[3]!) >>> 0
    if (!length) return {}
    const body = decodePayload(await this.link.request(buildPackets(cmd, 0x05, new Array<number>(length).fill(0), this.reportId)))
    const text = new TextDecoder('utf-8')
    try {
      return JSON.parse(text.decode(body)) as DisplayProfile
    } catch {
      try {
        return JSON.parse(text.decode(body.subarray(4))) as DisplayProfile
      } catch (error) {
        throw new Error(`Failed to parse display profile: ${(error as Error).message}`)
      }
    }
  }

  async capabilities(): Promise<DisplayCapabilities> {
    const support = await this.isSupported()
    let size: { w: number; h: number } = DEFAULT_DISPLAY_SIZE
    if (support.lcd) {
      try {
        const p = await this.profile('lcd')
        if (p.displaySize?.w && p.displaySize.h) size = p.displaySize
      } catch {
        /* fall back to the vendor default */
      }
    }
    return { lcd: support.lcd, led: support.led, width: size.w, height: size.h, maxFileBytes: MAX_IMAGE_BYTES }
  }

  /** `cmd/0x06 [status<<6 | kind, …extra]` → file size (u32 BE). */
  private async transferStatus(cmd: number, kind: ImageKind, status: TransferStatus, extra: number[]): Promise<number> {
    const d = decodePayload(await this.link.request(buildPackets(cmd, 0x06, [transferControlByte(kind, status), ...extra], this.reportId)))
    return ((d[0]! << 24) | (d[1]! << 16) | (d[2]! << 8) | d[3]!) >>> 0
  }

  /**
   * Uploads a GIF to LCD slot 0 as a single-frame dynamic image (`CompressedGif`), exactly like the vendor page:
   * Start → pixel packets (fire-and-forget, 2 ms apart) → End. `onProgress` receives 0…1.
   */
  async upload(image: DisplayImage, onProgress?: (fraction: number) => void, slot = 0): Promise<void> {
    if (image.gif.length > MAX_IMAGE_BYTES) throw new Error(`image too large: ${image.gif.length} bytes (max ${MAX_IMAGE_BYTES})`)
    const header = encodeDynamicHeader({ frameCount: 1, fps: Math.max(1, Math.round(image.fps)), width: image.width, height: image.height, bitDepth: 24 }, DynamicFormat.CompressedGif, image.gif.length)
    const body = new Uint8Array(header.length + image.gif.length)
    body.set(header)
    body.set(image.gif, header.length)
    await this.transferStatus(Cmd.LcdTransfer, ImageKind.Dynamic, TransferStatus.Start, [slot, 1, 0])
    try {
      const packets = rewriteTransferPackets(buildPackets(Cmd.LcdPixelsWrite, 0, body, this.reportId), this.reportId)
      for (let i = 0; i < packets.length; i++) {
        await this.link.sendCommand(packets[i]!)
        onProgress?.((i + 1) / packets.length)
        await sleep(PACKET_GAP_MS)
      }
    } finally {
      await this.transferStatus(Cmd.LcdTransfer, ImageKind.Dynamic, TransferStatus.End, [slot, 1])
    }
  }

  /** `0x0B`: `[0,0,0, year lo, year hi, month, day, hours, minutes, seconds, weekday, 12, 12, 12]` (local time). */
  async syncTime(date = new Date()): Promise<void> {
    const year = date.getFullYear()
    const payload = [0, 0, 0, year & 0xff, (year >> 8) & 0xff, date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getDay(), 12, 12, 12]
    await this.link.request(buildPackets(Cmd.SetTime, 0, payload, this.reportId))
  }
}
