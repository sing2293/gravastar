# GravaStar mouse (Compx HUB WEB) — feature data model and encodings

## Scope

This document describes, feature by feature, how the Compx HUB WEB driver (controlhub.top/gravastar, Vue 2 + Element UI, recovered from published source maps) models and encodes every mouse setting: DPI, report rate, sensor settings, key mapping, macros, lighting, DPI indicator effect, sleep/light-off time, debounce, profiles, dongle RGB and range mode, battery reporting, firmware upgrade, OLED/motor/flywheel/trigger extensions present in the library, config import/export, and the audio-recorder stub. Everything below is derived only from the recovered code plus the three runtime JSON files the app fetches (`cfg.json`, `sensor.json`, `lang/en.json`); nothing is inferred from other vendors' protocols. Byte values are hex (decimal in parentheses). Statements that could not be confirmed from code are marked **UNVERIFIED**. Transport details (report ID, 16-byte frame, CRC, retry loop) are summarised only as far as needed to read the encodings; see the companion protocol document for the full transport description.

## Sources

All paths are relative to `scratchpad/controlhub/src/webpack_/vue_test/src/` unless noted.

| File | Lines relied on |
|---|---|
| `assets/js/HIDHandle.js` | 1-189 (changelog/feature notes), 204-252 (`Command`), 255-298 (`MouseEepromAddr`), 372-386 (`MouseKeyFunction`), 406-417 (pair/connect enums), 422-467 (globals), 469-731 (`deviceInfo` defaults), 875-943, 1018-1040, 1223-1624 (`read_HID_Buffer`), 1632-1757 (send helpers, CRC), 1761-1787 (`Get_Device_Info`), 1799-1878 (online/battery/pair), 1881-1984 (restore/profile/version), 1986-2121 (dongle RGB/range), 2134-2253 (motor, OLED), 2314-2380 (EEPROM helpers), 2382-2540 (`Update_Device_Param`, `Write_Mouse_Flash`), 2546-2688 (flash read, timers), 2690-2912 (DPI decode, `Update_Mouse_Info`), 2915-3051 (key/shortcut/macro decode), 3054-4400 (all `Set_MS_*`/`Get_MS_*`), 5465-5471, 5473-6620 (export block with API comments) |
| `assets/js/HIDKey.js` | 1-12 (type legend), 13-597 (`keyCodeMap`), 599-630 |
| `assets/js/UserConvert.js` | 1-160 |
| `assets/js/BatteryHandle.js` | 1-302 |
| `assets/js/UpgradeHandle.js` | 1-1416 |
| `assets/js/recorder-core.js` | 1-80, 571-575, 779-813, 849-889 (library header/API) |
| `main.js` | 42-116 |
| `App.vue` | 90-113 |
| `views/Home.vue` | 216-310 (connect/pair), 311-420 (`deviceConnect`) |
| `views/Mouse.vue` | 156-319 (watchers), 233-299 (upgrade notice) |
| `views/MouseKey.vue` | 116-334 (handlers), 336-505 (bus events) |
| `views/MouseMacro.vue` | 98-139 (template controls), 207-665 (methods), 666-841 (bus events) |
| `views/MouseLight.vue` | 163-371 |
| `views/MouseSensor.vue` | 30-38; `views/MouseSetting.vue` 1-59 |
| `components/Sensor/DpiSetting.vue` 69-324, `DpiEffect.vue` 51-160, `ReportRate.vue` 21-119, `SensorSetting.vue` 109-323 | |
| `components/Key/Debounce.vue` 20-89, `Profile.vue` 16-59, `Other.vue` 32-260 | |
| `components/Dialog/FireKey.vue` 35-100, `ShortcutKey.vue` 34-118, `InputKey.vue` 25-91, `InputName.vue` 25-111, `PairDialog.vue` 29-163 | |
| `components/Setting/AdvancedSetting.vue` 19-75, `DeviceInfo.vue` 29-150, `DongleRgb.vue` 24-68, `Pair.vue` 13-61, `SleepTime.vue` 21-69, `Oled.vue` 135-671, `RecorderMusic.vue` 11-71 | |
| `components/Battery.vue` | 22-62 |
| Live `https://controlhub.top/gravastar/cfg.json` (saved to `scratchpad/live/gravastar_cfg.json`) | 1-479 |
| Live `https://controlhub.top/sensor.json` (saved to `scratchpad/live/sensor.json`) | 2-7 (capability lists), 814-828 (3395), 858-872 (3950), 896-910 (3955) |
| Live `https://controlhub.top/gravastar/lang/en.json` (saved to `scratchpad/live/gravastar_lang_en.json`) | 14-218 (`KeyOptions`), 222-239 (`ProfileOptions`), 247-283 (`ReportRates`), 286-299 (`SensorModeOptions`), 302-346 (`LODOptions`), 349-378 (`PerformanceOptions`), 386-399 (`DPIEffectOptions`), 418-446 (`InsertEventOptions`), 450-475 (`LightModeOptions`), 478-507 (`LightOffTimeOptions`), 551-552, 562-564 (dongle LED-mode strings) |

Note: `scratchpad/controlhub/sensor.json` is an nginx 404 body; the real file lives at the site origin (`main.js:107` fetches `window.location.origin + "/sensor.json"`) and was re-downloaded for this document.

---

## 1. Conventions used by every feature

### 1.1 Frame and CRC (recap)

| Item | Value | Source |
|---|---|---|
| Report ID (input and output) | `0x08` (8) | `HIDHandle.js:422` |
| Frame length (after report ID) | 16 bytes | `HIDHandle.js:1730-1731` |
| Byte 0 | command ID | `HIDHandle.js:1728-1744` |
| Byte 1 | `0x00` on send; on receive `0x00` = OK, `0x01` = error/unsupported | `HIDHandle.js:1230, 1599` |
| Bytes 2-3 | EEPROM address, big-endian (flash commands) or packet index (OLED) | `HIDHandle.js:2315, 2222` |
| Byte 4 | payload length; `+0x80` for keyboards (mouse adds `0x00`) | `HIDHandle.js:1717-1726, 1734` |
| Bytes 5-14 | payload, max 10 bytes | `HIDHandle.js:1735-1737` |
| Byte 15 | CRC = `(0x55 - (sum(bytes 0..14) & 0xFF)) - 0x08` (so the whole report incl. report ID sums to `0x55`) | `HIDHandle.js:1693-1701, 1740` |

Send path (`Send_HID_Buffer`, `HIDHandle.js:1632-1690`): up to 5 attempts (`index < 5`), each armed with a 200 ms timer (`Send_HID_Buffer_Timeout(200)`), success when the device echoes the first 3 bytes (5 bytes for `ReadFlashData` `0x08`), or immediately when response byte 1 == `0x01` (treated as "done", `HIDHandle.js:1668-1670`). Visit/demo mode short-circuits all sends (`HIDHandle.js:1635-1637`).

### 1.2 EEPROM (flash) helpers

All persistent mouse settings are bytes in a 16 KiB shadow (`flashData = Uint8Array(0x4000)`, `HIDHandle.js:430`) mirrored by three primitives:

| Helper | Command | Layout | Source |
|---|---|---|---|
| `Set_Device_Eeprom_Value(addr, v)` | `0x07` WriteFlashData | `[07 00 addrH addrL 02 v (0x55-v) 00.. CRC]` — one value byte plus its complement so `v + comp == 0x55` | `HIDHandle.js:2354-2368` |
| `Set_Device_Eeprom_Array(addr, bytes)` | `0x07` | split into 10-byte chunks `[07 00 addrH addrL len d0..d9 CRC]`, address advances by 10; stops on first failed chunk | `HIDHandle.js:2314-2351` |
| `Get_Device_Eeprom_Buffer(addr, len)` | `0x08` ReadFlashData | `[08 00 addrH addrL len 00.. CRC]`; reply carries `len & 0x0F` bytes at 5.. which are copied into `flashData[addr..]` | `HIDHandle.js:2371-2380, 1336-1343` |
| `Read_Device_Flash(start, end)` | `0x08` | raw loop, 10 bytes per request, 200 ms timeout, max 5 consecutive errors | `HIDHandle.js:2554-2625` |

Multi-byte records (DPI, colours, light block, key slots, flywheel) end with a record CRC computed by the same `get_Crc` over the preceding bytes: `crc = 0x55 - (sum & 0xFF)` (`HIDHandle.js:1693-1701`; negative results wrap when stored in a `Uint8Array`). Validity of optional single-value records is tested as `(flash[a] + flash[a+1]) & 0xFF == 0x55` (`HIDHandle.js:2841-2908`).

### 1.3 Mouse EEPROM map

From `MouseEepromAddr` (`HIDHandle.js:255-298`) plus literal addresses used elsewhere.

