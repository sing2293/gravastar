# Compx Mouse HID Transport and Command Set

**Scope.** This document describes, strictly from the recovered Compx HUB WEB source (Vue 2 / WebHID), how the web driver finds and opens a Compx mouse or dongle, the 16-byte report format it exchanges on report ID 0x08, the additive checksum and the "0x55" invariant, the send/retry/echo-match state machine, the response dispatcher (every command case and every decoded flag bit), the device-info / "EncryptionData" handshake and device-type mapping (wired vs dongle), online/battery polling and battery smoothing, the pairing flow, the flash/EEPROM read/write primitives with their address map, profile read/write and factory reset, and a complete table of the `Command` enum with payload and response layouts. Field-level EEPROM semantics (DPI encoding, key functions, macros, lighting) are only summarised here where they touch the transport; they are covered by the sibling documents. Everything is cited as `file:line`. Where the code is inconsistent or the behaviour could not be confirmed from code alone it is marked **UNVERIFIED**.

## Sources

Root: `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/controlhub/src/webpack_/vue_test/src`

| File | Line ranges relied on | What |
|---|---|---|
| `assets/js/HIDHandle.js` | 1-189 (changelog header), 191-201 (imports, `visit`), 204-252 (`Command` enum), 255-298 (`MouseEepromAddr`), 300-369 (keyboard address maps), 372-420 (enums), 422-467 (globals/timers), 469-862 (`deviceInfo` model), 875-1220 (device request/open/close, 1125-1133 HID event listener registration), 1223-1624 (`read_HID_Buffer` dispatcher), 1626-1757 (`Send_HID_Buffer`, CRC, `Send_Command*`), 1761-1979 (info, online incl. 1809-1826 `Get_Device_Online_With_Dialog`, battery, pairing, restore, 1940-1951 upgrade hand-off, profile), 1986-2121 (dongle RGB / long range), 2139-2311 (motor, OLED, office music), 2314-2380 (EEPROM primitives), 2382-2540 (`Update_Device_Param`, `Write_Mouse_Flash`), 2542-2688 (timeouts, `Read_Device_Flash`, `Get_Online_Interval`), 2803-2912 (`Update_Mouse_Info`), 3054-3075 (report rate), 5464-5471 (visit/driverOnline), 5473-6620 (export list; 6598-6620 exported state/enums) | transport + command set |
| `assets/js/BatteryHandle.js` | 1-301 (whole file) | battery smoothing / voltage-to-percent |
| `assets/js/UserConvert.js` | 1-161 (whole file) | report-rate and colour encoders |
| `assets/js/UpgradeHandle.js` | 60-135, 1060, 1176-1178 | only to note the different report IDs used by the bootloader path |
| `views/Home.vue` | 137, 216-310, 311-419, 422-442, 514-538 | how `cfg.json` VID/PIDs become WebHID filters; connect flow; per-model config injection (388-405); reconnect from history (429-437) |
| `views/Mouse.vue` | 150-156, 183-190 | `Device_Close` on window close; offline-dialog consumer |
| `components/Dialog/PairDialog.vue` | 1-163 | UI side of pairing |
| `components/*.vue`, `views/*.vue`, `main.js` | `components/Key/Profile.vue` 30, `components/Key/Other.vue` 71-136/181, `components/Setting/AdvancedSetting.vue` 39/59, `components/Setting/DongleRgb.vue` 40, `components/Setting/Oled.vue` 260-287/567-626, `components/Setting/SleepTime.vue` 33-58, `views/MouseLight.vue` 232-240, `components/Battery.vue` 44-51, `main.js` 39-116 | call sites |

---

## 1. Device discovery and HID collection selection

### 1.1 VID / PID filters

* The driver does **not** hard-code a device list. `main.js:47` fetches `cfg.json` from the site root and emits it as `driverCfg`; `Home.vue:250-286` flattens `driverCfg.pid.mouse.wireless[]`, `driverCfg.pid.mouse.wired[]`, `driverCfg.pid.keyboard.wireless[]`, `driverCfg.pid.keyboard.wired[]` into WebHID filters `{vendorId: parseInt(driverCfg.vid), productId: parseInt(pid)}` and calls `HIDHandle.Request_Device(filters)` (`Home.vue:288`). If `driverCfg.vid == ''` the connect button is disabled (`Home.vue:518-519`). In demo/visit mode an **empty** filter list is used (`Home.vue:246-248`), i.e. any HID device is offered.
* `cfg.json` was **not** recovered in the scratchpad, so the full supported PID list is **UNVERIFIED**. The only concrete IDs in the source are the documentation example `vendorId: "0x3554", productId: "0xF516"` (`HIDHandle.js:5481-5482`) and the upgrade-file comment `vid_3554&pid_f502&mi_01&col05` (`UpgradeHandle.js:91-94`, a bootloader endpoint example).
* Device kind (mouse vs keyboard) is decided in `Home.vue:292-305` by comparing the PID lists against `HIDHandle.devicePID`. Note `HIDHandle.js:918` stores `device.vendorId` (not productId) into `devicePID`, and the exported `devicePID` (`HIDHandle.js:6609`) is a load-time snapshot of an `undefined` variable, so this comparison never matches and `deviceInfo.type` is simply whatever the Home page `device` dropdown holds (`type = this.device`, `Home.vue:243`; `v-model="device"` at `Home.vue:25`; page default `"mouse"`, `Home.vue:137`). **UNVERIFIED** whether the production bundle differs; the recovered source behaves as described.
* The CID/MID reported by the device (see section 6) are matched against `driverCfg.mouse[i].cid` / `driverCfg.mouse[i].cfg[j].mid` to pick the per-model configuration (`Home.vue:352-368`); `cid == 0 || mid == 0` is treated as "device offline / not paired" (`Home.vue:351-352, 381-384`), and an unmatched pair shows "device unsupported" (`Home.vue:370-374`).

### 1.2 Report ID and collection choice

| Item | Value | Citation |
|---|---|---|
| Vendor report ID used for everything in normal mode | `ReportId = 0x08` (8) | `HIDHandle.js:422` |
| Collection selection rule | the first collection with **exactly one input report and exactly one output report** whose `outputReports[0].reportId == 0x08` | `HIDHandle.js:890-894` (also 994-998, 1113-1116) |
| Bootloader report IDs (upgrade path only) | normal-mode reset report 8, boot-mode 6 (overridden from the upgrade file header), and feature-report ID `0x0C` in the flashing helper | `UpgradeHandle.js:133-134, 530-531, 1060, 1176` |

`Request_Device` (`HIDHandle.js:875-930`): `navigator.hid.requestDevice({filters})`; for the first matching collection it stores `device`, records `productName` in `localStorage['hidDevices']` (897-906), opens the device if needed (910-913), sets `deviceInfo.deviceOpen = true`, installs the input-report handler `read_HID_Buffer()` (916), registers the disconnect handler (919), then immediately runs the `Get_Device_Info()` handshake (922) and returns `true`.

Other entry points that open the same collection:

| Function | Behaviour | Citation |
|---|---|---|
| `Get_HistoryDevicesInfo()` | `navigator.hid.getDevices()`; guarded by the re-entrancy flag `gettingHistoryDevicesInfo` (965, 970); if the device list differs (`deepEqual`, 946-963) from the cached `historyDevices`, every 0x08 collection is opened, `read_HID_Buffer()` installed, `Get_Device_Info()` + `Get_Device_Online()` run, and a record `{device, cid, mid, isWired, reportRate, online}` pushed to `historyDevicesInfos` (1000-1052; the type→`isWired`/`reportRate` mapping is a copy of the table in section 6.2). If the list is unchanged only `online` is refreshed per device (1064-1073). Returns `historyDevicesInfos` (also exported, 6614). Note it does **not** install `Device_Disconnect()` nor set `devicePID` | 967-1080 |
| `Get_Current_Device_Online(device)` | open + `read_HID_Buffer()` + one `Get_Device_Online()`; returns the boolean | 1082-1094 |
| `Device_Reconnect(device)` | open + `read_HID_Buffer()`, `devicePID = vendorId`, `Device_Disconnect()`, `Get_Device_Info()` — same as `Request_Device` minus the chooser and the `localStorage` bookkeeping. Called from the Home page history list (`handleDeviceReconnectClick`, `Home.vue:429-437`), which then reuses the cached `{cid, mid}` for `deviceConnect` | 1135-1150 |

### 1.3 Connect / disconnect events

* `navigator.hid` `connect` event: debounced 200 ms, sets `hidDeviceChangeEvent.value = true` (`HIDHandle.js:1099-1108`).
* `disconnect` event: only honoured if the disconnected device has `collections.length >= 2` and one of them is the 0x08 output collection (1110-1122).
* `Device_Disconnect()` installs `navigator.hid.ondisconnect`, matching on `productName`, then `Handle_Exit()` (clears all timers, stops battery smoothing) and `deviceInfo_Restore()` (1196-1204, 1187-1193, 1180-1184).
* `Device_Close()` (driver-initiated): sends `Set_PC_Satae(0)` if `driverOnlineFlag`, then `Handle_Exit`, then `device.close()` unless in visit mode (1207-1220). It is called on `beforeunload` (`Mouse.vue:153`), on the 30 s connect timeout (`HIDHandle.js:2685`) and on any exception during the connect sequence (2671).
* The `connect`/`disconnect` listeners above are only active between `Add_Listen_HID_Events()` and `Remove_Listen_HID_Events()` (1125-1133, exported at 5523/5525); the UI observes the exported `hidDeviceChangeEvent` object (1097, 6615) to refresh the history list.
* `clear_All_Interval()` (1152-1172) clears `pairTimerID`, `batteryTimerID`, `onlineTimerID`, `getFlashTimerID` with `clearInterval` and `sendHIDBufferTimerID` with `clearTimeout`. `Handle_Exit()` (1187-1193) assigns `historyDevices = []` **twice** and never clears `historyDevicesInfos` — the second line was presumably meant for `historyDevicesInfos`; as written the cached info list survives a disconnect until `Get_HistoryDevicesInfo` sees a changed device list.

