import type { ReactNode } from 'react'
import { MusicSyncEngine } from '@/audio/musicSync'
import { Card, Field, Select, Slider, Toggle, hexToRgb, rgbToHex } from '@/ui/components/kit'
import { useEngineOptions } from './useMusicSync'

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
        <Field label="Colour">
          <div className="stack" style={{ gap: 8 }}>
            <Toggle
              checked={options.randomColor}
              onChange={(v) => update({ randomColor: v })}
              label="Random colour on every beat"
            />
            <div className="row">
              <input
                type="color"
                className="color-input"
                value={rgbToHex(options.color)}
                disabled={options.randomColor || !preset?.usesColor}
                onChange={(e) => update({ color: hexToRgb(e.target.value) })}
              />
              <span className="dim" style={{ fontSize: 12 }}>
                {options.randomColor
                  ? 'A new colour is picked on each beat'
                  : preset?.usesColor
                    ? 'Used by this preset'
                    : 'This preset picks its own colours'}
              </span>
            </div>
          </div>
        </Field>
        {children}
      </div>
    </Card>
  )
}
