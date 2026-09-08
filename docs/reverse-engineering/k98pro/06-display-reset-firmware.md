# K98 Pro — LCD display, reset, version & firmware behaviour

**Scope.** This document covers the GS HUB web tool's handling of the K98 Pro gaming LCD (display service class `Qa`: capability probe, LCD/LED "profile" JSON, static and dynamic (animated) image read/write, image-transfer handshake, file headers, TABML files, time sync, progress reporting), the display settings page (presets, GIF re-encoding, IndexedDB custom images), the reset service (`Ga`), firmware-version parsing (`Za`), the UUID-prefix feature-gating helpers, the firmware-download URL keys (`Firmware-Keyboards-K98Pro-*-url`) and what the code does (and does not do) about firmware updates / OTA / DFU. All statements are taken from the deobfuscated bundles; nothing is inferred from other keyboards. Byte values are hex with decimal in parentheses. Items that could not be confirmed from code are marked **UNVERIFIED**.

## Sources

Base directory: `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/`

| Short name | File | Line ranges relied on |
|---|---|---|
| `lib` | `deob/k98pro/index-Dk7Hs9bA.js` (protocol library) | enums 440-499 & 3218-3230; byte helpers 559-606; `Ea` 766-775; `Ha` 777-925; `Mo` 1145-1310; `Ba.resetKeymaps` 1367-1371; `Ga` 2414-2445; `zt` 2447-2454; `Za` 2456-2483; `za` 2485-2685; `Qa` 3231-3473; `Xa` 3497-3550; `_e` 3660-3668; `t3`/`n3` 3672-4033; `r3` 4034-4050; gating helpers 4054-4081; `Q2` 4083-4290; `h3` 5673; `D2` 5702-5800; i18n 5823-6465; `M3` host bridge 7385-7400, 7708-7725; helpers `S9`/`I9`/`L3` 7350, 7757-7806; `D3` 7807; device store 7873-7923; keymap store 14056, 14256-14260; sidebar tabs 14544 |
| `lib-min` | `gshub/k98pro-app/js/index-Dk7Hs9bA.js` (original minified bundle) | used only to recover the rotated string table (`sn`/`l2`, offset 124, checksum 348242) that names the `I2`, `o2`, `i2`, `_e`, `j`, `F` enum members, and to confirm `Da` (4-byte big-endian) |
| `ui-screen` | `deob/k98pro/index-C2OeNjyI.js` (display settings page, 1013 lines) | GIF codec 17-197; IndexedDB 223-262; size/format constants 263-330; component setup 390-890; template 890-1010 |
| `ui-main` | `deob/k98pro/index-B0AXfBBW.js` | 137-150 (`ho`), 160-205 (device init) |
| `ui-settings` | `deob/k98pro/index-C54O2iUn.js` | 87, 353-375, 562-575 (firmware update / factory reset UI) |
| `sync` | `deob/k98pro/useProfileConfigSync-DnqHfXZR.js` | 1-140 (firmware version check) |
| `gs` | `deob/k98pro/globalSetting-CsPa239Q.js` | 60-66 (`restoreFactory`) |
| `dev` | `deob/k98pro/device-Dagr_f7U.js` | 1-36 (HID filters, UUID→firmware URL key) |
| `shell` | `deob/shell/index-Cm-TOe4o.js` | 2826-2858, 7722-7724, 7786-7835 (host provider), 8036-8123 (i18n) |
| `shell-devices` | `deob/shell/index-BfaNGY7i.js` | 1-8, 80, 114-135, 180-185 |
| `shell-fw` | `deob/shell/index-tgxuW7cu.js` | 1745-1768 (release catalogue) |
| `shell-ver` | `deob/shell/gravastar-version-api-QOhqG1vE.js` | 1-30 |
| assets | `gshub/k98pro-app/{gif,png}/figma-display-preset-*` | image dimensions via `file` |

---

## 1. Packet and transport basics needed for this area

(Full detail belongs to the codec/transport document; only what the display/reset code depends on is repeated here.)

### 1.1 63-byte command packet (`Ea`, lib 766-775; `Ha.buildCommands` 878-890)

| Byte | Meaning | Source |
|---|---|---|
| 0 | command ID | `commandIdIndex: 0` (768) |
| 1 | sub-command / parameter | `commandParamIndex: 1` (769) |
| 2 | 0 (layer/system byte for some commands; see §4) | `buildCommands` 884 writes 0 |
| 3 | total packet count (8-bit) | `totalPacketLengthIndex: 3` (770) |
| 4 | packet index (8-bit, 0-based) | `currentPacketIndex: 4` (771) |
| 5 | data length in this packet | `lengthIndex: 5` (772) |
| 6..61 | data (max **56** bytes = 63−6−1, `validDataLength` 782-787) | |
| 62 | checksum = `255 − ((reportId + Σ bytes[0..62] with byte 62 = 0) mod 256)` | `calculateCrc` 909-913 |

`encode(cmd, sub=0, payload=[], chunk=56)` (792-797) splits `payload` into `max(ceil(len/56),1)` packets. `decode(pkt, explicitLen?)` (799-815) returns `bytes[6 .. 6+min(len,56))` where `len` is the explicit argument or byte 5; for an array of packets the slices are concatenated. `isValidResponse` (852-877) accepts a report only if bytes 0, 1, 3 and 4 equal those of the request packet.

