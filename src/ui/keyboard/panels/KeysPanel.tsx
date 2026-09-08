import { useEffect, useMemo, useState } from 'react'
import type { KeyCatalogEntry, KeyId, Keycode, Layer, LayerSelector, OsMode } from '@/model/keyboard'
import { LAYERS } from '@/model/keyboard'
import { Button, Card, Field, Notice, Select } from '@/ui/components/kit'
import { KeyboardStage } from '../KeyboardStage'
import type { KeyboardPanelProps } from '../KeyboardPage'

const CATEGORY_LABELS: Record<string, string> = {
  basic: 'Keys',
  modifiers: 'Modifiers',
  media: 'Media',
  mouse: 'Mouse',
  control: 'Control',
  lighting: 'Lighting',
  combos: 'Shortcuts',
  system: 'System',
  special: 'Layers & special',
  macro: 'Macros',
  triMode: 'Connection',
  gamepadXbox: 'Gamepad (Xbox)',
  gamepad: 'Gamepad',
  decorative1: 'Accent light 1',
  decorative2: 'Accent light 2',
  decorative3: 'Accent light 3',
}

export function KeysPanel({ driver, caps }: KeyboardPanelProps) {
  const [layer, setLayer] = useState<Layer>(0)
  const [os, setOs] = useState<OsMode>('windows')
  const [bindings, setBindings] = useState<Map<KeyId, Keycode>>(new Map())
  const [selected, setSelected] = useState<KeyId>()
  const [category, setCategory] = useState('basic')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const sel: LayerSelector = useMemo(() => ({ layer, os }), [layer, os])
  const catalog = useMemo(() => driver.actions.catalog(), [driver])
  const categories = useMemo(() => [...new Set(catalog.map((e) => e.category))], [catalog])
  const ids = useMemo(() => caps.layout.keys.map((k) => k.id), [caps.layout])

  useEffect(() => {
    let alive = true
    setBusy(true)
    driver.keymap
      .read(sel, ids)
      .then((list) => {
        if (!alive) return
        setBindings(new Map(list.map((b) => [b.id, b.keycode])))
        setError(undefined)
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
  }, [driver, sel, ids])

  const assign = async (keycode: Keycode) => {
    if (selected === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      await driver.keymap.write(sel, [{ id: selected, keycode }])
      setBindings((m) => new Map(m).set(selected, keycode))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const resetLayer = async () => {
    setBusy(true)
    try {
      await driver.keymap.reset(sel)
      const list = await driver.keymap.read(sel, ids)
      setBindings(new Map(list.map((b) => [b.id, b.keycode])))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const entries = catalog.filter((e) => (search ? e.label.toLowerCase().includes(search.toLowerCase()) : e.category === category))
  const selectedKey = caps.layout.keys.find((k) => k.id === selected)
  const selectedCode = selected !== undefined ? bindings.get(selected) : undefined

  return (
    <div className="stack">
      {error && <Notice kind="error">{error}</Notice>}
      <Card
        title="Key mapping"
        actions={
          <div className="row">
            <Select value={layer} options={LAYERS.filter((l) => caps.layers.includes(l.id)).map((l) => ({ value: l.id, label: `${l.name} layer` }))} onChange={setLayer} disabled={busy} />
            <Select value={os} options={caps.osModes.map((o) => ({ value: o, label: o === 'macos' ? 'macOS table' : 'Windows table' }))} onChange={setOs} disabled={busy} />
            <Button small disabled={busy} onClick={() => void resetLayer()}>
              Reset this layer
            </Button>
          </div>
        }
      >
        <KeyboardStage
          layout={caps.layout}
          selected={selected !== undefined ? new Set([selected]) : undefined}
          onKeyClick={(k) => setSelected(k.id)}
          decorate={(k) => {
            const code = bindings.get(k.id)
            if (code === undefined) return undefined
            const isDefault = layer === 0 ? code === k.defaultKeycode : code === 0 || code === 1
            return { label: isDefault ? k.label : driver.actions.describe(code), modified: !isDefault }
          }}
        />
        <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          Click a key, then pick what it should do. Purple borders mark remapped keys. Fn layers apply while Fn is held.
        </div>
      </Card>
      <Card
        title={selectedKey ? `Assign “${selectedKey.label}” (key #${selectedKey.id})` : 'Select a key on the keyboard'}
        actions={
          selectedKey && (
            <div className="row">
              <span className="muted">
                Now: <b>{selectedCode !== undefined ? driver.actions.describe(selectedCode) : '…'}</b>
              </span>
              <Button small disabled={busy} onClick={() => void assign(0)}>
                Blank
              </Button>
              {layer > 0 && (
                <Button small disabled={busy} onClick={() => void assign(1)}>
                  Transparent
                </Button>
              )}
              <Button small disabled={busy} onClick={() => void assign(selectedKey.defaultKeycode)}>
                Default
              </Button>
            </div>
          )
        }
      >
        <div className="picker">
          <div className="cats">
            <Field label="Search">
              <input className="input" placeholder="e.g. Volume" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
            {categories.map((c) => (
              <button key={c} className={['navitem', c === category && !search ? 'active' : ''].join(' ')} onClick={() => {
                setCategory(c)
                setSearch('')
              }}>
                {CATEGORY_LABELS[c] ?? c}
              </button>
            ))}
          </div>
          <div className="entries">
            {entries.map((e: KeyCatalogEntry) => (
              <button key={`${e.category}:${e.keycode}`} className={['chip', selectedCode === e.keycode ? 'active' : ''].join(' ')} disabled={busy || selected === undefined} title={`0x${e.keycode.toString(16)}`} onClick={() => void assign(e.keycode)}>
                {e.label}
              </button>
            ))}
            {!entries.length && <span className="dim">Nothing matches.</span>}
          </div>
        </div>
      </Card>
    </div>
  )
}
