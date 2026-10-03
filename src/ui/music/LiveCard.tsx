import { musicEngine } from '@/audio/musicSync'
import { presetById } from '@/audio/presets'
import { KeyboardSink } from '@/audio/sinks/keyboardSink'
import { MouseSink } from '@/audio/sinks/mouseSink'
import type { AudioFrame, SinkStatus } from '@/audio/types'
import type { RGB } from '@/model/device'
import { Card } from '@/ui/components/kit'
import { KeyboardStage } from '@/ui/keyboard/KeyboardStage'
import { modeLabel } from './DevicesCard'
import { sessionTime, useFrameTicker, useMusicStatus } from './useMusicSync'

/** Placeholder spectrum while nothing is playing (the analyser's default band count). */
const IDLE_BANDS = new Float32Array(24)
const BLACK: RGB = { r: 0, g: 0, b: 0 }

/**
 * Meters plus what each device is showing. This is the only music view that redraws every animation frame, and
 * only while the engine runs. `focusId` limits the device visuals to one sink (device tabs); otherwise every
 * enabled sink is shown.
 */
export function LiveCard({ focusId }: { focusId?: string }) {
  const status = useMusicStatus()
  useFrameTicker(status.running)
  const frame = musicEngine.lastFrame
  const shown = status.sinks.filter((s) => (focusId ? s.id === focusId : s.enabled))
  return (
    <Card
      title="Live"
      actions={
        status.running ? undefined : (
          <span className="dim" style={{ fontSize: 12 }}>
            Start music sync to see the meters move
          </span>
        )
      }
    >
      <div className="stack">
        <div className="bars">
          {Array.from(frame?.bands ?? IDLE_BANDS).map((v, i) => (
            <span key={i} style={{ height: `${Math.max(2, v * 100)}%` }} />
          ))}
        </div>
        <div className="row" style={{ gap: 16 }}>
          <span className="muted" style={{ minWidth: 60 }}>
            Level
          </span>
          <div className="meter" style={{ flex: 1 }}>
            <span style={{ width: `${(frame?.level ?? 0) * 100}%` }} />
          </div>
          <span className={['badge', frame?.beat ? 'accent' : ''].join(' ')}>beat</span>
          <span className="dim" style={{ fontSize: 12, minWidth: 110, textAlign: 'right' }}>
            {status.beats} beats{status.bpm ? ` · ${status.bpm} BPM` : ''}
          </span>
        </div>
        {shown.map((s) => (
          <DeviceVisual key={s.id} sink={s} frame={frame} running={status.running} labelled={!focusId} />
        ))}
      </div>
    </Card>
  )
}

function DeviceVisual({
  sink,
  frame,
  running,
  labelled,
}: {
  sink: SinkStatus
  frame: AudioFrame | undefined
  running: boolean
  labelled: boolean
}) {
  const impl = musicEngine.getSink(sink.id)
  if (impl instanceof KeyboardSink) {
    const lighting = impl.lastLighting
    const colorById = new Map<number, RGB>()
    if (lighting) {
      if ('all' in lighting) for (const k of impl.layout.keys) colorById.set(k.id, lighting.all)
      else for (const c of lighting.keys) colorById.set(c.id, c.color)
    }
    return (
      <div className="stack" style={{ gap: 6 }}>
        {labelled && <VisualLabel sink={sink} running={running} />}
        <KeyboardStage layout={impl.layout} decorate={(k) => ({ color: colorById.get(k.id) })} />
      </div>
    )
  }
  if (impl instanceof MouseSink) {
    // The engine keeps only the audio frame; the accent the mouse sink was fed comes from the same preset function.
    const { options } = musicEngine
    const accent = frame
      ? presetById(options.preset).accent(frame, { t: sessionTime(), color: options.color, sensitivity: options.sensitivity })
      : { color: BLACK, intensity: 0 }
    return (
      <div className="row" style={{ gap: 12 }}>
        <VisualLabel sink={sink} running={running} />
        <LightBar color={accent.color} intensity={sink.active ? accent.intensity : 0} />
      </div>
    )
  }
  return null
}

function VisualLabel({ sink, running }: { sink: SinkStatus; running: boolean }) {
  return (
    <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
      {sink.label} · {modeLabel(sink, running)}
    </span>
  )
}

/** A mouse light bar / receiver bar preview: the accent colour scaled by intensity, glowing when loud. */
export function LightBar({ color, intensity }: { color: RGB; intensity: number }) {
  const k = Math.max(0, Math.min(1, intensity))
  const rgb = `${Math.round(color.r * k)},${Math.round(color.g * k)},${Math.round(color.b * k)}`
  return (
    <span
      className="lightbar"
      style={k > 0 ? { background: `rgb(${rgb})`, boxShadow: `0 0 ${Math.round(18 * k)}px rgba(${rgb},${0.8 * k})` } : undefined}
    />
  )
}