### 1.4 Visit (demo) mode — `Set_Visit_Mode(flag)` (`HIDHandle.js:201, 5465-5467`)

`visit` is a module-level flag set from the UI when `driverCfg.visit` is true (`Home.vue:245-247` uses it together with `driverCfg.demo` to pass an empty filter list). Its effects on the transport:

| Where | Effect | Citation |
|---|---|---|
| `Request_Device` | returns `connect = true` for the first chooser result **without** opening any collection or sending anything | 885-888 |
| `Send_HID_Buffer` | returns `true` immediately — no `sendReport`, no echo wait | 1635-1637 |
| `Get_Device_Online_With_Dialog` | returns `true` (the online byte is never read) | 1814-1816 |
| `Device_Connect` | whole body skipped (no dongle params, no online poll) | 933 |
| `Device_Restore` | returns after the online check; no reset frame | 1884-1885 |
| `Set_Device_Profile` | skips `Update_Device_Param()`; `GetCurrentConfig` replies never trigger a re-read | 1965-1968, 1493 |
| `Device_Close` | skips `device.close()` | 1216-1219 |

`Get_Device_Online()` (1799-1806) is **not** visit-aware: it still calls `Send_Command`, which returns immediately, and then inspects the stale `receivedData[5]`.

---

## 2. Packet layout

Every request is a 16-byte `Uint8Array` sent with `device.sendReport(0x08, data)` (`HIDHandle.js:1647`); the report ID is passed separately and is **not** inside the 16 bytes. Responses arrive as `event.data.buffer` (report ID stripped by WebHID) and are read into `receivedData` (1226).

| Offset (in the 16-byte body) | Request meaning | Response meaning | Citation |
|---|---|---|---|
| `[0]` | command ID (`Command.*`) | echoed command ID | 1730, 1228 |
| `[1]` | always `0x00` | status: `0x00` = OK, `0x01` = error / unsupported; any other value only clears the busy flag | 1730, 1230, 1599, 1621 |
| `[2]` `[3]` | flash address big-endian for `0x07`/`0x08`; chunk index (1-based, BE) for `0x31`; otherwise 0 | echoed (address for `0x07`/`0x08`) | 2315, 2328-2329, 2372, 2222, 1328, 1338 |
| `[4]` | payload length `+ get_type_length()` (mouse `0x00`, keyboard/officeKeyboard `0x80`) | echoed; for flash replies the length is taken as `[4] & 0x0F` | 1734, 1751, 1717-1726, 1329, 1339 |
| `[5]..[14]` | payload, max 10 bytes, zero-padded | payload | 1735-1737, 2331-2336 |
| `[15]` | checksum: `get_Crc(data) - ReportId` (see section 3); initialised to the placeholder `0xEF` before the checksum is computed | not checked by the driver | 1731, 1740, 1754, 2338 |

So the wire frame is `08 | cmd 00 addrH addrL len d0..d9 crc` (17 bytes including report ID). The 0x80 "type" flag in `[4]` is the only difference between mouse and keyboard framing.

---

## 3. Checksums

### 3.1 `get_Crc` (additive, "0x55 complement")

```
get_Crc(v):                       # HIDHandle.js:1693-1701
  s = sum(v[0 .. len-2])          # excludes the last byte (the CRC slot)
  return 0x55 - (s & 0xFF)        # may be negative in JS; stores modulo 256 in a Uint8Array
```

For packets the caller stores `data[15] = get_Crc(data) - 0x08` (1740, 1754, 1862, 1896, 2232, 2338, 2362, 2377, 2574), which makes

`(0x08 + data[0] + ... + data[15]) mod 256 == 0x55`

i.e. **the report ID byte is part of the sum**. For EEPROM sub-records (DPI entries, colours, key functions, light record, shortcut/macro blocks) the same function is used **without** the `- ReportId` term, so `sum(record) mod 256 == 0x55` (e.g. 3249, 3266, 3335, 3539, 3883, 4059, 4094, 4138, 4317).

### 3.2 `check_crc` (verification)

```
check_crc(v, start, end):         # HIDHandle.js:1703-1715
  return (sum(v[start .. end-1]) & 0xFF) == 0x55
```

Used only for the office-keyboard custom-light header (4579). The mouse code checks the same invariant inline for 2-byte EEPROM value pairs: `((flash[a] + flash[a+1]) & 0xFF) == 0x55` (2841, 2845-2846, 2859, 2863, 2868, 2880, 2886-2905) and for the 4-byte flywheel record (2872-2873).

### 3.3 Two-byte EEPROM value encoding

`Set_Device_Eeprom_Value(addr, v)` writes `[v, 0x55 - v]` (2355-2360). `Update_Mouse_Info` accepts an optional field only if the pair sums to 0x55; otherwise it is treated as "not supported by this firmware" (e.g. `supportAngleTune = false`, 2845-2857).

### 3.4 Other checksums

* `Update_Device_Param` first finds `endFFFlash` = index of the last non-`0xFF` byte in `0x000-0x0FF` (2397-2401), then walks the same range accumulating bytes and resetting the accumulator each time `(acc & 0xFF) == 0x55` (2413-2416); `flashEndAddress = endFFFlash` is assigned only when a `0xFF` byte at or beyond `endFFFlash` is reached with the accumulator at a record boundary (`acc == 0`, 2404-2409) — otherwise `flashEndAddress` keeps its previous value (initially 0, 431). It is used only to bound the profile **import** write size (2446-2447; the export path does not reference it).
* Keyboard "SyncCRC" slots use a standard CRC-32 (poly `0xEDB88320`, init/xorout `0xFFFFFFFF`, stored big-endian) (5236-5274, 5166-5215). Not used for mice.
* Macro blocks: when name and contexts are written as one buffer (`Get_Macro_Value`), the CRC is computed with `get_Crc` over `[entries..., crcslot]` **without** the count byte and `contexts.length` is then subtracted to account for the count byte at `+0x1F` (4334, 4364-4365); when the context block is written on its own (`Get_MacroContext_Value`) the count byte is inside the buffer and the plain `get_Crc([count, entries..., crcslot])` is used (4287, 4316-4317). Both give `sum(count + entries + crc) mod 256 == 0x55`.

---

## 4. Send path

### 4.1 `Send_HID_Buffer(data)` — `HIDHandle.js:1632-1690`

```
if visit: return true                                   # 1635-1637 (no USB traffic in visit mode)
index = 0; sendCount = -1
while index < 5:                                        # 1642  -> at most 5 transmissions
  if sendCount != index:
    sendingFlag = true                                  # 1645
    device.sendReport(0x08, data)                       # 1647  (exception -> return false, 1650-1653)
    Send_HID_Buffer_Timeout(200)                        # 1648  200 ms timer sets sendHIDBufferTimerTimeOut
    sendCount = index
  if sendHIDBufferTimerTimeOut: index++                 # 1657-1659  timeout -> resend
  elif sendingFlag == false:                            # 1660  a report-ID-8 input report arrived
    n = 5 if data[0] == 0x08 else 3                     # 1662-1665  ReadFlashData compares cmd,status,addrH,addrL,len
    for j in 0..n-1:
      if receivedData[1] === 1: return true             # 1668-1670  device said "error/unsupported": treated as done
      if data[j] != receivedData[j]: mismatch; break    # 1672-1675
    if all matched: return true                         # 1678-1680
    index++                                             # 1682  echo mismatch -> resend
  sleep(1 ms)                                           # 1685
return false                                            # 1687-1689 "Send_HID_Buffer error count max"
```

Semantics worth noting:

| Behaviour | Detail | Citation |
|---|---|---|
| Timeout per attempt | 200 ms (`Send_HID_Buffer_Timeout(200)`); implemented with `setInterval` and cleared with `clearTimeout` on the next send | 1648, 2546-2552 |
| Retries | up to 5 sends total, on timeout or on echo mismatch | 1642, 1659, 1682 |
| Echo match | first 3 bytes (`cmd, status, [2]`) for all commands; first 5 bytes for `ReadFlashData` (`0x08`), so address and length are verified only for reads. For `WriteFlashData` (`0x07`) only `cmd, status, addrH` are compared | 1662-1676 |
| "Status 1" | `receivedData[1] === 1` returns **true** immediately; callers cannot distinguish NAK from ACK except through dispatcher side effects (e.g. `supportLongDistance = false`) | 1668-1670, 1599-1620 |
| Busy flag | `sendingFlag` is cleared by **any** report-ID-8 input report, including unsolicited `StatusChanged` (0x0A). A `StatusChanged` arriving mid-request therefore fails the echo compare and triggers a resend | 1225, 1621 |
| Stale data | `Get_Device_Online` reads `receivedData[5]` after `Send_Command` regardless of success, so a timed-out request re-uses the previous packet | 1800-1805 |

### 4.2 `Send_Command(cmd)` / `Send_Command_With_Value(cmd, value)`

* `Send_Command` builds `[cmd, 0,0,0, type, 0..0, 0xEF]`, `data[4] = get_type_length()`, computes the checksum and calls `Send_HID_Buffer`; it **returns `undefined`** (1747-1757).
* `Send_Command_With_Value` additionally sets `data[4] = value.length + type` and copies `value[i]` into `data[5+i]`, returning the `Send_HID_Buffer` result (1729-1744). Payloads must be at most 10 bytes; several callers deliberately pad to 10 (`new Uint8Array(10)`, e.g. 1987, 2029, 2055, 2107).
* Because `Send_Command` returns `undefined`, every "get" wrapper built on it (`Get_Device_Online`, `Get_Device_Profile`, `Get_Device_Version`, `Get_Dongle_Version`, `Get_Device_*RGB*`, `Get_Device_LongDistance`, `Get_Device_MotorParam`, `Get_Device_PairResult`) cannot detect a send failure; only `Get_Device_Info` (built on `Send_Command_With_Value`) does, returning `{}` instead of `{cid, mid, type}` when all 5 attempts fail (1777-1786). `Home.vue:351` then evaluates `undefined != 0` as true and falls through to the "device unsupported" dialog rather than the "offline" one.