### 1.2 Wired vs 2.4 GHz transport selection (`s3`, lib 4074-4081)

| Connection | Detection | Transport | Per-command timeout / retries |
|---|---|---|---|
| Wired (PID `0x10E5` (4325)) | not in `h3` | `Mo` (lib 1145) | `timeout: 1000` ms, `retry: 1` (4078-4080) |
| 2.4 GHz dongle (PID `0x106C` (4204)) | `h3 = new Set([4204])` (5673), `D2.isWireless8K` (5788) → `_e.Wireless8K` | `r3` (4034) = `Mo` + framed `n3` | `timeout: 2000` ms (4076), retry = `Mo` default `3` (1170-1176) |

HID filters (dev 21-31): VID `0x372E` (14126), PIDs `0x10E5`/`0x106C`, usagePage `0xFF60` (65376), usage `0x61` (97). `_e` string values: `Wired="wired"`, `Wireless8K="wireless8K"`, `Wireless="wireless"` (lib 3662-3668, names resolved from `lib-min`).

`Mo.send(pkts, {progressCallback, timeout, retry, waitResponse})` (1196-1236) queues each packet; packet *i* of *N* resolves with `progressCallback((i+1)/N)`; a rejected packet calls `progressCallback(0)`. `processQueue` (1264-1297) tries `retry+1` times, each attempt waiting `timeout` for a matching response; failure rejects with `"命令超时"` (timeout) or `"发送命令失败"` (send failure).

`r3.doSend` (4043-4046) prefixes the report ID byte and hands the 64-byte buffer to `n3.send` (3729-3760), which splits it into 14-byte chunks (`validDataSize = 20−1−4−1`, 3719-3721), builds 19-byte frames `[0x66, total|(sync&4)<<5, current|(sync&2)<<6, len|(sync&1)<<7, ...data, sum&0xFF]` (`buildFrame` 3912-3916) and waits for a 5-byte ACK per frame (`sendAndWaitAck` 3865-3900) with `timeout: 100` ms, `retries: 10`, `maxPayloadLength: 64` (`t3` 3672-3677). `n3.send` throws `"上一次的数据包还未发送完成!"` if a previous send is still in flight (3730).

### 1.3 Byte helpers

| Helper | Lines | Output |
|---|---|---|
| `D(n)` | lib 591-593 (`Sa` 567, `Ia` 570) | `[ (n & 0xFF00) >> 8, n & 0xFF ]` — 16-bit big-endian |
| `Ue(n)` → `Da(n, 4)` | lib 594-598, 573-590; confirmed in lib-min | 4 bytes, most-significant first (`(n >> (i*8)) & 255` for i = 3..0) |
| `zt(bytes)` | lib 2447-2454 | list of set bit positions (`byteIndex*8 + bit`) |
| `ae(byte, bit)` | lib 601-606 | `(byte & (1 << bit)) !== 0` |

---

## 2. Display service (`Qa`, lib 3231-3473)

Registered as singleton `IDisplayService` (`Fr`, lib 3230; `Q2.registerServices` case "2", 4103-4104) and exposed as `keyboard.display` (4143-4145). Constructor takes `(protocol, transport)` (3232-3234).

### 2.1 Enumerations

| Enum | Members (value) | Lines |
|---|---|---|
| `$` display target | `Led = 0`, `Lcd = 1` | 3222-3223 |
| `ie` transfer-control command IDs | `LedRead = 0x8D (141)`, `LedWrite = 0x0D (13)`, `LcdRead = 0xA0 (160)`, `LcdWrite = 0x20 (32)` | 3228-3229 |
| `d2` pixel-data **read** command IDs | `Led = 0x8C (140)`, `Lcd = 0x9F (159)` | 3224-3225 |
| `Z2` pixel-data **write** command IDs | `Led = 0x0C (12)`, `Lcd = 0x1F (31)` | 3226-3227 |
| `o2` image kind | `Logo = 0`, `FixedDynamic = 1`, `Static = 2`, `Dynamic = 3` | 491-495 (names from lib-min) |
| `i2` transfer status | `End = 0`, `Start = 1`, `Cancel = 2` | 495-499 (names from lib-min) |
| `G2` dynamic-image format | `Uncompressed = 0x00`, `CompressedGif = 0x10 (16)` | 3220 |
| `$a` accepted MIME types for `getPixelDataFromImage` | `image/png, image/jpeg, image/jpg, image/webp, image/bmp` | 3230 |

Observation: every "read" ID equals the corresponding "write" ID with bit 7 set (`0x0D|0x80 = 0x8D`, `0x1F|0x80 = 0x9F`, `0x20|0x80 = 0xA0`), consistent with the other `0x04`/`0x84`, `0x02`/`0x82` pairs in the library.

### 2.2 Command summary