| Address | Size | Content | Encoding | Source |
|---|---|---|---|---|
| `0x00` | 1+1 | Report rate | see §3 | `:256, 3065` |
| `0x02` | 1+1 | DPI stage count (`maxDpiStage`) | 1..8 | `:257, 3082` |
| `0x04` | 1+1 | Current DPI stage | 0..count-1 | `:258, 3092` |
| `0x06` | 1+1 | X spindown (legacy `Set_MS_XSpindown`, not exported) | **UNVERIFIED** | `:3104-3106` |
| `0x08` | 1+1 | Key operation mode (bit0 left, bit1 right: 0 normal / 1 "advance") — also the legacy Y-spindown address (conflict) | `:259, 3113-3124, 3108-3110` |
| `0x0A` | 1+1 | LOD | see §4 | `:260, 3618` |
| `0x0C`..`0x2B` | 8×4 | DPI stage values (X, Y, flags, CRC) for non-3955 sensors | §2.3 | `:261, 3255` |
| `0x2C`..`0x4B` | 8×4 | DPI stage colours (R, G, B, CRC) | §2.5 | `:262, 3332` |
| `0x4C` | 1+1 | DPI-LED effect mode (1 steady, 2 breathing) | §2.6 | `:263, 3352` |
| `0x4E` | 1+1 | DPI-LED brightness (`0x10`..`0xFF` table) | §2.6 | `:264, 3368` |
| `0x50` | 1+1 | DPI-LED speed (1..5) | §2.6 | `:265, 3470` |
| `0x52` | 1+1 | DPI-LED on/off (1/0) | §2.6 | `:266, 3355, 3481` |
| `0x54`,`0x58`,`0x5A`,`0x5C`,`0x5E` | — | legacy RGB colour/effect/speed/brightness/power-save (`setRGB*`, `Set_MS_LightPowerSave`); only `0x5E` is exported, no UI caller | **UNVERIFIED** | `:3487-3522, 6014` |
| `0x60`..`0x9F` | 16×4 | Key function slots (type, param, CRC) | §5 | `:292, 4052, 2920` |
| `0xA0`..`0xA6` | 7 | Decorative light block: mode, R, G, B, speed, brightness, CRC | §7 | `:267, 3530-3541` |
| `0xA7` | 1+1 | Decorative light on/off | §7 | `:3564, 3570, 2829` |
| `0xA9` | 1+1 | Button debounce time (ms) | §9 | `:268, 3641` |
| `0xAB` | 1+1 | Motion sync (0/1) | §4 | `:269, 3665` |
| `0xAD` | 1+1 | Sleep / light-off time (×10 s) | §8 | `:270, 3686` |
| `0xAF` | 1+1 | Angle snap (0/1) | §4 | `:271, 3698` |
| `0xB1` | 1+1 | Ripple control (0/1) | §4 | `:272, 3710` |
| `0xB3` | 1+1 | Turn light off while moving (0/1) | §7 | `:273, 3722` |
| `0xB5` | 1+1 | "Performance" (highest-performance) state (0/1) | §4 | `:274, 3734` |
| `0xB7` | 1+1 | Performance time (×10 s) | §4 | `:275, 3746` |
| `0xB9` | 1+1 | Sensor mode (0 LP, 1 HP) | §4 | `:276, 3756` |
| `0xBB` | 1+1 | RF TX time (reserved, `Set_MS_RFTXTime`, unused) | **UNVERIFIED** | `:4393-4400` |
| `0xBD` | 1+1 | Angle tune, signed byte −30..+30 | §4 | `:277, 3796-3815` |
| `0xBF` | 1+1 | Angle tune enable (0/1) | §4 | `:278, 3801` |
| `0xE1` | 1+1 | Sensor FPS 20K (0/1), "only NRF54" | §4 | `:279, 3822, 560` |
| `0xE3` | 1+1 | Wheel debounce time (10..100) | §9 | `:280, 3835` |
| `0xE5` | 1+1 | Button release debounce (0..30) — **same address is also listed as `RightTrigger`** | §9, §11 | `:281, 289` |
| `0xE9` | 1+1 | Flywheel/scroll-wheel mode state | §11 | `:282, 3859` |
| `0xEB`..`0xEE` | 4 | Flywheel max speed, max-speed time, deceleration, CRC | §11 | `:283-285, 3878-3885` |
| `0xEF` | 1+1 | Left trigger point (0..9) | §11 | `:286, 3947` |
| `0xF1` | 1+1 | Left fast trigger (bit7 enable, bits6..0 level) | §11 | `:287, 3976-3979` |
| `0xF3` | 1+1 | Left tactile feedback (bit7 sound, bits3..0 level) | §11 | `:288, 4007-4009` |
| `0xF7` | 1+1 | Right fast trigger | §11 | `:290, 3982` |
| `0xF9` | 1+1 | Right tactile feedback | §11 | `:291, 4014` |
| `0x0100`..`0x02FF` | 16×0x20 | Shortcut/combo key records per key slot | §5.6 | `:293, 4079, 4115` |
| `0x0300`..`0x1AFF` | 16×0x180 | Macro records per key slot (16 × 0x180 = 0x1800 bytes, ending just before the 3955 DPI block) | §6 | `:294, 4176, 4207` |
| `0x1B00`..`0x1B2F` | 8×6 | DPI stage values for sensor 3955 (16-bit X/Y) | §2.4 | `:295, 3235` |
| `0x1B48` | 1+1 | Virtual centre enable | §11 | `:296, 4028` |
| `0x1B4A` | 1+1 | Virtual centre location (default 100) | §11 | `:297, 4040, 576` |

### 1.4 Connection-time read sequence (mouse)

`Update_Device_Param` (`HIDHandle.js:2382-2436`) is run after the device reports online (`Get_Online_Interval`, `HIDHandle.js:2629-2676`; polled every 1500 ms until online, `HIDHandle.js:940`) and again after profile change/restore:

1. `flashData.fill(0xFF)`; `Read_Device_Flash(0, 0x100)` — the whole low page in 10-byte reads (`:2384-2387`).
2. Sensor 3955 only: read `0x1B00..0x1B30` (`:2388-2390`).
3. Read `0x1B48..0x1B4C` (virtual centre) (`:2392`).
4. Compute `flashEndAddress` = index of the last non-`0xFF` byte in the low page (used by config import) (`:2395-2417`).
5. `Update_Mouse_Info()` decodes every scalar setting (`:2803-2912`), then `Get_Mouse_KeyFunctions()` decodes 16 key slots and fetches the shortcut/macro blocks only for slots whose type is `0x05`/`0x06` (`:2915-2957`).

Then `GetCurrentConfig` (`0x0E`), `ReadVersionID` (`0x12`), `GetDongleVersion` (`0x1D`), battery, `GetMotorParam` (`0x2F`), and, wireless only, `GetLongRangeMode` (`0x17`) (`:2642-2657`). Battery is then polled every 5000 ms (`:2668`). A 30 s watchdog (`Get_Flash_Time_Tick`, `:2678-2688`) closes the device if still `Connecting`.

### 1.5 Unsolicited `StatusChanged` (`0x0A`) report

The mouse pushes `0x0A` when the user changes something on the mouse. Bit masks (`HIDHandle.js:1372-1440`):

| Byte | Bit | Meaning | Driver reaction |
|---|---|---|---|
| 5 | `0x01` | DPI stage changed | `Get_MS_CurrentDPI` (read `0x04`,2) |
| 5 | `0x02` | report rate changed | `Get_MS_ReportRate` (read `0x00`,2) |
| 5 | `0x04` | profile changed | `Get_Device_Profile` → full re-sync |
| 5 | `0x08` | DPI LED effect changed | read `0x4C`,8 |
| 5 | `0x10` | logo LED (no handler) | — |
| 5 | `0x20` | light bar changed | read `0xA0`,7 |
| 5 | `0x40` | battery % changed | `Get_Device_Battery` |
| 5 | `0x80` | reserved | — |
| 6 | `0x01` | LOD changed | read `0x0A`,2 |
| 6 | `0x02` | debounce changed | read `0xA9`,2 |
| 6 | `0x04` | motion sync changed | read `0xAB`,2 |
| 6 | `0x08` | flywheel mode changed | read `0xE9`,2 |
| 13 / 14 | byte | left / right button current travel (`trigger.*.currentRoute`) | stored (`:1376-1377`) |

A `ReadFlashData` reply for any of those addresses with the matching length re-runs `Update_Mouse_Info` (`:1345-1355`).

---

## 2. DPI

### 2.1 Device defaults (cfg.json)

| Device (cid 18 = `0x12`) | Sensor | `maxDpi` | Stages (value / colour) | Current | Source |
|---|---|---|---|---|---|
| mid 1, 2 | 3395 | 26000 | 800 red, 1200 blue, 1600 green, 2400 yellow, 3200 cyan, 6400 magenta | 2 | `cfg.json:211-297, 298-384` |
| mid 3, 4, 5 | 3950 | 32000 | same six | 2 | `cfg.json:36-123, 124-210, 385-477` |

