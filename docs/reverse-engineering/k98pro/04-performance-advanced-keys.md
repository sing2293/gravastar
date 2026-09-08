# K98 Pro — Hall-effect performance features and advanced keys

**Scope.** This document describes, from the deobfuscated GS HUB "K98 Pro" web-tool protocol library, everything the `IPerformanceService` (class `Ua`) and the advanced-key service (class `Na`) put on the wire: switch-type assignment, safe area (dead zone), per-key actuation travel, rapid trigger, the live key-travel monitoring stream, the switch calibration flow and its events, the ADC range query, and the seven advanced-key types (TGL, MT, DKS, SOCD, MPT, END, RS) including their encoders, parsers, deletion and enumeration. For each command it gives the command ID, the parameter byte, the exact 63-byte packet layout, units and ranges as far as the code establishes them, the enums involved, the request→response sequence with timeouts/retries (wired vs. 2.4G dongle), and what the shipped UI actually exposes. Everything below is derived from the code only; anything the code does not pin down is marked **UNVERIFIED**.

## Sources

All paths are under `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/`.

| File | Lines relied on | What |
|---|---|---|
| `deob/k98pro/index-Dk7Hs9bA.js` | 328-345 (`i0`, `Kt`), 389 (`_2` monitor enum), 395-407 (SOCD modes), 416-437 (DKS trigger enum), 445-467 (advanced-key type enum), 480, 490, 661, 697 (light/reset/system/event enums), 542-624 (byte helpers `br`, `Ma`, `D`, `Ue`, `ae`, `xo`), 706-764 (type guards, `p0`), 766-1067 (`Ha` codec), 1145-1318 (`Mo` HID queue), 1969-2243 (`Na` advanced keys), 2245-2376 (`Ua` performance), 2447-2455 (`zt` bitmap→indices), 2485-2680 (`za` config getters used for units/capabilities), 3672-4033 (`n3` framed dongle transport), 4034-4082 (`r3`, `s3` transport selection), 4083-4290 (`Q2` facade), 5050-5215 & 10625-11737 (keycap/keycode table `Ru`/`Eu`), 7352-7360 & 7460-7470 (`M3` event bridge), 7743-7755 (`M9` host-proxy for `advancedKey.*`), 8566 (`O2`/`A9` layer lists) | Protocol library |
| `gshub/k98pro-app/js/index-Dk7Hs9bA.js` (minified original) | string pool `sn` (decoder `l2`, offset 124), pools `yn`/`hn`/`gn` | Used only to mechanically decode obfuscated enum member names (`Start/Read/Stop`, `Normal/Fn1/Fn2/Tap`, `Windows/MacOS`, event names) |
| `deob/k98pro/index-BRA2_iJz.js` | 1-1139 | Advanced-key editors (SOCD / END / MT / TGL) and the Advanced Keys page |
| `deob/k98pro/higherKey-BkEGQ1Fs.js` | 1-182 | Advanced-key Pinia store (cache, host proxy) |
| `deob/k98pro/useCopyProfileConfig-BG7qTx_n.js` | 1-120, 160-180 | The only UI code that reads/writes key travel, rapid trigger, switch type and safe area (profile copy) |
| `deob/k98pro/index-B0AXfBBW.js` | 26-77, 236-290, 395-440, 1385-1470, 1626 | Vestigial "performance" store and the handlers for the monitor / calibration bubble events |
| `deob/k98pro/index-DIYnHvfa.js` | 20-80 | Key picker used by the advanced-key editors |
| `deob/k98pro/i18n-en.js` | 51-105, 180-201, 275-329, 455-561 | Labels / semantics |
| `deob/shell/index-Cm-TOe4o.js` | 5395-5525, 7795-7840 | Host-side copy of the same SDK and the `keyboard.call` proxy |

Notation: byte offsets are within the 63-byte report payload (report ID excluded). Hex IDs are given with decimal in parentheses. `u16`/`u32` are **big-endian**.

---

## 1. Packet framing shared by every command here

### 1.1 The 63-byte command packet (`Ha`, lines 766-906)

| Offset | Name (`Ea` const, lines 766-776) | Meaning |
|---|---|---|
| 0 | `commandIdIndex` | Command ID |
| 1 | `commandParamIndex` | Parameter byte. For layered commands this is the *layer/system* byte, see §1.3 |
| 2 | — | `0x00` by default (`buildCommands`, line 873). **Advanced-key writes overwrite it with the advanced-key type** (`buildAdvancedKeyCommands`, lines 885-891) |
| 3 | `totalPacketLengthIndex` | Number of packets in this command |
| 4 | `currentPacketIndex` | 0-based index of this packet |
| 5 | `lengthIndex` | Payload byte count in this packet (0..56) |
| 6..61 | payload | `validDataLength` = 63 − 6 − 1 = **56** bytes max (lines 781-787) |
| 62 | `checksumIndex` | Checksum, see below |

`encode(cmd, param = 0, data = [], chunk)` (line 791) → `buildCommands(cmd, param, Uint8Array(data), chunk ?? 56)` (lines 869-884): `total = max(ceil(len / chunk), 1)`; packet *l* = `[cmd, param, 0, total, l, sliceLen, ...slice]` written at offset 0 of a zero-filled 63-byte array, then checksummed.

