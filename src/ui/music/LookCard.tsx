import type { ReactNode } from 'react'
import { MusicSyncEngine } from '@/audio/musicSync'
import type { ColorMode } from '@/audio/types'
import { Card, Field, Select, Slider, hexToRgb, rgbToHex } from '@/ui/components/kit'
import { useEngineOptions } from './useMusicSync'

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: 'preset', label: 'The preset’s own colours' },
  { value: 'fixed', label: 'One colour I pick' },
  { value: 'random', label: 'A random colour on every beat' },
]

/** Preset / sensitivity / colour — engine-wide options shared by every device. `children` adds per-device controls. */
export function LookCard({ children }: { children?: ReactNode }) {
  const [options, update] = useEngineOptions()
  const presets = MusicSyncEngine.presets()
  const preset = presets.find((p) => p.id === options.preset)
  return (
    <Card title="Look">
      <div className="stack">
        <Field label="Preset" hint={preset?.description}>
          <Select
            value={options.preset}
            options={presets.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => update({ preset: v })}
          />
        </Field>
        <Field label={`Sensitivity — ${Math.round(options.sensitivity * 100)}%`}>
          <Slider
            value={Math.round(options.sensitivity * 100)}
            min={25}
            max={250}
            step={5}
            onChange={(v) => update({ sensitivity: v / 100 })}
            format={(v) => `${v}%`}
          />
        </Field>
        <Field
          label={`Beat sensitivity — ${Math.round(options.beatSensitivity * 100)}%`}
          hint="Raise it if the lights miss beats on quiet or bass-light music; lower it if they fire on everything."
        >
          <Slider
            value={Math.round(options.beatSensitivity * 100)}
            min={40}
            max={250}
            step={10}
            onChange={(v) => update({ beatSensitivity: v / 100 })}
            format={(v) => `${v}%`}
          />
        </Field>
        <Field
          label="Colour"
          hint={
            options.colorMode === 'fixed'
              ? 'The animation keeps its shape and brightness but is painted in this one colour, whichever preset is running.'
              : options.colorMode === 'random'
                ? 'Every beat picks a new colour; the picker is unused.'
                : 'Most presets are rainbows and choose their own colours — switch to “One colour I pick” to override them.'
          }
        >
          <div className="stack" style={{ gap: 8 }}>
            <Select value={options.colorMode} options={COLOR_MODES} onChange={(v) => update({ colorMode: v })} />
            <div className="row">
              <input
                type="color"
                className="color-input"
                value={rgbToHex(options.color)}
                disabled={options.colorMode === 'random' || (options.colorMode === 'preset' && !preset?.usesColor)}
                onChange={(e) => update({ color: hexToRgb(e.target.value), ...(options.colorMode === 'preset' && !preset?.usesColor ? { colorMode: 'fixed' as ColorMode } : {}) })}
              />
              <span className="dim" style={{ fontSize: 12 }}>
                {options.colorMode === 'fixed'
                  ? 'Used everywhere'
                  : options.colorMode === 'random'
                    ? 'A new colour on each beat'
                    : preset?.usesColor
                      ? 'Used by this preset'
                      : 'Pick one to switch this preset to a single colour'}
              </span>
            </div>
          </div>
        </Field>
        {children}
      </div>
    </Card>
  )
}
