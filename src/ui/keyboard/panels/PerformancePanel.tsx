import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyId, KeyTravel, Layer, LayerSelector, OsMode, PerformanceCapabilities, RapidTrigger, SafeArea, TravelSample } from '@/model/keyboard'
import { LAYERS } from '@/model/keyboard'
import { Button, Card, Field, Notice, Select, Slider, Toggle } from '@/ui/components/kit'
import { KeyboardStage } from '../KeyboardStage'
import type { KeyboardPanelProps } from '../KeyboardPage'

export function PerformancePanel({ driver, caps }: KeyboardPanelProps) {
  const perf = driver.performance
  const [pcaps, setPcaps] = useState<PerformanceCapabilities>()
  const [layer, setLayer] = useState<Layer>(0)
  const [os, setOs] = useState<OsMode>('windows')
  const [travel, setTravel] = useState<Map<KeyId, number>>(new Map())
  const [rt, setRt] = useState<Map<KeyId, RapidTrigger>>(new Map())
  const [safe, setSafe] = useState<Map<KeyId, SafeArea>>(new Map())
  const [selected, setSelected] = useState<Set<KeyId>>(new Set())
  const [draft, setDraft] = useState({ actuation: 2000, rtEnabled: false, press: 300, release: 300, top: 0, bottom: 0, safeEnabled: false })
  const [live, setLive] = useState<Map<KeyId, TravelSample>>(new Map())
  const [monitoring, setMonitoring] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [calibrated, setCalibrated] = useState<Set<KeyId>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const sel: LayerSelector = useMemo(() => ({ layer, os }), [layer, os])
  const ids = useMemo(() => caps.layout.keys.map((k) => k.id), [caps.layout])
  const liveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!perf) return
    let alive = true
    setBusy(true)
    ;(async () => {
      try {
        const c = await perf.capabilities()
        const [t, r, s] = await Promise.all([perf.getTravel(sel, ids), perf.getRapidTriggers(sel, ids), perf.getSafeAreas(ids)])
        if (!alive) return
        setPcaps(c)
        setTravel(new Map(t.map((x) => [x.id, x.actuation])))
        setRt(new Map(r.map((x) => [x.id, x])))
        setSafe(new Map(s.map((x) => [x.id, x])))
        setError(undefined)
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally {
        if (alive) setBusy(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [perf, sel, ids])

  useEffect(() => {
    const offTravel = driver.on('travel', (samples) => {
      setLive((m) => {
        const n = new Map(m)
        for (const s of samples) n.set(s.id, s)
        return n
      })
      clearTimeout(liveTimer.current)
      liveTimer.current = setTimeout(() => setLive(new Map()), 400)
    })
    const offCal = driver.on('calibration', (samples) => setCalibrated((s) => {
      const n = new Set(s)
      for (const x of samples) if (x.finished) n.add(x.id)
      return n
    }))
    return () => {
      offTravel()
      offCal()
      if (perf) {
        void perf.stopMonitoring().catch(() => undefined)
        void perf.stopCalibration().catch(() => undefined)
      }
    }
  }, [driver, perf])

  if (!perf || !pcaps) return error ? <Notice kind="error">{error}</Notice> : <div className="muted">Reading switch settings…</div>
  const mm = (units: number) => (units * pcaps.travelUnitMm).toFixed(2)
  const first = [...selected][0]

  const selectKey = (id: KeyId, additive: boolean) => {
    setSelected((s) => {
      const n = additive ? new Set(s) : new Set<KeyId>()
      if (n.has(id) && additive) n.delete(id)
      else n.add(id)
      return n
    })
    const t = travel.get(id)
    const r = rt.get(id)
    const sa = safe.get(id)
    setDraft((d) => ({ ...d, actuation: t ?? d.actuation, rtEnabled: r?.enabled ?? false, press: r?.press ?? d.press, release: r?.release ?? d.release, top: sa?.top ?? 0, bottom: sa?.bottom ?? 0, safeEnabled: sa?.enabled ?? false }))
  }

  const apply = async (what: 'travel' | 'rt' | 'safe') => {
    const targets = [...selected]
    if (!targets.length) return
    setBusy(true)
    setError(undefined)
    try {
      if (what === 'travel') {
        const list: KeyTravel[] = targets.map((id) => ({ id, actuation: draft.actuation }))
        await perf.setTravel(sel, list)
        setTravel((m) => new Map([...m, ...list.map((x) => [x.id, x.actuation] as const)]))
      } else if (what === 'rt') {
        const list: RapidTrigger[] = targets.map((id) => ({ id, enabled: draft.rtEnabled, press: draft.press, release: draft.release }))
        await perf.setRapidTriggers(sel, list)
        setRt((m) => new Map([...m, ...list.map((x) => [x.id, x] as const)]))
      } else {
        const list: SafeArea[] = targets.map((id) => ({ id, top: draft.top, bottom: draft.bottom, enabled: draft.safeEnabled }))
        await perf.setSafeAreas(list)
        setSafe((m) => new Map([...m, ...list.map((x) => [x.id, x] as const)]))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggleMonitor = async () => {
    try {
      if (monitoring) await perf.stopMonitoring()
      else await perf.startMonitoring(selected.size ? [...selected].slice(0, 9) : undefined)
      setMonitoring(!monitoring)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const toggleCalibration = async () => {
    try {
      if (calibrating) await perf.stopCalibration()
      else {
        setCalibrated(new Set())
        await perf.startCalibration()
      }
      setCalibrating(!calibrating)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="stack">
      {pcaps.experimental && <Notice>Hall-effect settings are implemented from the recovered protocol; travel units (0.001 mm) and firmware limits have not been confirmed on hardware yet. Start with small changes.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <Card
        title="Switches"
        actions={
          <div className="row">
            <Select value={layer} options={LAYERS.filter((l) => caps.layers.includes(l.id)).map((l) => ({ value: l.id, label: `${l.name} layer` }))} onChange={setLayer} disabled={busy} />
            <Select value={os} options={caps.osModes.map((o) => ({ value: o, label: o === 'macos' ? 'macOS' : 'Windows' }))} onChange={setOs} disabled={busy} />
            <Button small onClick={() => setSelected(new Set(ids))}>Select all</Button>
            <Button small variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <Toggle checked={monitoring} onChange={() => void toggleMonitor()} label="Live travel" />
          </div>
        }
      >
        <KeyboardStage
          layout={caps.layout}
          selected={selected}
          onKeyClick={(k, e) => selectKey(k.id, e.shiftKey || e.metaKey || e.ctrlKey)}
          decorate={(k) => {
            const t = travel.get(k.id)
            const s = live.get(k.id)
            const depth = s ? Math.min(1, s.distance / Math.max(1, pcaps.travel.max)) : 0
            return {
              sub: t !== undefined ? mm(t) : undefined,
              modified: (rt.get(k.id)?.enabled ?? false) || calibrated.has(k.id),
              color: s ? { r: Math.round(155 * depth), g: Math.round(255 * depth), b: Math.round(49 * depth) } : undefined,
              pressed: s?.pressed,
            }
          }}
        />
        <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          Click to select a key, shift-click to add more. The small number is the actuation point in mm; purple borders mark keys with rapid trigger.
        </div>
      </Card>
      <div className="grid cols-3">
        <Card title={`Actuation${first !== undefined ? ` — ${selected.size} key${selected.size > 1 ? 's' : ''}` : ''}`}>
          <div className="stack">
            <Field label={`Actuation point — ${mm(draft.actuation)} mm`}>
              <Slider value={draft.actuation} min={pcaps.travel.min} max={pcaps.travel.max} step={pcaps.travel.step} onChange={(v) => setDraft({ ...draft, actuation: v })} format={(v) => `${mm(v)} mm`} disabled={!selected.size} />
            </Field>
            <Button variant="primary" disabled={busy || !selected.size} onClick={() => void apply('travel')}>
              Apply to selected
            </Button>
          </div>
        </Card>
        <Card title="Rapid trigger">
          <div className="stack">
            <Toggle checked={draft.rtEnabled} onChange={(v) => setDraft({ ...draft, rtEnabled: v })} label="Enable rapid trigger" disabled={!selected.size} />
            <Field label={`Press sensitivity — ${mm(draft.press)} mm`}>
              <Slider value={draft.press} min={pcaps.rapidTrigger.min} max={pcaps.rapidTrigger.max} step={pcaps.rapidTrigger.step} onChange={(v) => setDraft({ ...draft, press: v })} format={(v) => `${mm(v)} mm`} disabled={!draft.rtEnabled} />
            </Field>
            <Field label={`Release sensitivity — ${mm(draft.release)} mm`}>
              <Slider value={draft.release} min={pcaps.rapidTrigger.min} max={pcaps.rapidTrigger.max} step={pcaps.rapidTrigger.step} onChange={(v) => setDraft({ ...draft, release: v })} format={(v) => `${mm(v)} mm`} disabled={!draft.rtEnabled} />
            </Field>
            <Button variant="primary" disabled={busy || !selected.size} onClick={() => void apply('rt')}>
              Apply to selected
            </Button>
          </div>
        </Card>
        <Card title="Dead zones & calibration">
          <div className="stack">
            <Toggle checked={draft.safeEnabled} onChange={(v) => setDraft({ ...draft, safeEnabled: v })} label="Enable dead zones" disabled={!selected.size} />
            <Field label={`Top dead zone — ${mm(draft.top)} mm`}>
              <Slider value={draft.top} min={0} max={1000} step={10} onChange={(v) => setDraft({ ...draft, top: v })} format={(v) => `${mm(v)} mm`} disabled={!draft.safeEnabled} />
            </Field>
            <Field label={`Bottom dead zone — ${mm(draft.bottom)} mm`}>
              <Slider value={draft.bottom} min={0} max={1000} step={10} onChange={(v) => setDraft({ ...draft, bottom: v })} format={(v) => `${mm(v)} mm`} disabled={!draft.safeEnabled} />
            </Field>
            <Button disabled={busy || !selected.size} onClick={() => void apply('safe')}>
              Apply dead zones
            </Button>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', width: '100%' }} />
            <Button variant={calibrating ? 'danger' : undefined} onClick={() => void toggleCalibration()}>
              {calibrating ? `Stop calibration (${calibrated.size} keys done)` : 'Calibrate switches'}
            </Button>
            <span className="dim" style={{ fontSize: 12 }}>While calibrating, press every key fully once.</span>
          </div>
        </Card>
      </div>
    </div>
  )
}
