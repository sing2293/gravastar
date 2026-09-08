/**
 * Browser-side image preparation for the LCD: decode (animated GIFs via WebCodecs `ImageDecoder`, everything else
 * via `createImageBitmap`), frame the picture on a black canvas of the panel size (fill/crop, fit/letter-box or
 * stretch, with zoom and pan), quantise to R3G3B2 and encode a GIF — the byte format mirrors the vendor page
 * (docs/reverse-engineering/k98pro/06-display-reset-firmware.md §3.4); the vendor only ever letter-boxes.
 */
import type { DisplayImage } from '@/model/keyboard'
import { R3G3B2_PALETTE, encodeGif, quantizeR3G3B2, type IndexedFrame } from './gif'

export interface PreparedImage extends DisplayImage {
  frameCount: number
  /** Object URL of the encoded GIF for previewing exactly what the panel will show. */
  previewUrl: string
}

export interface DecodedFrame {
  bitmap: ImageBitmap | VideoFrame
  /** Duration in hundredths of a second. */
  delayCs: number
}

/** A decoded picture kept alive (bitmaps are GPU resources) so it can be re-framed and re-rendered. */
export interface DisplaySource {
  name: string
  width: number
  height: number
  frames: DecodedFrame[]
  close(): void
}

export type FitMode = 'fill' | 'fit' | 'stretch'

/** How the picture sits on the panel. `zoom` and `pan` only apply to `fill` (1 = just covers the panel; pan 0.5 = centred). */
export interface Framing {
  mode: FitMode
  zoom: number
  pan: { x: number; y: number }
}

export const DEFAULT_FRAMING: Framing = { mode: 'fill', zoom: 1, pan: { x: 0.5, y: 0.5 } }

export interface DrawRect {
  dx: number
  dy: number
  dw: number
  dh: number
}

export const frameSize = (f: ImageBitmap | VideoFrame): { width: number; height: number } => ('displayWidth' in f ? { width: f.displayWidth, height: f.displayHeight } : { width: f.width, height: f.height })

export async function decodeDisplaySource(file: Blob): Promise<DisplaySource> {
  const name = (file as File).name ?? 'image'
  const isGif = file.type === 'image/gif' || /\.gif$/i.test(name)
  const ImageDecoderCtor = (globalThis as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder
  const frames: DecodedFrame[] = []
  if (isGif && ImageDecoderCtor) {
    const decoder = new ImageDecoderCtor({ data: await file.arrayBuffer(), type: 'image/gif' })
    await decoder.tracks.ready
    const track = decoder.tracks.selectedTrack
    const count = track?.frameCount ?? 1
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i, completeFramesOnly: true })
      const delayCs = image.duration ? Math.max(2, Math.round(image.duration / 10000)) : 10
      frames.push({ bitmap: image, delayCs })
    }
    decoder.close()
  } else frames.push({ bitmap: await createImageBitmap(file), delayCs: 100 })
  const { width, height } = frameSize(frames[0]!.bitmap)
  return {
    name,
    width,
    height,
    frames,
    close() {
      for (const f of frames) f.bitmap.close()
      frames.length = 0
    },
  }
}

/** Where a `sw × sh` picture lands on a `w × h` panel under `framing`. */
export function framingRect(framing: Framing, sw: number, sh: number, w: number, h: number): DrawRect {
  if (framing.mode === 'stretch') return { dx: 0, dy: 0, dw: w, dh: h }
  if (framing.mode === 'fit') {
    const scale = Math.min(w / sw, h / sh)
    const dw = Math.round(sw * scale)
    const dh = Math.round(sh * scale)
    return { dx: Math.round((w - dw) / 2), dy: Math.round((h - dh) / 2), dw, dh }
  }
  const scale = Math.max(w / sw, h / sh) * Math.max(1, framing.zoom)
  const dw = Math.round(sw * scale)
  const dh = Math.round(sh * scale)
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  return { dx: Math.round((w - dw) * clamp01(framing.pan.x)) || 0, dy: Math.round((h - dh) * clamp01(framing.pan.y)) || 0, dw, dh }
}

/** Pan after dragging the picture by (`dxPanel`, `dyPanel`) panel pixels. */
export function panAfterDrag(framing: Framing, sw: number, sh: number, w: number, h: number, dxPanel: number, dyPanel: number): Framing['pan'] {
  const r = framingRect(framing, sw, sh, w, h)
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  return {
    x: r.dw > w ? clamp01((r.dx + dxPanel) / (w - r.dw)) : 0.5,
    y: r.dh > h ? clamp01((r.dy + dyPanel) / (h - r.dh)) : 0.5,
  }
}

