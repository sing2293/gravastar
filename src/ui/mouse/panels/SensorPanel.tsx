import { useEffect, useState } from 'react'
import type { ReportRate, SensorCapabilities, SensorSettings } from '@/model/mouse'
import { Card, Field, Notice, Select, Slider, Toggle } from '@/ui/components/kit'
import type { MousePanelProps } from '../MousePage'

export function SensorPanel({ driver, caps }: MousePanelProps) {
  const [scaps, setScaps] = useState<SensorCapabilities>()
  const [s, setS] = useState<SensorSettings>()
  const [mode, setMode] = useState<{ value: SensorSettings['sensorMode']; editable: boolean }>()
  const [rate, setRate] = useState<ReportRate>()
  const [rates, setRates] = useState<ReportRate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const load = async () => {
    try {
      const [c, cur, m, r, opts] = await Promise.all([driver.sensor.capabilities(), driver.sensor.get(), driver.sensor.sensorModeState(), driver.reportRate.get(), driver.reportRate.options()])
      setScaps(c)
      setS(cur)
      setMode(m)
      setRate(r)
      setRates(opts)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
    const off1 = driver.on('sensor-change', () => void load())
    const off2 = driver.on('report-rate-change', () => void load())
    return () => {
      off1()
      off2()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver])

  if (error && !s) return <Notice kind="error">{error}</Notice>
  if (!scaps || !s || !mode || rate === undefined) return <div className="muted">Reading sensor settings…</div>

  const update = async <K extends keyof SensorSettings>(key: K, value: NonNullable<SensorSettings[K]>) => {
    setBusy(true)
    setError(undefined)
    try {
      await driver.sensor.update(key, value)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const setRateHz = async (hz: ReportRate) => {
    setBusy(true)
    try {
      await driver.reportRate.set(hz)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid cols-2">
        <Card title="Polling">
          <div className="stack">
            <Field label="Report rate" hint={caps.model.maxReportRate < 8000 ? `This link supports up to ${caps.model.maxReportRate} Hz.` : undefined}>
              <Select value={rate} options={rates.map((r) => ({ value: r, label: `${r} Hz` }))} onChange={(v) => void setRateHz(v)} disabled={busy} />
            </Field>
            <Field label="Sensor mode" hint={mode.editable ? 'Low power extends battery life; high performance minimises latency.' : 'Fixed by the current link / report rate.'}>
              <Select
                value={mode.value}
                options={[
                  { value: 'lowPower', label: 'Low power' },
                  { value: 'highPerformance', label: 'High performance' },
                  { value: 'corded', label: 'Corded', disabled: true },
                ]}
                onChange={(v) => v !== 'corded' && void update('sensorMode', v)}
                disabled={busy || !mode.editable}
              />
            </Field>
          </div>
        </Card>
        <Card title={`PixArt ${scaps.sensor}`}>
          <div className="stack">
            {scaps.supports.lod && (
              <Field label="Lift-off distance">
                <Select value={s.lod} options={scaps.lodOptions} onChange={(v) => void update('lod', v)} disabled={busy} />
              </Field>
            )}
            {scaps.supports.motionSync && <Toggle checked={s.motionSync} onChange={(v) => void update('motionSync', v)} disabled={busy} label="Motion sync" />}
            {scaps.supports.rippleControl && <Toggle checked={s.rippleControl} onChange={(v) => void update('rippleControl', v)} disabled={busy} label="Ripple control" />}
            {scaps.supports.angleSnap && <Toggle checked={s.angleSnap} onChange={(v) => void update('angleSnap', v)} disabled={busy} label="Angle snapping" />}
            {scaps.supports.performanceMode && (
              <>
                <Toggle checked={s.performanceMode} onChange={(v) => void update('performanceMode', v)} disabled={busy} label="Highest performance" />
                <Field label="Highest performance for">
                  <Select value={s.performanceSeconds} options={scaps.performanceSecondsOptions.map((sec) => ({ value: sec, label: sec < 60 ? `${sec} s` : `${sec / 60} min` }))} onChange={(v) => void update('performanceSeconds', v)} disabled={busy || !s.performanceMode} />
                </Field>
              </>
            )}
            {scaps.supports.angleTune && (
              <Field label={`Angle tune — ${s.angleTune ?? 0}°`}>
                <Slider value={s.angleTune ?? 0} min={-30} max={30} onChange={(v) => setS({ ...s, angleTune: v })} onCommit={(v) => void update('angleTune', v)} disabled={busy} format={(v) => `${v}°`} />
              </Field>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
