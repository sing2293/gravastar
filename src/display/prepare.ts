/**
 * Browser-side image preparation for the LCD: decode (animated GIFs via WebCodecs `ImageDecoder`, everything else
 * via `createImageBitmap`), letter-box onto a black canvas of the panel size, quantise to R3G3B2 and encode a GIF
 * — mirroring the vendor page (docs/reverse-engineering/k98pro/06-display-reset-firmware.md §3.4).
 */
import type { DisplayImage } from '@/model/keyboard'
import { R3G3B2_PALETTE, encodeGif, quantizeR3G3B2, type IndexedFrame } from './gif'

export interface PreparedImage extends DisplayImage {
  frameCount: number
  /** Object URL of the encoded GIF for previewing exactly what the panel will show. */
  previewUrl: string
}

interface DecodedFrame {
  bitmap: ImageBitmap | VideoFrame
  /** Duration in hundredths of a second. */
  delayCs: number
}

async function decodeFrames(file: Blob): Promise<DecodedFrame[]> {
  const isGif = file.type === 'image/gif' || /\.gif$/i.test((file as File).name ?? '')
  const ImageDecoderCtor = (globalThis as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder
  if (isGif && ImageDecoderCtor) {
    const decoder = new ImageDecoderCtor({ data: await file.arrayBuffer(), type: 'image/gif' })
    await decoder.tracks.ready
    const track = decoder.tracks.selectedTrack
    const count = track?.frameCount ?? 1
    const frames: DecodedFrame[] = []
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i, completeFramesOnly: true })
      const delayCs = image.duration ? Math.max(2, Math.round(image.duration / 10000)) : 10
      frames.push({ bitmap: image, delayCs })
    }
    decoder.close()
    return frames
  }
  return [{ bitmap: await createImageBitmap(file), delayCs: 100 }]
}

function letterbox(frame: ImageBitmap | VideoFrame, w: number, h: number, canvas: OffscreenCanvas | HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  const fw = 'displayWidth' in frame ? frame.displayWidth : frame.width
  const fh = 'displayHeight' in frame ? frame.displayHeight : frame.height
  const scale = Math.min(w / fw, h / fh)
  const dw = Math.round(fw * scale)
  const dh = Math.round(fh * scale)
  ctx.drawImage(frame as CanvasImageSource, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh)
  return ctx.getImageData(0, 0, w, h)
}

export function toIndexed(img: ImageData): Uint8Array {
  const out = new Uint8Array(img.width * img.height)
  const d = img.data
  for (let i = 0, p = 0; i < d.length; i += 4, p++) out[p] = quantizeR3G3B2(d[i]!, d[i + 1]!, d[i + 2]!)
  return out
}

export interface PrepareOptions {
  maxBytes?: number
  /** Cap on frames kept (frames are dropped evenly when exceeded). */
  maxFrames?: number
}

export async function prepareDisplayImage(file: Blob, width: number, height: number, options: PrepareOptions = {}): Promise<PreparedImage> {
  const maxBytes = options.maxBytes ?? 3 * 1024 * 1024
  const decoded = await decodeFrames(file)
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  let frames: IndexedFrame[] = decoded.map((f) => ({ indices: toIndexed(letterbox(f.bitmap, width, height, canvas)), delayCs: f.delayCs }))
  for (const f of decoded) f.bitmap.close()
  if (options.maxFrames && frames.length > options.maxFrames) frames = thin(frames, options.maxFrames)
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
