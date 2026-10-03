/**
 * Compx mouse music sync (`MouseMusicService`): the office-keyboard music commands 0xB2 / 0xB6 / 0xB7, the
 * receiver's RGB bar 0x18 / 0x19, and the memory-backed light bar block at 0xA0.
 * Verified against HIDHandle.js `Set_Device_OfficeMusicParameter` 2272, `Set_Device_OfficeMusicAmplitude` 2284
 * (nibble packing 2278–2285), `Set_Device_OfficeCustomLightState` 2294, `Set_Device_DongleRGBBar` 2065,
 * `Get_Device_DongleRGBBar` 2094. Doc: docs/reverse-engineering/mouse/01-transport-commands.md §11,
 * 02-features.md §16.
 *
 * The music commands are documented for Compx *keyboards*; whether any GravaStar mouse firmware accepts them is
 * UNVERIFIED. Support is therefore probed at run time — the firmware NAKs an unknown command by echoing it with
 * status byte 1 — and every method copes with a NAK. Light-bar writes go to settings memory whose endurance is
 * unknown: callers must pace them (≥ ~1.5 s apart) and budget them per session; `flashWrites` counts them.
 */
import { clamp } from '@/hid/core/bytes'
import { TimeoutError } from '@/hid/core/request'
import type { RGB } from '@/model/device'
import type {
  DongleBar,
  MouseLightEffect,
  MouseLighting,
  MouseLightingService,
  MouseMusicCapabilities,
  MouseMusicService,
  MusicAmplitudeParams,
} from '@/model/mouse'
import { Addr, encodeLightBlock } from './eeprom'
import { Command, FRAME_SIZE, PAYLOAD_MAX, buildFrame, type ParsedFrame } from './frame'
import { STREAM_REQUEST, type CompxLink } from './link'

/** Office-keyboard commands (`HIDHandle.js:245-248`) that `Command` in frame.ts does not list. */
export const enum MusicCommand {
  /** `[mode, speed, brightness, colourMode, fwd R G B, back R G B]`. */
  OfficeMusicParameter = 0xb2,
  /** 20 four-bit amplitudes packed two per byte. */
  OfficeMusicAmplitude = 0xb6,
  /** `[lightState, macroState]`. */
  OfficeCustomLightState = 0xb7,
}

export const AMPLITUDE_COUNT = 20
export const AMPLITUDE_MAX = 15
/** Mouse light modes (`LIGHT_MODES`, UserConvert.js:62-109): 2 animates in firmware, 3 is a steady colour. */
export const BREATHING_MODE = 2
export const FIXED_COLOUR_MODE = 3
export const LIGHT_BRIGHTNESS_MAX = 9
export const LIGHT_SPEED_MAX = 9
/** 0xAD is in units of 10 s; 90 = 15 minutes, the longest the vendor UI offers. */
export const SESSION_SLEEP_BYTE = 90
/** What to restore when the stored record was unreadable (vendor default, 60 s). */
export const DEFAULT_SLEEP_BYTE = 6

// ---------------------------------------------------------------------------
// Codecs (pure)
// ---------------------------------------------------------------------------

function byte(v: number | undefined): number {
  return clamp(Math.round(v ?? 0) || 0, 0, 0xff)
}

function level(v: number | undefined): number {
  return clamp(Math.round(v ?? 0) || 0, 0, AMPLITUDE_MAX)
}

/**
 * `Set_Device_OfficeMusicAmplitude` packing (HIDHandle.js:2278-2285): byte i = `((amp[2i] & 0x0F) << 4) |
 * (amp[2i+1] & 0x0F)`. Levels are rounded and clamped to 0..15; missing levels read as 0, extras are ignored.
 */
export function packAmplitudes(levels: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(PAYLOAD_MAX)
  for (let i = 0; i < AMPLITUDE_COUNT; i += 2) out[i >> 1] = (level(levels[i]) << 4) | level(levels[i + 1])
  return out
}

export function unpackAmplitudes(bytes: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let i = 0; i < AMPLITUDE_COUNT / 2; i++) {
    const b = bytes[i] ?? 0
    out.push((b >> 4) & 0x0f, b & 0x0f)
  }
  return out
}

/** 0xB2 payload, 10 bytes. */
export function encodeMusicParams(p: MusicAmplitudeParams): number[] {
  return [
    p.mode,
    p.speed,
    p.brightness,
    p.colorMode,
    p.forward.r,
    p.forward.g,
    p.forward.b,
    p.backward.r,
    p.backward.g,
    p.backward.b,
  ].map(byte)
}