### 4.4 Online gate — `Get_Device_Online()` vs `Get_Device_Online_With_Dialog()`

| Function | Behaviour | Callers | Citation |
|---|---|---|---|
| `Get_Device_Online()` | `Send_Command(0x03)`; returns `receivedData[5] === 1`. Does not touch `deviceInfo.online` (the dispatcher does) | `Get_HistoryDevicesInfo`, `Get_Current_Device_Online`, `Get_Device_Battery`, `Get_Online_Interval`, keyboard sync/import (1042, 1071, 1092, 1832, 2630, 4219, 5168, 5219, 5278) | 1799-1806 |
| `Get_Device_Online_With_Dialog()` | same request; in visit mode returns `true`; otherwise if `[5] != 1` sets `deviceInfo.online = false` **and** `deviceInfo.showOfflineDialog = true`, returns `false` | the guard at the top of virtually every setter: `Device_Restore`, `Set_Device_Profile`, `Set_Device_LongDistance`, `Write_Mouse_Flash`, the office-keyboard commands, and every `Set_MS_*` / `Set_KB_*` EEPROM setter (≈95 call sites, 1882-5149; e.g. 3055, 3079, 3089, 3231, 3329, 3545, 3615, 4049, 4171) | 1809-1826 |

`Mouse.vue:183-190` watches `info.online`; when it turns false with `showOfflineDialog` set it shows `DialogOffline` once and clears the flag. Setters return the gate result, so the UI reverts the control when `false` (e.g. `MouseLight.vue:232-240`, `Profile.vue:30`). Note `Set_MS_XSpindown`/`Set_MS_YSpindown` (3104-3110), `Set_Device_Eeprom_*` themselves, `Set_Device_4KDongleRGB*`, `Set_Device_DongleRGBBar*`, `Set_Dongle_3RGBMode`, the motor setters and `Set_Device_OLEDPicture` are **not** gated.

### 4.3 Direct `device.sendReport` bypasses (no retry / no echo check)

| Function | Command | Why | Citation |
|---|---|---|---|
| `Device_Restore` | `0x09` ClearSetting | fire-and-forget, then polls `deviceInfo.isRestoring` every 300 ms up to 20 times for any type other than `"keyboard"` (i.e. mouse **and** officeKeyboard) / 4 times for `"keyboard"` (`cnt = type != "keyboard" ? 20 : 4`) | 1890-1903 |
| `Set_Device_OLEDPicture` | `0x31` SetOLEDPicture | streams `ceil(len/10)` 10-byte chunks with 5 ms gaps (`[4]` is always `0x0A` even for a short last chunk, 2227); on a status-1 reply (`oledSetErrorFlag`) waits 100 ms and restarts the whole image, up to 3 passes; returns `oledSetErrorFlag == false` | 2218-2247 |
| `Read_Device_Flash` | `0x08` ReadFlashData | has its own loop (section 9.3) | 2554-2625 |

---

## 5. Receive path — `read_HID_Buffer` dispatcher (`HIDHandle.js:1223-1624`)

Handler: `device.oninputreport`; only `event.reportId === 0x08` is processed (1225). `command = receivedData[0]`; the `status` byte `receivedData[1]` selects the branch.

### 5.1 Status `0x00` cases

| Command | Bytes decoded | Effect | Citation |
|---|---|---|---|
| `0x01` EncryptionData | `[9]`=cid, `[10]`=mid, `[11]`=type | sets `deviceInfo.info.*`, `isWired`, `maxReportRate` (table in section 6) | 1233-1267 |
| `0x02` PCDriverStatus | — | nothing | 1270-1271 |
| `0x03` DeviceOnLine | `[5]`=online (1 = online), `[6]`=addr[2], `[7]`=addr[1], `[8]`=addr[0] | `deviceInfo.online`, 3-byte `deviceInfo.addr` (used as the battery localStorage key `bat_<addr0><addr1><addr2>`) | 1274-1280, `BatteryHandle.js:32-34` |
| `0x04` BatteryLevel | `[5]`=level %, `[6]`=charging (`==1`), `[7]<<8 \| [8]`=voltage | raw values stored, then replaced by the smoothed display level from `BatteryHandle` (section 7.3). Gating: if `batteryOptimize == false` and `batteryOptimizeInit == false` the first reply calls `BatteryHandle.batteryHandleInit(addr, battery)` (needs `deviceInfo.addr` from a prior `0x03` reply); both flags are then set true. `batteryOptimize` is cleared when the device goes offline (1839) and both are cleared by `battery_Handle_Exit()` on disconnect (1174-1178), so `batteryHandleInit` runs again only after a full disconnect | 1283-1301 |
| `0x05` DongleEnterPair | — | `getBatteryFlag=false`, reset pair counters, start `pairTimerID = setInterval(Get_Device_PairResult, 1000)` | 1303-1309 |
| `0x06` GetPairState | `[5]`=pairStatus (1 Pairing, 2 Fail, 3 Success), `[6]`=pairLeftTime | on Fail/Success: re-enable battery polling (if Connected) and stop the pair timer | 1311-1324, 406-410 |
| `0x07` WriteFlashData | `[2]<<8 \| [3]`=addr, `[4] & 0x0F`=len, `[5..]`=data | echoed bytes are copied into the local `flashData` mirror | 1326-1334 |
| `0x08` ReadFlashData | same layout | copies into `flashData`; if the (addr,len) pair is one of the "hot" mouse fields — `(0x00,2) (0x04,2) (0x4C,8) (0xA0,7) (0x0A,2) (0xA9,2) (0xAB,2) (0xE9,2)` — calls `Update_Mouse_Info()`; keyboard equivalents call `Update_Keyboard_Info` / `Update_Keyboard_LightChange` | 1336-1366 |
| `0x09` ClearSetting | — | `deviceInfo.isRestoring = false` | 1368-1370 |
| `0x0A` StatusChanged | `[5]`=flags, `[6]`=flags1, `[13]`=left `currentRoute`, `[14]`=right `currentRoute` | see 5.3 | 1372-1488 |
| `0x0E` GetCurrentConfig | `[5]`=profile | `supportChangeProfile = true`; if a profile-change was signalled via StatusChanged (`getCurrentPorfileFlag`), re-reads all params and sets `Connected` | 1490-1499 |
| `0x0F` SetCurrentConfig | — | nothing | 1501-1503 |
| `0x12` ReadVersionID | `[5]`=major (decimal), `[6]`=minor (2-digit **hex**) | `version.device = "v<major>.<minor:02x>"` | 1505-1509 |
| `0x14` Set4KDongleRGB | `[5]`=mode, `[6..8]`,`[9..11]`,`[12..14]`=RGB colours 1-3 | `dongle4KRGB` | 1511-1516 |
| `0x15` Get4KDongleRGBValue | same | same | 1518-1523 |
| `0x16` SetLongRangeMode | — | nothing | 1525-1526 |
| `0x17` GetLongRangeMode | `[5]`==1 → on | `supportLongDistance = true`, `longDistance` | 1528-1531 |
| `0x18` SetDongleRGBBarMode | `[5]`=mode, `[6..8]`=RGB, `[9]`=speed, `[10]`=brightness, `[11]`=time | `dongleRGBBar` | 1533-1539 |
| `0x19` GetDongleRGBBarMode | same | same | 1541-1547 |
| `0x1D` GetDongleVersion | `[5]`,`[6]` as for 0x12 | `version.dongle` | 1549-1553 |
| `0x2C` SetDongle3RGBMode | `[5..7]`=mode per LED | `dongle3LEDRGB.mode[0..2]` | 1555-1559 |
| `0x2D` GetDongle3RGBMode | same | same | 1561-1565 |
| `0x31` SetOLEDPicture | — | `oledSetErrorFlag = false` | 1567-1569 |
| `0x2F` GetMotorParam | `[5] & 0x0F`=mode, `[6..8]`=levels[0..2], `[9..11]`: low nibble `& 0x03` = buttons[2i], `(>>4) & 0x03` = buttons[2i+1], `[12]`=switches | `mouseCfg.motor` (the commented "old" layout at 1572-1580 packed mode/levels into nibbles of `[5..6]`) | 1571-1592 |
| `0xB7` OfficeCustomLightState | — | nothing | 1594-1596 |

Commands that can be received but have **no** status-0 case (silently ignored apart from clearing `sendingFlag`): `0x0B 0x0C 0x0D 0x10 0x11 0x2E 0x30 0x32 0xB0 0xB1 0xB2 0xB6 0xF0 0xF1`.

### 5.2 Status `0x01` cases (1599-1620)

| Command | Effect | Citation |
|---|---|---|
| `0x17` GetLongRangeMode | `supportLongDistance = false` | 1604-1606 |
| `0x0E` GetCurrentConfig | `supportChangeProfile = false` | 1608-1610 |
| `0x1D` GetDongleVersion | `version.dongle = "v1.0"` (assumed legacy dongle) | 1612-1614 |
| `0x31` SetOLEDPicture | `oledSetErrorFlag = true` (aborts the chunk stream) | 1616-1618 |

After either branch `sendingFlag = false` (1621).

### 5.3 `StatusChanged` (0x0A) flag bits

Unconditionally (before the type check) `trigger.left.currentRoute = [13]`, `trigger.right.currentRoute = [14]` (1376-1377).

Mouse (`deviceInfo.type == "mouse"`, 1378-1440):

