# K98 Pro — Lighting and Macros (GS HUB protocol, reverse engineered)

**Scope.** This document covers everything the GS HUB K98 Pro web tool does with the keyboard's lighting and macro subsystems: the active lighting service (`class Ya`, registered as `"ILightingLegacyService"` but exposed as `keyboard.lighting`), the older per-parameter lighting service (`class Va`, registered as `"ILightingService"`), effect IDs and their UI names, per-key custom colours, the real-time RGB / LED-bead streaming commands (wired and the raw "wireless" 20-byte report form), the lighting change bubble event, the sleep timer, lighting-control keycodes, and the macro service (`class Oa`) including storage size, header table, entry encoding, macro keycode and how a macro is bound to a key. Everything below is derived only from the code; anything that could not be confirmed from the code is marked **UNVERIFIED**.

## Sources

All paths are under `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/`.

| File | Lines | What |
|---|---|---|
| `deob/k98pro/index-Dk7Hs9bA.js` (the "main file") | 315–327 | `ba` (max macro delay), macro loop-type enum `ke`, device enum `Ge`, key-state enum `U2` |
| main file | 365–393 | `i0` macro code types, `Kt` modifier codes, `Mt`/`Cr` mouse buttons |
| main file | 480 | `Ce` light-type enum |
| main file | 573–612 | byte helpers `Da`, `D`, `Ue`, `ae`, `xo` (report-id discovery) |
| main file | 697 | `Q` device-event names |
| main file | 766–1076 | `Ea` packet config + `class Ha` codec (encode/decode/buildCommands/buildMacroCommands/CRC/bubble parsing) |
| main file | 1145–1320 | `class Mo` HID wrapper (queue, timeout/retry) |
| main file | 1348–1354 | `Ba.setKeymaps` (key binding command) |
| main file | 1425–1655 | `Ne/a2/s2/c2` per-parameter enums, `Wa`, `class Va` (per-parameter lighting) |
| main file | 1656–1822 | `Zt` HID usage table used by macro decode |
| main file | 1826–1972 | `Kr`, `class Oa` macro service |
| main file | 2603–2610, 2660–2683 | `za.getSleepTime/setSleepTime`, `za.getDeviceFeatures` |
| main file | 2684–2806 | `Ft` colour grouping, `Pt` RGB565 |
| main file | 2807–2993 | effect enums `v0` (main), `rt` (side), `Dr` (extra) |
| main file | 3016–3212 | `_r`, `class Ya` lighting service, `Tr`, `qa` |
| main file | 3672–4050 | `t3`, `class n3` framed transport, `class r3` |
| main file | 4074–4148 | `s3` transport selection, `Q2` facade service registry/getters |
| main file | 5559–5673 | `class Po` macro recorder, wireless PID set `h3` |
| main file | 8566–8683, 10536–10548 | `gu` lighting mode list, `R9` name→id mapping |
| main file | 10614, 11402–11560, 13005–13090 | lighting keycode groups/tables |
| main file | 14086, 14403–14492 | device store: `getLedBeads` call, per-key custom lighting read/write |
| main file | 14494–14508, 14614–14645 | macro trigger-setting helpers, sleep option table `z9` |
| `deob/k98pro/index-idhpy26q.js` | 457–950 | lighting panel (ranges, steps, mode sets, side-light sync, bubble handling) |
| `deob/k98pro/lighting-DVm9DVga.js` | 18, 66–77 | lighting pinia store |
| `deob/k98pro/index-YIc1a_Gi.js` | 17, 80–135, 174–200, 216–232, 278–286, 384–450 | macro editor (trigger modes, binding, limits, size accounting) |
| `deob/k98pro/index-ClXPruC4.js` | 40–90 | macro store (getMacros/setMacros cache) |
| `deob/k98pro/globalSetting-CsPa239Q.js` 86–92, `index-C54O2iUn.js` 338–344, `useProfileConfigSync-DnqHfXZR.js` 13, 54 | sleep timer UI/store |
| `deob/k98pro/useCopyProfileConfig-BG7qTx_n.js` | 98–99, 178–190 | profile copy of lighting |
| `deob/k98pro/i18n-en.js` | 107–114, 202–211, 356–419 | English strings for effects, macro modes, sleep options |
| `gshub/k98pro-app/js/index-Dk7Hs9bA.js` (original obfuscated bundle) | — | Used to re-decode the string tables for `class Va`, `Ne/a2/s2/c2`, `v0/rt/Dr`, `ke`, `Ce`, `Q`, `Ha.buildMacroCommands`, `Ya`, `Oa` where the pretty-printed file's identifiers are mangled (decoder script: `dec/decode.py`). Line numbers cited are always from the pretty-printed main file. |

---

## 1. Framing recap (what lighting/macro commands sit inside)

Full detail is in the transport/codec documents; only what is needed to read the byte layouts below is repeated here.

