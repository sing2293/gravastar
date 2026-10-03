import { useEffect, useRef, useState } from 'react'
import type { SensorSettings } from '@/model/mouse'
import { Button, Card, Field, Notice, Select, Toggle } from '@/ui/components/kit'
import type { MousePanelProps } from '../MousePage'

export function MouseSettingsPanel({ driver, caps, summary }: MousePanelProps) {
  const [sleep, setSleep] = useState<number>()
  const [power, setPower] = useState<Pick<SensorSettings, 'performanceMode' | 'performanceSeconds' | 'sensorMode'>>()
  const [powerSupported, setPowerSupported] = useState(false)
  const [profile, setProfile] = useState<{ current: number; supported: boolean }>()
  const [longRange, setLongRange] = useState<{ supported: boolean; enabled: boolean }>()
  const [pairing, setPairing] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [confirmReset, setConfirmReset] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    try {
      setSleep(await driver.power.getSleepSeconds())
      const [sensor, sensorCaps] = await Promise.all([driver.sensor.get(), driver.sensor.capabilities()])
      setPower({ performanceMode: sensor.performanceMode, performanceSeconds: sensor.performanceSeconds, sensorMode: sensor.sensorMode })
      setPowerSupported(sensorCaps.supports.performanceMode || sensorCaps.supports.sensorMode)
      setProfile(await driver.profiles.get())
      if (driver.dongle) setLongRange(await driver.dongle.longRange())
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
    return driver.on('profile-change', () => void load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver])

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await fn()
      await load()
      if (ok) setNotice(ok)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const exportSettings = async () => {
    const bytes = await driver.exportSettings()
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${summary.product.displayName.replace(/\s+/g, '-')}-settings.bin`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importSettings = async (file: File | undefined) => {
    if (!file) return
    await run(async () => driver.importSettings(new Uint8Array(await file.arrayBuffer())), 'Settings imported.')
  }

  return (
    <div className="stack">
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="info">{notice}</Notice>}
      <div className="grid cols-2">
        <Card title="Power saving">
          <div className="stack">
            <div className="dim" style={{ fontSize: 12 }}>
              Left alone, the mouse dozes off after a few seconds: its light goes out and it stops accepting changes
              until you move it again. These three settings are what decide that. Music sync holds them open while it
              runs and puts them back afterwards — turn them off here to keep the mouse awake all the time.
            </div>
            <div className="row">
              <Button
                variant="primary"
                disabled={busy || !powerSupported}
                onClick={() =>
                  void run(async () => {
                    await driver.power.setSleepSeconds(900)
                    await driver.sensor.update('performanceSeconds', 900)
                    await driver.sensor.update('performanceMode', true)
                    await driver.sensor.update('sensorMode', 'highPerformance')
                  }, 'Power saving turned off — the mouse stays awake for 15 minutes at a time. It will use more battery.')
                }
              >
                Turn power saving off
              </Button>
              <Button
                disabled={busy || !powerSupported}
                onClick={() =>
                  void run(async () => {
                    await driver.power.setSleepSeconds(60)
                    await driver.sensor.update('performanceMode', false)
                    await driver.sensor.update('sensorMode', 'lowPower')
                  }, 'Battery-saving defaults restored.')
                }
              >
                Back to battery saving
              </Button>
            </div>
            <Field label="Sleep / light-off after" hint="Also turns the light bar off once the mouse has been still this long.">
              <Select value={sleep ?? 10} options={driver.power.options().map((s) => ({ value: s, label: s < 60 ? `${s} s` : `${s / 60} min` }))} onChange={(v) => void run(() => driver.power.setSleepSeconds(v))} disabled={busy || sleep === undefined} />
            </Field>
            {power && (
              <>
                <Toggle checked={power.performanceMode} onChange={(v) => void run(() => driver.sensor.update('performanceMode', v))} disabled={busy} label="Highest performance (keeps the mouse fully awake)" />
                <Field label="Highest performance for">
                  <Select value={power.performanceSeconds} options={driver.power.options().map((s) => ({ value: s, label: s < 60 ? `${s} s` : `${s / 60} min` }))} onChange={(v) => void run(() => driver.sensor.update('performanceSeconds', v))} disabled={busy || !power.performanceMode} />
                </Field>
                <Field label="Sensor mode" hint="Low power saves battery; high performance keeps latency down and the mouse responsive.">
                  <Select
                    value={power.sensorMode === 'corded' ? 'highPerformance' : power.sensorMode}
                    options={[
                      { value: 'lowPower', label: 'Low power' },
                      { value: 'highPerformance', label: 'High performance' },
                    ]}
                    onChange={(v) => void run(() => driver.sensor.update('sensorMode', v))}
                    disabled={busy || power.sensorMode === 'corded'}
                  />
                </Field>
              </>
            )}
            {driver.dongle && longRange?.supported && (
              <Toggle checked={longRange.enabled} onChange={(v) => void run(() => driver.dongle!.setLongRange(v))} disabled={busy} label="Long-range mode (receiver)" />
            )}
          </div>
        </Card>
        <Card title="Profiles">
          <div className="stack">
            {profile?.supported ? (
              <Field label="Onboard profile">
                <Select value={profile.current} options={Array.from({ length: driver.profiles.count }, (_, i) => ({ value: i, label: `Profile ${i + 1}` }))} onChange={(v) => void run(() => driver.profiles.select(v), `Switched to profile ${v + 1}.`)} disabled={busy} />
              </Field>
            ) : (
              <div className="dim">This mouse does not support switching onboard profiles.</div>
            )}
          </div>
        </Card>
        {driver.dongle && (
          <Card title="Receiver">
            <div className="stack">
              <div className="muted">Pair a mouse with this receiver: press Pair, then hold the mouse's pairing combo within 20 s.</div>
              <div className="row">
                <Button disabled={busy || !!pairing} onClick={() => {
                  setPairing('Pairing…')
                  void driver.dongle!.pair((status, left) => setPairing(status === 'pairing' ? `Pairing… ${left}s left` : status === 'success' ? 'Paired!' : 'Pairing failed')).finally(() => setTimeout(() => setPairing(undefined), 3000))
                }}>
                  Pair
                </Button>
                {pairing && <span className="muted">{pairing}</span>}
              </div>
            </div>
          </Card>
        )}
        <Card title="Backup">
          <div className="stack">
            <div className="row">
              <Button disabled={busy} onClick={() => void exportSettings()}>
                Export settings (.bin)
              </Button>
              <Button disabled={busy} onClick={() => fileRef.current?.click()}>
                Import…
              </Button>
              <input ref={fileRef} type="file" accept=".bin" hidden onChange={(e) => void importSettings(e.target.files?.[0])} />
            </div>
            <div className="dim" style={{ fontSize: 12 }}>Compatible with the vendor tool's backup files (same {caps.model.sensor} sensor only).</div>
          </div>
        </Card>
      </div>
      <Card title="Reset">
        <div className="row">
          <Button variant="danger" disabled={busy} onClick={() => setConfirmReset(true)}>
            Factory reset
          </Button>
          {confirmReset && (
            <>
              <span>Erase all settings on the mouse?</span>
              <Button small variant="danger" onClick={() => {
                setConfirmReset(false)
                void run(() => driver.factoryReset(), 'Mouse reset to factory settings.')
              }}>
                Yes, reset
              </Button>
              <Button small variant="ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
