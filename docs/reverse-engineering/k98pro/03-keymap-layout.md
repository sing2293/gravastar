# K98 Pro — Keymap, Keycodes, Profiles and Physical Layout

**Scope.** This document covers the key-remapping service (class `Ba`), the profile service (class `ja`), the key-matrix query (`getKeyMatrixPositions` in class `za`), the numeric keycode scheme (32-bit typed codes and the firmware's 16-bit "special" codes), and the physical layout definition the GS HUB UI renders for the GravaStar K98 Pro (US / "uk" / JP variants, 6×21 grid, 98 keys). It also records how the UI composes combo keycodes, which layers/OS variants it exposes, and the Mac-mode default overrides. Everything here is derived from the deobfuscated GS HUB bundle; nothing is inferred from other keyboards. Items that could not be confirmed from code are marked **UNVERIFIED**. Companion machine-readable files: `layout.json` (US), `layout-uk.json`, `layout-jp.json`, `keycodes.json` in this directory.

## Sources

All paths are under `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/`.

| File | Lines | What |
|---|---|---|
| `deob/k98pro/index-Dk7Hs9bA.js` | 766–776 | `Ea` packet constants (63-byte packet, header 6, checksum index 62) |
| same | 777–1067 | `Ha` codec: `encode` 792, `decode` 799, `isValidResponse` 850, `buildCommands` 878, `setChecksum`/`calculateCrc` 908–916, `calculateAlignedDataSize` 917, `encodeLayerAndSystem` 920, bubble events 929–1000, `generateMacroKeycode` 1065 |
| same | 1145–1319 | `Mo` HID transport (queue, timeout/retry defaults 1173, `send` 1200, `processQueue` 1259, `waitForResponse` 1300) |
| same | 1320–1327 | `N0` (special-key type bits) and `B2` (special-key feature bits) |
| same | 1329–1424 | `Ba` keymap service |
| same | 1652–1826 | `Zt` HID-usage → browser `code` name table |
| same | 2378–2412 | `ja` profile service |
| same | 2414–2444 | `Ga` reset service (uses same cmd `0x11`) |
| same | 2542–2551, 2589–2596 | `za.getKeyMatrixPositions`, `getOsMode`/`changeOsMode` |
| same | 661, 663–673 | `F` (system enum, 661) and `j` (layer enum, 673; string pool 663–671) definitions |
| same | 393, 7926–7948 | `we` profile enum, `yt` profile list, `T3`/`D9` name sanitiser, `P3`/`R3` helpers |
| same | 3672–3678, 3927–3930, 4034–4081, 4089 | Wireless framed transport `n3` defaults + `buildFrame`, `r3`, `s3` factory, `Q2` constructor |
| same | 5673, 5788 | `h3` wireless PID set, `D2.isWireless8K` |
| same | 4309–4493 | Preset combo tables `k9`, `w9`, `C9`, `v9`; `d3`/`c3` i18n names 4641–4807; `x9` 4808 |
| same | 4828–5553 | `b9` key definition table (legend / keycode / id / browserCode) |
| same | 8566 | `O2 = [Normal, Fn1, Fn2]`, `A9 = [Normal]` |
| same | 8676–10531 | `mu` physical layouts: `layout-us` 8677, `layout-uk` 9282, `layout-jp` 9894 |
| same | 10532–10623 | `ku=21`, `lo=56`, `xu`, `bu`, `Lu`, `rr`, `_u` (uuid→variant), `Tu`/`Fu`, `pi`, `ye` category lists |
| same | 10625–11737 | `Ru` extended key table; `Eu` = keycode→entry map (11737) |
| same | 11737–13761 | `E9` firmware 16-bit code dictionary (288 entries) |
| same | 13761–13870 | `fi`, `gi`, `Hu`, `Bu`, `Wu` (Mac defaults), `Vu`, `H9`, `mi`, `ju`, `V9` |
| same | 13858–13961 | `N2` key-state defaults (customKeys win/mac × fn0..fn3), `en`, `Gu` (keyLayoutConfig row 6 col 21) |
| same | 14027–14400 | `O9` keyboard Pinia store: `getKeyLayout` 14052, `getKeyCode` 14235, `setKeyCode` 14248, `resetLayerKeyMap` 14282, `patchKeymapLocal`, `findPositionByKeyId` |
| same | 14566–14600, 14646–14760 | `Z9` on-screen picker sections, `Y9` keycode→icon map (contains `knob: "knob"` at 14725) |
| same | 14840 | export map (`Eu as D`, `E9 as p`, `ye as r`, `b9 as a4`, `j as a3`, `F as f`, `O2 as aa`, `A9 as au`, `we as aw`, `yt as O`, `R3 as n`, `M9 as av`, …) |
| `deob/k98pro/index-B0AXfBBW.js` | 253–281, 527, 900–930, 1695–1715 | Matrix-position cache using `getKeyMatrixPositions`; layer constants; 3 layer buttons; Fn-keycode guard |
| `deob/k98pro/index-1Al4GwON.js` | 25–110, 159–166, 303–327 | Custom-key card tabs, category lists, modifier bits, legacy combo builder, `Mt`/`We` 32-bit combo encode/decode |
| `deob/k98pro/index-DIYnHvfa.js` | 60–90 | Key picker builds its grid from `Eu` entries by `browserCode` |
| `deob/k98pro/higherKey-BkEGQ1Fs.js` | 60–68 | Layer display names `["Normal","Fn","Fn1"]` |
| `deob/k98pro/filter-key-Dfwp_tkE.js` | 1–30 | Mac relabelling of modifier codes (Cmd/Opt) and numpad labels |
| `deob/k98pro/index-C54O2iUn.js` | 4, 197–233 | Mac "Win key lock" implemented via keymap writes |
| `deob/k98pro/useCopyProfileConfig-BG7qTx_n.js` | 6–33, 74–80, 153 | Profile copy: layer×system iteration, chunk sizes |
| `deob/k98pro/device-Dagr_f7U.js` | 9–31 | Device UUID constants selecting the layout variant; HID filters (VID `0x372E`, PIDs `0x10E5`, `0x106C`) |
| `deob/k98pro/i18n-en.js` | 55–70, 160–190, 212–273 | Tab names, layer strings, `keyTip_<keycode>` names |

---

## 1. Packet framing used by every command in this document

Defined by `Ea` (line 766) and `Ha.buildCommands` (878). All commands here go through `Ha.encode(cmdId, param, data, chunkSize?)`.

| Byte | Field | Notes |
|---|---|---|
| 0 | command id | e.g. `0x03` |
| 1 | command param | for keymap commands this is the **layer/system byte** (see §2) |
| 2 | 0 | reserved (macro/advanced-key builders overwrite it; keymap leaves 0) |
| 3 | total packets | `max(ceil(len/chunk),1)` |
| 4 | packet index | 0-based |
| 5 | data length in this packet | ≤ 56 |
| 6..61 | data | 56 bytes = `validDataLength` (63 − 6 − 1), line 782 |
| 62 | checksum | `255 − ((reportId + Σ bytes[0..62] with byte62 = 0) mod 256)` (912–916) |

Data larger than the chunk size is split into consecutive packets (878–888). Every packet is sent and its response awaited individually (`Mo.send` 1200 → `Promise.all`); a response is accepted only if bytes 0, 1, 3, 4 equal the request's (850–876). `decode(resp, forcedLen?)` returns `data[6 .. 6+len)` where `len = byte5` unless forced (799–812); for multi-packet requests the slices are concatenated.

**Wired vs 2.4 GHz.** `Q2` constructor (4089) → `s3(connectType)` (4074–4081): `Wireless8K` → `r3` (framed `n3` transport, header `0x66`, 20-byte HID reports, per-frame timeout 100 ms / 10 retries, line 3672) with command timeout **2000 ms**, retry 3 (default from 1173); `Wired` → plain `Mo` with timeout **1000 ms**, retry **1**. `Wireless8K` is chosen when PID ∈ `h3 = {0x106C}` (5673, 5788) or the device is in the wireless filter list (device-Dagr_f7U.js 21–31: VID `0x372E` (14126), PIDs `0x10E5` (4325, wired) and `0x106C` (4204, dongle), usagePage `0xFF60`, usage `0x61`). The keymap byte layouts are identical on both links; only the outer frame differs.

---

## 2. Layers and OS variants

`Ha.encodeLayerAndSystem(layer = j.Normal, system = F.Windows)` (line 920):

```
param = (layer & 0x03) | ((system & 0x07) << 2)
```

| Enum | Value | Source | UI name |
|---|---|---|---|
| `F.Windows` | 0 | 661 (`"Windows"` at index 0, `"MacOS"` at index 1) | "Win" |
| `F.MacOS` | 1 | same | "Mac" |
| `j.Normal` | 0 | 673 (string pool 663–671 contains `"Normal"`, `"Fn1"`, `"Fn2"`; `j.Normal` used at 1346) | "Default Layer" (`keyboardMainLayer`, i18n 162) |
| `j.Fn1` | 1 | `O2 = [j.Normal, j.Fn1, j.Fn2]` (8566) | "Fn" (`higherKey` 60–68: `["Normal","Fn","Fn1"]`; i18n 165 "Fn layer: hold Fn + key") |
| `j.Fn2` | 2 | same | "Fn1" (i18n 166) |
| *(4th value)* | 3 | enum has 4 members (673); store state has `fn3` slots (13902–13945); guard `fnLayer !== 3` at index-B0AXfBBW.js:1704 | never shown — the sidebar renders exactly 3 layer buttons (`De(3, …)` at index-B0AXfBBW.js:907) |

Examples: Normal/Windows = `0x00`; Fn1/Windows = `0x01`; Normal/Mac = `0x04`; Fn2/Mac = `0x06`.

The store's key-load routine reads **all 6 combinations** (`O2` × `[F.Windows, F.MacOS]`, 14090–14113), so the firmware keeps 3 (probably 4) layers × 2 OS tables per profile. The current OS table is selected on-device with `changeOsMode` (`0x04` param `0x11`, data `[system]`, line 2594) / read with `0x84` param `0x11` (2589); the device announces changes via bubble `0xFE` param `0x07` (`SystemChange`, data byte = system, line 954).

---

## 3. Keymap service (`Ba`, lines 1329–1424)

### 3.1 Command table

| Method | Cmd | Param | Data (request) | Response data | Line |
|---|---|---|---|---|---|
| `setKeymaps({layer, system, keycaps[]})` | `0x03` (3) | layer/system byte | per key: `id` u16 BE, `keycode` u32 BE (6 bytes) | none used (ACK by header match) | 1346–1351 |
| `setKeymap({layer, system, id, keycode})` | `0x03` | same | one 6-byte record | — | 1338 |
| `getKeymaps({layer, system, ids[]})` | `0x83` (131) | layer/system byte | `id` u16 BE per key; chunked **9 ids (18 bytes)** per packet via `calculateAlignedDataSize(2, 6)` = ⌊56/6⌋·2 = 18 | per key 6 bytes: `id` u16 BE, `keycode` u32 BE | 1352–1366 |
| `getKeymap({layer, system, id})` | `0x83` | same | one id | first record | 1333 |
| `resetKeymaps({layer, system})` | `0x11` (17) | layer/system byte | `[I2.KeyReset]` | — | 1367–1371 |
| `getSpecialKeys()` | `0xA2` (162) | `0x00` | none | pairs `[typeMask, featureMask]` | 1399–1420 |
| `_getSpecialKeyFeaturesByIndex(typeMask, features[])` | `0xA2` | `0x01` | `[typeMask, feature…]` | byte 0 skipped; then 5-byte records `[feature, keycode u32 BE]` | 1388–1398 |
| `updateSpecialKeys(items[])` | `0x22` (34) | `0x00` | per item `[keyIndex, feature, keycode u32 BE]` | — | 1421–1423 |

Byte helpers: `D(n)` → `[n>>8, n&0xFF]` (u16 BE, line 592); `Ue(n)` → 4-byte BE (`Da(n,4)`, 573–596). Decode side is explicit BE at 1360–1361 (`d[u]<<8|d[u+1]`, `(d[u+2]<<24|…|d[u+5])>>>0`).

Request → response sequence for a full keymap read (store `getKeyLayout`, 14052–14230):

1. `lighting.getLedBeads(ids)` (14085).
2. For each `(layer, system)` in `O2 × {Win, Mac}`: `getKeymaps(layer, system, ids)` — 98 ids → 11 packets of `0x83`, each answered by one packet; the 6 reads are issued concurrently and serialised by the transport queue.
3. Results are keyed `"{layer}-{system}-{id}"` and merged into `keyboardLayout[row][col].customKeys.{win|mac}.fn{layer}.bindKeyValue` (14113–14185).

Single-key write (`setKeyCode`, 14248–14281): remembers the previous default in `localStorage["gravastar:k98:keymap-baselines:v1"]` (13984–14025), patches the local model, then sends **one** `0x03` packet with a single record; on transport error it rolls the local model back.

Batch write (profile copy, useCopyProfileConfig 153): `setKeymaps` with the full id list per `(layer, system)`; `buildCommands` splits the 6-byte records at 56-byte boundaries (56 = 9×6 + 2), so the 10th record straddles two packets — the firmware evidently reassembles the data stream. Layer×system pairs are processed 3 at a time (`U = 3`, `R = 3`, lines 6, 19–33).

Reset: `resetLayerKeyMap(layer)` (14282) → `0x11` with `[I2.KeyReset]`; the "Reset All Layers" button loops over the layers. `I2` has four members = 0..3 (490) named `FullReset`, `KeyReset`, `LightReset`, `USBReset` (usage 2425–2443) but the **name→value assignment is UNVERIFIED** (string pool not recoverable). Note: `Ga.reset` (2418) uses the same command with `type` = any of the four, so `0x11` is a general "reset <thing> on <layer/system>" command.

### 3.2 Key index ("id") addressing

Keymap commands address keys by a **16-bit key id**, not by matrix row/col. The ids for the K98 Pro are the `key` fields of the physical layout (§6) and the `id` fields of `b9` (4828–5553): 1–13 = Esc/F1–F12, 14–27 = number row, 28–41 = Tab row, 42–54 = Caps row, 55–66 = Shift row, 67–77 = bottom row and arrows, 78–94 = numpad, 95–104 = PrtSc/ScrLk/Pause/Ins/Del/Home/End/PgUp/PgDn/Menu, 105–113 = ISO/JIS extras, 114–116 = F13–F15, 119 = Right Win, 120 = "Delete2". `b9` entries (5409–5548) with `id ≥ 256` (consumer keys `256·n`, `32768/32769` for Win+L/Win+D, `65530–65534` for G1–G5) are **picker slots, not device key ids** — they have no matrix position.

Matrix position query (`za.getKeyMatrixPositions(ids)`, 2542–2551):

| Cmd | Param | Request data | Response |
|---|---|---|---|
| `0xA5` (165) | `0x00` | `id` u16 BE per key, chunk 28 ids (`calculateAlignedDataSize(2,2)` = 56) | 2 bytes per id, **`[col, row]`** (`col: a[c]`, `row: a[c+1]`) |

The device page (index-B0AXfBBW.js 253–281) first maps ids from the UI grid; only ids that are *not* in the rendered layout are looked up with `0xA5`, and the result is used to route key-travel-monitor / calibration bubble events (which carry key ids) to on-screen keys. The physical matrix row/col values themselves are therefore **not** in the bundle (UNVERIFIED — must be read from the device).

### 3.3 Rapid-fire keycode encoding (1372–1387)

```
isRapidFire(kc)  = ((kc >>> 24) & 0xFF) === 0x10
encode           = (0x10 << 24) | ((normalKeycode & 0xFF) << 16) | ((count & 0xFF) << 8) | (intervalMs & 0xFF)
decode           = { normalKeycode: (kc >>> 16) & 0xFF, count: (kc >>> 8) & 0xFF, intervalMs: kc & 0xFF }
```

Fields are 8-bit each, so only single-byte HID usages can be rapid-fired, `count` ≤ 255 and `intervalMs` ≤ 255. No UI code calls these helpers (grep over all chunks), so firmware support is **UNVERIFIED**.

### 3.4 Special keys (knob / slider) — `0xA2` / `0x22`

Constants (1320–1327): `N0 = {Wheel: 1, Slider: 2}` (type bit-mask), `B2 = {Click: 1, LongClick: 2, DoubleClick: 4}` (feature bit-mask). `getSpecialKeys` reads `[typeMask, featureMask]` pairs, then for each present type issues `0xA2` param `1` with `[typeMask, ...features]` and parses 5-byte `{type: feature, keycode}` records starting at offset 1. `updateSpecialKeys` writes `[keyIndex, feature, keycode32]` triples. **The K98 Pro UI never calls these** (only the shared library and the host shell copy contain them), the physical layouts contain no encoder entry, and the only "knob" reference is an icon name in `Y9` (14725). Treat the K98 Pro as having **no user-mappable knob** in this app (UNVERIFIED whether the hardware has one).

---

## 4. Keycode numbering scheme

Keycodes are **32-bit unsigned**, sent/received big-endian. Two families coexist in the same field:

### 4.1 Typed 32-bit codes (bits 31..24 = type)

| Type byte | Family | Layout of bits 23..0 | Evidence |
|---|---|---|---|
| `0x00` | keyboard | bits 23..16 = **modifier mask** (bit0 LCtrl, 1 LShift, 2 LAlt, 3 LWin, 4 RCtrl, 5 RShift, 6 RAlt, 7 RWin); bits 15..8 = second HID usage (`b2`); bits 7..0 = HID usage (`b1`) | `b9`: Left Ctrl `0x00010000`, Left Shift `0x00020000`, Left Alt `0x00040000`, Left Win `0x00080000`, Right Ctrl `0x00100000`, Right Shift `0x00200000`, Right Alt `0x00400000`, Right Win `0x00800000` (`b9` 5114–5212); `Mt`/`We` at index-1Al4GwON.js 310–327 |
| `0x01` | mouse | `0x0101_0100` Left, `0x0102_0100` Right, `0x0103_0100` Middle, `0x0104_0100` Back, `0x0105_0100` Forward (`ye.mouse`, 10612; `Ru` 10625+) | |
| `0x02` | consumer / control | bits 15..0 = HID consumer usage: `0x0200006F` Brightness+, `0x02000070` Brightness−, `0x020000B5` Next, `0x020000B6` Prev, `0x020000B7` Stop, `0x020000B8` Eject, `0x020000CD` Play/Pause, `0x020000E2` Mute, `0x020000E9` Vol+, `0x020000EA` Vol−, `0x02000183` Media, `0x0200018A` Email, `0x02000192` Calculator, `0x02000194` My Computer, `0x02000221` Search, `0x02000223` WWW, `0x02000224` Back, `0x02000225` Forward, `0x02000226` Stop, `0x02000227` Refresh, `0x0200022A` Favorites | `b9` 5409–5512 |
| `0x03` | macro | `Ha.generateMacroKeycode(t,e,r) = 3<<24 \| e<<16 \| r<<8 \| t` (1065; no caller). `b9` G1–G5 = `0x03000000`–`0x03000004` (5524–5548) | |
| `0x08` | lighting control | bits 23..8 = action (`0x0000` effect cycle, `0x0001` effect+, `0x0002` effect−, `0x0100` direction cycle, `0x0101` dir left, `0x0102` dir right, `0x0200` colour cycle, `0x0201` colour+, `0x0202` colour−, `0x0300` brightness cycle, `0x0301` bright+, `0x0302` bright−, `0x0400` speed cycle, `0x0401` speed+, `0x0402` speed−) ; bits 7..0 = zone (`0` main, `1` side, `2` logo) | `Ru` 10625+ (e.g. `134217728` = `0x08000000` Main Effect Loop, `134414592` = `0x08030100` Main Brightness+, `134480386` = `0x08040102` Logo Speed−) |
| `0x0D` | Fn layer key | `0x0D000000` "FN" (default of key 72), `0x0D010000` "Fn1" (`functionKey1`) | `b9` 5204, `Ru` |
| `0x10` | rapid-fire | see §3.3 | 1372–1387 |

Combo presets (`k9` 4309, `w9` 4369, `C9` 4402, `v9` 4426; all in `ye.combine` 10622) use type `0x00` with the key in **bits 15..8**: `Ctrl+A` = `0x00010400` (66560), `Ctrl+Shift+Esc` = `0x00032900` (207104), `Alt+Tab` = `0x00042B00` (273152), `LWin+Ctrl+NumEnter` = `0x00095800` (612352). Two presets carry the key in bits 7..0 instead: `Win+L` = `0x0008000F` (524303) and `Win+D` = `0x00080007` (524295) (`b9` 5514–5523). The decoder `We` (index-1Al4GwON.js 315–327) accepts either slot (requires modifier ≠ 0 and at least one usage). The editor's encoder `Mt` (310–314) puts `primary` in bits 7..0 and optional `secondary` in bits 15..8, each validated 1..255.

### 4.2 Firmware 16-bit "special" codes (`E9`, 11737–13761; category lists `ye`, 10608–10623)

These are `< 0x10000` and are used verbatim as keycodes (e.g. the store checks `selectKey.keycode ∈ {61696..61699}` at index-B0AXfBBW.js:1704; i18n `keyTip_<code>` at 212–273).

| Range | Category (`typeof`) | Examples |
|---|---|---|
| `0x0000`, `0x0001` | special | `0x0000` blank key, `0x0001` "△" transparent / pass-through |
| `0x0004`–`0x00E7` | basic | plain HID usages (same numbers as §4.3) |
| `0x1xxx` | system (= legacy combos: `0x1000 \| mod<<8 \| hid`, mod bits ctrl 1/shift 2/alt 4/win 8) | `0x1152` Ctrl+↑ "MCON", `0x1329` Ctrl+Shift+Esc, `0x1807` Win+D, `0x1808` Win+E, `0x1815` Win+R |
| `0x20xx`–`0x22xx` | media | `0x206F` Bri+, `0x2070` Bri−, `0x20B5` Next, `0x20B6` Prev, `0x20B7` Stop, `0x20CD` Play, `0x20E2` Mute, `0x20E9` Vol+, `0x20EA` Vol−, `0x2183` Music, `0x218A` Mail, `0x2192` Calc, `0x2194` My Computer, `0x2223` Browser |
| `0x4000`–`0x4B01` | mouse | `0x4000` release, `0x4100` L, `0x4200` R, `0x4300` M, `0x4400` Fwd, `0x4500` Back, `0x4600`–`0x4900` move L/R/U/D, `0x4A01` wheel fwd, `0x4B01` wheel back |
| `0x52xx`–`0x5Cxx`, `0xC0xx`–`0xD3xx` | game (Xbox / generic gamepad) | `0x5310` A, `0x5320` B, `0x5340` X, `0x5380` Y, `0x5400` LT, `0x5500` RT, `0xC001`–`0xC108` GP_1…GP_12, `0xD301/03/05/07` d-pad |
| `0xF100`–`0xF103` | special (layer switch) | Fn0 "Switch to Main Layer", Fn1, Fn2, Fn3 |
| `0xF200`–`0xF209` | control | `0xF200` factory reset (hold), `0xF201` Windows layout (hold), `0xF202` Mac layout (hold), `0xF203` calibrate switches (hold), `0xF205`–`0xF208` switch to Profile 1–4, `0xF209` Win-key lock |
| `0xF300`–`0xF308` | light | mode, colour, bri±, spd±, prev, on/off, direction |
| `0xF310`–`0xF338` | light (decorative 1–3) | same 9 actions per decorative zone |
| `0xF401`–`0xF407` | triMode | USB, 2.4G, BLE1–3 (short = switch, long = pair), clear pairing, battery query |
| `0xF500`–`0xF50F` | macro | M0–M15 (`macroCount: 16`, globalSetting store) |

Only one `E9` entry is internally inconsistent: key `20996` (`0x5204`, "Direction RIGHT") carries `hex16: "0x5208"`.

### 4.3 HID usage names (`Zt`, 1652–1826)

`Zt` maps `"0x%08x"` → browser `KeyboardEvent.code` for usages `0x00`–`0xFB` (A–Z `0x04`–`0x1D`, digits `0x1E`–`0x27`, Enter `0x28`, Esc `0x29`, …, F13–F24 `0x68`–`0x73`, modifiers `0xE0`–`0xE7`, media `0xE8`–`0xFB`). Some names repeat (`NumpadComma` at `0x85`/`0x8C`, `KanaMode` at `0x88`/`0x92`/`0x93`, `AudioVolume*` at `0x7F`–`0x81` and `0xED`–`0xEF`); `keycodes.json` keeps the first occurrence and lists the duplicates separately. Modifier HID codes `0xE0`–`0xE7` also appear as `Kt` (335–344) and are relabelled Cmd/Opt on Mac by `filter-key` (226/227/230/231 and the 32-bit `0x00040000`/`0x00080000`/`0x00400000`/`0x00800000`).

---

## 5. Profiles (`ja`, 2378–2412)

| Method | Cmd | Param | Data | Response | Line |
|---|---|---|---|---|---|
| `getProfile()` | `0x90` (144) | 0 | — | `decode(r, 1)[0]` = current profile index | 2382–2386 |
| `changeProfile(p)` | `0x10` (16) | 0 | `[p]` | — | 2387–2390 |
| `getProfileName(p)` | `0x9A` (154) | `p` | — | `[len, utf8…]`; `len == 0 \|\| len == 0xFF` → `""`, else UTF-8 of bytes `1..len` | 2391–2395 |
| `getProfileNames(ids[])` | `0x9A` ×n | — | — | parallel `getProfileName` | 2396–2402 |
| `setProfileName(p, name)` | `0x1A` (26) | `p` | `[len, utf8…]`, **max 55 bytes** (throws otherwise) | — | 2403–2411 |

Profile enum `we` (393, exported as `aw`): three members with values **0, 1, 2**; `yt = [we.Default, we.Onboard1, we.Onboard2]` (7926). Display names (`P3`, 7930–7934): value 0 = "Default Profile" / "Onboard Profile 1", 1 = "Onboard Profile 2", 2 = "Onboard Profile 3"; `R3` parses `"Config<n>"` → `yt[n-1]` (7938–7946). Assignment `Default=0, Onboard1=1, Onboard2=2` follows the enum's declaration order — **name→value UNVERIFIED** but the numeric values 0..2 and the count of 3 are certain. The firmware also defines keycodes for "Switch to Profile 1–4" (`0xF205`–`0xF208`), so a 4th onboard slot may exist that the UI does not expose (UNVERIFIED).

UI-side name policy: names are sanitised to `[一-龥a-zA-Z0-9]` and truncated to **10 characters** (`T3 = 10`, `D9`, 7926) before `setProfileName`; profile switches are announced by the device with bubble `0xFE` param `0x09` (`ProfileChange`, data byte = profile, line 959). Profile copy (`useCopyProfileConfig`) switches with `changeProfile`, waits, reads/writes keymaps for every `(layer, system)` pair, then switches back (237–263).

---

## 6. Physical layout used by the UI

### 6.1 Definition and units

`mu` (8676–10531) holds three arrays, `"layout-us"` (8677), `"layout-uk"` (9282), `"layout-jp"` (9894), each a list of **rows** of key objects `{key, defaultKeyCode, keyWord, x, y, w?, h?, lShaped?}`. `Lu` (10571–10586) converts an entry to the store's shape:

```
row  = round(y / 56, 4)      // lo = 56 px per key unit (10532)
col  = round(x / 56, 4)
id   = key                    // device key id used by 0x03 / 0x83 / 0xA5
keycode = defaultKeyCode      // factory default on the Normal/Windows layer
width = w ?? 1, height = h ?? 1, isLShaped = lShaped === true
isTallRectangular = !lShaped && h > 1
isSplittableSpace = key === 70
defaultKeycodes   = xu[variant][key]   // alternative "still default" codes (JP only)
displayLabel      = variant === "us" ? undefined : keyWord
```

`rr` (10587–10590) pads every row to `ku = 21` columns with `bu()` placeholders (`type: "none", id: -1`), giving the `keyLayoutConfig: {row: 6, col: 21}` grid in `Gu` (13961). The store's `row`/`col` are **indices into this padded array**, and `positions = en(variant)` (13946) maps `id → {row, col}` for the arrays; these are *not* the electrical matrix coordinates (§3.2).

Pixel geometry: row baselines `y = 0, 68, 126, 184, 242, 300` (row pitch 58 px, F-row gap 68 px); `x` in px at 56 px/u. `layout.json` carries both the raw px and `xUnits = x/56`, `yUnits = y/56` exactly as the code computes them.

### 6.2 Variant selection

`_u` (10591–10595) maps the device UUID to a variant: `0x14000000000C` (21990232555532) → `us`, `0x14000000000E` (21990232555534) → `uk`, `0x14000000000F` (21990232555535) → `jp` (constants `_`, `c`, `d` in device-Dagr_f7U.js:9); unknown → `us`; `"eu"` is aliased to `"uk"` (`yi`, 10603). The `uk` array's legends are actually **German ISO** (Ü Ö Ä ß, "Entf", "Pos1", "Alt Gr") although the code and firmware URL call it `uk`.

### 6.3 US layout (98 keys) — from `layout-us` 8677–9281

Legend = `keyWord`; id = `key`; default = `defaultKeyCode`; `w`/`h` in key units (1 if omitted). Full data in `layout.json`.

| Row (y px) | Keys (id:legend[:w/h]) |
|---|---|
| 0 (0) | 1:Esc @0 · 2:F1 @84 · 3:F2 · 4:F3 · 5:F4 @252 · 6:F5 @338 · 7:F6 · 8:F7 · 9:F8 @508 · 10:F9 @594 · 11:F10 · 12:F11 · 13:F12 @764 · 98:Ins @863 |
| 1 (68) | 14:`~ · 15:1 … 24:0 · 25:-_ · 26:=+ · 27:BackSpace w2.25 @728 · 99:Del @856 · 78:Num @922 · 79:/ · 80:* · 81:- @1091 |
| 2 (126) | 28:Tab w1.5 · 29:Q @85 … 38:P @589 · 39:{[ · 40:]} · 41:\| w1.75 @757 · 102:PgUp @856 · 92:7 @922 · 93:8 · 94:9 · 82:+ h2 @1092 |
| 3 (184) | 42:Caps w1.75 · 43:A @99 … 51:L @549 · 52:;: · 53:'" · 54:Enter w2.5 @722 · 103:PgDn @864 · 89:4 @930 · 90:5 · 91:6 |
| 4 (242) | 55:Shift w2.25 · 56:Z @127 … 65:/? @635 · 66:Shift w2 @693 · 74:↑ @806 · 101:End @864 · 86:1 @930 · 87:2 · 88:3 · 83:Enter h2 @1100 |
| 5 (300) | 67:Ctrl w1.25 · 68:Opt/Win w1.25 @70 · 69:Cmd/Alt w1.25 @140 · 70:Space w7 @210 · 71:Opt/Alt w1.25 @602 · 72:Fn w1.25 @672 · 76:← @785 · 75:↓ @843 · 77:→ @900 · 85:0 w2.15 @967 · 84:. @1088 |

Default keycodes are the plain HID usages (`Esc` 41 … ) except: 55 = `0x00020000` (LShift), 66 = `0x00200000` (RShift), 67 = `0x00010000` (LCtrl), 68 = `0x00080000` (LWin), 69 = `0x00040000` (LAlt), 71 = `0x00400000` (RAlt), 72 = `0x0D000000` (FN). Key 70 (Space) is flagged `isSplittableSpace`. There is **no Right Ctrl (73), Home (100), PrtSc/ScrLk/Pause (95–97), Menu (104)** on the US board; those ids exist only in `b9`/`Ru` as pickable labels.

### 6.4 `uk` (German ISO) differences — `layout-uk` 9282–9893

99 keys. Changes vs US: legends on the number/punctuation rows; 34 ↔ 56 legends swapped (Y/Z); 54 Enter becomes ISO L-shaped `{x 772, y 125, w 1.45, h 2.1, lShaped}` in row 2; 55 LShift `w 1.25`; new **105** `<|>` (HID `0x64`, x 70, row 4) and **111** `# ,` (HID `0x32`, x 718, row 3); 41 (`\|`) removed; 98 becomes "Entf" with default **`0x4C` Delete** and 99 becomes "Pos1" with default **`0x4A` Home**; 71 labelled "Alt Gr"; small x shifts (±1–8 px).

### 6.5 JP (JIS) differences — `layout-jp` 9894–10530

104 keys. Vs US: 14 "E/J"; 27 BackSpace narrowed to 1u at x 790 with new **112** `¥ |` (HID `0x31`, x 732); 54 ISO Enter as in uk; 41 and 71 removed; new **108** `- _` (HID `0x88` KanaMode slot, x 680, row 4), **106** 無変換 (`0x8B`, x 196), **107** 変換 (`0x8A`, x 437), **109** かな (`0x90`, x 494), **110** 英数 (`0x91`, x 550), **111** `] }` (`0x32`, x 718), **73** Ctrl (`0x00100000`, x 664) and **100** Home (`0x4A`, x 848); Space `w 3.25`; navigation column reordered (99 Del row 0, 100 Home row 1, 101 End row 2, 102 PgUp row 3, 103 PgDn row 4). `xu.jp` (10555) declares extra "still-default" codes: id 109 → `[0]`, 110 → `[0]`, 112 → `[0, 50, 135]` (the firmware may report `0`, `0x32` or `0x87` for these positions).

### 6.6 On-screen picker sections (`Z9`, 14566–14600)

The Basic tab's on-screen keyboard is defined separately by **keycode**, not id: section 1 = F-row (`41, 58–69`), section 2 = main block (with `9999` = 25 px spacer, `0` = gap, and a `specialSize` px width table: Backspace 106, Tab 78, `\|` 78, Space 314, Caps 93, Enter 118, LCtrl/LWin/LAlt/RCtrl/RAlt/RWin 60, LShift 118, RShift 146, Menu 60), section 3 = PrtSc…arrows, sections 4–5 = numpad. Because this is keyed by keycode it is **not** a physical layout and is not exported to `layout.json`.

---

## 7. Mac-mode defaults and Win-key lock

* `Wu` (13763–13805): the UI's assumed **Mac Normal-layer defaults** — F1 `0x02000070` (Brightness−), F2 `0x0200006F` (Brightness+), F3 `0x00010052` (Ctrl+↑ Mission Control), F4 `0x02000221` (Search/Spotlight), F5 `0x08030102` (main bright−), F6 `0x08030100` (main bright+), F7 Prev, F8 Play/Pause, F9 Next, F10 Mute, F11 Vol−, F12 Vol+, id 68 → `0x00040000` (Alt/Option at the Win position), id 69 → `0x00080000` (Win/Cmd at the Alt position), id 71 → `0x00800000` (RWin/Cmd). `mi(id, fallback)` substitutes these when computing "is this key still default" on layer 0 / MacOS (14127, `V9` 13860).
* `Bu = {227, 231, 0x00080000, 0x00800000}` (13762) identifies Win/GUI keys; `Vu`/`H9` = ids 68, 69, 71. The settings page's **Mac Win-key lock** (index-C54O2iUn.js 197–233) reads `getKeymaps(Normal, MacOS, [68,69,71])`, backs up the entries whose keycode ∈ `Bu` to `localStorage["gravastar:mac-win-lock-keymap-backup:v1:…"]`, and writes keycode **`0` (blank)** to them with `setKeymaps`; unlocking restores the backup. (Windows-side Win-lock uses the separate `0x04`/`0x84` param `0x15` config command, 2517–2524.)

---

## 8. Constants adjacent to keymap code (for orientation)

* `i0 = {Normal 0, Modifier 1, Mouse 2, MouseX 3, MouseY 4, MouseWheel 5}` (328–334) and `Cr = {Left 1, Wheel 4, Right 2, Back 8, Forward 16}` (350–356) are macro-action constants, not keycode types.
* Bubble command ids `{0xFE, 0x98, 0x94}` (779): `0xFE` param 7/9 = system/profile change; `0x98` key-travel monitor and `0x94` calibration both report **key ids** (6-byte records `id u16, distance u16, ad u16`), which is what `0xA5` is used to place on screen.
* Host-managed sessions: inside the GS HUB shell the app adopts a host keyboard handle (`k98pro.compat.get-handle`, 14823–14835) and proxies only `advancedKey.*` through `keyboard.call` (`M9`, 7743–7754); keymap and profile commands run on the adopted handle directly.

---

## Open questions

1. `I2` reset-type enum: values are 0–3 but which of `FullReset`/`KeyReset`/`LightReset`/`USBReset` is which is UNVERIFIED (obfuscated string pool).
2. Profile enum name→value (`Default`=0, `Onboard1`=1, `Onboard2`=2 assumed from declaration order) is UNVERIFIED; the firmware keycodes `0xF205`–`0xF208` suggest 4 profiles while the UI exposes 3.
3. Layer value 3 (`fn3`) exists in enums, state and keycode `0xF103` but the UI never selects it — firmware behaviour of layer 3 UNVERIFIED.
4. Semantics of `0x0D000000` "FN" vs `0x0D010000` "Fn1" (momentary vs. toggle; which layer each activates) are not stated in code.
5. Rapid-fire (`0x10`) and macro-generator (`0x03 | e<<16 | r<<8 | t`) encodings have no UI callers; firmware acceptance UNVERIFIED.
6. Special-key/knob commands `0xA2`/`0x22` are library-only; whether the K98 Pro hardware has an encoder is UNVERIFIED.
7. Electrical matrix row/col for each id is only obtainable via `0xA5`; the bundle contains no static table. `layout.json` therefore omits matrix coordinates and any physical "group/section" field (the only section table, `Z9`, is keyed by keycode for the picker, not by key).
8. Whether the firmware tolerates a 6-byte keymap record split across two 56-byte packets (as `buildCommands` produces for >9 records) is UNVERIFIED; the UI's normal path writes one key per packet.
9. The `uk` variant is labelled with German legends; whether a true UK-ISO legend set exists in firmware (UUID `0x14000000000E`) is UNVERIFIED.
10. `E9` entry `0x5204` ("Direction RIGHT") declares `hex16 0x5208` — unclear which value the firmware expects.