| Item | Value | Source |
|---|---|---|
| Packet size | 63 bytes (`totalPacketSize`), header 6 bytes, tail 1 byte → 56 data bytes per packet (`validDataLength`) | main 766–776, 781–786 |
| Header layout | `[0]=cmdId, [1]=param, [2]=0, [3]=totalPackets, [4]=packetIndex, [5]=dataLen, [6..61]=data, [62]=checksum` | `buildCommands` main 869–878 |
| Checksum | byte 62 := 0, then `255 − ((Σ bytes[0..62] + reportId) mod 256)` — the HID **report ID is included in the sum** | main 891–899 |
| Report ID | discovered from the HID collection with output reports (`xo`) — not hard-coded for the normal path | main 608–620 |
| Response validation | response bytes `[0],[1],[3],[4]` must equal the request's | main 844–868 |
| Read reply decode | `decode(view, len?)` slices `[6, 6+min(len, 56))`; when an array of packets is given the slices are concatenated | main 798–813 |
| Multi-packet | `encode(cmd, param, data, chunk)` splits `data` into `ceil(len/chunk)` packets (`chunk` defaults to 56; `calculateAlignedDataSize(unit, mult)` = `floor(56/mult)*unit`) | main 791–797, 900–905 |
| Wired transport (`Mo`) | per-command timeout **1000 ms, retry 1** (2 attempts) — `s3` overrides the class defaults of 500 ms / 3 | main 4074–4082, 1171–1177, 1261–1300 |
| 2.4 GHz "Wireless8K" transport (`r3`+`n3`) | command timeout **2000 ms**, retry default **3** (4 attempts); each 64-byte packet (report id prepended) is split into `0x66`-framed 20-byte reports of 14 data bytes, per-frame ACK timeout **100 ms, 10 retries** | main 3672–3678, 3738–3743, 3878–3926, 4046–4049, 4074–4082 |
| Connect type | `Wireless8K` when `productId ∈ {0x106C (4204)}` (`h3`) or a wireless HID filter matches; otherwise `Wired` (wired PID 0x10E5 (4325), VID 0x372E (14126)) | main 5673, 5788–5790, 7374, 7401 |
| `sendCommand` | `send(cmd, {waitResponse:false})` — fire-and-forget, no retry; used by all real-time RGB commands | main 1200–1204, 1265–1272 |

---

## 2. Lighting enums

### 2.1 Light types (`Ce`) and parameter codes

`Ce` (main 480, decoded): **Main = 1, Side = 2, Logo = 3**. Exported as `V` and used by the UI as `s.Main` / `s.Side` (index-idhpy26q.js 457–475).

The firmware addresses lighting through the **param byte** of commands `0x04` (write) / `0x84` (read). Two numbering schemes appear in the code:

| Purpose | Main | Side | Logo | Used by | Source |
|---|---|---|---|---|---|
| Whole effect record (id, colourIdx, RGB, brightness, speed) | `0x01` (1) | `0x06` (6) | `0x0B` (11) | `Ya.getEffect/setEffect` via `Tr()` | main 3193–3204 |
| Effect ID only ("switch" in `Va`) | `0x02` (2) | `0x07` (7) | `0x0C` (12) | `Ya.changeEffect` via `qa()`; `Va` enum `Ne` | main 3205–3216; 1425–1457 (decoded) |
| Colour (colourIdx + RGB) | `0x03` (3) | `0x08` (8) | `0x0D` (13) | `Va` enum `a2` | main 1425–1457 (decoded) |
| Brightness | `0x04` (4) | `0x09` (9) | `0x0E` (14) | `Va` enum `s2` | same |
| Speed | `0x05` (5) | `0x0A` (10) | `0x0F` (15) | `Va` enum `c2` | same |

Note the bubble-event parser (§6) decodes the same 1..15 code space with a *different* order (effectId, brightness, speed, color, direction) — see the open question there.

### 2.2 Main-light effect IDs (`v0`, main 2807–2916, decoded from the original bundle)

`gu` (main 8566–8683) is the UI list; `R9` (10546) maps each entry's `mainEffect`/`sideEffect` name through `v0`/`rt` (10536–10545, throws on unknown names). English names from `i18n-en.js` 372–394.

| ID | Enum name | UI label (en) | In UI list | Notes |
|---|---|---|---|---|
| 0x00 (0) | Off | Off | yes (main+side) | `lighting.modes.off` |
| 0x01 (1) | SteadyMode | Always On (Static) | yes (main+side) | speed slider disabled (idhpy26q 467) |
| 0x02 (2) | BreathingMode | Breathing | yes (main+side) | |
| 0x03 (3) | DreamRainbow | Dream Rainbow | yes (main+side) | random colour + colour picker disabled (467) |
| 0x04 (4) | InstantTrigger | Instant Trigger | yes | |
| 0x05 (5) | WalkingInRain | Walking in Rain | yes | |
| 0x06 (6) | RainbowWheel | Rainbow Wheel | yes | |
| 0x07 (7) | RippleEffect | Ripple | yes | |
| 0x08 (8) | StarryNight | Starry Night | yes | |
| 0x09 (9) | SnowTrail | Snow Trail | yes | |
| 0x0A (10) | EndlessFlow | Endless Flow | yes (main+side) | |
| 0x0B (11) | FollowingWaves | Drifting Waves | yes | |
| 0x0C (12) | ShadowFollowing | Shadow Follow | yes | |
| 0x0D (13) | LightWave | Sine Wave | yes | |
| 0x0E (14) | LeftRightScan | Left-Right Scan | yes | |
| 0x0F (15) | SpinningWindmill | Spinning Windmill | yes | random colour + picker disabled |
| 0x10 (16) | ColorfulWaterfall | Rainbow Waterfall | yes | random colour + picker disabled |
| 0x11 (17) | BlossomProsperity | Blossom | yes | |
| 0x12 (18) | SpinningStorm | Spinning Storm | yes | |
| 0x13 (19) | CustomMode | Custom (Static) | yes (main only) | per-key colours (§4); speed disabled; random disabled |

