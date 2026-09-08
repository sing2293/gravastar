import { useEffect, useMemo, useState } from 'react'
import { MODIFIERS, type Modifier } from '@/model/device'
import type { MouseKeyFunction, MouseKeySlot, MouseMacro, MouseMacroEvent } from '@/model/mouse'
import { catalog as k98Catalog } from '@/drivers/k98pro/keycodes'
import { Button, Card, Field, Notice, Select, Slider, Toggle } from '@/ui/components/kit'
import type { MousePanelProps } from '../MousePage'

type FnKind = MouseKeyFunction['type']

const KIND_LABELS: { value: FnKind; label: string }[] = [
  { value: 'button', label: 'Mouse button' },
  { value: 'dpi', label: 'DPI switch' },
  { value: 'scroll', label: 'Scroll' },
  { value: 'fire', label: 'Fire key (auto-click)' },
  { value: 'combo', label: 'Keyboard shortcut' },
  { value: 'media', label: 'Media key' },
  { value: 'macro', label: 'Macro' },
  { value: 'dpiLock', label: 'DPI lock (sniper)' },
  { value: 'reportRateSwitch', label: 'Report-rate switch' },
  { value: 'disabled', label: 'Disabled' },
]

const MEDIA: { value: number; label: string }[] = [
  { value: 0x00cd, label: 'Play / Pause' },
  { value: 0x00b5, label: 'Next track' },
  { value: 0x00b6, label: 'Previous track' },
  { value: 0x00b7, label: 'Stop' },
  { value: 0x00e2, label: 'Mute' },
  { value: 0x00e9, label: 'Volume +' },
  { value: 0x00ea, label: 'Volume −' },
  { value: 0x0183, label: 'Media player' },
  { value: 0x018a, label: 'Email' },
  { value: 0x0192, label: 'Calculator' },
  { value: 0x0194, label: 'My Computer' },
  { value: 0x0223, label: 'Browser home' },
  { value: 0x0221, label: 'Search' },
  { value: 0x0224, label: 'Browser back' },
  { value: 0x0225, label: 'Browser forward' },
  { value: 0x0227, label: 'Refresh' },
]

const MOD_LABELS: Record<Modifier, string> = { lctrl: 'Ctrl', lshift: 'Shift', lalt: 'Alt', lgui: 'Win/Cmd', rctrl: 'R-Ctrl', rshift: 'R-Shift', ralt: 'R-Alt', rgui: 'R-Win' }
const MODIFIER_CODES: Record<string, Modifier> = { ControlLeft: 'lctrl', ShiftLeft: 'lshift', AltLeft: 'lalt', MetaLeft: 'lgui', ControlRight: 'rctrl', ShiftRight: 'rshift', AltRight: 'ralt', MetaRight: 'rgui' }
const MOUSE_MACRO_CODES = [1, 4, 2, 8, 16] // button index → macro mouse value

function defaultFor(kind: FnKind, current: MouseKeyFunction, dpi: number): MouseKeyFunction {
  if (current.type === kind) return current
  switch (kind) {
    case 'button':
      return { type: 'button', button: 'left' }
    case 'dpi':
      return { type: 'dpi', action: 'loop' }
    case 'scroll':
      return { type: 'scroll', direction: 'left' }
    case 'fire':
      return { type: 'fire', times: 3, interval: 30 }
    case 'combo':
      return { type: 'combo', modifiers: ['lctrl'], usage: 0x06 }
    case 'media':
      return { type: 'media', usage: 0x00cd }
    case 'macro':
      return { type: 'macro', cycles: 1 }
    case 'dpiLock':
      return { type: 'dpiLock', dpi }
    case 'reportRateSwitch':
      return { type: 'reportRateSwitch' }
    case 'raw':
      return current
    default:
      return { type: 'disabled' }
  }
}

