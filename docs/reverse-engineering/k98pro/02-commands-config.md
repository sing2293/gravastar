# K98 Pro — Command Codec and Config/Base Command Reference

**Scope.** This document describes, from the deobfuscated GS HUB "k98pro-app" protocol library only, (1) the 63-byte command packet codec (class `Ha`, config `Ea`): byte layout, multi-packet splitting, checksum, `encodeLayerAndSystem`, `decode()`, request/response matching, and device-initiated ("bubble") notifications (0xFE / 0x98 / 0x94 and the dongle report); (2) the two transports the codec rides on (wired `Mo` send-queue with timeouts/retries, and the wireless-8K framed transport `n3`/`r3` with 0x66 header, sync flags, ACKs and 8-bit sum checksum); and (3) a complete command reference for the config/base service (class `za`), the reset service (`Ga`) and the `Keyboard` facade (`Q2`) methods that wrap them, with every command ID, param byte, payload/response layout, enum and unit. Everything is cited to file + line; anything not directly confirmed by code is marked **UNVERIFIED**. Values are given as hex (decimal).

## Sources

All paths are under `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/`. `LIB` = `deob/k98pro/index-Dk7Hs9bA.js` (deobfuscated protocol library, 14 842 lines).

| File | Lines | What |
|---|---|---|
| `LIB` | 314–499 | module-level enums (polling rate `_`, Start/Read/Stop `_2`, profiles `we`, debounce mode `Ot`, advanced-key types `W`, lighting type `Ce`, reset type `I2`, keyboard type `q2`, switch trigger stage `m0`) |
| `LIB` | 542–609 | byte helpers `br`, `Ma`, `Sa`, `Ia`, `Da`, `D`, `Ue`, `ae`, report-ID picker `xo` |
| `LIB` | 661, 673, 697 | enums `F` (system), `j` (layer), `Q` (event names) |
| `LIB` | 756–764 | `bo` (battery flag decode), `p0` (valid key id) |
| `LIB` | 766–1068 | `Ea` codec config and class `Ha` (codec) |
| `LIB` | 1145–1319 | class `Mo` (WebHID wrapper, send queue, `waitForResponse`) |
| `LIB` | 2245–2378 | class `Ua` (performance) — only the 0x98 / 0x94 request side is used here |
| `LIB` | 2378–2413 | class `ja` (profiles) — cited only for the `0x90/0x10/0x9A/0x1A` IDs in the inventory |
| `LIB` | 2414–2446 | class `Ga` (reset service, incl. `resetUSB`) |
| `LIB` | 2447–2454 | `zt` (bitmap → index list) |
| `LIB` | 2456–2483 | class `Za` (firmware version) |
| `LIB` | 2485–2686 | class `za` (`IBaseService`, config/base commands) |
| `LIB` | 3025–3049, 3193–3216, 3236 | lighting/display users of the shared 0x84/0x04/0x82 param space (`Tr`, `qa`) |
| `LIB` | 3650–3671 | connect-type enum `_e` |
| `LIB` | 3672–4033 | `t3` options and class `n3` (wireless-8K framed transport) |
| `LIB` | 4034–4053 | class `r3` (framed-transport-backed `Mo`) |
| `LIB` | 4054–4082 | uuid-prefix helpers `o3/x0/i3/Do/a3/_o`, transport factory `s3` |
| `LIB` | 4083–4283 | class `Q2` (`Keyboard` facade) |
| `LIB` | 5666–5796 | HID filter const `At` (5666), wireless PID set `h3` (5673), class `Rr` (5674), class `D2` (5702; `isWireless8K` 5788) (device detector) |
| `LIB` | 7360–7404, 7460–7470, 7546–7552, 7708–7724 | `K3` forwarded events, class `M3` (manager: HID filters, `resolveConnectType`, event forwarding, host bridge) |
| `LIB` | 7950–7972, 14614–14644 | polling-rate label maps `Hr/E3/H3/Vo`, sleep-time option list `z9` |
| `deob/k98pro/globalSetting-CsPa239Q.js` | 1–165 | UI store: OS-mode mapping, polling-rate flow (+120 ms wait), `resetUSB` usage |
| `deob/k98pro/index-C54O2iUn.js` | 83–125, 169, 237–243, 289–306, 341 | "Other settings" page: debounce range/units, sleep options, win-lock verify flow |
| `deob/k98pro/useProfileConfigSync-DnqHfXZR.js` | 125–127 | naming of loaded values (`debounceUs`, `sleepSeconds`) |
| `deob/shell/index-Cm-TOe4o.js` | 7800–7838 | host-side `keyboard.call` / `k98pro.compat.get-handle` proxy |
| `gshub/k98pro-app/js/index-Dk7Hs9bA.js` | (original obfuscated) | used only to resolve string-table lookups that the deobfuscator left as `l2(n)`/`Nt(n)`/`Ut(n)`/`jt(n)`/`pn(n)`/`Yt(n)` calls (tables `sn`, `hn`, `yn`, `gn`, `fn`, `n1`), see §11 |

---

## 1. Stack overview

```
Q2 (Keyboard facade, LIB 4083)  ──►  service registry Xa (LIB 3497) ──► za / Ga / Ua / ja / ... services
        │
        ├── Ha  (codec: 63-byte packets, CRC)                    LIB 777
        └── transport = s3(connectType, hidDevice, codec)         LIB 4074-4082
               ├── connectType "wired"      → Mo(dev, codec, {timeout:1000, retry:1})
               └── connectType "wireless8K" → r3(dev, codec, {timeout:2000})  (retry default 3)
                                                └── n3 framed transport (0x66 frames, ACK, sync flag)
```

