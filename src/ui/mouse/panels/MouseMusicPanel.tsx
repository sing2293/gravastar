import { useEffect, useState } from 'react'
import { musicEngine } from '@/audio/musicSync'
import { MouseSink, type MouseReaction, type MouseSinkOptions } from '@/audio/sinks/mouseSink'
import { Button, Field, Notice, Select, Slider } from '@/ui/components/kit'
import { DevicesCard, LiveCard, LookCard, MOUSE_MEMORY_NOTE, SourceCard, useMusicStatus, useMusicUi } from '@/ui/music'
import type { MousePanelProps } from '../MousePage'

type Path = NonNullable<MouseSinkOptions['prefer']>

/** The sink's strategies (`MouseSinkStrategy`), in the words of the Compx docs. */
const PATHS: { value: Path; label: string }[] = [
  { value: 'auto', label: 'Automatic — the most reactive path this mouse supports' },
  { value: 'pulse', label: 'Pulse — the mouse breathes at the beat (recommended)' },
  { value: 'strobe', label: 'Strobe — flash on every beat (most memory writes)' },
  { value: 'gentle', label: 'Gentle — colour change on strong beats only' },
  { value: 'amplitude', label: 'Amplitude streaming (0xB6) — if the firmware accepts it' },
  { value: 'dongle', label: 'Receiver RGB bar only (0x18) — 2.4 GHz receiver' },
]

const REACTIONS: { value: MouseReaction; label: string }[] = [
  { value: 'beat', label: 'The beat of the whole mix' },
  { value: 'bass', label: 'Bass — kick drum and bass line' },
  { value: 'mid', label: 'Mids — vocals, guitars, snare' },
  { value: 'treble', label: 'Treble — hi-hats, cymbals, detail' },
]

const HINTS: Partial<Record<Path, string>> = {
  pulse: 'The light block is set to the firmware’s breathing mode at the detected tempo, so the mouse keeps pulsing on its own; it is only rewritten when the colour or tempo changes.',
  strobe: 'Driven entirely from this computer: each beat writes the light on, then off again a moment later, so it blinks with the music. The most reactive — and the hardest on the mouse’s settings memory, at two writes per beat.',
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
  const [reactTo, setReactTo] = useState<MouseReaction>(sink?.options.reactTo ?? 'beat')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string>()
  // The store registers the sink asynchronously; pick up its options once it exists.
  useEffect(() => {
    if (!sink) return
    setPath(sink.options.prefer ?? 'auto')
    setSpeedOffset(sink.options.pulseSpeedOffset)
    setReactTo(sink.options.reactTo)
  }, [sink])
  const mine = status.sinks.find((s) => s.id === id)
  const pulsing = mine?.mode === 'pulse (firmware breathing)'
  const bpm = sink?.tempoEstimate.bpm

  const choosePath = (v: Path) => {
    setPath(v)
    if (!sink) return
    sink.options = { ...sink.options, prefer: v }
    // A running session keeps the strategy it prepared with, so re-prepare this device right away.
    void musicEngine.refreshSink(id)
  }

  const runFlashTest = async () => {
    if (!sink) return
    setTesting(true)
    setTestResult(undefined)
    try {
      const { writes, writeMs } = await sink.flashTest({ r: 255, g: 255, b: 255 })
      setTestResult(
        `Blinked 6 times (${writes} memory writes, ${writeMs} ms per write — up to ${Math.floor(1000 / Math.max(1, writeMs))} writes/s). If the mouse did not visibly flash, its light bar does not follow live writes.`,
      )
    } catch (e) {
      setTestResult(`Flash test failed: ${(e as Error).message}`)
    } finally {
      if (!musicEngine.getStatus().running) await sink.release().catch(() => undefined)
      setTesting(false)
    }
  }
  return (
    <div className="music-stack">
      <Notice kind="info">
        {MOUSE_MEMORY_NOTE}
        {caps.hasDongle ? ' The receiver’s RGB bar is a live command path and is driven alongside the mouse.' : ''} A
        wireless mouse stops servicing writes a few seconds after it stops moving, so a session switches on the
        firmware’s “highest performance” hold and high-performance sensor mode — it costs battery, and both are put
        back when you stop.
      </Notice>
      {path === 'strobe' && (
        <Notice>
          Strobe writes the mouse’s settings memory twice per beat — about 240 writes a minute at 120 BPM. These mice
          do not publish a flash endurance figure, so the write counter below is there to keep an eye on; nothing is
          capped.
        </Notice>
      )}
      {testResult && <Notice kind="info">{testResult}</Notice>}
      {startError && <Notice kind="error">{startError}</Notice>}
      {status.error && <Notice kind="error">{status.error}</Notice>}
      <div className="grid cols-2">
        <SourceCard focusId={id} />
        <LookCard>
          <Field
            label="Mouse light"
            hint={HINTS[path] ?? 'Tried first; a path the mouse does not support falls back to the automatic order.'}
          >
            <Select value={path} options={PATHS} disabled={!sink} onChange={choosePath} />
          </Field>
          <Field label="React to" hint="Which part of the music drives the mouse. A single band also sets its brightness, so the mouse follows just that part.">
            <Select
              value={reactTo}
              options={REACTIONS}
              disabled={!sink}
              onChange={(v) => {
                setReactTo(v)
                if (sink) sink.options = { ...sink.options, reactTo: v }
              }}
            />
          </Field>
          <Field
            label="Is the light reacting?"
            hint="Blinks the mouse white six times with no audio. It separates “the light does not follow live writes” from “the beat is not being detected”, and measures how fast this mouse accepts writes."
          >
            <div className="row">
              <Button disabled={!sink || testing} onClick={() => void runFlashTest()}>
                {testing ? 'Flashing…' : 'Flash the mouse 6 times'}
              </Button>
              {mine?.active && sink && sink.writeLatencyMs > 0 && (
                <span className="dim" style={{ fontSize: 12 }}>
                  {sink.writeLatencyMs} ms per write
                </span>
              )}
            </div>
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