export function MouseKeysPanel({ driver }: MousePanelProps) {
  const [slots, setSlots] = useState<MouseKeySlot[]>()
  const [selected, setSelected] = useState(0)
  const [draft, setDraft] = useState<MouseKeyFunction>()
  const [macro, setMacro] = useState<MouseMacro>({ name: 'Macro', events: [] })
  const [recording, setRecording] = useState(false)
  const [debounce, setDebounce] = useState(8)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const basicKeys = useMemo(() => k98Catalog().filter((e) => e.category === 'basic' && e.action.type === 'key').map((e) => ({ value: (e.action as { usage: number }).usage, label: e.label })), [])

  const load = async () => {
    try {
      const [list, d] = await Promise.all([driver.keys.list(), driver.keys.getDebounce()])
      setSlots(list)
      setDebounce(d)
      const s = list.find((x) => x.slot === selected) ?? list[0]
      if (s) {
        setDraft(s.fn)
        if (s.macro) setMacro(s.macro)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver])

  useEffect(() => {
    if (!recording) return
    let last = 0
    const push = (e: Omit<MouseMacroEvent, 'delayMs'>) => {
      const now = performance.now()
      const delayMs = last ? Math.max(10, Math.round(now - last)) : 10
      last = now
      setMacro((m) => ({ ...m, events: [...m.events, { ...e, delayMs }].slice(0, driver.keys.macroCapabilities().maxEvents) }))
    }
    const key = (state: 'down' | 'up') => (ev: KeyboardEvent) => {
      ev.preventDefault()
      if (ev.repeat) return
      const mod = MODIFIER_CODES[ev.code]
      if (mod) push({ kind: 'modifier', code: 1 << MODIFIERS.indexOf(mod), state })
      else {
        const usage = basicKeys.find((k) => k98Catalog().find((c) => c.browserCode === ev.code && c.action.type === 'key' && (c.action as { usage: number }).usage === k.value))?.value
        if (usage !== undefined) push({ kind: 'key', code: usage, state })
      }
    }
    const mouse = (state: 'down' | 'up') => (ev: MouseEvent) => {
      const code = MOUSE_MACRO_CODES[ev.button]
      if (code) push({ kind: 'mouse', code, state })
    }
    const d = key('down')
    const u = key('up')
    const md = mouse('down')
    const mu = mouse('up')
    window.addEventListener('keydown', d)
    window.addEventListener('keyup', u)
    window.addEventListener('mousedown', md)
    window.addEventListener('mouseup', mu)
    return () => {
      window.removeEventListener('keydown', d)
      window.removeEventListener('keyup', u)
      window.removeEventListener('mousedown', md)
      window.removeEventListener('mouseup', mu)
    }
  }, [recording, basicKeys, driver])

  if (error && !slots) return <Notice kind="error">{error}</Notice>
  if (!slots || !draft) return <div className="muted">Reading buttons…</div>
  const slot = slots.find((s) => s.slot === selected) ?? slots[0]!
  const describe = (fn: MouseKeyFunction): string => {
    switch (fn.type) {
      case 'button':
        return `${fn.button[0]!.toUpperCase()}${fn.button.slice(1)} click`
      case 'dpi':
        return `DPI ${fn.action}`
      case 'scroll':
        return `Scroll ${fn.direction}`
      case 'fire':
        return `Fire ×${fn.times || '∞'} every ${fn.interval} ms`
      case 'combo':
        return [...fn.modifiers.map((m) => MOD_LABELS[m]), basicKeys.find((k) => k.value === fn.usage)?.label ?? `0x${fn.usage.toString(16)}`].join('+')
      case 'media':
        return MEDIA.find((m) => m.value === fn.usage)?.label ?? `Media 0x${fn.usage.toString(16)}`
      case 'macro':
        return `Macro (${fn.cycles === 'untilPressedAgain' ? 'toggle' : fn.cycles === 'untilReleased' ? 'while held' : fn.cycles === 'untilAnyKey' ? 'until any key' : `×${fn.cycles}`})`
      case 'dpiLock':
        return `DPI lock ${fn.dpi}`
      case 'reportRateSwitch':
        return 'Report-rate switch'
      case 'raw':
        return `Raw ${fn.functionType}/${fn.param}`
      default:
        return 'Disabled'
    }
  }

  const apply = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await driver.keys.set(slot.slot, draft, draft.type === 'macro' ? macro : undefined)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    setBusy(true)
    try {
      await driver.keys.restore(slot.slot)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const leftCount = slots.filter((s) => s.fn.type === 'button' && s.fn.button === 'left').length
  const wouldLoseLeft = slot.fn.type === 'button' && slot.fn.button === 'left' && leftCount === 1 && !(draft.type === 'button' && draft.button === 'left')

  return (
    <div className="stack">
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid cols-2">
        <Card title="Buttons">
          <div className="stack" style={{ gap: 4 }}>
            {slots.map((s) => (
              <button key={s.slot} className={['navitem', s.slot === slot.slot ? 'active' : ''].join(' ')} onClick={() => {
                setSelected(s.slot)
                setDraft(s.fn)
                if (s.macro) setMacro(s.macro)
              }}>
                <span style={{ flex: 1 }}>{s.label}</span>
                <span className="dim">{describe(s.fn)}</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label={`Click debounce — ${debounce} ms`} hint={debounce < (driver.keys.debounceRange.warnBelow ?? 0) ? 'Below the recommended minimum: double-clicks may register accidentally.' : undefined}>
              <Slider value={debounce} min={driver.keys.debounceRange.min} max={driver.keys.debounceRange.max} onChange={setDebounce} onCommit={(v) => void driver.keys.setDebounce(v).catch((e: Error) => setError(e.message))} format={(v) => `${v} ms`} />
            </Field>
          </div>
        </Card>
        <Card
          title={`${slot.label} → ${describe(draft)}`}
          actions={
            <Button small variant="ghost" disabled={busy} onClick={() => void restore()}>
              Restore default
            </Button>
          }
        >
          <div className="stack">
            <Field label="Function">
              <Select value={draft.type} options={KIND_LABELS} onChange={(k) => setDraft(defaultFor(k, draft, 400))} />
            </Field>
            {draft.type === 'button' && (
              <Select value={draft.button} options={(['left', 'right', 'middle', 'back', 'forward'] as const).map((b) => ({ value: b, label: b }))} onChange={(b) => setDraft({ type: 'button', button: b })} />
            )}
            {draft.type === 'dpi' && <Select value={draft.action} options={[{ value: 'loop', label: 'Cycle stages' }, { value: 'up', label: 'DPI +' }, { value: 'down', label: 'DPI −' }]} onChange={(a) => setDraft({ type: 'dpi', action: a })} />}
            {draft.type === 'scroll' && <Select value={draft.direction} options={[{ value: 'left', label: 'Scroll left' }, { value: 'right', label: 'Scroll right' }]} onChange={(d) => setDraft({ type: 'scroll', direction: d })} />}
            {draft.type === 'fire' && (
              <>
                <Field label={`Clicks per press — ${draft.times || 'repeat while held'}`}>
                  <Slider value={draft.times} min={0} max={3} onChange={(v) => setDraft({ ...draft, times: v })} format={(v) => (v ? String(v) : '∞')} />
                </Field>
                <Field label={`Interval — ${draft.interval} ms`}>
                  <Slider value={draft.interval} min={10} max={255} onChange={(v) => setDraft({ ...draft, interval: v })} format={(v) => `${v} ms`} />
                </Field>
              </>
            )}
            {draft.type === 'combo' && (
              <>
                <div className="row wrap">
                  {(['lctrl', 'lshift', 'lalt', 'lgui'] as Modifier[]).map((m) => (
                    <Toggle key={m} checked={draft.modifiers.includes(m)} onChange={(on) => setDraft({ ...draft, modifiers: on ? [...draft.modifiers, m].slice(-2) : draft.modifiers.filter((x) => x !== m) })} label={MOD_LABELS[m]} />
                  ))}
                </div>
                <Field label="Key" hint="At most two modifiers plus one key (vendor limit).">
                  <Select value={draft.usage} options={basicKeys} onChange={(u) => setDraft({ ...draft, usage: u })} />
                </Field>
              </>
            )}
            {draft.type === 'media' && <Select value={draft.usage} options={MEDIA} onChange={(u) => setDraft({ type: 'media', usage: u })} />}
            {draft.type === 'dpiLock' && (
              <Field label={`Locked DPI — ${draft.dpi}`}>
                <Slider value={draft.dpi} min={100} max={1000} step={50} onChange={(v) => setDraft({ type: 'dpiLock', dpi: v })} format={(v) => `${v}`} />
              </Field>
            )}
            {draft.type === 'macro' && (
              <div className="stack">
                <Field label="Name">
                  <input className="input" value={macro.name} maxLength={30} onChange={(e) => setMacro({ ...macro, name: e.target.value })} />
                </Field>
                <Field label="Repeat">
                  <Select
                    value={typeof draft.cycles === 'number' ? 'count' : draft.cycles}
                    options={[
                      { value: 'count', label: 'N times' },
                      { value: 'untilReleased', label: 'While held' },
                      { value: 'untilPressedAgain', label: 'Until pressed again' },
                      { value: 'untilAnyKey', label: 'Until any key' },
                    ]}
                    onChange={(v) => setDraft({ type: 'macro', cycles: v === 'count' ? 1 : v })}
                  />
                </Field>
                {typeof draft.cycles === 'number' && (
                  <Field label={`Times — ${draft.cycles}`}>
                    <Slider value={draft.cycles} min={1} max={250} onChange={(v) => setDraft({ type: 'macro', cycles: v })} />
                  </Field>
                )}
                <div className="row">
                  <Button small variant={recording ? 'danger' : 'primary'} onClick={() => setRecording(!recording)}>
                    {recording ? '■ Stop' : '● Record'}
                  </Button>
                  <Button small onClick={() => setMacro({ ...macro, events: [] })}>
                    Clear
                  </Button>
                  <span className="dim">{macro.events.length} / {driver.keys.macroCapabilities().maxEvents} events</span>
                </div>
                <div className="mono dim" style={{ maxHeight: 120, overflow: 'auto' }}>
                  {macro.events.map((e, i) => (
                    <div key={i}>
                      {e.kind} {e.code} {e.state} +{e.delayMs}ms
                    </div>
                  ))}
                </div>
              </div>
            )}
            {wouldLoseLeft && <Notice>This is the only left-click button; reassigning it would leave you without a left click.</Notice>}
            <Button variant="primary" disabled={busy || wouldLoseLeft || (draft.type === 'macro' && (!macro.events.length || !macro.name))} onClick={() => void apply()}>
              Write to mouse
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
