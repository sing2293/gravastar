/**
 * Music sink for Compx-based GravaStar mice (Mercury M1 Pro / M2 / X / X Pro).
 *
 * The mouse's own light bar is a settings-memory record (7-byte block at 0xA0 + on/off value at 0xA7, written
 * with `WriteFlashData`; docs/reverse-engineering/mouse/02-features.md, light 3525–3606). Flash endurance is
 * unknown, so the sink treats every write there as expensive and prefers command-driven paths, probed at run time:
 *
 *   1. amplitude  — 0xB2 OfficeMusicParameter + 0xB6 OfficeMusicAmplitude (20 four-bit levels, two per byte).
 *                   Documented for Compx *keyboards* (01-transport-commands.md §11, HIDHandle.js 2272–2285);
 *                   whether any mouse firmware accepts them is UNVERIFIED — unknown commands are NAKed with
 *                   status 1, which is how `probe()` finds out.
 *   2. receiver   — 0x18 SetDongleRGBBarMode `[mode, r, g, b, speed, brightness, time]`, answered by 0x19
 *                   (status 1 ⇒ no bar). A command, not a memory write: safe at a few updates per second.
 *   3. pulse      — the mouse's own light bar in **firmware breathing mode** (light block mode 2). The firmware
 *                   animates the fade, so the mouse keeps pulsing with no further writes; the host only rewrites
 *                   the block when the colour or the tempo-derived speed actually changes. Visibly beat-driven at
 *                   a fraction of the memory writes of host-driven animation. Default for the body light.
 *   4. strobe     — host-driven flash, entirely in software: a beat writes the block at full brightness, and
 *                   `strobeOnMs` later a second write puts it out again, so the light blinks once per beat. Two
 *                   memory writes per beat — the most reactive and by far the most wear — opt-in and budgeted.
 *   5. gentle     — colour change on strong beats only, ≥ `gentleMinIntervalMs` apart; the least wear.
 *
 * The receiver's RGB bar is a command path with no memory cost, so when the receiver has one it is driven
 * **alongside** the body light rather than instead of it (`dongle` as a primary means "bar only").
 */
import type { RGB } from '@/model/device'
import type { DongleBar, MouseDriver, MouseLightEffect, MouseMusicCapabilities, MouseMusicService } from '@/model/mouse'
import { TempoTracker, breathingSpeed, type Tempo } from '../tempo'
import type { LightingSink, MusicFrame, SinkStatus } from '../types'

export type MouseSinkStrategy = 'amplitude' | 'pulse' | 'strobe' | 'dongle' | 'gentle'
export type MouseSinkMode = 'none' | 'amplitude' | 'pulse (firmware breathing)' | 'strobe (beat writes)' | 'receiver bar' | 'gentle (memory-safe)'

export interface MouseSinkOptions {
  /** Amplitude-stream (0xB6) writes per second, upper bound; fire-and-forget commands, no memory wear. */
  maxFps: number
  /** Receiver-bar (0x18) writes per second, upper bound; commands, no memory wear. */
  dongleFps: number
  /** Gentle mode: minimum gap between two light-bar flash writes. */
  gentleMinIntervalMs: number
  /** Gentle mode: beats weaker than this (0..1) are ignored. */
  gentleBeatThreshold: number
  /** Pulse mode: shortest gap between two light-block rewrites. */
  pulseMinIntervalMs: number
  /** Pulse mode: how far the colour must move (0..255 per channel, Euclidean) before it is worth a write. */
  pulseColorThreshold: number
  /** Pulse mode: nudge for the tempo → firmware speed mapping (−9..9), for tuning against the real device. */
  pulseSpeedOffset: number
  /** Strobe mode: maximum writes per second (two writes make one blink). */
  strobeFps: number
  /** Strobe mode: how long the flash stays lit before the dark frame is written, ms. */
  strobeOnMs: number
  /** Strobe mode: beats weaker than this (0..1) do not flash. */
  strobeBeatThreshold: number
  /** Memory writes allowed per session; the sink pauses itself once reached. */
  writeBudget: number
  /** Strategy to try first; `auto` = amplitude → receiver bar → gentle. An unavailable choice falls back to `auto`. */
  prefer?: 'auto' | MouseSinkStrategy
  /** Forward colour of the amplitude look sent with 0xB2 (backward colour is black). Defaults to the app accent. */
  accent?: RGB
}