| Purpose | Cmd (byte 0) | Sub (byte 1) | Payload (bytes 6..) | Response data | Lines |
|---|---|---|---|---|---|
| Display capability probe `isSupported()` | `0x82 (130)` | `0x0C (12)` | none | 1 byte read (`decode(r, 1)`): bit 0 = `lcd`, bit 1 = `led` | 3235-3244 |
| Profile length `getProfileLength(cmd)` | `cmd` = `0xA0` (LCD) or `0x8D` (LED) | `0x05` | none | 4-byte big-endian length | 3246-3249 |
| Profile body `_getProfile(cmd)` | same | `0x05` | `length` zero bytes (multi-packet) | concatenated data → UTF-8 JSON; fallback skips first 4 bytes | 3250-3270 |
| Image transfer control `changeImageTransferStatus(cmd, kind, status, ...extra)` | `cmd` ∈ `ie` | `0x06` | `[ (status << 6) \| (kind & 0x3F), ...extra ]` | 4-byte big-endian `fileSize` | 3296-3301 |
| Pixel data read | `0x9F` (LCD) / `0x8C` (LED) | see §2.4 (byte 1 is overwritten) | zero-filled request of `fileSize` bytes | image bytes | 3302-3305, 3355-3383 |
| Pixel data write | `0x1F` (LCD) / `0x0C` (LED) | see §2.4 | header + pixels / GIF bytes | (ignored) | 3331-3335, 3385-3408 |
| Time sync `updateTime()` | `0x0B (11)` | `0x00` | 14 bytes, §2.9 | none awaited beyond ACK | 3467-3472 |

The image-transfer control byte packs status into bits 7-6 and kind into bits 5-0 (`r << 6 | e & 63`, 3297):

| Byte value | Meaning |
|---|---|
| `0x42` (66) | Start (1) + Static (2) |
| `0x02` | End (0) + Static |
| `0x43` (67) | Start + Dynamic (3) |
| `0x03` | End + Dynamic |
| `0x83`/`0x82` | Cancel (2) + Dynamic/Static — defined (`i2.Cancel`) but never sent by the code |

Extra bytes after the control byte:

| Kind | Extra bytes | Lines |
|---|---|---|
| Static | `D(index)` = 2-byte big-endian image index | 3303, 3332, 3334 |
| Dynamic | `[index, frameCount, frameIndex]` (Start) / `[index, frameCount]` (End) — single bytes | 3346, 3390, 3406 |

The `index` argument is the image slot/profile index; the display UI always passes `Bt = 0` (ui-screen 390, 780, 819).

### 2.3 Profiles (`getProfile` / `getLcdProfile`, lib 3246-3275)

Sequence (LCD; LED identical with `0x8D`):
1. `encode(0xA0, 0x05)` → response data bytes 0-3 = length `L` (big-endian, `>>> 0`).
2. `encode(0xA0, 0x05, zeros(L))` → `ceil(L/56)` request packets, each answered; `decode()` concatenates the data fields.
3. `TextDecoder("utf-8")` + `JSON.parse`. If that throws, retry on `data.slice(4)`; if that also fails: `Error("Failed to parse display profile: …")` (3254-3266).

The JSON schema is defined by firmware, not the app. The UI reads only `profile.displaySize.{w,h}` (ui-screen 447 `Et(Z.value?.displaySize, a)`, 856), falling back to **428 × 142** (ui-screen 394-397). **UNVERIFIED**: any other profile fields.

### 2.4 Image-transfer packet rewrite (`buildImageTransferPacket`, lib 3306-3312)

After `encode()` builds the packets, every pixel-data packet has bytes 1-4 overwritten and its checksum recomputed:

| Byte | Content |
|---|---|
| 1 | total packet count, high byte |
| 2 | total packet count, low byte |
| 3 | packet index, high byte |
| 4 | packet index, low byte |

i.e. the sub-command byte is sacrificed to give a 16-bit packet count/index (up to 65535 packets × 56 bytes ≈ 3.5 MB per transfer). Because `isValidResponse` compares bytes 0, 1, 3, 4, the device's reply must echo the command ID, count-high, index-high and index-low bytes. Byte 5 (chunk length) is untouched.

### 2.5 Static images

**Pixel-data blob layout** (`buildStaticImagePixelData` 3313-3326, `generateStaticImageFileData` 3327-3330):

| Offset | Size | Field |
|---|---|---|
| 0-1 | 2 | width (big-endian) |
| 2-3 | 2 | height (big-endian) |
| 4 | 1 | bitDepth |
| 5-8 | 4 | reserved, written as 0 |
| 9.. | w·h·bitDepth/8 | pixels |

On read, if width > 720 or height > 720 the result is `{width:0,height:0,bitDepth:0,data:[]}` (3316-3322) — a sanity guard, not a documented maximum.

**Read sequence** (`_readStaticImagePixelData` 3302-3305):
1. `changeImageTransferStatus(0xA0, Static, Start, idx_hi, idx_lo)` → `fileSize`.
2. `encode(0x9F, 0, zeros(fileSize))` → `buildImageTransferPacket` → `transport.send` (all packets, each awaiting its reply).
3. `decode` → blob above. (No `End` status is sent for reads.)

