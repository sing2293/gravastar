# K98 Pro — HID transport (discovery, packet codec, send queue, framed 2.4G transport, host bridge)

## Scope

This document describes, end to end, how the GravaStar "GS HUB" web tool talks to the K98 Pro keyboard over WebHID: how the device is discovered and which HID collection/report ID is used, how a 63-byte command packet is built and checksummed (class `Ha`), how the send queue and response matching work (class `Mo`, wired), how the same packets are re-framed into 20-byte reports with ACKs for the 2.4 GHz "Wireless8K" dongle (classes `n3`/`r3`), which reports bypass the transport entirely (dongle lighting fast path, LCD image fast path, dongle link-state reports), and how the sub-app obtains a keyboard handle from the host shell through the `window.$wujie.props.deviceBridge` session bridge (`k98pro.compat.get-handle` / `keyboard.call`). Everything here is derived from the deobfuscated JavaScript only; nothing is inferred from other keyboards. Items that could not be confirmed from the code are marked **UNVERIFIED**.

Numbers are given as hex with decimal in parentheses. "Byte n" of a report always means the n-th byte of the WebHID *data* (the report ID is not part of the data buffer that WebHID delivers or accepts).

## Sources

Shorthand used in citations:

| Tag | File | What it holds |
|---|---|---|
| **P** | `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/deob/k98pro/index-Dk7Hs9bA.js` | Protocol library inside the K98 Pro sub-app. Relevant ranges: `an()` bridge accessor 30-33; `_2` enum 385; `La` 501-540; `xo` 608-620; `bo` 756-761; `Ea` 766-776; `Ha` 777-1069; `Ko` (mitt) 1070-1128; `Mo` 1145-1318; `za` 2485-2620 (`getUuid` 2559-2567); `Ya` wireless raw-report paths 3088-3122; `Qa.buildImageTransferPacket` 3306-3312; `Xa` 3497-3550; `_e` enum 3666-3671; `t3` 3672-3677; `n3` 3679-4031; `r3` 4034-4052; `s3` 4074-4081; `Q2` 4083-4290; `At`/`h3`/`Rr` 5666-5700; `D2` 5702-5797; i18n `y3` 5798+; `L2`/`K3` 7350-7360; `M3` 7361-7740; `T2`/`M9`/`I9` 7741-7798; `D3` event-name enum 7807; device store 7808-7900; bootstrap `a9` 14822-14839 |
| **S** | `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/deob/shell/index-Cm-TOe4o.js` | Host shell main. Product table `Lf` 2734-2742; `Ef` 2825; `Hc` filters 2836-2850; `Ff` bridge facade 2854-2866; `Nf`/`Rf` device bridge 2868-3050; HID manager filter helpers 3095-3129; `Fr` HID manager 3130-3462; `Fe` 3464; `C0`/`Rr` (host copy of `D2`) 7603-7699; provider ids/descriptors 7700-7739; `M0` K98 provider 7740-7839; `K0` legacy provider 7840-7860; wiring 7861-7876; device store 7876-8030 |
| **SA** | `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/deob/shell/k98pro-subapp-BY-33E-h.js` | wujie micro-frontend runtime + `ji("k98pro")` sub-app props 3101-3140 |
| **HV** | `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/gshub/assets/k98pro-BujOhiQN.js` | Host Vue wrapper that mounts the sub-app (minified, single line): builds the `props` object with `activeDeviceId`, `onDisconnect`, … |
| **O** | `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/gshub/k98pro-app/js/index-Dk7Hs9bA.js` | Original obfuscated bundle (used only to resolve the `xo` string table) |

---

## 1. Device discovery and HID filters

### 1.1 Identifiers

| Item | Value | Cite |
|---|---|---|
| Vendor ID | `0x372E` (14126) | P:5667 (`At.vendorId`), P:7374 |
| Product ID, wired | `0x10E5` (4325) | P:7374 `new Rr(4325, 14126)` |
| Product ID, 2.4 GHz dongle ("Wireless8K") | `0x106C` (4204) | P:7374 `new Rr(4204, 14126, 65376, 97, true)`; P:5673 `h3 = new Set([4204])` |
| Vendor HID collection | usagePage `0xFF60` (65376), usage `0x61` (97) | P:5668-5669 (`At`), P:7374 |
| Product UUID the app accepts | `21990232555532` = `0x14000000000C` | P:7374-7376 `products = [{uuid: 21990232555532}]` |
| Connect-type enum `_e` | `Wired`, `Wireless8K` (string `"wireless8K"`), `Wireless` (`"wireless"`) | P:3666-3671 (string of `Wired` UNVERIFIED — decoder slot unresolved; only the names matter) |

`Rr` (P:5674-5700) is the filter record `{productId, vendorId = 0x372E, usagePage = 0xFF60, usage = 0x61, isWireless = false}`. The host shell uses an equivalent list `Hc` (S:2836-2845) with the same two VID/PID/usagePage/usage entries; the legacy filter list `Ef` is empty (S:2825), so the host HID manager's effective filter set `Pf` is exactly these two entries (S:2850, S:3464 `Fe = new Fr({filters: Pf})`).

Supported-device test (P:5791-5793, same in S:7693-7695):

```
isSupportedDevice(dev, filters) =
  filters.some(f => dev.vendorId === f.vendorId && dev.productId === f.productId
                 && dev.collections.some(c => c.usage === f.usage && c.usagePage === f.usagePage))
```

The `connectType` is resolved as `Wireless8K` if `productId === 0x106C` or a wireless filter matches, otherwise `Wired` (P:7400-7402 `M3.resolveConnectType`; `D2` uses the same test at P:5756 — note the tautology `i.vendorId === i.vendorId` there, so effectively only the productId is compared). In the host provider: `ji(dev) = Rr.isWireless8K(dev) || dev.productId === 4204` (S:7722).

The i18n text confirms the transport policy: "no device supports connecting to the driver over Bluetooth. Please use the 2.4G receiver or a cable." (P:5802 `connectTip`).