**Checksum** (`calculateCrc`, lines 895-899): copy the packet, set byte 62 = 0, `sum = reportId + Σ bytes[0..62]`, `checksum = 255 − (sum mod 256)`. `reportId` is *not* a constant — it is the first output-report ID found in the HID collection at run time (`xo`, lines 608-624). Worked examples below therefore show the sum and the value for `reportId = 0` only as an illustration.

**Aligned chunk size** (`calculateAlignedDataSize(t, e)`, lines 900-902 → `Ma`, lines 559-567): `floor(56 / (e ?? t)) * t`. It is used so that a request of *n* IDs never produces a response that would overflow one 56-byte packet:

| Call | Chunk | Records per packet |
|---|---|---|
| `setKeySwitchType` → `(3)` | 54 | 18 keys |
| `getKeySwitchType` → `(2, 3)` | 36 | 18 ids (18 × 3-byte answers = 54) |
| `setSafeArea` → `(8)` | 56 | 7 keys |
| `getSafeArea` → `(2, 8)` | 14 | 7 ids |
| `setKeyTravel` → `(5)` | 55 | 11 keys |
| `getKeyTravel` → `(2, 5)` | 22 | 11 ids |
| `setRapidTriggers` → `(8)` | 56 | 7 keys |
| `getRapidTriggers` → `(2, 8)` | 14 | 7 ids |
| `monitorKeysKeyTravel` → `(6)` | 54 | code additionally caps at 9 ids |
| `getKeyAdRange` → `(2, 6)` | 18 | 9 ids |
| `getKeyMatrixPositions` → `(2, 2)` | 56 | 28 ids |
| advanced keys (no chunk arg) | 56 | one record; DKS with > 5 groups spans packets |

### 1.2 Responses, matching, decoding

* A response is accepted for the pending command only if bytes **0, 1, 3, 4** (command, param, total, index) are equal (`isValidResponse`, lines 844-868). Byte 2 is *not* compared — the advanced-key read uses it to carry the type (§4.6).
* `decode(views, lenOverride)` (lines 798-813): per response packet take `len = lenOverride ?? byte[5]`, slice bytes `[6, 6 + min(len, 56))`, and concatenate across packets in order.
* Multi-packet commands are sent packet by packet; each packet has its own response wait (`Mo.send`, lines 1208-1242, `processQueue`, 1261-1304).

### 1.3 Layer / system byte

`encodeLayerAndSystem(layer = Normal, system = Windows) = (layer & 3) | ((system & 7) << 2)` (line 903-905).

| Enum | Values (decoded from pool `yn` / `hn`) | Source |
|---|---|---|
| Layer `j` | `Normal = 0`, `Fn1 = 1`, `Fn2 = 2`, `Tap = 3` | lines 655-670 (names via minified pool `yn`, offset 271) |
| System `F` | `Windows = 0`, `MacOS = 1` | line 661 (pool `hn`, offset 290) |

So param byte = `0x00` Normal/Windows, `0x04` Normal/MacOS, `0x01` Fn1/Windows, `0x05` Fn1/MacOS, `0x06` Fn2/MacOS, …

### 1.4 Byte helpers

| Helper | Lines | Encoding |
|---|---|---|
| `D(n)` | 568-573, 591-593 | `[ (n & 0xFF00) >> 8, n & 0xFF ]` — u16 big-endian |
| `Ue(n)` | 574-600 | 4 bytes, most significant first (u32 big-endian; the deobfuscator garbled `& 255` into `* 255`, but every parser reads `t[k]<<24 \| t[k+1]<<16 \| t[k+2]<<8 \| t[k+3]`, lines 2131-2200, which fixes the intent) |
| `p0(id)` | 762-764 | valid advanced-key id ⇔ number, `> 0`, `< 2^32` |
| `zt(bytes)` | 2447-2455 | bitmap → list of set-bit indices (bit *b* of byte *k* → `8k + b`) |
| `ae(v, bit)` | 601-606 | `(v & (1 << bit)) !== 0` |

### 1.5 Transport differences (wired vs. 2.4G dongle)

`s3` (lines 4074-4082) picks the transport from the connect type: `Wireless8K` → `r3` (framed), otherwise plain `Mo`.

| | Wired (`Mo`, lines 1145-1318) | Dongle / "Wireless8K" (`r3` + `n3`, lines 3672-4072) |
|---|---|---|
| What is written | `device.sendReport(reportId, 63-byte packet)` | `reportId` byte is prepended to the 63-byte packet (64 bytes, `r3.doSend`, 4045-4048) and split into frames of **14** data bytes (`validDataSize = 20−1−4−1`, line 3728; `splitFrame`, 3931-3938) |
| Frame format | — | `[0x66, total\|(sync&4)<<5, current\|(sync&2)<<6, len\|(sync&1)<<7, data…, sum8]`, padded to 19 bytes (`buildFrame` 3927-3930, `fillPayload`); `sum8` = Σ bytes mod 256 (`calculateChecksum` 3988-3990); 3-bit sync counter increments per frame |
| Per-frame ACK | — | ACK = same 4 header bytes with length 0 + checksum (`buildAckFrame` 3991-3997); wait **100 ms**, up to **10** attempts (`t3`, lines 3672-3678) |
| Command timeout / retry | **1000 ms, retry 1** (2 attempts) — `s3` passes `{timeout: 1e3, retry: 1}` | **2000 ms, retry 3** (4 attempts) — `s3` passes `{timeout: 2e3}`, retry stays at `Mo` default 3 (line 1172-1177) |
| Failure | rejects `"命令超时"` (command timeout) | same, or `"帧 x/y 在 n 次尝试后失败"` from the frame layer |
| Unsolicited dongle report | n/a | 19-byte input report with byte0 = `0x0A` and byte4 = `0x02` ⇒ `DeviceDongleConnectChange`, data = `!!byte5` (`isDongleReport` 906-908, `handleDongleReportEvent` 829-834, `n3.handleInputReport` 3780-3800). Reports beginning with `0x08` are ignored (line 3782) |