**Write sequence** (`_writeStaticImagePixelData` 3331-3335):
1. `changeImageTransferStatus(0x20, Static, Start, idx_hi, idx_lo)`.
2. `encode(0x1F, 0, [w_hi,w_lo,h_hi,h_lo,bitDepth,0,0,0,0, ...pixels])` → rewritten packets → send.
3. `changeImageTransferStatus(0x20, Static, End, idx_hi, idx_lo)`.

The display page exposes `readLcdStaticImagePixelData(0)` behind a hidden (`display:none`) button (ui-screen 787-798, 899-902) and interprets the returned bytes as RGB888 (`w·h·3`) or RGB565 (`w·h·2`, big-endian `hi<<8|lo`, expanded with `r<<3|r>>2`, `g<<2|g>>4`, `b<<3|b>>2`) — see `Yr`/`Jr`/`ea` (ui-screen 296-360). Note `Jr` indexes source as `(i*h+v)*2` and destination as `(v*w+i)*3`, i.e. it transposes column-major device data into row-major preview data. The page never calls `writeLcdStaticImagePixelData`; static pictures are uploaded as single-frame GIFs (§3.4).

### 2.6 Dynamic (animated) images

**18-byte file header** (`generateDynamicImageFileHeader` 3409-3417; parsed by `parseDynamicImageFileHeader` 3336-3344):

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0-1 | 2 | frameCount | big-endian |
| 2 | 1 | fps | |
| 3-4 | 2 | width | big-endian |
| 5-6 | 2 | height | big-endian |
| 7 | 1 | bitDepth | UI always sends 24 (`Lt`, ui-screen 390) |
| 8 | 1 | 0 | |
| 9 | 1 | format | `0x00` Uncompressed / `0x10` CompressedGif |
| 10-13 | 4 | total file size (big-endian, `Ue`) — CompressedGif only, else 0 | throws `"When using CompressedGif format, dynamicImageFileSize must be greater than 0"` if size ≤ 0 (3410-3413) |
| 14-17 | 4 | 0 | |

`parseDynamicImageFileHeader` only decodes bytes 0-7; the format/size bytes are ignored on read.

**LCD vs LED difference (write)**: `_writeDynamicImagePixelData` (3385-3408) uses `CompressedGif` + `fileSize` for `$.Lcd` and `Uncompressed` + 0 for `$.Led` (3391). So the LCD receives a real GIF byte-stream; the LED path would receive raw frames.

**Metadata read** (`_getDynamicImageMetadata` 3355-3362): `changeImageTransferStatus(0xA0, Dynamic, Start, idx, 0, 0)` → `fileSize`; then `encode(0x9F, 0, zeros(18))` (one packet) → header fields + `fileSize`.

**Frame read** (`_readDynamicImagePixelData` 3363-3383): after metadata, for each frame `l` in `0..frameCount-1`: `changeImageTransferStatus(0xA0, Dynamic, Start, idx, frameCount, l)` → `frameSize`; `encode(0x9F, 0, zeros(frameSize))` → send with `progressCallback(p ⇒ cb(((l+1)/frameCount)·p))`; after each frame `cb((l+1)/frameCount)`. Frame 0's first 18 bytes (the header) are stripped (3380-3382).

**Frame write** (3385-3408):
```
for l in 0..frameCount-1:
    changeImageTransferStatus(0x20, Dynamic, Start, idx, frameCount, l)
    body = (l == 0) ? header18 + frames[0] : frames[l]
    send(buildImageTransferPacket(encode(0x1F, 0, body)),
         progressCallback = h => cb(l/frameCount + h/frameCount))
    cb((l+1)/frameCount)
finally:
    changeImageTransferStatus(0x20, Dynamic, End, idx, frameCount)
```
The `End` status is sent from a `finally`, so it is issued even after a failed frame. Errors are re-thrown unchanged.

### 2.7 TABML files (`parseTabmlFile`, lib 3418-3442)

| Offset | Size | Field |
|---|---|---|
| 0-4 | 5 | ASCII `"tabml"` (else `Error("Invalid file format")`) |
| 5 | 1 | frameCount (must be ≠ 0) |
| 6 | 1 | fps |
| 7 | 1 | **height** |
| 8 | 1 | **width** |
| 9-31 | 23 | ignored (header is 32 bytes) |
| 32.. | frameCount·w·h·3 | raw RGB888 frames (exact length required, else `Error("Invalid file content")`) |

Result: `{frameCount, fps, width, height, frames[], bitDepth: 24, fileSize: total file length}`. Width/height are 8-bit here, so a 428-px-wide TABML cannot be described by this header — **UNVERIFIED** whether TABML is used with the K98 Pro at all (the UI accepts `.tabml` uploads: `Rt = /\.tabml$/i`, ui-screen 263).

### 2.8 `getPixelDataFromImage` (lib 3277-3295)

Accepts `File`/`Blob` whose `type` is in `$a`; rejects empty files (`"Empty image file"`) and load failures (`"Failed to load image"`); draws the image at natural size on a canvas and resolves with `ImageData` (RGBA). It is **not called** anywhere in the UI chunks (the display page performs its own conversion, §3).

### 2.9 Time sync (`updateTime`, lib 3467-3472)

