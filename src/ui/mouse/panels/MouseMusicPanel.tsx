import { useEffect, useState } from 'react'
import { musicEngine } from '@/audio/musicSync'
import { MouseSink, type MouseSinkOptions } from '@/audio/sinks/mouseSink'
import { Field, Notice, Select, Slider } from '@/ui/components/kit'
import { DevicesCard, LiveCard, LookCard, MOUSE_MEMORY_NOTE, SourceCard, useMusicStatus, useMusicUi } from '@/ui/music'
import type { MousePanelProps } from '../MousePage'

type Path = NonNullable<MouseSinkOptions['prefer']>

/** The sink's strategies (`MouseSinkStrategy`), in the words of the Compx docs. */
const PATHS: { value: Path; label: string }[] = [
  { value: 'auto', label: 'Automatic — the most reactive path this mouse supports' },
  { value: 'pulse', label: 'Pulse — the mouse breathes at the beat (recommended)' },
  { value: 'strobe', label: 'Strobe — flash on every beat (many memory writes)' },
  { value: 'gentle', label: 'Gentle — colour change on strong beats only' },
  { value: 'amplitude', label: 'Amplitude streaming (0xB6) — if the firmware accepts it' },
  { value: 'dongle', label: 'Receiver RGB bar only (0x18) — 2.4 GHz receiver' },
]

const HINTS: Partial<Record<Path, string>> = {
  pulse: 'The light block is set to the firmware’s breathing mode at the detected tempo, so the mouse keeps pulsing on its own; it is only rewritten when the colour or tempo changes.',
  strobe: 'The host writes the light several times per beat so it punches and fades. The most reactive — and the hardest on the mouse’s settings memory. Watch the write counter.',
  gentle: 'One colour change per strong beat, at most one write every 1.5 s. Least wear, least movement.',
  amplitude: 'A live 20-band command that costs no memory. Documented for Compx keyboards; most mice reject it.',
  dongle: 'Drives only the receiver’s RGB bar and leaves the mouse’s own light alone.',
}

/** Mouse-tab view of the shared music session, focused on this mouse. */
export function MouseMusicPanel({ id, caps }: MousePanelProps) {
  const status = useMusicStatus()
  const startError = useMusicUi((s) => s.startError)
  const impl = musicEngine.getSink(id)
  const sink = impl instanceof MouseSink ? impl : undefined
  const [path, setPath] = useState<Path>(sink?.options.prefer ?? 'auto')
  const [speedOffset, setSpeedOffset] = useState(sink?.options.pulseSpeedOffset ?? 0)
  // The store registers the sink asynchronously; pick up its options once it exists.
  useEffect(() => {
    if (!sink) return
    setPath(sink.options.prefer ?? 'auto')
    setSpeedOffset(sink.options.pulseSpeedOffset)
  }, [sink])
  const mine = status.sinks.find((s) => s.id === id)
  const pulsing = mine?.mode === 'pulse (firmware breathing)'
  const bpm = sink?.tempoEstimate.bpm
  return (
    <div className="music-stack">
      <Notice kind="info">
        {MOUSE_MEMORY_NOTE}
        {caps.hasDongle ? ' The receiver’s RGB bar is a live command path and is driven alongside the mouse.' : ''}
      </Notice>
      {path === 'strobe' && (
        <Notice>
          Strobe rewrites the mouse’s settings memory several times per beat — roughly {Math.round((sink?.options.strobeFps ?? 8) * 60)} writes a minute at
          full tilt. Flash endurance is not published for these mice, so use it for a track or two rather than a whole
          evening; the session pauses at the write budget.
        </Notice>
      )}
      {startError && <Notice kind="error">{startError}</Notice>}
      {status.error && <Notice kind="error">{status.error}</Notice>}
      <div className="grid cols-2">
        <SourceCard focusId={id} />
        <LookCard>
          <Field
            label="Mouse light"
            hint={
              mine?.active && path !== (sink?.options.prefer ?? 'auto')
                ? 'Applies the next time music sync starts.'
                : (HINTS[path] ?? 'Tried first; a path the mouse does not support falls back to the automatic order.')
            }
          >
            <Select
              value={path}
              options={PATHS}
              disabled={!sink}
              onChange={(v) => {
                setPath(v)
                if (sink) sink.options = { ...sink.options, prefer: v }
              }}
            />
          </Field>
          {(path === 'pulse' || path === 'auto' || pulsing) && (
            <Field
              label={`Pulse speed — ${speedOffset > 0 ? `+${speedOffset}` : speedOffset}`}
              hint={
                bpm
                  ? `Following ${bpm} BPM. Nudge this if the mouse breathes faster or slower than the music; it applies live.`
                  : 'Set from the detected tempo once a beat is found. Nudge it if the mouse breathes faster or slower than the music.'
              }
            >
              <Slider
                value={speedOffset}
                min={-4}
                max={4}
                step={1}
                disabled={!sink}
                onChange={(v) => {
                  setSpeedOffset(v)
                  if (sink) sink.options = { ...sink.options, pulseSpeedOffset: v }
                }}
                format={(v) => (v > 0 ? `+${v}` : `${v}`)}
              />
            </Field>
          )}
        </LookCard>
      </div>
      <DevicesCard focusId={id} only />
      <LiveCard focusId={id} />
    </div>
  )
}
