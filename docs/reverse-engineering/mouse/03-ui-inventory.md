# Compx HUB WEB (controlhub.top/gravastar) — Mouse Tool UI/UX Inventory

**Scope.** This document inventories the user-facing surface of the Compx "HUB WEB" configurator as recovered from its published source maps: the app shell and pseudo-routing, the Home device-connect flow, every mouse view and its panels/controls (options, ranges, defaults, and which HID setter each control calls), every dialog, the event-bus wiring between them, the runtime i18n mechanism and the full key inventory it depends on, and the design tokens (CSS variables, palette, fonts, icon font, layout dimensions) plus the image assets. It is written strictly from the recovered code; wherever the code defers to a runtime file that was not captured (`cfg.json`, `lang/*.json`, `sensor.json`, `custom.scss`, most images), the dependency is named and the missing value is marked **UNVERIFIED**. Protocol byte layouts are only mentioned where a UI control's value is directly encoded by them; the full protocol lives in the companion protocol document.

## Sources

Path aliases used below:

- `src/` = `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/controlhub/src/webpack_/vue_test/src/`
- `css` = `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/controlhub/css/app.829c28b5.css` (246,405 bytes; Element UI theme + compiled app styles)
- `img/` = `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/controlhub/img/`
- `index.html` = `.../controlhub/index.html`

| File | Lines relied on |
|---|---|
| `src/main.js` | 1-116 (boot, cfg/lang/sensor fetch, Element global overrides) |
| `src/App.vue` | 1-368 (shell, theme, responsive tokens, `:root` vars) |
| `src/views/Home.vue` | 1-629 (device connect flow, language bootstrap, pairing hotkey) |
| `src/views/Mouse.vue` | 1-405 (tab shell, watchers→bus, upgrade notify) |
| `src/views/NotFound.vue` | 1-10 |
| `src/views/MouseKey.vue` | 1-524 |
| `src/views/MouseSensor.vue` | 1-48 |
| `src/views/MouseLight.vue` | 1-399 |
| `src/views/MouseMacro.vue` | 1-854 |
| `src/views/MouseSetting.vue` | 1-63 |
| `src/components/Battery.vue` | 1-65 |
| `src/components/Key/{Profile,Debounce,Other}.vue` | 1-62 / 1-92 / 1-264 |
| `src/components/Sensor/{DpiSetting,DpiEffect,ReportRate,SensorSetting}.vue` | 1-328 / 1-163 / 1-123 / 1-327 |
| `src/components/Setting/{Language,DeviceInfo,Pair,SleepTime,AdvancedSetting,CompanyInfo,DongleRgb,Oled,RecorderMusic}.vue` | full files |
| `src/components/Dialog/{Tips,FireKey,InputKey,InputName,PairDialog,ShortcutKey}.vue` | full files |
| `src/assets/js/HIDHandle.js` | 201-260 (Command), 255-298 (MouseEepromAddr), 372-417 (enums), 450-453 (pairResult), 469-862 (deviceInfo defaults), 875-943 (Request_Device/Device_Connect), 1223-1624 (input-report handlers), 1632-1690 (Send_HID_Buffer), 1761-1878 (Get_Device_Info, online, battery, pairing), 1881-1974 (restore, profile), 2005-2034 (dongle RGB, long distance), 2382-2540 (Update_Device_Param, Write_Mouse_Flash), 2629-2688 (online poll, flash timeout), 2767-3051 (flash→UI decode), 3054-3097, 3230-3275, 3328-3485, 3515-3794 (setters), 4048-4234 (key/shortcut/macro setters), 5465-5471, 6597-6620 (exports) |
| `src/assets/js/HIDKey.js` | 1-630 (key table, `type` semantics) |
| `src/assets/js/UserConvert.js` | 1-161 (report-rate encode, `LightMode_To_Disable`) |
| `src/assets/js/BatteryHandle.js` | 3-62, 111-205 (skimmed for UI-visible behaviour only) |
| `css` | `:root` block; all `.welcome/.mouse/.mouse_key/.mouse_sensor/.macro/.mouse_light/.mouse_setting/.dialog_class` rules; Element overrides; embedded icon font |
| `img/` | directory listing + `file(1)` dimensions |
| `index.html` | title, favicon, bundle names |
| `js/app.695ab334.js`, `js/app.map`, `js/vendors.map` | compiled bundle grepped for embedded language strings and VID/PID literals (none found); the source maps are the origin of the recovered `src/` tree |

Files ending in `.2`/`.3` were ignored (vue-loader shims). `sensor.json` and `img/devices/mouse3e01.png` in the capture are nginx `404 Not Found` HTML bodies, not real content.

---

## 1. Application shell and pseudo-routing

There is **no vue-router**. `App.vue` mounts three views and toggles them with `v-show` (`App.vue:2-11`):

| "Route" | Component | Shown when | Source |
|---|---|---|---|
| Not found | `NotFound.vue` (`<h1>404 Not Found</h1>`) | `noFound == true` (cfg.json or sensor.json fetch failed) | `App.vue:4-6`, `main.js:103,112`, `NotFound.vue:3` |
| Home | `Home.vue` | `isHome == true` (initial, and after `backToHome(true)`) | `App.vue:8`, `App.vue:121-127` |
| Mouse | `Mouse.vue` | `isHome == false` | `App.vue:9` |

Inside `Mouse.vue`, five tabs are an `el-radio-group` bound to `radio` (`'1'`…`'5'`), each panel `v-show`n (`Mouse.vue:28-65`):

| Tab value | Icon class | Panel | Visibility rule |
|---|---|---|---|
| `"1"` (default, `Mouse.vue:93`) | `iconfont el-icon-main` | `MouseKey.vue` | always |
| `"2"` | `el-icon-sensor` | `MouseSensor.vue` | always |
| `"3"` | `el-icon-macro` | `MouseMacro.vue` | always |
| `"4"` | `el-icon-light` | `MouseLight.vue` | `lightShow` = `typeof deviceCfg.lightEffect != "undefined"` (`Mouse.vue:48,358`) |
| `"5"` | `el-icon-setting` | `MouseSetting.vue` | always |

All tabs are `:disabled="macroRecording"` (`Mouse.vue:36-53`); switching is refused (reverted to `lastRadio`) and `DialogSaveMacroFirst` shown while `saveMacroFirst` is set (`Mouse.vue:157-166`). Tab is reset to `'1'` on every `setMouseDefaultCfg` (`Mouse.vue:357`).

### 1.1 Boot sequence (`main.js`)

1. Element UI globals: `Dialog.closeOnClickModal=false`, `closeOnPressEscape=false`, `lockScroll=false` (`main.js:22-26`). A `v-removeAriaHidden` directive strips `aria-hidden` from `.el-radio__original` (`main.js:30-37`); it is applied to the macro cycle radios (`MouseMacro.vue:108-111`) and the dongle-RGB radios (`DongleRgb.vue:12`). Global styles are imported from `./assets/style/element-variables.scss`, `../public/icon/iconfont.css` and `@/assets/css/global.scss` (`main.js:12-16`) — not captured as separate files; their compiled output is the `css` bundle. The file header carries a changelog dated 2025-03-21, 2025-03-24 and 2025-05-23 (loading screen, single-language default, DPI lock, theme/DPI/report-rate/macro-delay fixes) (`main.js:1-7`).
2. `GET ${location.href}cfg.json` → `driverCfg` → bus `setDriverCfg` (`main.js:47-50`).
   - `themeButtonShow` = both `driverCfg.light` and `driverCfg.dark` defined (`main.js:52-57`).
   - `driverCfg.debug.log == false` → `console.log` replaced with no-op (`main.js:60-62`).
   - `document.title = driverCfg.title` (`main.js:65`). The static `index.html` title is `Compx HUB WEB` (`index.html`).
   - For each code in `driverCfg.language[]`: `GET lang/<code>.json`; the option label is that file's `Language` field (`main.js:70-79`). Then bus `setGlobalLanguages(langOptions, languages)` (`main.js:85`).
   - Then `GET custom.scss` and inject verbatim into a `<style>` (`main.js:88-93`).
   - cfg fetch failure → bus `noFound(true)` (`main.js:102-104`).
3. `GET ${location.origin}/sensor.json` → bus `setGlobalSensor` (`main.js:107-109`); failure → `noFound(true)` (`main.js:110-113`; note the assignment to an undeclared `notFound` at `main.js:111`).
4. `App.vue` flips `isLoaded` 100 ms after `setGlobalLanguages` (`App.vue:109-113`), so the UI is blank until languages arrive.

### 1.2 `driverCfg` (cfg.json) fields consumed by the UI

The file itself was **not captured**; the schema below is what the code reads.

| Field | Used by | Purpose |
|---|---|---|
| `title` | `main.js:65` | window title |
| `debug.log` | `main.js:60` | console logging |
| `language[]` | `main.js:70` | language codes to load |
| `light.{theme,font,border,keyInner}`, `dark.{…}` | `App.vue:61-73` | theme CSS vars |
| `home.{font,theme}` | `App.vue:75-76` | Home colours |
| `visit` | `App.vue:93-97`, `Home.vue:246,314`, `PairDialog.vue:137` | "visit" mode: WebHID open but no data traffic (`HIDHandle.js:201,5465`) |
| `demo` | `Home.vue:22,35,227,246,345,526` | demo mode: empty HID filters, extra device/sensor selects, password shim |
| `vid`, `pid.mouse.{wireless[],wired[]}`, `pid.keyboard.{wireless[],wired[]}` | `Home.vue:251-286` | WebHID filters (see §2.3) |
| `version` | `Home.vue:516` | version label on Home |
| `web` | `CompanyInfo.vue:21` | footer link |
| `showBatteryValue` | `Battery.vue:45` | show `NN%` text |
| `mouse[]` → `{cid, cfg[]}`; `cfg[] → {mid, sensor, keys[], dpis[], maxDpi, currentDpi, reportRate, debounce, maxDebounce, tipsDebounce, longDistance, driverOnline, sleepTime, light, lightEffect{mode,brightness,speed,movingOffState}, dpiEffect{mode,brightness,speed}, sensorMode, lod, performance, ripple, angle, motionSync, disableDpiColor, dongle4KRGB{mode}, upgrade{link,device,dongle,dongle2,dongle4,dongle8}}` | `Home.vue:355-405` and every `setMouseDefaultCfg` listener | per-device defaults (see each view) |
| `keyboard[]` | `Home.vue:342` | keyboard equivalent (out of scope) |

### 1.3 Theme

- Two theme buttons (white / black squares) top-left, shown only when `themeShow` (`Mouse.vue:6-15`). Initial theme: `localStorage['theme']` if `"light"`/`"dark"`, else `prefers-color-scheme: dark` → `"dark"`, else `"light"` (`Mouse.vue:326-344`).
- `updateTheme()` (`App.vue:55-88`) sets, on `:root`: `--option-color` = `rgba(50,160,127,0.5)` (light) or `rgba(0,66,227,0.5)` (dark); `--theme-color/--font-color/--border-color/--key-inner-color` from `driverCfg.<theme>`; `--home-font-color/--home-theme-color` from `driverCfg.home`; `--dialog-image-path = url(<href>img/dialog_<theme>.png)`; persists `localStorage['theme']`.
- Comments document intended values: font `#333333` light / `#ffffff` dark; theme `#32A07E` light / `#0062E3` dark (`App.vue:300-307`).
- Logo swaps: light theme → `img/logo_dark.png`, dark theme → `img/logo_light.png` (`Mouse.vue:117-120,349-352`). Mouse view background `img/bg_<theme>.png` (`Mouse.vue:121,348`); Home background `img/home_bg.png` (`App.vue:82,125`).
- Tooltip `effect` prop follows the theme (`SensorSetting.vue:306-308`, `DeviceInfo.vue:133-135`).