`encode(0x0B, 0x00, payload)` with payload:

| Byte | Value |
|---|---|
| 0-2 | 0, 0, 0 |
| 3 | year & 0xFF (low byte first — **little-endian** year) |
| 4 | year >> 8 |
| 5 | month (1-12) |
| 6 | day of month |
| 7 | hours (local) |
| 8 | minutes |
| 9 | seconds |
| 10 | weekday `Date.getDay()` (0 = Sunday … 6 = Saturday) |
| 11-13 | 12, 12, 12 (constant; meaning **UNVERIFIED**) |

The UI calls it silently 1 s after the display has been initialised (initialisation itself starts 450 ms after mount: `ft` → `Wt` → `gt(true)` then `Dt(false)`, ui-screen 492-500) and with toasts from the "Sync Time" button (`Dt`, 799-814).

### 2.10 Progress and throughput

* Library path: progress is emitted per 56-byte packet by `Mo.send` (§1.2) and scaled per frame (§2.6). Every packet waits for a device reply (wired 1000 ms/1 retry; wireless 2000 ms/3 retries plus 100 ms/10-retry frame ACKs).
* Fast path `I9` (lib 7769-7805, exported as `N`, imported by the page as `Pr`): for LCD writes the page calls `I9(display, 0, image, cb)` (ui-screen 819). `I9` temporarily replaces `transport.send` with a function that, **only when `progressCallback` is supplied**, calls `device.sendReport(reportId, pkt)` for every packet sequentially with a 2 ms `setTimeout` between packets (`L3`, `b3 = 2`, lib 7350-7352), never waits for a reply, reports `sent/total`, and returns `[]`. Calls without `progressCallback` (i.e. `changeImageTransferStatus`) still go through the original queued `send`. The patch is removed in `finally`. If `transport.send/device/reportId` are missing the normal path is used (7770-7773). Consequence: the Start/End handshakes are acknowledged, but pixel packets are fire-and-forget with no CRC/ACK feedback.
* Size limits enforced by the page: 3 MiB per file (`Or = 3*1024*1024`, ui-screen 272) for GIF, PNG/JPG (after re-encoding) and TABML. At 56 B/packet a 3 MiB file is ≈56 000 packets.
* Because `I9` bypasses `r3.doSend`, on the 2.4 GHz link it would emit unframed 63-byte reports (**UNVERIFIED** whether the dongle accepts them). The page shows the static hint `screen.screenTips = "Tip: This feature is unavailable in 2.4G mode"` (lib 6407; ui-screen 897) but does not gate the buttons on connection type.
* After an apply the page calls `T2.forceCloseTransport()` (`Nt`, ui-screen 471-473; lib 7731-7739) which closes the HID device (non-host mode) so the next operation re-opens it.

---

## 3. Display settings page (`ui-screen`)

### 3.1 Initialisation

`S9` (lib 7761-7768, exported `j`, imported as `br`) = `keyboard.display` → `isSupported()` → `getLcdProfile()`; throws `app.unsupportedLcdDisplay` ("This device does not support the gaming display", lib 6461) if `lcd` bit is clear. The page caches `{display, profile}` (`gt`, ui-screen 531-553) and derives the target size `q = profile.displaySize ?? {w:428,h:142}` (447).

### 3.2 Presets (ui-screen 369-373, 406-427)

| id | Label key | Thumbnail | GIF | Asset size |
|---|---|---|---|---|
| 4 | `screen.presetThree` | `figma-display-preset-4-DPCyAOUh.png` (856×284) | `figma-display-preset-4-LOXWCh1c.gif` (684×228) | via chunk `figma-display-preset-4-Ck54wnn7.js` |
| 1 | `screen.presetOne` | `figma-display-preset-1-9ri4xWoI.png` (428×142) | `figma-display-preset-1-D10kuLZy.gif` (428×142) | |
| 2 | `screen.presetTwo` | `figma-display-preset-2-DdnC88M2.png` (856×284) | — | |
| 3 | `screen.presetThree` | `figma-display-preset-3-C340f5Kl.png` (856×284) | — | |

Order in the list is 4, 1, 2, 3; default selection `_ = 4` (ui-screen 400). Preset GIF previews start after a 900 ms delay (`vt`, 486-490). Applying a preset fetches the GIF/PNG (`or`, 774-778) and treats it like an upload (`Ra = !0` forces GIF re-encoding for presets, 390, 859).

### 3.3 Uploads and IndexedDB (ui-screen 223-262, 263-272, 495-520)

* Accepted: `image/gif|png|jpeg` MIME or `.gif/.png/.jpe?g/.tabml` names (`Hr`, `Vr`, `Rt`, 263); `<input accept="image/gif,image/png,image/jpeg,.gif,.png,.jpg,.jpeg">` (952). Otherwise `screen.unsupportedFileType`.
* Normalisation `nr` (711-735): TABML → size check only; GIF → `It` re-encode; PNG/JPG → `Jt` (617-625): keep as-is if ≤3 MiB **and** exactly `w×h`, else letter-box onto a black `w×h` canvas (`At`, 361-368) and export PNG, falling back to JPEG q=0.96 (`Ma`, 390) if the PNG exceeds 3 MiB.
* Stored in IndexedDB database `"gravastar-screen-display"` v1, object store `"custom-images"` keyed by `id` (UUID or `Date.now()-random`) with index `createdAt`; record `{id,name,type,size,lastModified,createdAt,blob,previewBlob}` (223-256). TABML entries get a generated placeholder preview (`ar`, 706-710).

