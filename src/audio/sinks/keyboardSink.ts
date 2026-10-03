import type { BeadColor, KeyboardDriver, KeyboardLayout, LedBead, PerKeyColor, ZoneLighting } from '@/model/keyboard'
import { expandLedAliases, ledIds } from '@/drivers/k98pro/layout'
import { presetById } from '../presets'
import type { RGB } from '@/model/device'
import type { LightingFrame, LightingSink, MusicFrame, SinkStatus } from '../types'

export interface KeyboardSinkOptions {
  /** Device writes per second, upper bound. The achieved rate is also capped by how fast the keyboard replies. */
  maxFps: number
}

/**
 * Share of the time the device link may spend writing colours. Keeping it below 1 leaves room for everything else
 * on the same HID queue (battery polls, key-travel bubbles) — without it a slow link queues frames faster than it
 * drains them and the lighting lurches instead of flowing.
 */
const DUTY_CYCLE = 0.8

/** Streams per-key colours to a K98 Pro-class keyboard through its real-time RGB command. */
export class KeyboardSink implements LightingSink {
  readonly kind = 'keyboard' as const
  private previous: ZoneLighting | undefined
  private lastSend = 0
  private sending = false
  /** Rolling average of how long one frame takes on the wire, ms. */
  private sendMs = 0
  private writes = 0
  private fps = 0
  private windowStart: number | undefined
  private windowCount = 0
  private active = false
  private error: string | undefined
  private mode: string | undefined
  private note: string | undefined
  /** Key id → its LEDs, when the firmware exposes the bead table (wide keys own several LEDs). */
  private beads: Map<number, LedBead[]> | undefined
  lastLighting: LightingFrame | undefined

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly driver: KeyboardDriver,
    readonly layout: KeyboardLayout,
    public options: KeyboardSinkOptions = { maxFps: 30 },
  ) {}

  async prepare(): Promise<void> {
    const caps = await this.driver.lighting.capabilities()
    this.previous = await this.driver.lighting.get('main')
    if (caps.customEffectId !== undefined && this.previous.effectId !== caps.customEffectId) await this.driver.lighting.setEffect('main', caps.customEffectId)
    this.mode = caps.streaming.perKey ? 'per-key streaming' : caps.streaming.fullKeys ? 'whole-board streaming' : 'streaming (unreported by firmware)'
    this.note = this.aliasNote().replace(/^; /, '') || undefined
    this.beads = undefined
    if (caps.streaming.beads) await this.loadBeads()
    this.active = true
    this.error = undefined
    this.writes = 0
    this.fps = 0
    this.sendMs = 0
    this.windowStart = undefined
    this.windowCount = 0
  }

  /** Writes per second this keyboard can actually take, from the measured round-trip. */
  private get pace(): number {
    const ceiling = this.sendMs > 0 ? (1000 / this.sendMs) * DUTY_CYCLE : this.options.maxFps
    return Math.max(2, Math.min(this.options.maxFps, ceiling))
  }

  /**
   * The per-key command lights one LED per key id; keys such as Space carry three. With the bead table we address
   * every LED of every key instead.
   */
  private async loadBeads(): Promise<void> {
    try {
      const table = await this.driver.lighting.getLedBeads(ledIds(this.layout))
      if (!table.length) return
      this.beads = new Map(table.map((k) => [k.id, k.beads]))
      const total = table.reduce((n, k) => n + k.beads.length, 0)
      const label = (id: number) => this.layout.keys.find((k) => k.id === id)?.label ?? `#${id}`
      const wide = table.filter((k) => k.beads.length > 1).map((k) => `${label(k.id)} ×${k.beads.length}`)
      this.mode = 'per-LED streaming'
      this.note = `${total} LEDs on ${table.length} key positions${wide.length ? ` — ${wide.slice(0, 6).join(', ')}${wide.length > 6 ? '…' : ''}` : ''}${this.aliasNote()}`
    } catch {
      /* no bead table: fall back to key ids */
    }
  }

  /** e.g. "Space also drives LEDs 106, 107, 109, 110". */
  private aliasNote(): string {
    const a = this.layout.ledAliases ?? {}
    const parts = Object.entries(a)
      .filter(([, ids]) => ids?.length)
      .map(([id, ids]) => `${this.layout.keys.find((k) => k.id === Number(id))?.label ?? id} +${ids!.length}`)
    return parts.length ? `; hidden LEDs: ${parts.join(', ')}` : ''
  }

  private sendKeys(perKey: PerKeyColor[]): Promise<void> {
    const keys = expandLedAliases(this.layout, perKey)
    if (!this.beads) return this.driver.lighting.stream(keys)
    const beads: BeadColor[] = []
    const rest: PerKeyColor[] = []
    for (const k of keys) {
      const b = this.beads.get(k.id)
      if (b?.length) for (const bead of b) beads.push({ ...bead, color: k.color })
      else rest.push(k)
    }
    const sends = [this.driver.lighting.streamBeads(beads)]
    if (rest.length) sends.push(this.driver.lighting.stream(rest))
    return Promise.all(sends).then(() => undefined)
  }

  /**
   * Keeps the animation's shape but paints it in one colour: each key's brightness (its strongest channel) scaled
   * onto the target. Without this the colour picker would do nothing for the rainbow presets, which is most of them.
   */
  private static tint(color: RGB, target: RGB): RGB {
    const v = Math.max(color.r, color.g, color.b) / 255
    return { r: Math.round(target.r * v), g: Math.round(target.g * v), b: Math.round(target.b * v) }
  }

  push(frame: MusicFrame): void {
    if (!this.active || this.sending) return
    const now = frame.audio.time
    if (now - this.lastSend < 1000 / this.pace) return
    const preset = presetById(frame.preset)
    let lighting = preset.render(frame.audio, { layout: this.layout, t: frame.t, color: frame.color, sensitivity: frame.sensitivity })
    if (frame.colorMode !== 'preset' && !preset.usesColor) {
      lighting =
        'all' in lighting
          ? { all: KeyboardSink.tint(lighting.all, frame.color) }
          : { keys: lighting.keys.map((k) => ({ id: k.id, color: KeyboardSink.tint(k.color, frame.color) })) }
    }
    this.lastLighting = lighting
    this.lastSend = now
    this.sending = true
    const startedAt = performance.now()
    const send = 'all' in lighting ? this.driver.lighting.streamAll(lighting.all) : this.sendKeys(lighting.keys)
    send
      .then(() => {
        const took = performance.now() - startedAt
        this.sendMs = this.sendMs ? this.sendMs * 0.8 + took * 0.2 : took
        this.writes++
        this.windowCount++
        if (this.windowStart === undefined) this.windowStart = now
        else if (now - this.windowStart >= 1000) {
          this.fps = Math.round((this.windowCount * 1000) / (now - this.windowStart))
          this.windowStart = now
          this.windowCount = 0
        }
      })
      .catch((e: Error) => {
        this.error = e.message
      })
      .finally(() => {
        this.sending = false
      })
  }

  async release(): Promise<void> {
    this.active = false
    this.lastLighting = undefined
    if (this.previous) {
      try {
        await this.driver.lighting.set('main', this.previous)
      } catch {
        /* keyboard may be gone */
      }
    }
    this.previous = undefined
  }

  status(): Omit<SinkStatus, 'enabled'> {
    const pacing = this.sendMs > 0 ? ` · ${Math.round(this.sendMs)} ms/frame, up to ${Math.round(this.pace)} fps` : ''
    return { id: this.id, label: this.label, kind: this.kind, active: this.active, fps: this.fps, writes: this.writes, mode: this.mode, note: this.note ? this.note + pacing : pacing.slice(3) || undefined, error: this.error }
  }
}
