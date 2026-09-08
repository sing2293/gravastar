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
 *   3. gentle     — the light bar itself, only on strong beats, ≥ `gentleMinIntervalMs` apart, and capped by
 *                   `writeBudget` per session.
 */
import type { RGB } from '@/model/device'
import type { DongleBar, MouseDriver, MouseMusicCapabilities, MouseMusicService } from '@/model/mouse'
import type { LightingSink, MusicFrame, SinkStatus } from '../types'

export type MouseSinkStrategy = 'amplitude' | 'dongle' | 'gentle'
export type MouseSinkMode = 'none' | 'amplitude' | 'receiver bar' | 'gentle (memory-safe)'

export interface MouseSinkOptions {
  /** Amplitude-stream (0xB6) writes per second, upper bound; fire-and-forget commands, no memory wear. */
  maxFps: number
  /** Receiver-bar (0x18) writes per second, upper bound; commands, no memory wear. */
  dongleFps: number
  /** Gentle mode: minimum gap between two light-bar flash writes. */
  gentleMinIntervalMs: number
  /** Gentle mode: beats weaker than this (0..1) are ignored. */
  gentleBeatThreshold: number
  /** Gentle mode: flash writes allowed per session; the sink pauses itself once reached. */
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
  writeBudget: 400,
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
  dongle: 'receiver bar',
  gentle: 'gentle (memory-safe)',
}
const AUTO_ORDER: MouseSinkStrategy[] = ['amplitude', 'dongle', 'gentle']
/** Light mode 3 = fixed colour (`LIGHT_MODES`, 02-features.md light block). */
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
    dongle: caps.dongleBar,
    gentle: caps.flashLight,
  }
  const order = prefer && prefer !== 'auto' ? [prefer, ...AUTO_ORDER.filter((s) => s !== prefer)] : AUTO_ORDER
  return order.filter((s) => available[s])
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
      if (strategy === 'dongle') this.dongleBase = await this.readDongleBase()
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
    if (!this.active || this.inFlight || !this.music || !this.strategy) return
    const now = frame.audio.time
    let write: Promise<void>
    switch (this.strategy) {
      case 'amplitude': {
        if (now - this.lastSend < 1000 / this.options.maxFps) return
        write = this.music.sendAmplitudes(bandsToLevels(frame.audio.bands, frame.sensitivity))
        break
      }
      case 'dongle': {
        if (now - this.lastSend < 1000 / this.options.dongleFps) return
        const brightness = Math.max(1, Math.round(Math.max(0, Math.min(1, frame.intensity)) * LIGHT_BRIGHTNESS_MAX))
        write = this.music.setDongleBar({
          ...this.dongleBase,
          color: barColor(frame.accent, frame.intensity),
          brightness,
        })
        break
      }
      case 'gentle': {
        if (!frame.audio.beat || frame.audio.beatStrength < this.options.gentleBeatThreshold) return
        if (this.writes >= this.options.writeBudget) {
          this.note = BUDGET_NOTE
          return
        }
        if (now - this.lastSend < this.options.gentleMinIntervalMs) return
        write = this.music.setLightColor(frame.accent, LIGHT_BRIGHTNESS_MAX)
        break
      }
    }
    this.lastSend = now
    this.inFlight = true
    write
      .then(() => {
        this.error = undefined
      })
      .catch((e: Error) => {
        this.error = e.message
      })
      .finally(() => {
        // Counted whether or not the device acknowledged: a rejected flash write may still have cost an erase cycle.
        this.inFlight = false
        this.countWrite(now)
        if (this.strategy === 'gentle' && this.writes >= this.options.writeBudget) this.note = BUDGET_NOTE
      })
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

  status(): Omit<SinkStatus, 'enabled'> {
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      active: this.active,
      fps: this.fps,
      writes: this.writes,
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