/** 0x18 payload / 0x19 reply `[5..11]`: `[mode, R, G, B, speed, brightness, time, 0, 0, 0]`. */
export function encodeDongleBar(b: DongleBar): number[] {
  return [b.mode, b.color.r, b.color.g, b.color.b, b.speed, b.brightness, b.time, 0, 0, 0].map(byte)
}

export function decodeDongleBar(bytes: ArrayLike<number>): DongleBar {
  return {
    mode: bytes[0] ?? 0,
    color: { r: bytes[1] ?? 0, g: bytes[2] ?? 0, b: bytes[3] ?? 0 },
    speed: bytes[4] ?? 0,
    brightness: bytes[5] ?? 0,
    time: bytes[6] ?? 0,
  }
}

/**
 * The whole 16-byte echo. Replies to `Get*` commands put their data at absolute offsets while the echoed length
 * byte is the request's (0), so `ParsedFrame.payload` — a view into the received frame — is empty; walk back to
 * the frame start (same trick as the driver's `infoBytes`).
 */
function replyBytes(f: ParsedFrame): Uint8Array {
  const start = f.payload.byteOffset - 5
  return new Uint8Array(f.payload.buffer, start, Math.min(FRAME_SIZE, f.payload.buffer.byteLength - start))
}

function sameRgb(a: RGB, b: RGB): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** What `CompxMusic` needs from the driver (`CompxMouseDriver` satisfies it structurally). */
export interface CompxMusicHost {
  readonly hid: CompxLink
  readonly lighting: MouseLightingService
  /** Connection facts; the driver's getter throws when the mouse is not connected. */
  readonly current: { readonly wired: boolean; readonly model: { readonly hasLighting: boolean } }
}

export class CompxMusic implements MouseMusicService {
  /** Settings-memory write frames issued by `setLightColor` this session (`restore`'s own ≤ 3 writes are not counted). */
  flashWrites = 0
  /** Whether `enterLightSession` had to clear the firmware's "light off while moving" byte. */
  private movingOffCleared = false
  /** Original sleep / light-off byte (0xAD), while a session holds it at the maximum. */
  private sleepByteHeld: number | undefined
  /** 0xB6 frames sent (fire-and-forget, never confirmed). */
  amplitudeFrames = 0
  private caps: MouseMusicCapabilities | undefined
  private probing: Promise<MouseMusicCapabilities> | undefined
  private lightSnapshot: MouseLighting | undefined
  private barSnapshot: DongleBar | undefined
  /** `setDongleBar` was called since the snapshot: the bar must be re-sent on restore. */
  private barDirty = false
  /** 0xB2 was accepted (or its echo was lost): restore must leave the mode with 0xB7 and re-apply the light block. */
  private amplitudeActive = false

  constructor(private readonly host: CompxMusicHost) {}

  /** Result of the last `probe`, if any. */
  get capabilities(): MouseMusicCapabilities | undefined {
    return this.caps
  }

  /** Cached after the first call; `reprobe` asks the firmware again (e.g. after a firmware update or re-pairing). */
  probe(): Promise<MouseMusicCapabilities> {
    if (this.caps) return Promise.resolve(this.caps)
    this.probing ??= this.doProbe().finally(() => {
      this.probing = undefined
    })
    return this.probing
  }

  reprobe(): Promise<MouseMusicCapabilities> {
    this.caps = undefined
    return this.probe()
  }

  private async doProbe(): Promise<MouseMusicCapabilities> {
    const { wired, model } = this.host.current
    // A frame of 20 zero amplitudes changes nothing visible, so the probe is free of side effects.
    const amplitudeStream = await this.acks(MusicCommand.OfficeMusicAmplitude, new Array<number>(PAYLOAD_MAX).fill(0))
    // The bar sits on the receiver; a wired mouse has none, so do not even ask.
    const dongleBar = !wired && (await this.acks(Command.GetDongleRGBBarMode))
    this.caps = { amplitudeStream, dongleBar, flashLight: model.hasLighting }
    return this.caps
  }

  /** Status 0 = supported; status 1 (NAK) or a firmware that stays silent = unsupported. Other failures propagate. */
  private async acks(command: number, payload: number[] = []): Promise<boolean> {
    try {
      return (await this.host.hid.command(command, payload)).status === 0
    } catch (error) {
      if (error instanceof TimeoutError) return false
      throw error
    }
  }

  // -- snapshot / restore ------------------------------------------------------

