import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyId, Macro, MacroAction, MacroCapabilities, MacroLoop } from '@/model/keyboard'
import { MACRO_MOUSE_BUTTONS } from '@/drivers/k98pro/macros'
import { Button, Card, Field, Notice, Select, Slider } from '@/ui/components/kit'
import { KeyboardStage } from '../KeyboardStage'
import type { KeyboardPanelProps } from '../KeyboardPage'

const MODIFIER_CODES: Record<string, number> = { ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3, ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7 }
const MOUSE_BUTTON_CODES = [MACRO_MOUSE_BUTTONS.left, MACRO_MOUSE_BUTTONS.middle, MACRO_MOUSE_BUTTONS.right, MACRO_MOUSE_BUTTONS.back, MACRO_MOUSE_BUTTONS.forward]

export function MacrosPanel({ driver, caps }: KeyboardPanelProps) {
  const svc = driver.macros
  const [mcaps, setMcaps] = useState<MacroCapabilities>()
  const [macros, setMacros] = useState<Macro[]>([])
  const [dirty, setDirty] = useState(false)
  const [index, setIndex] = useState(0)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [bindKey, setBindKey] = useState<KeyId>()
  const [loop, setLoop] = useState<MacroLoop>('count')
  const [count, setCount] = useState(1)
  const lastEvent = useRef(0)
  const usageByCode = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of driver.actions.catalog()) if (e.browserCode && e.action.type === 'key') m.set(e.browserCode, e.action.usage)
    return m
  }, [driver])

  useEffect(() => {
    if (!svc) return
    let alive = true
    ;(async () => {
      try {
        const [c, list] = await Promise.all([svc.capabilities(), svc.list()])
        if (!alive) return
        setMcaps(c)
        setMacros(list)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    })()
    return () => {
      alive = false
    }
  }, [svc])

  useEffect(() => {
    if (!recording) return
    const push = (a: Omit<MacroAction, 'delayMs'>) => {
      const now = performance.now()
      const delayMs = lastEvent.current ? Math.round(now - lastEvent.current) : 0
      lastEvent.current = now
      update({ actions: [...(macros[index]?.actions ?? []), { ...a, delayMs }] })
    }
    const key = (state: 'down' | 'up') => (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.repeat) return
      const mod = MODIFIER_CODES[e.code]
      if (mod !== undefined) push({ kind: 'modifier', code: mod, state })
      else {
        const usage = usageByCode.get(e.code)
        if (usage !== undefined) push({ kind: 'key', code: usage, state })
      }
    }
    const mouse = (state: 'down' | 'up') => (e: MouseEvent) => {
      const code = MOUSE_BUTTON_CODES[e.button]
      if (code) push({ kind: 'mouse', code, state })
    }
    const down = key('down')
    const up = key('up')
    const mdown = mouse('down')
    const mup = mouse('up')
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousedown', mdown)
    window.addEventListener('mouseup', mup)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousedown', mdown)
      window.removeEventListener('mouseup', mup)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, macros, index])

  if (!svc) return <Notice>This keyboard has no macro storage.</Notice>
  if (error && !mcaps) return <Notice kind="error">{error}</Notice>
  if (!mcaps) return <div className="muted">Reading macros…</div>
  const current = macros[index]
  const used = svc.storageSize(macros)

  const update = (patch: Partial<Macro>) => {
    setMacros((list) => list.map((m, i) => (i === index ? { ...m, ...patch } : m)))
    setDirty(true)
  }

  const add = () => {
    if (macros.length >= mcaps.maxCount) return
    setMacros([...macros, { name: `Macro ${macros.length + 1}`, actions: [] }])
    setIndex(macros.length)
    setDirty(true)
  }

  const remove = () => {
    setMacros(macros.filter((_, i) => i !== index))
    setIndex(Math.max(0, index - 1))
    setDirty(true)
  }

  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await svc.save(macros)
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const bind = async () => {
    if (bindKey === undefined) return
    setBusy(true)
    try {
      await driver.keymap.write({ layer: 0, os: 'windows' }, [{ id: bindKey, keycode: driver.actions.toKeycode({ type: 'macro', index, loop, count }) }])
      setBindKey(undefined)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const describeAction = (a: MacroAction) => {
    if (a.kind === 'mouse') return `Mouse ${Object.entries(MACRO_MOUSE_BUTTONS).find(([, v]) => v === a.code)?.[0] ?? a.code}`
    return driver.actions.describe(a.code)
  }

  return (
    <div className="stack">
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid cols-3">
        <Card
          title={`Macros (${macros.length}/${mcaps.maxCount})`}
          actions={
            <Button small onClick={add} disabled={macros.length >= mcaps.maxCount}>
              + New
            </Button>
          }
        >
          <div className="stack" style={{ gap: 4 }}>
            {macros.map((m, i) => (
              <button key={i} className={['navitem', i === index ? 'active' : ''].join(' ')} onClick={() => setIndex(i)}>
                <span style={{ flex: 1 }}>{m.name || `Macro ${i + 1}`}</span>
                <span className="dim">{m.actions.length}</span>
              </button>
            ))}
            {!macros.length && <div className="dim">No macros yet.</div>}
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="meter">
              <span style={{ width: `${Math.min(100, (used / Math.max(1, mcaps.maxStorageBytes)) * 100)}%` }} />
            </div>
            <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
              {used} / {mcaps.maxStorageBytes} bytes
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="primary" disabled={!dirty || busy || used > mcaps.maxStorageBytes} onClick={() => void save()}>
              Save to keyboard
            </Button>
          </div>
        </Card>
        <Card
          title={current ? 'Edit macro' : 'Pick a macro'}
          actions={
            current && (
              <div className="row">
                <Button small variant={recording ? 'danger' : 'primary'} onClick={() => {
                  lastEvent.current = 0
                  setRecording(!recording)
                }}>
                  {recording ? '■ Stop recording' : '● Record'}
                </Button>
                <Button small variant="ghost" onClick={remove}>
                  Delete
                </Button>
              </div>
            )
          }
        >
          {current && (
            <div className="stack">
              <Field label="Name">
                <input className="input" value={current.name} maxLength={20} onChange={(e) => update({ name: e.target.value })} />
              </Field>
              {recording && <Notice kind="info">Recording — type keys or click mouse buttons; delays between events are captured.</Notice>}
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Action</th>
                    <th>State</th>
                    <th>Delay before (ms)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {current.actions.map((a, i) => (
                    <tr key={i}>
                      <td className="dim">{i + 1}</td>
                      <td>{describeAction(a)}</td>
                      <td>
                        <span className={['badge', a.state === 'down' ? 'accent' : ''].join(' ')}>{a.state}</span>
                      </td>
                      <td>
                        <input className="input" type="number" min={0} max={mcaps.maxDelayMs} value={a.delayMs} style={{ width: 90, minWidth: 0 }} onChange={(e) => update({ actions: current.actions.map((x, j) => (j === i ? { ...x, delayMs: Number(e.target.value) } : x)) })} />
                      </td>
                      <td>
                        <Button small variant="ghost" onClick={() => update({ actions: current.actions.filter((_, j) => j !== i) })}>
                          ✕
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!current.actions.length && <div className="dim">No actions — press Record and type.</div>}
              <div className="row">
                <Button small onClick={() => update({ actions: [] })} disabled={!current.actions.length}>
                  Clear
                </Button>
                <Button small onClick={() => update({ actions: current.actions.map((a) => ({ ...a, delayMs: 50 })) })} disabled={!current.actions.length}>
                  Set all delays to 50 ms
                </Button>
              </div>
            </div>
          )}
        </Card>
        <Card title="Bind to a key">
          {current ? (
            <div className="stack">
              <Field label="Trigger">
                <Select
                  value={loop}
                  options={[
                    { value: 'count', label: 'Play N times on press' },
                    { value: 'untilKeyUp', label: 'Repeat while held' },
                    { value: 'untilKeyDown', label: 'Repeat until any key' },
                  ]}
                  onChange={setLoop}
                />
              </Field>
              {loop === 'count' && (
                <Field label={`Times — ${count}`}>
                  <Slider value={count} min={1} max={255} onChange={setCount} />
                </Field>
              )}
              <div className="muted">Click a key below, then bind. (Default layer, Windows table.)</div>
              <KeyboardStage layout={caps.layout} selected={bindKey !== undefined ? new Set([bindKey]) : undefined} onKeyClick={(k) => setBindKey(k.id)} />
              <Button variant="primary" disabled={busy || bindKey === undefined || dirty} onClick={() => void bind()}>
                {dirty ? 'Save macros first' : `Bind “${current.name}”`}
              </Button>
            </div>
          ) : (
            <div className="dim">Select a macro to bind it.</div>
          )}
        </Card>
      </div>
    </div>
  )
}