export const DEFAULT_MOUSE_SINK_OPTIONS: MouseSinkOptions = {
  maxFps: 10,
  dongleFps: 4,
  gentleMinIntervalMs: 1500,
  gentleBeatThreshold: 0.45,
  pulseMinIntervalMs: 700,
  pulseColorThreshold: 60,
  pulseSpeedOffset: 0,
  strobeFps: 14,
  strobeOnMs: 90,
  strobeBeatThreshold: 0.12,
  writeBudget: 2000,
  prefer: 'auto',
  accent: { r: 155, g: 255, b: 49 },
}

/**
 * Optional extensions a `MouseMusicService` may implement so the sink can keep the receiver bar's mode / speed /
 * time while only colour and brightness follow the music. The base contract only promises `snapshot(): void`.
 */
export interface MouseMusicSnapshotReader {
  /** What `snapshot()` captured for the receiver bar, without bus traffic. */
  dongleBarSnapshot?(): DongleBar | undefined
  /** Asks the receiver with 0x19 (`CompxMusic.readDongleBar`); `undefined` when there is no bar. */
  readDongleBar?(): Promise<DongleBar | undefined>
}

export const BUDGET_NOTE = 'write budget reached — mouse paused to protect its memory'

const MODE_LABEL: Record<MouseSinkStrategy, MouseSinkMode> = {
  amplitude: 'amplitude',
  pulse: 'pulse (firmware breathing)',
  strobe: 'strobe (beat writes)',
  dongle: 'receiver bar',
  gentle: 'gentle (memory-safe)',
}
const AUTO_ORDER: MouseSinkStrategy[] = ['amplitude', 'pulse', 'dongle', 'gentle']
/** Light modes (`LIGHT_MODES`, 02-features.md §7.2): 2 breathes in firmware, 3 is a steady colour. */
const BREATHING_LIGHT_MODE = 2
const FIXED_COLOR_MODE = 3
/** Vendor `defaultDongleRGBBar` (01-transport-commands.md §6.4): mode 0, red, speed 3, brightness 3, time 1. */
const DONGLE_BAR_DEFAULTS = { speed: 3, time: 1 }
/** 0xB6 carries 20 four-bit amplitudes. */
export const AMPLITUDE_LEVELS = 20
export const AMPLITUDE_MAX = 15
/** Receiver-bar colour floor so a quiet passage dims the bar instead of turning it off. */
export const BAR_COLOR_FLOOR = 0.15
/** Light-bar brightness range is 0..9 (light block byte 5). */
const LIGHT_BRIGHTNESS_MAX = 9

/**
 * Resamples `bands` (any count, each 0..1) onto `count` linearly interpolated levels 0..`max`, scaled by
 * `sensitivity` and clamped — the 0xB6 amplitude payload.
 */
export function bandsToLevels(
  bands: ArrayLike<number>,
  sensitivity: number,
  count = AMPLITUDE_LEVELS,
  max = AMPLITUDE_MAX,
): number[] {
  const n = bands.length
  const out = new Array<number>(count).fill(0)
  if (n === 0) return out
  for (let i = 0; i < count; i++) {
    const pos = count > 1 ? (i * (n - 1)) / (count - 1) : 0
    const lo = Math.floor(pos)
    const hi = Math.min(n - 1, lo + 1)
    const frac = pos - lo
    const v = (bands[lo] ?? 0) * (1 - frac) + (bands[hi] ?? 0) * frac
    out[i] = Math.max(0, Math.min(max, Math.round(v * sensitivity * max)))
  }
  return out
}

