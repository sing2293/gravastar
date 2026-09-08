import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Button({ variant, small, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost'; small?: boolean }) {
  return <button {...props} className={['btn', variant, small ? 'small' : '', className ?? ''].filter(Boolean).join(' ')} />
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={['card', className ?? ''].join(' ')}>
      {(title || actions) && (
        <div className="row between" style={{ marginBottom: 12 }}>
          {title ? <h2 style={{ margin: 0 }}>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="dim" style={{ fontSize: 12 }}>{hint}</span>}
    </div>
  )
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: ReactNode }) {
  return (
    <div className="row">
      <button type="button" role="switch" aria-checked={checked} className="toggle" disabled={disabled} onClick={() => onChange(!checked)} />
      {label && <span className={disabled ? 'dim' : ''}>{label}</span>}
    </div>
  )
}

export function Slider({ value, min, max, step = 1, onChange, onCommit, disabled, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void; disabled?: boolean; format?: (v: number) => string }) {
  return (
    <div className="row" style={{ gap: 12 }}>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
      <span className="mono" style={{ minWidth: 56, textAlign: 'right' }}>{format ? format(value) : value}</span>
    </div>
  )
}

export function Select<T extends string | number>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; disabled?: boolean }) {
  const isNumber = typeof value === 'number'
  return (
    <select className="select" value={String(value)} disabled={disabled} onChange={(e) => onChange((isNumber ? Number(e.target.value) : e.target.value) as T)}>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: string; badge?: ReactNode }[]; onChange: (id: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={['tab', t.id === value ? 'active' : ''].join(' ')} onClick={() => onChange(t.id)}>
          {t.label} {t.badge}
        </button>
      ))}
    </div>
  )
}

export function Notice({ kind = 'warn', children }: { kind?: 'warn' | 'error' | 'info'; children: ReactNode }) {
  return <div className={['notice', kind === 'warn' ? '' : kind].join(' ')}>{children}</div>
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'accent' | 'warn' }) {
  return <span className={['badge', tone ?? ''].join(' ')}>{children}</span>
}

export const rgbToHex = (c: { r: number; g: number; b: number }): string => '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
export const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const n = parseInt(hex.replace('#', ''), 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}
