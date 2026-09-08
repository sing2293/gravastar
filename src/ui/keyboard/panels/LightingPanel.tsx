import { useEffect, useMemo, useRef, useState } from 'react'
import type { RGB } from '@/model/device'
import type { KeyId, LightZone, LightingCapabilities, PerKeyColor, ZoneLighting } from '@/model/keyboard'
import { Button, Card, Field, Notice, Select, Slider, Tabs, Toggle, hexToRgb, rgbToHex } from '@/ui/components/kit'
import { expandLedAliases } from '@/drivers/k98pro/layout'
import { KeyboardStage } from '../KeyboardStage'
import type { KeyboardPanelProps } from '../KeyboardPage'

const ZONE_LABELS: Record<LightZone, string> = { main: 'Key backlight', side: 'Side light', logo: 'Logo' }

export function LightingPanel({ driver, caps: kbCaps }: KeyboardPanelProps) {
  const [caps, setCaps] = useState<LightingCapabilities>()
  const [zone, setZone] = useState<LightZone>('main')
  const [state, setState] = useState<Partial<Record<LightZone, ZoneLighting>>>({})
  const [custom, setCustom] = useState<Map<KeyId, RGB>>(new Map())
  const [paint, setPaint] = useState<RGB>({ r: 155, g: 255, b: 49 })
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const ids = useMemo(() => kbCaps.layout.keys.map((k) => k.id), [kbCaps.layout])

  useEffect(() => {
    let alive = true
    driver.lighting
      .capabilities()
      .then(async (c) => {
        if (!alive) return
        setCaps(c)
        const next: Partial<Record<LightZone, ZoneLighting>> = {}
        for (const z of c.zones) next[z] = await driver.lighting.get(z)
        if (alive) setState(next)
      })
      .catch((e: Error) => alive && setError(e.message))
    const off = driver.on('lighting-change', (ch) => {
      setState((s) => {
        const cur = s[ch.zone]
        if (!cur) return s
        const patch: Partial<ZoneLighting> = ch.param === 'effect' ? { effectId: ch.value } : ch.param === 'brightness' ? { brightness: ch.value } : ch.param === 'speed' ? { speed: ch.value } : ch.param === 'color' && ch.color ? { colorIndex: ch.value, color: ch.color } : {}
        return { ...s, [ch.zone]: { ...cur, ...patch } }
      })
    })
    return () => {
      alive = false
      off()
    }
  }, [driver])

  const current = state[zone]
  const effects = caps?.effects[zone] ?? []
  const effect = effects.find((e) => e.id === current?.effectId)
  const isCustom = zone === 'main' && current?.effectId === caps?.customEffectId

  useEffect(() => {
    if (!isCustom) return
    let alive = true
    driver.lighting
      .getCustomColors(ids)
      .then((list) => alive && setCustom(new Map(list.map((c) => [c.id, c.color]))))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [driver, ids, isCustom])

  const commit = (next: ZoneLighting, immediate = false) => {
    setState((s) => ({ ...s, [zone]: next }))
    clearTimeout(timer.current)
    const run = async () => {
      setBusy(true)
      try {
        await driver.lighting.set(zone, next)
        setError(undefined)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    }
    if (immediate) void run()
    else timer.current = setTimeout(() => void run(), 120)
  }

  const changeEffect = async (effectId: number) => {
    if (!current) return
    setBusy(true)
    try {
      await driver.lighting.setEffect(zone, effectId)
      const fresh = await driver.lighting.get(zone)
      setState((s) => ({ ...s, [zone]: fresh }))
      setError(undefined)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const paintKeys = async (colors: PerKeyColor[]) => {
    setBusy(true)
    try {
      await driver.lighting.setCustomColors(expandLedAliases(kbCaps.layout, colors))
      setCustom((m) => {
        const n = new Map(m)
        for (const c of colors) n.set(c.id, c.color)
        return n
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !caps) return <Notice kind="error">{error}</Notice>
  if (!caps || !current) return <div className="muted">Reading lighting…</div>
  const brightness = caps.brightness[zone] ?? caps.brightness.main!
  const random = current.colorIndex >= caps.randomColorIndex

  return (
    <div className="stack">
      {error && <Notice kind="error">{error}</Notice>}
      <Tabs value={zone} tabs={caps.zones.map((z) => ({ id: z, label: ZONE_LABELS[z] }))} onChange={setZone} />
      <div className="grid cols-2">
        <Card title="Effect">
          <div className="stack">
            <Field label="Mode">
              <Select value={current.effectId} options={effects.map((e) => ({ value: e.id, label: e.name }))} onChange={(v) => void changeEffect(v)} disabled={busy} />
            </Field>
            <Field label={`Brightness — ${Math.round((current.brightness / brightness.max) * 100)}%`}>
              <Slider value={current.brightness} min={brightness.min} max={brightness.max} step={brightness.step} onChange={(v) => commit({ ...current, brightness: v })} disabled={current.effectId === 0} format={(v) => `${Math.round((v / brightness.max) * 100)}%`} />
            </Field>
            <Field label={`Speed — ${Math.round((current.speed / caps.speed.max) * 100)}%`}>
              <Slider value={current.speed} min={caps.speed.min} max={caps.speed.max} step={caps.speed.step} onChange={(v) => commit({ ...current, speed: v })} disabled={!effect?.supportsSpeed} format={(v) => `${Math.round((v / caps.speed.max) * 100)}%`} />
            </Field>
          </div>
        </Card>
        <Card title="Colour">
          <div className="stack">
            <Toggle checked={random} disabled={!effect?.supportsRandomColor} onChange={(v) => commit({ ...current, colorIndex: v ? caps.randomColorIndex : 0, color: v ? { r: 0, g: 0, b: 0 } : current.color }, true)} label="Random colour shift" />
            <div className="row">
              <input type="color" className="color-input" value={rgbToHex(current.color)} disabled={!effect?.supportsColor || random} onChange={(e) => commit({ ...current, colorIndex: 0, color: hexToRgb(e.target.value) })} />
              <span className="mono muted">{rgbToHex(current.color)}</span>
              {['#9bff31', '#6a2eee', '#ff2441', '#00e0ff', '#ffb020', '#ffffff'].map((hex) => (
                <button key={hex} className="swatch" style={{ background: hex }} disabled={!effect?.supportsColor || random} onClick={() => commit({ ...current, colorIndex: 0, color: hexToRgb(hex) }, true)} title={hex} />
              ))}
            </div>
            {zone === 'main' && caps.customEffectId !== undefined && !isCustom && (
              <Button onClick={() => void changeEffect(caps.customEffectId!)} disabled={busy}>
                Per-key colours (Custom mode)
              </Button>
            )}
          </div>
        </Card>
      </div>
      {isCustom && (
        <Card
          title="Per-key colours"
          actions={
            <div className="row">
              <input type="color" className="color-input" value={rgbToHex(paint)} onChange={(e) => setPaint(hexToRgb(e.target.value))} />
              <Button small disabled={busy} onClick={() => void paintKeys(ids.map((id) => ({ id, color: paint })))}>
                Fill all
              </Button>
              <Button small disabled={busy} onClick={() => void paintKeys(ids.map((id) => ({ id, color: { r: 0, g: 0, b: 0 } })))}>
                Clear
              </Button>
            </div>
          }
        >
          <KeyboardStage layout={kbCaps.layout} onKeyClick={(k) => void paintKeys([{ id: k.id, color: paint }])} decorate={(k) => ({ color: custom.get(k.id) })} />
          <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
            Pick a colour, then click keys to paint them. Colours are stored on the keyboard.
          </div>
        </Card>
      )}
    </div>
  )
}