/** Accent scaled by intensity with a floor, so the bar never reads as "off". */
/** 0..1 loudness → the light block's 0..9 brightness byte, never fully off while a session runs. */
export function brightnessFor(intensity: number): number {
  return Math.max(1, Math.round(Math.max(0, Math.min(1, intensity)) * LIGHT_BRIGHTNESS_MAX))
}

const PULSE_STEPS = [3, 6, 9]
/** Loudness needed to climb to the next step, and to fall back from it — the gap is the dead band. */
const PULSE_UP = [0.34, 0.67]
const PULSE_DOWN = [0.26, 0.59]

/**
 * Pulse brightness in three coarse steps (3 / 6 / 9) with hysteresis. The firmware's fade already carries the
 * movement, so only a real change in loudness is worth an erase cycle — and a level hovering on a boundary must
 * not flap the light block back and forth. `previous` is the step currently on the device.
 */
export function pulseBrightness(intensity: number, previous?: number): number {
  const v = Math.max(0, Math.min(1, intensity))
  let i = previous === undefined ? 0 : Math.max(0, PULSE_STEPS.indexOf(previous))
  while (i < PULSE_STEPS.length - 1 && v >= PULSE_UP[i]!) i++
  while (i > 0 && v < PULSE_DOWN[i - 1]!) i--
  return PULSE_STEPS[i]!
}

export function barColor(accent: RGB, intensity: number, floor = BAR_COLOR_FLOOR): RGB {
  const k = Math.max(floor, Math.min(1, intensity))
  return { r: Math.round(accent.r * k), g: Math.round(accent.g * k), b: Math.round(accent.b * k) }
}

/** Strategies to try, preferred first, then the auto order, keeping only what the probe reported. */
export function strategyOrder(
  caps: MouseMusicCapabilities,
  prefer: MouseSinkOptions['prefer'] = 'auto',
): MouseSinkStrategy[] {
  const available: Record<MouseSinkStrategy, boolean> = {
    amplitude: caps.amplitudeStream,
    pulse: caps.flashLight,
    strobe: caps.flashLight,
    dongle: caps.dongleBar,
    gentle: caps.flashLight,
  }
  const order = prefer && prefer !== 'auto' ? [prefer, ...AUTO_ORDER.filter((s) => s !== prefer)] : AUTO_ORDER
  return order.filter((s) => available[s])
}

const scaleRgb = (c: RGB, k: number): RGB => ({
  r: Math.round(c.r * k),
  g: Math.round(c.g * k),
  b: Math.round(c.b * k),
})

const rgbDistance = (a: RGB, b: RGB): number => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)

/** Wall clock for measuring device round-trips (frame timestamps are the audio clock). */
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Whether a new look is different enough from the one the firmware is already running to be worth a write. */
export function effectChanged(next: MouseLightEffect, last: MouseLightEffect | undefined, colorThreshold: number): boolean {
  if (!last) return true
  return (
    next.mode !== last.mode ||
    next.speed !== last.speed ||
    next.brightness !== last.brightness ||
    rgbDistance(next.color, last.color) >= colorThreshold
  )
}

/** The two frames of a software strobe: lit on the beat, dark again `strobeOnMs` later. */
export function strobeFrame(accent: RGB, lit: boolean): MouseLightEffect {
  return lit
    ? { mode: FIXED_COLOR_MODE, color: accent, speed: 0, brightness: LIGHT_BRIGHTNESS_MAX }
    : { mode: FIXED_COLOR_MODE, color: scaleRgb(accent, 0.06), speed: 0, brightness: 0 }
}

