import type { ReactNode } from 'react'
import { MusicSyncEngine } from '@/audio/musicSync'
import { Card, Field, Select, Slider, hexToRgb, rgbToHex } from '@/ui/components/kit'
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
        <Field label="Colour">
          <div className="row">
            <input
              type="color"
              className="color-input"
              value={rgbToHex(options.color)}
              disabled={!preset?.usesColor}
              onChange={(e) => update({ color: hexToRgb(e.target.value) })}
            />
            <span className="dim" style={{ fontSize: 12 }}>
              {preset?.usesColor ? 'Used by this preset' : 'This preset picks its own colours'}
            </span>
          </div>
        </Field>
        {children}
      </div>
    </Card>
  )
}