### 2.3 Side-light effect IDs (`rt`, main 2916–2947, decoded)

| ID | Enum name | UI label |
|---|---|---|
| 0x00 (0) | Off | Off |
| 0x01 (1) | EndlessFlow | Endless Flow |
| 0x02 (2) | DreamRainbow | Dream Rainbow |
| 0x03 (3) | SteadyMode | Always On (Static) |
| 0x04 (4) | BreathingMode | Breathing |
| 0x05 (5) | RunningHorse | Marquee (`lighting.modes.runningHorse`) — side only |

Note the side IDs differ from the main IDs for the same name; the UI always maps through the correct table per light type (`Ee()` idhpy26q 540–543, `Te()` 543–547).

### 2.4 Extra effect enum `Dr` (main 2947–2993, decoded) — **UNVERIFIED use**

Decoded values: SoftDance 0xA8 (168), DazzlingRock 0xA9 (169), CloudsAndSnow 0xAA (170), LightFieldVocal 0xAB (171), FlowingStream 0xAC (172), BloomingFlowersPassion 0xAD (173), PaintedWorm 0xAE (174), ColorfulChain 0xAF (175), WaterSplash 0xB0 (176), Off 0xB4 (180), DynamicSpectrum 0x1AC (428). No reference to `Dr` exists anywhere else in the bundle (grep `Dr[`/`Dr.` returns nothing) and it is not exported; it is dead data in this build.

### 2.5 Colour index, brightness and speed ranges

| Field | Wire range | UI mapping | Source |
|---|---|---|---|
| `colorIndex` | byte; `0` = use the RGB bytes; `>= 7` = "mixed/random colour" (`isMixedColor(i) = i >= 7`); the UI writes `7` (`Oe = 7`) for "Random Color Shift" and sends RGB `0,0,0` with it | idhpy26q 457, 718–732; main 3021–3023 |
| `color` | 3 bytes R,G,B (0–255) | HSV picker → RGB (`Ue`, idhpy26q 594–607) |
| `brightness` | byte; UI uses **0..20 for Main**, **0..4 for Side** (`Xe()` = 20 / 4) — percent→device `round(p/100*max)`; slider step 5 % (main, sync off) or 25 % (side, or main when side-sync is on) | idhpy26q 655–662, 552 |
| `speed` | byte; UI uses **0..4** (`Dt()`), slider step 25 % (`Kn = 25`) | idhpy26q 457, 658 |
| Logo light | no UI (only "Key Backlight" / "Side Light" tabs, idhpy26q 460–466); supported flag reported by `checkLightingSupported` (§5) | |
| `direction` | appears only in the bubble event (§6) and the lighting keycodes (§8); `i18n lighting.directions` is `{}`; no set/get API exists in `Ya` | i18n-en 371 |

**getEffect colour fix-up:** if `id == CustomMode (19)` and `colorIndex >= 7` and RGB is `0,0,0`, the library rewrites `r = 255` before returning (main 3024–3037).

---

## 3. Active lighting service `class Ya` (`keyboard.lighting`)

Registered under `_r = "ILightingLegacyService"` (main 3016, 4092–4130) and returned by `Q2.lighting` (main 4137–4139). Constructor receives `(protocol, transport, hidDevice)` — the raw `hidDevice` is only used by the `*ByWireless` methods (main 3017–3020).

| Method | Cmd / param | Data sent | Reply data | Wait? | Source |
|---|---|---|---|---|---|
| `getEffect(type)` | `0x84` / `Tr(type)` (1, 6, 11) | none | `[id, colorIndex, r, g, b, brightness, speed]` | yes | main 3024–3037 |
| `setEffect(type, e)` | `0x04` / `Tr(type)` | `[e.id, e.colorIndex, e.color.r, g, b, e.brightness, e.speed]` (7 bytes) | echo | yes | 3038–3045 |
| `changeEffect(type, id)` | `0x04` / `qa(type)` (2, 7, 12) | `[id]` | echo | yes | 3046–3049 |
| `getCustomMainLight(ids)` | `0x86` / `0x00` | `ids` as u16 BE each; chunked 22 bytes (=11 ids) per packet (`calculateAlignedDataSize(2,5)`) | per key 5 bytes: `id_hi, id_lo, r, g, b` | yes | 3050–3064 |
| `setCustomMainLight(list)` | `0x06` / `0x00` | per key 5 bytes `id_hi, id_lo, r, g, b`; chunked 55 bytes (11 keys) per packet | echo | yes | 3065–3068 |
| `checkLightingSupported()` | `0x82` / `0x09` | none | see §5 | yes | 3069–3079 |
| `updateFullKeysRGB(rgb)` | `0x08` / `0x02` | `[r, g, b]` | — | no (`sendCommand`) | 3080–3083 |
| `updateRGB(list)` | `0x08` / `0x01` | grouped: `[r, g, b, n, id0..id(n-1)]*` (ids are **1 byte** here) | — | no | 3084–3087 |
| `updateRGBWithLedBeads(list)` | `0x08` / `0x03` | RGB565 u16 BE per bead, sorted by row then col | — | no | 3125–3128 |
| `updateLedBeadColors(list)` | `0x08` / `0x04` | grouped: `[rgb565_hi, rgb565_lo, n, beadId0..]*` with `beadId = (row&7) \| (col&31)<<3` | — | no | 3182–3188 |
| `getLedBeads(ids)` | `0xA1` / `0x00` | ids as u16 BE, **10 ids per packet** (each packet built separately) | `[id_hi, id_lo, count, count × beadByte]*` with `row = b & 7`, `col = (b>>3) & 31` | yes | 3129–3181 |
| `updateFullKeysRGBByWireless` / `updateRGBByWireless` / `updateRGBWithLedBeadsByWireless` | raw HID report ID `0x09` | see §4.3 | — | no | 3088–3124 |
| `updateLedBeadColorsByWireless` | — | throws `"Not implemented yet, please use updateRGBWithLedBeadsByWireless or updateRGBByWireless instead"` | | | 3189–3192 |
| `isMixedColor(colorIndex)` | — | `colorIndex >= 7` | | | 3021–3023 |