Stage count = `dpis.length` = 6 (`DpiSetting.vue:242`); slider min/step come from `sensor.json` range[0], max is the smaller of `cfg.maxDpi` and the last range max (`DpiSetting.vue:260-266`).

### 2.2 Stage count and current stage

| Operation | Function | Write | Source |
|---|---|---|---|
| Set number of active stages (1..8) | `Set_MS_MaxDPI(n)` | `Set_Device_Eeprom_Value(0x02, n)` | `HIDHandle.js:3078-3085`, API note "max 8" `:5689-5700` |
| Set active stage (0..n−1) | `Set_MS_CurrentDPI(i)` | `Set_Device_Eeprom_Value(0x04, i)` | `:3088-3097` |
| Read | `flash[0x02]`, `flash[0x04]` | | `:2817-2818` |

UI behaviour when the count is reduced below the current stage: the current stage's value/colour is swapped into the new last slot and both slots are rewritten (`DpiSetting.vue:115-163`). Eight stage records are always decoded (`HIDHandle.js:2768`); only the first `maxDpiStage` are shown (`DpiSetting.vue:292-295`). Slider input is rounded up to the step of the range it falls in (`DpiSetting.vue:164-185`).

### 2.3 Stage value record — sensors other than 3955 (3395 and 3950 for GravaStar)

Address `0x0C + stage*4`, 4 bytes (`HIDHandle.js:3255-3268`, `3304-3318`, decode `2767-2800`):

| Byte | Bits | Content |
|---|---|---|
| 0 | 7..0 | X raw value, low 8 bits |
| 1 | 7..0 | Y raw value, low 8 bits |
| 2 | 1..0 | X multiplier flags (`DPIex & 3`) |
| 2 | 3..2 | X raw value bits 9..8 |
| 2 | 5..4 | Y multiplier flags |
| 2 | 7..6 | Y raw value bits 9..8 |
| 3 | — | record CRC (`0x55 - sum(bytes 0..2)`) |

`Set_MS_DPIValue(i, v)` writes X = Y = v; `Set_MS_DPIXYValue(i, x, y)` writes them separately. Note the encoder ORs `dpiEx | (dpiEx << 4)` into byte 2 (`:3264`); since `DPIex` constants already have both nibbles set (`0x11`, `0x22`, `0x33`) this is equivalent to putting the 2-bit flag in each nibble.

**Raw value ↔ DPI (`DPIValue_To_EepromValue`, `HIDHandle.js:3138-3227`; inverse `EepromValue_To_DPIValue`, `:2690-2764`)** for sensors that have only a `range` table (3395, 3950, 3370, OM76, S312, 3955):

```
range = sensor.cfg.range            # from sensor.json
idx   = last i with dpi >= range[i].min
dpiEx = range[idx].DPIex            # 0x00, 0x11, 0x22, 0x33
div   = {0:1, 1:2, 2:2, 3:4}[idx]   # OM76: 0x22→10, 0x33→20
raw   = dpi / div / range[0].step - 1      # S312 and OM76>10000: no "-1"
decode: dpi = (raw + 1) * range[0].step
        if dpiEx & 1: dpi *= 2               # "double"
        if dpiEx & 2: dpi *= 2               # "step100" (OM76: *10, 3315: *1)
```

Sensors with a `values` table (3335, 3325, 3104, 3212, 8920, 3311, 4090, 3220, 8980, 3315) instead look the step index up in that table (`:3195-3210`, `:2712-2740`); 3315 uses a two-dimensional table selected by the `step100` flag. Office sensors (`cfg.office`) store the index into a fixed DPI list, with `dpiEx = 0x11` meaning "list value ×2" (`:3145-3169`, `:2699-2710`).

Sensor ranges relevant to GravaStar (`sensor.json`):

| Sensor | Range 0 | Range 1 | Source |
|---|---|---|---|
| 3395 | 50..26000 step 50, `DPIex 0` | 26100..52000 step 100, `DPIex 17 (0x11)` | `sensor.json:814-828` |
| 3950 | 50..30000 step 50, `DPIex 0` | 30100..60000 step 100, `DPIex 0x11` | `sensor.json:858-872` |
| 3955 | 1..42000 step 1, `DPIex 0` | 42002..84000 step 2, `DPIex 0x11` | `sensor.json:896-910` |

Worked examples (3950, computed from the code above):

| DPI | idx | raw | Bytes at `0x0C+i*4` |
|---|---|---|---|
| 800 | 0 | 15 = `0x0F` | `0F 0F 00 37` |
| 1600 | 0 | 31 = `0x1F` | `1F 1F 00 17` |
| 6400 | 0 | 127 = `0x7F` | `7F 7F 00 57` |
| 26000 | 0 | 519 = `0x207` | `07 07 88 BF` (bits 9..8 = 2 → byte2 `0x88`) |
| 32000 | 1 | 319 = `0x13F` | `3F 3F 55 82` (byte2 = `0x04|0x40|0x11` = `0x55`) |

### 2.4 Stage value record — sensor 3955

Address `0x1B00 + stage*6`, 6 bytes (`HIDHandle.js:3234-3253`, `3282-3302`, decode `2769-2797`):

| Byte | Content |
|---|---|
| 0-1 | X raw, little-endian 16-bit |
| 2-3 | Y raw, little-endian 16-bit |
| 4 | bits 1..0 X flags, bits 3..2 X raw bits 17..16, bits 5..4 Y flags, bits 7..6 Y raw bits 17..16 |
| 5 | record CRC |

The whole 48-byte 3955 block is also rewritten on config import (`:2453-2461`).

### 2.5 Stage colour

`Set_MS_DPIColor(i, "rgb(r,g,b)")` → `Set_Device_Eeprom_Array(0x2C + i*4, [R, G, B, CRC])` (`HIDHandle.js:3328-3340`; string parsing `UserConvert.js:49-60`). Decoded at `0x0C + i*4 + 0x20` (`:2798`). The colour picker is hidden when `cfg.disableDpiColor == true` (`DpiSetting.vue:268-273`, not set for GravaStar).

### 2.6 DPI indicator effect ("DpiEffect")

| Field | Address | Values | Set function | Source |
|---|---|---|---|---|
| Mode | `0x4C` | `1` steady, `2` breathing | `Set_MS_DPILightMode(v)`; also writes `0x52 = 1` if effect was off | `HIDHandle.js:3348-3360`, options `en.json:386-399` |
| Brightness | `0x4E` | UI index 1..10 → byte `0x10, 0x1E, 0x3C, 0x5A, 0x80, 0x96, 0xB4, 0xD2, 0xE6, 0xFF` (default 5 = `0x80`) | `Set_MS_DPILightBrightness(idx)` | `:3363-3422`, inverse `:3424-3463` |
| Speed | `0x50` | 1..5 (slider max 5) | `Set_MS_DPILightSpeed(v)` | `:3466-3473`, `DpiEffect.vue:41` |
| On/off | `0x52` | `1` on, `0` off | `Set_MS_DPILightOff()` writes 0 | `:3476-3485` |
| Read | `0x4C`, 8 bytes | | `Get_MS_DPILightEffect` | `:3343-3345`, decode `:2820-2823` |

UI rule (`DpiEffect.vue:71-88`): mode 0 (off) disables both sliders; mode 1 (steady) enables brightness only; mode 2 (breathing) enables speed only. (The HIDHandle comments at `:3362` and `:3465` state the opposite pairing; the Vue code is what ships.) The section is hidden when the device cfg has no `dpiEffect` key (`MouseSensor.vue:37`), which is the case for all GravaStar entries in `cfg.json`.

---

## 3. Report rate

| Rate (Hz) | EEPROM byte at `0x00` | Source |
|---|---|---|
| 125 | `0x08` (8) | `UserConvert.js:6-14`, `en.json:247-283` |
| 250 | `0x04` | |
| 500 | `0x02` | |
| 1000 | `0x01` | |
| 2000 | `0x10` (16) | |
| 4000 | `0x20` (32) | |
| 8000 | `0x40` (64) | |

Encode (`Set_MS_ReportRate`, `HIDHandle.js:3054-3070`): `v <= 1000 ? 1000/v : (v/2000)*0x10`, then `Set_Device_Eeprom_Value(0x00, code)`; afterwards `Update_MS_SensorModeDisplay()` is re-evaluated (§4.5). Decode (`UserConvert.FlashData_To_ReportRate`, `UserConvert.js:27-37`): `code >= 0x10 ? (code/0x10)*2000 : 1000/code`; clamped to `deviceInfo.maxReportRate` (`HIDHandle.js:2804-2809`). `UserConvert.ReportRate_To_FlashData` (`UserConvert.js:15-25`, used only by config import — `Other.vue:119` for the mouse, `HIDHandle.js:5416` for the keyboard flash writer) computes `rate/1000*0x10` for rates >1000, which yields `0x20` for 2000 Hz — inconsistent with the decoder; **UNVERIFIED** which one the firmware expects, but the normal set path uses the `/2000` form.

