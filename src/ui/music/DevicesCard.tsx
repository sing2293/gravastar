import { musicEngine } from '@/audio/musicSync'
import { MouseSink } from '@/audio/sinks/mouseSink'
import type { SinkStatus } from '@/audio/types'
import { Badge, Card, Toggle } from '@/ui/components/kit'
import { useMusicStatus } from './useMusicSync'

/** Why a mouse reacts differently from a keyboard; shown on every mouse row and on the mouse's Music tab. */
export const MOUSE_MEMORY_NOTE =
  'The light bar is memory-backed — every colour change is a settings write — so the mouse follows the beat gently unless its firmware supports live amplitudes (probed when the session starts).'

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
  // Only gentle mode spends settings-memory writes; the budget is what the sink pauses at.
  const budget = impl instanceof MouseSink && sink.mode === 'gentle (memory-safe)' ? impl.options.writeBudget : undefined
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
        <span title="Writes this session">
          {sink.writes}
          {budget !== undefined ? ` / ${budget}` : ''} writes
        </span>
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