### 1.4 Responsive scaling (`App.vue` watchers)

Base design is 1920×910. `ratio = clientWidth / 1920 * 0.9` (`App.vue:143`); `heightRatio = clientHeight / 910` (`App.vue:233`). Tokens set on `:root` on every resize:

| Token | Formula | Source |
|---|---|---|
| `--screen-width-ratio` | ratio | `App.vue:147` |
| `--home-width`, `--main-width` | `clientWidth - ratio*40*2` px | `App.vue:150-152` |
| `--title-font-size` / `--subtitle-font-size` / `--tips-font-size` / `--font-size` | ratio × 55 / 36 / 22 / 20 px | `App.vue:155-161` |
| `--theme-button-size` | ratio × 32 | `App.vue:164` |
| `--select-width` / `--input-number-width` | ratio × 200 / 160 | `App.vue:167-169` |
| `--battery-width` / `--charging-width` | ratio × 83 / 36 | `App.vue:173-174` |
| `--logo-img-height` | ratio × 100 | `App.vue:176` |
| `--cascader-width` | ratio × 270 | `App.vue:183` |
| `--slider-button-width` / `--dpi-slider-width` | ratio × 8 / 1200 | `App.vue:186-188` |
| `--dpi-select-width` / `--dpi-unselect-width` | ratio × 80 / 80 | `App.vue:191-192` |
| `--reportRate-button-width` | ratio × 105 | `App.vue:195` |
| `--checkbox-width` | ratio × 24 | `App.vue:198` |
| `--switch-width` / `--moving-switch-width` | ratio × 40 / 60 | `App.vue:201-202` |
| `--radio-button-width` | ratio × 16 | `App.vue:205` |
| `--dpiEffect-slider-width` | ratio × 250 | `App.vue:208` |
| `--table-width` / `--table-height` | ratio × 380 / 600 | `App.vue:211-212` |
| `--macro-button-width` / `--macro-record-width` | ratio × 175 / 280 | `App.vue:215-218` |
| `--light-normal-width` / `--preview-color-width` / `--preset-color-width` | ratio × 400 / 90 / 38 | `App.vue:221-225` |
| `--battery-height` / `--charging-height` | heightRatio × 40 / 14 | `App.vue:239-240` |
| `--mouse-img-width` / `--mouse-img-height` | `min(ratio,heightRatio)` × 760 / 630 | `App.vue:44-52` |

Bus events `widthResize(ratio)`, `heightResize(heightRatio)`, `mouseImageResize(min)` are emitted (`App.vue:148,234,53`).

---

## 2. Home view (`Home.vue`) — device list and connect flow

### 2.1 Elements

| Element | i18n key (default zh text) | Behaviour | Source |
|---|---|---|---|
| Full-screen `pair_mask` overlay (`rgba(0,0,0,.8)`) | — | shown while `isPairing` | `Home.vue:3-5`, css `.welcome .pair_mask` |
| Device-type `<select>` (label "设备类型：", options `mouse`/`keyboard`, default `mouse`) | — (hard-coded, no `lang` attr) | **demo mode only** | `Home.vue:22-32,137-147` |
| Sensor `<select>` (label "Sensor类型：", default `"3395"`) | — (hard-coded) | demo only; options = keys of `sensor.json` that have a `range` | `Home.vue:35-45,153,457-470` |
| Language `<select>` | — | see §2.2 | `Home.vue:48-57` |
| Title | `Welcome` ("欢迎使用Control HUB WEB") | `title_font` | `Home.vue:62` |
| Subtitles ×3 | `SelectDevice`, `SupportSystem`, `SupportBrowser` | `subtitle_font` | `Home.vue:63-65` |
| Connect button | `Connect` ("连接设备+") | `:disabled="isSupportConnect == false"`; `connect_button` | `Home.vue:66-70` |
| Operation tips label | `OperationTips` | `operation_font` | `Home.vue:71` |
| History-device cards | — | **commented out** (`historyDevices`, `reportRate_img`, `isWired_img`) | `Home.vue:74-91,443-451` |
| Pair hint box | `PairButtonTips` ("新接收器对码:") + `PairTips` ("敲击空格键进入配对…回车确认（30秒）") | `pair_box` bordered chip | `Home.vue:96-99` |
| Version | `Version` + `driverCfg.version` (default `"v1.0.0"`) | `version_font` | `Home.vue:102-103,134,516` |
| ICP footer | "Control Hub \| 粤ICP备06015730号-2" → `https://beian.miit.gov.cn/` | shown when `driverCfg.vid == ''`, which also forces `isSupportConnect = false` (Connect button disabled) | `Home.vue:107-110,518-524` |
| Password input/OK | — | commented out; `compxPassword:"Compx123"`, daily `btoa(YYYY-MM-DD)` password computed in demo mode but never enforced | `Home.vue:8-19,148-150,172-180,526-537` |
| `<tips>` and `<pair-dialog>` | — | see §9 | `Home.vue:112-113` |

Browser gate (`Home.vue:181-215`): UA sniffed for `edg`, `firefox`, `chrome`, `safari`, `opera `; `isSupportConnect` only for `chrome`/`edg`/`opera`.

### 2.2 Language bootstrap

On `setGlobalLanguages` (`Home.vue:472-512`): if exactly one language → use it; else `localStorage['locale']`; else first option equal to `navigator.language` (or its lowercase); else `"en"`. Initial `data.language` is `"zh-CN"` (`Home.vue:131`). `handleLanguageChange` emits `languageOptionsChange(code)` (persists `localStorage['locale']`, `Home.vue:540-543`) and `languageChange(langObject)`. Translation is DOM-based: every element with a `lang="<Key>"` attribute gets `innerText = lang[Key]` if present (`Home.vue:545-558`).

### 2.3 Connect flow (request → response sequence)

1. **Filters** (`Home.vue:239-288`): if `driverCfg.demo || driverCfg.visit` → `filters = []`; else for every PID in `pid.mouse.wireless`, `pid.mouse.wired`, `pid.keyboard.wireless`, `pid.keyboard.wired` push `{vendorId: parseInt(driverCfg.vid), productId: parseInt(pid)}`. The actual VID/PIDs live in the un-captured `cfg.json`; no filter is hard-coded at runtime. The only in-code occurrences of the brief's **VID 0x3554 / PID 0xF516** are the usage example in the `HIDHandle` export comment (`vendorId: Number.parseInt("0x3554"), productId: Number.parseInt("0xF516")`, `HIDHandle.js:5474-5486`) and the endpoint-string example `vid_3554&pid_f502&mi_01&col05` in `UpgradeHandle.js:91-94,389-392` (the upgrade-file header carries VID/PID strings for the normal and bootloader interfaces, parsed by `GetUpgradeDeviceFilter`, `UpgradeHandle.js:444-476`). These corroborate VID `0x3554` with PID `0xF516` (normal) / `0xF502` (bootloader) as the vendor's example device, but remain **UNVERIFIED as the deployed `cfg.json` values**; the compiled bundle contains neither literal.
2. **`HIDHandle.Request_Device(filters)`** (`HIDHandle.js:875-930`): `navigator.hid.requestDevice({filters})`; accepts a device whose some collection has exactly 1 input report and 1 output report and whose output `reportId == 0x08` (`ReportId`, `HIDHandle.js:422,890-894`); appends `productName` to `localStorage['hidDevices']` (`HIDHandle.js:880-906`); `device.open()`; installs `oninputreport`; `deviceInfo.deviceOpen = true`; `devicePID = device.vendorId` (sic, `HIDHandle.js:918`); then `Get_Device_Info()`.
3. **Device type detection** (`Home.vue:290-306`): compares `HIDHandle.devicePID` against the PID lists; because `devicePID` holds the *vendor* id this never matches, so `deviceInfo.type` stays at the `device` select default `"mouse"` (`Home.vue:137`). **Keyboard detection via this path is effectively dead — UNVERIFIED whether intentional.**
4. **`Get_Device_Info()`** (`HIDHandle.js:1761-1787`): sends `Command.EncryptionData` (0x01) with 4 random bytes + 4 zero bytes; the reply handler stores `cid=byte[9]`, `mid=byte[10]`, `type=byte[11]` (`HIDHandle.js:1233-1236`) and derives:

| `info.type` | Meaning (code comment) | `isWired` | `maxReportRate` | Source |
|---|---|---|---|---|
| `0x00` | dongle 1K | false | 1000 | `HIDHandle.js:1254-1256` |
| `0x01` | dongle 4K | false | 4000 | `1257-1259` |
| `0x02` | wired 1K | true | 1000 | `1244-1247` |
| `0x03` | wired 8K | true | 8000 | `1248-1251` |
| `0x04` | dongle 2K | false | 2000 | `1260-1262` |
| `0x05` | dongle 8K | false | 8000 | `1263-1265` |

5. **`deviceConnect(info)`** (`Home.vue:311-420`):
   - visit mode: image `mouse/demo.png`, sensor `"3950"`, `driverCfg.mouse[0].cfg[0]` (`Home.vue:314-330`).
   - demo: `device[0].cfg[0]`, sensor from the demo select (`Home.vue:345-349`).
   - otherwise requires `info.cid != 0 && info.mid != 0` else `Tips(DialogOffline)` (`Home.vue:352,381-384`); searches `driverCfg.mouse[i].cid === cid` and `cfg[j].mid === mid` (`Home.vue:355-368`); not found → `Tips(DialogDeviceUnsupport)` (`Home.vue:371-374`); found → image name `cid.toString(16).padStart(2,'0') + mid.toString(16).padStart(2,'0') + '.png'` (`Home.vue:377-378`).
   - Found: sets `mouseCfg.sensor.type/cfg` from `sensor.json[sensor]` (`Home.vue:389-390`), `defaultLongDistance` (`398`), `defaultDongle4KRGB.mode` (`400-402`), `Set_DriverOnline(deviceCfg.driverOnline)` (`403`); emits `setMouseDefaultCfg(deviceCfg)` (`405`), `setDevicePath("mouse/<name>")` (`408-410`), `backToHome(false)` (`411`); `await HIDHandle.Device_Connect()` (`413`); removes the Space-key listener (`415`); emits `updateMaxReportRate(deviceInfo.maxReportRate)` (`417`).
6. **`Device_Connect()`** (`HIDHandle.js:933-943`): wireless → `Get_Dongle_Param()`; then `Get_Online_Interval()` immediately and every **1500 ms** until online.
7. **`Get_Online_Interval()`** (`HIDHandle.js:2629-2676`): on online: starts a 1000 ms tick that force-closes the device after **30 ticks** if still `Connecting` (`2678-2688`); `Update_Device_Param()` (sets `connectState = Connecting` → Mouse view shows `DialogUpdating`; reads flash `0x000-0x100`, 3955 DPI block, virtual-center block; decodes into `deviceInfo.mouseCfg`; reads key functions/shortcuts/macros) (`2382-2436`); `Get_Device_Profile`, `Get_Device_Version`, `Get_Dongle_Version`, `Get_Device_Battery`, `Get_Device_MotorParam`; wireless mice only → `Get_Device_LongDistance` else `supportLongDistance=false` (`2649-2660`); `connectState = Connected` (`2661`); battery poll every **5000 ms** (`2668`).
8. `Mouse.vue` watcher on `connectState == Connected` emits `updateDeviceInfo(info)` and `updateMouseUI(info.mouseCfg)`, hides tips, shows battery (`Mouse.vue:168-176`).