### 3.4 What is actually sent to the LCD (`dr`, ui-screen 827-881)

| Source | Conversion | Payload to `I9(display, 0, img, cb)` |
|---|---|---|
| `.tabml` | `display.parseTabmlFile(file)`; rejects if `fileSize` > 3 MiB | raw RGB888 frames as parsed; the library still writes an LCD header tagged `CompressedGif` + `fileSize` (§2.6) — **UNVERIFIED** how firmware treats a TABML upload |
| GIF | `It` (651-705): decode with bundled `GifReader`; if already `w×h` and ≤3 MiB keep; else composite every frame (disposal 2/3 handled), letter-box to `w×h`, quantise to an **R3G3B2 256-colour palette** (`d = {red:3,green:3,blue:2}`, 398-402; `_t`/`er` 626-636), write with `GifWriter` (loop 0, per-frame delay = summed source delays capped at 65535 cs, disposal 1); retry loop over `profiles` (only one profile: `frameStep 1`), error `screen.deleteFramesRetry` if still > 3 MiB. `sr` (736-746) then wraps the whole GIF file as **one frame**: `{width:w,height:h,bitDepth:24,fps:round(100/avgDelay_cs) (min 1, default 10 when no delays),frameCount:1,fileSize,frames:[gifBytes]}` | 18-byte header (`CompressedGif`, size) + entire GIF file in one dynamic "frame" |
| PNG/JPG | `ir` (747-773): letter-box to `w×h`, quantise each pixel to `r&0xE0 \| (g&0xE0)>>3 \| b>>6` (RGB332), write a single-frame GIF (delay 100 cs, R3G3B2 palette), `fps: 1`, `frameCount: 1` | same as GIF |

So on the K98 Pro every LCD upload — including "static" pictures — travels through `writeLcdDynamicImagePixelData` as a `CompressedGif` payload with `frameCount = 1`, meaning one `Start(idx=0, frameCount=1, frame=0)` handshake, one bulk transfer, one `End(idx=0, frameCount=1)`.

### 3.5 Progress UI

`at` (815-826) maps `I9` progress to a per-target percentage (`rt`, 812; `Ut` rounds 0..1 → 0..100, 291-294); an apply mask with a progress bar is teleported to `body` (985-1005). `applySuccess`/`applyFailed` toasts (lib 6449-6450). A generation counter (`v`) and `fe()` guard discard stale progress after re-selection or unmount (`pt`, 474-478).

---

## 4. Reset service (`Ga`, lib 2414-2445)

`reset({type, layer?, system?})` (2418-2422): `encode(0x11 (17), encodeLayerAndSystem(layer ?? j.Normal, system ?? F.Windows), [type])` → `transport.send` (awaits the device reply).

Byte 1 = `layer & 3 | (system & 7) << 2` (`encodeLayerAndSystem`, lib 917-919). Layer `j`: `Normal=0, Fn1=1, Fn2=2, Tap=3`; system `F`: `Windows=0, MacOS=1` (names from lib-min). Byte 6 = reset type:

| Method | `I2` value (byte 6) | Name | Lines | Caller in UI |
|---|---|---|---|---|
| `resetKeyboard(opts)` | `0x00` | `FullReset` | 2428-2433 | `gs.restoreFactory` (gs 60-66) via `Q2.resetKeyboard` (lib 4178-4180) — "Factory Reset" card in settings (ui-settings 353-375, 570-575; i18n lib 6242-6251). After the command it clears persisted keymap baselines, resets custom lighting, clears the keyboard instance, waits 1200 ms and re-acquires the keyboard (`getKeyboard({force:true})`) |
| `resetKeymap(opts)` | `0x01` | `KeyReset` | 2434-2439 | not called directly; the keymap service has its own identical `Ba.resetKeymaps({layer, system})` (lib 1367-1371) used by `resetLayerKeyMap` (lib 14256-14260, "Reset This Layer" / "Reset All Layers", lib 5964-5969) |
| `resetLighting(opts)` | `0x02` | `LightReset` | 2440-2444 | no UI caller found (the lighting "reset" in the store, lib 14483-14485, writes black custom colours instead) |
| `resetUSB()` | `0x03` | `USBReset` | 2423-2427 (layer/system default 0/0) | exposed as `Q2.resetUSB` (lib 4277-4279); no UI caller found |

Value-to-name mapping comes from the rotated string table (`I2`: index 227 = "FullReset" → 0, 231 = "KeyReset" → 1, 225 = "LightReset" → 2, 234 = "USBReset" → 3; lib 490-491).

---

## 5. Version, UUID and feature gating

### 5.1 Firmware version (`za.getFirmwareVersion`, lib 2568-2575; `Za`, 2456-2483)

Request `encode(0x82 (130), 0x02, [0,0])` → response data `[a, s]` → `Za(s << 8 | a)` (byte 0 = low, byte 1 = high).