| Byte | Mask | Meaning | Driver reaction | Citation |
|---|---|---|---|---|
| `[5]` | `0x01` | DPI stage changed | `Get_MS_CurrentDPI()` (read `0x04`,2) | 1380-1382 |
| `[5]` | `0x02` | report rate changed | `Get_MS_ReportRate()` (read `0x00`,2) | 1385-1387 |
| `[5]` | `0x04` | profile changed | `Get_Device_Profile()` guarded by `getCurrentPorfileFlag`/`setCurrentPorfileFlag` | 1390-1395 |
| `[5]` | `0x08` | DPI indicator light changed | `Get_MS_DPILightEffect()` (read `0x4C`,8) | 1398-1400 |
| `[5]` | `0x10` | LOGO light changed | no-op | 1403-1405 |
| `[5]` | `0x20` | light strip changed | `Get_MS_Light()` (read `0xA0`,7) | 1408-1410 |
| `[5]` | `0x40` | battery percentage changed | `Get_Device_Battery()` | 1413-1415 |
| `[5]` | `0x80` | reserved | no-op | 1418-1420 |
| `[6]` | `0x01` | LOD changed | `Get_MS_LOD()` (read `0x0A`,2) | 1423-1425 |
| `[6]` | `0x02` | key debounce time changed | `Get_MS_DebounceTime()` (read `0xA9`,2) | 1428-1430 |
| `[6]` | `0x04` | motion sync changed | `Get_MS_MotionSync()` (read `0xAB`,2) | 1433-1435 |
| `[6]` | `0x08` | flywheel mode changed | `Get_MS_FlywheelState()` (read `0xE9`,2) | 1438-1440 |

Keyboard (`"keyboard"` / `"officeKeyboard"`, 1441-1487): `[5]` bits `0x01` reserved, `0x02` report rate → `Get_KB_ReportRate`, `0x04` system switch → `Get_KB_CurrentSystem`, `0x08` factory reset done → `isRestoring=false`, `0x10` light on/off → `Get_KB_LightState`, `0x20` FN-lock (no-op), `0x40` battery → `Get_Device_Battery`, `0x80` light params → re-read mode/params/music state.

---

## 6. Device info, "EncryptionData" handshake, device type

### 6.1 `Get_Device_Info()` — `HIDHandle.js:1761-1787`

Request: `Send_Command_With_Value(0x01, [r0, r1, r2, r3, 0, 0, 0, 0])` where `r0..r3` are random bytes 0-255 (1767-1770). Payload length byte `[4] = 8` (+0x80 for keyboards). No client-side verification of the reply "challenge" is performed — the driver simply reads `cid`, `mid`, `type` from the reply (1234-1236) and returns `{cid, mid, type}` (1779-1783). The name "encryption" therefore does not imply any cryptography visible on the host side; what the firmware does with the random bytes is **UNVERIFIED**.

Reply layout: `[9]` = CID (customer ID), `[10]` = MID (module ID), `[11]` = device type (1234-1236). Bytes `[5..8]` are not read. A CID or MID of 0 means the dongle has no paired/online mouse (`Home.vue:351-352`).

### 6.2 Device type byte → link type and maximum report rate (1237-1266, 6522-6528)

| `type` | Meaning | `isWired` | `maxReportRate` |
|---|---|---|---|
| `0x00` (0) | dongle 1K | false | 1000 |
| `0x01` (1) | dongle 4K | false | 4000 |
| `0x02` (2) | wired 1K | true | 1000 |
| `0x03` (3) | wired 8K | true | 8000 |
| `0x04` (4) | dongle 2K | false | 2000 |
| `0x05` (5) | dongle 8K | false | 8000 |

Any other value leaves `isWired = false` and `maxReportRate` unchanged (1252-1266). The `deviceInfo.info.type` field comment at 477 still says "3: wired_4K"; the code (1248-1251) uses 8000. The same mapping is duplicated verbatim in `Get_HistoryDevicesInfo` (1005-1032) for the history list's `isWired`/`reportRate` fields, and documented in the export comment (6522-6528).

### 6.3 Where wired vs dongle changes behaviour

| Situation | Dongle (`isWired == false`) | Wired | Citation |
|---|---|---|---|
| `Device_Connect()` | first `Get_Dongle_Param()` = `GetDongleVersion` (0x1D), `Get4KDongleRGBValue` (0x15), `GetDongleRGBBarMode` (0x19), `GetDongle3RGBMode` (0x2D) — but only when `deviceInfo.type == "mouse"`; a wireless keyboard gets none of them | skipped | 933-943, 2036-2043 |
| `Get_Online_Interval()` | `GetLongRangeMode` (0x17) if the model config defines `defaultLongDistance` and type is mouse; `GetDongleVersion` is sent in both cases | `supportLongDistance = false` | 2645, 2650-2660 |
| `Device_Restore()` | after reset, re-sends `Get_Dongle_Param`, `SetLongRangeMode(default)` and `Set4KDongleRGB(default)` | skipped | 1906-1924 |
| `Update_MS_SensorModeDisplay()` | (only while `fps20k` is off) LP/HP selectable below 2000 Hz; at 2000/4000 the 3955 is forced to HP (1), other sensors to corded (256); 8000 Hz always corded | always "corded" mode (256), selector disabled | 3765-3794 |
| Online check `DeviceOnLine` (0x03) | used for presence of the paired mouse | still sent; the reply for a wired mouse is **UNVERIFIED** (presumably always 1) | 1799-1806 |

### 6.4 Transport-level `deviceInfo` fields (`HIDHandle.js:469-522`)

The exported `deviceInfo` object (6604) is the only channel from the dispatcher to the UI. Fields that belong to the transport (as opposed to `mouseCfg` / `keyboard`, covered in the sibling documents):

| Field | Default | Written by | Line |
|---|---|---|---|
| `deviceOpen` | `false` | `Request_Device` / history / reconnect (`true`), `deviceInfo_Restore` (`false`) | 470 |
| `connectState` | `Disconnected` | `Update_Device_Param` (Connecting), `Get_Online_Interval`/`Set_Device_Profile`/`Device_Restore`/`GetCurrentConfig` reply (Connected), `Write_Mouse_Flash` (Connecting→Connected) | 471 |
| `online` | `false` | `0x03` reply (raw byte `[5]`), `Get_Device_Online_With_Dialog` (`false`) | 472 |
| `addr[3]` | `[]` | `0x03` reply, bytes `[8],[7],[6]` → `addr[0..2]` | 473 |
| `info.cid / mid / type` | `1 / 1 / 1` | `0x01` reply `[9],[10],[11]` | 474-478 |
| `pairCID` | `0` | `Set_Pair_CID` | 479 |
| `type` | `"mouse"` | `Home.vue:305` (`"mouse"`, `"keyboard"`, `"officeKeyboard"`) — selects `get_type_length()` and the dispatcher branch | 480 |
| `isWired`, `maxReportRate` | `false`, `1000` | `0x01` reply (section 6.2) | 481-482 |
| `battery.level / charging / voltage` | `20 / false / 0x0E90` | `0x04` reply, then `level` overwritten by `BatteryHandle` | 483-487 |
| `batteryOptimizeInit`, `batteryOptimize` | `false` | `0x04` reply, `Get_Device_Battery` (offline), `battery_Handle_Exit` | 488-489 |
| `version.dongle / device` | `"--"` | `0x1D` / `0x12` replies (`"v1.0"` on status 1 for the dongle); reset to `"--"` by `deviceInfo_Restore` | 490-493 |
| `supportChangeProfile`, `profile` | `false`, `0` | `0x0E` reply (status 0 / 1), `Set_Device_Profile` | 494-495 |
| `isRestoring` | `false` | `Device_Restore` (`true`), `0x09` reply / keyboard `0x0A` bit `0x08` (`false`) | 496 |
| `showOfflineDialog` | `false` | `Get_Device_Online_With_Dialog`; consumed and cleared by `Mouse.vue:186-188` | 497 |
| `dongle4KRGB {mode, color1..3}`, `defaultDongle4KRGB` | mode 0, all `rgb(255,0,0)` | `0x14`/`0x15` replies; default `mode` injected from `deviceCfg.dongle4KRGB.mode` (`Home.vue:399-401`) and re-applied by `Device_Restore` | 498-509 |
| `dongleRGBBar {mode, color, speed, brightness, time}`, `defaultDongleRGBBar` | `0, rgb(255,0,0), 3, 3, 1` | `0x18`/`0x19` replies; the default is no longer re-applied on restore (commented out with date 2026.04.16, 1926-1932) | 510-516, 520-526 |
| `dongle3LEDRGB.mode[3]` | `[]` | `0x2C`/`0x2D` replies | 517-519 |

### 6.5 State enums (`HIDHandle.js:406-420`)

| Enum | Members | Used at |
|---|---|---|
| `DevicePairResult` | `Pairing 1`, `Fail 2`, `Success 3` | `pairResult.pairStatus` (`0` = idle/not started, 1306); `GetPairState` reply (1315-1324); `PairDialog.vue:79-121` |
| `DeviceConectState` (sic) | `Disconnected 0`, `Connecting 1`, `Connected 2`, `TimeOut 3` | `deviceInfo.connectState`; `TimeOut` is never actually stored because of the `==` at 2684; `Get_Mouse_KeyFunctions` only runs while `Connecting` (2916) |

Both enums are exported (6618, 6621).

---

## 7. Connection lifecycle, online and battery polling

### 7.1 Sequence