### 2.4 Space-bar pairing from Home

`keydown` listener while on Home (`Home.vue:216-238,561-564,577`), acted on only when `isSupportConnect` and not already pairing (`Home.vue:217`): `Space` → `isPairing=true` (mask) → `requestDevice()` → on success open `PairDialog` and, when not demo, `HIDHandle.Set_Pair_CID(driverCfg.mouse[0].cid)` (`Home.vue:228`). `pairDialogOpen(false)` clears `isPairing` (`Home.vue:579-582`).

### 2.5 Device names / images / PIDs

- Device **names** shown to the user: none in the mouse UI; only `device.productName` is stored in `localStorage['hidDevices']` (`HIDHandle.js:898`). The commented-out history card would have shown `item.device.productName` and `item.online` (`Home.vue:87-88`).
- Device **image**: `img/devices/mouse/<cidhex2><midhex2>.png` (`Home.vue:377-378,408`, `MouseKey.vue:368`). The only captured device image is `img/devices/mouse3e01.png` (default `path` in `MouseKey.vue:93`; the captured file is a 404 page). Its name fits the scheme with cid `0x3E`, mid `0x01` — **UNVERIFIED** that this is the Gravastar mouse.
- **PIDs**: from `cfg.json` only at runtime (see §2.3 step 1); in-code example comments cite `0x3554:0xF516` (normal) and `0x3554:0xF502` (bootloader) (`HIDHandle.js:5480-5483`, `UpgradeHandle.js:91-94`).

---

## 3. Mouse shell (`Mouse.vue`)

Layout: outer `.mouse` (100vh × 100vw, cover background); inner column `90vh × 80vw` (`Mouse.vue:3`); header row = logo (`logo_img`, 3:1) + tab radio group + battery slot `10vw` (`Mouse.vue:24-58`); content column `60vh × 60vw` (`Mouse.vue:59`).

| Control | Behaviour | Source |
|---|---|---|
| Theme buttons (`theme_button`, 32 px squares, absolute top-left) | `themeChange` | `Mouse.vue:6-15,113-124` |
| Tab radio group | `@keydown.native.capture.stop.prevent` — keyboard (arrow/space) navigation between tabs is suppressed; tabs are mouse-only | `Mouse.vue:28-32` |
| Close (`el-icon-close`, absolute top-right) | if `saveMacroFirst` → `Tips(DialogSaveMacroFirst, buttons)`; else clear upgrade notify, `Device_Close()`, bus `closeDialog`, `backToHome(true)` | `Mouse.vue:17-21,125-139` |
| Battery | `v-show="batteryShow"` (true once Connected) | `Mouse.vue:56-57,175,321` |
| Offline dialog | `info.online==false && info.showOfflineDialog` → `Tips(DialogOffline, buttons)` once | `Mouse.vue:183-192` |
| Updating dialog | `connectState == Connecting` → `Tips(DialogUpdating, no buttons)` | `Mouse.vue:177-179` |
| Upgrade notification | `$notify` (HTML, `offset:100`, `duration:0`) with `<a href="<href>+upgrade.link" target=_blank>UpgradeTips</a>` when `upgrade.device != version.device`, or (wireless) the matching `upgrade.dongle8/dongle4/dongle2/dongle` for `maxReportRate` 8000/4000/2000/other differs from `version.dongle` | `Mouse.vue:234-299` |
| `beforeunload` | `Device_Close()` | `Mouse.vue:150-154,384` |

`deviceOpen == false` → `closeDialog` + `backToHome(true)` (`Mouse.vue:300-308`). It is raised on USB unplug by `navigator.hid.ondisconnect` when the removed device's `productName` matches the open one: `Handle_Exit()` (clears every timer and the battery smoothing state) then `deviceInfo_Restore()` sets `deviceOpen=false` and both version strings to `"--"` (`HIDHandle.js:1179-1205`); `PairDialog` watches the same flag to auto-close (`PairDialog.vue:123-133`).

### 3.1 Battery (`Battery.vue`)

- Text `{{battery}}%` if `driverCfg.showBatteryValue` (`Battery.vue:4,45`).
- Fill bar width = `level * fullWidth / 100` px, `fullWidth = 67 * widthRatio` (`Battery.vue:28-38,53-55`); colour class: `low_battery_color` (red) when `≤ 15`, `full_battery_color` when `== 100`, else `normal_battery_color` (both `#67c23a`) (`Battery.vue:11`; css `.mouse .low_battery_color`, `.mouse .full_battery_color,.mouse .normal_battery_color`).
- `charging.png` overlay when `charging` (`Battery.vue:14-16`). Level/charging come from `updateBattery` (`Battery.vue:48-51`), which is the smoothed `BatteryHandle` display level (`HIDHandle.js:1283-1300`), persisted per device address under `localStorage['bat_<addr>']` (`BatteryHandle.js:34,196`).

---

## 4. MouseKey view (`MouseKey.vue`) — key remapping

Three columns (`mouse_key`, 70vw × 70vh): key list + Debounce | mouse image with numbered hotspots | Profile + Other.

### 4.1 Key list

For each `deviceCfg.keys[i]` (`MouseKey.vue:5-32`): a round index button `key_list_index_button` (`i+1`) and an `el-cascader` (`:options="keyOptions"` = `lang.KeyOptions`, `show-all-levels=false`, width `--cascader-width`) bound to `keys[i]`. The whole list is re-rendered by toggling `refreshing` (`MouseKey.vue:12-13`).

Value model: `keys[i] = [typeStr, paramStr]` — e.g. default `["1","0x0001"]` (`HIDHandle.js:671-696`). Top-level `value` strings are hex of `MouseKeyFunction` (`HIDHandle.js:372-385`):

| `MouseKeyFunction` | Value | Param handling on change (`MouseKey.vue:210-275`) |
|---|---|---|
| `Disable` | `0x00` | `param = parseInt(child,16)` |
| `MouseKey` | `0x01` | child = 16-bit button mask, hex string: `0x0100` left, `0x0200` right, `0x0400` middle, `0x0800` back, `0x1000` forward (`HIDKey.js:9`; `LeftKey = 0x0100` at `HIDHandle.js:375`; the older `deviceInfo` defaults use `0x0001..0x0010`, `HIDHandle.js:673-686`) |
| `DPISwitch` | `0x02` | child hex |
| `LeftRightRoll` | `0x03` | child hex |
| `FireKey` | `0x04` | handled by FireKey dialog; `param = (interval<<8) + times` (`MouseKey.vue:462-465`) |
| `ShortcutKey` | `0x05` | handled by ShortcutKey dialog; `Set_MS_KeyFunction(type 5, param 0)` then `Set_MS_ShortcutKey(index, ["LCtrl","A",…])` (`MouseKey.vue:477-491`) |
| `Macro` | `0x06` | child = macro **name**; `param = (index<<8) + cycleTimes` (`MouseKey.vue:234-246`), then bus `setMouseMacro(index,name)` writes the macro slot (`MouseMacro.vue:708-715`) |
| `ReportRateSwitch` | `0x07` | child hex |
| `LightSwitch` | `0x08` | child hex |
| `ProfileSwitch` | `0x09` | child hex |
| `DPILock` | `0x0A` | `param = parseInt(child)` = DPI number; encoded with the DPI EEPROM encoder (`HIDHandle.js:4055-4059`) |
| `UpDownRoll` | `0x0B` | child hex |
| pseudo `"1005"` | — | multimedia: `Set_MS_Multimedia(index, child)` (`MouseKey.vue:220-224`) writes a type-2 shortcut record (`HIDHandle.js:4075-4108`) |

Loading from device (`MouseKey.vue:372-411`): `FireKey/ProfileSwitch/ReportRateSwitch/Disable` collapse to the top-level value only; `ShortcutKey` shows `["1005", mediaValue]` when `shortCutKey[index].isMedia`, else `["5"]`; macros are matched by name in `updateMacros()` (`MouseKey.vue:296-334`). Device keys are stored as `[typeHexUpper, "0x" + param4hex]` or, for DPILock, `[typeHex, dpiDecimalString]` (`HIDHandle.js:2921-2929`).

Guards/UX:
- Opening the cascader for the **only** key mapped to `MouseKey/LeftKey` closes it and shows `Tips(DialogKeepLeftKey)` (`MouseKey.vue:118-143`).
- Clicking a top-level leaf `ShortcutKey` opens the ShortcutKey dialog prefilled from `shortCutKey[keyIndex].contexts` (modifier text with `L` stripped, e.g. `LCtrl`→`Ctrl`) (`MouseKey.vue:151-183`); `FireKey` opens the FireKey dialog with `times = param & 0xFF`, `interval = param >> 8` or defaults 3/10 (`MouseKey.vue:186-198`).
- Empty cascader submenu text is replaced with `lang.MacroEmpty` 20 ms after click (`MouseKey.vue:202-208`).
- Cancelling a dialog restores `lastKeys` (`MouseKey.vue:469-473,492-497`).
- `restoreKeyfunction(index)` (after macro delete) writes the `deviceCfg.keys[i].value` default back (`MouseKey.vue:414-437`).

### 4.2 Mouse image hotspots

`.mouse_image` uses `path` as background (`MouseKey.vue:39-40`); each key gets an absolute round button at `deviceCfg.keys[i].loc = [left, top]` px × `widthRatio` from `mouseImageResize` (`MouseKey.vue:42-49,282-295,346-360`). Clicking a hotspot toggles the corresponding cascader (`MouseKey.vue:276-280`).

### 4.3 Debounce (`Debounce.vue`)

Label `DebounceTime`; `<select>` options `0..deviceCfg.maxDebounce` labelled `i + lang.DebounceTimeUint` (default unit `"ms"`) (`Debounce.vue:4-15,59-71`); default `8` (`Debounce.vue:31`); selecting `< deviceCfg.tipsDebounce` shows `Tips(DialogDebounceTips)` once per connection (`Debounce.vue:41-49`); calls `Set_MS_DebounceTime` → EEPROM `0xA9` (`HIDHandle.js:3637-3646,268`).

### 4.4 Profile (`Profile.vue`)

`<select>` from `lang.ProfileOptions` (`Profile.vue:2-13,42`); `:disabled` when `supportChangeProfile == false` (set false when `GetCurrentConfig` replies with error byte, `HIDHandle.js:1608-1610`); default `0` (`Profile.vue:21`); change → `Set_Device_Profile(value)` (cmd `0x0F`, then full `Update_Device_Param`, so `connectState` passes through `Connecting` and the `DialogUpdating` tips dialog is shown during the switch) (`Profile.vue:30`, `HIDHandle.js:1956-1974`, `Mouse.vue:177-179`); a failed write reverts to `lastProfile` (`Profile.vue:29-36`).

### 4.5 Other (`Other.vue`) — export / import / restore

