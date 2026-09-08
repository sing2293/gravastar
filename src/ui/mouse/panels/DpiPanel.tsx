import { useEffect, useState } from 'react'
import type { DpiCapabilities, DpiSettings } from '@/model/mouse'
import { Button, Card, Field, Notice, Select, Slider, hexToRgb, rgbToHex } from '@/ui/components/kit'
import type { MousePanelProps } from '../MousePage'

export function DpiPanel({ driver }: MousePanelProps) {
  const [caps, setCaps] = useState<DpiCapabilities>()
  const [dpi, setDpi] = useState<DpiSettings>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const load = async () => {
    try {
      const [c, d] = await Promise.all([driver.dpi.capabilities(), driver.dpi.get()])
      setCaps(c)
      setDpi(d)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
    return driver.on('dpi-change', () => void load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver])

  if (error && !dpi) return <Notice kind="error">{error}</Notice>
  if (!caps || !dpi) return <div className="muted">Reading DPI…</div>

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
      setDpi(await driver.dpi.get())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      {error && <Notice kind="error">{error}</Notice>}
      <Card
        title="DPI stages"
        actions={
          <div className="row">
            <Field label="Stages">
              <Select value={dpi.stageCount} options={Array.from({ length: caps.maxStages }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} onChange={(v) => void run(() => driver.dpi.setStageCount(v))} disabled={busy} />
            </Field>
          </div>
        }
      >
        <div className="stack">
          {dpi.stages.slice(0, dpi.stageCount).map((s, i) => (
            <div key={i} className="row" style={{ gap: 14, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <Button small variant={i === dpi.current ? 'primary' : undefined} disabled={busy} onClick={() => void run(() => driver.dpi.setCurrent(i))} style={{ minWidth: 64 }}>
                {i === dpi.current ? '● ' : ''}Stage {i + 1}
              </Button>
              <input type="color" className="color-input" value={rgbToHex(s.color)} disabled={busy || !caps.stageColors} onChange={(e) => void run(() => driver.dpi.setStage(i, { color: hexToRgb(e.target.value) }))} />
              <div style={{ flex: 1 }}>
                <Slider
                  value={s.dpiX}
                  min={caps.range.min}
                  max={caps.range.max}
                  step={caps.range.step}
                  onChange={(v) => setDpi({ ...dpi, stages: dpi.stages.map((x, j) => (j === i ? { ...x, dpiX: v, dpiY: v } : x)) })}
                  onCommit={(v) => void run(() => driver.dpi.setStage(i, { dpiX: v, dpiY: v }))}
                  disabled={busy}
                  format={(v) => `${v} DPI`}
                />
              </div>
              <input className="input" type="number" min={caps.range.min} max={caps.range.max} step={caps.range.step} value={s.dpiX} style={{ width: 96, minWidth: 0 }} disabled={busy} onChange={(e) => setDpi({ ...dpi, stages: dpi.stages.map((x, j) => (j === i ? { ...x, dpiX: Number(e.target.value), dpiY: Number(e.target.value) } : x)) })} onBlur={(e) => void run(() => driver.dpi.setStage(i, { dpiX: Number(e.target.value), dpiY: Number(e.target.value) }))} />
            </div>
          ))}
        </div>
        <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          Values snap to the sensor's grid ({caps.range.step} DPI steps up to {caps.range.max}). The DPI button cycles through the active stages.
        </div>
      </Card>
    </div>
  )
}
