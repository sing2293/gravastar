import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { KeyId, KeyboardLayout, LayoutKey } from '@/model/keyboard'
import type { RGB } from '@/model/device'
import { layoutBounds } from '@/drivers/k98pro/layout'

export interface KeyDecoration {
  /** Text drawn on the key; defaults to the layout legend. */
  label?: ReactNode
  /** Small secondary text, bottom-right. */
  sub?: ReactNode
  /** Backlight colour drawn behind the legend. */
  color?: RGB
  modified?: boolean
  pressed?: boolean
}

export interface KeyboardStageProps {
  layout: KeyboardLayout
  selected?: Set<KeyId>
  decorate?: (key: LayoutKey) => KeyDecoration | undefined
  onKeyClick?: (key: LayoutKey, event: React.MouseEvent) => void
  /** Gap between keys in key units. */
  gap?: number
}

/** Renders a physical layout at the container's width; key positions come from the vendor's geometry. */
export function KeyboardStage({ layout, selected, decorate, onKeyClick, gap = 0.08 }: KeyboardStageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const bounds = layoutBounds(layout)
  const unit = width / bounds.width
  return (
    <div className="stage" ref={ref}>
      <div className="keys" style={{ height: bounds.height * unit }}>
        {layout.keys.map((k) => {
          const deco = decorate?.(k)
          const isSelected = selected?.has(k.id)
          const glow = deco?.color
          return (
            <div
              key={k.id}
              className={['key', isSelected ? 'selected' : '', deco?.modified ? 'modified' : '', deco?.pressed ? 'pressed' : ''].filter(Boolean).join(' ')}
              style={{ left: k.x * unit, top: k.y * unit, width: Math.max(4, (k.w - gap) * unit), height: Math.max(4, (k.h - gap) * unit), fontSize: Math.max(8, Math.min(13, unit * 0.22)) }}
              title={`#${k.id} ${k.label}`}
              onClick={(e) => onKeyClick?.(k, e)}
            >
              {glow && <span className="glow" style={{ background: `radial-gradient(circle, rgba(${glow.r},${glow.g},${glow.b},0.9), rgba(${glow.r},${glow.g},${glow.b},0.25))` }} />}
              <span style={{ position: 'relative' }}>{deco?.label ?? k.label}</span>
              {deco?.sub && <span className="sub">{deco.sub}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