  /** Keeps a snapshot that is still held, so a repeated `prepare` cannot capture our own changes as "original". */
  async snapshot(): Promise<void> {
    const caps = await this.probe()
    // Read from the flash shadow: no bus traffic.
    this.lightSnapshot ??= await this.host.lighting.get()
    if (caps.dongleBar && !this.barSnapshot) {
      this.barSnapshot = await this.readDongleBar()
      this.barDirty = false
    }
  }

  /**
   * The light only animates if it is on *and* the firmware is not blanking it while the mouse moves — which it does
   * by default on most models, so a host-driven strobe would be invisible exactly while the mouse is in use.
   */
  async enterLightSession(): Promise<void> {
    await this.snapshot()
    const cur = await this.host.lighting.get()
    if (cur.offWhileMoving) {
      this.flashWrites++
      await this.host.lighting.set({ offWhileMoving: false })
      this.movingOffCleared = true
    }
    if (!cur.on) {
      this.flashWrites++
      await this.host.hid.writeValue(Addr.LightState, 1)
    }
    /*
     * The same byte is the mouse's sleep timer and its "turn the decorative light off once stationary" timer
     * (02-features.md §8), and ships at 10-60 s on these models. Left alone, the light goes out part-way through a
     * track and never comes back — so a session holds it at the longest option and `restore` puts it back.
     */
    const flash = this.host.hid.flash
    const stored = flash[Addr.SleepTime] ?? 0xff
    // An unread or invalid record (the complement must sum to 0x55) means we cannot trust the value — raise it
    // anyway, and keep the vendor default to restore rather than writing 0xFF back.
    const valid = ((stored + (flash[Addr.SleepTime + 1] ?? 0)) & 0xff) === 0x55
    if (!valid || stored < SESSION_SLEEP_BYTE) {
      this.sleepByteHeld = valid ? stored : DEFAULT_SLEEP_BYTE
      this.flashWrites++
      await this.host.hid.writeValue(Addr.SleepTime, SESSION_SLEEP_BYTE)
      // Read it back: if the mouse refused, its light will still go out while it sits still and the caller should
      // say so rather than leave the user wondering.
      try {
        const [applied] = await this.host.hid.readBytes(Addr.SleepTime, 2)
        this.idleTimerHeld = applied === SESSION_SLEEP_BYTE
      } catch {
        this.idleTimerHeld = undefined
      }
    } else this.idleTimerHeld = true
  }

  /**
   * Whether the mouse accepted the long idle light-off timer: `false` means it will keep blanking its own light
   * when it sits still, whatever the host writes. `undefined` when it could not be checked.
   */
  idleTimerHeld: boolean | undefined

  /** The user's own sleep/light-off byte while a session is holding the hardware value at the maximum. */
  get heldSleepByte(): number | undefined {
    return this.sleepByteHeld
  }

  /** Re-points the held original, so a sleep time changed during a session survives `restore`. */
  setHeldSleepByte(value: number): void {
    this.sleepByteHeld = value
  }

  /** One value write: the light's on byte. Used to wake a bar the firmware has blanked. */
  async setLightOn(): Promise<void> {
    this.flashWrites++
    await this.host.hid.writeValue(Addr.LightState, 1, STREAM_REQUEST)
  }

  /** 0x19; `undefined` when the receiver has no bar. */
  async readDongleBar(): Promise<DongleBar | undefined> {
    const reply = await this.host.hid.command(Command.GetDongleRGBBarMode)
    return reply.status === 0 ? decodeDongleBar(replyBytes(reply).subarray(5, 12)) : undefined
  }

