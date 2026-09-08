import { useEffect, useState } from 'react'
import type { KeyboardSettings, ResetScope } from '@/model/keyboard'
import { Button, Card, Field, Notice, Select, Slider, Toggle } from '@/ui/components/kit'
import type { KeyboardPanelProps } from '../KeyboardPage'

export function SettingsPanel({ driver, caps }: KeyboardPanelProps) {
  const [settings, setSettings] = useState<KeyboardSettings>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState<ResetScope>()

  const load = async () => {
    try {
      setSettings(await driver.settings.read())
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
    const off = driver.on('os-change', (os) => setSettings((s) => (s ? { ...s, osMode: os } : s)))
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver])

  const update = async <K extends keyof KeyboardSettings>(key: K, value: NonNullable<KeyboardSettings[K]>) => {
    if (!settings) return
    setBusy(true)
    setError(undefined)
    try {
      await driver.settings.update(key, value)
      setSettings({ ...settings, [key]: value })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const reset = async (scope: ResetScope) => {
    setBusy(true)
    try {
      await driver.reset(scope)
      setConfirmReset(undefined)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return <div className="muted">Reading settings…</div>
  const debounceMs = Math.round(settings.debounceUs / 1000)
  return (
    <div className="stack">
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid cols-2">
        <Card title="Keyboard">
          <div className="stack">
            <Field label="Operating system layout">
              <Select value={settings.osMode} options={caps.osModes.map((o) => ({ value: o, label: o === 'macos' ? 'macOS' : 'Windows' }))} onChange={(v) => void update('osMode', v)} disabled={busy} />
            </Field>
            <Field label="Polling rate" hint="Changing the rate may make the keyboard re-enumerate; reconnect if it disappears.">
              <Select
                value={settings.pollingRate}
                options={driver.settings.pollingRates().map((r) => ({ value: r, label: `${r} Hz`, disabled: r > caps.features.maxPollingRate }))}
                onChange={(v) => void update('pollingRate', v)}
                disabled={busy}
              />
            </Field>
            <Field label="Sleep after inactivity (wireless)">
              <Select value={settings.sleepSeconds} options={driver.settings.sleepOptions().map((s) => ({ value: s, label: s === 0 ? 'Never' : s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h` }))} onChange={(v) => void update('sleepSeconds', v)} disabled={busy} />
            </Field>
            <Toggle checked={settings.winKeyLock} onChange={(v) => void update('winKeyLock', v)} disabled={busy} label="Win key lock" />
          </div>
        </Card>
        <Card title="Switches">
          <div className="stack">
            <Field label="Debounce mode">
              <Select
                value={settings.debounceMode}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'leading', label: 'Leading edge' },
                  { value: 'trailing', label: 'Trailing edge' },
                  { value: 'auto', label: 'Auto' },
                ]}
                onChange={(v) => void update('debounceMode', v)}
                disabled={busy}
              />
            </Field>
            <Field label={`Debounce time — ${debounceMs} ms`}>
              <Slider value={debounceMs} min={1} max={50} step={1} onChange={(v) => setSettings({ ...settings, debounceUs: v * 1000 })} onCommit={(v) => void update('debounceUs', v * 1000)} disabled={busy} format={(v) => `${v} ms`} />
            </Field>
            <Toggle checked={settings.adaptiveCalibration} onChange={(v) => void update('adaptiveCalibration', v)} disabled={busy} label="Adaptive calibration" />
            <Toggle checked={settings.comboOptimization} onChange={(v) => void update('comboOptimization', v)} disabled={busy} label="Anti-chatter (combo) optimisation" />
            {caps.features.wasdArrowSwap && <Toggle checked={!!settings.wasdArrowSwap} onChange={(v) => void update('wasdArrowSwap', v)} disabled={busy} label="Swap WASD and arrow keys" />}
            {caps.features.lowPowerMode && <Toggle checked={!!settings.lowPowerMode} onChange={(v) => void update('lowPowerMode', v)} disabled={busy} label="Low power mode" />}
          </div>
        </Card>
      </div>
      <Card title="Reset">
        <div className="row wrap">
          {(['keymap', 'lighting', 'usb', 'all'] as ResetScope[]).map((scope) => (
            <Button key={scope} variant={scope === 'all' ? 'danger' : undefined} disabled={busy} onClick={() => setConfirmReset(scope)}>
              {scope === 'keymap' ? 'Reset keymap' : scope === 'lighting' ? 'Reset lighting' : scope === 'usb' ? 'Reset USB' : 'Factory reset'}
            </Button>
          ))}
        </div>
        {confirmReset && (
          <div className="row" style={{ marginTop: 12 }}>
            <span>Really {confirmReset === 'all' ? 'factory reset the keyboard' : `reset ${confirmReset}`}?</span>
            <Button variant="danger" small onClick={() => void reset(confirmReset)}>
              Yes, reset
            </Button>
            <Button small variant="ghost" onClick={() => setConfirmReset(undefined)}>
              Cancel
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
