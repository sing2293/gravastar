/**
 * Wire-level constants of the K98 Pro protocol and their conversions to the device model.
 * Sources: docs/reverse-engineering/k98pro/02-commands-config.md §10–§11 (verified against the vendor enums at
 * deob lines 314–499).
 */
import type { DebounceMode, Layer, OsMode, PollingRate, ResetScope } from '@/model/keyboard'

export const enum Cmd {
  /** Read static device info, sub-selected by param. */
  DeviceInfo = 0x82,
  /** Read / write settings, sub-selected by param. */
  ReadSetting = 0x84,
  WriteSetting = 0x04,
  Battery = 0x87,
  KeyMatrixPositions = 0xa5,
  Reset = 0x11,
  SetKeymap = 0x03,
  GetKeymap = 0x83,
  GetSpecialKeys = 0xa2,
  UpdateSpecialKeys = 0x22,
  GetProfile = 0x90,
  SetProfile = 0x10,
  GetProfileName = 0x9a,
  SetProfileName = 0x1a,
  /** Performance service. */
  SetSwitchType = 0x15,
  GetSwitchType = 0x95,
  SetSafeArea = 0x16,
  GetSafeArea = 0x96,
  SetKeyTravel = 0x13,
  GetKeyTravel = 0x93,
  SetRapidTrigger = 0x19,
  GetRapidTrigger = 0x99,
  KeyTravelMonitor = 0x98,
  Calibration = 0x94,
  /** Advanced keys. */
  SetAdvancedKey = 0x12,
  GetAdvancedKey = 0x92,
  /** Lighting. */
  SetCustomColors = 0x06,
  GetCustomColors = 0x86,
  StreamRGB = 0x08,
  GetLedBeads = 0xa1,
  /** Macros. */
  ReadMacros = 0x85,
  WriteMacros = 0x05,
  /** Display. */
  LcdTransfer = 0x20,
  LcdRead = 0xa0,
  LcdPixelsWrite = 0x1f,
  LcdPixelsRead = 0x9f,
  LedTransfer = 0x0d,
  LedRead = 0x8d,
  LedPixelsWrite = 0x0c,
  LedPixelsRead = 0x8c,
  SetTime = 0x0b,
  SetUrls = 0x23,
}

/** Sub-commands of `Cmd.DeviceInfo` (0x82). */
export const enum Info {
  MacroStorageSize = 0x00,
  Uuid = 0x01,
  FirmwareVersion = 0x02,
  SupportedSwitches = 0x03,
  SupportedAdvancedKeyTypes = 0x04,
  MinRapidTrigger = 0x06,
  TravelPrecision = 0x08,
  LightingSupport = 0x09,
  DisplaySupport = 0x0c,
  LowPowerSupported = 0x0d,
  WirelessDedicatedSupported = 0x0e,
  Features = 0x0f,
}

/** Parameter indices shared by `Cmd.ReadSetting` / `Cmd.WriteSetting`. */
export const enum Setting {
  MainEffect = 0x01,
  MainEffectId = 0x02,
  SideEffect = 0x06,
  SideEffectId = 0x07,
  LogoEffect = 0x0b,
  LogoEffectId = 0x0c,
  OsMode = 0x11,
  SleepTime = 0x13,
  WinKeyLock = 0x15,
  PollingRate = 0x17,
  ComboOptimization = 0x18,
  AdaptiveCalibration = 0x19,
  DebounceMode = 0x1d,
  DebounceTime = 0x1e,
  LowPowerMode = 0x20,
  WasdArrowSwap = 0x21,
}

export const enum ResetType {
  Full = 0,
  Keymap = 1,
  Lighting = 2,
  Usb = 3,
}

export const RESET_TYPES: Record<ResetScope, ResetType> = { all: ResetType.Full, keymap: ResetType.Keymap, lighting: ResetType.Lighting, usb: ResetType.Usb }

export const enum WireSystem {
  Windows = 0,
  MacOS = 1,
}

export const osToWire = (os: OsMode): WireSystem => (os === 'macos' ? WireSystem.MacOS : WireSystem.Windows)
export const osFromWire = (v: number): OsMode => (v === WireSystem.MacOS ? 'macos' : 'windows')

export const LAYER_IDS: readonly Layer[] = [0, 1, 2, 3]
export const toLayer = (v: number): Layer => (v & 0x03) as Layer

/** `Rate1K=0, Rate500=1, Rate250=2, Rate125=3, Rate8K=4, Rate4K=5, Rate2K=6`. */
export const POLLING_RATE_FROM_WIRE: Readonly<Record<number, PollingRate>> = { 0: 1000, 1: 500, 2: 250, 3: 125, 4: 8000, 5: 4000, 6: 2000 }
export const POLLING_RATE_TO_WIRE: Readonly<Record<PollingRate, number>> = { 1000: 0, 500: 1, 250: 2, 125: 3, 8000: 4, 4000: 5, 2000: 6 }

export const DEBOUNCE_FROM_WIRE: readonly DebounceMode[] = ['normal', 'leading', 'trailing', 'auto']
export const debounceToWire = (m: DebounceMode): number => Math.max(0, DEBOUNCE_FROM_WIRE.indexOf(m))

/** Sleep timer choices offered by the vendor UI, in seconds (0 = never). */
export const SLEEP_OPTIONS_SECONDS: readonly number[] = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 0]

/** Debounce time is written in microseconds; the vendor UI exposes 1..50 ms. */
export const DEBOUNCE_US = { min: 1000, max: 50000, step: 1000 } as const

export const enum AdvancedKeyWire {
  None = 0,
  TGL = 1,
  MT = 2,
  DKS = 3,
  SOCD = 4,
  MPT = 5,
  END = 6,
  RS = 7,
}

export const enum LightWire {
  Main = 1,
  Side = 2,
  Logo = 3,
}

/** HID identity. */
export const VENDOR_ID = 0x372e
export const PID_WIRED = 0x10e5
export const PID_DONGLE = 0x106c
export const USAGE_PAGE = 0xff60
export const USAGE = 0x61
