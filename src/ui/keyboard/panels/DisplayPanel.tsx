import { useEffect, useState } from 'react'
import { prepareDisplayImage, type PreparedImage } from '@/display/prepare'
import type { DisplayCapabilities } from '@/model/keyboard'
import { Button, Card, Notice } from '@/ui/components/kit'
import type { KeyboardPanelProps } from '../KeyboardPage'

export function DisplayPanel({ driver, summary }: KeyboardPanelProps) {
  const svc = driver.display
  const [caps, setCaps] = useState<DisplayCapabilities>()
  const [image, setImage] = useState<PreparedImage>()
  const [progress, setProgress] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()

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
      if (image) URL.revokeObjectURL(image.previewUrl)
      setImage(await prepareDisplayImage(file, caps.width, caps.height, { maxBytes: caps.maxFileBytes, maxFrames: 120 }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!image) return
    setBusy(true)
    setError(undefined)
    setProgress(0)
    try {
      await svc.upload(image, setProgress)
      setDone(`Sent ${(image.gif.length / 1024).toFixed(0)} KB (${image.frameCount} frame${image.frameCount > 1 ? 's' : ''}) to the display.`)
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
              GIFs keep their animation; other images become a still. Everything is letter-boxed to the panel and reduced to 256 colours, exactly as the keyboard expects (≤ {(caps.maxFileBytes / 1024 / 1024).toFixed(0)} MiB).
            </div>
            {image && (
              <div className="stack">
                <div style={{ background: '#000', borderRadius: 8, padding: 8, display: 'inline-block', width: 'fit-content' }}>
                  <img src={image.previewUrl} width={caps.width} height={caps.height} style={{ display: 'block', imageRendering: 'pixelated', maxWidth: '100%' }} alt="preview" />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {image.frameCount} frame{image.frameCount > 1 ? `s · ${image.fps} fps` : ''} · {(image.gif.length / 1024).toFixed(0)} KB
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
