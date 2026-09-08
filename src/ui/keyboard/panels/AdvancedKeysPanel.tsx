import { useEffect, useMemo, useState } from 'react'
import type { AdvancedKey, AdvancedKeyType, DksTrigger, KeyId, Layer, LayerSelector, OsMode, SocdMode } from '@/model/keyboard'
import { LAYERS } from '@/model/keyboard'
import { Button, Card, Field, Notice, Select, Slider } from '@/ui/components/kit'
import { KeyboardStage } from '../KeyboardStage'
import { KeycodeSelect } from '../KeycodeSelect'
import type { KeyboardPanelProps } from '../KeyboardPage'

const TYPE_INFO: Record<AdvancedKeyType, { name: string; blurb: string; keys: number }> = {
  TGL: { name: 'Toggle', blurb: 'Tap to latch the key down; hold for normal behaviour.', keys: 1 },
  MT: { name: 'Dual action (hold / tap)', blurb: 'Tap sends one key, holding sends another.', keys: 1 },
  END: { name: 'Release trigger', blurb: 'Sends another key when this key is released.', keys: 1 },
  SOCD: { name: 'SOCD', blurb: 'Two keys pressed together resolve by your rule (counter-strafing).', keys: 2 },
  DKS: { name: 'Dynamic keystroke', blurb: 'Up to four actions along the key’s travel.', keys: 1 },
  MPT: { name: 'Multi-point trigger', blurb: 'Different keys at different press depths.', keys: 1 },
  RS: { name: 'Rapid snap', blurb: 'Of two keys, the deeper-pressed one wins.', keys: 2 },
}

const SOCD_MODES: { value: SocdMode; label: string }[] = [
  { value: 'lastWins', label: 'Last input wins' },
  { value: 'neutral', label: 'Neutral (both cancel)' },
  { value: 'key1Wins', label: 'Key 1 always wins' },
  { value: 'key2Wins', label: 'Key 2 always wins' },
  { value: 'firstWins', label: 'First input wins' },
  { value: 'bothActive', label: 'Both active' },
]

type Stage = 'start' | 'bottom' | 'bottomRelease' | 'fullRelease'
interface Draft {
  keycode: number
  holdKeycode: number
  clickKeycode: number
  delayMs: number
  mode: SocdMode
  depths: Record<Stage, number>
  groups: { keycode: number; triggers: Record<Stage, DksTrigger> }[]
  points: { keycode: number; distance: number }[]
}

const DKS_TRIGGERS: { value: DksTrigger; label: string }[] = [
  { value: 'none', label: '—' },
  { value: 'instant', label: 'Tap' },
  { value: 'duringPress', label: 'Hold while passing' },
  { value: 'startPress', label: 'Hold from here' },
  { value: 'endPress', label: 'Hold until here' },
  { value: 'startAndEnd', label: 'Hold between' },
]

function describeKey(k: AdvancedKey, describe: (kc: number) => string): string {
  switch (k.type) {
    case 'TGL':
      return `${describe(k.keycode)} · ${k.delayMs} ms`
    case 'MT':
      return `tap ${describe(k.clickKeycode)} · hold ${describe(k.holdKeycode)} · ${k.delayMs} ms`
    case 'END':
      return `on release → ${describe(k.keycode)}`
    case 'SOCD':
      return SOCD_MODES.find((m) => m.value === k.mode)?.label ?? k.mode
    case 'DKS':
      return k.groups.map((g) => describe(g.keycode)).join(', ')
    case 'MPT':
      return k.points.map((p) => `${describe(p.keycode)} @ ${(p.distance / 1000).toFixed(2)} mm`).join(', ')
    case 'RS':
      return 'rapid snap'
  }
}