| Button | Flow | Source |
|---|---|---|
| `Export` | `InputName` dialog (text `DialogExportName`) → builds `flashData (0x4000 bytes) + 0x40` trailer: `'Compx Inc'` UTF-8 at `+0x00`, `deviceInfo.type` at `+0x20`, sensor type at `+0x30`; downloads `<name>.bin` via Blob | `Other.vue:4-6,55-58,187-237` |
| `Import` | hidden `<input type=file accept=".bin">`; validates trailer: company must be `'Compx Inc'` else `Tips(DialogConfigError)`; type/sensor mismatch → `Tips(DialogEConfigMismatch)`; clamps `flashData[0]` report rate to `maxReportRate` (and `[1] = 0x55 - [0]`), `[2]` maxDpiStage to `dpis.length`, `[4]` currentDpi to `dpis.length-1` (note `[5] = 0x55 - flashData[2]` at line 132 — bug); then `Write_Mouse_Flash` | `Other.vue:7-15,60-156` |
| `Restore` | `Tips(DialogRestore)` confirm → `Device_Restore()` (cmd `0x09`, waits `isRestoring` up to 20 × 300 ms, then re-reads everything, re-applies `defaultLongDistance`/`defaultDongle4KRGB`) ; while `isRestoring` shows `Tips(DialogRestoring, no buttons)` | `Other.vue:16-18,158-164,177-185,241-253`, `HIDHandle.js:1881-1938` |

---

## 5. MouseSensor view (`MouseSensor.vue`)

Panels in order: `DpiSetting`, `ReportRate`, `SensorSetting` (`v-show="sensorShow"` = `sensor.json.Setting.includes(deviceCfg.sensor)`), `DpiEffect` (`v-show="effectShow"` = `deviceCfg.dpiEffect` defined) (`MouseSensor.vue:3-6,35-38`).

### 5.1 DPI (`DpiSetting.vue`, `dpi_setting` 25vh)

| Control | Options / range | Default (data) | Runtime source | Setter | Source |
|---|---|---|---|---|---|
| Stage count `<select>` (`DPISetting` label) | `1..defaultMaxDpi` | `maxDpiStage 5`, `defaultMaxDpi 8` | `deviceCfg.dpis.length`; from device `value.maxDpiStage` | `Set_MS_MaxDPI` → EEPROM `0x02` | `DpiSetting.vue:8-18,75-77,242,301`, `HIDHandle.js:3078-3085` |
| Slider (`dpi_slider`, 1200 px) | `min/max/step` | 50 / 30000 / 50; `dpiValue` 3500 (`DpiSetting.vue:78-79`) | `min = sensor.range[0].min`; `max = min(deviceCfg.maxDpi, range[last].max)`; `step = range[0].step` | `Set_MS_DPIValue(currentDpi, v)` | `DpiSetting.vue:23-30,80-83,261-266` |
| `el-input-number` (mini) | same min/max, `:step="inputStep"` = step of the range segment containing the value | 50 | `range[i].step` | same | `DpiSetting.vue:31-39,168-176` |
| DPI boxes ×N (`dpi_box`, checked 80 px / unchecked 64 px, gap 5vw) | click selects stage | `currentDpi 3`; `dpiParams` 400/800/2400/4800/26000 with colours red/green/blue/yellow/white | `deviceCfg.dpis[i].{value,color}` / device `dpis[0..7]` | `Set_MS_CurrentDPI` → EEPROM `0x04` | `DpiSetting.vue:44-65,84-107,186-202` |
| `el-color-picker` (`color-format="rgb"`, trigger is a thin bar) | hidden when `deviceCfg.disableDpiColor == true` | — | — | selects stage then `Set_MS_DPIColor` → EEPROM `0x2C + i*4` `[r,g,b,crc]` | `DpiSetting.vue:57-61,203-225,268-273`, `HIDHandle.js:3328-3340` |
| Triangle marker under current stage | `.triangle` themed | — | — | — | `DpiSetting.vue:63` |

Value change rounds **up** to the segment step: `ceil(v/step)*step` (`DpiSetting.vue:164-185`). Reducing the stage count below the current stage swaps the current stage's value/colour into the new last slot and re-writes both (`DpiSetting.vue:115-158`). Live `updateCurrentDPI` (from the mouse's DPI button) moves the highlight (`DpiSetting.vue:315-317`, `Mouse.vue:200-206`).

### 5.2 Report rate (`ReportRate.vue`, `report_rate` 15vh)

Buttons (`reportRate_button_width` 105 px, gap 4.5vw) from `lang.ReportRates` entries `{option, rate, value}` filtered by `rate <= maxReportRate` (`ReportRate.vue:8-16,66-89,99-110`); `updateMaxReportRate` after connect and `updateDeviceInfo.maxReportRate` cap the list. Defaults `reportRate` index 3, `maxReportRate 8000` (`ReportRate.vue:29-30`). Click → `Set_MS_ReportRate(rate)`; EEPROM `0x00` byte = `1000/rate` for ≤1000 Hz, `(rate/2000)*0x10` above (`HIDHandle.js:3054-3070`; table in `UserConvert.js:6-14`: 0x08=125, 0x04=250, 0x02=500, 0x01=1000, 0x10=2000, 0x20=4000, 0x40=8000). A rate above the max displays as the last option — note the fallback assigns the option's `value` field rather than its index to `reportRate` (`ReportRate.vue:47-50`). `setMouseDefaultCfg` resets `maxReportRate` to 8000 until `updateMaxReportRate` arrives after connect (`ReportRate.vue:61-64`).

### 5.3 Sensor settings (`SensorSetting.vue`, `sensor_setting` 20vh)

| Control | Options | Default | Visible when | Setter / EEPROM | Source |
|---|---|---|---|---|---|
| `SensorMode` `<select>` (tooltip `SensorModeTips`) | `lang.SensorModeOptions`; option `value == 256` is rendered disabled; value 0 removed for sensor `"OM76"` | `0` | `sensor.json.ModeSelect.includes(sensor) && deviceCfg.sensorMode defined` | `Set_MS_SensorMode` → `0xB9` | `SensorSetting.vue:11-27,116,245,256-262,282-288`, `HIDHandle.js:3752-3762` |
| `LOD` `<select>` (tooltip `LODTips`) | `lang.LODOptions[sensorType]` or `lang.LODOptions.general` | `1` | `sensor.json.LOD.includes(sensor) && deviceCfg.lod defined` | `Set_MS_LOD` → `0x0A` | `SensorSetting.vue:30-44,123,246,264-269`, `HIDHandle.js:3608-3623` |
| `Performance` checkbox + `<select>` (tooltip `PerformanceTips`) | `lang.PerformanceOptions`; select disabled unless checkbox on | state `false`, time `6` | `deviceCfg.performance defined` | `Set_MS_PerformanceState` → `0xB5`; `Set_MS_PerformanceTime` → `0xB7` | `SensorSetting.vue:47-68,129-131,247`, `HIDHandle.js:3730-3749` |
| `Ripple` switch (tooltip `RippleTips`) | on/off | `false` | `sensor.json.Ripple.includes(sensor) && deviceCfg.ripple defined` | `Set_MS_Ripple` → `0xB1` | `SensorSetting.vue:72-81,250` |
| `Angle` (直线修正) switch (`AngleTips`) | on/off | `false` | `sensor.json.Angle…` | `Set_MS_Angle` → `0xAF` | `SensorSetting.vue:83-92,251` |
| `MotionSync` switch (`MotionSyncTips`) | on/off | `false` | `sensor.json.MotionSync…` | `Set_MS_MotionSync` → `0xAB` | `SensorSetting.vue:94-103,252` |

Sensor-mode display rule (`Update_MS_SensorModeDisplay`, `HIDHandle.js:3765-3794`): modes are `0 = LP`, `1 = HP`, `256 = Corder`. Wireless with `fps20k == false`: report rate `< 2000` → selectable, shows stored mode; `== 8000` → forced `256`, disabled; `2000/4000` → sensor `"3955"` shows `1 (HP)`, others `256`, disabled. Wired → always `256` disabled. The view mirrors `sensorModeDisplay/sensorModeDisable` on `updateMouseUI` and `updateSensorMode` (`SensorSetting.vue:272-276,311-314`). Switches revert on a failed write (`SensorSetting.vue:187-204`).

### 5.4 DPI light effect (`DpiEffect.vue`, `dpi_effect` 15vh × 35vw)

| Control | Range | Default | Setter | Source |
|---|---|---|---|---|
| Mode `<select>` (`lang.DPIEffectOptions`) | `0` off, `1` steady (常亮), `2` breathing (呼吸) per `deviceInfo` comment | `0` | `0` → `Set_MS_DPILightOff` (EEPROM `0x52 = 0`); else `Set_MS_DPILightMode` (`0x4C`, and `0x52 = 1` if it was off) | `DpiEffect.vue:11-18,57,89-106`, `HIDHandle.js:646-651,3348-3360,3476-3485` |
| `Brightness` slider (250 px) | `1..10`; disabled for mode `0` and `2` | `5` | `Set_MS_DPILightBrightness` → `0x4E` byte via index table 1→0x10, 2..4,6..8→`0x1E*(i-1)`, 5→0x80, 9→0xE6, 10→0xFF | `DpiEffect.vue:24-31,60-64,71-88`, `HIDHandle.js:3363-3422` |
| `Speed` slider | `1..5`; disabled for mode `0` and `1` | `3` | `Set_MS_DPILightSpeed` → `0x50` | `DpiEffect.vue:36-43,66-67`, `HIDHandle.js:3466-3473` |

(Code comments call brightness "breathing only" and speed "steady only" — `HIDHandle.js:3362,3465` — which is the inverse of the disable logic in the view at `DpiEffect.vue:78-86`; **UNVERIFIED** which is correct.) Live `updateDPIEffectState` from the mouse resets mode to 0 or the stored mode (`DpiEffect.vue:148-152`).

---

## 6. MouseLight view (`MouseLight.vue`, `mouse_light`, 60vh)

Left column `light_section` (35vh) + `light_operation_section` (14vh); right column (colour) hidden when `colorDisable` (`MouseLight.vue:79`).

| Control | Range / options | Default (data) | Setter | Source |
|---|---|---|---|---|
| `LightMode` `<select>` (`lang.LightModeOptions`, width `--light-normal-width`) | mode ids 0..6 (see table below) | `0` | `Set_MS_LightMode`: `0` → EEPROM `0xA7 = 0` (off, keeps mode); else `0xA7 = 1` and write `0xA0..0xA6 = [mode,r,g,b,speed,brightness,crc]` | `MouseLight.vue:9-18,170,201-209`, `HIDHandle.js:3530-3580` |
| `Brightness` slider | `min 0 .. max 9`, label shows `value + 1` | `5` | `Set_MS_LightBrightness` | `MouseLight.vue:21-32,172-177,210-217` |
| `Speed` slider | `0..9`, label `value + 1` | `5` | `Set_MS_LightSpeed` | `MouseLight.vue:35-46,178-180,218-225` |
| `MovingOffLight` `el-switch` (60 px) | on/off; disabled when mode `0` | `false` | `Set_MS_MovingOffState` → `0xB3` | `MouseLight.vue:52-58,182,226-231`, `HIDHandle.js:3718-3727` |
| `LightOffTime` `<select>` (`lang.LightOffTimeOptions`, 40 % width) | option values | `6` | `Set_MS_LightOffTime` → `0xAD`; emits `updateSleepTime` (mirrors §8.4) | `MouseLight.vue:61-73,183-185,232-240` |
| `CustomColor` bar `<img src="img/color_bar.png">` (361×41) | click → canvas pixel at `(offsetX/widthRatio, offsetY/heightRatio)`, where `widthRatio = widthResize/0.9` (= `clientWidth/1920`) and `heightRatio = clientHeight/910` (`MouseLight.vue:353-359`) | — | `Set_MS_LightColor([r,g,b])` | `MouseLight.vue:82-88,241-263`, `HIDHandle.js:3544-3554` |
| `Preview` swatch (`preview_color`, 90 px) | `backColor` | `rgb(255,0,255)` | — | `MouseLight.vue:91-94,192` |
| `Red/Green/Blue` `el-input-number` (mini) | `0..255` | `255/0/255` | `Set_MS_LightColor` | `MouseLight.vue:96-126,189-191,264-274` |
| `Preset` swatches 2×7 `<img src="img/colors/color<1..14>.png">` (38 px) | click → pixel pick as above | — | same | `MouseLight.vue:129-156,194,299` |