export class MouseSink implements LightingSink {
  readonly kind = 'mouse' as const
  options: MouseSinkOptions
  private readonly music: MouseMusicService | undefined
  private strategy: MouseSinkStrategy | undefined
  private mode: MouseSinkMode = 'none'
  private active = false
  private inFlight = false
  private restoreNeeded = false
  private lastSend = -Infinity
  private writes = 0
  private fps = 0
  private windowStart: number | undefined
  private windowCount = 0
  private note: string | undefined
  private error: string | undefined
  private dongleBase: Pick<DongleBar, 'mode' | 'speed' | 'time'> = { mode: FIXED_COLOR_MODE, ...DONGLE_BAR_DEFAULTS }
  /** Settings-memory writes this session (what the budget counts); bar and amplitude frames are free. */
  private memoryWrites = 0
  private lastEffect: MouseLightEffect | undefined
  private readonly tempo = new TempoTracker()
  /** Strobe: when the current flash was lit, or undefined while dark. */
  private litSince: number | undefined
  /** Round-trip of the last settings-memory write, ms — what limits how fast a software strobe can blink. */
  private writeMs = 0
  /** The receiver bar, driven alongside a body-light strategy. */
  private bar = false
  private barInFlight = false
  private lastBarSend = -Infinity
  private barWrites = 0

  constructor(
    readonly id: string,
    readonly label: string,
    driver: MouseDriver,
    options: Partial<MouseSinkOptions> = {},
  ) {
    this.music = driver.music
    this.options = { ...DEFAULT_MOUSE_SINK_OPTIONS, ...options }
  }

  async prepare(): Promise<void> {
    if (this.active) return
    this.error = undefined
    this.note = undefined
    this.writes = 0
    this.fps = 0
    this.windowStart = undefined
    this.windowCount = 0
    this.lastSend = -Infinity
    this.inFlight = false
    this.memoryWrites = 0
    this.lastEffect = undefined
    this.tempo.reset()
    this.litSince = undefined
    this.writeMs = 0
    this.bar = false
    this.barInFlight = false
    this.lastBarSend = -Infinity
    this.barWrites = 0
    if (!this.music) {
      this.setMode(undefined, 'this mouse driver has no music service')
      return
    }
    const caps = await this.music.probe()
    const prefer = this.options.prefer ?? 'auto'
    const candidates = strategyOrder(caps, prefer)
    if (prefer !== 'auto' && candidates[0] !== prefer)
      this.note = `${MODE_LABEL[prefer]} is not available on this mouse`
    if (!candidates.length) {
      this.setMode(
        undefined,
        this.note ?? 'no music-capable light found (amplitude, receiver bar and light bar all unavailable)',
      )
      return
    }
    // Nothing below changes device state until the snapshot exists; `restore` is the only way back.
    await this.music.snapshot()
    this.restoreNeeded = true
    for (const strategy of candidates) {
      if (strategy === 'amplitude') {
        try {
          // 0xB2 look: mode 1, speed 5, brightness 9, colour mode 0, forward = accent, backward = black.
          await this.music.startAmplitude({
            mode: 1,
            speed: 5,
            brightness: 9,
            colorMode: 0,
            forward: this.options.accent ?? DEFAULT_MOUSE_SINK_OPTIONS.accent!,
            backward: { r: 0, g: 0, b: 0 },
          })
        } catch (e) {
          // A positive probe can still be followed by a NAK on 0xB2 (UNVERIFIED firmware); fall through.
          this.note = `amplitude mode rejected (${(e as Error).message})`
          continue
        }
      }
      // A body light that the firmware blanks while the mouse moves would make any animation invisible.
      if (strategy === 'pulse' || strategy === 'strobe' || strategy === 'gentle') {
        try {
          await this.music.enterLightSession()
        } catch (e) {
          this.note = `could not take over the light (${(e as Error).message})`
        }
      }
      // The receiver bar costs no memory, so drive it as well as the body light whenever the receiver has one.
      this.bar = caps.dongleBar
      if (this.bar) this.dongleBase = await this.readDongleBase()
      this.setMode(strategy, this.note)
      return
    }
    this.setMode(undefined, this.note ?? 'no usable music path')
  }