1. `Request_Device` → open → `Get_Device_Info` (0x01) — `HIDHandle.js:875-930`.
2. UI matches CID/MID (`Home.vue:348-374`) and, before connecting, injects the per-model configuration into `deviceInfo`: `mouseCfg.sensor.type = deviceCfg.sensor`, `mouseCfg.sensor.cfg = this.sensor[sensor] || null`, `mouseCfg.defaultLongDistance = deviceCfg.longDistance`, `defaultDongle4KRGB.mode = deviceCfg.dongle4KRGB.mode` (if present), `Set_DriverOnline(deviceCfg.driverOnline)` (`Home.vue:388-405`). `sensor.type == "3955"` and `defaultLongDistance` steer the transport later (sections 6.3, 9.4). Then `Device_Connect()` — `Home.vue:413` — and `updateMaxReportRate` is broadcast to the UI (417).
3. `Device_Connect`: dongle params (0x1D, 0x15, 0x19, 0x2D) if wireless; then `Get_Online_Interval()`; if the device is offline, `onlineTimerID = setInterval(Get_Online_Interval, 1500)` — 933-943.
4. `Get_Online_Interval()` (2629-2676) when `DeviceOnLine` (0x03) answers online:
   * stop the 1500 ms poll; start `getFlashTimerID = setInterval(Get_Flash_Time_Tick, 1000)` — 30 ticks (30 s) in state `Connecting` → `Device_Close()` (2678-2688; note 2684 uses `==` instead of `=`, so `TimeOut` is never actually stored). `Read_Device_Flash` resets `getFlashTimerTickCount = 0` whenever **any** input report clears `sendingFlag` (2585-2586, before the echo compare), so this is a 30 s **inactivity** watchdog, not a bound on total connect time;
   * `Set_PC_Satae(1)` if `driverOnlineFlag` (2636-2639);
   * `Update_Device_Param()` (bulk flash read, section 9.4) → `Get_Device_Profile()` (0x0E) → `Get_Device_Version()` (0x12) → `Get_Dongle_Version()` (0x1D) → `getBatteryFlag = true` → `Get_Device_Battery()` → `Get_Device_MotorParam()` (0x2F) → `Get_Device_LongDistance()` (0x17, wireless mouse only) → `connectState = Connected` (2642-2661);
   * clear the flash tick timer; `batteryTimerID = setInterval(Get_Device_Battery, 5000)` (2663-2668).

### 7.2 Timers

| Timer | Period | Purpose | Citation |
|---|---|---|---|
| `onlineTimerID` | 1500 ms | `DeviceOnLine` until the mouse appears | 940, 1842 |
| `getFlashTimerID` | 1000 ms × 30 | connect-phase watchdog | 2634, 2681 |
| `batteryTimerID` | 5000 ms | `Get_Device_Battery` (which first sends `DeviceOnLine`, then `BatteryLevel` only if online; if offline it drops back to the 1500 ms online poll and resets `batteryOptimize`) | 2668, 1830-1845 |
| `pairTimerID` | 1000 ms × 20 | `GetPairState` polling | 1308, 1871 |
| `sendHIDBufferTimerID` | 200 ms | per-send timeout | 1648, 2551 |
| BatteryHandle `level1TimerID` | 10 s | ±1 % display drift | `BatteryHandle.js:62, 74-98` |
| BatteryHandle `level2TimerID` | 60 s | +1 % while charging above 85 % | `BatteryHandle.js:58, 100-109` |

`getBatteryFlag` gates battery reads and is cleared during pairing (1304), factory reset (1889), mouse profile import `Write_Mouse_Flash` (2443) and keyboard profile import `Import_KB_Profile` (5277); ordinary `Set_Device_Eeprom_*` writes do not touch it.

### 7.3 Battery decoding and smoothing (`BatteryHandle.js`)

* Raw reply: `level` %, `charging`, `voltage` (16-bit BE; the threshold table 3050…4110 and the default `0x0E90` = 3728 indicate **millivolts** — unit inferred, **UNVERIFIED**) — `HIDHandle.js:1284-1286`.
* If `voltage > 0`, the percentage is **recomputed from voltage** (`isBatVol`, `BatteryHandle.js:28, 51-53, 114-116`) using the 21-entry table at 12-13: find the first `voltages[i] > voltage`; `level = (voltage - voltages[i-1]) / ((voltages[i] - voltages[i-1]) / 5) + (i-1)*5`, i.e. 5 % per table interval; `voltage < 3050` → index 0 → level 0, which the bump rule below then turns into 1; `voltage > 4110` → 100 (99 while charging); `voltage == 4110` exactly matches neither branch (index stays −1) and yields 0 with no bump; otherwise a result of exactly 0 or 15 is bumped by +1 (205-243).
* Initial display level = `calculationBattery(lastLevel, factLevel, secondsSinceLastSave)`: after >1800 s trust the device (`factLevel`); <60 s keep the stored level; otherwise the result is `lastLevel` **unless** `factLevel` lies outside `[lastLevel − 0.014·s, lastLevel + 0.028·s]` (bounds themselves limited to 0…100), in which case the violated bound is used — i.e. a `factLevel` inside the window does **not** move the display (245-281). With no stored entry `sec` defaults to 2000, so the device value is trusted (41). Stored per device address in `localStorage['bat_<addr>']` (34, 192-198).
* `setDisplayLevel` on every reply: while charging at `level == 100` it re-queries `Get_Device_Battery()` up to 10 times and only shows 100 after 8 consecutive readings (178-187); when discharging, a raw `battery.level == 0` forces the display to 0 (145-146) and `level <= 15` snaps the display to 15 once (`lowBattery` latch, 153-159, released when charging starts, 176); `SupChangeBat` (30 % jump correction) is never set true (6, 162-173). Each call also decides which drift timer is armed: `displayLevel >= 85 && level >= 95 && charging` enables the 60 s timer and disables the 10 s one, anything else the reverse (123-140).
* Drift timers (started once by `batteryHandleInit`, 57-63; `batteryHandleInit` itself enables the 10 s timer unless `displayLevel > 95 && charging`, 65-70): `level1TimerTick` (10 s) — charging: `displayLevel++` only while `factLevel < 100` **and** `factLevel - 10 > displayLevel` (a 10 % hysteresis), handing over to the 60 s timer once `displayLevel >= 85`; discharging: `displayLevel--` while `factLevel < displayLevel` and `displayLevel > 0` (74-98). `level2TimerTick` (60 s) — `displayLevel++` while charging and `< 99`, clamped to 100 (100-109). `batteryHandleExit` clears both timers and both enables (283-294).
* Module exports: `batteryHandleInit`, `setDisplayLevel`, `batteryHandleExit`, `getDisplayLevel`, plus a load-time snapshot `displayLevel` (always 0) (296-302). `BatteryHandle` imports `HIDHandle` back (1) for the re-query at 181 — a circular import that works because it is only dereferenced at call time.
* `deviceInfo.battery.level` is overwritten with the display level before the UI sees it (`HIDHandle.js:1293, 1299`; `Battery.vue:48-51`).

### 7.4 `Set_PC_Satae(value)` (sic) — PCDriverStatus 0x02

`Send_Command_With_Value(0x02, [value])`: `1` when the driver goes online after the first successful online check, `0` before `Device_Close`/upgrade (1790-1794, 2638, 1210, 1943). Only sent when `driverOnlineFlag` is true, which comes from the model config `deviceCfg.driverOnline` (`Home.vue:403`, `HIDHandle.js:5469-5471`). The comment at 1789/1210 says it is "no longer needed for the web version".

### 7.5 Hand-off to the firmware updater — `Set_Device_EnterUpgrade()` / `Set_Device_ExitUpgrade()` (1940-1951)

| Step | Action | Citation |
|---|---|---|
| Enter | `Set_PC_Satae(0)` if `driverOnlineFlag`; `Handle_Exit()` (all timers + battery smoothing stopped, **without** closing the device or resetting `deviceInfo`); `UpgradeHandle.DeviceOpen(device)` hands the open `HIDDevice` to the bootloader path, which from then on talks on its own report IDs (section 1.2) and installs its own `oninputreport` | 1940-1947 |
| Exit | `Device_Connect()` if a `device` exists — i.e. dongle params + the 1.5 s online poll + full re-sync as in section 7.1 | 1949-1951 |

The `EnterUsbUpdateMode` enum member (`0x0D`) is not what triggers the reset: `UpgradeHandle` sends the `resetToUpdateModeCmd` bytes taken from the upgrade-file header (`UpgradeHandle.js:95, 797`), whose report ID also replaces `normalReportId` (533).

---

## 8. Pairing flow (dongle ↔ mouse)

1. UI: space bar on the Home page opens the pair dialog after `requestDevice()`; `Set_Pair_CID(driverCfg.mouse[0].cid)` pre-loads the CID to pair with (`Home.vue:216-236`, `HIDHandle.js:1847-1850`).
2. Start: `Set_Device_EnterPairMode()` (`PairDialog.vue:85`, `HIDHandle.js:1853-1865`) sends `DongleEnterPair` (0x05) with `[4] = 2 (+type)`, `[5] = 0x00`, `[6] = 0x00`, `[7] = pairCID || info.cid`. Note the length byte says 2 but a third payload byte `[7]` carries the CID — observed as written; whether firmware reads `[7]` is **UNVERIFIED**.
3. On the status-0 reply: `pairResult.pairStatus = 0`, `getBatteryFlag = false`, and `Get_Device_PairResult` is polled every 1000 ms (1303-1309).
4. `Get_Device_PairResult()` sends `GetPairState` (0x06); after 20 polls without Success/Fail it forces `pairStatus = Fail`, sets `getBatteryFlag = true` **unconditionally** (unlike the reply path, which requires `Connected`) and stops the timer (1868-1878). (The `result == false` check at 1871 can never fire because `Send_Command` returns `undefined`.)
5. `GetPairState` reply: `[5]` = 1 Pairing / 2 Fail / 3 Success, `[6]` = seconds left (default 20 in `pairResult`, 450-453). Success/Fail stops the timer and re-enables battery polling if already Connected (1311-1324).
6. UI shows Pairing/Success/Fail from `pairResult.pairStatus` and closes on success (`PairDialog.vue:104-121`).

