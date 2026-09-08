import { useEffect, useState } from 'react'
import { musicEngine } from '@/audio/musicSync'
import { KeyboardSink } from '@/audio/sinks/keyboardSink'
import { Field, Notice, Slider } from '@/ui/components/kit'
import { DevicesCard, LiveCard, LookCard, SourceCard, useMusicStatus, useMusicUi } from '@/ui/music'
import type { KeyboardPanelProps } from '../KeyboardPage'

/** Keyboard-tab view of the shared music session, focused on this keyboard. The store registers the sink. */
export function MusicPanel({ id, caps, summary }: KeyboardPanelProps) {
  const status = useMusicStatus()
  const startError = useMusicUi((s) => s.startError)
  const impl = musicEngine.getSink(id)
  const sink = impl instanceof KeyboardSink ? impl : undefined
  const [maxFps, setMaxFps] = useState(sink?.options.maxFps ?? 30)
  // The store registers the sink asynchronously; pick up its options once it exists.
  useEffect(() => {
    if (sink) setMaxFps(sink.options.maxFps)
  }, [sink])
  const streamingSupported = caps.features.keyIdRGB || caps.features.fullKeysRGB
  return (
    <div className="music-stack">
      {!streamingSupported && (
        <Notice>The firmware did not report real-time colour streaming; music sync may not light up. It is safe to try.</Notice>
      )}
      {summary.link === 'dongle' && (
        <Notice>
          Over the 2.4 GHz receiver the keyboard uses a separate raw report for streaming. This path hasn't been
          validated on hardware yet.
        </Notice>
      )}
      {startError && <Notice kind="error">{startError}</Notice>}
      {status.error && <Notice kind="error">{status.error}</Notice>}
      <div className="grid cols-2">
        <SourceCard focusId={id} />
        <LookCard>
          <Field label={`Update rate — ${maxFps} fps`} hint="Lower this if the keyboard lags behind the music.">
            <Slider
              value={maxFps}
              min={5}
              max={40}
              step={1}
              disabled={!sink}
              onChange={(v) => {
                setMaxFps(v)
                if (sink) sink.options = { ...sink.options, maxFps: v }
              }}
              format={(v) => `${v} fps`}
            />
          </Field>
        </LookCard>
      </div>
      <DevicesCard focusId={id} only />
      <LiveCard focusId={id} />
    </div>
  )
}