### 1.2 Output report ID discovery — `xo(device)` (P:608-620)

The deobfuscated text is internally inconsistent (it prints `.collections` for two different string-table slots), so the function was resolved from the original string table `["4EIEZXd","No output report ID found","collections","344PXPhVp","reportId","AoyQx",…,"outputReports",…,"5BIgdzW",…,"2658636gqiKQE","length"]` (O, `fn()` array feeding decoder `pn`). Property `n[X0]` and `a[d(113)]` use *different* slots, and the only real names left are `collections`, `outputReports`, `reportId`, `length`, which gives:

```
function xo(device):
  coll = device.collections.find(c => c.inputReports?.length && c.outputReports?.length)
  id   = coll?.outputReports?.[0]?.reportId
  if (!id) throw Error("No output report ID found")     // note: a report ID of 0 is treated as "not found"
  return id
```

i.e. **the first top-level collection that has both input and output reports; the report ID of its first output report.** This value (`reportId`, called `R` below) is used for four things:

| Use | Cite |
|---|---|
| WebHID `sendReport(R, …)` for every packet/frame | P:1205-1207 (`Mo.doSend`), P:3919-3926 (`n3.sendReport`) |
| Seed of the 63-byte packet checksum (`calculateCrc` starts its sum at `this.reportId`) | P:779, P:895-899 |
| First byte of the framed 64-byte payload on the dongle path | P:4046-4049 (`r3.doSend`) |
| Filtering incoming frames on the dongle path (`event.reportId === R`) | P:3850-3854 (`n3.isRequestValid`) |