Effect-change sequence used by the UI when the user picks a mode (idhpy26q 804–826):

```
changeEffect(type, effectId)           -> 0x04 / (2|7|12) [id]
getEffect(type)                        -> 0x84 / (1|6|11)      (re-read the whole record)
isMixedColor(reply.colorIndex)         -> decide "random colour" toggle
(if type == Main and side-light sync)  -> setEffect(Side, {...})  (mirror)
```

Slider/colour changes go through `setEffect(type, {id, colorIndex, color, brightness, speed})` (idhpy26q 718–732) debounced by 120 ms (758–763). "Off" is written as `setEffect` with `id = Off` (`Ot()` idhpy26q 701–704) — there is no separate on/off command.

`getLedBeads` unsupported-detection: if the first reply's length byte (`[5]`) equals the request's length byte the device is assumed to have echoed the request and `[]` is returned (main 3150–3153). The device store calls `getLedBeads(allKeyIds)` during layout load but **discards the result** (main 14086).

---

## 4. Per-key and streamed colours

### 4.1 Custom (static) main-light colours — `0x06` / `0x86`

Key IDs are the 16-bit key ids used by the keymap service (`D(id)` = `[hi, lo]`, main 591–593). Data record = `id(u16 BE) + R + G + B` (5 bytes). Reads request explicit ids and get back the same 5-byte records (main 3050–3064). The device page writes single keys (`debouncedSetLightingCustom`, main 14486–14492) or batches (`setCustomLightingForKeys`, 14454–14474) and "reset" writes every key with `0,0,0` (14475–14482). Profile copy also uses these two calls (useCopyProfileConfig 99, 190).

### 4.2 Colour grouping `Ft(list, 48)` (main 2684–2788, decoded)

Used by `updateRGB`, `updateRGBByWireless`, `updateLedBeadColors`:

```
threshold2 = 48*48 = 2304
for each {id, color}:
    find first cluster with (dR²+dG²+dB²) < threshold2 against the cluster's running average
    -> append id, update sums/averages; else start a new cluster
merge clusters whose rounded average (r<<16|g<<8|b) is identical
emit [{ids, color: rounded average}] 
```

So streamed frames are RLE-by-colour, not per key; nearby colours are quantised to their cluster average.

### 4.3 RGB565 `Pt(color)` (main 2790–2806, decoded)

`((r>>3)&31) << 11 | ((g>>2)&63) << 5 | ((b>>3)&31)`; sent big-endian via `D()` (hi, lo).

### 4.4 Wireless raw report form (`*ByWireless`, main 3088–3124)

These bypass the codec and transport entirely and call `hidDevice.sendReport(0x09, payload19)`. The array is built as 20 bytes including the report id, so the payload written is 19 bytes:

| Offset (incl. report id) | Value | Notes |
|---|---|---|
| 0 | `0x09` | HID report ID (passed as first arg to `sendReport`; not in payload) |
| 1 | `0x08` | same command number as the wired `0x08` |
| 2 | `total` | number of chunks (`1` for full-keys) |
| 3 | `index` | chunk index (0-based) |
| 4 | `(kind << 4) \| (len & 0x0F)` | kind 1 = grouped per-key RGB (`0x10\|len`), 2 = full keys (`0x23` = 0x20\|3), 3 = LED-bead RGB565 (`0x30\|len`); `len` = payload bytes in this chunk, max 13 |
| 5..17 | payload (≤ 13 bytes = 20−6−1) | zero padded to offset 18 |
| 19 | checksum | `255 − (Σ bytes[0..18] mod 256)` — plain 8-bit sum **including the leading 0x09**, no report-id term added separately (main 3091–3094, 3105–3107, 3115–3117) |