  /** Receiver look to keep while colour / brightness follow the music: the service's snapshot, else vendor defaults. */
  private async readDongleBase(): Promise<Pick<DongleBar, 'mode' | 'speed' | 'time'>> {
    const reader = this.music as MouseMusicService & MouseMusicSnapshotReader
    let bar: DongleBar | undefined
    try {
      bar = reader.dongleBarSnapshot?.() ?? (await reader.readDongleBar?.())
    } catch {
      bar = undefined
    }
    // Mode 0 is "off" (`LIGHT_MODES`); a bar that was off is driven as fixed colour, `restore` puts it back.
    return {
      mode: bar?.mode || FIXED_COLOR_MODE,
      speed: bar?.speed ?? DONGLE_BAR_DEFAULTS.speed,
      time: bar?.time ?? DONGLE_BAR_DEFAULTS.time,
    }
  }

  push(frame: MusicFrame): void {
    if (!this.active || !this.music || !this.strategy) return
    const now = frame.audio.time
    if (frame.audio.beat) this.tempo.beat(now)
    if (this.strategy !== 'dongle') this.pushBar(frame, now)
    if (this.inFlight) return
    let write: Promise<void>
    let memory = false
    switch (this.strategy) {
      case 'amplitude': {
        if (now - this.lastSend < 1000 / this.options.maxFps) return
        write = this.music.sendAmplitudes(bandsToLevels(frame.audio.bands, frame.sensitivity))
        break
      }
      case 'pulse': {
        // The firmware runs the fade; a write is only needed when the look itself should change.
        if (now - this.lastSend < this.options.pulseMinIntervalMs) return
        const next: MouseLightEffect = {
          mode: BREATHING_LIGHT_MODE,
          color: frame.accent,
          speed: breathingSpeed(this.tempo.tempo.bpm, this.options.pulseSpeedOffset),
          brightness: pulseBrightness(frame.intensity, this.lastEffect?.brightness),
        }
        if (!effectChanged(next, this.lastEffect, this.options.pulseColorThreshold)) return
        if (this.budgetReached()) return
        this.lastEffect = next
        write = this.music.setLightEffect(next)
        memory = true
        break
      }
      case 'strobe': {
        // Pure software blink: light up on the onset, write the dark frame once the flash has been seen.
        if (now - this.lastSend < 1000 / this.options.strobeFps) return
        const beat = frame.audio.beat && frame.audio.beatStrength >= this.options.strobeBeatThreshold
        const lit = beat || (this.litSince !== undefined && now - this.litSince < this.options.strobeOnMs)
        if (lit && this.litSince === undefined) this.litSince = now
        if (!lit && this.litSince === undefined) return // already dark and no beat: nothing to write
        const next = strobeFrame(frame.accent, lit)
        if (!effectChanged(next, this.lastEffect, 12)) return
        if (this.budgetReached()) return
        if (!lit) this.litSince = undefined
        this.lastEffect = next
        write = this.music.setLightEffect(next)
        memory = true
        break
      }
      case 'dongle': {
        if (now - this.lastSend < 1000 / this.options.dongleFps) return
        write = this.music.setDongleBar({
          ...this.dongleBase,
          color: barColor(frame.accent, frame.intensity),
          brightness: brightnessFor(frame.intensity),
        })
        break
      }
      case 'gentle': {
        if (!frame.audio.beat || frame.audio.beatStrength < this.options.gentleBeatThreshold) return
        if (this.budgetReached()) return
        if (now - this.lastSend < this.options.gentleMinIntervalMs) return
        write = this.music.setLightColor(frame.accent, LIGHT_BRIGHTNESS_MAX)
        memory = true
        break
      }
    }
    this.lastSend = now
    this.inFlight = true
    const startedAt = nowMs()
    write
      .then(() => {
        this.error = undefined
        if (memory) this.writeMs = Math.round(nowMs() - startedAt)
      })
      .catch((e: Error) => {
        this.error = e.message
      })
      .finally(() => {
        // Counted whether or not the device acknowledged: a rejected flash write may still have cost an erase cycle.
        this.inFlight = false
        this.countWrite(now)
        if (memory) {
          this.memoryWrites++
          if (this.memoryWrites >= this.options.writeBudget) this.note = BUDGET_NOTE
        }
      })
  }