---

## 9. Flash / EEPROM access

### 9.1 Write — `WriteFlashData` 0x07

| Function | Frame | Notes | Citation |
|---|---|---|---|
| `Set_Device_Eeprom_Value(addr, v)` | `07 00 aH aL 02(+type) v (0x55-v) 00.. crc` | single value + complement; on success mirrors both bytes into `flashData` | 2354-2368 |
| `Set_Device_Eeprom_Array(addr, bytes)` | one frame per 10-byte chunk: `07 00 aH aL len(+type) d0..d9 crc`, unused payload bytes zeroed | stops at the first failed chunk; mirrors into `flashData` only if the last chunk succeeded | 2314-2351 |

`addr` is 16-bit big-endian in `[2],[3]`; `len` ≤ 10. Reply echo is copied back into `flashData` by the dispatcher (1326-1334).

### 9.2 Read — `ReadFlashData` 0x08

* `Get_Device_Eeprom_Buffer(addr, len)`: `08 00 aH aL len(+type) 00.. crc` via `Send_HID_Buffer` (5-byte echo check) (2371-2380). Reply `[5..5+len)` is stored into `flashData[addr..]` by the dispatcher, with `len = [4] & 0x0F` (1336-1343).
* All "get" helpers for mouse fields are thin wrappers: `Get_MS_ReportRate` (`0x00`,2), `Get_MS_CurrentDPI` (`0x04`,2), `Get_MS_DPILightEffect` (`0x4C`,8), `Get_MS_Light` (`0xA0`,7), `Get_MS_LOD` (`0x0A`,2), `Get_MS_DebounceTime` (`0xA9`,2), `Get_MS_MotionSync` (`0xAB`,2), `Get_MS_FlywheelState` (`0xE9`,2), `Get_MS_ShortcutKey` (`0x100 + 0x20·i`, 10 then the rest in 10-byte steps up to `count·3 + 2`), `Get_MacroName` (10, then up to `nameLen + 1`), `Get_MacroContext` (`+0x1F`, 10, then up to `count·5 + 2`) — 3073-3075, 3100-3102, 3343-3345, 3525-3527, 3626-3634, 3649-3657, 3672-3680, 3867-3875, 4154-4167, 4236-4267.

### 9.3 Bulk read — `Read_Device_Flash(start, end)` (2554-2625)

Own loop (not `Send_HID_Buffer`): for `add` from `start` in steps of 10, send `08 00 aH aL len(+type) … crc` with `len = min(10, end-add)`, arm the 200 ms timer, wait (1 ms polls) for `sendingFlag == false`; compare the first 5 bytes; on match reset `errorCount` and advance (2596-2598), on mismatch or timeout increment `errorCount`, abort after 5 consecutive errors. Any `sendReport` exception aborts. The function's `result` is initialised `false` and never set `true` (2555, 2624) — callers ignore the return. Unlike `Send_HID_Buffer`, a status-1 reply is **not** treated as success here — it simply fails the 5-byte compare (byte `[1]`) and counts as an error.

### 9.4 Connect-time sync — `Update_Device_Param()` (2382-2436)

For a mouse: `connectState = Connecting`; `flashData.fill(0xFF)`; `Read_Device_Flash(0x000, 0x100)`; if sensor is `"3955"` also `Read_Device_Flash(0x1B00, 0x1B30)` (8 stages × 6 bytes); `Read_Device_Flash(0x1B48, 0x1B4C)` (virtual centre); compute `flashEndAddress` (section 3.4); `Update_Mouse_Info()` (decode 0x000-0x0FF, 2803-2912); `Get_Mouse_KeyFunctions()` (per key `0x60 + 4·i` for `keysCount` = 16 keys, and per-key shortcut/macro reads only for keys whose type is ShortcutKey (5) or Macro (6), 2915-2957, 670).

### 9.5 Profile export / import — `Write_Mouse_Flash(buffer)` (2439-2540)