Incoming frames are ACKed, re-assembled by (sync, index) and handed to `Mo.handleInputReport` (lines 1243-1260), which first checks `isBubbleResponse` (device-initiated, §3.5/§3.6) and otherwise matches the head of the command queue.

### 1.6 Host-managed session (GS HUB shell)

When the sub-app runs inside the shell (`window.$wujie.props.deviceBridge` + `activeDeviceId`), the store calls `bridge.invoke(deviceId, {type: "keyboard.call", payload: {path: "advancedKey.<method>", args: [arg]}})` (`M9`, lines 7743-7755; `higherKey-BkEGQ1Fs.js` 116-133, 149-152). The host walks `path` on its own `Q2` instance and applies the method (`shell/index-Cm-TOe4o.js` 7826-7834). Events are obtained by adopting the host's keyboard handle (`k98pro.compat.get-handle`, lines 7385-7390) and attaching the same listeners, so bubble events (§3.5, §3.6) originate from the host's transport.

---

## 2. Enumerations used by these services

### 2.1 Advanced-key type `W` (lines 445-467) — also written into packet byte 2

| Name | Value | Offered by UI? |
|---|---|---|
| `NONE` | `0x00` (0) | used for delete |
| `TGL` | `0x01` (1) | yes |
| `MT` | `0x02` (2) | yes |
| `DKS` | `0x03` (3) | SDK only |
| `SOCD` | `0x04` (4) | yes |
| `MPT` | `0x05` (5) | SDK only |
| `END` | `0x06` (6) | yes |
| `RS` | `0x07` (7) | SDK only |

`getSupportedAdvancedKeyTypes()` (lines 2529-2541) sends `0x82 (130)` param `0x04`, decodes **32** bytes, drops byte 0, converts bytes 1..31 to a bit list with `zt`, and maps bit **0→TGL, 1→MT, 2→DKS, 3→SOCD, 4→MPT, 5→END, 6→RS** (note: bit numbering ≠ type value).

### 2.2 SOCD response mode `vr` (lines 395-407)

| Name | Value | UI label (`i18n-en.js` 544-561) |
|---|---|---|
| `CancelAll` | 0 | "Neutral" — when both keys are active neither is triggered |
| `LastPressWins` | 1 | "Last Input Priority" (UI default) |
| `FirstPressWins` | 2 | not offered |
| `FixedFirst` | 3 | "Key 1 Always Wins" |
| `FixedSecond` | 4 | "Key 2 Always Wins" |
| `AllActive` | 63 (`0x3F`) | not offered |

### 2.3 DKS per-stage trigger `j2` (lines 416-437)

| Name | Value |
|---|---|
| `None` | 0 |
| `ContinuousTriggerDuring` | 4 |
| `ContinuousTriggerStart` | 6 |
| `InstantTrigger` | 10 |
| `ContinuousTriggerEnd` | 12 |
| `ContinuousTriggerStartAndEnd` | 14 |

Semantics beyond the names are not in the code (**UNVERIFIED**); the marketing dialog (`i18n-en.js` 275-281) describes the four DKS stages as *press*, *bottom-out*, *release point*, *fully up*.

### 2.4 Key-travel monitoring sub-command `_2` (line 389, names decoded from pool `sn`)

| Name | Value |
|---|---|
| `Start` | 0 |
| `Read` | 1 (device→host stream marker) |
| `Stop` | 2 |

### 2.5 Other enums referenced

| Enum | Values | Lines |
|---|---|---|
| Switch trigger stage `m0` | `Normal = 0`, `TwoStage = 2` | 330-332, used by `getDeviceFeatures` byte 12 bits 0-2 (line 2680) |
| Keyboard type `q2` | `Magnetic = "magnetic"`, `Mechanical = "mechanical"` | 328 |
| Events `Q` | `KeyTravelMonitor = "key-travel-monitor"`, `KeyCalibration = "key-calibration"` | 686-697; re-exported as `D3.KEY_TRAVEL_MONITOR` / `KEY_CALIBRATION` line 7807 |

### 2.6 Key IDs and 32-bit keycodes

* **Key id** = 1-based physical position from the keycap table `Ru` (line 10625 ff.): `Esc = 1`, `F1 = 2`, …, `CapsLock = 42`, `A = 43`, `S = 44`, `Space = 70`. The UI takes it from `keyLayoutStyle[row][col].id` (`index-BRA2_iJz.js` ~800-812).
* **Keycode** (u32): low byte = HID usage (`A = 4`, `S = 22`, `Space = 44`, `Esc = 41`, `F1 = 58`); modifiers are single bits: `LCtrl = 1<<16 (65536)`, `LShift = 1<<17`, `LAlt = 1<<18`, `LWin = 1<<19`, `RCtrl = 1<<20`, `RShift = 1<<21`, `RAlt = 1<<22`, `RWin = 1<<23` (table lines 5114-5210); macro keycodes use `3 << 24 | …` (`generateMacroKeycode`, line 1065). The advanced-key editors only allow keycodes present in the visual key picker (`index-DIYnHvfa.js` 55-75, "basic keys only" messages `i18n-en.js` 500-519).

