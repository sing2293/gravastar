import { useEffect, useRef, useState } from 'react'
import type { MouseLightModeInfo, MouseLighting } from '@/model/mouse'
import { Card, Field, Notice, Select, Slider, Toggle, hexToRgb, rgbToHex } from '@/ui/components/kit'
import type { MousePanelProps } from '../MousePage'

export function MouseLightingPanel({ driver }: MousePanelProps) {
  const [modes, setModes] = useState<MouseLightModeInfo[]>([])
  const [l, setL] = useState<MouseLighting>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const load = async () => {
    try {
      const [m, cur] = await Promise.all([driver.lighting.modes(), driver.lighting.get()])
      setModes(m)
      setL(cur)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
    return driver.on('lighting-change', (x) => setL(x))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver])

  if (error && !l) return <Notice kind="error">{error}</Notice>
  if (!l) return <div className="muted">Reading lighting…</div>
  const mode = modes.find((m) => m.id === (l.on ? l.mode : 0))

  const commit = (patch: Partial<MouseLighting>, immediate = false) => {
    setL({ ...l, ...patch })
    clearTimeout(timer.current)
    const run = async () => {
      setBusy(true)
      try {
        await driver.lighting.set(patch)
        setL(await driver.lighting.get())
        setError(undefined)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    }
    if (immediate) void run()
    else timer.current = setTimeout(() => void run(), 150)
  }

  return (
    <div className="stack">
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid cols-2">
        <Card title="Light bar">
          <div className="stack">
            <Field label="Mode">
              <Select value={l.on ? l.mode : 0} options={modes.map((m) => ({ value: m.id, label: m.name }))} onChange={(v) => commit(v === 0 ? { mode: 0, on: false } : { mode: v, on: true }, true)} disabled={busy} />
            </Field>
            <Field label={`Brightness — ${l.brightness}/9`}>
              <Slider value={l.brightness} min={0} max={9} onChange={(v) => commit({ brightness: v })} disabled={!mode?.supportsBrightness} />
            </Field>
            <Field label={`Speed — ${l.speed}/9`}>
              <Slider value={l.speed} min={0} max={9} onChange={(v) => commit({ speed: v })} disabled={!mode?.supportsSpeed} />
            </Field>
            <Field label="Colour">
              <div className="row">
                <input type="color" className="color-input" value={rgbToHex(l.color)} disabled={!mode?.supportsColor} onChange={(e) => commit({ color: hexToRgb(e.target.value) })} />
                {['#9bff31', '#6a2eee', '#ff2441', '#00e0ff', '#ffb020', '#ffffff'].map((hex) => (
                  <button key={hex} className="swatch" style={{ background: hex }} disabled={!mode?.supportsColor} onClick={() => commit({ color: hexToRgb(hex) }, true)} title={hex} />
                ))}
              </div>
            </Field>
            <Toggle checked={l.offWhileMoving} onChange={(v) => commit({ offWhileMoving: v }, true)} disabled={busy} label="Turn the light off while the mouse moves" />
          </div>
        </Card>
      </div>
    </div>
  )
}