* `Q2` constructor (LIB 4088–4091): `connectType` defaults to `_e.Wired`; builds `new Ha(hidDevice)` then `s3(connectType, hidDevice, codec)`.
* `s3` (LIB 4074–4082): `Wireless8K` → `new r3(device, codec, {timeout: 2000})`; otherwise `new Mo(device, codec, {timeout: 1000, retry: 1})`.
* Connect type is decided from the HID product ID: `D2.isWireless8K(dev)` ⇔ `h3.has(dev.productId)` with `h3 = new Set([0x106C (4204)])` (LIB 5673, 5788–5790). `M3.resolveConnectType` (LIB 7400–7402) and `D2.getUuidByHidDevice` (LIB 5753–5758) both map that to `_e.Wireless8K`, else `_e.Wired`.
* HID filters (LIB 5666–5671, 7374): VID `0x372E` (14126), usagePage `0xFF60` (65376), usage `0x61` (97); PID `0x10E5` (4325) = wired, PID `0x106C` (4204) = 2.4G/"wireless" (`isWireless = true`). The host shell also labels `productId === 4204` as `"wireless"` (LIB 7551).
* `_e` connect-type enum (LIB 3663–3670, strings resolved from table `n1`): `Wired = "wired"`, `Wireless8K = "wireless8K"`, `Wireless = "wireless"`. Only `Wired` and `Wireless8K` are ever produced by the detectors.
* **Report ID** (`xo`, LIB 608–633; property names resolved from string table `fn` against the original bundle's `function xo`): pick the first `hidDevice.collections[]` entry that has both `inputReports.length` and `outputReports.length`, and use **that matched collection's** `outputReports[0].reportId`; throws `"No output report ID found"` otherwise. (The deobfuscated body renders this as `o.collections[0]…` — a garbling artefact; the original reads `o[pn(113)="outputReports"][0][pn(129)="reportId"]` on the matched entry.) The report ID is stored in `Ha.reportId` and is folded into the checksum (§4). **UNVERIFIED**: the numeric report ID value for the K98 Pro (never hard-coded; only ever taken from the HID descriptor).
* Every service is constructed with `(protocol, transport, hidDevice)` (LIB 3538) and calls `this.transport.send(packets)`; `Mo.send` returns an array of response `DataView`s, one per request packet (§6).

## 2. Packet layout (`Ea`, LIB 766–776)

`totalPacketSize: 63, headerLength: 6, tailLength: 1, commandIdIndex: 0, commandParamIndex: 1, totalPacketLengthIndex: 3, currentPacketIndex: 4, lengthIndex: 5, checksumIndex: 62`.

`validDataLength` = 63 − 6 − 1 = **56** bytes of payload per packet (LIB 781–787).

| Offset | Size | Field | Set by | Notes |
|---|---|---|---|---|
| 0 | 1 | `commandId` | `buildCommands` | e.g. `0x84` read setting, `0x04` write setting |
| 1 | 1 | `commandParam` | `buildCommands` | sub-command / setting index / layer+system byte |
| 2 | 1 | reserved | `buildCommands` writes **0** | overwritten by `buildMacroCommands` (low byte of the 16-bit byte offset `packetIndex*56`; its **high byte overwrites byte 1**, LIB 879–884) and `buildAdvancedKeyCommands` (advanced-key type index, LIB 885–890); both then recompute the checksum |
| 3 | 1 | `totalPackets` | `buildCommands` | number of packets in this command (≥ 1) |
| 4 | 1 | `currentPacket` | `buildCommands` | 0-based packet index |
| 5 | 1 | `length` | `buildCommands` | number of valid payload bytes in this packet (0…56) |
| 6…61 | 56 | payload | caller | zero-padded (fresh `Uint8Array(63)`) |
| 62 | 1 | checksum | `setChecksum` | see §4 |

The WebHID report ID is **not** part of these 63 bytes; `Mo.doSend` passes it separately to `device.sendReport(reportId, packet)` (LIB 1205–1207). In wireless-8K mode `r3.doSend` prepends it as byte 0 of a 64-byte buffer before framing (LIB 4046–4049).

## 3. `encode` / `buildCommands` — multi-packet rules

`Ha.encode(commandId, param = 0, payload = [], chunkSize?)` (LIB 791–797) → `buildCommands(commandId, param, br(payload), chunkSize || 56)`; `br` accepts `Uint8Array | ArrayBuffer | number[]` (LIB 542–556).

`buildCommands(id, param, data, chunk)` (LIB 869–878):

```
packets = max(ceil(data.length / chunk), 1)          // an empty payload still yields ONE packet
for l in 0..packets-1:
    start = l*chunk; end = min(start+chunk, data.length)
    pkt = Uint8Array(63)
    pkt[0..5] = [id, param, 0, packets, l, end-start]
    pkt[6..]  = data[start:end]
    setChecksum(pkt)
```

* Each packet repeats the same `commandId`/`param`; only bytes 3/4/5 and the payload differ.
* `chunkSize` is normally `validDataLength` (56) but services pass `protocol.calculateAlignedDataSize(recordSize[, requestRecordSize])` (LIB 900–902) = `Ma(56, t, e || t)` = `floor(56 / (e || t)) * t` (LIB 559–566) so that fixed-size records never straddle packets. Examples: `calculateAlignedDataSize(2, 2)` = 56; `(2, 6)` = 18 (nine 2-byte ids per packet, matching nine 6-byte reply records); `(6)` = 54.
* **Response side of a multi-packet command:** `Mo.send` queues every packet separately and waits for one response per packet (§6); `decode(array)` concatenates the per-packet payloads (§5).

## 4. Checksum (`setChecksum` / `calculateCrc`)

LIB 891–899:

```
calculateCrc(pkt):
    pkt[62] = 0
    sum = reportId + Σ pkt[0..62]        // 8-bit-agnostic integer sum, seeded with the HID report ID
    return 255 - (sum % 256)
setChecksum(pkt): pkt[62] = calculateCrc(copy of pkt)
```

* Despite the name it is not a CRC: it is `0xFF − ((reportId + Σ bytes[0..61]) mod 256)`, i.e. the byte that makes `(reportId + Σ bytes[0..62]) ≡ 0xFF (mod 256)`.
* The reduce is seeded with `this.reportId` (LIB 897), so the checksum depends on which HID report ID the device exposes.
* The codec never validates the checksum of incoming packets (`isValidResponse`, §5, checks header bytes only).

## 5. `decode()` and response matching

`Ha.decode(view | view[], expectedLength?)` (LIB 798–813):

* Single `DataView`: `len = expectedLength ?? view[5]`; returns `Uint8Array(view.buffer).slice(6, min(6 + len, 6 + 56))`. Passing `expectedLength` overrides the device's length byte (used e.g. `decode(r, 32)`, `decode(r, 56)`, `decode(r, 1)`).
* Array of `DataView`s (multi-packet reply): maps each packet through the same slice and concatenates in order.

`Ha.isValidResponse(requestPacket, responseView)` (LIB 844–868): the response is accepted for the pending request iff bytes **0 (commandId), 1 (commandParam), 3 (totalPackets), 4 (currentPacket)** are equal to the request's. Byte 2, length and checksum are ignored. Any non-matching, non-bubble packet is silently dropped (`Mo.handleInputReport`, LIB 1243–1253).

## 6. Wired transport: `Mo` send queue (LIB 1145–1319)

| Item | Value | Cite |
|---|---|---|
| Default options | `timeout: 500 ms, retry: 3, debug: false, reportId: null` (overridden per §1: wired 1000 ms / retry 1; wireless8K 2000 ms / retry 3) | 1173–1183, 4074–4082 |
| `send(packets, opts)` | each packet becomes a queue entry `{command, timeout, retry, waitResponse (default true), progress}`; returns `Promise.all` of per-packet responses (`DataView[]`) | 1208–1239 |
| `sendCommand(pkt)` | `send(pkt, {waitResponse:false})` — fire-and-forget | 1200–1204 |
| `processQueue` | serial; for `waitResponse` entries: `for o in 0..retry { armed = waitForResponse(timeout); await doSend(); if (await armed) break; }` → reject `Error("命令超时")` after the last attempt; a thrown `sendReport` rejects with `Error("发送命令失败")` after retries | 1261–1304 |
| `waitForResponse(ms)` | resolves `true` when the head entry's `resolve` is called by `handleInputReport`, `false` on `setTimeout(ms)` | 1305–1315 |
| Retry semantics | the *same* packet is re-sent up to `retry` additional times, so a wired command can be on the wire 2× (1+1) and a wireless-8K one 4× (1+3) | 1275–1290 |
| `progressCallback` | called with `(index+1)/count` per resolved packet, `0` on reject | 1214–1226 |
| `resetQueue` | rejects all pending with `Error("Queue was reset")` | 1254–1260 |
| Per-call overrides | `getUuid` uses `{retry: 0}` (LIB 2560–2562); LCD dynamic image writes swap `send` for a raw `sendReport` loop (`I9`, LIB 7769–7805, out of scope) | |

`handleInputReport(data)` (LIB 1243–1253): `if protocol.isBubbleResponse(data) → emit(protocol.handleBubbleResponse(data))`; else if queue non-empty and `isValidResponse(head.command, data)` → `head.resolve(data)`.

## 7. Wireless-8K framed transport (`n3`, LIB 3672–4033) and `r3` (LIB 4034–4053)

Used only when `connectType === "wireless8K"` (PID `0x106C`). Options `t3` (LIB 3672–3678): `timeout: 100 ms` (per-frame ACK wait), `retries: 10`, `maxByteSize: 20`, `maxPayloadLength: 64`. `validDataSize = 20 − 1 − 4 − 1 = 14` data bytes per frame; `maxPayloadSizePerPacket = 19` (LIB 3738–3743).

**Outbound:** `r3.doSend(pkt63)` builds `[reportId, ...pkt63]` (64 bytes) and calls `n3.send` (LIB 4046–4049). `n3.send` (LIB 3747–3779) throws if a send is already in flight ("上一次的数据包还未发送完成!") or if `len > 64`; splits into `ceil(64/14) = 5` frames; for each frame: `syncFlag = (syncFlag + 1) & 7`, `buildFrame(total, current(1-based), chunk)`, `sendAndWaitAck`.

Frame layout (`buildFrame`, LIB 3927–3930; `parseFrame`, LIB 3866–3877):

| Byte | Content |
|---|---|
| 0 | header `0x66` (102) |
| 1 | `total & 0x7F` ｜ `(syncFlag & 4) << 5` (sync bit2 → bit7) |
| 2 | `current & 0x7F` ｜ `(syncFlag & 2) << 6` (sync bit1 → bit7) |
| 3 | `len & 0x7F` ｜ `(syncFlag & 1) << 7` (sync bit0 → bit7) |
| 4 … 4+len−1 | data (≤ 14 bytes) |
| 4+len | checksum = `Σ bytes[0 .. 4+len−1] & 0xFF` (`calculateChecksum`, LIB 3988–3990) |

Frames are zero-padded to 19 bytes before `device.sendReport(reportId, frame)` (`fillPayload`, LIB 3959–3970; `sendReport`, LIB 3919–3926). `syncFlag` is recovered as `(b1&0x80)>>5 | (b2&0x80)>>6 | (b3&0x80)>>7` (LIB 3867).

**ACK:** an ACK frame is `[b0, b1, b2, b3 & 0x80, checksum(4 bytes)]` — i.e. the received header with `len = 0` (`buildAckFrame`, LIB 3991–3998; `isAckFrame`, LIB 3983–3987). `sendAndWaitAck` (LIB 3878–3911) keys the pending frame by `"sync-total-current"`, re-sends every `timeout` (100 ms) until an ACK with the same key arrives, and rejects after `retries` (10) attempts with `"帧 c/t 在 n 次尝试后失败"`. The receiver ACKs every valid data frame (`sendAckFrame`, LIB 3916–3918, 3794–3798).

**Inbound** (`handleInputReport`, LIB 3780–3820): drop if `byte0 === 0x08`; require `event.reportId === this.reportId` and `byte0 === 0x66` (`isRequestValid`, LIB 3850–3854) — otherwise, if `byte0 === 0x0A && byte4 === 2` the raw frame is forwarded to the business layer (dongle report, §8.4); ACK frames go to `handleAckFrame`; data frames must have `len > 0`, `1 ≤ current ≤ total` and a valid checksum (`isValidReceivedFrame`, LIB 3971–3982); a frame whose sync flag equals that of the last accepted frame is treated as a duplicate and dropped unless `current === 1`; a frame with `current === 1` always restarts reassembly (any partial buffer is discarded); frames must arrive in order (`current === received+1`) (LIB 3801–3818); when `current === total` the data areas (`extractFrameData`: bytes 4 … checksumIndex−1, LIB 3912–3915) are concatenated (`combinePackets`, LIB 3840–3849) and delivered as one `DataView` to `Mo.handleInputReport` → codec. **UNVERIFIED**: whether the device's reassembled reply starts with the report ID or directly with `commandId` (the codec reads `commandId` at offset 0 of the reassembled buffer, so the device is assumed to send the 63-byte packet without a report-ID byte, asymmetric with the outbound 64-byte payload).

## 8. Device-initiated ("bubble") responses

### 8.1 Detection (`isBubbleResponse`, LIB 814–826; `bubbleCommandIds = {0xFE, 0x98, 0x94}`, LIB 779)

| Condition | Result |
|---|---|
| `isDongleReport(view)`: `new Uint8Array(view.buffer).length === 19 && byte0 === 0x0A` — tests the *underlying buffer* length, not `view.byteLength` (LIB 906–908) | bubble (dongle report) |
| `byte0 === 0xFE` (254) | bubble, any param |
| `byte0 === 0x98` (152) and `byte1 === _2.Read (0x01)` | bubble (key-travel monitor push) |
| `byte0 === 0x94` (148) and `byte1 === 0x02` | bubble (calibration push) |
| otherwise | normal response |

`handleBubbleResponse` (LIB 833–843) dispatches to `handleDongleReportEvent`, `onCommonBubbleResponse`, `onKeyTravelMonitor`, `onKeyCalibration`; the returned `{event, data}` is emitted on the transport's `mitt` (LIB 1246–1248) and re-emitted by `M3.registerKeyboardEvents` for every name in `K3` (LIB 7360, 7460–7470).

Event names (`Q`, LIB 697, resolved from table `gn`; identical strings in `D3`/`L2`, LIB 7807): `KeyTravelMonitor = "key-travel-monitor"`, `KeyCalibration = "key-calibration"`, `ProfileChange = "profile-change"`, `SystemChange = "system-change"`, `BatteryChange = "battery-change"`, `DeviceDongleConnectChange = "device-dongle-connect-change"`, `LightingEffectChange = "lighting-effect-change"`.

### 8.2 `0xFE` common notifications (`onCommonBubbleResponse`, LIB 909–1012)

Bytes: `[0xFE, sub, a, b, c, d, ...]` (raw offsets; not routed through `decode`).

| byte1 `sub` | Event | Payload |
|---|---|---|
| `0x02` | `device-dongle-connect-change` | `data = !!byte2` (true = paired device connected to the dongle) |
| `0x05` | `battery-change` | `{ level: byte2 (0 if absent), charging: ((byte3 & 0xF0) >> 4) != 0, full: (byte3 & 0x0F) != 0 }` (`bo`, LIB 756–761) |
| `0x07` | `system-change` | `data = byte2` = OS mode (`F`: 0 Windows, 1 MacOS) |
| `0x09` | `profile-change` | `data = byte2` = profile index (`we`: 0 Default, 1 Onboard1, 2 Onboard2) |
| `0x0B` | `lighting-effect-change` | `c = byte2` (1…15), `d = byte3`. `changeType = ["effectId","brightness","speed","color","direction"][(c−1) % 5]`; `lightType = c < 6 ? Main(1) : c < 11 ? Side(2) : Logo(3)`. Data `{lightType, changeType, effectId|brightness|speed|direction: d}`; for `color`: `{colorIndex: d, color: {r: byte4, g: byte5, b: byte6}}` |
| other | (ignored) | |

Note the `c` numbering is the same 1…15 param space as the `0x84/0x04` lighting settings (`Tr`: Main=1, Side=6, Logo=11; `qa`: 2/7/12; LIB 3193–3216) — see §10.5.

### 8.3 `0x98` key-travel monitor (`onKeyTravelMonitor`, LIB 1013–1031)

Requires `byte1 === 0x01 (Read)`; payload via `decode(view)` (length byte honoured), parsed as 6-byte records:

| Rec. offset | Field |
|---|---|
| 0–1 | `id` (u16 BE) key id |
| 2–3 | `distance` (u16 BE) — current travel (raw device units; see `getTravelPrecision`, §10.2 — **UNVERIFIED** scale) |
| 4–5 | `ad` = u16 BE & `0x7FFF` (ADC value); `press = !!(bit15)` |

Event: `{event: "key-travel-monitor", data: [{id, distance, ad, press}, …]}`.

Request side (`Ua`, LIB 2313–2341): `encode(0x98, 0x00 Start)` re-sent every 1000 ms by `startKeyTravelMonitoring`; `monitorKeysKeyTravel(ids)` = `encode(0x98, 0x00, ids.flatMap(u16BE), calculateAlignedDataSize(6)=54)` with at most **9** ids (extra ids truncated, LIB 2331–2333); `stopKeyTravelMonitoring` = `encode(0x98, 0x02 Stop)`. Each of these is an ordinary command whose ACK is matched via `isValidResponse`; the *pushes* use param `0x01` so they are routed as bubbles instead.

### 8.4 `0x94` calibration (`onKeyCalibration`, LIB 1032–1064)

Requires `byte1 === 0x02`; payload via `decode(view)`, 6-byte records:

| Rec. offset | Field |
|---|---|
| 0–1 | `id` (u16 BE) |
| 2–3 | `ad` = u16 BE & `0x7FFF`; `press = (bit15 != 0)`; `finished = !(bit15)` |
| 4–5 | `min` (u16 BE) — minimum ADC captured so far |

Event: `{event: "key-calibration", data: [{id, ad, min, press, finished}, …]}`.

Request side (`Ua`, LIB 2342–2375): `startCalibration` → `encode(0x94, 0x00)` every 1000 ms; `stopCalibration` → `encode(0x94, 0x04)`; `getKeyAdRange(ids)` → `encode(0x94, 0x05, ids.flatMap(u16BE), calculateAlignedDataSize(2,6)=18)`, reply records `{id: u16, max: u16, min: u16}` (6 bytes each). Param `0x02` is reserved for the device push. Params `0x01`/`0x03`: **UNVERIFIED** (never sent).

### 8.5 Dongle report (`handleDongleReportEvent`, LIB 827–832)

A 19-byte input report whose `byte0 === 0x0A` (10). If `byte4 === 0x02` → `{event: "device-dongle-connect-change", data: !!byte5}`; any other `byte4` is ignored. In wireless-8K mode the framed transport passes such reports straight through to the codec even though they lack the `0x66` header (LIB 3782–3784). The host shell subscribes to the resulting `device-dongle-connect-change` event in `setKeyboard` for wireless devices and forwards it as a "wireless link change" (`e.on(Le.DeviceDongleConnectChange, r)` → `emitWirelessLinkChange(deviceId, connected)`, shell 7761–7765; `emitWirelessLinkChange` itself 7752–7760). Shell 7824 is a *different* path: it emits `connected = false` when a `device.status.read` battery poll throws on a wireless device. Meaning of bytes 1–3 and other `byte4` codes: **UNVERIFIED**.

## 9. `encodeLayerAndSystem` and byte helpers

* `encodeLayerAndSystem(layer = j.Normal, system = F.Windows)` = `(layer & 0x03) | ((system & 0x07) << 2)` (LIB 903–905). Layer `j` (LIB 673, table `yn`): `Normal = 0, Fn1 = 1, Fn2 = 2, Tap = 3`. System `F` (LIB 661, table `hn`): `Windows = 0, MacOS = 1`. Result examples: Windows/Normal = `0x00`, Windows/Fn1 = `0x01`, MacOS/Normal = `0x04`, MacOS/Fn2 = `0x06`. Used as the **param byte** of keymap / advanced-key / travel / rapid-trigger / reset commands (0x03, 0x83, 0x11, 0x12, 0x13, 0x92, 0x93, 0x19, 0x99).
* `D(n)` = `[(n & 0xFF00) >> 8, n & 0xFF]` — u16 big-endian (LIB 567–572, 591–593). `Ue(n)` = `Da(n, 4)` — u32 big-endian, bytes from `(n >> 24)&0xFF` down to `n & 0xFF` (LIB 573–600; the deobfuscated body is garbled, semantics confirmed in the original `Da`).
* `ae(n, bit)` = `(n & (1 << bit)) !== 0` (LIB 601–607).
* `zt(bytes)` (LIB 2447–2454): bitmap → ascending list of set-bit indices, index = `byteIndex*8 + bit` (LSB first).
* `p0(id)` (LIB 762–764): valid key id ⇔ number, `> 0`, `< 2^32`. Exposed as `Keyboard.utils.isValidId` (LIB 4161–4166).

## 10. Command reference — `za` (`IBaseService`), `Ga` (`IResetService`) and `Keyboard` (`Q2`)

Conventions: "Req" = `encode(id, param, payload[, chunk])`; "Resp" = bytes returned by `decode()` (payload starting at packet offset 6) unless noted. Unless a `retry`/timeout override is listed, the transport defaults from §1/§6 apply. All `Q2.xxx` methods (LIB 4181–4279) are one-line pass-throughs to the service methods below; `Q2.resetKeyboard`/`resetUSB` go to `Ga`.

### 10.1 Command IDs used by this area (verbatim numeric literals; no named enum exists for them)

| ID | Direction | Used as | Cite |
|---|---|---|---|
| `0x82` (130) | read | static device info, sub-selected by param | 2526, 2530, 2552, 2556, 2560, 2573, 2637, 2657, 2661 (+1832, 3070, 3236 elsewhere) |
| `0x84` (132) | read | settings, sub-selected by param | 2490, 2502, 2510, 2518, 2577, 2604, 2612, 2629, 2645, 2649 (+3025 lighting) |
| `0x04` (4) | write | settings, same param space as `0x84` | 2498, 2506, 2514, 2522, 2581, 2608, 2620, 2633, 2641, 2653 (+3039, 3047 lighting) |
| `0x87` (135) | read | battery status | 2585 |
| `0xA5` (165) | read | key matrix positions | 2543 |
| `0x11` (17) | write | reset | 2420 (also `Ba.resetKeymaps` 1369) |
| `0x90` (144) / `0x10` (16) | read / write | current profile | 2383, 2387 |
| `0x9A` (154) / `0x1A` (26) | read / write | profile name (param = profile index; write payload `[len, utf8…]`, len ≤ 55) | 2391, 2408 |
| `0x98` (152) | write + push | key-travel monitor (§8.3) | 2320, 2334, 2339 |
| `0x94` (148) | write/read + push | calibration (§8.4) | 2349, 2360, 2364 |
| `0xFE` (254) | push only | common notifications (§8.2) | 779, 912 |

Observed convention: read ID = write ID ｜ `0x80`. Pairs actually present as command IDs in `encode(<id>, …)` calls across the whole library (grep of LIB): 0x03↔0x83, 0x04↔0x84, 0x05↔0x85, 0x06↔0x86, 0x10↔0x90, 0x12↔0x92, 0x13↔0x93, 0x15↔0x95, 0x16↔0x96, 0x19↔0x99, 0x1A↔0x9A, 0x22↔0xA2. Unpaired: writes 0x08, 0x0B, 0x11, 0x23; reads 0x82, 0x87, 0x94, 0x98, 0xA1, 0xA5. (0x0C, 0x0D, 0x1F, 0x20 and their `|0x80` forms are **not** command IDs anywhere in the code — those values occur only as `0x82`/`0x84`/`0x04` *param* indices.) `0x82` therefore reads "device info `0x02`", but no `0x02` write exists in the code.

### 10.2 Static device info — command `0x82` (130)

| Method (`za` line / `Q2` line) | Req | Resp (after `decode`) | Value / range |
|---|---|---|---|
| `getUuid()` (2559 / 4181) | `encode(0x82, 0x01, [0,0,0,0,0,0])` — 6 zero bytes; `send(…, {retry: 0})` | all `length` bytes (expected 6) folded big-endian: `uuid = Σ byte[i] << 8*(len−1−i)` (BigInt → Number) | 48-bit id. `x0(uuid)` = `"0x" + hex.padStart(12,"0")` (4057). Prefix rules (4054–4073): `0x11`/`0x12` → magnetic (`i3`); `0x12` or `0x14`/`0x15`/`0x16` → tri-mode (`o3`); `0x16` → `maxPollingRate` 1000 else 8000 (`_o`). Registered K98 Pro product uuid `0x14000000000C` (21990232555532, LIB 7375). `Q2.readDeviceUUID(dev, {connectType})` (4084–4087) builds a temporary `Q2` just for this call |
| `getFirmwareVersion()` (2568 / 4184) | `encode(0x82, 0x02, [0,0])` | `[lo, hi]` → `raw = hi << 8 ｜ lo` → `new Za(raw)` | `Za` (2456–2483): `major = (raw >> 8) & 0xFF`, `minor = (raw >> 4) & 0x0F`, `subminor = raw & 0x0F`, `hex = "0x" + raw.toString(16).padStart(4,"0")`, `toString() = "major.minor.subminor"` (UI prefixes "V", LIB 7716–7723) |
| `getSupportedSwitches()` (2525 / 4217) | `encode(0x82, 0x03)` | `decode(r, 32)` → 32-byte bitmap → `zt()` → list of supported switch-type indices (0…255) | `getKeyboardType()` (2595–2602): `list.length > 0 ? q2.Magnetic : q2.Mechanical` (`q2`: `Magnetic="magnetic"`, `Mechanical="mechanical"`, LIB 317) |
| `getSupportedAdvancedKeyTypes()` (2529 / 4220) | `encode(0x82, 0x04)` | `decode(r, 32)`; **byte 0 is skipped**, bitmap of bytes 1…31 → `zt()`; result object keyed by `W`: `TGL(1): bit0, MT(2): bit1, DKS(3): bit2, SOCD(4): bit3, MPT(5): bit4, END(6): bit5, RS(7): bit6` | booleans per advanced-key type |
| `getMinRapidTrigger()` (2555 / 4226) | `encode(0x82, 0x06)` | `decode(r, 1)[0]` | u8, minimum rapid-trigger sensitivity in the same raw travel unit as `getTravelPrecision` (**UNVERIFIED** unit — not converted anywhere in this file) |
| `getTravelPrecision()` (2551 / 4229) | `encode(0x82, 0x08)` | `decode(r, 1)[0]` | u8. UI store default `rtPrecision: 1` (globalSetting 25) — **UNVERIFIED** semantics (likely 0.01 mm steps per unit; not confirmed in code) |
| `checkLowPowerModeSupported()` (2636 / 4256) | `encode(0x82, 0x0D)` | `decode(r, 1)[0] === 1` | boolean |
| `checkWirelessDedicatedSupported()` (2656 / 4271) | `encode(0x82, 0x0E)` | `decode(r, 1)[0] === 1` | boolean |
| `getDeviceFeatures()` (2660 / 4274) | `encode(0x82, 0x0F)` | `decode(r, 56)`, zero-extended to 56 bytes; layout in the next table | feature object |
| *(other services, same ID)* `Oa.getMacroMaxStorageSize` (1832) | `encode(0x82, 0x00)` | `decode(r, 4)` → u32 BE bytes | macro storage bytes |
| *(other)* `Ya.checkLightingSupported` (3069–3078) | `encode(0x82, 0x09, [])` | raw packet bytes 6… : `a[17]` bits `musicMain(0) musicSpectrum(1) musicSide(2)`, `sideLight = !!a[18]`, `logoLight = !!a[19]`, `sideLightCount = a[20]` | |
| *(other)* `Qa.isSupported` (3236) | `encode(0x82, 0x0C)` | `decode(r,1)` bitmap | LCD/LED display support |

`getDeviceFeatures` response bytes (LIB 2664–2685):

| Byte | Field | Decode |
|---|---|---|
| 0 | `lcdDisplay` / `dotMatrixDisplay` | bit0 / bit1 |
| 1 | `lowPowerMode` | `!!a[1]` |
| 2 | `wirelessDedicatedChannel` | `!!a[2]` |
| 3 | `winMode` / `macMode` | bit0 / bit1 |
| 4 | `wasdArrowSwap` | `!!a[4]` |
| 5–6 | `wheel` / `slider` | `u16 = a[5]<<8 ｜ a[6]`; bit0 / bit1 |
| 7–8 | `maxUrlLength` | `a[7]<<8 ｜ a[8]` |
| 9 | `keyIdRGB` bit0, `fullKeysRGB` bit1, `ledBeadTable565` bit2, `ledBeadRGB565` = bit3 **and** bit4 | |
| 10–11 | (unused) | |
| 12 | `switchMixing` = bit7; `switchTriggerStage = (a[12] & 7) === 2 ? TwoStage(2) : Normal(0)` (`m0`, LIB 319) | |
| 13–55 | (unused, zero-padded) | |

### 10.3 Settings — read `0x84` (132) / write `0x04` (4)

Read: `encode(0x84, idx)` (no payload), reply = `decode(r)` (or `decode(r, 1)`); write: `encode(0x04, idx, valueBytes)`; the write reply is awaited (matched by header) but its content is ignored.

| idx (param) | Method (`za` line / `Q2` line) | Write payload | Read result | Range / unit / enum |
|---|---|---|---|---|
| `0x11` (17) | `getOsMode` (2576 / 4187), `changeOsMode(mode)` (2580 / 4190) | `[mode]` | `decode(r)[0]` | `F`: `0 = Windows`, `1 = MacOS`. UI maps "Mac"/"mac…" → 1, else 0 (globalSetting 4). Device pushes `0xFE/0x07` on hardware toggle |
| `0x13` (19) | `getSleepTime` (2603 / 4238), `setSleepTime(sec)` (2607 / 4241) | `D(sec)` u16 BE | `b[0]<<8 ｜ b[1]` | **seconds**; UI options `z9` (LIB 14614–14644): 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, `0 = never`. Stored as `sleepSeconds` (useProfileConfigSync 126) |
| `0x15` (21) | `getWinKeyLock` (2517 / 4211), `setWinKeyLock(bool)` (2521 / 4214) | `[1｜0]` | `decode(r)[0] === 1` | boolean. UI writes, waits 180 ms, reads back and retries on a fresh instance with 220 ms (index-C54O2iUn 237–243) |
| `0x17` (23) | `getPollingRate` (2509 / 4205), `setPollingRate(rate)` (2513 / 4208) | `[rate]` | `decode(r)[0]` | enum `_` (LIB 358–388): `Rate1K = 0, Rate500 = 1, Rate250 = 2, Rate125 = 3, Rate8K = 4, Rate4K = 5, Rate2K = 6`. Labels `E3` (LIB 7950–7958). UI waits 120 ms after the write, then may call `resetUSB` (globalSetting 113, 152–154); i18n warns the device may re-enumerate |
| `0x18` (24) | `getComboOptimization` (2501 / 4199), `setComboOptimization(bool)` (2505 / 4202) | `[1｜0]` | `decode(r)[0] === 1` | boolean ("shake optimization" in the UI store, globalSetting 133–138) |
| `0x19` (25) | `getAdaptiveCalibration` (2489 / 4193), `setAdaptiveCalibration(bool)` (2497 / 4196) | `[1｜0]` | `decode(r)[0] === 1` | boolean |
| `0x1D` (29) | `getDebounceMode` (2627 / 4250), `setDebounceMode(mode)` (2632 / 4253) | `[mode]` | `decode(r)[0] ?? Normal` | `Ot` (LIB 446): `Normal = 0, Leading = 1, Trailing = 2, Auto = 3` (i18n: Normal / Leading Edge / Trailing Edge / Auto Debounce) |
| `0x1E` (30) | `getDebounceTime` (2611 / 4244), `setDebounceTime(us)` (2619 / 4247) | `D(us)` u16 BE | `b[0]<<8 ｜ b[1]` | **microseconds** (`debounceUs`, useProfileConfigSync 126). UI clamps the raw value to `Ee = 1 … We = 50000` and shows `round(raw/1000)` ms with bounds `$ = ceil(1/1000)=1 … k = floor(50000/1000)=50` ms, step 1 ms (index-C54O2iUn 83, 87, 169, 453–456) |
| `0x20` (32) | `getLowPowerModeEnabled` (2644 / 4262), `setLowPowerModeEnabled(bool)` (2640 / 4259) | `[1｜0]` | `decode(r,1)[0] === 1` | boolean; gate with `checkLowPowerModeSupported` / `features.lowPowerMode` |
| `0x21` (33) | `getWasdArrowKeysSwapped` (2648 / 4265), `setWasdArrowKeysSwapped(bool)` (2652 / 4268) | `[1｜0]` | `decode(r,1)[0] === 1` | boolean; gate with `features.wasdArrowSwap` |
| `0x01/0x06/0x0B` | *(lighting `Ya.getEffect/setEffect`, 3025–3042)* | `[effectId, colorIndex, r, g, b, brightness, speed]` | same 7 bytes | Main / Side / Logo effect record (`Tr`, LIB 3193) |
| `0x02/0x07/0x0C` | *(lighting `Ya.changeEffect`, 3047)* | `[effectId]` | — | (`qa`, LIB 3205) |
| `0x03,0x04,0x05,0x08,0x09,0x0A,0x0D,0x0E,0x0F` | — | — | — | Implied by the `0xFE/0x0B` notification numbering (§8.2: brightness/speed/color/direction per light) — **UNVERIFIED**. No reachable code path sends them: the only code that emits `0x84`/`0x04` with a caller-supplied index is the legacy lighting service `Va` (LIB 1459–1540; `encode(4, t, [e])` 1472, `encode(132, t)` 1529), which is registered under an obfuscated key (`Wa = "jkyOG"`, LIB 1458, 4128) with no `Q2` accessor and no UI caller |

### 10.4 Other config/base commands

| Method (`za`/`Ga` line / `Q2` line) | Req | Resp | Notes |
|---|---|---|---|
| `getBatteryStatus()` (2584 / 4232) | `encode(0x87)` → `[0x87, 0x00, 0, 1, 0, 0, …]` | `[level = 0, flags]` → `{level, charging: ((flags & 0xF0)>>4) != 0, full: (flags & 0x0F) != 0}` (`bo`) | `level` is a percentage per the UI (`batteryPercent`, useProfileConfigSync 126) — **UNVERIFIED** scale beyond that |
| `getKeyMatrixPositions(ids)` (2542 / 4223) | `encode(0xA5, 0x00, ids.flatMap(u16BE), calculateAlignedDataSize(2,2)=56)` → up to 28 ids/packet, multi-packet if more | for each id `i`: `col = b[2i]`, `row = b[2i+1]` (note: **col first, row second**) → `{id, row, col}`; stops at the shorter of reply length / id count | ids are the same 16-bit key ids used everywhere (`p0` valid: 1…2^32−1). The UI calls it for the whole layout to place keys (index-B0AXfBBW 267) |
| `getKeyboardType()` (2595 / 4235) | (uses `getSupportedSwitches`) | `"magnetic"` if any switch bit set else `"mechanical"` | see §10.2 |
| `Ga.reset({type, layer?, system?})` (2418) | `encode(0x11, encodeLayerAndSystem(layer ?? Normal, system ?? Windows), [type])` | (ack only) | `I2` (LIB 490): `FullReset = 0, KeyReset = 1, LightReset = 2, USBReset = 3` |
| `resetUSB()` (2423 / 4277) | `reset({type: 3})` → `[0x11, 0x00, 0, 1, 0, 1, 0x03, …]` | ack | UI calls it after changing polling rate / USB mode (globalSetting 152–160, "highPollingRateReset"); the device may re-enumerate (i18n `reportRateDesc`) |
| `resetKeyboard(opts?)` (2428 / 4178) | `reset({...opts, type: 0})` | ack | UI then waits 1200 ms and re-opens the device (globalSetting 61–65) |
| `resetKeymap(opts?)` (2434) | `reset({...opts, type: 1})` | ack | layer/system in param byte |
| `resetLighting(opts?)` (2440) | `reset({...opts, type: 2})` | ack | |
| `Q2.getDeviceInfo()` (4167–4177) | `getUuid` + `getFirmwareVersion` in parallel (two commands) | `{uuid, firmwareVersion: raw u16, deviceVersion: Za, keyboardType: i3(uuid) ? "magnetic" : "mechanical", isTriMode: o3(uuid), maxPollingRate: _o(uuid) ? 1000 : 8000}` | Note: `keyboardType` here is derived from the **uuid prefix** (0x11/0x12), whereas `za.getKeyboardType` derives it from the switch bitmap; for the K98 Pro uuid prefix `0x14` this returns `"mechanical"` and `isTriMode = true` |

### 10.5 Sequences

Typical read (wired): `encode` → 1 packet → `sendReport(reportId, pkt)` → wait ≤ 1000 ms for a report with bytes 0/1/3/4 equal → `decode` → value. On timeout the same packet is sent once more (retry 1); second timeout rejects `Error("命令超时")`.

Typical write: identical, but the reply payload is discarded; the promise resolves when the device echoes the header.

Wireless-8K: the same 63-byte packet is prefixed with the report ID and sent as 5 framed reports of 19 bytes each, each individually ACKed within 100 ms (10 tries), and the codec-level timeout is 2000 ms with 3 retries.

Multi-packet request (e.g. `getKeyMatrixPositions` with 40 ids → 2 packets `[0xA5,0,0,2,0,56,…]`, `[0xA5,0,0,2,1,24,…]`): both packets are queued, each waits for its own header-matched reply, and `decode([r0, r1])` concatenates 56 + 24 payload bytes.

Session bring-up: `M3.getConnectedDeviceSnapshot` (LIB 7708–7724) calls `getDeviceInfo()` (uuid + version) then `getBatteryStatus()`; the host shell's `device.status.read` (shell 7804–7822) uses the opposite order — `getBatteryStatus()`, then `getDeviceInfo()`, then a separate `getUuid()`; the "Other" page additionally reads `getOsMode, getWinKeyLock, getDebounceMode, getDebounceTime, getSleepTime, getPollingRate, getBatteryStatus, getFirmwareVersion` serially (useProfileConfigSync 125).

Host-managed mode: when the sub-app runs inside the GS HUB shell (`window.$wujie.props.deviceBridge` + `activeDeviceId`, LIB 7385–7391), every facade call is proxied as `bridge.invoke(deviceId, {type: "keyboard.call", payload: {path: "advancedKey.setSOCD", args: [...]}})`; the shell resolves `path` on its own `Q2` instance and applies it (shell 7826–7838). `k98pro.compat.get-handle` returns that `Q2` instance directly (shell 7803).

## 11. Enum constants (verbatim, with hex)

Names that the deobfuscator left as string-table calls were resolved against the original bundle's tables with the rotation that satisfies the anchors visible in the deobfuscated file (`sn` rot 2, `hn` rot 1, `yn` rot 3, `gn` rot 28, `fn` rot 6, `n1` rot 7).

| Enum (var) | Members | Cite |
|---|---|---|
| Polling rate `_` | `Rate1K = 0x00, Rate500 = 0x01, Rate250 = 0x02, Rate125 = 0x03, Rate8K = 0x04, Rate4K = 0x05, Rate2K = 0x06` | LIB 358–388 |
| Monitor sub-command `_2` | `Start = 0x00, Read = 0x01, Stop = 0x02` | LIB 389 (+ table `sn`) |
| Profile `we` | `Default = 0x00, Onboard1 = 0x01, Onboard2 = 0x02` | LIB 393 |
| Debounce mode `Ot` | `Normal = 0x00, Leading = 0x01, Trailing = 0x02, Auto = 0x03` | LIB 446 |
| Advanced-key type `W` | `NONE = 0x00, TGL = 0x01, MT = 0x02, DKS = 0x03, SOCD = 0x04, MPT = 0x05, END = 0x06, RS = 0x07` | LIB 447–476 |
| Lighting type `Ce` | `Main = 0x01, Side = 0x02, Logo = 0x03` | LIB 480 |
| Reset type `I2` | `FullReset = 0x00, KeyReset = 0x01, LightReset = 0x02, USBReset = 0x03` | LIB 490 |
| System `F` | `Windows = 0x00, MacOS = 0x01` | LIB 661 |
| Layer `j` | `Normal = 0x00, Fn1 = 0x01, Fn2 = 0x02, Tap = 0x03` | LIB 673 |
| Keyboard type `q2` | `Magnetic = "magnetic", Mechanical = "mechanical"` | LIB 317 |
| Switch trigger stage `m0` | `Normal = 0x00, TwoStage = 0x02` | LIB 319 |
| Connect type `_e` | `Wired = "wired", Wireless8K = "wireless8K", Wireless = "wireless"` | LIB 3663–3670 |
| Events `Q` | see §8.1 | LIB 697 |
| Codec config `Ea` | `totalPacketSize 63, headerLength 6, tailLength 1, commandIdIndex 0, commandParamIndex 1, totalPacketLengthIndex 3, currentPacketIndex 4, lengthIndex 5, checksumIndex 62` | LIB 766–776 |
| Framed transport `t3` | `timeout 100, retries 10, maxByteSize 20, maxPayloadLength 64` | LIB 3672–3678 |
| Bubble IDs | `{0xFE, 0x98, 0x94}` | LIB 779 |
| HID ids | VID `0x372E`; PID `0x10E5` wired, `0x106C` wireless-8K; usagePage `0xFF60`, usage `0x61` | LIB 5666–5673, 7374 |
| Protocol version | `Q2.protocolVersion = "v3"` | LIB 4290, 1135 |

Pseudo-code summary of the codec:

```
encode(id, param, data, chunk=56):
    n = max(ceil(len(data)/chunk), 1)
    for i in range(n):
        p = bytes(63); seg = data[i*chunk:(i+1)*chunk]
        p[0:6] = [id, param, 0, n, i, len(seg)]; p[6:6+len(seg)] = seg
        p[62] = 0xFF - ((reportId + sum(p[0:62])) % 256)
        yield p

decode(views, expected=None):
    return b"".join(bytes(v)[6 : 6 + min(expected ?? v[5], 56)] for v in views)

matches(req, resp): req[0]==resp[0] and req[1]==resp[1] and req[3]==resp[3] and req[4]==resp[4]
```

## Open questions

1. **Report ID value.** `xo` reads it from the HID descriptor (`outputReports[0].reportId` of the first collection that has both input and output reports); the actual number for the K98 Pro is not in the code, and the checksum depends on it.
2. **Wireless reassembly offset.** In wireless-8K mode the outbound framed payload is `[reportId] + 63 bytes` but the codec parses the reassembled *inbound* payload from offset 0 as `commandId`; whether the device omits the report ID in its framed replies is unverified.
3. **Units of `getTravelPrecision` (0x82/0x08), `getMinRapidTrigger` (0x82/0x06) and the `distance` field of the 0x98 push.** Nothing in this file converts them; the UI store's `rtPrecision: 1` default hints at 0.01 mm-style steps but that is not confirmed.
4. **Battery `level` scale** (assumed percent from the UI field name) and the meaning of the upper/lower nibbles beyond "non-zero".
5. **Dongle report (0x0A, 19 bytes)**: only `byte4 == 2` (connect change, `byte5` bool) is decoded; bytes 1–3 and other `byte4` codes are unknown.
6. **Calibration params `0x01`, `0x03`** on command `0x94`, and settings indices `0x03–0x05, 0x08–0x0A, 0x0D–0x0F` on `0x84/0x04` (implied by the `0xFE/0x0B` numbering) are never sent by the library.
7. **Firmware version byte order** is inferred from `hi << 8 | lo` on `[byte0, byte1]`; whether the device also reports a build/subminor beyond the low nibble is unknown.
8. **`getSupportedAdvancedKeyTypes` skips byte 0** of the 32-byte reply before building the bitmap; the meaning of that first byte is not visible in code.
9. **`keyboardType` disagreement**: `Q2.getDeviceInfo` (uuid prefix `0x11/0x12`) vs `za.getKeyboardType` (switch bitmap non-empty). For the registered K98 Pro uuid (`0x14…`) the facade reports `"mechanical"` while the switch-bitmap path may report `"magnetic"`; which one the UI trusts for gating is outside this document's scope.
10. **`0x08`-prefixed input reports** are silently dropped by the framed transport (LIB 3782); their purpose is unknown.
