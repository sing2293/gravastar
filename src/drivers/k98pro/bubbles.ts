/**
 * Device-initiated ("bubble") packets → typed events.
 * Verified against the vendor codec (`onCommonBubbleResponse`, `onKeyTravelMonitor`, `onKeyCalibration`,
 * `handleDongleReportEvent`; deob lines 814–1064). See docs/reverse-engineering/k98pro/02-commands-config.md §8.
 */
import type { BatteryStatus } from '@/model/device'
import type { CalibrationSample, LightZone, LightingChangeEvent, LightingParam, OsMode, TravelSample } from '@/model/keyboard'
import { readU16be } from '@/hid/core/bytes'
import { BUBBLE_COMMANDS, decodePayload } from './codec'
import { osFromWire } from './enums'

export type BubbleEvent =
  | { type: 'dongle-link'; connected: boolean }
  | { type: 'battery'; status: BatteryStatus }
  | { type: 'os-change'; os: OsMode }
  | { type: 'profile-change'; profile: number }
  | { type: 'lighting-change'; change: LightingChangeEvent }
  | { type: 'travel'; samples: TravelSample[] }
  | { type: 'calibration'; samples: CalibrationSample[] }

/** Battery flag byte: high nibble ≠ 0 → charging, low nibble ≠ 0 → full. */
export function decodeBatteryFlags(flags: number): Pick<BatteryStatus, 'charging' | 'full'> {
  return { charging: ((flags & 0xf0) >> 4) !== 0, full: (flags & 0x0f) !== 0 }
}

const LIGHTING_PARAMS: readonly LightingParam[] = ['effect', 'brightness', 'speed', 'color', 'direction']

export function parseBubble(bytes: Uint8Array): BubbleEvent | undefined {
  if (bytes.length === 19 && bytes[0] === 0x0a) {
    return bytes[4] === 2 ? { type: 'dongle-link', connected: !!bytes[5] } : undefined
  }
  const cmd = bytes[0]
  const param = bytes[1] ?? 0
  const a = bytes[2] ?? 0
  if (cmd === BUBBLE_COMMANDS.common) {
    switch (param) {
      case 0x02:
        return { type: 'dongle-link', connected: !!a }
      case 0x05:
        return { type: 'battery', status: { level: a, ...decodeBatteryFlags(bytes[3] ?? 0) } }
      case 0x07:
        return { type: 'os-change', os: osFromWire(a) }
      case 0x09:
        return { type: 'profile-change', profile: a }
      case 0x0b: {
        // Same 1..15 code space as the lighting settings: Main 1–5, Side 6–10, Logo 11–15. The parameter order
        // within a zone (effect, brightness, speed, color, direction) is the vendor parser's; see doc §8.2 caveat.
        const code = a
        const value = bytes[3] ?? 0
        const zone: LightZone = code < 6 ? 'main' : code < 11 ? 'side' : 'logo'
        const paramKind = LIGHTING_PARAMS[(code - 1) % 5] ?? 'effect'
        const change: LightingChangeEvent = { zone, param: paramKind, value }
        if (paramKind === 'color') change.color = { r: bytes[4] ?? 0, g: bytes[5] ?? 0, b: bytes[6] ?? 0 }
        return { type: 'lighting-change', change }
      }
      default:
        return undefined
    }
  }
  if (cmd === BUBBLE_COMMANDS.keyTravel && param === 0x01) {
    const data = decodePayload(bytes)
    const samples: TravelSample[] = []
    for (let i = 0; i + 5 < data.length; i += 6) {
      const ad = readU16be(data, i + 4)
      samples.push({ id: readU16be(data, i), distance: readU16be(data, i + 2), adc: ad & 0x7fff, pressed: (ad & 0x8000) !== 0 })
    }
    return { type: 'travel', samples }
  }
  if (cmd === BUBBLE_COMMANDS.calibration && param === 0x02) {
    const data = decodePayload(bytes)
    const samples: CalibrationSample[] = []
    for (let i = 0; i + 5 < data.length; i += 6) {
      const ad = readU16be(data, i + 2)
      const pressed = (ad & 0x8000) !== 0
      samples.push({ id: readU16be(data, i), adc: ad & 0x7fff, min: readU16be(data, i + 4), pressed, finished: !pressed })
    }
    return { type: 'calibration', samples }
  }
  return undefined
}
