import { useEffect, useState } from 'react'
import { musicEngine } from '@/audio/musicSync'
import { MouseSink, type MouseSinkOptions } from '@/audio/sinks/mouseSink'
import { Field, Notice, Select } from '@/ui/components/kit'
import { DevicesCard, LiveCard, LookCard, MOUSE_MEMORY_NOTE, SourceCard, useMusicStatus, useMusicUi } from '@/ui/music'
import type { MousePanelProps } from '../MousePage'

type Path = NonNullable<MouseSinkOptions['prefer']>

/** The sink's strategies (`MouseSinkStrategy`), in the words of the Compx docs. */
const PATHS: { value: Path; label: string }[] = [
  { value: 'auto', label: 'Automatic — safest capable path' },
  { value: 'amplitude', label: 'Amplitude streaming (0xB6) — if the firmware accepts it' },
  { value: 'dongle', label: 'Receiver RGB bar (0x18) — 2.4 GHz receiver only' },
  { value: 'gentle', label: 'Light bar, gentle — settings writes on strong beats only' },
]

/** Mouse-tab view of the shared music session, focused on this mouse. */
export function MouseMusicPanel({ id, caps }: MousePanelProps) {
  const status = useMusicStatus()
  const startError = useMusicUi((s) => s.startError)
  const impl = musicEngine.getSink(id)
  const sink = impl instanceof MouseSink ? impl : undefined
  const [path, setPath] = useState<Path>(sink?.options.prefer ?? 'auto')
  // The store registers the sink asynchronously; pick up its options once it exists.
  useEffect(() => {
    if (sink) setPath(sink.options.prefer ?? 'auto')
  }, [sink])
  const mine = status.sinks.find((s) => s.id === id)
  return (
    <div className="music-stack">
      <Notice kind="info">
        {MOUSE_MEMORY_NOTE}
        {caps.hasDongle
          ? ' Over the 2.4 GHz receiver its RGB bar is a live command path and is preferred when the receiver has one.'
          : ''}{' '}
        Whether GravaStar mice accept the amplitude commands is unverified; the probe is harmless.
      </Notice>
      {startError && <Notice kind="error">{startError}</Notice>}
      {status.error && <Notice kind="error">{status.error}</Notice>}
      <div className="grid cols-2">
        <SourceCard focusId={id} />
        <LookCard>
          <Field
            label="Light path"
            hint={
              mine?.active
                ? 'Applies the next time music sync starts.'
                : 'Tried first; a path the mouse does not support falls back to the automatic order.'
            }
          >
            <Select
              value={path}
              options={PATHS}
              disabled={!sink}
              onChange={(v) => {
                setPath(v)
                if (sink) sink.options.prefer = v
              }}
            />
          </Field>
        </LookCard>
      </div>
      <DevicesCard focusId={id} only />
      <LiveCard focusId={id} />
    </div>
  )
}