Available options are filtered by the dongle/cable type reported in the `EncryptionData` (`0x01`) reply byte 11 (`HIDHandle.js:1233-1266`, `ReportRate.vue:66-89`):

| Type byte | Meaning | `isWired` | `maxReportRate` |
|---|---|---|---|
| `0x00` | dongle 1K | false | 1000 |
| `0x01` | dongle 4K | false | 4000 |
| `0x02` | wired 1K | true | 1000 |
| `0x03` | wired 8K | true | 8000 |
| `0x04` | dongle 2K | false | 2000 |
| `0x05` | dongle 8K | false | 8000 |

GravaStar `cfg.json` lists per device `dongle1: CX52650N`, `dongle2: CX52650N`, `dongle4: CH32V305` (`cfg.json:41-43`) and default `reportRate: 1000` (`cfg.json:107`). The upgrade-notice logic distinguishes `dongle`, `dongle2`, `dongle4`, `dongle8` firmware versions by `maxReportRate` (`Mouse.vue:249-278`).

---

## 4. Sensor settings

Visibility per sensor comes from the capability lists in `sensor.json:2-7` AND the presence of the key in the device cfg (`SensorSetting.vue:245-252`); GravaStar cfg provides `sensorMode, lod, performanceState, performance, ripple, angle, motionSync` (`cfg.json:108-114`).

