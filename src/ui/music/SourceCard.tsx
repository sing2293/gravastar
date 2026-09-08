import { useMemo } from 'react'
import { audioSources } from '@/audio/capture'
import { Badge, Button, Card } from '@/ui/components/kit'
import { useMusicStatus, useMusicUi } from './useMusicSync'

/**
 * Audio source picker + Start / Stop for the shared session. `focusId` names the device whose tab this is, so the
 * card can show that device's write rate and point at the global page for the rest.
 */
export function SourceCard({ focusId }: { focusId?: string }) {
  const status = useMusicStatus()
  const { source, setSource, starting, start, stop } = useMusicUi()
  const sources = useMemo(() => audioSources(), [])
  const mine = focusId ? status.sinks.find((s) => s.id === focusId) : undefined
  const others = focusId ? status.sinks.filter((s) => s.id !== focusId) : []
  const lit = status.sinks.filter((s) => s.enabled).length
  return (
    <Card title="Audio source">
      <div className="stack">
        {sources.map((s) => (
          <label key={s.kind} className="row" style={{ alignItems: 'flex-start', gap: 10, opacity: s.available ? 1 : 0.5 }}>
            <input
              type="radio"
              name="music-source"
              value={s.kind}
              checked={source === s.kind}
              disabled={!s.available || status.running}
              onChange={() => setSource(s.kind)}
              style={{ marginTop: 3 }}
            />
            <span>
              <div>{s.label}</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {s.hint}
              </div>
            </span>
          </label>
        ))}
        <div className="row wrap">
          {status.running ? (
            <Button variant="danger" onClick={() => void stop()}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" disabled={starting} onClick={() => void start()}>
              {starting ? 'Starting…' : 'Start music sync'}
            </Button>
          )}
          {status.running && (
            <span className="muted" style={{ fontSize: 13 }}>
              {status.fps} analysis fps
              {mine ? ` · ${mine.fps} writes/s to this ${mine.kind}` : ` · ${lit} device${lit === 1 ? '' : 's'} lit`}
            </span>
          )}
          {status.running && status.clock && (
            <Badge tone={status.clock === 'audio' ? 'accent' : undefined}>
              {status.clock === 'audio' ? 'audio clock' : 'frame clock'}
            </Badge>
          )}
        </div>
        {focusId && (
          <div className="dim" style={{ fontSize: 12 }}>
            {others.length > 0
              ? `Also driving: ${others.map((o) => `${o.label}${o.enabled ? '' : ' (off)'}`).join(', ')}. `
              : 'One session lights every connected device. '}
            <a href="#/music">Manage all devices on the Music Sync page</a>
          </div>
        )}
      </div>
    </Card>
  )
}