Mode → disabled controls (`UserConvert.LightMode_To_Disable`, `UserConvert.js:62-109`; names from the comment block):

| Mode | Name (comment) | Colour | Brightness | Speed |
|---|---|---|---|---|
| `0x00` | Off | disabled | disabled | disabled |
| `0x01` | 彩色流动 (colour flow, default) | disabled | — | — |
| `0x02` | 单色呼吸 (single-colour breathing) | — | — | — |
| `0x03` | 单色常亮 (single-colour steady) | — | — | disabled |
| `0x04` | 霓虹 (neon) | disabled | — | — |
| `0x05` | 混彩呼吸 (multi-colour breathing) | disabled | — | — |
| `0x06` | 炫彩常亮 (multi-colour steady) | disabled | — | disabled |

On load, displayed mode = `lightEffect.state == false ? 0 : lightEffect.mode` (`MouseLight.vue:313,337`); device speed/brightness are clamped to `≤ 9` (`HIDHandle.js:2827-2828`). `lightState = mode != 0` gates the two operation controls (`MouseLight.vue:294`).

---

## 7. MouseMacro view (`MouseMacro.vue`, `.macro`, 70vh)

Three columns: macro list | key (event) list | recorder controls.

### 7.1 Macro list (left, `macro_table_width` 380 px, table 60vh)

- `el-table :data="macros"`; row click selects (`select-row` themed background), edit icon button (`el-icon-edit-outline`) per row opens rename (`MouseMacro.vue:8-30,218-235,256-262`). Right-click on a row (`@row-contextmenu`) only logs to the console (`MouseMacro.vue:11,236-238`).
- Buttons `NewMacro` → `InputName` dialog (text `DialogInputMacroName`); `Delete` → `Tips(DialogDeleteMacro)` (`MouseMacro.vue:33-38,240-254`).
- Name uniqueness → `Tips(DialogSameMacroName)` (`MouseMacro.vue:756-765`). New macro = `{name, contexts:[], cycleTimes:1}` (`MouseMacro.vue:769-773`).
- Persistence: `localStorage['macro']` (JSON array) loaded on create (`MouseMacro.vue:612-615,667-682`); device macros with non-empty name and ≥2 contexts are merged in on `updateMouseUI` (`MouseMacro.vue:685-706`); list broadcast via `updateMacroList` to MouseKey.
- Delete → for every device slot with that name: `Restore_MS_Macro(i)` (zeroes the `0x180`-byte slot) and bus `restoreKeyfunction(i)` (`MouseMacro.vue:728-750`).
- Rename → `Set_MS_Macro` on every slot with the old name (`MouseMacro.vue:779-793`).

### 7.2 Key list (middle)

Rows = `contexts[]` `{status, type, value, delay}`; column 1: `el-icon-top` when `status == 1` (key up), `el-icon-bottom` when `status == 0` (key down), key text = `InsertEventOptions` match or `HIDKey.HIDToKey(context).text`; column 2: `el-icon-time` + delay (ms) (`MouseMacro.vue:46-86,654-664`). Selected row (`current-change`) becomes editable after `Modify`: key cell opens the `InputKey` dialog on focus (`MouseMacro.vue:287-298`); delay cell is a numeric input clamped `10..65535` (`MouseMacro.vue:73-79,299-313`). `Delete` removes the selected event (`MouseMacro.vue:315-324`). The table auto-scrolls to the bottom after each recorded event (`MouseMacro.vue:394-397`).

### 7.3 Recorder column

| Control | Options / limits | Default | Source |
|---|---|---|---|
| Record button (`macro_record_width` 280 px) with red `circle`/`square` indicator; label `StartRecord`/`StopRecord` | needs a selected macro (`DialogSelectMacroFirst`); **starting a recording clears the current key list** (`contexts = []`) and coerces `defaultDelay < 10` to `'10'`; listens `keydown`/`keyup` on `document`; max **70** events (`DialogMaxMacroKey`); disables tabs via `macroRecording`; while recording the `DefaultDelay`/`CycleTimes` inputs and the `InsertEvent` dropdown are `:disabled="isRecording"` | label `'开始录制'` | `MouseMacro.vue:99,104,112,121,186-188,325-427` |
| Delay radios: `AutoDelay` (`"1"`) / `DefaultDelay` (`"2"`) + input (placeholder `10-65535`) | auto = `floor(Δ timeStamp)` between events; default = fixed value; blur clamps to `10..65535`, empty → `'10'` | `"1"`, `'10'` | `MouseMacro.vue:101-105,192-193,368-379,428-443` |
| Cycle radios: `UntilThisReleased` (`"254"`), `UntilAnyPressed` (`"255"`), `UntilThisPressed` (`"253"`), `CycleTimes` (`"1"`) + input (placeholder `1-250`) | blur clamps `1..250`; loaded macro with `cycleTimes < 251` selects `"1"` and shows the count; any radio change while a macro is selected enables Save (`cycleAction` watcher) | `'1'`, `1` | `MouseMacro.vue:107-113,194-195,223-229,444-462,633-646` |
| `InsertEvent` `el-dropdown` (`lang.InsertEventOptions[] {command, option, value}`) | `command < 2` → `InputKey` dialog, inserted event `status = command` (`0` down, `1` up), delay 10; `command >= 2` → `option.value` hex parsed as `type = v >> 16`, `value = v & 0xFFFF`, inserts a down+up pair with delay 10 | `insertCommand '0'` | `MouseMacro.vue:115-132,463-518,801-830` |
| `Save` (`save_highlight_button` themed when dirty, disabled otherwise) | writes `cycleTimes`/contexts; for every device slot with the same name: `Set_MS_KeyFunction(i, {type 6, param (i<<8)\|times})` if cycle changed, `Set_MS_Macro(i, macro)` if contexts differ; then `localStorage` | disabled | `MouseMacro.vue:133-137,519-598` |

Unsaved state (`saveMacroFirst`) is broadcast to `Mouse.vue` which blocks tab change/close (`MouseMacro.vue:647-651`, `Mouse.vue:157-166,125-139`). Recording keys are mapped through `HIDKey.keyToHID(event.code)` (`MouseMacro.vue:381`); the table in `HIDKey.js:13-597` gives `{value, text, type}` with `type` 0 = modifier (8 entries: `ShiftLeft/Right`, `ControlLeft/Right`, `AltLeft/Right`, `MetaLeft/Right`; bit masks LCtrl 0x01, LShift 0x02, LAlt 0x04, LWin 0x08, RCtrl 0x10, RShift 0x20, RAlt 0x40, RWin 0x80), 1 = normal key (105 entries, USB HID usage), 7 = `ContextMenu` (1 entry) (`HIDKey.js:2-11,291-392`); the header comment also defines types 2 multimedia, 3 power, 4 mouse button, 5 XY cursor, but no table entry uses them. Lookups: `keyToHID(event.code)`, `HIDToKey({type,value})`, `textToHID(text)` (`HIDKey.js:599-629`). Storage limits enforced by the decoder: name 1..30 bytes, contexts ≤ 70, slot `0x180` at `0x0300 + i*0x180`, 5 bytes per event at `+0x20` (`HIDHandle.js:294,3000-3033`).

---

## 8. MouseSetting view (`MouseSetting.vue`)

Render order: `Language`, `DeviceInfo`, `Pair`, `SleepTime`, `AdvancedSetting` (`v-show="longDistanceShow"` = `mouseCfg.supportLongDistance`), `CompanyInfo`, `DongleRgb` (`v-show="dongleRgbShow"` = `deviceCfg.dongle4KRGB` defined). `Oled` and `RecorderMusic` are imported but **commented out of the template** (`MouseSetting.vue:3-11,46-53`). `sleepTimeShow = !deviceCfg.light` is computed but unused (`MouseSetting.vue:47`).

### 8.1 Language (`Language.vue`, 10vh)
Title `Language`; `<select>` from `setGlobalLanguages` options; change emits `languageOptionsChange` + `languageChange` exactly like Home (`Language.vue:2-18,31-41,44-51`). Default `"zh-CN"` (`Language.vue:27`).

### 8.2 Device info (`DeviceInfo.vue`, 14vh)
- `DongleVersion` and `MouseVersion` (`DeviceInfo.vue:9-16`); defaults `'v1.0'` / `'--'` (`DeviceInfo.vue:33-34`). On `updateDeviceInfo` the dongle string is copied only when `!isWired` (`DeviceInfo.vue:68-72`), but the `updateVersion` handler (fired by the `Mouse.vue` watcher on every `info.version` change, `Mouse.vue:234-236`) copies **both** unconditionally (`DeviceInfo.vue:121-124`), so a wired mouse still shows whatever `version.dongle` holds (`"--"`, or `"v1.0"` after an error reply). Version strings are formatted `"v" + byte5(dec) + "." + byte6(2-digit hex)` (`HIDHandle.js:1505-1509,1549-1553`); dongle falls back to `"v1.0"` on an error reply (`HIDHandle.js:1612-1614`); both reset to `"--"` on disconnect (`HIDHandle.js:1182-1183`).
- `Upgrade` button (`upgrade_button`, tooltip `UpgradeTips`) shown when `deviceCfg.upgrade` versions differ (same rule as §3) (`DeviceInfo.vue:19-23,74-118`); click downloads `<href> + upgrade.link` by XHR blob, filename = link with `/download/` removed (`DeviceInfo.vue:42-65`). Firmware flashing itself (`UpgradeHandle.js`) is **not reachable from the UI** — `Set_Device_EnterUpgrade` has no caller in the views.

### 8.3 Pair tool (`Pair.vue`, 10vh)
Title `PairTool`; `Pair` button (`pair_button`, `--select-width`) `:disabled="isWired"` (`Pair.vue:7,53-55`) → opens `PairDialog` (§9.5).

### 8.4 Sleep time (`SleepTime.vue`, 10vh)
Title `SleepTime`; `<select>` from `lang.LightOffTimeOptions` (shared with MouseLight) (`SleepTime.vue:7-17,56-60`); default `1` (`SleepTime.vue:28`); change → `Set_MS_LightOffTime` (EEPROM `0xAD`) and emits `updateLightOffTime` so MouseLight mirrors it (`SleepTime.vue:33-41`; note `this.lastSleepTime = this.sleepTimes = …` at line 58 assigns the option array to `lastSleepTime`).