| Setting | EEPROM | Values | Set function | Sensors (sensor.json) | Source |
|---|---|---|---|---|---|
| LOD | `0x0A` | see table below | `Set_MS_LOD(v)` | 3395, 3370, 3335, 3950, 3955, 8980 | `HIDHandle.js:3608-3634` |
| Motion sync | `0xAB` | 0/1 | `Set_MS_MotionSync` | 3395, 3950, 3955, OM76 | `:3661-3680` |
| Ripple control | `0xB1` | 0/1 | `Set_MS_Ripple` | all listed | `:3706-3715` |
| Angle snap ("直线修正") | `0xAF` | 0/1 | `Set_MS_Angle` | all listed | `:3694-3703` |
| Performance state ("火力全开", UI "Highest performance") | `0xB5` | 0/1 | `Set_MS_PerformanceState` | shown if cfg has `performance` | `:3730-3739` |
| Performance time | `0xB7` | ×10 s: 1,3,6,12,30,60,90 | `Set_MS_PerformanceTime` | | `:3742-3749`, `en.json:349-378`, unit note `:5821-5833` |
| Sensor mode | `0xB9` | 0 LP, 1 HP | `Set_MS_SensorMode` | all listed (OM76: LP hidden) | `:3752-3762`, `SensorSetting.vue:256-262` |
| Angle tune | `0xBD` (+enable `0xBF`) | signed −30..+30 (two's complement byte; header table `0xE2=-30, 0xF6=-10, 0x00, 0x0F=+15, 0x1E=+30`) | `Set_MS_AngleTune` (no UI) | detected when both records' complements are valid | `:539-544, 2845-2857, 3796-3815` |
| Sensor FPS 20K | `0xE1` | 0/1, "only NRF54" | `Set_MS_SensorFPS20K` (no UI) | | `:560, 3818-3828` |
| RF TX time | `0xBB` | reserved | `Set_MS_RFTXTime` (not exported) | | `:4393-4400` |

Bug note: `Set_MS_PerformanceState` stores the new state into `sensor.performance` instead of `sensor.performanceState` (`HIDHandle.js:3735`).

### 4.1 LOD values

| Sensor | Byte → height | Source |
|---|---|---|
| general (3395 etc.) | `1` → 1 mm, `2` → 2 mm | `en.json:303-311`, `HIDHandle.js:3610` |
| 3950 | `3` → 0.7 mm, `1` → 1 mm, `2` → 2 mm | `en.json:312-324`, `HIDHandle.js:3611` |
| 3955 | `1` 0.7, `2` 0.9, `3` 1.2, `4` 1.4, `5` 1.5 mm (the `Set_MS_LOD` comment at `HIDHandle.js:3612` says 1.6 mm for 5; the changelog at `HIDHandle.js:49` and the lang file both say 1.5 mm) | `en.json:325-345`, `HIDHandle.js:49, 3612` |

### 4.2 Sensor mode display rule

`Update_MS_SensorModeDisplay` (`HIDHandle.js:3765-3794`) computes what the "Mode" select shows and whether it is editable, using report rate, wired state and FPS20K:

| Condition | Displayed value | Editable |
|---|---|---|
| wired, or FPS20K on | `256` "Corded" | no |
| wireless, rate 125/250/500/1000 | stored `0xB9` (LP/HP) | yes |
| wireless, rate 2000/4000, sensor 3955 | `1` HP | no |
| wireless, rate 2000/4000, other sensor | `256` Corded | no |
| wireless, rate 8000 | `256` Corded | no |

Option value `256` is always disabled in the select (`SensorSetting.vue:25`); `SensorModeOptions` = LP 0, HP 1, Corded 256 (`en.json:286-299`).

---

## 5. Key mapping

### 5.1 Physical keys (GravaStar)

Six keys per device (`cfg.json:48-79`); `index` is the firmware slot, `value` the default `[type, param]` strings:

| Key label | slot `index` | Default | Meaning |
|---|---|---|---|
| 1 | 0 | `["1","0x0100"]` | Left click |
| 2 | 1 | `["1","0x0200"]` | Right click |
| 3 | 2 | `["1","0x0400"]` | Wheel click |
| 4 | 4 | `["1","0x1000"]` | Forward |
| 5 | 3 | `["1","0x0800"]` | Backward |
| 6 | 5 | `["2","0x0100"]` | DPI loop |

The library always reads/writes 16 slots (`keysCount: 16`, `HIDHandle.js:670, 2919`). Slots 14 and 15 are reused for wheel/flywheel triple-click and double-click functions (`HIDHandle.js:91-92`). The UI refuses to reassign the only remaining Left-click slot (`MouseKey.vue:118-143`).

### 5.2 Slot record

Address `0x60 + slot*4` (`Set_MS_KeyFunction`, `HIDHandle.js:4048-4072`):

| Byte | Content |
|---|---|
| 0 | function type (`MouseKeyFunction`) |
| 1 | `param >> 8` (for `DPILock`: raw DPI low byte) |
| 2 | `param & 0xFF` (for `DPILock`: raw DPI high byte) |
| 3 | record CRC |

Decode: `param = (b1 << 8) | b2`, shown as `"0x%04X"` (`:2921-2922`); `DPILock` decodes `b1 | (b2 << 8)` through `EepromValue_To_DPIValue(raw, 0)` (`:2924-2927`).

### 5.3 Function types and parameters

`MouseKeyFunction` (`HIDHandle.js:372-386`), parameter meanings from `en.json:14-221` (`KeyOptions`, the cascader `[type, param]` pairs) and `MouseKey.vue:210-275`:

| Type | Name | Param (16-bit) | Notes / source |
|---|---|---|---|
| `0x00` | Disable | `0x0000` | cascader value `"0"` has no child → param NaN → written as `00 00` (`MouseKey.vue:254-258`) |
| `0x01` | Mouse button | `0x0100` Left, `0x0200` Right, `0x0400` Wheel click, `0x0800` Backward, `0x1000` Forward | `en.json:15-39`; `LeftKey = 0x0100` constant `HIDHandle.js:375` |
| `0x02` | DPI switch | `0x0100` DPI loop, `0x0200` DPI+, `0x0300` DPI− | `en.json:71-88` |
| `0x03` | Scroll left/right | `0x0100` Scroll left, `0x0200` Scroll right | `en.json:57-70` |
| `0x04` | Fire key | `(interval << 8) \| times`; times 0..3 (0 = repeat while held), interval 10..255 | `MouseKey.vue:462-467`, `FireKey.vue:64-75`, decode `MouseKey.vue:189-191`; unit of interval **UNVERIFIED** (labels only say "Interval (10-255)") |
| `0x05` | Combo key / multimedia | `0x0000`; actual keys live in the shortcut block (§5.6) | `MouseKey.vue:483-490`, `:220-224` |
| `0x06` | Macro | `(slot << 8) \| cycleTimes`; slot = this key's slot, cycleTimes 1..250 or 253/254/255 (§6.4) | `MouseKey.vue:244`, `MouseMacro.vue:548-553` |
| `0x07` | Report-rate switch | `0x0000` | `en.json:41-44` |
| `0x08` | Light switch | — (not in GravaStar `KeyOptions`) | `HIDHandle.js:382` |
| `0x09` | Profile switch | — (not in GravaStar `KeyOptions`) | `:383`, still recognised on read `MouseKey.vue:377-381` |
| `0x0A` | DPI lock | raw DPI value (LE16) of 100..1000 DPI computed via `DPIValue_To_EepromValue`; multiplier flags are discarded | `HIDHandle.js:4055-4059`, `en.json:172-217` |
| `0x0B` | Scroll up/down | — (not in GravaStar `KeyOptions`) | `:385` |

Examples (CRC = `0x55 − sum`): Left click `01 01 00 53`; DPI loop `02 01 00 52`; Fire key 3× every 10 → param `0x0A03` → `04 0A 03 44`; macro in slot 5, cycle 1 → `06 05 01 49`; DPI lock 400 on 3950 (raw 7) → `0A 07 00 44`.

### 5.4 HID key codes used by combos and macros (`HIDKey.js`)

Entry `type` legend (`HIDKey.js:2-11`): `0` modifier, `1` normal key, `2` multimedia/consumer, `3` power, `4` mouse button (`0x0100` L, `0x0200` R, `0x0400` M, `0x0800` back, `0x1000` fwd per the comment), `5` XY cursor. The map is keyed by DOM `KeyboardEvent.code` (`keyToHID`, `HIDKey.js:599-601`) and by display text (`textToHID`, `:615-624`).

Modifier bit values (type 0):

| Key | Value | Source |
|---|---|---|
| LCtrl | `0x01` | `HIDKey.js:353-357` |
| LShift | `0x02` | `:291-295` |
| LAlt | `0x04` | `:363-367` |
| LWin | `0x08` | `:358-362` |
| RCtrl | `0x10` | `:388-392` |
| RShift | `0x20` | `:346-350` |
| RAlt | `0x40` | `:373-377` |
| RWin | `0x80` | `:378-382` |
| Menu (ContextMenu) | type `7`, value `0x01` — odd type, **UNVERIFIED** | `:383-387` |

Normal keys (type 1) are standard HID usage IDs: e.g. Esc `0x29`, F1..F12 `0x3A..0x45`, A `0x04`, Enter `0x28`, Space `0x2C`, arrows `0x4F..0x52`, numpad `0x53..0x63`, Apps `0x65`, international keys `0x87..0x91` (`HIDKey.js:13-597`).

### 5.5 Multimedia keys (consumer usages)

Cascader group `"1005"` (`en.json:89-166`) → written with `Set_MS_Multimedia(slot, "0x00E9")` and type `0x05` in the slot record (`MouseKey.vue:220-224`):

| Usage | Label |
|---|---|
| `0x0183` Media player, `0x00CD` Play/Pause, `0x00B5` Next, `0x00B6` Previous, `0x00B7` Stop, `0x00E2` Mute, `0x00E9` Vol+, `0x00EA` Vol−, `0x018A` Email, `0x0192` Calculator, `0x0194` My Computer, `0x0223` Homepage, `0x0221` Search, `0x0225` Next page, `0x0224` Previous page, `0x0226` Stop page, `0x0227` Refresh, `0x022A` Favorites | |

Shortcut block written at `0x0100 + slot*0x20` (`HIDHandle.js:4075-4108`):

```
[02, 82, usageLo, usageHi, 42, usageLo, usageHi, CRC]
 ^count*2  ^type 2|0x80 (press)      ^type 2|0x40 (release)
```

Example Vol+: `02 82 E9 00 42 E9 00 BD`. Read-back: a single decoded context of type 2 marks the entry `isMedia` (`:2980-2991`).

### 5.6 Combo (shortcut) keys

Dialog allows at most 2 modifiers from Shift/Ctrl/Alt/Win (older selections are dropped, `ShortcutKey.vue:78-84`) plus one normal key; modifiers are prefixed `"L"` (left variants only) (`ShortcutKey.vue:86-93`). `Set_MS_ShortcutKey(slot, ["LCtrl","A"])` (`HIDHandle.js:4111-4151`) writes at `0x0100 + slot*0x20`:

| Offset | Content |
|---|---|
| 0 | `N*2` (N = number of keys) |
| 1 + 3k | press entry k: `type \| 0x80`, `valueLo`, `valueHi` |
| 1 + 3N + 3k | release entries in reverse order: `type \| 0x40`, `valueLo`, `valueHi` |
| 1 + 6N | record CRC |

Example Ctrl+A: `04 80 01 00 81 04 00 41 04 00 40 01 00 C5` (14 bytes, sent as one 10-byte and one 4-byte write). Read (`Update_Mouse_ShortcutKey`, `:2960-2998`, fetch `Get_MS_ShortcutKey` `:4154-4167`): reads 10 bytes, then up to `count*3+2` bytes; parses only the first `count/2` (press) entries with `type = b & 0x0F`. Max record = 1 + 3·3·2 + 1 = 20 bytes.

---

## 6. Macros

### 6.1 Storage record

One record per key slot at `0x0300 + slot*0x180` (384 bytes) (`HIDHandle.js:4176, 4207`; layout from `Get_Macro_Value` `:4322-4372` and `Update_Macro` `:3000-3044`):

| Offset | Size | Content |
|---|---|---|
| `0x00` | 1 | name length in UTF-8 bytes, 1..30 |
| `0x01`..`0x1E` | 30 | name, UTF-8, padded with `0xFF` |
| `0x1F` | 1 | event count, ≤ 70 |
| `0x20 + 5i` | 1 | `(status << 6) \| type` — status `2` (`0x80`) = press, `1` (`0x40`) = release; type from HIDKey (0 modifier, 1 key, 4 mouse button) |
| `0x21 + 5i` | 1 | value low byte |
| `0x22 + 5i` | 1 | value high byte |
| `0x23 + 5i` | 1 | delay high byte (ms, big-endian) |
| `0x24 + 5i` | 1 | delay low byte |
| `0x20 + 5n` | 1 | CRC = `0x55 − (count + Σ event bytes)` (the count byte at `0x1F` is included) |

Total bytes written by `Set_MS_Macro` = `33 + 5n` (max 383). Example, name "ab", events A-press (50 ms) then A-release:
`02 61 62 FF×28 | 02 | 81 04 00 00 32 | 41 04 00 00 00 | 57`.

Mouse-button events (`InsertEventOptions`, `en.json:418-446`) encode `(type << 16) | value` = `0x040001` Left, `0x040002` Right, `0x040004` Middle, `0x040010` Forward, `0x040008` Backward, i.e. type 4 with bit-values `0x01/0x02/0x04/0x10/0x08` (`MouseMacro.vue:488-490`) — note these differ from the key-slot button codes (`0x0100`…) in §5.3.

### 6.2 Read / write sequences

| Operation | Function | Sequence | Source |
|---|---|---|---|
| Read one macro | `Get_MS_Macro(slot)` | name: read 10 bytes at base, then if `len+1 > 10` read the rest in 10-byte reads; contexts: read 10 bytes at `base+0x1F`, then up to `count*5+2` bytes | `HIDHandle.js:4236-4267, 4387-4390` |
| Write whole macro | `Set_MS_Macro(slot, {name, contexts})` | one `Set_Device_Eeprom_Array(base, 33+5n bytes)` | `:4201-4215` |
| Write name only | `Set_MS_MacroName` | 31 bytes at base | `:4170-4182, 4270-4281` |
| Write events only | `Set_MS_MacroContext` | `1+5n+1` bytes at `base+0x1F` | `:4185-4198, 4284-4320` |
| Clear | `Restore_MS_Macro(slot)` | 384 zero bytes at base; UI also restores the key slot default | `:4218-4234`, `MouseMacro.vue:728-750`, `MouseKey.vue:414-437` |

Macros are only fetched at connect for slots whose key type is `0x06` (`:2948-2953`); a decoded macro is accepted only if `1 ≤ nameLen ≤ 30` and `count ≤ 70` (`:3004-3005`) and, in the UI, only if it has ≥ 2 events (`MouseMacro.vue:687`).

### 6.3 Binding a macro to a key

Selecting a macro name in the key cascader does: `Set_MS_KeyFunction(slot, {type 6, param (slot<<8)|cycleTimes})` then emits `setMouseMacro` → `Set_MS_Macro(slot, macro)` (`MouseKey.vue:234-246, 268-273`; `MouseMacro.vue:708-715`). The macro slot therefore always equals the key slot. Saving an edited macro rewrites every slot whose stored name matches and re-sends the key slot if the cycle count changed (`MouseMacro.vue:519-599`). The macro list itself lives in `localStorage["macro"]` and is merged with what the mouse holds at connect (`MouseMacro.vue:612-618, 666-706`).

### 6.4 Recording and limits (UI)

| Rule | Value | Source |
|---|---|---|
| Max events per macro | 70 | `MouseMacro.vue:366, 401` |
| Delay per event | ms between consecutive `keydown`/`keyup` events (`Math.floor(Δ timeStamp)`), stored on the previous event; "default delay" mode uses a fixed 10..65535 | `MouseMacro.vue:364-405, 429-443` |
| Delay edit range | 10..65535 | `:299-310` |
| Cycle modes | radio `1` → count 1..250; `253` = loop until this key pressed again; `254` = loop until this key released; `255` = loop until any key pressed | `:108-112, 445-462, 523-535` |
| Insert events | Press/Release of a typed key (dialog), or mouse button press+release pair with 10 ms delays | `:463-518, 801-840` |
| Name | punctuation and whitespace stripped, truncated to 30 UTF-8 bytes | `InputName.vue:55-74` |

---

## 7. Lighting (decorative light)

### 7.1 Block at `0xA0`

`Set_MS_Light` (`HIDHandle.js:3530-3541`) writes 7 bytes at `0xA0`; `Get_MS_Light` reads 7 (`:3525-3527`); decode `:2825-2830`:

| Offset | Content |
|---|---|
| `0xA0` | mode |
| `0xA1..0xA3` | R, G, B |
| `0xA4` | speed 0..9 (clamped to 9 on read) |
| `0xA5` | brightness 0..9 (clamped to 9 on read) |
| `0xA6` | record CRC |
| `0xA7` (separate value record) | on/off `1`/`0` |
| `0xB3` (separate) | turn off while moving `1`/`0` |

### 7.2 Modes and capability matrix

From `HIDHandle.js:654-662`, `UserConvert.js:62-109`, API text `HIDHandle.js:5944-5961`; GravaStar `LightModeOptions` list modes 0..5 only (`en.json:450-475`).

| Mode | Name | Speed | Brightness | Colour |
|---|---|---|---|---|
| `0x00` | Off | – | – | – |
| `0x01` | Rainbow (colour flow, default) | ✓ | ✓ | – |
| `0x02` | Single-colour breathing | ✓ | ✓ | ✓ |
| `0x03` | Fixed colour | – | ✓ | ✓ |
| `0x04` | Neon | ✓ | ✓ | – |
| `0x05` | Rainbow breathing | ✓ | ✓ | – |
| `0x06` | Fixed rainbow (not offered to GravaStar) | –¹ | ✓ | – |

¹ Mode 6 speed: both comment blocks (`HIDHandle.js:661`, `:5954`) list speed as supported for mode 6, but `UserConvert.LightMode_To_Disable` (`UserConvert.js:92-95`), which is what `MouseLight.vue:290` actually uses to enable the sliders, disables speed (and colour) for mode 6. The table follows the shipped UI logic; which one the firmware honours is **UNVERIFIED**.

Set semantics (`Set_MS_LightMode`, `HIDHandle.js:3557-3580`): mode 0 writes only `0xA7 = 0` (the stored mode byte is untouched); any other mode writes `0xA7 = 1` if it was off and then the whole 7-byte block. Brightness/speed/colour setters (`:3544-3606`) each rewrite the block. The UI shows mode 0 whenever `state` is off regardless of the stored mode (`MouseLight.vue:313, 337`). Colour is chosen from a colour-bar image / 14 preset PNGs by canvas pixel pick or R/G/B spinners (`MouseLight.vue:241-288`). GravaStar defaults: mode 0 (mid 1-4) or 1 (mid 5), brightness 4 or 9, speed 7, `movingOffState` true except mid 2 (`cfg.json:116-121, 203-208, 290-295, 377-382, 464-469`). The Light tab is hidden if the device cfg has no `lightEffect` (`Mouse.vue:358`).

---

## 8. Sleep time / light-off time

A single EEPROM byte at `0xAD` written by `Set_MS_LightOffTime(v)` (`HIDHandle.js:3682-3691`), value in units of 10 s (`:6001-6013`). Two UI controls drive it and keep each other in sync via `updateSleepTime`/`updateLightOffTime` events: "Mouse sleep time" (`SleepTime.vue:33-41`) and "Light off time after stationary" (`MouseLight.vue:232-240`). Options (`en.json:478-507`): `1`=10 s, `3`=30 s, `6`=1 min, `12`=2 min, `30`=5 min, `60`=10 min, `90`=15 min. GravaStar defaults: 1 (mid 3,4,5) or 6 (mid 1,2) (`cfg.json:115, 202, 289, 376, 463`). The `deviceInfo` comment describes the byte as "sleep time and turn off decorative light when idle" (`HIDHandle.js:669`); whether one byte controls both behaviours in firmware is **UNVERIFIED**.

---

## 9. Debounce and button operation mode

| Setting | EEPROM | Range | UI | Source |
|---|---|---|---|---|
| Button press debounce | `0xA9` | 0..`cfg.maxDebounce` (15) ms; warning dialog below `cfg.tipsDebounce` (8) | select in Key tab | `HIDHandle.js:3637-3657`, `Debounce.vue:41-71`, `cfg.json:45-47` |
| Button release debounce | `0xE5` | 0..30 | none (library only) | `HIDHandle.js:3843-3852, 5779-5780` |
| Wheel debounce | `0xE3` | 10..100 per API comment (`10-30 ms` per `deviceInfo` comment) | none | `:3831-3840, 545, 5776-5777` |
| Left/right "advance" operation mode | `0x08` bit0 / bit1 | 0 normal, 1 advance | none | `:3113-3136, 2811-2812` |

Address conflict: `MouseEepromAddr.RightTrigger` is also `0xE5` (`HIDHandle.js:289`), so `Set_MS_ButtonTrigger(1, v)` and `Set_MS_DebounceReleaseTime` write the same byte — probably a typo for `0xF5`; **UNVERIFIED**.

---

## 10. Profiles

| Item | Value | Source |
|---|---|---|
| Count | 4 (`Profile 1..4` → values 0..3) | `en.json:222-239`, API "0-3, some MCU not support" `HIDHandle.js:6557-6564` |
| Read current | `Send_Command(0x0E)`; reply byte 5 = profile; reply byte 1 == 1 → `supportChangeProfile = false` and the select is disabled | `:1490-1499, 1608-1610`, `Profile.vue:46-48` |
| Set | `Send_Command_With_Value(0x0F, [p])`, then full `Update_Device_Param` re-sync | `:1956-1974` |
| Mouse-side change | `StatusChanged` bit `0x04` → `Get_Device_Profile` → re-sync | `:1390-1395` |

---

## 11. Extended per-device features present in `HIDHandle.js` but without GravaStar UI

§11.1-11.3 (flywheel, button trigger, virtual centre) are not referenced by any `.vue` in this build (grep over views/components returned nothing); §11.4-11.5 (motor, OLED) are called only from `components/Setting/Oled.vue` (`:260-287, 567-626`), which `MouseSetting.vue:10` comments out. All are documented from the library.

### 11.1 Flywheel / scroll-wheel mode (2026-04-16)

| Field | EEPROM | Values | Source |
|---|---|---|---|
| State | `0xE9` | 0/1 (`StatusChanged` byte6 bit `0x08` reports mouse-side changes) | `HIDHandle.js:3855-3875` |
| Max speed / max-speed time / deceleration | `0xEB`, `0xEC`, `0xED` (+CRC `0xEE`), written as one 4-byte array | each 0..4 (5 levels, 0 slowest) | `:3878-3924` |

### 11.2 Button trigger (2026-04-27)

| Field | EEPROM (L / R) | Encoding | Source |
|---|---|---|---|
| Trigger point | `0xEF` / `0xE5`(sic) | 0..9 → +25..+250 (25 per step) | `:3926-3957` |
| Fast trigger | `0xF1` / `0xF7` | `(state << 7) \| (level & 0x7F)`, level 0 off, 1..5 → −25..−125 | `:3959-3988` |
| Tactile feedback | `0xF3` / `0xF9` | `(sound << 7) \| (power & 0x0F)`, power 0 off, 1..5 waveform | `:3990-4021` |
| Current travel (read-only) | `StatusChanged` bytes 13/14 | | `:1376-1377` |

### 11.3 Virtual centre (2026-04-23)

`0x1B48` enable (0/1), `0x1B4A` location (default 100) (`HIDHandle.js:4024-4045, 574-577`).

### 11.4 Vibration motor (commands `0x2E` set, `0x2F` get, `0x30` restore)

Payload (`Set_Device_MotorParam`, `HIDHandle.js:2157-2166`; reply decode `:1582-1591`):

| Byte | Content |
|---|---|
| 0 | mode & `0x0F`: 0 off, 1 normal, 2 strong, 3 burst (`:2134-2138`) |
| 1-3 | level for each mode: 0..10 → 20,30,40,50,60,70,80,100,150,200,300 ms (`:2168-2183`) |
| 4-6 | button pairs: `(btn[2k] & 3) \| ((btn[2k+1] & 3) << 4)`; 0 off, 1 short, 2 long (`:2185-2192`) |
| 7 | switches: bit0 power-on, bit1 DPI-switch, bit2 low-battery, bit3 rest-countdown (`:2194-2203`) |

Reply: byte 5 mode, 6-8 levels, 9-11 button pairs, 12 switches. The only UI is the disabled `Oled.vue` panel (`Oled.vue:566-628`).

### 11.5 OLED picture (commands `0x31` update, `0x32` restore default)

`Set_Device_OLEDPicture(pixels)` (`HIDHandle.js:2214-2248`):

| Item | Value |
|---|---|
| Packet | `[31 00 idxH idxL 0A d0..d9 00.. CRC]`, `idx` 1-based packet number, 10 pixel bytes per packet |
| Pacing | `device.sendReport` directly (no echo wait), 5 ms between packets |
| Error | reply `0x31` with byte 1 == 1 sets `oledSetErrorFlag`; whole image retried up to 3 times with a 100 ms pause |
| Image format | 1 bpp, `width*height/8` bytes; the (disabled) `Oled.vue` defaults to 128×80 = 1280 bytes = 128 packets (`Oled.vue:141-143, 249-254`) |
| Patterns offered | all black `0x00`, all white `0xFF`, alternating rows (buggy: only writes the first row), "spots" `0x55`, restore (`Oled.vue:255-288`) |

`Oled.vue` is commented out of `MouseSetting.vue` (`MouseSetting.vue:10`), so nothing pushes time/images in this build; its audio-capture experiment (`getDisplayMedia` + AnalyserNode RMS/8-band/beat log every 200 ms, `Oled.vue:319-565`) only logs to the console. Bit order within a byte and scan direction are **UNVERIFIED**.

---

## 12. Dongle features (wireless only)

Queried by `Get_Dongle_Param` right after connect when `isWired == false` (`HIDHandle.js:2036-2043`).

| Feature | Set cmd / payload | Get cmd / reply | Source |
|---|---|---|---|
| Dongle firmware version | — | `0x1D` → `"v" + b5 + "." + hex2(b6)`; reply byte 1 == 1 → `"v1.0"` | `:2097-2099, 1549-1553, 1612-1614` |
| 4K-dongle RGB | `0x14` `[mode, r1 g1 b1, r2 g2 b2, r3 g3 b3]` | `0x15` → b5 mode, b6-8, b9-11, b12-14 colours | `:1986-2021, 1511-1523` |
| Dongle RGB bar | `0x18` `[mode, r g b, speed, brightness, time]` | `0x19` → b5.., same order | `:2054-2095, 1533-1547` |
| Dongle 3 LEDs | `0x2C` `[m0, m1, m2]`, each 0 off, 1 connection/signal strength, 2 battery, 3 report rate | `0x2D` → b5-7 | `:2101-2121, 1555-1565` |
| Long-range mode | `0x16` `[0/1]` (10-byte payload) | `0x17` → b5 == 1; reply byte 1 == 1 → unsupported (panel hidden) | `:2024-2034, 2050-2052, 1528-1531, 1604-1606`, `AdvancedSetting.vue:33-67`, `MouseSetting.vue:52` |

GravaStar mid 5 declares `dongle4KRGB.mode = 2` (`cfg.json:471-476`) and the Dongle RGB panel is shown only for that device (`MouseSetting.vue:48`); the radio list comes from `lang.DongleRGBOptions` which does not exist in `en.json` (list renders empty), so the mode values for this dongle are **UNVERIFIED**. The lang file does carry three LED-mode descriptions (`DialogConnectLED`: connection state + report-rate colours red 125 / blue 250 / yellow 500 / orange 1000 / purple 2000 / green 4000; `DialogBatteryLED`: green 100 % / yellow 66 % / orange 33 % / red 0 %; `DialogBatteryWarningLED`: off except red blink on low battery) that plausibly correspond to modes 1/2/3 — **UNVERIFIED** mapping. On factory restore the driver re-sends the cfg default 4K-RGB mode and long-range mode (`HIDHandle.js:1911-1924`).

### 12.1 Pairing (summary)

`Set_Device_EnterPairMode` sends `0x05` with `[4]=2, [5]=0, [6]=0, [7]=cid` (cid from `cfg.mouse[0].cid` = 18 when triggered from Home) (`HIDHandle.js:1853-1865`, `Home.vue:228`); on the reply the driver polls `0x06` every 1000 ms up to 20 times; reply b5 = status (`1` pairing, `2` fail, `3` success), b6 = seconds left (`:1303-1324, 1868-1878, 406-410`). The Pair button is disabled when wired (`Pair.vue:53-55`).

---

## 13. Battery model

Reply to `0x04` (`HIDHandle.js:1283-1301`): b5 = level %, b6 = charging (`1`), b7-8 = voltage big-endian (mV; default placeholder `0x0E90` = 3728). The mouse address comes from the `0x03` DeviceOnLine reply b6..b8 stored reversed (`:1274-1280`) and keys the persisted display level `localStorage["bat_" + addr]` (`BatteryHandle.js:32-34, 192-198`).

Smoothing (`BatteryHandle.js`):

| Rule | Detail | Source |
|---|---|---|
| Voltage → % | thresholds `3050,3420,3480,3540,3600,3660,3720,3760,3800,3840,3880,3920,3940,3960,3980,4000,4020,4040,4060,4080,4110` mV = 0..100 % in 5 % steps, linear inside a step; > 4110 → 100 (99 while charging); results of exactly 0 or 15 are bumped +1 | `:12-13, 205-243` |
| Used only if `voltage > 0`; otherwise the reported % is used | | `:28, 114-119` |
| Start-up reconciliation | if last sample > 1800 s old use measured; < 60 s use last shown; else clamp within +0.028 %/s (charging bound) and −0.014 %/s | `:245-281` |
| 10 s ticker | charging: +1 while `measured − 10 > shown` (until 85 %); discharging: −1 while measured < shown | `:74-98` |
| 60 s ticker | charging above 85 %: +1 up to 99 | `:100-109` |
| Full | shown 100 % only after the mouse reports 100 % in ≥ 8 of 10 extra polls | `:178-187` |
| Low battery | first time measured ≤ 15 % the display snaps to 15 %; `Battery.vue` colours ≤ 15 % red, 100 % full | `:145-160`, `Battery.vue:11` |
| `SupChangeBat` (30-point jump rule) | flag never set true → dead code | `:6, 162-173` |

`cfg.debug.batteryPolling` (`cfg.json:31`) is not read by any of the reviewed code — **UNVERIFIED** effect.

---

## 14. Firmware upgrade (`UpgradeHandle.js`)

No view in this build calls `UpgradeHandle`/`Set_Device_EnterUpgrade`; the Settings "Upgrade" button only downloads `cfg.upgrade.link` via XHR (`DeviceInfo.vue:42-65`) and `Mouse.vue:233-299` shows a notice when `cfg.upgrade.{device,dongle,dongle2,dongle4,dongle8}` differ from the reported versions (GravaStar `cfg.json` has no `upgrade` key). The library nevertheless implements two flows selected by `mcuType` (`0` Compx, `1` NRF54H20; `UpgradeHandle.js:149, 479-537`).

### 14.1 Compx upgrade file format

Header parsed by `ArrayToUpgradeFileHeader` (`UpgradeHandle.js:311-412`), all integers little-endian:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | `headCRC` = `0x55555555 − Σ bytes[8 .. headLength)` (`:414-426`) |
| 4 | 4 | `headLength` |
| 8 | 4 | `fwLength` (firmware bytes, image starts at `BOOT_SIZE = 0x2000` in the file, `:5, 707`) |
| 12 | 4 | `nextFileAddress` (≠0 → a second image for the other chip follows at that offset, `:496-509`) |
| 16 | 4 | version |
| 20 | 1 | device type: `0xD1` keyboard, `0xD2` mouse, `0xD3` dongle (`:10-14`) |
| 21 / 22 | 1 | cid / mid |
| 23 + 64k | 64 each | strings k=0..10: fileId ("ComUpgradeFile"), icName, bootInputEndPoint, bootOutputEndPoint, normalInputEndPoint, normalOutputEndPoint (form `vid_3554&pid_f502&mi_01&col05`, parsed for VID/PID `:445-477`), resetToUpdateModeCmd, prepareDownLoadCmd, dataDownLoadCmd, senserName, productName |

Command blobs (`BootModeReport`, `:71-76, 284-296`): byte 0 = length (default `0x11`), byte 1 = `1` if feature report else output report, byte 2.. = report ID followed by command bytes; `normalReportId`/`bootReportId` default 8/6 and are overridden by byte 2 of reset/prepare commands (`:133-134, 530-531`).

### 14.2 Compx flow and packet format

| Step | Detail | Source |
|---|---|---|
| Reset to boot | send `resetToUpdateModeCmd` (bytes after the report ID) every ~200 ms (20 × 10 ms ticks) until the input report echoes it; give up after `errorTimeout/200` rounds; then re-request the boot device (VID/PID from `bootOutputEndPoint`) | `:792-873` |
| Queue | `[prepareDownLoadCmd]` then data packets | `:686-752` |
| Data packet (64 B) | `[reportId, B1, C0/C1, len, 00, addr31..24, addr23..16, addr15..8, addr7..0, 0×8, data×32 (0xFF pad)]`; `0xC0` next / `0xC1` last (`:16-19`), 32 bytes per packet (`maxSize = 32`, `:675`), start address = big-endian bytes 5..8 of the *command part* of `dataDownLoadCmd` (i.e. blob bytes 7..10, after the length/feature bytes; `:705`) and increments by 32 | `:675, 703-752` |
| Send | `sendReport(reportId, buffer[1..len-1])` or `sendFeatureReport`; per-packet timer `errorTimeout` | `:891-934` |
| Replies | `0x5B` DeviceState (byte1 must be `0xB5`): byte2 `0x01` erase backup / `0x02` erase main (byte3 == 1 → ack, pop queue), `0x05` CRC check OK, `0x10` prepare, `0x11` waiting for boot mode, `0x88` success; `0xB1` echo compared with the sent packet → pop, mismatch → resend (> 8 resends → `RepeatCountMax 0x83`); `0x5A` DeviceError (byte1 `0xA5`) | `:21-35, 974-1052` |
| States | `Standby 0, Success 1, Upgrading 2, UpgradeNext 3, UserCancel 0x10, UserCancelNext 0x11, Fail 0x81, TimeOutError 0x82, RepeatCountMax 0x83, DeviceError 0x84, DeviceInvalid 0x85` | `:47-62` |
| Progress | `packetsSent*100/total`, halved per device when two images | `:767-780` |

`errorTimeout` is a caller parameter ("1000 => 1 second", `:1376-1381`); no caller exists, so the production value is **UNVERIFIED**.

### 14.3 NRF54H20 DFU flow

Transport: feature report ID `0x0C`, 120-byte buffer `[0, dfuState, configStatus, len, payload…]`; reply read with `receiveFeatureReport` after 2 ms, payload length at reply byte 4, data from byte 5 (`UpgradeHandle.js:1060, 1163-1190`). Enums: `DFU_STATE` inactive 0, active 1, storing 2, cleaning 3 (`:1061-1066`); `ConfigStatus` SET 6, FETCH 7 (`:1068-1084`). Every step retries 10× (`MaxRetryCount`, `:1192-1198`).

| Step | Send | Expect | Source |
|---|---|---|---|
| Init | CRC-32 (reflected poly `0xEDB88320`, seed 1, chained per 512-byte page, input/output inverted per page) over the whole file; packets of 116 bytes grouped per 32 KiB | | `:1086-1161` |
| isDfuBusy | `[3 cleaning, 7 fetch]` | 15-byte reply, byte0 == 0 (inactive); 20 ms retries | `:1200-1217` |
| Prepare | `[1 active, 6 set]` + 12 bytes: size LE32, crc LE32, 4×0 | empty reply | `:1219-1243` |
| isDfuReady | `[3, 7]` | 15 bytes: byte0 == 1, size LE32 @1, crc LE32 @5, offset LE32 @9 matching; else re-prepare | `:1245-1282` |
| Data | `[2 storing, 6 set]` + ≤116 bytes | empty reply; after each 283rd packet (`floor(32768/116) = 282`) poll `[3,7]` every 300 ms until ready | `:1301-1352` |
| Finish | isDfuBusy again, then `[4, 7]` | 1-byte reply == 1 (active); 300 ms retries | `:1354-1373` |

---

## 15. Config export / import (`.bin`)

Export (`Other.vue:187-239`): file = `flashData` (16384 bytes, whatever has been read so far) + 64-byte trailer: `"Compx Inc"` at `+0x00`, device type string (`"mouse"`) at `+0x20`, sensor type (`"3950"`) at `+0x30`, saved as `<name>.bin`. Import (`Other.vue:60-152`): validates the trailer, rejects type/sensor mismatch, clamps report rate to `maxReportRate` and DPI count/current to the cfg stage count (re-computing the complement bytes), then `Write_Mouse_Flash` (`HIDHandle.js:2439-2540`) writes bytes `0..flashEndAddress`, the 3955 DPI block, the virtual-centre block, and, per key slot, the shortcut (`0x20`) and macro (`0x180`) blocks only where they differ from the live shadow.

Factory restore: command `0x09` sent raw, then wait for the reply (`isRestoring = false`) for up to 20 × 300 ms = 6 s, then full re-sync and re-application of cfg defaults for long-range and 4K-dongle RGB (`HIDHandle.js:1881-1938`).

---

## 16. Audio recorder (`recorder-core.js`, `RecorderMusic.vue`)

`recorder-core.js` is the third-party "Recorder" H5 library (header `Recorder.LM = "2025-01-11 09:28"`, GitHub xiangyuecn/Recorder, `recorder-core.js:24-25`) providing microphone capture via `getUserMedia`, PCM buffering, resampling (`Recorder.SampleData`, `:571-575`) and power-level helpers (`:779-813`). `RecorderMusic.vue` instantiates it with `type:"pcm", bitRate:16, sampleRate:16000` (`RecorderMusic.vue:59-65`) and an `onProcess` callback that resamples the newest buffer to 16 kHz and slices 960-sample chunks, logging them (`:30-54`). The component is not mounted (`MouseSetting.vue:11` comments it out), its heading is a copy of the pairing panel, and the code references undefined `sampleBuf`/`info_div` and uses a non-arrow callback (`this.rec` undefined) so it would throw if run. Nothing is sent to the mouse; the only device-side "music" commands are office-keyboard ones (`0xB0..0xB6`, `HIDHandle.js:243-248`, amplitude packing of 20 nibbles into 10 bytes `:2278-2285`). Purpose of the mouse-side stub is therefore **UNVERIFIED** (prototype for music-reactive lighting).

---

## Open questions

1. **Fire-key interval unit** — the dialog only says "Interval (10-255)"; the byte is written verbatim (`MouseKey.vue:464`). Milliseconds is the natural reading but is UNVERIFIED.
2. **`RightTrigger` at `0xE5`** collides with `DebounceReleaseTime` (`HIDHandle.js:281, 289`); likely `0xF5`. Which byte the firmware uses is UNVERIFIED.
3. **Sleep byte `0xAD`** — one value feeds both "mouse sleep time" and "light off after idle"; whether firmware treats these as one timer is UNVERIFIED.
4. **`ReportRate_To_FlashData`** in `UserConvert.js:15-25` produces `0x20` for 2000 Hz while the decoder expects `0x10`; only config import is affected, but the correct firmware code for 2000 Hz on an import path is UNVERIFIED (the normal set path uses `0x10`).
5. **Dongle 4K RGB mode meanings** (`0x14/0x15`) — `DongleRGBOptions` is absent from the lang files; the three LED-mode strings in `en.json` are probably the modes but the numeric mapping is UNVERIFIED.
6. **DPI-LED brightness/speed applicability** — HIDHandle comments (`:3362, 3465`) and `DpiEffect.vue:71-88` disagree on which mode uses which slider; the Vue behaviour is documented here.
7. **OLED bit/scan order** and real panel size (`Oled.vue` defaults 128×80) are UNVERIFIED; the panel is disabled in this build.
8. **Legacy RGB addresses `0x54/0x58/0x5A/0x5C/0x5E`** and spindown `0x06/0x08`, `RFTXTime 0xBB` — semantics UNVERIFIED (no callers).
9. **Upgrade `errorTimeout`** value and whether GravaStar devices use the Compx or NRF54 flow — no caller in the build.
10. **`ContextMenu` key** is mapped as type 7 value 1 (`HIDKey.js:383-387`); no type 7 exists in the legend — UNVERIFIED whether the firmware accepts it.
11. **`cfg.debug.batteryPolling`** — not read by any code reviewed.
12. **3955 LOD level 5** is 1.5 mm in `en.json` and in the changelog (`HIDHandle.js:49`) but 1.6 mm in the `Set_MS_LOD` comment (`HIDHandle.js:3612`); not relevant to GravaStar sensors (3395/3950).
13. **Light mode 6 speed control** — the comment blocks (`HIDHandle.js:661`, `:5954`) say speed is adjustable, `UserConvert.LightMode_To_Disable` (`UserConvert.js:92-95`) disables it; mode 6 is not offered to GravaStar, and the firmware behaviour is UNVERIFIED.