Chunks are sent with `Promise.all` (no ordering guarantee beyond the browser's queue, main 3107, 3123). Payload contents: kind 1 = `Ft` groups `[r,g,b,n,ids…]` (a group may straddle chunk boundaries, as the flat array is simply sliced every 13 bytes); kind 3 = RGB565 u16 BE per bead sorted by row then col.

No UI code in this bundle calls any `update*RGB*`/`LedBead` method (grep over `deob/`), so these are library-only capabilities in this build.

---

## 5. Capability probes

### 5.1 `checkLightingSupported()` — `0x82` / `0x09` (main 3069–3079)

Takes the **first reply packet only** and slices raw bytes `[6..61]` (`lengthIndex+1 .. len-1`) without honouring the length byte:

| Offset in data | Meaning |
|---|---|
| `[17]` bit0 | `musicMain` |
| `[17]` bit1 | `musicSpectrum` |
| `[17]` bit2 | `musicSide` |
| `[18]` | `sideLight` (non-zero = present) |
| `[19]` | `logoLight` (non-zero = present) |
| `[20]` | `sideLightCount` |

Bytes `[0..16]` of this reply are not interpreted by the lighting service (**UNVERIFIED** what they hold; `0x82` with other params is the config service's domain).

### 5.2 Lighting bits in `getDeviceFeatures()` — `0x82` / `0x0F`, 56-byte reply (main 2660–2683)

`[9]` bit0 `keyIdRGB` (per-key-id RGB streaming), bit1 `fullKeysRGB`, bit2 `ledBeadTable565` (LED-bead table / RGB565), bit3 && bit4 `ledBeadRGB565`. These correspond to the `0x08` sub-commands 1 / 2 / 3–4 and `0xA1`.

---

## 6. Device-initiated lighting change event — `0xFE` / `0x0B`

`Ha.bubbleCommandIds = {0xFE, 0x98, 0x94}` (main 778). For `0xFE` (`onCommonBubbleResponse`, main 909–1030) sub-type `0x0B` (11) at byte `[1]` is parsed (947–1030, decoded):

| Byte | Meaning |
|---|---|
| `[0]` | `0xFE` |
| `[1]` | `0x0B` |
| `[2]` = `c` | parameter code 1..15 |
| `[3]` = `d` | new value (effect id / brightness / speed / direction / colourIndex) |
| `[4],[5],[6]` | R, G, B — only when `changeType == "color"` |

Decoding: `lightType = c < 6 ? Main : c < 11 ? Side : Logo`; `changeType = ["effectId","brightness","speed","color","direction"][(c−1) % 5]`. The emitted event is `Q.LightingEffectChange` whose string is `"lighting-effect-change"` (main 697, decoded) and the payload is `{lightType, changeType, effectId | brightness | speed | direction | colorIndex+color}`. The keyboard manager forwards it to the app (`L2.LIGHTING_EFFECT_CHANGE`, main 7352–7359; host event enum `D3` 7807) and the lighting panel updates its sliders/mode from it (idhpy26q 667–700; on `effectId` it also turns side-light sync off).

**UNVERIFIED / inconsistent:** with this mapping `c = 2` means "Main brightness", whereas the command side uses `2` for "Main effect id" and `4` for "Main brightness" (§2.1). Either the firmware's bubble numbering differs from the command numbering or the array order in the parser is wrong; the code gives no way to tell.

---

## 7. Per-parameter lighting service `class Va` (`"ILightingService"`)

Registered under `Wa = "ILightingService"` (main 1458, decoded; pretty-printed file shows `"jkyOG"`) and only reachable through `keyboard.getService("ILightingService")` — `Q2.lighting` returns `Ya`, and no UI chunk references any `Va` method. The pretty-printed method names at main 1459–1655 are mangled; the table below is from the re-decoded original. All calls wait for a response.

| Decoded method | Cmd / param | Data | Reply |
|---|---|---|---|
| `getLight(t)` | `0x84` / `t == Ne.Main ? 1 : t` | — | `data[0]` = effect id |
| `setLight(t, v)` | `0x04` / `t` (`Ne`: 2/7/12) | `[v]` (effect id) | — |
| `getLightColor(t)` | `0x84` / `t` (`a2`: 3/8/13) | — | `[colorIndex, r, g, b]` |
| `setLightColor(t, idx, rgb)` | `0x04` / `t` (`a2`) | `[idx, r??0, g??0, b??0]` | — |
| `getLightBrightness(t)` | `0x84` / `t` (`s2`: 4/9/14) | — | `decode(o,1)[0]` (1 byte) |
| `setLightBrightness(t, v)` | `0x04` / `t` (`s2`) | `[v]` | — |
| `getLightSpeed(t)` | `0x84` / `t` (`c2`: 5/10/15) | — | 1 byte |
| `setLightSpeed(t, v)` | `0x04` / `t` (`c2`) | `[v]` | — |
| `get/setMainLight`, `get/setSideLight`, `get/setLogoLight` | wrappers → `Ne.Main/Side/Logo` = 2 / 7 / 12 | | |
| `get/set{Main,Side,Logo}LightColor` | wrappers → `a2` = 3 / 8 / 13 | | |
| `get/set{Main,Side,Logo}LightBrightness` | wrappers → `s2` = 4 / 9 / 14 | | |
| `get/set{Main,Side,Logo}LightSpeed` | wrappers → `c2` = 5 / 10 / 15 | | |
| `getCustomMainLight(ids)` / `setCustomMainLight(list)` | identical to `Ya` (§3): `0x86`/`0x06`, 5-byte records, 22/55-byte chunks | | |

There is **no on/off command** in `Va` either; "on/off" is `setLight(type, effectId)` with `Off = 0`. There is no direction or sleep method in `Va`; sleep is a config-service command (§9).

---

## 8. Lighting-control keycodes (bindable to keys)

Keycodes of the form `0x08GGOOLL` (main 11402–11560; `ye.light` list 10614 restricts which are shown in the picker groups):

| Bits | Meaning |
|---|---|
| `0x08 << 24` | lighting-control class |
| byte2 `GG` | 0 = effect, 1 = direction, 2 = colour, 3 = brightness, 4 = speed |
| byte1 `OO` | 0 = loop/cycle, 1 = increase / right, 2 = decrease / left |
| byte0 `LL` | 0 = Main, 1 = Side, 2 = Logo |

Examples: `0x08000000` Main Effect Loop, `0x08000102` Logo Effect +, `0x08010100` Main Direction Left (legend says "Left" for `OO=1`, "Right" for `OO=2`), `0x08020000` Main Color Loop, `0x08030100` Main Brightness +, `0x08040200` Main Speed −. i18n keys `mainLightingEffectCycle` … `logoLightingSpeedDecrease` (main 11404–11560). The `ye.light` group (10614) exposes 15 of the 45 codes: Main Effect Loop/−, Main Brightness +/−, Main Speed +/−, Logo Effect Loop, Logo Brightness +/−, Logo Speed +/−, Main Color Loop, Logo Speed Loop, Logo Brightness Loop, Logo Color Loop.

Decorative-light keycodes `0xF310..0xF318` (D1), `0xF320..0xF328` (D2), `0xF330..0xF338` (D3) — `_Mode, _Color, _Bri+, _Bri−, _Spd+, _Spd−, _Prev, _OnOff, _Dir` (main 13005–13090, `ye.decorativeLighting1..3` 10619–10621). **UNVERIFIED** whether K98 Pro firmware honours these; they are part of a shared keycode table.

Binding any keycode uses `Ba.setKeymaps` → `0x03` (§11.4).

---

## 9. Sleep timer (config service `za`, exposed on the facade)

| Method | Cmd / param | Data | Reply | Source |
|---|---|---|---|---|
| `getSleepTime()` | `0x84` / `0x13` (19) | — | `data[0]<<8 \| data[1]` (u16 BE) | main 2603–2606, 4238–4240 |
| `setSleepTime(sec)` | `0x04` / `0x13` | `D(sec)` = `[hi, lo]` | echo | main 2607–2610, 4241–4243 |

Unit is seconds: the UI option table `z9` (main 14614–14645) is 30, 60, 120, 300, 600, 900, 1800, 3600, 7200 and **0 = "Never sleep"**; the store field is `sleepSeconds` (default 60, useProfileConfigSync 54) and the "Other" pane writes the chosen value directly (`setLightingSleepTime`, globalSetting 86–92, index-C54O2iUn 338–344). i18n `other.sleepTimeDesc`: "The keyboard sleeps automatically after a period of inactivity … in wireless mode" (i18n-en 435).

---

## 10. Lighting UI behaviour worth knowing when emulating the tool

| Behaviour | Detail | Source |
|---|---|---|
| Modes that disable "Random Color Shift" (`Z`) | DreamRainbow, ColorfulWaterfall, SpinningWindmill, CustomMode | idhpy26q 467 |
| Modes that disable the colour picker (`N`) | DreamRainbow, ColorfulWaterfall, SpinningWindmill | 467 |
| Modes that disable the speed slider (`v`) | CustomMode, SteadyMode | 467 |
| Side-light sync | localStorage `k98pro:lighting:side-light-sync`; when on, every main-light write is mirrored to Side with the same mode (only modes with a `sideEffect`), main brightness quantised to the side 0..4 scale | 457, 476–486, 707–717, 733–750, 827–835 |
| Entering CustomMode | `changeEffect(Main, 19)` then reads per-key colours via `getCustomMainLight` for all layout ids (`getKeyCustomLighting`) | 613–625, 804–826; main 14403–14439 |
| Initial load | `getEffect(current tab type)` | 879–885 |
| Lighting store `readLightingBase` | `getEffect(area startsWith "Decorate" ? Side : Main)` | lighting-DVm9DVga 18, 66–77 |
| Profile copy | reads `getEffect` for each light type it lists and `getCustomMainLight`; writes `setEffect` + `setCustomMainLight` | useCopyProfileConfig 98–99, 178–190 |

---

## 11. Macros — service `class Oa` (`keyboard.macro`, `"IMacroService"`)

Registered under `Kr = "IMacroService"` (main 1826, 4092–4130), returned by `Q2.macro` (4146–4148).

### 11.1 Commands

| Method | Cmd / param | Data | Reply | Source |
|---|---|---|---|---|
| `getMacroMaxStorageSize()` | `0x82` / `0x00` | — | 4 bytes u32 BE = macro storage capacity in bytes (`\|\| 0`) | main 1831–1834 |
| `getMacroHeaderLength()` | `0x85` / offset (see below) | 2 zero bytes (reads 2 bytes at offset 0) | `[a, s]`; `0xFF,0xFF` → 0; else `len = s<<8 \| a` (**little-endian**), accepted only if `len % 4 == 0` | 1835–1840 |
| `getMacroHeaders(len)` | `0x85` / offset | `len` zero bytes (reads `len` bytes at offset 0) | `len/4` entries `{offset = [1]<<8\|[0], length = [3]<<8\|[2]}` (LE u16 each) | 1841–1855 |
| `getMacros()` | `0x85` / offset | reads `lastHeader.offset + lastHeader.length` bytes from offset 0 | full image, parsed as §11.3 | 1856–1913 |
| `setMacros(list)` | `0x05` / `0x00` | full image (header table + bodies), auto-split into 56-byte packets | echo per packet | 1914–1951 |
| `encodeMacroKeycode(index, loopType, loopCount=0)` | — | `0x03<<24 \| loopType<<16 \| loopCount<<8 \| index` | | 1952–1954; same as `Ha.generateMacroKeycode` 1065–1067 |
| `isMacroKeycode(kc)` | — | `(kc >>> 24) & 0xFF == 0x03` | | 1955–1958 |
| `decodeMacroKeycode(kc)` | — | `{loopType: kc>>>16 & 0xFF, loopCount: kc>>>8 & 0xFF, index: kc & 0xFF}` | | 1959–1965 |

### 11.2 Macro read packets — `buildMacroCommands` (main 879–890, decoded)

A read is first built with `encode(0x85, 0, zeros(N))` (N/56 packets, `[0x85, 0, 0, total, idx, len, 0…]`), then every packet gets its **byte offset** written over header bytes `[1]` and `[2]`:

```
offset = idx * 56
pkt[1] = (offset >> 8) & 0xFF      # replaces the param byte
pkt[2] = offset & 0xFF             # replaces the normally-zero byte
pkt[62] = crc(pkt)                 # recomputed
```

So a `0x85` read is: `[0x85, off_hi, off_lo, total, idx, wantLen, 0…, crc]` and the reply carries `wantLen` bytes of macro storage starting at `offset` (replies of all packets are concatenated by `decode`). Response validation still compares bytes `[0],[1],[3],[4]`, so the offset high byte must be echoed.

**Write (`0x05`) packets do not carry an offset** — `setMacros` uses plain `encode(5, 0, image)` (main 1949–1950); the device must place packet `idx` at `idx*56`.

### 11.3 Storage image format (from `setMacros` 1914–1951 and `getMacros` 1856–1913)

```
+0                 header table: N entries × 4 bytes
                   entry i: offset(u16 LE) , length(u16 LE)      # offset from image start
                   first entry offset == 4*N  (this is what getMacroHeaderLength reads)
+4N                macro bodies, back to back, in table order:
                   [nameLen(1)] [name: nameLen bytes UTF-8] [actions: 4 bytes each]
```

`length` = `1 + nameLen + 4*actionCount`. `getMacros` re-derives the header count from the **low byte only** of the first u16 (`const [y] = u; h = u.slice(0, y)`, main 1872–1874) — with more than 63 macros (`4N > 255`) the parse would break (**observation, not a device limit**). Name limit enforced by the library: `TextEncoder` byte length ≤ 255, else throws `Macro name "…" is too long. Maximum length is 255 bytes.` (1915–1920); the editor additionally trims names to 10 characters (`A = 10`, index-YIc1a_Gi 80, 260, 316).

### 11.4 Action entry (4 bytes, `c()` main 1934–1937; decode 1888–1891)

| Byte | Bits | Meaning |
|---|---|---|
| 0 | 7 | key state: **0 = Down, 1 = Up** (`U2.Down = 0, U2.Up = 1`, main 327 decoded) |
| 0 | 6..4 | code type (`i0`, main 365–372): 0 Normal (HID usage), 1 Modifier, 2 Mouse, 3 MouseX, 4 MouseY, 5 MouseWheel (only 0–2 are ever written) |
| 0 | 3..0 | delay bits 19..16 |
| 1 | 7..0 | delay bits 15..8 |
| 2 | 7..0 | delay bits 7..0 |
| 3 | 7..0 | value |

`delay` is a **20-bit value in milliseconds** (mask `0xF0000`/`0xFF00`/`0xFF`), maximum `ba = 0xFFFFF = 1048575` (main 315; recorder clamp `Po.updateDelay` 5560–5562: `clamp(parseInt(x), 1, ba)`; editor clamp `X()` = `min(max(1, floor(x)), ye = ba)`, index-YIc1a_Gi 401–408). It is the time **before** the action: the recorder attaches `performance.now() − lastTime` to each new action (`triggerAction` 5655–5662; the editor rounds it and applies the "default delay" of 50 ms when enabled, `be = 50`, index-YIc1a_Gi 80, 440–451). The i18n texts "Time cannot exceed 32768 ms" / "cannot be less than 1 ms" (i18n-en 112–113) do not match the code's 1048575 clamp — **UNVERIFIED** which limit the firmware enforces.

`value` by code type (encode `s()` main 1925–1933, decode 1892–1905):

| Code type | value |
|---|---|
| Modifier (1) | `Kt`: ControlLeft 0xE0, ShiftLeft 0xE1, AltLeft 0xE2, MetaLeft 0xE3, ControlRight 0xE4, ShiftRight 0xE5, AltRight 0xE6, MetaRight 0xE7 (main 372–381) |
| Mouse (2) | button **bit mask** `Cr`: Left 0x01, Right 0x02, Wheel(middle) 0x04, Back 0x08, Forward 0x10 (main 387–393); JS `MouseEvent.button` 0/1/2/3/4 → name via `Mt` (381–387) |
| Normal (0) | HID keyboard usage from `Zt` (main 1656–1822; e.g. KeyA 0x04, Enter 0x28, F1 0x3A, media usages 0xE8–0xFB); unknown names encode as 0 |

Decoded actions are returned as `{type (0 down/1 up), code (browser code / button number), delay, device (Ge.Keyboard="keyboard" / Ge.Mouse="mouse", main 327)}`.

### 11.5 Macro keycode and trigger modes

Keycode = `0x03 LT CC II`:

| Field | Values | Source |
|---|---|---|
| `LT` loopType (`ke`, main 323 decoded) | **Count = 0x01**, **UntilKeyDown = 0x02**, **UntilKeyUp = 0x04** | |
| `CC` loopCount | editor: integer ≥ 1 (`le()` index-YIc1a_Gi 401–404, default `je = yo = 1`, main 14494); no upper clamp in code — values > 255 would overflow into `LT` (**UNVERIFIED** firmware max) | |
| `II` macro index | position in the macro list (0-based, `id = a` in `vt()` index-YIc1a_Gi 216–232) | |

Trigger-mode meanings from the editor (index-YIc1a_Gi 88–107) and i18n (396–419, 107–109):

| loopType | Editor option | UI text |
|---|---|---|
| Count (1) | `macro.trigger.press`, has count | "Trigger on press" — run `loopCount` times |
| UntilKeyUp (4) | `macro.trigger.holdRepeat` | "Repeat while held, stop on release" |
| UntilKeyDown (2) | `macro.trigger.untilAnyKey` | "Repeat until any key is pressed" |

Trigger settings are **not stored on the device** — they live in `localStorage` key `gravastar:macro-trigger-settings:v3` (main 14494–14540; older v1/v2 formats migrated by `Ju`/`Xu`); the device only sees them inside the keycode of each bound key.

### 11.6 Binding a macro to a key

```
kc = macro.encodeMacroKeycode(macroIndex, loopType, loopCount)          # index-YIc1a_Gi 182, 390
remapping.setKeymaps({layer, system, keycaps:[{id, keycode: kc}, ...]}) # index-YIc1a_Gi 193–200
  -> 0x03 / param = (layer & 3) | (system & 7) << 2                      # main 913–915
     data per key: [id_hi, id_lo, kc_b3, kc_b2, kc_b1, kc_b0]  (u16 BE + u32 BE, Ue() main 594–600)
     source: Ba.setKeymaps main 1348–1354
```

Read-back `getKeymaps` (`0x83`, main 1355–1370) returns 6-byte `id(u16 BE) + keycode(u32 BE)` records; `isMacroKeycode` / `decodeMacroKeycode` identify macro keys. Drag-binding in the editor pre-computes the same keycode (`Tt`, 384–395).

### 11.7 Write/read sequences and limits

```
Load list:   0x82/00 (capacity)  -> 0x85 @0 len2 -> 0x85 @0 len 4N -> 0x85 @0 len total -> parse
Save list:   build image (header table + bodies) -> 0x05 /00, ceil(size/56) packets, each awaited
```

Storage check in the editor (index-YIc1a_Gi 17, 278–286): `Σ (4 + utf8len(name) + 4*actionCount) > maxMacroStorage` → "storageLimitReached"; note this under-counts by the 1-byte `nameLen` field per macro relative to the wire format. `maxMacroStorage` comes from `0x82/00`; if it is 0 the editor refuses to save (`storageUnavailable`). The store caches `getMacros()` per profile (index-ClXPruC4 43–66) and every save rewrites the whole image (`setMacros(all)`, 67–70).

Wired vs wireless: no macro/lighting command differs by connection type except the `*ByWireless` raw-report streaming (§4.4); over 2.4 GHz every 63-byte packet is additionally fragmented into 0x66 frames by `n3` (§1).

---

## Open questions

1. **Bubble parameter order (§6):** the `0xFE/0x0B` parser maps code `(c−1)%5` to effectId/brightness/speed/color/direction, while the command side uses 2 = effect id, 3 = colour, 4 = brightness, 5 = speed (and 1 = whole record). Which numbering the firmware actually emits could not be determined from the code.
2. **Meaning of `0x84/0x01` byte 7+ and of `0x82/0x09` bytes 0–16:** only bytes 0–6 (effect record) and 17–20 (lighting flags) are interpreted.
3. **Direction:** a `direction` value exists in the bubble event and in the `0x08010000`-family keycodes, but no read/write command for it is present in `Ya` or `Va`.
4. **`Dr` effect enum** (values 168–176, 180, 428) is dead code in this build; whether the K98 Pro firmware knows those IDs (or the decorative `0xF3xx` keycodes) is unverified.
5. **Macro delay upper bound:** code clamps to 1048575 ms (20-bit field); i18n says 32768 ms.
6. **Macro loopCount upper bound and maximum macro count:** no clamp in code beyond the 8-bit keycode field; `macroLimitExceeded` ("Macro limit of {count}") exists in i18n but no caller was found in the K98 Pro chunks.
7. **`0x85` read granularity:** packets always request 56-byte windows at `idx*56`; whether the device accepts arbitrary offsets/lengths is untested.
8. **HID report ID for the normal path** is discovered at runtime (`xo`), so the numeric value (and whether it equals the hard-coded `0x09` used by the wireless streaming path) is not visible in the code.
9. **`getLedBeads` reply for keys with no beads** and the bead `row`/`col` coordinate system are only known from the 3/5-bit unpacking; the device page discards the result.
10. **Brightness/speed wire maxima** (Main 20 / Side 4 / speed 4) are UI conventions; the firmware's accepted range is not probed by the code.