  /**
   * Puts back what `snapshot` captured, in this order: leave amplitude mode (0xB7 `[0, 0]`), re-send the receiver
   * bar if we changed it, then the light block — only if it differs from the snapshot, or unconditionally after
   * amplitude mode since the firmware then drove the LEDs itself. Every step runs even if an earlier one failed;
   * the first error is rethrown at the end and the failed parts stay pending, so calling again retries only them.
   */
  async restore(): Promise<void> {
    let failure: unknown
    const attempt = async (step: () => Promise<void>) => {
      try {
        await step()
      } catch (error) {
        failure ??= error
      }
    }
    const wasAmplitude = this.amplitudeActive
    if (wasAmplitude)
      await attempt(async () => {
        // Same frame as the vendor's `Set_Device_OfficeCustomLightState(0)`; a NAK just means the mode was never entered.
        await this.host.hid.command(MusicCommand.OfficeCustomLightState, [0, 0])
        this.amplitudeActive = false
      })
    if (this.barSnapshot) {
      const bar = this.barSnapshot
      if (this.barDirty)
        await attempt(async () => {
          await this.writeBar(bar)
          this.barDirty = false
          this.barSnapshot = undefined
        })
      else this.barSnapshot = undefined
    }
    if (this.lightSnapshot) {
      const light = this.lightSnapshot
      await attempt(async () => {
        await this.restoreLight(light, wasAmplitude)
        this.lightSnapshot = undefined
      })
    }
    if (this.movingOffCleared) {
      await attempt(async () => {
        await this.host.lighting.set({ offWhileMoving: true })
        this.movingOffCleared = false
      })
    }
    if (this.sleepByteHeld !== undefined) {
      const original = this.sleepByteHeld
      await attempt(async () => {
        await this.host.hid.writeValue(Addr.SleepTime, original)
        this.sleepByteHeld = undefined
      })
    }
    if (failure) throw failure
  }

  private async restoreLight(s: MouseLighting, force: boolean): Promise<void> {
    const cur = await this.host.lighting.get()
    const blockChanged =
      force ||
      cur.mode !== s.mode ||
      cur.speed !== s.speed ||
      cur.brightness !== s.brightness ||
      !sameRgb(cur.color, s.color)
    // `lighting.set` with a mode writes the block and, like the vendor, turns the light on when it was off; the
    // stored mode is never 0 (mode 0 only clears the on/off byte), hence the `|| 1` for a blank block.
    if (blockChanged)
      await this.host.lighting.set({ mode: s.mode || 1, color: s.color, speed: s.speed, brightness: s.brightness })
    const onNow = blockChanged || cur.on
    if (onNow !== s.on) await this.host.lighting.set({ on: s.on })
  }

  // -- amplitude streaming (0xB2 / 0xB6) ---------------------------------------

  async startAmplitude(params: MusicAmplitudeParams): Promise<void> {
    // Flag first: a lost echo may still have switched the firmware, and leaving the mode on restore is harmless.
    this.amplitudeActive = true
    const reply = await this.host.hid.command(MusicCommand.OfficeMusicParameter, encodeMusicParams(params))
    if (reply.status !== 0) {
      this.amplitudeActive = false
      throw new Error('this mouse does not accept the music amplitude command (0xB2)')
    }
  }

  /** Queued behind other traffic but not waited for: the echo, if any, is ignored. */
  async sendAmplitudes(levels: ArrayLike<number>): Promise<void> {
    this.amplitudeFrames++
    await this.host.hid.send(
      buildFrame({ command: MusicCommand.OfficeMusicAmplitude, payload: packAmplitudes(levels) }),
    )
  }

  // -- receiver bar (0x18) -----------------------------------------------------

  async setDongleBar(bar: DongleBar): Promise<void> {
    this.barDirty = true
    await this.writeBar(bar)
  }

  private async writeBar(bar: DongleBar): Promise<void> {
    const reply = await this.host.hid.command(Command.SetDongleRGBBarMode, encodeDongleBar(bar), STREAM_REQUEST)
    if (reply.status !== 0) throw new Error('the receiver has no RGB bar (0x18 rejected)')
  }

  // -- light bar in settings memory -------------------------------------------

  /**
   * One 7-byte block write at 0xA0 (fixed colour, speed kept, brightness 0..9) plus the on/off byte at 0xA7 only
   * when the bar was off — the vendor's order. Each frame is a settings-memory write: pace and budget calls.
   */
  async setLightEffect(effect: MouseLightEffect): Promise<void> {
    const cur = await this.host.lighting.get() // local flash shadow, no bus traffic
    const hid = this.host.hid
    if (!cur.on) {
      this.flashWrites++
      await hid.writeValue(Addr.LightState, 1)
    }
    this.flashWrites++
    await hid.writeArray(
      Addr.Light,
      encodeLightBlock({
        mode: effect.mode,
        color: effect.color,
        speed: clamp(Math.round(effect.speed) || 0, 0, LIGHT_SPEED_MAX),
        brightness: clamp(Math.round(effect.brightness) || 0, 0, LIGHT_BRIGHTNESS_MAX),
      }),
      STREAM_REQUEST,
    )
  }

  async setLightColor(color: RGB, brightness: number): Promise<void> {
    const cur = await this.host.lighting.get()
    await this.setLightEffect({ mode: FIXED_COLOUR_MODE, color, speed: cur.speed, brightness })
  }
}
