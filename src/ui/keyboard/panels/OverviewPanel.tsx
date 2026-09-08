import { useEffect, useState } from 'react'
import type { KeyId } from '@/model/keyboard'
import { Card, Toggle } from '@/ui/components/kit'
import { KeyboardStage } from '../KeyboardStage'
import type { KeyboardPanelProps } from '../KeyboardPage'

/** Key test: highlights keys as you press them (by browser key code) — a quick sanity check of the layout. */
export function OverviewPanel({ driver, caps, summary }: KeyboardPanelProps) {
  const [test, setTest] = useState(false)
  const [pressed, setPressed] = useState<Set<string>>(new Set())
  const [tested, setTested] = useState<Set<string>>(new Set())
  const codeById = new Map<KeyId, string>()
  for (const entry of driver.actions.catalog()) if (entry.browserCode) codeById.set(entry.keycode, entry.browserCode)
  useEffect(() => {
    if (!test) return
    const down = (e: KeyboardEvent) => {
      e.preventDefault()
      setPressed((p) => new Set(p).add(e.code))
      setTested((p) => new Set(p).add(e.code))
    }
    const up = (e: KeyboardEvent) => setPressed((p) => {
      const n = new Set(p)
      n.delete(e.code)
      return n
    })
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [test])
  const f = caps.features
  return (
    <div className="stack">
      <Card
        title="Keyboard"
        actions={
          <Toggle checked={test} onChange={setTest} label={test ? `Key test on — ${tested.size} keys seen` : 'Key test'} />
        }
      >
        <KeyboardStage
          layout={caps.layout}
          decorate={(k) => {
            const code = codeById.get(k.defaultKeycode)
            return { pressed: code ? pressed.has(code) : false, modified: test && code ? tested.has(code) : false }
          }}
        />
        <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          Layout {caps.layout.variant.toUpperCase()} · {caps.layout.keys.length} keys · {caps.layers.length} layers × {caps.osModes.length} OS tables · {caps.profiles} onboard profiles
        </div>
      </Card>
      <div className="grid cols-2">
        <Card title="Device">
          <dl className="kv">
            <dt>Model</dt>
            <dd>{summary.product.displayName}</dd>
            <dt>Link</dt>
            <dd>{summary.link === 'dongle' ? '2.4 GHz receiver' : 'USB'}</dd>
            <dt>Firmware</dt>
            <dd>{summary.info?.firmwareVersion ?? '—'}</dd>
            <dt>UUID</dt>
            <dd className="mono">{summary.info?.uniqueId ?? '—'}</dd>
            <dt>Battery</dt>
            <dd>{summary.battery ? `${summary.battery.level}%${summary.battery.charging ? ', charging' : ''}${summary.battery.full ? ', full' : ''}` : '—'}</dd>
          </dl>
        </Card>
        <Card title="Features reported by the firmware">
          <div className="row wrap" style={{ gap: 6 }}>
            {Object.entries(f)
              .filter(([, v]) => typeof v === 'boolean')
              .map(([k, v]) => (
                <span key={k} className={['badge', v ? 'accent' : ''].join(' ')}>
                  {k}
                </span>
              ))}
            <span className="badge">max polling {f.maxPollingRate} Hz</span>
          </div>
        </Card>
      </div>
    </div>
  )
}