### 8.5 Advanced setting (`AdvancedSetting.vue`, 12vh)
Title `AdvancedSetting`; checkbox `LongDistance` + inline `LongDistanceTips` text (`long_distance_font` 0.8 em) (`AdvancedSetting.vue:7-14`). Checking → `Tips` with `lang.LongDistanceTips`; OK → `Set_Device_LongDistance(1)` (cmd `0x16`, 10-byte payload, byte0 = value), Cancel/close → unchecked; unchecking → `Set_Device_LongDistance(0)` directly (`AdvancedSetting.vue:33-67`, `HIDHandle.js:2024-2034`). Default `false`, loaded from `updateMouseUI.longDistance` (`AdvancedSetting.vue:28,46-48`).

### 8.6 Company info (`CompanyInfo.vue`)
Italic link to `driverCfg.web`, fixed `bottom:5vh; right:15vh` (`CompanyInfo.vue:3,21`; css `.mouse_setting .company_info a`).

### 8.7 Dongle RGB (`DongleRgb.vue`, 14vh, 60vw)
Title uses key `DongleRGBTitle` (template default text is "设备信息", copied from DeviceInfo) (`DongleRgb.vue:5`); vertical `el-radio` list from `language.DongleRGBOptions[] {value, option}` bound to `dongleRGBMode` (`DongleRgb.vue:9-17`); any change → `Set_Device_4KDongleRGBMode(mode)` (cmd `0x14`, payload `[mode, r1,g1,b1, r2,g2,b2, r3,g3,b3]` from `deviceInfo.dongle4KRGB`) (`DongleRgb.vue:38-42`, `HIDHandle.js:1986-2008`). Default `1`; loaded from `deviceCfg.dongle4KRGB.mode` then `updateDeviceInfo.dongle4KRGB.mode` (`DongleRgb.vue:31,45-53`).

### 8.8 OLED + vibration motor (`Oled.vue`) — **not mounted**, developer panel
Hard-coded Chinese labels (no i18n; `lang` attrs reuse `OLEDBlack`/`OLEDWhite`).