Called from the profile-**import** handler `components/Key/Other.vue:136` with a full `flashData` image (the import file is the flash image followed by a 0x40-byte trailer: 0x20 bytes company `'Compx Inc'`, 0x10 bytes device type, 0x10 bytes sensor name, `Other.vue:71-89, 109-113`; before the write the importer clamps the report-rate byte to `maxReportRate` via `ReportRate_To_FlashData` — see section 12 — and the DPI stage bytes to the model's DPI count, `Other.vue:115-133`). Writes `buffer[0..flashEndAddress]` (inclusive; note `value.length = flashEndAddress` then the loop runs `<=`, 2446-2448) with `Set_Device_Eeprom_Array(0, …)`; for 3955 the 48-byte DPI block at `0x1B00`; the 4-byte virtual-centre block at `0x1B48`; then for each key the 0x20-byte shortcut block (`0x100 + 0x20·i`) and 0x180-byte macro block (`0x300 + 0x180·i`) are written **only if they differ** from the cached `flashData` (2480-2508). Battery polling is paused for the duration (2443, 2536).

### 9.6 Mouse EEPROM address map — `MouseEepromAddr` (`HIDHandle.js:255-298`)

| Name | Addr | Size / encoding used by this driver | Citation (decl / use) |
|---|---|---|---|
| ReportRate | `0x00` | 1 value + complement; `1000/rate` for ≤1000 Hz, `(rate/2000)·0x10` above (0x08=125, 0x04=250, 0x02=500, 0x01=1000, 0x10=2000, 0x20=4000, 0x40=8000) | 256 / 3058-3065, `UserConvert.js:6-13, 27-37` |
| maxDpiStage | `0x02` | value+complement | 257 / 3078-3085 |
| CurrentDPI | `0x04` | value+complement (0 … maxDpi-1) | 258 / 3088-3097 |
| (X/Y "spindown", legacy) | `0x06`, `0x08` | value+complement — `Set_MS_YSpindown` overlaps `KeyOperation` | 3104-3110 |
| KeyOperation | `0x08` | bit0 left "advanced" mode, bit1 right | 259 / 3113-3136, 2811-2812 |
| LOD | `0x0A` | value+complement (sensor-specific height codes, header 45-49 and 3608-3613; the two comments disagree on 3955 code 5: 1.5 mm vs 1.6 mm) | 260 / 3614-3634 |
| DPIValue | `0x0C` | 8 × 4 bytes `[xLo, yLo, hi/ex nibbles, crc]` | 261 / 3255-3268, 2767-2800 |
| DPIColor | `0x2C` | 8 × 4 bytes `[R,G,B,crc]` | 262 / 3332-3336 |
| DPIEffectMode / Brightness / Speed / State | `0x4C / 0x4E / 0x50 / 0x52` | value+complement each; read as one 8-byte block; brightness index→byte table at 3379-3422 | 263-266 / 3343-3485 |
| (legacy RGB fields) | `0x54, 0x58, 0x5A, 0x5C, 0x5E` | `setRGBColor/Effect/Speed/Bri`, `Set_MS_LightPowerSave` | 3487-3522 |
| KeyFunction | `0x60` | 16 × 4 bytes `[type, paramHi, paramLo, crc]` (DPILock: lo,hi) | 292 / 4048-4072 |
| Light | `0xA0` | 7 bytes `[mode, R, G, B, speed, brightness, crc]`; on/off flag at `0xA7` (value+complement) | 267 / 3530-3580, 2825-2829 |
| DebounceTime | `0xA9` | value+complement | 268 / 3637-3657 |
| MotionSync | `0xAB` | value+complement | 269 / 3661-3680 |
| SleepTime | `0xAD` | value+complement; the raw option value is written unchanged (`Set_MS_LightOffTime`); the unit/scale is defined only by `lang.LightOffTimeOptions` in the language JSON (`SleepTime.vue:58`, `MouseLight.vue:232-235`), which was not recovered — unit **UNVERIFIED** | 270 / 3682-3691 |
| Angle / Ripple / MovingOffLight / PerformanceState / Performance / SensorMode | `0xAF / 0xB1 / 0xB3 / 0xB5 / 0xB7 / 0xB9` | value+complement | 271-276 / 3694-3762 |
| (RF TX time, unused) | `0xBB` | value+complement | 4393-4400 |
| AngleTune / AngleTuneState | `0xBD / 0xBF` | signed byte (−30…30, two's complement) + complement; optional (pair check) | 277-278 / 3796-3815, 2845-2857 |
| SensorFPS20K | `0xE1` | value+complement; optional | 279 / 3818-3828 |
| WheelDebounceTime | `0xE3` | value+complement (10-100 per header) | 280 / 3831-3840 |
| DebounceReleaseTime | `0xE5` | value+complement (0-30) | 281 / 3843-3852 |
| FlywheelState | `0xE9` | value+complement | 282 / 3855-3875 |
| FlywheelMaxSpeed / MaxSpeedTime / ReduceSpeed | `0xEB / 0xEC / 0xED` | 4-byte record `[max, time, reduce, crc]` | 283-285 / 3878-3885 |
| LeftTrigger / LeftFastTrigger / LeftTactileFeedback | `0xEF / 0xF1 / 0xF3` | value+complement; fast trigger `state<<7 \| power&0x7F`; tactile `sound<<7 \| power&0x0F` | 286-288 / 3941-4021 |
| RightTrigger | **`0xE5`** (declared) | collides with `DebounceReleaseTime`; almost certainly meant `0xF5` — **UNVERIFIED**, reported as-is | 289 / 3951, 2898 |
| RightFastTrigger / RightTactileFeedback | `0xF7 / 0xF9` | as left | 290-291 / 3982, 4014 |
| ShortcutKey | `0x0100` | 16 × 0x20 | 293 / 4079-4167 |
| Macro | `0x0300` | 16 × 0x180 (name 0x00-0x1E, count at 0x1F, 5-byte entries from 0x20) | 294 / 4170-4390 |
| Sensor3955DPI | `0x1B00` | 8 × 6 bytes | 295 / 3234-3253 |
| VirtualCenter / VirtualCenterLocation | `0x1B48 / 0x1B4A` | value+complement each | 296-297 / 4024-4045 |

`flashData` mirror size: `0x4000` bytes (430).

---

## 10. Profile (configuration slot) read/write and factory reset

| Operation | Command / frame | Reply handling | Citation |
|---|---|---|---|
| Read current profile | `Send_Command(0x0E)` | `[5]` = profile index; status 1 ⇒ `supportChangeProfile = false` | 1977-1979, 1490-1499, 1608-1610 |
| Switch profile | `Send_Command_With_Value(0x0F, [profile])` (documented range 0-3, "some MCU not support") after an online check; then `Update_Device_Param()` re-reads all flash and `connectState = Connected` | reply ignored | 1956-1974, 6557-6564, `Profile.vue:30` |
| Device-side switch | `StatusChanged` bit `0x04` → `Get_Device_Profile` → on reply `Update_Device_Param` | | 1390-1395, 1494-1498 |
| Factory reset | `ClearSetting` 0x09 sent raw; poll `isRestoring` every 300 ms (20× for any type other than `"keyboard"`, 4× for `"keyboard"`); reply status 0 clears `isRestoring`; then dongle params, `Update_Device_Param`, `Get_Device_Profile`, `SetLongRangeMode(default)`, `Set4KDongleRGB(default)`; battery polling paused | | 1881-1938, 1368-1370, `Other.vue:181` |

---

## 11. Complete `Command` enum (`HIDHandle.js:204-252`)

Direction: H→D = host request; D→H = device reply or unsolicited report. "Payload" is `[5..]` of the request; "Reply" lists the decoded reply bytes (absolute offsets). Offsets `[2],[3],[4]` follow section 2 unless stated.

| Name | ID | Line | Direction / used by | Request payload | Reply decoded | Notes |
|---|---|---|---|---|---|---|
| EncryptionData | `0x01` (1) | 205 | H→D `Get_Device_Info` (1778) | `[5..8]` 4 random bytes, `[9..12]` = 0; len 8 | `[9]` cid, `[10]` mid, `[11]` type (table 6.2) | no client-side crypto |
| PCDriverStatus | `0x02` (2) | 206 | H→D `Set_PC_Satae` (1793) | `[5]` = 1 online / 0 offline; len 1 | none | only if `driverOnlineFlag` |
| DeviceOnLine | `0x03` (3) | 207 | H→D `Get_Device_Online*` (1800, 1812) | none | `[5]` online (1), `[6..8]` 3-byte address (stored reversed) | polled every 1.5 s until online, then before every battery read |
| BatteryLevel | `0x04` (4) | 208 | H→D `Get_Device_Battery` (1835) | none | `[5]` %, `[6]` charging, `[7..8]` voltage BE (mV, UNVERIFIED) | every 5 s |
| DongleEnterPair | `0x05` (5) | 209 | H→D `Set_Device_EnterPairMode` (1854) | `[5]`=0, `[6]`=0, `[7]`=CID; len byte = 2 | status only | starts 1 s pair polling |
| GetPairState | `0x06` (6) | 210 | H→D `Get_Device_PairResult` (1870) | none | `[5]` 1 Pairing/2 Fail/3 Success, `[6]` seconds left | ≤20 polls |
| WriteFlashData | `0x07` (7) | 211 | H→D `Set_Device_Eeprom_*` (2315, 2355) | `[2..3]` addr BE, `[4]` len ≤10, `[5..14]` data | echo; `[2..3]` addr, `[4]&0x0F` len, `[5..]` data mirrored | 3-byte echo check |
| ReadFlashData | `0x08` (8) | 212 | H→D `Get_Device_Eeprom_Buffer`, `Read_Device_Flash` (2372, 2556) | `[2..3]` addr, `[4]` len ≤10 | `[5..5+len)` data | 5-byte echo check |
| ClearSetting | `0x09` (9) | 213 | H→D `Device_Restore` (1891) | none | status 0 ⇒ `isRestoring=false` | raw send, no retry |
| StatusChanged | `0x0A` (10) | 214 | D→H unsolicited | — | `[5]`,`[6]` flag bytes (5.3), `[13]`,`[14]` L/R key travel | |
| SetDeviceVidPid | `0x0B` (11) | 215 | not used | — | — | comment: set dongle USB VID/PID |
| SetDeviceDescriptorString | `0x0C` (12) | 216 | not used | — | — | comment: set dongle USB strings |
| EnterUsbUpdateMode | `0x0D` (13) | 217 | not used by HIDHandle (upgrade uses the file-header `resetToUpdateModeCmd`, `UpgradeHandle.js:95, 797`) | — | — | |
| GetCurrentConfig | `0x0E` (14) | 218 | H→D `Get_Device_Profile` (1978) | none | `[5]` profile; status 1 ⇒ unsupported | |
| SetCurrentConfig | `0x0F` (15) | 219 | H→D `Set_Device_Profile` (1963) | `[5]` profile (0-3) | none | followed by full re-read |
| ReadCIDMID | `0x10` (16) | 220 | not used | — | — | |
| EnterMTKMode | `0x11` (17) | 221 | not used | — | — | comment: dongle EMI/MTK test mode |
| ReadVersionID | `0x12` (18) | 222 | H→D `Get_Device_Version` (1983) | none | `[5]` major dec, `[6]` minor hex → `v<M>.<mm>` | mouse firmware version |
| Set4KDongleRGB | `0x14` (20) | 224 | H→D `Set_Device_4KDongleRGB` (2002) | 10 bytes: `[5]` mode, `[6..8]` RGB1, `[9..11]` RGB2, `[12..14]` RGB3 | same layout echoed | dongle LED |
| Get4KDongleRGBValue | `0x15` (21) | 225 | H→D `Get_Device_4KDongleRGB` (2046) | none | `[5]` mode, `[6..14]` 3 colours | |
| SetLongRangeMode | `0x16` (22) | 226 | H→D `Set_Device_LongDistance` (2031) | 10 bytes, `[5]` = 0/1, rest 0 | none | wireless only |
| GetLongRangeMode | `0x17` (23) | 227 | H→D `Get_Device_LongDistance` (2051) | none | `[5]`==1 on; status 1 ⇒ unsupported | |
| SetDongleRGBBarMode | `0x18` (24) | 228 | H→D `Set_Device_DongleRGBBar` (2065) | 10 bytes: `[5]` mode, `[6..8]` RGB, `[9]` speed, `[10]` brightness, `[11]` time | same layout | |
| GetDongleRGBBarMode | `0x19` (25) | 229 | H→D `Get_Device_DongleRGBBar` (2094) | none | as above | |
| GetDongleVersion | `0x1D` (29) | 231 | H→D `Get_Dongle_Version` (2098) | none | `[5]`,`[6]` as 0x12; status 1 ⇒ `"v1.0"` | |
| SetDongle3RGBMode | `0x2C` (44) | 233 | H→D `Set_Dongle_3RGBMode` (2116) | 10 bytes: `[5..7]` mode per LED (0 off, 1 link/signal, 2 battery, 3 report rate — 2101-2104) | `[5..7]` | |
| GetDongle3RGBMode | `0x2D` (45) | 234 | H→D `Get_Dongle_3RGBMode` (2120) | none | `[5..7]` | |
| SetMotorParam | `0x2E` (46) | 236 | H→D `Set_Device_MotorParam` (2165) | 8 bytes: `[5]` mode&0x0F (0 off/1 normal/2 strong/3 burst), `[6..8]` levels[0..2] (0-10 → 20…300 ms, 2168-2179), `[9..11]` buttons packed `(b[2i]&3) \| ((b[2i+1]&3)<<4)` (0 off/1 short/2 long), `[12]` switches bit0 power-on, bit1 DPI switch, bit2 low battery, bit3 rest reminder | none | |
| GetMotorParam | `0x2F` (47) | 237 | H→D `Get_Device_MotorParam` (2206) | none | `[5]&0x0F` mode, `[6..8]` levels, `[9..11]` packed buttons, `[12]` switches | read at connect |
| RestoreMotorParam | `0x30` (48) | 238 | H→D `Restore_Device_MotorParam` (2210) | none | none (UI re-reads with 0x2F) | |
| SetOLEDPicture | `0x31` (49) | 240 | H→D `Set_Device_OLEDPicture` (2222) | `[2..3]` chunk# (1-based BE), `[4]` = 0x0A, `[5..14]` 10 pixel bytes | status 0 ok / 1 error | 5 ms gap, 3 retries |
| RestoreOLEDPicture | `0x32` (50) | 241 | H→D `Restore_Device_OLEDPicture` (2252) | none | none | |
| MusicColorful | `0xB0` (176) | 243 | not used | — | — | keyboard music |
| MusicSingleColor | `0xB1` (177) | 244 | not used | — | — | keyboard music |
| OfficeMusicParameter | `0xB2` (178) | 245 | H→D `Set_Device_OfficeMusicParameter` (2272) | 10 bytes: mode, speed, brightness, colour mode, RGB fwd, RGB back | none | keyboard; references undefined `state` at 2273 |
| OfficeMusicAmplitude | `0xB6` (182) | 247 | H→D `Set_Device_OfficeMusicAmplitude` (2284) | 10 bytes = 20 × 4-bit amplitudes | none | keyboard |
| OfficeCustomLightState | `0xB7` (183) | 248 | H→D `Set_Device_OfficeCustomLightState` / `…MacroState` (2294, 2307) | 2 bytes `[5]` light state, `[6]` macro-recording state | none | keyboard |
| WriteKBCIdMID | `0xF0` (240) | 250 | not used | — | — | "cx53710 only" |
| ReadKBCIdMID | `0xF1` (241) | 251 | not used | — | — | "cx53710 only" |

IDs `0x00`, `0x13`, `0x1A-0x1C`, `0x1E-0x2B`, `0x33-0xAF`, `0xB3-0xB5`, `0xB8-0xEF` and `0xF2-0xFF` are not defined in the enum.

### 11.1 Convenience wrappers around the dongle / motor commands

These mutate one field of `deviceInfo` and re-send the whole frame; they carry no additional protocol.

| Wrapper | Mutates | Re-sends | Citation |
|---|---|---|---|
| `Set_Device_4KDongleRGBMode(mode)` | `dongle4KRGB.mode` | `Set_Device_4KDongleRGB` (0x14) | 2005-2008 |
| `Set_Device_4KDongleRGBColor(index, color)` | `dongle4KRGB.color1/2/3` for `index` 0/1/2 | 0x14 | 2010-2021 |
| `Set_Device_LightMode / LightColor / LightSpeed / LightBrightness / LightTime(v)` | `dongleRGBBar.mode / color / speed / brightness / time` | `Set_Device_DongleRGBBar` (0x18) | 2068-2091 |
| `Set_Dongle_3RGBMode(index, mode)` | LED `index` only; the other two LEDs are re-sent from `dongle3LEDRGB.mode[]` | 0x2C | 2106-2117 |
| `Set_Device_MotorMode(v)` / `Set_Device_MotorLevel(i, v)` / `Set_Device_MotorButton(i, v)` / `Set_Device_MotorSwitches(v)` | `motor.mode` / `motor.levels[i]` / `motor.buttons[i]` (i = 0…5) / `motor.switches` | `Set_Device_MotorParam` (0x2E) | 2138-2201 |
| `Set_Device_OfficeCustomLightState(s)` / `Set_Device_OfficeCustomMacroState(s)` | `keyboard.officeCustomParam.customLightState / macroState` | 0xB7 with `[5]=s,[6]=0` / `[5]=0,[6]=s` — the two states are **not** merged, each call zeroes the other byte | 2287-2311 |

All of these are exported (6300-6309, 6580-6588).

---

## 12. Helper encodings (`UserConvert.js`)

| Helper | Behaviour | Citation |
|---|---|---|
| `FlashData_To_ReportRate(v)` | `v >= 0x10` → `(v/0x10)·2000`; else `1000/v` | 27-37 |
| `ReportRate_To_FlashData(r)` | `r > 1000` → `r/1000·0x10` (2000→0x20, 4000→0x40, 8000→0x80) — **inconsistent** with the decoder and with `Set_MS_ReportRate` (`(r/2000)·0x10`, `HIDHandle.js:3059-3063`); used in `Import_KB_Profile` (`HIDHandle.js:5416`) **and** in the mouse profile importer when the file's rate exceeds `maxReportRate` (`components/Key/Other.vue:119`), where e.g. a 2000 Hz clamp writes `0x20`, which the decoder reads back as 4000 Hz | 15-25 |
| `Buffer_To_Color(buf, i)` / `Color_To_Buffer("rgb(r, g, b)")` | 3 consecutive bytes ⇄ CSS rgb string | 40-60 |
| `String_To_UTF8` / `UTF8_To_String` | macro names (≤30 bytes) | 112-123 |
| `LightMode_To_Disable(mode)` | which of colour/brightness/speed are adjustable per mouse light mode 0-6 | 62-109 |
| `String_To_Hex(s)` | `parseInt(s, 16)` — used for the `"0x0001"`-style key values in `mouseCfg.keys` | 2-4 |
| `Deep_Clone_Array(arr)` (exported) / `Deep_Clone_Object(obj)` (internal) | recursive copies used for profile/default snapshots; no encoding role | 125-149 |

Export list: `String_To_Hex, ReportRate_To_FlashData, FlashData_To_ReportRate, Buffer_To_Color, Color_To_Buffer, LightMode_To_Disable, String_To_UTF8, UTF8_To_String, Deep_Clone_Array` (151-161). `Color_To_Buffer` only accepts the exact form `rgb(r, g, b)` (regex at 50) and returns `[0,0,0]` for anything else — including `#rrggbb`, which is how `mouseCfg` stores DPI/light colours (e.g. 618-654); the dongle RGB fields therefore always hold `rgb(...)` strings.

---

## 13. Request → response sequences (condensed)

```
Open:      requestDevice → open → [01 rnd×4 0×4] → reply [01 00 .. cid mid type]
Connect:   (dongle) 1D, 15, 19, 2D
           03 → [03 00 .. online addr2 addr1 addr0]   (repeat every 1.5 s until online)
           08 reads 0x0000..0x00FF in 10-byte steps (+0x1B00..0x1B2F for 3955, 0x1B48..0x1B4B)
           08 reads per key (0x60+4i) → shortcut 0x100+0x20i / macro 0x300+0x180i as needed
           0E → profile ; 12 → mouse version ; 1D → dongle version
           03 + 04 → battery ; 2F → motor ; (dongle mouse) 17 → long range
           then every 5 s: 03 + 04
Write:     07 [addr][len] v (0x55-v)  → echo   (5 tries × 200 ms)
Pair:      05 [00 00 cid] → ok ; every 1 s: 06 → [.. status left] until 2/3 or 20 polls
Reset:     09 (raw) → poll isRestoring ≤ 6 s → re-sync as Connect
Profile:   0F [n] → full re-read ; unsolicited 0A bit2 → 0E → full re-read
Upgrade:   02 [00] (if driverOnline) → timers stopped → UpgradeHandle takes the HIDDevice ; exit → Connect sequence again
```

---

## 14. Exported transport state and enums (`HIDHandle.js:6598-6621`)

| Export | Kind | Notes |
|---|---|---|
| `flashData` | live `Uint8Array(0x4000)` | same object the dispatcher writes; the UI reads/exports it directly (`Other.vue:191`) |
| `deviceInfo` | live object | section 6.4 |
| `pairResult` | live object `{pairStatus, pairLeftTime}` | watched by `PairDialog.vue:104` |
| `devicePID` | **load-time snapshot** of an `undefined` `var` | never updates (section 1.1) |
| `visit`, `driverOnlineFlag` | load-time snapshots (`false`) | the live values are only changeable via `Set_Visit_Mode` / `Set_DriverOnline` and not readable through the export; `Home.vue:404` logs the stale export |
| `historyDevicesInfos` | load-time snapshot of the `let` array (empty) | `Get_HistoryDevicesInfo()` **reassigns** the variable (975, 989), so the export goes stale; callers must use the function's return value |
| `hidDeviceChangeEvent` | live object `{value}` | set by the connect/disconnect listeners (section 1.3) |
| `DevicePairResult`, `MouseKeyFunction`, `KeyboardKeyFunction`, `DeviceConectState` | enums | sections 6.5 / sibling docs |

---

## Open questions

1. **Supported VID/PID list.** `cfg.json` (source of `driverCfg.vid` / `pid.mouse.wireless|wired` / `pid.keyboard.*`) was not recovered; only the example `0x3554:0xF516` (`HIDHandle.js:5481-5482`) and the bootloader example `vid_3554&pid_f502` (`UpgradeHandle.js:91-94`) are in code. UNVERIFIED.
2. **Wired-mode `DeviceOnLine` (0x03) reply.** The driver polls it for wired mice too; whether wired firmware always answers `[5]=1` and what the 3-byte address is in that case is UNVERIFIED.
3. **EncryptionData semantics.** The 4 random bytes are sent but nothing is verified on the host; whether the firmware derives anything from them (or whether reply bytes `[5..8]` carry a hash) is UNVERIFIED.
4. **Battery voltage unit.** Inferred as millivolts from the 3050–4110 threshold table (`BatteryHandle.js:12-13`); not stated in code.
5. **`DongleEnterPair` length byte.** Length is 2 but the CID is placed in the third payload byte `[7]` (`HIDHandle.js:1857-1860`); firmware acceptance of the CID is UNVERIFIED.
6. **`RightTrigger = 0xE5`** collides with `DebounceReleaseTime = 0xE5` (`HIDHandle.js:281, 289`); likely a typo for `0xF5` given the 0xEF/0xF1/0xF3 … 0xF7/0xF9 pattern. UNVERIFIED.
7. **`devicePID` export.** `HIDHandle.js:918` stores `vendorId` and the exported value (6609) is a load-time `undefined`, so `Home.vue:292-305` can never switch `deviceInfo.type` to `"keyboard"`; unclear whether the shipped bundle differs from the recovered source.
8. **`ReportRate_To_FlashData`** (`UserConvert.js:15-25`) encodes >1000 Hz differently from the decoder and from `Set_MS_ReportRate`; it is used by the keyboard import path (`HIDHandle.js:5416`) and by the mouse import clamp (`Other.vue:119`), so a mouse profile imported onto a 2000/4000 Hz device from a higher-rate file gets a doubled rate byte.
9. **Unused enum members** (`0x0B 0x0C 0x0D 0x10 0x11 0xB0 0xB1 0xF0 0xF1`) have no payload definition anywhere in the recovered source; their formats are unknown.
10. **`Read_Device_Flash` return value** is always `false` (`HIDHandle.js:2555, 2624`); callers do not check it, so a failed bulk read silently leaves `0xFF` in `flashData`, which `Update_Mouse_Info` then interprets (e.g. `reportRate = 1000/0xFF` clamped to `maxReportRate`).
11. **Status byte values other than 0/1** are not handled (`HIDHandle.js:1230, 1599`); whether firmware emits any is UNVERIFIED.
12. **`SleepTime` (0xAD) unit.** The driver writes the dropdown's raw option value (`Set_MS_LightOffTime`, `HIDHandle.js:3682-3691`); the option values live in `lang.LightOffTimeOptions` of the language JSON (`SleepTime.vue:58`), which was not recovered. Unit/scale UNVERIFIED.