The actual numeric report ID of the K98 Pro vendor collection is **UNVERIFIED** (it comes from the device's report descriptor at run time; no constant in the code). `Mo` accepts an `options.reportId` override, but `s3` never passes one (P:1161-1163, P:4074-4081).

### 1.3 Discovery flow inside the sub-app (stand-alone / non-host mode)

`D2` (P:5702-5797) is a detector constructed with `M3.hidFilters` and the accepted UUID set (P:7495-7497 `createDeviceDetector`).

| Step | Behaviour | Cite |
|---|---|---|
| `getDevices()` | `navigator.hid.getDevices()` → filter with `isSupportedDevice` → for each: open if needed, read UUID → `Map<uuid, HIDDevice>` | P:5781-5787 |
| `getUuidByHidDevice(dev)` | `if (!dev.opened) await dev.open()`; `Q2.readDeviceUUID(dev, {connectType})`; result kept only if `uuids.has(uuid)` | P:5753-5759 |
| `Q2.readDeviceUUID` | Creates a throw-away `Q2`, calls `getUuid()`, then `destroy()` | P:4084-4087 |
| `getUuid()` command | `encode(0x82 (130), 0x01, [0,0,0,0,0,0])`, sent with `{retry: 0}`; 6 response bytes big-endian → `Number(BigInt)` | P:2559-2567 |
| `start(devices)` | same as above, but emits `"detected" {uuid, hidDevice}` per device then `"detect-end"` | P:5763-5780 |
| Retry of `getDevices` | `M3.getDetectorDevices(det, max=2)` retries on throw after `180 * (attempt+1)` ms | P:7503-7510 |
| Authorization | `navigator.hid.requestDevice({filters: hidFilters})`, then `wait(250 ms)`, then `getMechDevices()`; falls back to `buildKnownDeviceMap` (first supported device is assumed to be the primary product without reading the UUID) | P:7521-7534, 7514-7520 |
| Open | `M3.openHidDevice`: `dev.opened || await dev.open()` | P:7511-7513 |
| Keyboard instance | `new Q2(device, {connectType: resolveConnectType(device)})`; a previous instance is destroyed first | P:7437-7448 |
| Close | `forceCloseTransport()`: destroy keyboard, then `device.close()` if `opened !== false`; `closeDevice()` only destroys the keyboard | P:7730-7737, 7649-7652 |
| Hot-plug | `navigator.hid` `connect`/`disconnect` listeners; on disconnect of the selected device the cached instance is destroyed and cleared | P:7605-7640 |
| Listed-device ids | `hid:<vid hex4>:<pid hex4>:<n>` (n increments from 1) | P:7403-7410 |

Note: the legacy device store still contains a wired/wireless conflict check on usagePages `0xFF00` (65408) and `0xFF30` (65456) (P:7834-7846), but its device list is hard-coded to `[]` (P:7862), so that code path is dead for the K98 Pro.

---

## 2. Object graph

```
Q2 (Keyboard facade, P:4083)            ← extends La (P:501): on/off/emit go to transport.mitt
 ├─ protocol  = new Ha(device)          codec, 63-byte packets                      (P:4089)
 ├─ transport = s3(connectType, device, protocol)                                    (P:4089, 4074-4081)
 │      Wired      → new Mo(device, protocol, {timeout: 1000, retry: 1})
 │      Wireless8K → new r3(device, protocol, {timeout: 2000})   // r3 extends Mo, owns an n3
 │                       └─ n3(device, R, {debug: !!window.__BY_KEYBOARD_DEBUG__})   (P:4036-4038)
 └─ serviceContainer = new Xa(protocol, transport, device)                          (P:4090)
        services are constructed as new Svc(protocol, transport, hidDevice)          (P:3534-3541)
```

`Q2.destroy()` = `transport.destroy()` + `serviceContainer.destroy()` (P:4280-4282, P:538-540). `Q2.protocolVersion = "v3"` (P:4290, P:1135).

---

## 3. Packet codec — class `Ha` (P:777-1069)

### 3.1 Layout constants `Ea` (P:766-776)

| Field | Value |
|---|---|
| `totalPacketSize` | 63 (data bytes per report; WebHID prepends the report ID → 64 bytes on the wire) |
| `headerLength` | 6 |
| `tailLength` | 1 |
| `commandIdIndex` | 0 |
| `commandParamIndex` | 1 |
| `totalPacketLengthIndex` | 3 |
| `currentPacketIndex` | 4 |
| `lengthIndex` | 5 |
| `checksumIndex` | 62 |
| `validDataLength` (getter) | `63 - 6 - 1 = 56` (P:781-786) |

### 3.2 Packet layout (built by `buildCommands`, P:869-878)

| Offset | Size | Content |
|---|---|---|
| 0 | 1 | command ID |
| 1 | 1 | command parameter / sub-command (default 0) |
| 2 | 1 | 0 (reserved). Overwritten by `buildMacroCommands` (low byte of 16-bit offset, P:879-884), `buildAdvancedKeyCommands` (P:885-890) and `Qa.buildImageTransferPacket` (P:3306-3312) |
| 3 | 1 | total packet count `max(ceil(len/chunk), 1)` |
| 4 | 1 | current packet index, **0-based** |
| 5 | 1 | payload length in this packet (≤ chunk size, default 56) |
| 6..61 | 56 | payload (zero padded) |
| 62 | 1 | checksum |

`encode(cmd, param = 0, data = [], chunkSize)` → `buildCommands(cmd, param, Uint8Array(data), chunkSize ?? 56)` (P:791-797). Services often pass `calculateAlignedDataSize(recordSize, …)` so that records are not split across packets (P:900-902 → `Ma`, P:565-571). `encode` always returns an **array** of `Uint8Array(63)`.

Special re-writers: `buildMacroCommands` puts `index * 56` as a 16-bit big-endian value into bytes 1..2 (P:879-884); `Qa.buildImageTransferPacket` puts the packet count (16-bit BE) into bytes 1..2 and the packet index (16-bit BE) into bytes 3..4 (P:3306-3312). Both re-run the checksum.

### 3.3 Checksum (P:891-899)

```
calculateCrc(pkt):  pkt[62] = 0
                    sum = R + Σ pkt[0..62]          // R = output report ID from xo()
                    return 255 - (sum % 256)
setChecksum(pkt):   pkt[62] = calculateCrc(pkt)
```

So the checksum covers the report ID even though the report ID is not in the data buffer. The same formula (`255 - Σ % 256`, with the report ID included in the summed array) is used by the raw dongle lighting reports (§7.1).

### 3.4 Decoding (P:798-813)

`decode(resp, explicitLen?)`: for one `DataView`, take `len = explicitLen ?? resp[5]` and return bytes `[6, min(6 + len, 6 + 56))`. For an array of responses, decode each and concatenate. Because `Mo.send` always resolves to an array (§4.2), services always pass arrays.

### 3.5 Response matching (P:844-868)

`isValidResponse(sentPkt, respView)` requires **all** of `resp[0] == sent[0]` (command), `resp[1] == sent[1]` (param), `resp[3] == sent[3]` (total), `resp[4] == sent[4]` (current). Anything else is ignored by the queue (§4.3).

### 3.6 Device-initiated ("bubble") reports (P:779, 814-843, 906-1064)

`bubbleCommandIds = {0xFE (254), 0x98 (152), 0x94 (148)}` (P:779). `isBubbleResponse(view)` (P:814-826):

| Condition | Result |
|---|---|
| `isDongleReport(view)` — data length **19** and `view[0] == 0x0A` (10) (P:906-908) | bubble |
| `view[0] == 0xFE` | bubble (all sub-types) |
| `view[0] == 0x98` and `view[1] == _2.Read` | bubble (key-travel monitor stream). `_2.Start = 0` is confirmed (P:385); the numeric values of `_2.Read`/`_2.Stop` (1 and 2 in some order) are **UNVERIFIED** |
| `view[0] == 0x94` and `view[1] == 2` | bubble (calibration stream) |
| otherwise | normal response |

`handleBubbleResponse` (P:833-843) dispatches, and the result is emitted with `mitt.emit(event, data)` (P:1246-1249):

| Report | Parse | Event (string) | Cite |
|---|---|---|---|
| Dongle report (`len 19`, `[0]=0x0A`) | `[4] == 2` → `data = !![5]` | `device-dongle-connect-change` | P:827-832 |
| `0xFE`, `[1]=2` | `data = !![2]` | `device-dongle-connect-change` | P:921-925 |
| `0xFE`, `[1]=5` | `level=[2]`; `[3]`: `charging = ([3] & 0xF0) >> 4 != 0`, `full = ([3] & 0x0F) != 0` | `battery-change` | P:926-936, `bo` P:756-761 |
| `0xFE`, `[1]=7` | `data = [2]` (OS mode) | `system-change` | P:937-941 |
| `0xFE`, `[1]=9` | `data = [2]` (profile) | `profile-change` | P:942-946 |
| `0xFE`, `[1]=11` | `c=[2]` (1..15): `(c-1)%5` → `effectId/brightness/speed/color/direction`; `c<6` Main, `c<11` Side, else Logo; `d=[3]` value; for `color`: `colorIndex=d`, `r,g,b = [4],[5],[6]` | `lighting-effect-change` | P:947-1011 |
| `0x98` (param `_2.Read`) | payload records of 6 bytes: `id` (u16 BE), `distance` (u16 BE), `w` (u16 BE) → `press = w & 0x8000`, `ad = w & 0x7FFF` | `key-travel-monitor` | P:1013-1031 |
| `0x94` (param 2) | 6-byte records: `id` (u16 BE), `w` (u16 BE) → `press = w & 0x8000`, `ad = w & 0x7FFF`, `finished = !(w & 0x8000)`; `min` (u16 BE) | `key-calibration` | P:1032-1064 |

Event-name strings come from `D3` (P:7807) and are tied to the `Q` enum by `L2` (P:7352-7359); `M3.registerKeyboardEvents` forwards all seven (`K3`, P:7360) to both its own listeners and the global bus `X0` (P:7460-7469).

---

## 4. Wired transport — class `Mo` (P:1145-1318)

### 4.1 Construction

`new Mo(device, protocol, options)`; defaults `{timeout: 500, retry: 3, debug: false, reportId: null}` (P:1173-1179). For the K98 Pro wired path `s3` passes `{timeout: 1000, retry: 1}` (P:4077-4079). `reportId = options.reportId ?? xo(device)` (P:1161-1163). `mitt = Ko()` event emitter (P:1188, P:1070-1128). Registers `device.addEventListener("inputreport", onInputReport)` (P:1194-1196).

### 4.2 `send(packets, opts)` (P:1208-1239)

* `packets` may be one `Uint8Array` or an array. Each packet becomes **its own queue entry** with `{command, resolve, reject, timestamp, timeout: opts.timeout ?? 1000, retry: opts.retry ?? 1, waitResponse: opts.waitResponse ?? true, progress: (i+1)/n}` (P:1213-1236).
* `opts.progressCallback(progress)` is called with the entry's progress on resolve and with `0` on reject (P:1219-1228).
* Returns `Promise.all(entries)` → **always an array of `DataView`** (one per packet), even for a single packet (P:1237-1238). Rejection of any entry rejects the whole `send`, but the other entries are still processed.
* `sendCommand(pkt)` = `send(pkt, {waitResponse: false})` — fire-and-forget (P:1200-1204). Used by lighting streaming (`updateRGB`, `updateFullKeysRGB`, `updateRGBWithLedBeads`, P:3082-3127) and a few others (P:3187).

### 4.3 Queue processing (P:1261-1304) and response wait (P:1305-1315)

```
processQueue():  if busy return; busy = true
  while queue not empty:
    e = queue[0]
    if !e.waitResponse:  try { await device.sendReport(R, e.command); e.resolve(undefined) }
                         catch { e.reject("发送命令失败" /* send failed */) }
                         queue.shift(); continue
    for attempt in 0..e.retry:                       // retry+1 attempts (wired: 2, dongle: 4)
      try:
        wait = waitForResponse(e.timeout)            // timer starts BEFORE the report is sent
        await doSend(e.command)                      // Mo: sendReport(R, cmd); r3: framed send (§5)
        if await wait: break                         // true = matching response arrived
        if attempt < e.retry: continue
        e.reject("命令超时" /* command timeout */); break
      catch:                                         // sendReport / framed send threw
        if attempt < e.retry: continue
        e.reject("发送命令失败"); break
    queue.shift()
  busy = false
```

`waitForResponse(t)` wraps `queue[0].resolve` so that a matching input report resolves the wait with `true` and clears the timer; the timer resolves `false` (P:1305-1315).

`handleInputReport(view)` (P:1243-1253): bubble → emit and return; queue empty → drop; `isValidResponse(queue[0].command, view)` → `queue[0].resolve(view)`; else drop (no error).

`resetQueue()` rejects every pending entry with `"Queue was reset"` (P:1254-1260); `destroy()` = `resetQueue()` + remove listener + clear emitter (P:1316-1318).

| Parameter | Wired (`Mo`) | Dongle (`r3`) | Cite |
|---|---|---|---|
| response timeout per attempt | 1000 ms | 2000 ms | P:4076-4079 |
| attempts (`retry + 1`) | 2 | 4 (default `retry: 3`) | P:1174-1175, P:4076 |
| `getUuid` override | `{retry: 0}` → 1 attempt | same | P:2561 |

---

## 5. Dongle ("Wireless8K") framed transport — classes `r3` (P:4034-4052) and `n3` (P:3679-4031)

### 5.1 `r3`

`r3 extends Mo`. Constructor: `super(...)`, then `this.transport = new n3(device, this.reportId, {debug: !!window.__BY_KEYBOARD_DEBUG__})`, then `addEventListeners()` → `transport.onInputReport(this.handleInputReport)` (P:4036-4041). Instead of listening to the raw `inputreport` event, `Mo.handleInputReport` receives the **re-assembled** payload from `n3`.

`doSend(pkt)` (P:4046-4049): builds a 64-byte payload `[R, ...pkt(63)]` and calls `n3.send(payload)`. So the 63-byte codec packet **and its report ID byte** are tunnelled inside the frames. `destroy()` = `Mo.destroy()` + `n3.destroy()` (P:4050-4052).

### 5.2 `n3` options `t3` (P:3672-3677) and derived sizes

| Option | Default | Notes |
|---|---|---|
| `timeout` | 100 ms | per-frame ACK wait |
| `retries` | 10 | clamped to ≥ 1 (P:3705) |
| `maxByteSize` | 20 | clamped to ≥ 6 (P:3711); = report size on the wire including the report ID |
| `maxPayloadLength` | 64 | max payload of one `send()` (P:3750) |
| `debug` | false | `log()` is compiled out (P:3999-4004) |
| `validDataSize` | `20 - 1 - 4 - 1 = 14` | data bytes per frame (P:3738-3740) |
| `maxPayloadSizePerPacket` | `20 - 1 = 19` | data bytes per WebHID report (P:3741-3743) |

`r3` only overrides `debug`, so a 64-byte payload becomes `ceil(64 / 14) = 5` frames (14, 14, 14, 14, 8 bytes).

### 5.3 Frame layout (`buildFrame`, P:3927-3930; `parseFrame`, P:3866-3877)

| Byte | Bits | Content |
|---|---|---|
| 0 | 7..0 | header `0x66` (102) |
| 1 | 7 | `syncFlag` bit 2 (`(syncFlag & 4) << 5`) |
| 1 | 6..0 | `total` frame count (`& 0x7F`) |
| 2 | 7 | `syncFlag` bit 1 (`(syncFlag & 2) << 6`) |
| 2 | 6..0 | `current` frame number, **1-based** (`& 0x7F`) |
| 3 | 7 | `syncFlag` bit 0 (`(syncFlag & 1) << 7`) |
| 3 | 6..0 | `length` = data bytes in this frame (`& 0x7F`, ≤ 14) |
| 4 .. 4+length-1 | | data |
| 4+length | | checksum = `(Σ bytes[0 .. 4+length-1]) & 0xFF` (P:3988-3990) |
| … 18 | | zero padding to 19 data bytes (`fillPayload`, P:3959-3970) |

`parseFrame` recovers `syncFlag = (b1 & 0x80) >> 5 | (b2 & 0x80) >> 6 | (b3 & 0x80) >> 7` and `checksumIndex = 4 + length` (P:3866-3877).

`syncFlag` is a 3-bit rolling counter, `(syncFlag + 1) & 7`, **incremented before every frame** (not per message) (P:3744-3746, 3763). It starts at 0 for a new transport (P:3708), so the first frame ever sent carries sync = 1. The receive side keeps a separate `receiveSyncFlag` (P:3689).

### 5.4 Sending — `send(payload)` (P:3747-3779) and `sendAndWaitAck` (P:3878-3911)

```
send(payload):
  if working: throw "上一次的数据包还未发送完成!"          // previous message still in flight
  if payload.length > 64: throw "数据包长度超过限制 …"       // P:3750
  working = true
  frames = splitFrame(payload)                             // slices of 14 bytes (P:3931-3938)
  for i in 0..frames.length-1:
    syncFlagIncrease()                                     // P:3763
    frame = buildFrame(total = frames.length, current = i+1, frames[i])
    await sendAndWaitAck(frame, i+1, total)                // serial, one frame at a time
  working = false                                           // also on throw (finally)

sendAndWaitAck(frame):
  key = `${syncFlag}-${total}-${current}`                  // transaction key (P:3855-3858)
  attempts = 0
  attempt():
    if attempts >= retries(10): pendingTransmissions.delete(key); reject("帧 c/t 在 n 次尝试后失败")
    attempts++
    await device.sendReport(R, fillPayload(frame))         // 19 data bytes (P:3919-3926); on throw → reject("发送帧 … 失败: …")
    timer = setTimeout(attempt, 100 ms)                    // resend the SAME frame (same sync flag) if no ACK
  pendingTransmissions.set(key, {resolve: clear timer + resolve, reject})
  attempt()
```

Worst case per frame ≈ 10 × 100 ms = 1 s; a 5-frame message can therefore take ≈ 5 s while the enclosing `Mo` entry's 2000 ms response timer is already running (it is started before `doSend`, §4.3) — a slow link can time out at the `Mo` level and be retried (up to 4 attempts) even though `n3` is still retrying frames; `n3.send` then throws `working` and `Mo` treats it as a send failure. (Behavioural consequence, not a separate code path.)

### 5.5 ACK frames (P:3983-3998)

`buildAckFrame(rx)` = `[rx[0], rx[1], rx[2], rx[3] & 0x80, checksum]` → header + total + current (with all three sync bits preserved), `length = 0`, checksum over the 4 bytes (P:3991-3998). Sent through `sendReport` → padded to 19 bytes (`sendAckFrame`, P:3916-3918).

`isAckFrame(view)`: `length == 0` **and** `view[4] == (Σ view[0..3]) & 0xFF` (P:3983-3987). `handleAckFrame` builds the transaction key from the ACK and resolves the matching `pendingTransmissions` entry (P:3859-3865).

Both directions ACK: the host ACKs every valid data frame it receives (P:3795-3799), and expects the device to ACK each frame it sends.

### 5.6 Receiving — `handleInputReport(event)` (P:3780-3820)

```
data = event.data
if data[0] == 0x08: return                                     // silently ignored report class (P:3782; purpose UNVERIFIED)
if event.reportId != R or data[0] != 0x66:                     // isRequestValid, P:3850-3854
    if data[0] == 0x0A and data[4] == 0x02: notifyBusinessLayer(data)   // raw dongle link-state report, passed through (→ Ha.isDongleReport)
    return
if isAckFrame(data): handleAckFrame(data); return
if !isValidReceivedFrame(data): return                          // header, length != 0, 1 <= current <= total, checksum (P:3971-3982)
{total, current, sync} = parseFrame(data)
try await sendAckFrame(data) catch return
first = (current == 1)
if receiveSyncFlag == sync:                                     // same sync as last accepted frame
    if !first: return                                           // duplicate/retransmit → drop
    receivedPackets = []
if first and receivedPackets.length: receivedPackets = []       // new message → discard partial one
if current != receivedPackets.length + 1: return                // out of order → drop
receiveSyncFlag = sync; receivedPackets.push(data)
if current == total and receivedPackets.length == total:
    msg = combinePackets(receivedPackets)                       // concat of data[4 .. 4+length) of each frame (P:3840-3849, 3912-3915)
    receivedPackets = []; notifyBusinessLayer(msg)              // → Mo.handleInputReport(DataView) (P:3821-3823)
```

The re-assembled `DataView` is handed to `Mo.handleInputReport`, which reads the command ID at **offset 0** (§3.5). Hence the device's reply payload must start directly with the 63-byte packet (command ID first); whether the device echoes a leading report-ID byte like the host does on transmit (§5.1) cannot be confirmed from the code — **UNVERIFIED**, but the matching logic only works if it does not.

`onInputReport(handler)` returns an unsubscribe function; `offInputReport` removes it (P:3824-3834). The raw `inputreport` listener is attached in `setupEventListeners` (P:3835-3839). `destroy()` rejects all pending ACK waits with `"Transport destroyed"`, clears handlers/buffers and removes the listener (P:4005-4031).

---

## 6. Transport selection summary

| | Wired (PID `0x10E5`) | 2.4 GHz dongle (PID `0x106C`) |
|---|---|---|
| Class | `Mo` | `r3` (Mo + `n3`) |
| Output report | `sendReport(R, 63 bytes)` → 64 B on the wire | `sendReport(R, 19 bytes)` → 20 B on the wire, ×5 per command |
| Payload | codec packet | `[R, codec packet]` split into `0x66` frames |
| Per-command timeout / attempts | 1000 ms / 2 | 2000 ms / 4 |
| Frame ACK | none | 100 ms / 10 attempts per frame, 3-bit sync counter |
| Input | raw `inputreport` (63 B) | frames re-assembled by `n3`; frames ACKed by host |
| Dongle link-state report (`len 19`, `[0]=0x0A`, `[4]=2`) | delivered directly to `Mo.handleInputReport` → `Ha.isDongleReport` | passed through by `n3` when header ≠ `0x66` |
| Cite | P:4077-4079 | P:4075-4076, 3672-3677 |

---

## 7. Reports that bypass the transport

### 7.1 Raw dongle lighting reports (report ID `0x09`, 20 bytes) — `Ya` (P:3088-3122)

These methods write directly with `hidDevice.sendReport(9, …)` and do not go through `Mo`/`n3`:

| Method | Report (array before slicing off the report ID) | Cite |
|---|---|---|
| `updateFullKeysRGBByWireless({r,g,b})` | `[0x09, 0x08, 0x01, 0x00, 0x23, r, g, b, 0×11, cs]` | P:3088-3093 |
| `updateRGBByWireless(list)` | per chunk of 13 bytes: `[0x09, 0x08, total, idx, 0x10 \| (len & 0x0F), …chunk, pad, cs]`; data = `[r, g, b, n, …ids]` groups (`Ft(list, 48)`), all chunks sent in parallel (`Promise.all`) | P:3094-3106 |
| `updateRGBWithLedBeadsByWireless(beads)` | per chunk of 13: `[0x09, 0x08, total, idx, 0x30 \| (len & 0x0F), …chunk, pad, cs]`; data = 16-bit BE packed colours sorted by row/col | P:3107-3122 |

Layout: byte 0 = report ID `0x09`, byte 1 = `0x08` (lighting command, same ID as the transport `encode(8, …)` variants at P:3083/3086), byte 2 = total chunks, byte 3 = chunk index (0-based), byte 4 = `type | len` (`0x20` full-colour, `0x10` per-key list, `0x30` LED beads; low nibble = data length), bytes 5..18 = data + zero padding, byte 19 = `255 - (Σ bytes[0..18]) % 256` (report ID included in the sum, same convention as §3.3). 19 data bytes are passed to `sendReport` (`arr.slice(1)`).

### 7.2 LCD dynamic-image fast path — `I9` (P:7769-7798)

When the keyboard's `transport` exposes `send`, `device` and a numeric `reportId` (true for both `Mo` and `r3`), `I9` temporarily replaces `transport.send` with a function that, if a `progressCallback` is present, sends every packet with `device.sendReport(reportId, packet)` **directly, sequentially, without waiting for a response**, with a `2 ms` pause after each (`L3`/`b3`, P:7350). This skips the queue, response matching and — on the dongle — the `0x66` framing. Whether the UI only uses `I9` in wired mode is **UNVERIFIED** (out of scope; see the LCD document). The original `send` is restored in `finally`.

### 7.3 Ignored report

`n3` drops any input report whose first data byte is `0x08` before doing anything else (P:3782) — meaning UNVERIFIED (the wired `Mo` path has no such filter; there `0x08` would simply fail `isValidResponse` and be ignored unless a lighting command `0x08` is at the head of the queue).

---

## 8. Host-managed session bridge (sub-app inside the GS HUB shell)

### 8.1 What the sub-app looks for

* `an(win)` returns `window.$wujie?.props?.deviceBridge ?? null` (P:30-33, key `"deviceBridge"`).
* `M3.getHostManagedSession()` returns `{bridge, deviceId}` only if the bridge exists **and** `window.$wujie.props.activeDeviceId` is a non-empty string (P:7385-7392). Everything else in `M3` branches on this.
* The host provides both via wujie props: `appProps = {assetBaseUrl, deviceBridge: On}` (SA:3101-3112) merged by the host Vue wrapper with `activeDeviceId: store.activeDeviceId, locale, onDisconnect, onLocaleChange, onOpenDeviceSelector` (HV, `re = z(() => ({...d.appProps, activeDeviceId: s.activeDeviceId, …, onDisconnect: k, …}))`). `activeDeviceId` is persisted in `sessionStorage["device-hub:active-device-id"]` (S:7876, 7891).

### 8.2 Bridge contract (`Ff`, S:2854-2866; implemented by `Rf`, S:2878-3050)

| Method | Semantics | Cite |
|---|---|---|
| `contractVersion` | `"1.0"` | S:2856 |
| `requestDevices({providerId?, requestIfMissing?, userInitiated?, forceRequest?})` | runs each provider's `discover`, marks vanished devices `disconnected`, emits `devices-changed`, returns `listDevices` | S:2886-2910 |
| `listDevices({providerId?, category?})` | snapshot of known devices incl. `connectionStatus` (`authorized`/`connecting`/`connected`/`error`/`disconnected`) | S:2911-2913 |
| `connect(id)` | `connecting` → `provider.connect(id)` → `connected` (+ event) or `error` | S:2914-2943 |
| `disconnect(id)` | `provider.disconnect(id)` → `disconnected` | S:2944-2957 |
| `reportConnectionStatus(id, status, reason)` | external status update (used for the wireless link) | S:2958-2973 |
| `invoke(id, command)` | auto-connects if not `connected`, then `provider.execute(id, command)` | S:2974-2978 |
| `executeMany` / `executeBatch` | fan-out of `invoke` | S:2979-3004 |
| `subscribe(fn)` | bridge events `{type: connected\|disconnected\|error\|devices-changed, device, devices, disconnectReason?}` | S:3005-3007 |
| `subscribeProviderEvent(providerId, name, fn)` | provider-specific events | S:3008-3010 |
| Concurrency | `runForDevice`: **serial per device** promise chain (`Nf`, S:2868-2876) for the K98 provider (`concurrency = "serial-per-device"`, S:7742) | S:3021-3028 |

### 8.3 Host-side K98 Pro provider `M0` (id `"k98pro-bytech"`, S:7700, 7740-7839)

| Command `type` | Behaviour | Cite |
|---|---|---|
| `discover` | `lu()` (WebHID `getDevices`, or `requestDevice` only when `userInitiated`) → filter `ao` (K98 Pro VID/PID/usage) → read UUID with `xn.readDeviceUUID(rawDevice, {connectType})` → device id `k98pro-bytech:uuid:<uuid hex, 8+ digits>` (fallback `k98pro-bytech:<hid:vid:pid:n>` if the UUID read fails); capabilities `keyboard.command`, `device.status.read` | S:7730-7739, 7770-7785, 7700-7721 |
| `connect(id)` | `Fe.openDevice(managerId)` (HID manager opens the `HIDDevice`, serial per device, S:3232-3234/3420-3422) → `new xn(rawDevice, {connectType})` — `xn` is the host's copy of `Q2`, so **the transport (`Mo`/`r3`) lives in the host window** | S:7786-7794 |
| `disconnect(id)` | destroy the `Q2`, close the HID device | S:7795-7799 |
| `k98pro.compat.get-handle` | returns the live host `Q2` instance itself | S:7803 |
| `device.status.read` | `getBatteryStatus()`, `getDeviceInfo()` (firmware `V…`), `getUuid()`; on failure with a dongle device emits wireless-link `false` | S:7804-7825 |
| `keyboard.call` `{payload: {path: "a.b.method", args: []}}` | walks `path` on the `Q2` instance and `apply`s `args` | S:7826-7833 |
| provider event `wireless-link-change` | fed by the `Q2` `device-dongle-connect-change` event for dongle devices (`ji`); the bridge maps it to `connectionStatus` `connected`/`disconnected` with `disconnectReason: "wireless-link"` | S:7752-7767, 7864-7866 |

HID hot-plug in the host (`Fe.on("connect"/"disconnect")`) triggers a bridge inventory refresh (S:7867-7875). The host HID manager `Fr` registers an `inputreport` listener per device that re-emits `{data, device, reportId, sequence}` on its own bus (S:3342-3360) — this is *not* used by the K98 provider; the `Q2`'s own `Mo`/`n3` listeners talk to the `HIDDevice` directly. `Fr`'s filter helpers: `un` (device matches filter incl. collection usage, S:3115-3117), `Uf` (pick the matching collection for descriptors, S:3118-3125), id factory `hid:<vid>:<pid>:<seq>` (S:3126-3129).

### 8.4 Sub-app side flow

1. Bootstrap `a9()` (P:14822-14839): if bridge + `activeDeviceId` exist → `await bridge.connect(id)`; `handle = await bridge.invoke(id, {type: "k98pro.compat.get-handle"})`; `T2.adoptHostKeyboard(handle, id)` (P:7476-7478); `deviceStore.setActiveDevice({id, vendorId, productId, productName, usage, usagePage})` from the `connect` result. On failure → `window.$wujie.props.onDisconnect?.()` (P:14837-14839). Then the Vue app mounts.
2. `M3.getKeyboardInstance()` in host mode returns the cached handle or repeats step 1 (`getHostKeyboardInstance`, P:7393-7399, 7679-7697).
3. Most UI code then calls the `Q2` object **directly** (same JS object shared across the wujie iframe boundary); the only code path that uses `keyboard.call` is `M9` for the advanced-key service: `bridge.invoke(id, {type: "keyboard.call", payload: {path: "advancedKey.<method>", args: [arg]}})` (P:7743-7754; no other UI chunk references `keyboard.call`).
4. In host mode `requestDeviceAuthorization`, `getAuthorizedDevices`, `requestDeviceListAuthorization` and `getOrRequestDevices` throw ("… managed by the host application") (P:7522, 7536, 7557, 7654); `getAuthorizedDeviceList` and `isCurrentDeviceConnected` use `bridge.listDevices()` (`connectionMode = productId === 4204 ? "wireless" : "wired"`) (P:7542-7556, 7566-7573); `listenCurrentDeviceConnection` uses `bridge.subscribe` and reports `connect`/`disconnect` with `disconnectReason` (P:7574-7604); `closeDevice`/`forceCloseTransport` only clear the local reference and never destroy the host-owned `Q2` (P:7649-7652, 7730-7733).
5. The host wrapper reloads the sub-app when the active device changes and treats a `disconnected` event whose reason is **not** `"wireless-link"` as a real disconnect (HV: `c.type === "disconnected" && c.disconnectReason !== "wireless-link" && c.device?.id === s.activeDeviceId`).

---

## 9. Worked example — `getUuid()` (command `0x82`, param `0x01`)

Service call (P:2559-2567): `pkts = protocol.encode(0x82, 0x01, [0,0,0,0,0,0])` → one 63-byte packet; `await transport.send(pkts, {retry: 0})`.

### 9.1 Codec output (63 bytes)

```
idx : 00 01 02 03 04 05 06 07 08 09 0A 0B 0C .. 3D 3E
val : 82 01 00 01 00 06 00 00 00 00 00 00 00 .. 00 CS
```

`CS = 255 - ((R + 0x82 + 0x01 + 0x01 + 0x06) % 256) = 255 - ((R + 0x8A) % 256)`. For illustration only, if `R` were `0x09` then `CS = 255 - 0x93 = 0x6C` (R itself is UNVERIFIED, §1.2).

### 9.2 Wired

1. `Mo.send` queues 1 entry `{timeout 1000, retry 0, waitResponse true}`; `processQueue` → `waitForResponse(1000)` then `device.sendReport(R, pkt)` (64 bytes on the bus incl. report ID).
2. Device answers with a 63-byte input report on the same collection. Accepted iff bytes `[0]=0x82, [1]=0x01, [3]=0x01, [4]=0x00` (P:844-868); byte `[5]` = length (6 expected), bytes `[6..11]` = UUID big-endian.
3. `send` resolves `[DataView]`; `decode` → 6 bytes → `Number(BigInt)`; the app accepts the device only if it equals `0x14000000000C` (P:7374, P:5758).
4. No response within 1000 ms → reject `"命令超时"` (no retry because `retry: 0`).

### 9.3 Dongle (Wireless8K)

`r3.doSend` builds `payload = [R, 82 01 00 01 00 06 00 … 00 CS]` (64 bytes). `n3.send` splits it into 5 frames; assuming a fresh transport (`syncFlag` 0 → frames get sync 1,2,3,4,5):

| Frame | sync | b1 (total) | b2 (current) | b3 (len) | data (hex) | frame checksum | on the wire |
|---|---|---|---|---|---|---|---|
| 1 | 1 (`001`) | `0x05` | `0x01` | `0x8E` (14, bit7 set) | `R 82 01 00 01 00 06 00 00 00 00 00 00 00` | `(0x84 + R) & 0xFF` | `sendReport(R, 19 bytes)` = 20 B |
| 2 | 2 (`010`) | `0x05` | `0x82` | `0x0E` | `00 ×14` | `0xFB` | 20 B |
| 3 | 3 (`011`) | `0x05` | `0x83` | `0x8E` | `00 ×14` | `0x7C` | 20 B |
| 4 | 4 (`100`) | `0x85` | `0x04` | `0x0E` | `00 ×14` | `0xFD` | 20 B |
| 5 | 5 (`101`) | `0x85` | `0x05` | `0x88` (8) | `00 00 00 00 00 00 00 CS` | `(0x78 + CS) & 0xFF` | 13 bytes + 6 zero pad = 19 → 20 B |

Frame 1 on the wire (data part): `66 05 01 8E R 82 01 00 01 00 06 00 00 00 00 00 00 00 <cs>`.

For each frame the host waits ≤ 100 ms for an ACK `66 b1 b2 (b3 & 0x80) cs` — e.g. for frame 1: `66 05 01 80 EC` (`0x66+0x05+0x01+0x80 = 0xEC`), transaction key `"1-5-1"` — resending the identical frame up to 10 times. Only after frame 5 is ACKed does `doSend` return; the `Mo` entry's 2000 ms timer (started before frame 1) keeps running.

The reply arrives as one or more `0x66` frames from the device (each ACKed by the host with `buildAckFrame`), is re-assembled by `n3.handleInputReport` and handed to `Mo.handleInputReport`, where the same `[0]=0x82, [1]=0x01, [3]=0x01, [4]=0x00` check applies and `decode` reads bytes `[6..11]`.

---

## 10. Quick reference — constants

| Name | Value | Cite |
|---|---|---|
| VID / PID wired / PID dongle | `0x372E` / `0x10E5` / `0x106C` | P:5667, 7374 |
| usagePage / usage | `0xFF60` / `0x61` | P:5668-5669 |
| Product UUID | `0x14000000000C` (21990232555532) | P:7375 |
| Packet size / payload / checksum index | 63 / 56 / 62 | P:766-776 |
| Packet checksum | `255 - ((R + Σ bytes[0..62 with 62 = 0]) % 256)` | P:895-899 |
| Frame header | `0x66` | P:3928, 3853 |
| Frame size (data) / data per frame / max message | 19 / 14 / 64 | P:3672-3677, 3738-3743 |
| Frame checksum | `Σ & 0xFF` | P:3988-3990 |
| Sync counter | 3 bits, +1 per frame, bit2→b1.7, bit1→b2.7, bit0→b3.7 | P:3744-3746, 3928 |
| Frame ACK timeout / attempts | 100 ms / 10 | P:3673-3674 |
| Command timeout / attempts (wired, dongle) | 1000 ms ×2, 2000 ms ×4 | P:4074-4081, 1174-1175 |
| `Mo` base defaults | 500 ms, retry 3 | P:1173-1179 |
| Bubble command IDs | `0xFE`, `0x98` (param `_2.Read`), `0x94` (param 2) | P:779, 814-826 |
| Dongle link report | data length 19, `[0]=0x0A`, `[4]=0x02`, `[5]=connected` | P:906-908, 827-832 |
| Raw dongle lighting report ID | `0x09`, 19 data bytes, type nibble `0x20/0x10/0x30` | P:3088-3122 |
| Bridge command types | `k98pro.compat.get-handle`, `device.status.read`, `keyboard.call` | S:7803-7833 |
| Bridge prop keys | `deviceBridge`, `activeDeviceId`, `onDisconnect` | P:30-33, 7387, 14838 |
| Detector retry | 2 retries, `180·(n+1)` ms | P:7503-7510 |
| Post-`requestDevice` settle | 250 ms | P:7527, 7562 |
| LCD fast-path inter-report delay | 2 ms | P:7350 |

---

## Open questions

1. **Actual report ID `R`** of the K98 Pro vendor collection (usagePage `0xFF60`/usage `0x61`) — chosen at run time by `xo()` (first output report of the first collection that has both input and output reports); no constant exists in the code. Needs a descriptor dump.
2. **`xo()` property names** — resolved from the original string table (`outputReports[0].reportId`); the deobfuscated rendering prints `.collections` for that slot. The resolution is consistent with the error text `"No output report ID found"` but was not executed against the real rotation.
3. **Device→host framed reply format on the dongle** — the host tunnels `[R, packet]` (64 bytes) but the matcher expects the re-assembled reply to start with the command ID at offset 0; whether the device's reply omits a leading report-ID byte (as the code requires) is not provable from the code.
4. **`_2.Read` / `_2.Stop` numeric values** (used to classify `0x98` bubble reports) — only `_2.Start = 0` is confirmed; the other two are 1 and 2 in an unknown order.
5. **Purpose of input reports whose first data byte is `0x08`** — dropped unconditionally by `n3.handleInputReport`; the wired path has no such filter.
6. **`I9` LCD fast path on the dongle** — it would send 63-byte reports directly (bypassing the 20-byte framing); whether the UI guards this to wired mode is not covered here.
7. **Wireless8K `Mo` timeout vs. frame retries** — the 2000 ms command timer runs concurrently with up to ~5 s of frame retransmission; the effective behaviour on a lossy link (command-level retry while `n3.working` is still true → `"上一次的数据包还未发送完成!"` → treated as send failure) is inferred from the code, not observed.
8. **String value of `_e.Wired`** — the decoder slot is unresolved (`"wireless8K"` and `"wireless"` are visible); only the enum names are used by the logic.
