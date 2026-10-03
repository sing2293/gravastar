import { musicEngine } from '@/audio/musicSync'
import { MouseSink } from '@/audio/sinks/mouseSink'
import type { SinkStatus } from '@/audio/types'
import { Badge, Card, Toggle } from '@/ui/components/kit'
import { useMusicStatus } from './useMusicSync'

/** Why a mouse reacts differently from a keyboard; shown on every mouse row and on the mouse's Music tab. */
export const MOUSE_MEMORY_NOTE =
  'The mouse has no real-time colour command: its light bar lives in settings memory. Pulse mode therefore hands the beat to the firmware — it breathes at the detected tempo and is only rewritten when the colour or tempo changes — so the mouse keeps moving for a handful of memory writes a minute.'

/** Human label for what a sink is doing right now. */
export function modeLabel(sink: SinkStatus, running: boolean): string {
  if (!running || !sink.enabled) return 'idle'
  if (!sink.active) return sink.error ? 'error' : sink.note ? 'unavailable' : 'preparing…'
  if (sink.mode === 'amplitude') return 'amplitude streaming'
  return sink.mode ?? 'streaming'
}

/**
 * Every registered sink with its enable switch, mode and counters. `only` narrows the list to `focusId` (device
 * tabs); on the global page `focusId` merely highlights a row.
 */
export function DevicesCard({ focusId, only }: { focusId?: string; only?: boolean }) {
  const status = useMusicStatus()
  const rows = only && focusId ? status.sinks.filter((s) => s.id === focusId) : status.sinks
  const lit = status.sinks.filter((s) => s.enabled).length
  return (
    <Card
      title={only ? 'This device' : 'Devices'}
      actions={
        only ? undefined : (
          <span className="dim" style={{ fontSize: 12 }}>
            {lit} of {status.sinks.length} on
          </span>
        )
      }
    >
      {rows.length === 0 ? (
        <div className="dim">{only ? 'This device is not registered for music sync yet.' : 'No device connected.'}</div>
      ) : (
        <div className="sink-list">
          {rows.map((s) => (
            <SinkRow key={s.id} sink={s} focus={!only && s.id === focusId} running={status.running} />
          ))}
        </div>
      )}
    </Card>
  )
}

export function SinkRow({ sink, focus, running }: { sink: SinkStatus; focus: boolean; running: boolean }) {
  const impl = musicEngine.getSink(sink.id)
  // Settings-memory writes are the ones that wear the mouse out; the budget is what the sink pauses at.
  const budget = impl instanceof MouseSink && sink.memoryWrites !== undefined ? impl.options.writeBudget : undefined
  const tempo = impl instanceof MouseSink ? impl.tempoEstimate : undefined
  return (
    <div className={['sink-row', focus ? 'focus' : ''].join(' ')}>
      <Toggle checked={sink.enabled} onChange={(v) => musicEngine.setEnabled(sink.id, v)} />
      <div className="row wrap" style={{ gap: 8, minWidth: 0 }}>
        <span aria-hidden style={{ fontSize: 15 }}>
          {sink.kind === 'keyboard' ? '⌨️' : '🖱️'}
        </span>
        <a className="sink-name" href={`#/device/${encodeURIComponent(sink.id)}/music`}>
          {sink.label}
        </a>
        <Badge tone={sink.active ? 'accent' : undefined}>{modeLabel(sink, running)}</Badge>
      </div>
      <div className="stats">
        <span title="Device writes per second">{sink.fps} fps</span>
        {budget !== undefined ? (
          <span title="Settings-memory writes this session, and the budget the sink pauses at">
            {sink.memoryWrites} / {budget} memory writes
          </span>
        ) : (
          <span title="Writes this session">{sink.writes} writes</span>
        )}
        {running && tempo?.bpm !== undefined && <span title="Detected tempo driving the pulse">{tempo.bpm} BPM</span>}
      </div>
      {sink.kind === 'mouse' && <div className="detail">{MOUSE_MEMORY_NOTE}</div>}
      {sink.note && (
        <div className="detail" style={{ color: 'var(--warn)' }}>
          {sink.note}
        </div>
      )}
      {sink.error && (
        <div className="detail" style={{ color: 'var(--danger)' }}>
          {sink.error}
        </div>
      )}
    </div>
  )
}