---

## 3. Performance service `Ua` (`IPerformanceService`, lines 2245-2376)

Facade: `keyboard.performance` (`Q2`, line 4152). Services register in `Q2.registerServices` (line 4093-4130).

### 3.1 Command summary

| Function | Cmd | Param | Payload (request) | Response record | Lines |
|---|---|---|---|---|---|
| `setKeySwitchType([{id, switchType}])` | `0x15` (21) | `0x00` | per key `id u16, switchType u8` (3 B) | ack only | 2249-2252 |
| `getKeySwitchType(ids)` | `0x95` (149) | `0x00` | `id u16` × n | `id u16, switchType u8` (3 B) | 2253-2260 |
| `setSafeArea([{id, topHeight, bottomHeight, enable}])` | `0x16` (22) | `0x00` | per key `id u16, top u16, bottom u16, 0x00, enable u8` (8 B) | ack only | 2261-2264 |
| `getSafeArea(ids)` | `0x96` (150) | `0x00` | `id u16` × n | `id u16, top u16, bottom u16, x, enable u8` (8 B; byte 6 ignored, byte 7 ≠ 0 ⇒ enabled) | 2265-2277 |
| `setKeyTravel({layer, system, travels:[{id, travel}]})` | `0x13` (19) | layer/system | per key `id u16, travel u16, 0x00` (5 B) | ack only | 2278-2281 |
| `getKeyTravel({layer, system, ids})` | `0x93` (147) | layer/system | `id u16` × n | `id u16, travel u16, x` (5 B; byte 4 ignored) | 2282-2289 |
| `setRapidTriggers({layer, system, rapidTriggers:[{id, enable, sensitivity:{press, release}}]})` | `0x19` (25) | layer/system | per key `id u16, enable u8, press u16, release u16, 0x00` (8 B) | ack only | 2290-2293 |
| `getRapidTriggers({layer, system, ids})` | `0x99` (153) | layer/system | `id u16` × n | `id u16, enable u8 (==1), press u16, release u16, x` (8 B) | 2294-2307 |
| `startKeyTravelMonitoring()` | `0x98` (152) | `0x00` Start | empty | (stream, §3.5) | 2317-2328 |
| `monitorKeysKeyTravel(ids)` | `0x98` (152) | `0x00` Start | `id u16` × n, n ≤ 9 | (stream) | 2329-2336 |
| `stopKeyTravelMonitoring()` | `0x98` (152) | `0x02` Stop | empty | ack only | 2337-2345 |
| `startCalibration()` | `0x94` (148) | `0x00` | empty | (stream, §3.6) | 2346-2357 |
| `stopCalibration()` | `0x94` (148) | `0x04` | empty | ack only | 2358-2362 |
| `getKeyAdRange(ids)` | `0x94` (148) | `0x05` | `id u16` × n | `id u16, max u16, min u16` (6 B) | 2363-2372 |

"ack only": the SDK still waits for a response packet matching bytes 0/1/3/4 (§1.2); whether the firmware echoes those packets is firmware behaviour, not visible in the code (**UNVERIFIED** but implied, otherwise every setter would time out).

Related config-service commands (class `za`) that define capabilities/units for the above:

| Function | Cmd / Param | Decoded | Lines |
|---|---|---|---|
| `getSupportedSwitches()` | `0x82` (130) / `0x03` | 32-byte bitmap → list of switch-type indices (`zt`) | 2525-2528 |
| `getKeyboardType()` | — | `Magnetic` if that list is non-empty else `Mechanical` | 2595-2601 |
| `getTravelPrecision()` | `0x82` / `0x08` | 1 byte | 2551-2554 |
| `getMinRapidTrigger()` | `0x82` / `0x06` | 1 byte | 2555-2558 |
| `getAdaptiveCalibration()` / `setAdaptiveCalibration(bool)` | `0x84` (132) / `0x19` (25) read, `0x04` (4) / `0x19` write, 1 byte (1 = on) | | 2489-2500 |
| `getKeyMatrixPositions(ids)` | `0xA5` (165) / `0x00`, `id u16` × n | 2 bytes per id: `[col, row]` (row = byte+1, col = byte+0) | 2542-2550 |
| `getDeviceFeatures()` | `0x82` / `0x0F`, 56 bytes | byte 12: bit 7 `switchMixing`, bits 0-2 `switchTriggerStage` (2 = `TwoStage`) | 2660-2681 |

### 3.2 Units and ranges (what the code establishes)

| Quantity | Width | Evidence | Status |
|---|---|---|---|
| `travel` (actuation point), RT `press`/`release`, safe-area `topHeight`/`bottomHeight`, MPT `distance`, DKS `pressDepth.*`, monitor `distance` | u16 raw | The vestigial tooltip code converts the monitor `distance` with `distance / 1000 / drive_range_mm × 100 %` (`index-B0AXfBBW.js` 1406-1412) ⇒ **1 unit = 0.001 mm**; MPT clamps distance to **10..4000** (lines 2028-2042) ⇒ 0.01..4.00 mm; tooltips print travel values with an `mm` suffix (`index-B0AXfBBW.js` 1626) | Unit = 0.001 mm is **inferred**; firmware-side limits for travel/RT are not in this build (no slider UI). `getTravelPrecision` (1 byte) and `getMinRapidTrigger` (1 byte) exist for exactly that purpose but are **never consumed** by any UI or shell code in this build — their semantics are **UNVERIFIED** |
| `switchType` | u8 | Index into the `getSupportedSwitches` bitmap | Index→switch-name table is **not in the bundle** (the vestigial `getCurrentAxisGroup` "GATERON/TTC/other" list, `index-B0AXfBBW.js` 33-45, is cosmetic) — **UNVERIFIED** |
| `enable` | u8 | `1`/`0` on write; on read RT uses `=== 1`, safe area uses `!== 0` | — |
| `ad` (calibration / monitor) | 15 bits | ADC sample; bit 15 is the press flag | — |
| `min`, `max` (`getKeyAdRange`) | u16 | ADC range per key | — |