  /** The receiver's RGB bar: a command, so it is paced by time only and never touches the budget. */
  private pushBar(frame: MusicFrame, now: number): void {
    if (!this.bar || this.barInFlight || !this.music) return
    if (now - this.lastBarSend < 1000 / this.options.dongleFps) return
    this.lastBarSend = now
    this.barInFlight = true
    this.music
      .setDongleBar({
        ...this.dongleBase,
        color: barColor(frame.accent, frame.intensity),
        brightness: brightnessFor(frame.intensity),
      })
      .then(() => {
        this.barWrites++
      })
      .catch(() => {
        // A receiver that stops answering must not take the body light down with it.
        this.bar = false
      })
      .finally(() => {
        this.barInFlight = false
      })
  }

  private budgetReached(): boolean {
    if (this.memoryWrites < this.options.writeBudget) return false
    this.note = BUDGET_NOTE
    return true
  }

  async release(): Promise<void> {
    this.active = false
    this.strategy = undefined
    const restore = this.restoreNeeded
    this.restoreNeeded = false
    if (restore && this.music) {
      try {
        await this.music.restore()
      } catch {
        /* mouse may be asleep or gone */
      }
    }
    this.mode = 'none'
    this.note = undefined
  }

  /** Tempo the pulse speed is derived from (undefined until the beat detector has settled). */
  get tempoEstimate(): Tempo {
    return this.tempo.tempo
  }

  /** Settings-memory writes this session — what the write budget counts. */
  get memoryWriteCount(): number {
    return this.memoryWrites
  }

  /** Round-trip of the last settings-memory write, ms: the ceiling on how fast a software strobe can blink. */
  get writeLatencyMs(): number {
    return this.writeMs
  }

  /**
   * Blinks the light `times` without any audio, so "is the light reacting at all?" can be answered separately from
   * "is the beat being detected?". Runs independently of a session; returns the measured write round-trip.
   */
  async flashTest(color: RGB, times = 6, onMs = 90, offMs = 160): Promise<{ writes: number; writeMs: number }> {
    const music = this.music
    if (!music) throw new Error('this mouse driver has no music service')
    const caps = await music.probe()
    if (!caps.flashLight) throw new Error('this mouse has no light bar to flash')
    await music.snapshot()
    this.restoreNeeded = true
    await music.enterLightSession()
    let writes = 0
    let worst = 0
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    for (let i = 0; i < times; i++) {
      for (const lit of [true, false]) {
        const started = nowMs()
        await music.setLightEffect(strobeFrame(color, lit))
        worst = Math.max(worst, Math.round(nowMs() - started))
        writes++
        this.memoryWrites++
        await wait(lit ? onMs : offMs)
      }
    }
    this.writeMs = worst
    return { writes, writeMs: worst }
  }

  status(): Omit<SinkStatus, 'enabled'> {
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      active: this.active,
      fps: this.fps,
      writes: this.writes,
      memoryWrites: this.memoryWrites,
      mode: this.mode,
      note: this.note,
      error: this.error,
    }
  }

  private setMode(strategy: MouseSinkStrategy | undefined, note: string | undefined): void {
    this.strategy = strategy
    this.mode = strategy ? MODE_LABEL[strategy] : 'none'
    this.active = strategy !== undefined
    this.note = note
  }

  private countWrite(now: number): void {
    this.writes++
    if (this.windowStart === undefined) {
      // The first write opens the window; it is its boundary, not a member (frame clock, no wall-clock mixing).
      this.windowStart = now
      return
    }
    this.windowCount++
    const elapsed = now - this.windowStart
    if (elapsed >= 1000) {
      this.fps = Math.round((this.windowCount * 10000) / elapsed) / 10
      this.windowStart = now
      this.windowCount = 0
    }
  }
}