| `Za` getter | Formula | Example for raw `0x0117` |
|---|---|---|
| `rawValue` | 16-bit value | 279 |
| `major` | `(v >> 8) & 0xFF` | 1 |
| `minor` | `(v >> 4) & 0xF` | 1 |
| `subminor` | `v & 0xF` | 7 |
| `hex` | `"0x" + 4 hex digits` | `0x0117` |
| `toString()` | `major.minor.subminor` | `1.1.7` |

The manager prefixes `V` when missing (`getConnectedDeviceSnapshot`, lib 7716-7724; shell provider `device.status.read`, shell 7805-7810). `getDeviceInfo` (lib 4166-4177) returns `{uuid, firmwareVersion: rawValue, deviceVersion: Za, keyboardType, isTriMode, maxPollingRate}`.

### 5.2 UUID (`za.getUuid`, lib 2559-2567)

`encode(0x82, 0x01, zeros(6))` sent with `retry: 0`; the 6 response bytes are folded big-endian into a `Number` (48-bit). The device store renders it as `0x` + 12 hex digits (lib 7920-7923); `x0()` (lib 4057-4059) does the same for the gating helpers.

### 5.3 Prefix-gating helpers (lib 4054-4073) — applied to the **UUID**, not the firmware version

| Helper | True when 12-hex-digit UUID starts with | Used for |
|---|---|---|
| `i3(uuid)` | `0x11` or `Do()` | `keyboardType = Magnetic` else `Mechanical` (lib 4168) |
| `Do(uuid)` | `0x12` | part of `i3`/`o3` |
| `a3(uuid)` | `0x14`, `0x15` or `_o()` | part of `o3` |
| `_o(uuid)` | `0x16` | `maxPollingRate = 1000` else `8000` (lib 4175) |
| `o3(uuid)` | `Do() \|\| a3()` = `0x12/0x14/0x15/0x16` | `isTriMode` (lib 4174) |

Known K98 Pro UUID constants (dev 9; also shell 2825): `0x14000000000C` (21990232555532, `_`/`Wi` → US layout), `0x14000000000E` (…534, → UK layout / `uk` firmware), `0x14000000000F` (…535, → JP layout / `ja` firmware). The keymap store maps UUID → layout variant `us/uk/jp` (`_u`, lib 10591-10595; `Pu`, `setLayoutVariantByDeviceUuid` 14056-14066). With prefix `0x14` a K98 Pro therefore evaluates as `Mechanical`, `isTriMode = true`, `maxPollingRate = 8000` unless the firmware reports a different UUID (**UNVERIFIED** for other batches). Nothing in the code gates a feature on `firmwareVersion` prefixes; the only firmware-version comparison is the update check (§6.2). `getKeyboardType()` in `za` (2596-2603) alternatively uses "any supported switch bits" (`0x82/0x03`).

### 5.4 Device feature bitmap (`za.getDeviceFeatures`, lib 2660-2685)

`encode(0x82, 0x0F (15))`, `decode(r, 56)` padded to 56 bytes:

| Byte | Bit(s) | Feature |
|---|---|---|
| 0 | 0 | `lcdDisplay` |
| 0 | 1 | `dotMatrixDisplay` |
| 1 | any | `lowPowerMode` |
| 2 | any | `wirelessDedicatedChannel` |
| 3 | 0 / 1 | `winMode` / `macMode` |
| 4 | any | `wasdArrowSwap` |
| 5-6 (BE) | 0 / 1 | `wheel` / `slider` |
| 7-8 (BE) | value | `maxUrlLength` |
| 9 | 0..4 | `keyIdRGB`, `fullKeysRGB`, `ledBeadTable565`, `ledBeadRGB565` (bits 3 **and** 4) |
| 12 | 7 / 0-2 | `switchMixing` / `switchTriggerStage` (`TwoStage` when low 3 bits == `m0.TwoStage`) |

The main page calls it once at device init (`getDeviceFunction`, ui-main 172) but the display page relies on `isSupported()` (§3.1) rather than `lcdDisplay`. Related probes: `checkWirelessDedicatedSupported` = `0x82/0x0E`, `checkLowPowerModeSupported` = `0x82/0x0D`, `isSupported` = `0x82/0x0C` (lib 2656-2659, 2636-2639, 3236).

---

## 6. Firmware download URLs and update flow

### 6.1 URL keys

`dev` 10-18 (`I`, exported `d`) and shell 2826-2834 (`k3`, exported `f`):

| Condition | Key |
|---|---|
| UUID == `0x14000000000E` | `Firmware-Keyboards-K98Pro-uk-url` |
| UUID == `0x14000000000F` | `Firmware-Keyboards-K98Pro-ja-url` |
| otherwise, locale `zh_CN` | `Firmware-Keyboards-K98Pro-cn-url` |
| otherwise | `Firmware-Keyboards-K98Pro-en-url` |

