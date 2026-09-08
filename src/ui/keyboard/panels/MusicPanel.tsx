import { useEffect, useMemo, useRef, useState } from 'react'
import { audioSources } from '@/audio/capture'
import { MusicSyncEngine, musicEngineFor } from '@/audio/musicSync'
import type { AudioSourceKind, MusicSyncStatus } from '@/audio/types'
import { Button, Card, Field, Notice, Select, Slider, hexToRgb, rgbToHex } from '@/ui/components/kit'
import { KeyboardStage } from '../KeyboardStage'
import type { KeyboardPanelProps } from '../KeyboardPage'

export function MusicPanel({ id, driver, caps, summary }: KeyboardPanelProps) {
  const engine = useMemo(() => musicEngineFor(id, driver, caps.layout), [id, driver, caps.layout])
  const [status, setStatus] = useState<MusicSyncStatus>(engine.getStatus())
  const [source, setSource] = useState<AudioSourceKind>('system')
  const [options, setOptions] = useState(engine.options)
  const [starting, setStarting] = useState(false)
  const [, tick] = useState(0)
  const rafRef = useRef(0)
  const sources = useMemo(() => audioSources(), [])

  useEffect(() => engine.onStatus(setStatus), [engine])
  useEffect(() => {
    const loop = () => {
      tick((n) => (n + 1) % 1e6)
      rafRef.current = requestAnimationFrame(loop)
    }
    if (status.running) rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [status.running])

  const update = (patch: Partial<typeof options>) => {
    const next = { ...options, ...patch }
    setOptions(next)
    engine.update(patch)
  }

  const start = async () => {
    setStarting(true)
    try {
      await engine.start(source)
    } catch {
      /* status carries the error */
    } finally {
      setStarting(false)
    }
  }

  const frame = engine.lastFrame
  const lighting = engine.lastLighting
  const colorById = new Map<number, { r: number; g: number; b: number }>()
  if (lighting) {
    if ('all' in lighting) for (const k of caps.layout.keys) colorById.set(k.id, lighting.all)
    else for (const c of lighting.keys) colorById.set(c.id, c.color)
  }
  const preset = MusicSyncEngine.presets().find((p) => p.id === options.preset)
  const streamingSupported = caps.features.keyIdRGB || caps.features.fullKeysRGB

  return (
    <div className="stack">
      {!streamingSupported && <Notice>The firmware did not report real-time colour streaming; music sync may not light up. It is safe to try.</Notice>}
      {summary.link === 'dongle' && <Notice>Over the 2.4 GHz receiver the keyboard uses a separate raw report for streaming. This path hasn't been validated on hardware yet.</Notice>}
      {status.error && <Notice kind="error">{status.error}</Notice>}
      <div className="grid cols-2">
        <Card title="Audio source">
          <div className="stack">
            {sources.map((s) => (
              <label key={s.kind} className="row" style={{ alignItems: 'flex-start', gap: 10, opacity: s.available ? 1 : 0.5 }}>
                <input type="radio" name="source" value={s.kind} checked={source === s.kind} disabled={!s.available || status.running} onChange={() => setSource(s.kind)} style={{ marginTop: 3 }} />
                <span>
                  <div>{s.label}</div>
                  <div className="dim" style={{ fontSize: 12 }}>{s.hint}</div>
                </span>
              </label>
            ))}
            <div className="row">
              {status.running ? (
                <Button variant="danger" onClick={() => void engine.stop()}>
                  Stop
                </Button>
              ) : (
                <Button variant="primary" disabled={starting} onClick={() => void start()}>
                  {starting ? 'Starting…' : 'Start music sync'}
                </Button>
              )}
              {status.running && <span className="muted">{status.fps} frames/s to the keyboard</span>}
            </div>
          </div>
        </Card>
        <Card title="Look">
          <div className="stack">
            <Field label="Preset" hint={preset?.description}>
              <Select value={options.preset} options={MusicSyncEngine.presets().map((p) => ({ value: p.id, label: p.name }))} onChange={(v) => update({ preset: v })} />
            </Field>
            <Field label={`Sensitivity — ${Math.round(options.sensitivity * 100)}%`}>
              <Slider value={Math.round(options.sensitivity * 100)} min={25} max={250} step={5} onChange={(v) => update({ sensitivity: v / 100 })} format={(v) => `${v}%`} />
            </Field>
            <Field label={`Update rate — ${options.maxFps} fps`} hint="Lower this if the keyboard lags behind the music.">
              <Slider value={options.maxFps} min={5} max={40} step={1} onChange={(v) => update({ maxFps: v })} format={(v) => `${v} fps`} />
            </Field>
            <Field label="Colour">
              <div className="row">
                <input type="color" className="color-input" value={rgbToHex(options.color)} disabled={!preset?.usesColor} onChange={(e) => update({ color: hexToRgb(e.target.value) })} />
                <span className="dim" style={{ fontSize: 12 }}>{preset?.usesColor ? 'Used by this preset' : 'This preset picks its own colours'}</span>
              </div>
            </Field>
          </div>
        </Card>
      </div>
      <Card title="Live">
        <div className="stack">
          <div className="bars">{Array.from(frame?.bands ?? new Float32Array(24)).map((v, i) => <span key={i} style={{ height: `${Math.max(2, v * 100)}%` }} />)}</div>
          <div className="row" style={{ gap: 16 }}>
            <span className="muted" style={{ minWidth: 60 }}>Level</span>
            <div className="meter" style={{ flex: 1 }}>
              <span style={{ width: `${(frame?.level ?? 0) * 100}%` }} />
            </div>
            <span className={['badge', frame?.beat ? 'accent' : ''].join(' ')}>beat</span>
          </div>
          <KeyboardStage layout={caps.layout} decorate={(k) => ({ color: colorById.get(k.id) })} />
        </div>
      </Card>
    </div>
  )
}