export function AdvancedKeysPanel({ driver, caps }: KeyboardPanelProps) {
  const svc = driver.advancedKeys
  const [layer, setLayer] = useState<Layer>(0)
  const [os, setOs] = useState<OsMode>('windows')
  const [types, setTypes] = useState<AdvancedKeyType[]>([])
  const [list, setList] = useState<AdvancedKey[]>([])
  const [type, setType] = useState<AdvancedKeyType>('SOCD')
  const [picked, setPicked] = useState<KeyId[]>([])
  const [draft, setDraft] = useState<Draft>({ keycode: 4, holdKeycode: 0x00010000, clickKeycode: 4, delayMs: 155, mode: 'lastWins', depths: { start: 500, bottom: 3000, bottomRelease: 2500, fullRelease: 300 }, groups: [{ keycode: 4, triggers: { start: 'instant', bottom: 'none', bottomRelease: 'none', fullRelease: 'none' } }], points: [{ keycode: 4, distance: 1000 }] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const sel: LayerSelector = useMemo(() => ({ layer, os }), [layer, os])
  const label = (id: KeyId) => caps.layout.keys.find((k) => k.id === id)?.label ?? `#${id}`

  const reload = async () => {
    if (!svc) return
    setBusy(true)
    try {
      const [t, l] = await Promise.all([svc.supportedTypes(), svc.list(sel)])
      setTypes(t)
      setList(dedupe(l))
      if (t.length && !t.includes(type)) setType(t[0]!)
      setError(undefined)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc, sel])

  if (!svc) return <Notice>This keyboard does not expose advanced keys.</Notice>
  const occupied = new Set(list.flatMap((k) => ('ids' in k ? k.ids : [k.id])))
  const need = TYPE_INFO[type].keys

  const pick = (id: KeyId) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-(need - 1)), id]))
  }

  const build = (): AdvancedKey | undefined => {
    if (picked.length < need) return undefined
    const d = draft
    const id = picked[0]!
    switch (type) {
      case 'TGL':
        return { type, id, keycode: d.keycode, delayMs: 200 }
      case 'MT':
        return { type, id, holdKeycode: d.holdKeycode, clickKeycode: d.clickKeycode, delayMs: d.delayMs }
      case 'END':
        return { type, id, keycode: d.keycode }
      case 'SOCD':
        return { type, ids: [picked[0]!, picked[1]!], mode: d.mode }
      case 'RS':
        return { type, ids: [picked[0]!, picked[1]!] }
      case 'DKS':
        return { type, id, depths: d.depths, groups: d.groups }
      case 'MPT':
        return { type, id, points: d.points }
    }
  }

  const save = async () => {
    const key = build()
    if (!key) return
    setBusy(true)
    try {
      await svc.set(sel, key)
      setPicked([])
      await reload()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const remove = async (key: AdvancedKey) => {
    setBusy(true)
    try {
      await svc.delete(sel, key)
      await reload()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const d = draft
  return (
    <div className="stack">
      {error && <Notice kind="error">{error}</Notice>}
      <Card
        title="Advanced keys"
        actions={
          <div className="row">
            <Select value={layer} options={LAYERS.filter((l) => caps.layers.includes(l.id)).map((l) => ({ value: l.id, label: `${l.name} layer` }))} onChange={setLayer} disabled={busy} />
            <Select value={os} options={caps.osModes.map((o) => ({ value: o, label: o === 'macos' ? 'macOS' : 'Windows' }))} onChange={setOs} disabled={busy} />
          </div>
        }
      >
        <KeyboardStage layout={caps.layout} selected={new Set(picked)} onKeyClick={(k) => pick(k.id)} decorate={(k) => ({ modified: occupied.has(k.id), sub: occupied.has(k.id) ? list.find((x) => ('ids' in x ? x.ids.includes(k.id) : x.id === k.id))?.type : undefined })} />
        <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          Pick {need === 2 ? 'two keys' : 'a key'} for a new {TYPE_INFO[type].name.toLowerCase()}. Keys already used by an advanced key show its type.
        </div>
      </Card>
      <div className="grid cols-2">
        <Card title="New advanced key">
          <div className="stack">
            <Field label="Type" hint={TYPE_INFO[type].blurb}>
              <Select value={type} options={(types.length ? types : (Object.keys(TYPE_INFO) as AdvancedKeyType[])).map((t) => ({ value: t, label: TYPE_INFO[t].name }))} onChange={(t) => {
                setType(t)
                setPicked([])
              }} />
            </Field>
            <div className="row wrap">
              <span className="muted">Keys:</span>
              {picked.length ? picked.map((id, i) => <span key={id} className="badge accent">{need === 2 ? `${i + 1}: ` : ''}{label(id)}</span>) : <span className="dim">none picked</span>}
            </div>
            {(type === 'TGL' || type === 'END') && (
              <Field label={type === 'TGL' ? 'Key to latch' : 'Key sent on release'}>
                <KeycodeSelect actions={driver.actions} value={d.keycode} onChange={(kc) => setDraft({ ...draft, keycode: kc })} />
              </Field>
            )}
            {type === 'MT' && (
              <>
                <Field label="Tap sends">
                  <KeycodeSelect actions={driver.actions} value={d.clickKeycode} onChange={(kc) => setDraft({ ...draft, clickKeycode: kc })} />
                </Field>
                <Field label="Hold sends">
                  <KeycodeSelect actions={driver.actions} value={d.holdKeycode} onChange={(kc) => setDraft({ ...draft, holdKeycode: kc })} />
                </Field>
                <Field label={`Hold time — ${d.delayMs} ms`}>
                  <Slider value={d.delayMs} min={10} max={400} step={5} onChange={(v) => setDraft({ ...draft, delayMs: v })} format={(v) => `${v} ms`} />
                </Field>
              </>
            )}
            {type === 'SOCD' && (
              <Field label="When both are pressed">
                <Select value={d.mode} options={SOCD_MODES} onChange={(v) => setDraft({ ...draft, mode: v })} />
              </Field>
            )}
            {type === 'DKS' && (
              <DksEditor draft={draft} setDraft={setDraft} describe={driver.actions} />
            )}
            {type === 'MPT' && (
              <div className="stack">
                {draft.points.map((p, i) => (
                  <div key={i} className="row">
                    <KeycodeSelect actions={driver.actions} value={p.keycode} onChange={(kc) => setDraft({ ...draft, points: draft.points.map((x, j) => (j === i ? { ...x, keycode: kc } : x)) })} />
                    <div style={{ flex: 1 }}>
                      <Slider value={p.distance} min={10} max={4000} step={10} onChange={(v) => setDraft({ ...draft, points: draft.points.map((x, j) => (j === i ? { ...x, distance: v } : x)) })} format={(v) => `${(v / 1000).toFixed(2)} mm`} />
                    </div>
                    <Button small variant="ghost" onClick={() => setDraft({ ...draft, points: draft.points.filter((_, j) => j !== i) })}>✕</Button>
                  </div>
                ))}
                {draft.points.length < 3 && (
                  <Button small onClick={() => setDraft({ ...draft, points: [...draft.points, { keycode: 4, distance: 2000 }] })}>+ Add point</Button>
                )}
              </div>
            )}
            <Button variant="primary" disabled={busy || picked.length < need} onClick={() => void save()}>
              Write to keyboard
            </Button>
          </div>
        </Card>
        <Card title={`Configured (${list.length})`}>
          {!list.length && <div className="dim">No advanced keys on this layer yet.</div>}
          <table className="table">
            <tbody>
              {list.map((k, i) => (
                <tr key={i}>
                  <td>
                    <span className="badge accent">{k.type}</span>
                  </td>
                  <td>{('ids' in k ? k.ids : [k.id]).map(label).join(' + ')}</td>
                  <td className="muted">{describeKey(k, driver.actions.describe)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button small variant="ghost" disabled={busy} onClick={() => void remove(k)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  )
}

/** SOCD/RS records come back once per member id; show each pair once. */
function dedupe(list: AdvancedKey[]): AdvancedKey[] {
  const seen = new Set<string>()
  return list.filter((k) => {
    const key = 'ids' in k ? `${k.type}:${[...k.ids].sort((a, b) => a - b).join(',')}` : `${k.type}:${k.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function DksEditor({ draft, setDraft, describe }: { draft: Draft; setDraft: (d: Draft) => void; describe: KeyboardPanelProps['driver']['actions'] }) {
  const depths = draft.depths
  const groups = draft.groups
  const stages: ('start' | 'bottom' | 'bottomRelease' | 'fullRelease')[] = ['start', 'bottom', 'bottomRelease', 'fullRelease']
  const stageLabel = { start: 'Press', bottom: 'Bottom', bottomRelease: 'Release', fullRelease: 'Up' }
  return (
    <div className="stack">
      <div className="grid cols-2">
        {stages.map((s) => (
          <Field key={s} label={`${stageLabel[s]} depth — ${(depths[s] / 1000).toFixed(2)} mm`}>
            <Slider value={depths[s]} min={10} max={4000} step={10} onChange={(v) => setDraft({ ...draft, depths: { ...depths, [s]: v } })} format={(v) => `${(v / 1000).toFixed(2)}`} />
          </Field>
        ))}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Key</th>
            {stages.map((s) => (
              <th key={s}>{stageLabel[s]}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={i}>
              <td>
                <KeycodeSelect actions={describe} value={g.keycode} onChange={(kc) => setDraft({ ...draft, groups: groups.map((x, j) => (j === i ? { ...x, keycode: kc } : x)) })} />
              </td>
              {stages.map((s) => (
                <td key={s}>
                  <Select value={g.triggers[s]} options={DKS_TRIGGERS} onChange={(v) => setDraft({ ...draft, groups: groups.map((x, j) => (j === i ? { ...x, triggers: { ...x.triggers, [s]: v } } : x)) })} />
                </td>
              ))}
              <td>
                <Button small variant="ghost" onClick={() => setDraft({ ...draft, groups: groups.filter((_, j) => j !== i) })}>✕</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {groups.length < 4 && (
        <Button small onClick={() => setDraft({ ...draft, groups: [...groups, { keycode: 4, triggers: { start: 'none', bottom: 'instant', bottomRelease: 'none', fullRelease: 'none' } }] })}>+ Add action</Button>
      )}
    </div>
  )
}
