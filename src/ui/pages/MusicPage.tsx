import type { AudioSourceKind } from '@/audio/types'
import { Badge, Notice } from '@/ui/components/kit'
import { DevicesCard, EmptyState, LiveCard, LookCard, SourceCard, useMusicStatus, useMusicUi } from '@/ui/music'

const SOURCE_NAMES: Record<AudioSourceKind, string> = {
  system: 'system audio',
  tab: 'a browser tab',
  microphone: 'the microphone',
}

/** The global Music Sync page: one session, every connected device. Sinks are registered by the device store. */
export function MusicPage() {
  const status = useMusicStatus()
  const startError = useMusicUi((s) => s.startError)
  const total = status.sinks.length
  const lit = status.sinks.filter((s) => s.enabled).length
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Music Sync</h1>
          <div className="muted">
            {status.running
              ? `Live from ${SOURCE_NAMES[status.source ?? 'system']} — ${lit} of ${total} device${total === 1 ? '' : 's'} lit.`
              : 'Lights every connected device from whatever is playing on this computer.'}
          </div>
        </div>
        <Badge tone={status.running ? 'accent' : undefined}>{status.running ? '● live' : 'idle'}</Badge>
      </div>
      <div className="music-stack">
        {startError && <Notice kind="error">{startError}</Notice>}
        {status.error && <Notice kind="error">{status.error}</Notice>}
        <div className="grid cols-2">
          <SourceCard />
          <LookCard />
        </div>
        {total > 0 ? (
          <>
            <DevicesCard />
            <LiveCard />
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  )
}