There is **no separate "reset point" command**: the only release-side parameter is the rapid-trigger `release` sensitivity; the safe area supplies top/bottom dead zones.

### 3.3 Detailed layouts

**`setKeySwitchType`** (`0x15`, param 0): payload = concat of `[id_hi, id_lo, switchType]`; up to 18 keys per packet. Response is decoded only for `get` (`0x95`): 3 bytes per key.

**`setSafeArea`** (`0x16`, param 0), 8 bytes per key:

| Off | Field |
|---|---|
| 0-1 | `id` u16 |
| 2-3 | `topHeight` u16 |
| 4-5 | `bottomHeight` u16 |
| 6 | `0x00` (reserved) |
| 7 | `enable` (1/0) |

`getSafeArea` (`0x96`) answers with the same 8-byte record; byte 6 is ignored, byte 7 non-zero ⇒ `enable: true`.

**`setKeyTravel`** (`0x13`, param = layer/system), 5 bytes per key: `id u16, travel u16, 0x00`. `getKeyTravel` (`0x93`) returns 5-byte records, the last byte ignored.

**`setRapidTriggers`** (`0x19`, param = layer/system), 8 bytes per key:

| Off | Field |
|---|---|
| 0-1 | `id` u16 |
| 2 | `enable` (1/0) |
| 3-4 | `sensitivity.press` u16 |
| 5-6 | `sensitivity.release` u16 |
| 7 | `0x00` (reserved) |

`getRapidTriggers` (`0x99`) → `parseRapidTrigger` (lines 2299-2309): `enable = byte2 === 1`, `press = b3<<8|b4`, `release = b5<<8|b6`, byte 7 ignored. Note `getRapidTriggers` does **not** default layer/system (line 2295) — callers must pass both.

### 3.4 Worked examples (reportId shown as 0)

*Set actuation of key 43 (A) on Normal/Windows to 1500 (= 1.50 mm if the 0.001 mm inference holds)*

```
13 00 00 01 00 05 | 00 2B 05 DC 00 | 00×51 | DA
sum(bytes 0..61) = 0x13+0x01+0x05+0x2B+0x05+0xDC = 293 → 293 mod 256 = 37 → 255−37 = 0xDA (+reportId adjusts)
```

*Enable rapid trigger on key 43, press 300 / release 300, Fn1/MacOS (param = 1 | 1<<2 = 0x05)*

```
19 05 00 01 00 08 | 00 2B 01 01 2C 01 2C 00 | 00×48 | 52
sum = 25+5+1+8 + (43+1+1+44+1+44) = 173 → 255−173 = 0x52
```

*Read switch types of keys 1..3*

```
95 00 00 01 00 06 | 00 01 00 02 00 03 | … 
→ response 95 00 00 01 00 09 | 00 01 tt 00 02 tt 00 03 tt | …
```

*Read ADC ranges of key 43*

```
94 05 00 01 00 02 | 00 2B | …  → 94 05 00 01 00 06 | 00 2B  MAXhi MAXlo  MINhi MINlo | …
```

### 3.5 Key-travel monitoring stream (`0x98`)

Flow (lines 2310-2345, codec 814-843, 1013-1031):

1. `startKeyTravelMonitoring()` sends `[0x98, 0x00 (Start), 0, 1, 0, 0, …]` immediately and then **every 1000 ms** (`setInterval`, line 2325) as a keep-alive, until `stopKeyTravelMonitoring()`.
2. Optionally `monitorKeysKeyTravel(ids)` sends `[0x98, 0x00, 0, 1, 0, 2n, id…]` to select up to **9** keys (extra ids are silently dropped, line 2332); chunk 54.
3. The device streams packets with **param = `0x01` (Read)**. `isBubbleResponse` (line 821) treats any `0x98` packet whose byte 1 is `Read` as device-initiated; it never reaches the command queue.
4. `onKeyTravelMonitor` decodes byte-5 length bytes as 6-byte records:

| Off | Field |
|---|---|
| 0-1 | `id` u16 |
| 2-3 | `distance` u16 (current travel, raw) |
| 4-5 | `ad` u16: bit 15 = `press`, bits 0-14 = ADC value (`& 0x7FFF`) |

   and emits `KeyTravelMonitor` (`"key-travel-monitor"`) with `[{id, distance, ad, press}]`.
5. `stopKeyTravelMonitoring()` clears the interval and sends `[0x98, 0x02 (Stop), 0, 1, 0, 0, …]`.

Example stream packet for keys 43 (pressed, 1.2 mm, ADC 0x0345) and 44 (up):

```
98 01 00 01 00 0C | 00 2B 04 B0 83 45 | 00 2C 00 00 02 10 | …
                     id=43 dist=1200 ad=0x8345 → press=1, ad=0x0345
                                          id=44 dist=0 ad=0x0210 → press=0
```

