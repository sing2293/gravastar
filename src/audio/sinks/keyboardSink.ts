import type { BeadColor, KeyboardDriver, KeyboardLayout, LedBead, PerKeyColor, ZoneLighting } from '@/model/keyboard'
import { presetById } from '../presets'
import type { LightingFrame, LightingSink, MusicFrame, SinkStatus } from '../types'

export interface KeyboardSinkOptions {
  /** Device writes per second, upper bound. */
  maxFps: number
}

/** Streams per-key colours to a K98 Pro-class keyboard through its real-time RGB command. */
export class KeyboardSink implements LightingSink {
  readonly kind = 'keyboard' as const
  private previous: ZoneLighting | undefined
  private lastSend = 0
  private sending = false
  private writes = 0
  private fps = 0
  private windowStart = 0
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
    this.note = undefined
    this.beads = undefined
    if (caps.streaming.beads) await this.loadBeads()
    this.active = true
    this.error = undefined
    this.writes = 0
    this.fps = 0
    this.windowStart = performance.now()
    this.windowCount = 0
  }

  /**
   * The per-key command lights one LED per key id; keys such as Space carry three. With the bead table we address
   * every LED of every key instead.
   */
  private async loadBeads(): Promise<void> {
    try {
      const table = await this.driver.lighting.getLedBeads(this.layout.keys.map((k) => k.id))
      if (!table.length) return
      this.beads = new Map(table.map((k) => [k.id, k.beads]))
      const total = table.reduce((n, k) => n + k.beads.length, 0)
      const label = (id: number) => this.layout.keys.find((k) => k.id === id)?.label ?? `#${id}`
      const wide = table.filter((k) => k.beads.length > 1).map((k) => `${label(k.id)} ×${k.beads.length}`)
      this.mode = 'per-LED streaming'
      this.note = `${total} LEDs on ${table.length} keys${wide.length ? ` — ${wide.slice(0, 6).join(', ')}${wide.length > 6 ? '…' : ''}` : ''}`
    } catch {
      /* no bead table: fall back to key ids */
    }
  }

  private sendKeys(keys: PerKeyColor[]): Promise<void> {
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

  push(frame: MusicFrame): void {
    if (!this.active || this.sending) return
    const now = frame.audio.time
    if (now - this.lastSend < 1000 / this.options.maxFps) return
    const preset = presetById(frame.preset)
    const lighting = preset.render(frame.audio, { layout: this.layout, t: frame.t, color: frame.color, sensitivity: frame.sensitivity })
    this.lastLighting = lighting
    this.lastSend = now
    this.sending = true
    const send = 'all' in lighting ? this.driver.lighting.streamAll(lighting.all) : this.sendKeys(lighting.keys)
    send
      .then(() => {
        this.writes++
        this.windowCount++
        if (now - this.windowStart >= 1000) {
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
    return { id: this.id, label: this.label, kind: this.kind, active: this.active, fps: this.fps, writes: this.writes, mode: this.mode, note: this.note, error: this.error }
  }
}