| Control | Range / options | Default | Call | Source |
|---|---|---|---|---|
| `Width`/`Hight` `el-input-number` | `0..256` | 128 × 80 → `count = w*h/8` bytes | — | `Oled.vue:9-25,141-143,249-254` |
| 全黑 / 全白 / 黑白 / 斑点 / 显示屏恢复默认 | fills `0x00` / `0xFF` / intended alternating rows (as written the inner loop only rewrites the first `width/8` bytes, so the buffer ends as row `hight-1`'s parity — bug, `Oled.vue:263-271`) / `0x55` / restore | — | `Set_Device_OLEDPicture(pixels)` (cmd `0x31`), `Restore_Device_OLEDPicture` (`0x32`) | `Oled.vue:29-33,255-288` |
| 震动模式 `<select>` | `0` 关闭, `1` 普通, `2` 加强, `3` 爆破 | `0` | `Set_Device_MotorMode` | `Oled.vue:38-46,192-209,566-568` |
| 普通/加强/爆破 level `<select>`s | `0..10` = 20,30,40,50,60,70,80,100,150,200,300 ms | `0` | `Set_Device_MotorLevel(0/1/2, v)` | `Oled.vue:50-78,146-191,569-577` |
| 按键 `<select>` `1..6` + 震动类型 | type `0` 关闭, `1` 短震动, `2` 长震动 | `0` | `Set_Device_MotorButton(index,type)` | `Oled.vue:82-100,216-229,578-584` |
| Checkboxes 开机/DPI切换/低电提示/倒计时休息 | bits `0x01/0x02/0x04/0x08` of `switches` | `false` | `Set_Device_MotorSwitches` | `Oled.vue:104-126,585-623` |
| 马达恢复默认 | — | — | `Restore_Device_MotorParam` + `Get_Device_MotorParam` | `Oled.vue:129,624-628` |

Also contains an unused system-audio capture / beat-detection experiment (`Oled.vue:289-565`). The panel refreshes its motor state from `updateMouseUI` via `updateMotor(mouseCfg.motor)` (`Oled.vue:629-651,657-659`); the level labels are hard-coded `"20ms"…"300ms"` and the mode labels `关闭震动/普通震动/加强震动/爆破震动`, `关闭震动/短震动/长震动` (`Oled.vue:146-227`).

### 8.9 Recorder music (`RecorderMusic.vue`) — **not mounted**
Template is a copy of the Pair panel (`PairTool`/`Pair` keys) whose button opens a `recorder-core` PCM 16 kHz recorder (`RecorderMusic.vue:2-8,23-29,59-65`); `recProcess` references undeclared `sampleBuf`/`info_div` (`RecorderMusic.vue:46-48`) — non-functional.

---

## 9. Dialogs (`components/Dialog/*.vue`)

Common: `el-dialog` with `custom-class="dialog_class"` (34vw × 30vh, `margin-top:35vh`, transparent with `--dialog-image-path` background, radius `--font-size`, no shadow — css `.dialog_class`); content lives in the `footer` slot; every dialog closes on bus `closeDialog` (device disconnect); ESC/overlay close disabled globally (`main.js:22-24`); buttons are `dialog_button` (15 % width). Every dialog declares a `title` prop but no caller passes one, so all render with an empty header (`Tips.vue:28-31`, `Home.vue:112-113`, `MouseKey.vue:58-66`, `MouseMacro.vue:141-151`, `Other.vue:21-28`, `Pair.vue:9`). Widths: FireKey inputs `6 × --font-size`, labels `12 × --font-size` (`FireKey.vue:103-109`); InputKey/ShortcutKey/InputName text fields `25vw` (`InputKey.vue:15`, `ShortcutKey.vue:15`, `InputName.vue:15`); PairDialog buttons `8 × --font-size` (`PairDialog.vue:166-168`).

| Dialog | Inputs / validation | Result event (payload) | Source |
|---|---|---|---|
| **Tips** — props `title`, `text`, `showButton` (default `true`) | none | `tipsResult(true)` on OK; `tipsResult(false)` on Cancel or X-close | `Tips.vue:2-21,25-66` |
| **FireKey** — `DialogFireKeyTimes` ("次数（0-3）") input, `DialogFireKeyInterval` ("间隔（10-255）") input, note `DialogFireKeyTips` ("次数设置为0时，按下按键一直发，松开按键结束") | blur-clamp `times 0..3`, `interval 10..255`; defaults 3 / 10 | `fireKey({result, times, interval})` emitted on close (`result:false` when cancelled) | `FireKey.vue:9-31,44-88` |
| **InputKey** — label `DialogShortcutKeyTips`, disabled text field | global `keydown` → `HIDKey.keyToHID(event.code).text`, `preventDefault` | `inputKey({result, key})` on close | `InputKey.vue:9-21,44-78` |
| **InputName** — prop `text`, free text | strips punctuation (ASCII + full-width) and whitespace; trims to ≤ 30 UTF-8 bytes | `inputName({result, name})` on OK; `{result:false}` on OK-with-empty or Cancel; **X-close emits nothing** (`onClose` is empty, unlike the other dialogs) | `InputName.vue:9-21,52-54,55-98` |
| **PairDialog** — `DialogPairTips` ("请让鼠标进入配对状态（同时按住左中右键3秒…）"), action button, `Cancel` | button text cycles `StartPair` → `Pairing` → `PairSuccess` / `PairFail`; `Space` triggers; Cancel button and X hidden while pairing; `pair_fail_button` red, `pair_success_button` themed; hovering a failed button resets to `StartPair`; disabled in visit mode; auto-closes on `deviceOpen == false` | `pairDialogOpen(true/false)` on open/close | `PairDialog.vue:9-26,57-133,136-149` |
| **ShortcutKey** — `DialogShortcutKeyTips`, disabled key field, checkboxes `Shift/Ctrl/Alt/Win` | only `type == 1` keys accepted; max 2 modifiers (oldest dropped); OK builds `["L"+mod…, key]`; `result:true` only if ≥ 1 entry | `shortcutKey({result, modifys})` on close | `ShortcutKey.vue:9-31,55-105` |

Pairing sequence behind PairDialog: `Set_Device_EnterPairMode` sends cmd `0x05` with `data[7] = pairCID || info.cid` (`HIDHandle.js:1853-1865`); on the ack the app polls `GetPairState` (`0x06`) every **1000 ms** (`HIDHandle.js:1303-1309`); reply byte5 = status (`Pairing 0x01`, `Fail 0x02`, `Success 0x03`, `HIDHandle.js:406-410`), byte6 = seconds left (`pairLeftTime`, default 20, `HIDHandle.js:450-453,1313-1314`); after **20 polls** without success → `Fail` (`HIDHandle.js:1868-1878`). The Home hint text says "30秒" (`Home.vue:98`) — **UNVERIFIED** which figure the firmware uses.

---

## 10. Event-bus catalogue (`this.$bus`, `main.js:43`)

| Event | Emitter | Consumers |
|---|---|---|
| `setDriverCfg(cfg)` | `main.js:50` | App, Home, Battery, CompanyInfo, PairDialog |
| `themeButtonShow(bool)` | `main.js:53,56` | Mouse |
| `setGlobalLanguages(options, langs)` | `main.js:85` | App, Home, Language |
| `setGlobalSensor(json)` | `main.js:109` | Home, MouseSensor, DpiSetting, SensorSetting |
| `noFound(bool)` | `main.js:103,112` | App |
| `languageOptionsChange(code)` / `languageChange(lang)` | Home, Language | Home (DOM translate), Mouse, MouseKey, MouseLight, MouseMacro, all Sensor/Setting/Dialog components |
| `themeChange(theme)` | Mouse | App, SensorSetting, DeviceInfo |
| `backToHome(bool)` | Home, Mouse | App, Home |
| `currentDemoSensor(sensor, cfg)` | Home | SensorSetting |
| `setMouseDefaultCfg(deviceCfg)` | Home | Mouse, MouseKey, MouseSensor, MouseLight, MouseSetting, DpiSetting, DpiEffect, ReportRate, SensorSetting, Debounce, Other, DeviceInfo, DongleRgb, SleepTime |
| `setDevicePath(path)` | Home | MouseKey |
| `updateMaxReportRate(n)` | Home | ReportRate |
| `updateDeviceInfo(info)` / `updateMouseUI(mouseCfg)` | Mouse (on Connected) | almost every panel |
| `updateReportRate`, `updateCurrentDPI`, `updateDPIEffectState`, `updateBattery`, `updateLightEffect`, `updateProfile`, `updateVersion`, `updateSensorMode` | Mouse watchers | ReportRate, DpiSetting, DpiEffect, Battery, MouseLight, Profile, DeviceInfo, SensorSetting |
| `widthResize`, `heightResize`, `mouseImageResize` | App | Battery, MouseLight, MouseKey |
| `closeDialog` | Mouse | every dialog |
| `tipsResult`, `fireKey`, `shortcutKey`, `inputKey`, `inputName`, `pairDialogOpen` | dialogs | MouseKey, MouseMacro, Other, AdvancedSetting, Home |
| `macroRecording`, `saveMacroFirst`, `updateMacroList`, `setMouseMacro`, `restoreKeyfunction` | MouseMacro / MouseKey | Mouse, MouseKey, MouseMacro |
| `updateSleepTime` / `updateLightOffTime` | MouseLight / SleepTime | SleepTime / MouseLight |

---

## 11. i18n

**Mechanism.** No i18n library. Languages are whatever `cfg.json.language[]` lists; each `lang/<code>.json` must expose a `Language` display name (`main.js:70-77`). Text is applied by (a) DOM replacement of `[lang]` elements' `innerText` (`Home.vue:548-556`), and (b) components reading `lang.<Key>` for dynamic strings/option lists. **The language list and every translated string are UNVERIFIED** — no `lang/*.json` was captured, and the compiled bundle `js/app.695ab334.js` was grepped to confirm nothing is embedded: it contains only the runtime fetch template `` lang/${t}.json `` and the same Chinese template defaults listed below (`KeyOptions` occurs once, as the `lang.KeyOptions` property read). The table gives the key, where it is used, and the Chinese fallback text baked into the templates (which is what renders if a key is missing).

Initial/fallback codes: `"zh-CN"` (`Home.vue:131`, `Language.vue:27`) and `"en"` (`Home.vue:504,507`).

### 11.1 Home
| Key | Used | Template default |
|---|---|---|
| `Welcome` | `Home.vue:62` | 欢迎使用Control HUB WEB |
| `SelectDevice` | `:63` | 在这里您可以设置您的设备，包含按键、sensor、灯光及其它配置; |
| `SupportSystem` | `:64` | 适配 Mac OS/Window/Linux 等主流操作系统 |
| `SupportBrowser` | `:65` | 仅支持Google Chrome，Microsoft Edge，Opera等浏览器访问 |
| `Connect` | `:70` | 连接设备+ |
| `OperationTips` | `:71` | 操作提示： |
| `PairButtonTips` | `:97` | 新接收器对码: |
| `PairTips` | `:98` | 敲击空格键进入配对，在弹窗中选择需要对码的接收器，回车确认（30秒） |
| `Version` | `:102` | 版本： |
| `DialogDeviceUnsupport`, `DialogOffline` | `:372,382` | (dynamic) |

### 11.2 Shell / generic
| Key | Used | Default |
|---|---|---|
| `OK` / `Cancel` | all dialogs | 确 定 / 取 消 |
| `DialogSaveMacroFirst`, `DialogUpdating`, `DialogOffline`, `UpgradeTips` | `Mouse.vue:137,161,178,187,284` | (dynamic) |
| `Language` (string, also the language's own display name) | `main.js:76`, `Language.vue:5` | 语言 |

### 11.3 Keys tab
| Key | Used | Default / shape |
|---|---|---|
| `KeyOptions` | `MouseKey.vue:445` | cascader tree `[{value,label,children:[{value,label}]}]`; top-level `value` = hex string of `MouseKeyFunction` (`"0".."B"`, plus `"1005"` multimedia); `Macro` children are replaced at runtime by macro names; `DPILock` children carry DPI numbers |
| `MacroEmpty` | `:205` | (empty-submenu text) |
| `DialogKeepLeftKey` | `:135` | (dynamic) |
| `DebounceTime` / `DebounceTimeUint` / `DialogDebounceTips` | `Debounce.vue:4,79,81` | 按钮防抖时间 / "ms" / (dynamic) |
| `ProfileOptions` | `Profile.vue:42` | `[{value,option}]` |
| `Export` / `Import` / `Restore` | `Other.vue:6,15,18` | 导出配置 / 导入配置 / 恢复默认 |
| `DialogExportName`, `DialogEConfigMismatch`, `DialogConfigError`, `DialogRestore`, `DialogRestoring` | `Other.vue:56,104,140,160,245` | (dynamic) |
| `DialogFireKeyTimes` / `DialogFireKeyInterval` / `DialogFireKeyTips` | `FireKey.vue:12,19,25` | 次数（0-3） / 间隔（10-255） / 次数设置为0时，按下按键一直发，松开按键结束 |
| `DialogShortcutKeyTips` | `ShortcutKey.vue:11`, `InputKey.vue:11` | (empty in template) |

### 11.4 Sensor tab
| Key | Used | Default / shape |
|---|---|---|
| `DPISetting` | `DpiSetting.vue:7` | DPI级数 |
| `ReportRate` / `ReportRates` | `ReportRate.vue:5,102` | 回报率 / `[{option, rate, value}]` |
| `SensorSetting`, `SensorMode`, `LOD`, `Performance`, `Ripple`, `Angle`, `MotionSync` | `SensorSetting.vue:6,15,34,56,79,90,101` | Sensor设置 / 模式选择 / LOD / 火力全开 / 波纹控制 / 直线修正 / Motion sync |
| `SensorModeOptions` (`[{value:0\|1\|256, option}]`), `LODOptions` (`{<sensor>:[…], general:[…]}`), `PerformanceOptions` | `SensorSetting.vue:281,291,294` | — |
| `SensorModeTips`, `LODTips`, `PerformanceTips`, `RippleTips`, `AngleTips`, `MotionSyncTips` | `SensorSetting.vue:296-301` | tooltips |
| `DPIEffect`, `Brightness`, `Speed`, `DPIEffectOptions` | `DpiEffect.vue:6,23,35,144` | DPI灯效 / 亮度 / 速度 / `[{value:0\|1\|2, option}]` |

### 11.5 Light tab
| Key | Used | Default |
|---|---|---|
| `LightMode`, `LightModeOptions` | `MouseLight.vue:9,331` | 灯光模式 / `[{value:0..6, option}]` |
| `Brightness`, `Speed` | `:21,35` | 亮度 / 速度 |
| `MovingOffLight` | `:53` | 移动时关灯 |
| `LightOffTime`, `LightOffTimeOptions` | `:62,332` (also `SleepTime.vue:58`) | 放停后灯光关闭时间 / `[{value, option}]` |
| `CustomColor`, `Preview`, `Red`, `Green`, `Blue`, `Preset` | `:82,91,97,107,117,130` | 自定义颜色 / 预览 / R: / G: / B: / 预设 |

### 11.6 Macro tab
| Key | Used | Default |
|---|---|---|
| `MacroList`, `KeyList` | `MouseMacro.vue:6,44` | 宏列表 / 按键列表 |
| `NewMacro`, `Delete`, `Modify`, `Save` | `:35,38,91,94,137` | 新建宏 / 删除 / 修改 / 保存 |
| `StartRecord`, `StopRecord` | `:336,722` | 开始录制 / (dynamic) |
| `AutoDelay`, `DefaultDelay` | `:102-103` | 自动插入延时 / 默认延时 |
| `UntilThisReleased`, `UntilAnyPressed`, `UntilThisPressed`, `CycleTimes` | `:108-111` | 循环直到此按键松开 / 循环直到任意键按下 / 循环直到此按键再次按下 / 循环次数 |
| `InsertEvent`, `InsertEventOptions` | `:116,721` | 插入事件 / `[{command, option, value:"hex(type<<16\|value)"}]`, first two = key-down/key-up inserts |
| `DialogStopRecordFirst`, `DialogDeleteMacro`, `DialogSelectMacroFirst`, `DialogMaxMacroKey`, `DialogInputMacroName`, `DialogSameMacroName` | `:211,250,327,401,723,760` | (dynamic) |

### 11.7 Settings tab
| Key | Used | Default |
|---|---|---|
| `DeviceInfo`, `DongleVersion`, `MouseVersion`, `Upgrade`, `UpgradeTips` | `DeviceInfo.vue:5,10,14,21,20` | 设备信息 / 接收器固件版本 / 鼠标固件版本 / Upgrade / (tooltip) |
| `PairTool`, `Pair` | `Pair.vue:5,7` | 配对工具 / 配对 |
| `DialogPairTips`, `StartPair`, `Pairing`, `PairSuccess`, `PairFail` | `PairDialog.vue:11,144-147` | 请让鼠标进入配对状态（同时按住左中右键3秒，直至对码指示灯快闪），并靠近接收器 ，点击“开始配对”或按键盘的空格键 / 开始配对 (data default) |
| `SleepTime` | `SleepTime.vue:5` | 鼠标休眠时间 |
| `AdvancedSetting`, `LongDistance`, `LongDistanceTips` | `AdvancedSetting.vue:5,11,13,52` | 高级设置 / 远距离模式 / (远距离模式下，距离会更远抗干扰能力更强，相应工作电流会加大，使用时间减少) |
| `DongleRGBTitle`, `DongleRGBOptions` | `DongleRgb.vue:5,10` | 设备信息 (sic) / `[{value, option}]` |
| `OLED`, `Width`, `Hight`, `OLEDBlack`, `OLEDWhite` | `Oled.vue:5,9,18,29-33,129` | OLED+震动马达 / 宽 / 高 / 全黑 / 全白 (unmounted panel) |

---

## 12. Design tokens

### 12.1 CSS custom properties (`App.vue:279-366`; compiled `:root` in `css`)

| Token | Static default | Runtime |
|---|---|---|
| `--home-font-color`, `--font-color` | `#333` | `driverCfg.home.font` / `driverCfg.<theme>.font` |
| `--home-theme-color`, `--theme-color` | `#32a07e` | `driverCfg.home.theme` / `driverCfg.<theme>.theme` |
| `--border-color` | `#777` | `driverCfg.<theme>.border` |
| `--key-inner-color` | `#123456` | `driverCfg.<theme>.keyInner` |
| `--option-color` | `rgba(50,160,127,.5)` | light `rgba(50,160,127,0.5)` / dark `rgba(0,66,227,0.5)` |
| `--button-hover-color` | `#a3b7bf` | (declared, unused in css) |
| `--disabled-color` | `#bfbfbf` | slider disabled button |
| `--dialog-image-path` | — | `url(<href>img/dialog_<theme>.png)` |
| `--margin-left` / `--margin-top` | `15px` / `25px` | — |
| `--font-size` / `--tips-font-size` / `--subtitle-font-size` / `--title-font-size` | `20px` / `22px` / `36px` / `55px` | ratio-scaled (§1.4) |
| `--home-width` / `--main-width` | `1200px` | viewport-derived |
| `--screen-width-ratio` / `--screen-height-ratio` | `1` / `1` | width ratio written on resize (`App.vue:147`); **`--screen-height-ratio` is declared (`App.vue:282`) but never written at runtime** |
| size tokens (`--select-width 200px`, `--input-number-width 130px`, `--radio-button-width 16px`, `--theme-button-size 32px`, `--battery-width 83px`, `--battery-height 40px`, `--charging-width 36px`, `--charging-height 14px`, `--logo-img-height 100px`, `--mouse-img-width 760px`, `--mouse-img-height 630px`, `--cascader-width 270px`, `--slider-button-width 8px`, `--dpi-slider-width 1200px`, `--dpi-select-width 95px`, `--dpi-unselect-width 75px`, `--reportRate-button-width 105px`, `--checkbox-width 24px`, `--switch-width 50px`, `--moving-switch-width 60` (unitless in static CSS), `--dpiEffect-slider-width 320px`, `--table-width 380px`, `--table-height 600px`, `--macro-button-width 175px`, `--macro-record-width 260px`, `--light-normal-width 500px`, `--preview-color-width 104px`, `--preset-color-width 43px`) | as listed | overwritten by §1.4 |

### 12.2 Palette (hex occurrences in `css`)

| Colour | Role | Evidence |
|---|---|---|
| `#32a07e` | Element UI `$--color-primary` (146 uses: buttons, checkbox/radio checked, slider, links, `.el-button:focus/hover` text) and `--theme-color` | css `.el-checkbox__input.is-checked .el-checkbox__inner{background-color:#32a07e…}`, `.el-radio__input.is-checked…`, `App.vue:306-307` |
| `#2d9071`, `#5bb398`, `#99d0bf`, `#c2e3d8`, `#ebf6f2` | primary shades/tints (hover/active/disabled/plain backgrounds) | css `.el-button:focus,.el-button:hover{color:#32a07e;border-color:#c2e3d8;background-color:#ebf6f2}` |
| `#0062e3` / `rgba(0,66,227,.5)` | intended dark-theme primary | `App.vue:304,67` |
| `#67c23a` | success; battery normal/full fill | css `.mouse .full_battery_color` |
| `#fea523`, `#feb74f`, `#e59520`, `#ffedd3`, `#fff6e9` | warning (customised from Element default) | css |
| `#db0000`, `#c50000`, `#e23333`, `#ed8080`, `#f19999`, `#fbe6e6`, `#f8cccc` | danger (customised) | css |
| `red` | battery low, record indicator, pair-fail button, history-card debug border | css `.mouse .low_battery_color`, `.macro .circle`, `.pair_fail_button` |
| `#303133`, `#606266`, `#909399`, `#c0c4cc`, `#dcdfe6`, `#e4e7ed`, `#ebeef5`, `#f5f7fa`, `#f2f6fc` | Element neutral text/border/fill scale | css |
| `#333`, `#777`, `#123456` | app defaults for font / border / key-button interior | `App.vue:302-303,321,365` |
| `rgba(0,0,0,.8)` | pairing mask | css `.welcome .pair_mask` |

### 12.3 Typography and icons

- Body font: `#app{font-family:Avenir,Helvetica,Arial,sans-serif; font-size:var(--font-size); color:var(--font-color)}` (css `#app`). Base 20 px at 1920-wide; `.el-tooltip__popper` 0.75 em; cascader nodes 0.8 em; `.el-cascader-node__label span{color:#333}` (fixed, not themed).
- Icon font: `element-icons` is redeclared (`@font-face`) with an embedded custom iconfont whose glyph names are `tips, title, macro, key-up, key-timer, key-down, setting, sensor, main, back, light` (decoded from the embedded TTF `post` table). CSS mappings: `.el-icon-back \e607`, `.el-icon-light \e608`, `.el-icon-setting \e609`, `.el-icon-tips \e60a`, `.el-icon-sensor \e60b`, `.el-icon-main \e60c`, `.el-icon-key-up \e60d`, `.el-icon-key-down \e60f`, `.el-icon-macro \e610`, `.el-icon-title \e611`, `.el-icon-key-timer \e60e` (all eleven glyphs have explicit `:before{content}` rules in `css`). Panel titles use `<i class="incfont el-icon-title">` (12 uses); tabs use `iconfont el-icon-*` at `--title-font-size` with a 4 px themed underline when checked (css `.mouse .tab_radio*`). Stock Element glyphs still used: `el-icon-close`, `el-icon-edit-outline`, `el-icon-top`, `el-icon-bottom`, `el-icon-time`, `el-icon-arrow-down`.

### 12.4 Element UI overrides (css)

`.el-button` transparent with `var(--border-color)` border, height `2.2em`, hover background `var(--theme-color)`; `.el-input__inner` transparent, centred, height `2em`; `.el-slider__button` 8 px × 32 px rectangular (`border-radius:10%`), bar/button themed; `.el-switch__core` `--switch-width` (50/40 px) or `--moving-switch-width` (60 px) in MouseLight; `.el-checkbox__inner` 24 px; `.el-radio__inner` 16 px; `.el-table` transparent with themed `.select-row`; `.el-cascader` width `--cascader-width`, focused input background themed; `.el-dropdown-menu__item` width `--macro-record-width`; `.el-color-picker__panel` themed background; `.el-dialog__headerbtn` close icon 1.6 em.

### 12.5 Layout dimensions (css / templates)

Home `.welcome` width `--home-width`, column `95vh` (`Home.vue:2`); connect button `10em × 3em` of subtitle size, radius ⅓ em; `.mouse` 100vh/100vw; Mouse inner `90vh × 80vw`, content `60vh × 60vw`; `.mouse_key` 70vw, columns 70vh; `.mouse_sensor` panels 25vh / 15vh / 20vh / 15vh (35vw); `.macro` columns 70vh with 60vh tables, boxes 10vh/20vh/12vh; `.mouse_light` 60vh (35vh + 14vh sections); `.mouse_setting` sections 10vh/14vh/10vh/10vh/12vh; `.dialog_class` 34vw × 30vh at 35vh.

---

## 13. Image and static assets

| Asset | Captured? | Dimensions / note | Referenced by |
|---|---|---|---|
| `img/home_bg.png` | yes | 1920×920 RGB | `App.vue:34,82,125` |
| `img/bg_dark.png` | yes | 1920×920 RGB | `Mouse.vue:105,121,348` |
| `img/bg_light.png` | **no** | — | `Mouse.vue:121,348` |
| `img/logo_light.png` / `img/logo_dark.png` | yes | 300×100 RGBA (identical size, 2798 B each) | `Mouse.vue:97,118-120,349-352` |
| `img/battery.png` | yes | 83×40 RGBA | `Battery.vue:31,41` |
| `img/charging.png` | yes | 36×14 RGBA | `Battery.vue:32,42` |
| `img/color_bar.png` | yes | 361×41 RGBA | `MouseLight.vue:193,298` |
| `img/colors/color1.png` … `color14.png` | **no** | preset swatches | `MouseLight.vue:137,149,194,299` |
| `img/dialog_light.png`, `img/dialog_dark.png` | **no** | dialog background | `App.vue:77-79` |
| `img/devices/mouse3e01.png` | file present but is an nginx 404 HTML body | default key-view image | `MouseKey.vue:93` |
| `img/devices/mouse/<cid><mid>.png`, `img/devices/mouse/demo.png` | **no** | per-device image | `Home.vue:315,335,377-378,408` |
| `favicon.ico` | yes | 256×256 PNG-in-ICO | `index.html` |
| `fonts/element-icons.ff18efd1.woff`, `.f1a45d74.ttf` | **no** | stock Element icons (also embedded as data URIs) | css `@font-face` |
| `cfg.json`, `lang/<code>.json`, `custom.scss`, `sensor.json` | **no** (`sensor.json` capture is a 404) | runtime config | `main.js:47,70,88,107` |
| `js/app.695ab334.js`, `js/chunk-vendors.abd45bd6.js`, `css/app.829c28b5.css` | yes | bundles | `index.html` |
| `js/app.map`, `js/vendors.map` | yes | webpack source maps — the origin of the recovered `src/webpack_/vue_test/src/` tree | not referenced by `index.html` |

---

## 14. Client-side persistence

| `localStorage` key | Content | Source |
|---|---|---|
| `theme` | `"light"` / `"dark"` (JSON) | `App.vue:87`, `Mouse.vue:330` |
| `locale` | language code (JSON) | `Home.vue:482,542` |
| `password` | read only; writer is commented out | `Home.vue:174,584` |
| `macro` | JSON array of `{name, contexts[], cycleTimes}` | `MouseMacro.vue:613,668` |
| `hidDevices` | JSON array of WebHID `productName`s | `HIDHandle.js:880-905,968` |
| `bat_<addr hex>` | battery smoothing state per device address | `BatteryHandle.js:34,196` |

## 15. UI-visible timers and retries

| Timer | Value | Effect | Source |
|---|---|---|---|
| Online poll before connect | 1500 ms | repeat `DeviceOnLine` until online | `HIDHandle.js:940,1842` |
| Flash-read watchdog | 1000 ms × 30 | `Device_Close()` → back to Home if still `Connecting` | `HIDHandle.js:2634,2678-2688` |
| Battery poll | 5000 ms | `updateBattery` | `HIDHandle.js:2668` |
| Pair-state poll | 1000 ms × 20 | `PairFail` after 20 | `HIDHandle.js:1308,1868-1878` |
| Restore wait | 300 ms × 20 (mouse) | `DialogRestoring` until `ClearSetting` ack | `HIDHandle.js:1890,1900-1903` |
| HID send | 200 ms timeout, up to 5 attempts, echo-checked on 3 (or 5 for `ReadFlashData`) header bytes | setter returns `false` → control reverts to `last*` value | `HIDHandle.js:1642-1690` |
| Loading splash | 100 ms after languages | `isLoaded` | `App.vue:110-112` |
| Cascader empty-text patch | 20 ms | `MacroEmpty` | `MouseKey.vue:202-208` |
| Battery poll finding the mouse offline | — | `getBatteryFlag=false`, battery smoothing reset, 1500 ms online poll restarted **silently** (uses `Get_Device_Online`, not the `_With_Dialog` variant); `DialogOffline` is only raised when a control's setter runs `Get_Device_Online_With_Dialog` | `HIDHandle.js:1809-1822,1834-1845` |

---

## Open questions

1. **Real VID/PIDs, device names and images.** All come from the un-captured `cfg.json` (`Home.vue:251-286,355-378`). The brief's VID `0x3554` / PID `0xF516` appear in code only as the usage example in the `HIDHandle` export comment (`HIDHandle.js:5480-5483`) and, together with bootloader PID `0xF502`, in `UpgradeHandle.js:91-94` comments — corroborating but not runtime-enforced; the only device image name seen, `mouse3e01.png`, implies cid `0x3E`/mid `0x01` but the file itself is a 404 body.
2. **English (and any other) UI strings.** Every translated string lives in `lang/<code>.json` which was not captured; the option-list shapes (`KeyOptions`, `ReportRates`, `SensorModeOptions`, `LODOptions`, `InsertEventOptions`, `LightModeOptions`, `LightOffTimeOptions`, `DPIEffectOptions`, `PerformanceOptions`, `ProfileOptions`, `DongleRGBOptions`) are inferred from how the code indexes them; their actual values (e.g. which report rates, which sleep-time seconds, which LOD millimetres per sensor) are unknown.
3. **`sensor.json` contents** (`Setting`, `ModeSelect`, `LOD`, `Ripple`, `Angle`, `MotionSync` sensor lists and per-sensor `range[] {min,max,step}` / `office`) drive DPI slider limits and which sensor controls appear; the capture is an nginx 404.
4. **Keyboard-vs-mouse detection** compares PIDs against `HIDHandle.devicePID`, which is assigned `device.vendorId` (`HIDHandle.js:918`); as written, type detection always falls through to `"mouse"`. Unclear whether the deployed build differs.
5. **Pairing window**: Home text says 30 s (`Home.vue:98`); the code times out after 20 one-second polls and the default `pairLeftTime` is 20 (`HIDHandle.js:451,1871`).
6. **DPI-effect brightness/speed applicability**: view disables brightness in mode 2 and speed in mode 1 (`DpiEffect.vue:78-86`), while `HIDHandle.js:3362,3465` comments say the opposite.
7. **`dialog_<theme>.png`, `bg_light.png`, `colors/color1..14.png`, per-device images** were not captured, so exact dialog/preset artwork is unknown.
8. **Theme values for the dark palette** (`driverCfg.dark.*`) and whether the deployed `cfg.json` enables the theme toggle at all (`main.js:52-57`) are unknown.
9. **`custom.scss`** may override any of the tokens above at runtime (`main.js:88-93`); its content was not captured.
10. **`img/devices/mouse3e01.png` location** is `img/devices/` (root) in `MouseKey.vue:93`, whereas connected devices load from `img/devices/mouse/` (`Home.vue:408`) — whether the deployed site has both paths is unverified.