Consumer: `M3.registerKeyboardEvents` re-emits the event (lines 7460-7470); the device page handler (`index-B0AXfBBW.js` 279-282, debounced 16 ms at 395) maps ids to layout cells via `getKeyMatrixPositions` (`0xA5`) and stores `performance.travels = distance`, `performance.calibrationData = ad`.

### 3.6 Calibration flow (`0x94`)

Lines 2346-2372, codec 823/841, 1032-1064:

1. `startCalibration()` sends `[0x94, 0x00, 0, 1, 0, 0, …]` immediately and then **every 1000 ms** (`calibrationTimer`).
2. While calibrating, the device pushes packets with **param = `0x02`** (bubble test line 823: `i === 2`). `onKeyCalibration` parses 6-byte records:

| Off | Field |
|---|---|
| 0-1 | `id` u16 |
| 2-3 | `ad` u16: bit 15 = `press`; `ad & 0x7FFF` = ADC sample; `finished = !(bit 15)` (line 1052: finished is simply "not pressed") |
| 4-5 | `min` u16 (current calibrated minimum ADC for that key) |

   Event `KeyCalibration` (`"key-calibration"`) with `[{id, ad, min, press, finished}]`.
3. `stopCalibration()` clears the timer and sends `[0x94, 0x04, …]`.
4. `getKeyAdRange(ids)` (`[0x94, 0x05, …, id u16 × n]`, ≤ 9 ids/packet) is a normal request/response: 6 bytes per id → `{id, max, min}`.
5. UI side (`index-B0AXfBBW.js` 283-286, 423, 1389-1404): each key carries `performance.calibrate` ∈ {0 "Not calibrated", 1 "Calibrated", 2 "New Calibration"}; a `finished` record sets it to 2. `keyboardCalibrateTip`: "Turn on keyboard calibration, then press each key to calibrate it" (`i18n-en.js` 180).

`Ua.destroy()` (line 2373) clears both timers; it runs when the keyboard instance is destroyed.

Related but outside this service: keycode `0xF203` (61955) is labelled "Calibrate Switches (hold to activate)" (`i18n-en.js` 251) — an on-keyboard calibration trigger belonging to the keymap document; `setAdaptiveCalibration` (§3.1) toggles firmware-side adaptive calibration.

### 3.7 What the shipped K98 Pro UI does with §3

* The device page routes are `lighting, screen, customKey, highLevelKey, macro, config, other` (line 155) — there is **no performance page** in this build. The "performance" Pinia store (`index-B0AXfBBW.js` 26-77) and its tab names (`triggerSetting`, `deadZoneSetting`, `axisSettingTab`, `calibrationSetting`, `travelTest`) are vestigial and never call the SDK.
* The only live callers are the profile-copy composables (`useCopyProfileConfig-BG7qTx_n.js`): they read `getKeyTravel` and `getRapidTriggers` for layers `[Normal, Fn1, Fn2]` × systems `[Windows, MacOS]` (`O2`, line 8566; `E()` lines 27-40), `getKeySwitchType` and `getSafeArea` for every layout id (lines 88-104), and write them back with the same setters (lines 166-178) — three layer/system pairs concurrently.
* The monitor/calibration event handlers are wired (`index-B0AXfBBW.js` 413) but nothing in this build starts monitoring or calibration.

---

## 4. Advanced keys `Na` (lines 1969-2243)

Facade: `keyboard.advancedKey` (`Q2`, line 4149). All writes use **command `0x12` (18)**, param = layer/system byte, and put the **type in packet byte 2** (`buildAdvancedKeyCommands`, lines 885-891, re-checksummed). All reads use **command `0x92` (146)**.

### 4.1 Write layouts (payload after the 6-byte header)

| Type (byte 2) | Payload | Bytes | Lines |
|---|---|---|---|
| `NONE 0x00` (delete) | `id u16` | 2 | 1973-1976 |
| `TGL 0x01` | `id u16, keycode u32, delay u16` | 8 | 2002-2005 |
| `MT 0x02` | `id u16, holdKeycode u32, clickKeycode u32, delay u16` (**hold first**) | 12 | 2006-2009 |
| `DKS 0x03` | `id u16, pressDepth.start u16, .bottom u16, .bottomRelease u16, .fullRelease u16, then per group: keycode u32, trig.start u8, trig.bottom u8, trig.bottomRelease u8, trig.fullRelease u8` | 10 + 8·groups | 2010-2017 |
| `SOCD 0x04` | `count u8, id u16 × count, responseMode u8` | 2 + 2·count | 2018-2027 |
| `MPT 0x05` | `id u16, count u8, per group: keycode u32, distance u16` | 3 + 6·count | 2028-2042 |
| `END 0x06` | `id u16, keycode u32` | 6 | 2043-2050 |
| `RS 0x07` | `idA u16, idB u16` | 4 | 2051-2058 |

Validation in the SDK: `setAdvancedKey` (lines 2203-2243) requires every id to pass `p0` (1..2^32−1) and dispatches by `type`; `setSOCD` throws on an empty id list (`responseMode` defaults to `0` = CancelAll); `setRS` requires exactly two valid ids; `setMPT` clamps each `distance` into **[10, 4000]**; DKS trigger fields default to `None` (0); the group count is *not* transmitted for DKS (the parser infers it from the payload length).

### 4.2 Delete

