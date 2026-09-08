import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_FRAMING, decodeDisplaySource, drawFramed, framingRect, panAfterDrag, renderDisplayImage, type DisplaySource, type FitMode, type Framing, type PreparedImage } from '@/display/prepare'
import type { DisplayCapabilities } from '@/model/keyboard'
import { Button, Card, Field, Notice, Slider, Toggle } from '@/ui/components/kit'
import type { KeyboardPanelProps } from '../KeyboardPage'

const MODES: { id: FitMode; label: string; hint: string }[] = [
  { id: 'fill', label: 'Fill (crop)', hint: 'Covers the whole screen; drag the picture to choose the crop, zoom to tighten it.' },
  { id: 'fit', label: 'Fit', hint: 'Whole picture, black bars where the shape differs.' },
  { id: 'stretch', label: 'Stretch', hint: 'Whole picture, squeezed to the screen shape.' },
]

export function DisplayPanel({ driver, summary }: KeyboardPanelProps) {
  const svc = driver.display
  const [caps, setCaps] = useState<DisplayCapabilities>()
  const [source, setSource] = useState<DisplaySource>()
  const [framing, setFraming] = useState<Framing>(DEFAULT_FRAMING)
  const [dither, setDither] = useState(true)
  const [image, setImage] = useState<PreparedImage>()
  const [stale, setStale] = useState(false)
  const [progress, setProgress] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; framing: Framing } | null>(null)
  const imageRef = useRef<PreparedImage>(undefined)

  useEffect(() => {
    if (!svc) return
    let alive = true
    svc
      .capabilities()
      .then((c) => alive && setCaps(c))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [svc])

  // Release decoded bitmaps and preview URLs when the panel goes away.
  useEffect(
    () => () => {
      source?.close()
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.previewUrl)
    },
    [source],
  )

  const render = useCallback(
    (src: DisplaySource, f: Framing, c: DisplayCapabilities, dth: boolean) => {
      try {
        const next = renderDisplayImage(src, c.width, c.height, { maxBytes: c.maxFileBytes, maxFrames: 120, framing: f, dither: dth })
        if (imageRef.current) URL.revokeObjectURL(imageRef.current.previewUrl)
        imageRef.current = next
        setImage(next)
        setError(undefined)
      } catch (e) {
        setError((e as Error).message)
      }
      setStale(false)
    },
    [],
  )

  // Live first-frame preview while the GIF is stale (dragging / zooming), then a debounced full render.
  useEffect(() => {
    if (!source || !caps) return
    const canvas = canvasRef.current
    if (canvas && source.frames[0]) {
      canvas.width = caps.width
      canvas.height = caps.height
      drawFramed(canvas.getContext('2d')!, source.frames[0].bitmap, caps.width, caps.height, framingRect(framing, source.width, source.height, caps.width, caps.height))
    }
    setStale(true)
    const t = setTimeout(() => render(source, framing, caps, dither), 250)
    return () => clearTimeout(t)
  }, [source, framing, caps, dither, render])

  if (!svc) return <Notice>This keyboard has no display service.</Notice>
  if (error && !caps) return <Notice kind="error">{error}</Notice>
  if (!caps) return <div className="muted">Reading display capabilities…</div>
  if (!caps.lcd) return <Notice>The firmware reports no LCD on this keyboard.</Notice>

  const choose = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(undefined)
    setDone(undefined)
    try {
      const next = await decodeDisplaySource(file)
      source?.close()
      setSource(next)
      setFraming(DEFAULT_FRAMING)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!source) return
    setBusy(true)
    setError(undefined)
    setDone(undefined)
    setProgress(0)
    try {
      if (stale || !imageRef.current) render(source, framing, caps, dither) // never send a stale frame: what you see is what goes live
      const img = imageRef.current
      if (!img) throw new Error('Nothing to send')
      await svc.upload(img, setProgress)
      setDone(`Sent ${(img.gif.length / 1024).toFixed(0)} KB (${img.frameCount} frame${img.frameCount > 1 ? 's' : ''}) to the display.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setProgress(undefined)
    }
  }

  const syncTime = async () => {
    setBusy(true)
    try {
      await svc.syncTime()
      setDone('Clock synchronised.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pannable = source && framing.mode === 'fill'
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pannable) return
    drag.current = { x: e.clientX, y: e.clientY, framing }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !source || !frameRef.current) return
    const scale = caps.width / frameRef.current.clientWidth // panel pixels per CSS pixel
    const pan = panAfterDrag(drag.current.framing, source.width, source.height, caps.width, caps.height, (e.clientX - drag.current.x) * scale, (e.clientY - drag.current.y) * scale)
    setFraming({ ...drag.current.framing, pan })
  }
  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div className="stack">
      {summary.link === 'dongle' && <Notice>Display uploads over the 2.4 GHz receiver are slow and unverified — plug in USB for this.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="info">{done}</Notice>}
      <div className="grid cols-2">
        <Card title={`Display image — ${caps.width} × ${caps.height}`}>
          <div className="stack">
            <input type="file" accept="image/gif,image/png,image/jpeg,image/webp,image/bmp" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
            <div className="dim" style={{ fontSize: 12 }}>
              GIFs keep their animation; other images become a still. The preview is exactly what the keyboard receives: 256 colours, {caps.width} × {caps.height}, ≤ {(caps.maxFileBytes / 1024 / 1024).toFixed(0)} MiB.
            </div>
            {source && (
              <div className="stack">
                <div
                  ref={frameRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  style={{
                    position: 'relative',
                    width: '100%',
                    maxWidth: caps.width * 1.5,
                    aspectRatio: `${caps.width} / ${caps.height}`,
                    background: '#000',
                    borderRadius: 8,
                    overflow: 'hidden',
                    touchAction: 'none',
                    cursor: pannable ? (drag.current ? 'grabbing' : 'grab') : 'default',
                    userSelect: 'none',
                  }}
                >
                  <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated', display: stale || !image ? 'block' : 'none' }} />
                  {image && !stale && <img src={image.previewUrl} alt="preview" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated' }} />}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {MODES.map((m) => (
                    <Button key={m.id} small variant={framing.mode === m.id ? 'primary' : 'ghost'} title={m.hint} onClick={() => setFraming({ ...framing, mode: m.id })}>
                      {m.label}
                    </Button>
                  ))}
                  {framing.mode === 'fill' && (
                    <Button small variant="ghost" onClick={() => setFraming({ ...framing, zoom: 1, pan: { x: 0.5, y: 0.5 } })}>
                      Centre
                    </Button>
                  )}
                </div>
                <div className="dim" style={{ fontSize: 12 }}>{MODES.find((m) => m.id === framing.mode)?.hint}</div>
                {framing.mode === 'fill' && (
                  <Field label={`Zoom — ${Math.round(framing.zoom * 100)}%`}>
                    <Slider value={Math.round(framing.zoom * 100)} min={100} max={400} step={5} onChange={(v) => setFraming({ ...framing, zoom: v / 100 })} format={(v) => `${v}%`} />
                  </Field>
                )}
                <Toggle checked={dither} onChange={setDither} label="Dither — smoother gradients in the panel's 256 colours (larger file)" />
                <div className="muted" style={{ fontSize: 12 }}>
                  {source.name} · {source.width} × {source.height} · {source.frames.length} frame{source.frames.length > 1 ? 's' : ''}
                  {image && !stale ? ` → ${image.frameCount} frame${image.frameCount > 1 ? `s · ${image.fps} fps` : ''} · ${(image.gif.length / 1024).toFixed(0)} KB` : ' → rendering…'}
                </div>
                {progress !== undefined && (
                  <div className="meter">
                    <span style={{ width: `${progress * 100}%` }} />
                  </div>
                )}
                <div className="row">
                  <Button variant="primary" disabled={busy} onClick={() => void apply()}>
                    {progress !== undefined ? `Uploading ${Math.round(progress * 100)}%` : 'Apply to display'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
        <Card title="Clock">
          <div className="stack">
            <div className="muted">The panel shows the time; sync it from this computer.</div>
            <Button disabled={busy} onClick={() => void syncTime()}>
              Sync time now
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