export function drawFramed(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, frame: ImageBitmap | VideoFrame, w: number, h: number, rect: DrawRect): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(frame as CanvasImageSource, rect.dx, rect.dy, rect.dw, rect.dh)
}

// 8×8 Bayer matrix, values 0..63 → threshold offsets centred on zero.
const BAYER8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21]

/**
 * Quantise to the fixed R3G3B2 palette. `dither` applies ordered (Bayer) dithering scaled to each channel's step
 * (36 for R/G, 85 for B): gradients stop banding, frames stay temporally stable and LZW still compresses them well.
 */
export function toIndexed(img: ImageData, dither = false): Uint8Array {
  const out = new Uint8Array(img.width * img.height)
  const d = img.data
  const w = img.width
  const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (!dither) {
      out[p] = quantizeR3G3B2(d[i]!, d[i + 1]!, d[i + 2]!)
      continue
    }
    const t = (BAYER8[((Math.floor(p / w) & 7) << 3) | (p % w & 7)]! + 0.5) / 64 - 0.5 // -0.5..0.5
    out[p] = quantizeR3G3B2(clampByte(d[i]! + t * 36), clampByte(d[i + 1]! + t * 36), clampByte(d[i + 2]! + t * 85))
  }
  return out
}

export interface PrepareOptions {
  maxBytes?: number
  /** Cap on frames kept (frames are dropped evenly when exceeded). */
  maxFrames?: number
  framing?: Framing
  /** Ordered dithering against the 256-colour palette (default on). */
  dither?: boolean
}

/** Renders the source under `framing` to the GIF the panel will receive. The source stays open. */
export function renderDisplayImage(source: DisplaySource, width: number, height: number, options: PrepareOptions = {}): PreparedImage {
  const maxBytes = options.maxBytes ?? 3 * 1024 * 1024
  const framing = options.framing ?? DEFAULT_FRAMING
  const rect = framingRect(framing, source.width, source.height, width, height)
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  let decoded = source.frames
  if (options.maxFrames && decoded.length > options.maxFrames) decoded = thinDecoded(decoded, options.maxFrames)
  let frames: IndexedFrame[] = decoded.map((f) => {
    drawFramed(ctx, f.bitmap, width, height, rect)
    return { indices: toIndexed(ctx.getImageData(0, 0, width, height), options.dither ?? true), delayCs: f.delayCs }
  })
  let gif = encodeGif({ width, height, palette: R3G3B2_PALETTE, frames })
  // Too big for the panel's 3 MiB budget: drop every other frame until it fits (vendor's "deleteFramesRetry").
  while (gif.length > maxBytes && frames.length > 1) {
    frames = thin(frames, Math.max(1, Math.floor(frames.length / 2)))
    gif = encodeGif({ width, height, palette: R3G3B2_PALETTE, frames })
  }
  if (gif.length > maxBytes) throw new Error(`Image is ${(gif.length / 1024 / 1024).toFixed(1)} MiB even as a single frame; the panel accepts up to ${(maxBytes / 1024 / 1024).toFixed(0)} MiB`)
  const avgDelayCs = frames.reduce((n, f) => n + f.delayCs, 0) / frames.length
  const fps = frames.length > 1 ? Math.max(1, Math.round(100 / Math.max(1, avgDelayCs))) : 1
  const previewUrl = URL.createObjectURL(new Blob([gif as BlobPart], { type: 'image/gif' }))
  return { gif, width, height, fps, frameCount: frames.length, previewUrl }
}

/** Decode + render + close in one go (no re-framing). */
export async function prepareDisplayImage(file: Blob, width: number, height: number, options: PrepareOptions = {}): Promise<PreparedImage> {
  const source = await decodeDisplaySource(file)
  try {
    return renderDisplayImage(source, width, height, options)
  } finally {
    source.close()
  }
}

function thinDecoded(frames: DecodedFrame[], keep: number): DecodedFrame[] {
  const out: DecodedFrame[] = []
  const step = frames.length / keep
  for (let i = 0; i < keep; i++) {
    const from = Math.floor(i * step)
    const to = Math.floor((i + 1) * step)
    out.push({ bitmap: frames[from]!.bitmap, delayCs: frames.slice(from, to).reduce((n, f) => n + f.delayCs, 0) })
  }
  return out
}

/** Keeps `keep` frames spread evenly, summing the delays of dropped frames into the kept ones. */
function thin(frames: IndexedFrame[], keep: number): IndexedFrame[] {
  const out: IndexedFrame[] = []
  const step = frames.length / keep
  for (let i = 0; i < keep; i++) {
    const from = Math.floor(i * step)
    const to = Math.floor((i + 1) * step)
    const delayCs = frames.slice(from, to).reduce((n, f) => n + f.delayCs, 0)
    out.push({ indices: frames[from]!.indices, delayCs })
  }
  return out
}