`deleteAdvancedKey(arg)` (lines 1977-2001): for `SOCD`/`RS` arguments (`ids`) it deletes **each id separately**; otherwise it needs `id`. Each deletion is `0x12` with byte 2 = `0x00` and payload `id u16`. The UI passes the full stored record plus layer/system (`index-BRA2_iJz.js` 929-936).

### 4.3 Enumerate ids — `getIdsOfAdvancedKey({layer, system}, total = 1, current = 0)` (lines 2059-2075)

Request `[0x92, layer/sys, 0x00, total, current, 0x00]` — note the code overwrites bytes 3 and 4 with its own paging counters and re-checksums. Response payload = `id u16` list. Paging: after the first reply, `total = ceil(byte[5] / 56)`; if `byte[4] + 1 < total` the function recurses with `current + 1`, concatenating ids. (Because `decode` caps at 56 bytes, this only works if the firmware reports the *overall* length in byte 5 of the first packet — **UNVERIFIED**.)

### 4.4 `getAdvancedKeys({layer, system})` (lines 2076-2096)

Defaults to Normal/Windows; calls §4.3 then §4.5 for every id (sequentially); drops `null` results (type `NONE`/unknown).

### 4.5 `getAdvancedKey({layer, system, id})` (lines 2097-2130)

Request `[0x92, layer/sys, 0, 1, 0, 2, id_hi, id_lo]`. Response: **byte 2 = type**, payload parsed by:

| Type | Parser | Fields (offsets in payload) | Lines |
|---|---|---|---|
| TGL | `parseTGL` | `id`[0-1], `keycode`[2-5], `delay`[6-7] | 2131-2137 |
| MT | `parseMT` | `id`[0-1], `holdKeycode`[2-5], `clickKeycode`[6-9], `delay`[10-11] | 2138-2145 |
| DKS | `parseDKS` | `id`[0-1], `pressDepth{start[2-3], bottom[4-5], bottomRelease[6-7], fullRelease[8-9]}`, groups from offset 10 in 8-byte steps: `keycode`[+0..3], `trigger{start[+4], bottom[+5], bottomRelease[+6], fullRelease[+7]}` | 2146-2170 |
| SOCD | `parseSOCD` | `count`[0], `ids` u16 × count from [1], `responseMode`[1 + 2·count] | 2171-2178 |
| MPT | `parseMPT` | `id`[0-1], `count`[2], groups from [3] in 6-byte steps: `keycode`[+0..3], `distance`[+4..5] | 2179-2191 |
| END | `parseEND` | `id`[0-1], `keycode`[2-5] | 2192-2197 |
| RS | `parseRS` | `ids = [[0-1], [2-3]]` | 2198-2202 |

The result is `{...parsed, type}`. **SOCD/RS records carry `ids` (no `id`); the others carry `id`.**

### 4.6 Semantics, units and UI-imposed ranges