The shell firmware catalogue (shell-fw 1745-1768) lists the same four `versionType` keys (`platform: "windows"`). Manual keys: `Instructions-K98Pro-zn-url` / `Instructions-K98Pro-en-url` (shell-devices 180). Resolution: `POST /gravastar-version` with body `type:<key>` (`Content-Type: application/x-www-form-urlencoded` in shell-ver 8-16, `text/plain` in sync 29-39); the response body is a single `https:` URL (shell-ver rejects non-https with `"invalid-url"`).

### 6.2 Update check inside the K98 Pro app (`sync` 42-110)

`T(uuid)` fetches the file name for `$(uuid, localStorage["zlxq-starter-locale"])`, extracts `V\d+(\.\d+)*` from it (`Z`, 72-78; a dotted-less number such as `V117` becomes `V1.1.7`), stores `latestVersion`/`latestFirmwareURL`, retries once on failure. `A(deviceVersion, checked)` compares numeric components (`ee`, 79-90) and sets `hasFirmwareUpdate`. The check is scheduled on idle after device init (`ho`, ui-main 137-147; `Yn` = sync `he`). Defaults: `firmwareVersion "V0.1.0"`, `latestVersion "V1.1.7"` (sync 42).

UI (ui-settings 87, 353, 562-570; i18n lib 6237-6250): shows "Keyboard Firmware Version", "Latest version {version}", an "Update" tag, and an "Update Firmware" button whose handler is `window.open(latestFirmwareURL, "_blank")` — or a toast "Firmware is already up to date" when current. The shell devices page (shell-devices 114-135) similarly resolves the URL, derives the version from the filename and triggers a browser download (`<a download>`).

### 6.3 OTA / DFU / bootloader

No HID command, service, or UI path performs an in-band firmware update. Searching all k98pro and shell chunks for `dfu`, `bootloader`, `ota`, `iap`, `jumpToBoot` finds nothing except the IndexedDB `onupgradeneeded` handler. The device store listens for a `usbChange` event of type `"isUpgrading_disconnect"` and has `setUpdateStatus(isUpdate)` (lib 7873-7880, 7904-7906), but nothing in the K98 Pro bundles ever emits that event type — it is a listener-only legacy branch. Firmware updates are delivered as downloadable Windows files (`platform: "windows"`) outside the web tool.

---

## 7. Other display-related plumbing

* URL service `Ja.setUrls` (lib 3479-3495): `encode(0x23 (35), 0, table + entries)`; each entry `[nameLen, ...name, ...url]`, preceded by a 4-byte-per-entry table `[offset_lo, offset_hi, len_lo, len_hi]` (little-endian, offsets start at `4·count`). `getUrls` throws `"Not implemented yet"`. Not called from the display page.
* Host-managed mode: when running inside the GS HUB shell (`window.$wujie.props.deviceBridge` + `activeDeviceId`, lib 7385-7392) the app obtains the shell's `Q2` instance via `invoke(deviceId, {type:"k98pro.compat.get-handle"})` (7393-7399) and `M9` proxies calls as `{type:"keyboard.call", payload:{path, args}}` (7742-7751); the shell executes them by walking `path` on its own keyboard object (shell 7826-7834). `I9`'s fast path works on that handle because it patches the handle's `transport` directly.
* Sidebar tab: `{key:"screen", icon:"display-screen"}` (lib 14544), label `tabs.screen = "Display Settings"` (lib 5851).

---

## Open questions

1. **2.4 GHz behaviour of `I9`**: the fast path emits raw 63-byte reports through `device.sendReport`, bypassing the `0x66` framing used by `r3`/`n3`; whether the dongle accepts unframed reports is UNVERIFIED. The UI only shows a static "unavailable in 2.4G mode" hint and does not disable the Apply button.
2. **LCD profile JSON schema**: only `displaySize.{w,h}` is consumed; the remaining fields returned by `0xA0/0x05` are UNVERIFIED.
3. **`updateTime` trailing bytes `12,12,12`** and the 3 leading zero bytes have no decoding in the code.
4. **Static-image pixel format on the device**: the read path accepts either RGB565 (2 B/px, big-endian, column-major per `Jr`) or RGB888; which one firmware returns, and whether writes with `bitDepth` 16 are supported, is UNVERIFIED (the UI never writes static images).
5. **TABML on K98 Pro**: header uses 8-bit width/height, incompatible with 428×142; whether firmware accepts a TABML payload tagged `CompressedGif` is UNVERIFIED.
6. **Transfer-status `Cancel` (2)** and image kinds `Logo` (0) / `FixedDynamic` (1) are defined but never sent; their firmware semantics are unknown.
7. **Maximum transfer size**: 16-bit packet count × 56 B ≈ 3.5 MiB; the page's 3 MiB limit is an app constant, not a device-reported value.
8. **`resetUSB` (`0x11`, type 3) and `resetLighting` (type 2)** have no UI callers; device-side effects are unknown.
9. **UUID prefix gating**: real K98 Pro UUIDs start with `0x14`; whether other prefixes (`0x11/0x12/0x15/0x16`) ever appear for this product is unknown, so `keyboardType`, `isTriMode` and `maxPollingRate` derived from them may not reflect K98 Pro hardware.
10. **`isUpgrading_disconnect`** is never produced in these bundles; a native/Electron host may emit it, which could not be verified here.