| Type | Meaning (i18n) | Parameters the UI sets | Source |
|---|---|---|---|
| TGL "Toggle" | "Click to latch continuous triggering; hold for normal triggering" | `keycode` from picker; `delay` **fixed 200** | `index-BRA2_iJz.js` 578-646 (`delay: 200` at 642); `i18n-en.js` 538-541 |
| MT "Dual Action" | "One key, two functions — hold and click do different things"; `holdKeycode` fires on hold, `clickKeycode` on click | slider 0.10–4.00 s step 0.01, default 1.55 s; sent `delay = round(seconds × 100)` and displayed as `"{delay}ms"` ⇒ **delay in ms, 10..400, default 155** (the UI's own slider/label scale disagree by 10×; the wire value is what is listed) | `index-BRA2_iJz.js` 231-400 (`K(1.55)` at 243, slider `min: .1, max: 4, step: .01` at 376-378) |
| END "Release Trigger" | "A single key can send another key when released" | `keycode` only | `index-BRA2_iJz.js` 79-190 |
| SOCD | "When two keys are pressed together, instantly trigger the designated key based on your preset" | exactly **2 distinct ids**; `responseMode` ∈ {1, 3, 4, 0}, default `LastPressWins` | `index-BRA2_iJz.js` 411-500 (mode list at 419-435) |
| DKS "Dynamic Keystroke" | four pressure stages per key | no editor; SDK `pressDepth` u16 ×4 (raw travel units) + ≤ n groups | `i18n-en.js` 275-281 |
| MPT "Multi-Point Trigger" | "3 independent trigger depths … must increase" | no editor; SDK clamps `distance` to 10..4000 | `i18n-en.js` 95, 282-287 |
| RS "Rapid Snap" | "Monitors two selected keys and triggers whichever is pressed deeper; both bottomed out ⇒ both trigger" | no editor | `i18n-en.js` 320-324 |

Delay unit for TGL is not displayed anywhere; by analogy with MT it is milliseconds (**UNVERIFIED**).

Other UI constraints (`index-BRA2_iJz.js`): the page always writes to layer `Normal` (`b = ct.Normal`, line 796) with the system taken from global settings; a key already used by any configured advanced key cannot be chosen as a source (`occupiedKeyIds`, lines 123, 281, 459, 622); the configured list is de-duplicated for SOCD by sorted id pair and shows a **"N / 40"** counter (the 40 is a UI literal near line 1040; no firmware limit is read); after every write/delete the store cache is invalidated and `getAdvancedKeys` re-read. The store (`higherKey-BkEGQ1Fs.js`) caches per `${profile}:${layer}:${system}` and only ever enumerates layer `Normal` (`A9`, line 8566).

### 4.7 Worked examples (Normal/Windows ⇒ param `0x00`; reportId shown as 0)

*SOCD on A (43) and S (44), Last Input Priority*

```
12 00 04 01 00 06 | 02 00 2B 00 2C 01 | 00×50 | 88
sum = 18+4+1+6 + (2+43+44+1) = 119 → 0x88
```

*MT on A: hold = Left Ctrl (0x00010000), click = A (0x00000004), delay 155 ms*

```
12 00 02 01 00 0C | 00 2B  00 01 00 00  00 00 00 04  00 9B | 00×44 | 13
sum = 18+2+1+12 + (43+1+4+155) = 236 → 0x13
```

*TGL on A → A, delay 200*

```
12 00 01 01 00 08 | 00 2B  00 00 00 04  00 C8 | … | EC
sum = 18+1+1+8 + (43+4+200) = 275 → 275 mod 256 = 19 → 0xEC
```

*END on A → S (22)*

```
12 00 06 01 00 06 | 00 2B  00 00 00 16 | … | 9F      (sum 96)
```

*DKS on A: depths 500/3000/2500/300, one group: keycode A, InstantTrigger at "start"*

```
12 00 03 01 00 12 | 00 2B  01 F4  0B B8  09 C4  01 2C  00 00 00 04  0A 00 00 00 | … | EC
```

*MPT on A: (A at 1000), (S at 2500)*

```
12 00 05 01 00 0F | 00 2B 02  00 00 00 04 03 E8  00 00 00 16 09 C4 | …
```

*RS on A/S*

```
12 00 07 01 00 04 | 00 2B 00 2C | …
```

*Delete whatever is on key 43*

```
12 00 00 01 00 02 | 00 2B | … | BF      (sum 64)
```

*Read key 43 (an MT is stored)*

```
→ 92 00 00 01 00 02 | 00 2B | …
← 92 00 02 01 00 0C | 00 2B 00 01 00 00 00 00 00 04 00 9B | …
      ^^ byte 2 = 0x02 → parseMT → {id:43, holdKeycode:0x10000, clickKeycode:4, delay:155, type:2}
```

*Enumerate ids*

```
→ 92 00 00 01 00 00 | (empty) | …
← 92 00 00 01 00 04 | 00 2B 00 2C | …   → [43, 44]
```

### 4.8 Sequence for a UI write (SOCD editor → device)

1. `writeAdvancedKey({type: 4, ids: [43, 44], responseMode: 1})` → store `setAdvancedKey({...,layer: 0, system})` → local `Q2.advancedKey.setAdvancedKey` or host `keyboard.call advancedKey.setAdvancedKey`.
2. `setAdvancedKey` validates ids (`p0`), dispatches to `setSOCD`, builds the packet(s) with byte 2 = 4, `transport.send` (queue; wired 1000 ms × 2 attempts, dongle 2000 ms × 4 attempts + framed ACKs).
3. Success toast "SOCD written to device"; store cache invalidated; `getAdvancedKeys` → `getIdsOfAdvancedKey` (`0x92`, empty) then `getAdvancedKey` (`0x92`, id) per id.

---

## Open questions

1. **Travel unit.** The 0.001 mm interpretation of `travel`/`distance`/`press`/`release`/`topHeight`/`bottomHeight`/`pressDepth` rests on vestigial UI math (`distance / 1000 / drive_range_mm`) and the MPT clamp 10..4000; the bytes returned by `getTravelPrecision` (`0x82/0x08`) and `getMinRapidTrigger` (`0x82/0x06`) are never interpreted anywhere in this build. Firmware min/max for actuation and RT sensitivities are therefore unknown.
2. **Switch-type index mapping.** `switchType` is an index into the `getSupportedSwitches` bitmap; the index→switch model table is not in the K98 Pro bundle.
3. **Echo behaviour.** Every setter and the `Start`/`Stop` monitoring and `0x94/0x00`, `0x94/0x04` calibration commands wait for a response matching bytes 0/1/3/4. The firmware presumably echoes the header; not verifiable from JS.
4. **`getIdsOfAdvancedKey` paging** assumes byte 5 of the first reply holds the total length (> 56 possible); with the SDK's 56-byte cap this only works if the firmware reports the overall length there.
5. **DKS trigger values** (0/4/6/10/12/14) — names only; exact firmware behaviour of "continuous during/start/end" vs "instant" is not documented in code.
6. **TGL `delay` unit** (fixed 200) and **MT delay upper bound** — the MT editor shows a slider labelled in seconds (0.1–4) but transmits and prints `×100` as "ms"; whether firmware interprets the u16 as ms is not verifiable.
7. **SOCD id count.** The wire format allows `count` ids; the UI only ever sends 2. `AllActive (63)` and `FirstPressWins (2)` modes exist in the enum but are not offered.
8. **`keyboardType` inconsistency.** `Q2.getDeviceInfo()` reports `Magnetic` only for UUID prefixes `0x11`/`0x12` (`i3`, line 4060; `getDeviceInfo` 4167-4178), while the K98 Pro product UUID (`21990232555532` = `0x14000000000C`) starts with `0x14`; `getKeyboardType()` uses the switch bitmap instead. Which one the shell trusts for HE feature gating was not traced.
9. **Safe area semantics.** No UI or i18n string in this build names the safe-area fields; "dead zone" tab names in the vestigial store suggest press/release dead zones, but `topHeight`/`bottomHeight` orientation is unverified.
