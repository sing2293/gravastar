# K98 Pro GS HUB web tool — UI/UX inventory

Scope: a control-by-control inventory of the GravaStar "GS HUB" web configurator for the K98 Pro (Vue 3 + TDesign + Pinia, served as a `wujie` micro-frontend under `/k98pro-app/`), plus the host shell's device-card page that launches it. It covers routes and pages, the device page layout (sidebar, header, keyboard stage, layer bar, panels), every tab/panel and each control with its type, options and ranges, dialogs/confirmations/toasts, empty/loading/error states, the exact English strings per feature, design tokens extracted from the shipped CSS, and the static assets and what each is used for. Everything below is taken from the deobfuscated bundles and CSS listed in Sources; nothing is inferred from other GravaStar products. Numeric enum values that are still hidden behind unresolved string-table calls are marked UNVERIFIED.

## Sources

Short names used in citations (all under `/private/tmp/claude-501/-Users-infantbro-gravastar-gravastar/f20fa108-f592-4497-95bb-ab3bfe0d2eb1/scratchpad/`):

| Short | File | Ranges relied on |
|---|---|---|
| MAIN | `deob/k98pro/index-Dk7Hs9bA.js` | 136-225 (title + router), 315-330 / 360-483 / 655-700 (enums), 5799-6150 & 6546-6566 (locale tables), 7308-7350 (locale/i18n init), 7816 (`isthreeDevice`), 7926-7972 (profiles, polling labels), 8567-8675 (lighting effect list), 8677 / 9282 / 9894 / 10533-10535 / 14056 (layout variants), 10609-10622 (keycode groups), 14538-14566 (app menu), 14566-14606 (Basic-tab key sections), 14614-14644 (sleep list), 4308-4322 (`k9` default combos), 4828-4846 (`b9` keycaps) |
| PAGE | `deob/k98pro/index-B0AXfBBW.js` | whole file (2799 lines): 25-70 performance store, 77-215 page init, 217-395 device events, 400-470 page guards, 500-580 layer/system bar logic, 590-650 layout math, 660-760 stage state, 780-860 SidebarLeft, 862-905 macro popconfirm, 940-1180 key label/keycap, 1180-1230 decorative cell, 1237-1310 key perf info, 1350-1485 keycap style/tooltips, 1510-1660 interactions, 1665-1960 keyboard layout, 1960-2120 DeviceKeyboard + selection bar, 2140-2250 Menu, 2250-2340 profile switcher, 2340-2400 device info header, 2410-2540 layout root |
| KEYPICK | `deob/k98pro/index-DIYnHvfa.js` | 1-151 |
| ADV | `deob/k98pro/index-BRA2_iJz.js` | 1-1139 |
| MACRO | `deob/k98pro/index-YIc1a_Gi.js` | 1-865 |
| LIGHT | `deob/k98pro/index-idhpy26q.js` | 1-951 |
| LIGHTSTORE | `deob/k98pro/lighting-DVm9DVga.js` | 1-192 |
| SCREEN | `deob/k98pro/index-C2OeNjyI.js` | 1-1013 |
| PROFILES | `deob/k98pro/index-Ber38qL-.js` | 1-469 |
| OTHER | `deob/k98pro/index-C54O2iUn.js` | 1-583 |
| CUSTOM | `deob/k98pro/index-1Al4GwON.js` | 1-924 |
| CONNECT | `deob/k98pro/index-DYSRTR8c.js` | 1-459 |
| PRELOAD | `deob/k98pro/index-CTmb0sVn.js` | 1-13 |
| CONFIRM | `deob/k98pro/index-ClXPruC4.js` | 1-419 (macro store + GlobalConfirm) |
| TOAST | `deob/k98pro/index-B_tycbT6.js` | 1-249 (GlobalMessage) |
| HEADER | `deob/k98pro/logo-text-CpE0-UUN.js` | 1-108 (config store + language dropdown) |
| CORNERS | `deob/k98pro/PanelCorners-DSPTKv17.js` | 1-38 |
| SLIDER | `deob/k98pro/index-tpuvlYXl.js` | 1-91 |
| DRAG | `deob/k98pro/useCustomKeyDrag-C-QvPYb3.js` | 1-155 |
| SYNC | `deob/k98pro/useProfileConfigSync-DnqHfXZR.js` | 1-198 |
| COPY | `deob/k98pro/useCopyProfileConfig-BG7qTx_n.js` | 1-473 |
| GLOBAL | `deob/k98pro/globalSetting-CsPa239Q.js` | 1-166 |
| HIGHKEY | `deob/k98pro/higherKey-BkEGQ1Fs.js` | 1-182 |
| DEVICE | `deob/k98pro/device-Dagr_f7U.js` | 1-36 |
| FILTER | `deob/k98pro/filter-key-Dfwp_tkE.js` | 1-44 |
| EMPTY | `deob/k98pro/empty-img-C_BW8ch_.js`, `firmware-update-tag-D5-uvqgr.js`, `figma-display-preset-4-Ck54wnn7.js` | whole |
| I18N | `deob/k98pro/i18n-en.js` | 1-746 |
| SHELL-DEV | `deob/shell/index-BfaNGY7i.js` | 1-464 |
| SHELL-MAIN | `deob/shell/index-Cm-TOe4o.js` | 2675-2730 (routes), 2857-3040 (runtime), 7700-7830 (K98 provider), 7886-8030 (device store), 8040-8130 (English strings) |
| SHELL-K98 | `deob/shell/k98pro-BujOhiQN.js` | 1-490 |
| SHELL-CONNECT | `deob/shell/index-Dygg5wsW.js` | 1-64 |
| SHELL-PICKER | `deob/shell/electron-hid-picker-3kvkLD4d.js` | 7120-7209 |
| CSS-APP | `gshub/k98pro-app/css/index-BQmG2l4G.css` | whole (global reset, tokens, iconfont) |
| CSS-PAGE | `gshub/k98pro-app/css/index-D1cRugtw.css` | whole (device page, sidebar, keys, menu) |
| CSS-LIGHT | `gshub/k98pro-app/css/index-W84bFWPD.css` | whole |
| CSS-CUSTOM | `gshub/k98pro-app/css/index-Dl3DNDTf.css` | whole |
| CSS-ADV | `gshub/k98pro-app/css/index-CddNX5Kv.css` | whole |
| CSS-MACRO | `gshub/k98pro-app/css/index-oT1p_Tpp.css` | whole |
| CSS-SCREEN | `gshub/k98pro-app/css/index-Cy_JKI_Z.css` | whole |
| CSS-OTHER | `gshub/k98pro-app/css/index-CDzBAgVh.css` | whole |
| CSS-PROFILES | `gshub/k98pro-app/css/index-D8N-jQl_.css` | whole |
| CSS-CONNECT | `gshub/k98pro-app/css/index-C1DiMdNe.css` | whole |
| CSS-CONFIRM / CSS-TOAST / CSS-KEYPICK / CSS-SLIDER / CSS-CORNERS / CSS-HEADER | `index-CsPXdN6i.css`, `index-Br4BlbGY.css`, `index-B5RiZuaw.css`, `index-BJ2faZVH.css`, `PanelCorners-DCCM-kWK.css`, `logo-text-CuN2GZyk.css` | whole |
| CSS-SHELL-DEV / CSS-SHELL-K98 | `gshub/assets/index-y7X-SoqO.css`, `gshub/assets/k98pro-BAe20Zly.css` | whole |
| ASSETS | `gshub/k98pro-app/{png,svg,webp,avif,gif,woff,woff2}`, `gshub/k98pro-app/idx_*.html`, `gshub/assets/img/` | directory listings |

---

## 1. Routes and pages

### 1.1 Sub-app (`/k98pro-app/`) router — MAIN 197-225

History base is `/k98pro-app/` (MAIN 219); `scrollBehavior` scrolls `#app` to top smoothly (MAIN 220-224).

| Path | Route name | Component | Notes |
|---|---|---|---|
| `/` | `home` | CONNECT | Same component as `/hub` (MAIN 197-200) |
| `/hub` | `connect` | CONNECT | Sub-app's own "connect / your devices" page (MAIN 201-204) |
| `/device` | `device` | PAGE | Device page; children below (MAIN 205-209) |
| `/device` (empty child) | — | redirect → `device-lighting` (MAIN 186-189) |
| `/device/lighting` | `device-lighting` | LIGHT | `meta.deviceMenu = "lighting"` (MAIN 176-186, 190) |
| `/device/screen` | `device-screen` | SCREEN | `meta.deviceMenu = "screen"` |
| `/device/custom-key` | `device-custom-key` | CUSTOM | `meta.deviceMenu = "customKey"` |
| `/device/high-level-key` | `device-high-level-key` | ADV | `meta.deviceMenu = "highLevelKey"` |
| `/device/macro` | `device-macro` | MACRO | `meta.deviceMenu = "macro"` |
| `/device/config` | `device-config` | PROFILES | `meta.deviceMenu = "config"` |
| `/device/other` | `device-other` | OTHER | `meta.deviceMenu = "other"` |
| `/device/:pathMatch(.*)*` | — | redirect → `device-lighting` (MAIN 193-196) |
| `/preload` | `preload` | PRELOAD | Renders an empty `<div aria-hidden="true">` (PRELOAD 1-13); `m9` preloads all seven panel chunks sequentially (MAIN 186) |
| `/:w+` | `404Page` | redirect `/result/404` (MAIN 214-217) — no such route exists (UNVERIFIED: likely lands on the redirect target with nothing rendered) |

Router guard (MAIN 143-157): calls `ia(route)` (emits `ROUTE_CHANGE` on an event bus), always calls `next()`; a `catch` falls back to `/connect` (a path that does not exist in this router — UNVERIFIED dead branch). Named "preview" routes (`lightingPreview`, `screenPreview`, `customKeyPreview`, `highLevelKeyPreview`, `macroPreview`, `basicPreview`, `configPreview`, `hubPreview`) are whitelisted in the guard but not registered (MAIN 145).

Document title (MAIN 136-141): `"gravastar hub"` normally; `"official gravastasr support"` (sic) when hostname is `support.gravastar.com` and path is `/`. The HTML `<title>` before JS runs is `重力星球 HUB` (`idx_device.html` line 7).

Sub-app readiness: after first data load the sub-app emits `k98pro-ready` `{appId:"k98pro"}` on `window.$wujie.bus` (PAGE 131-142); the host waits for that event to drop its loading overlay (SHELL-K98 `T` handler, `Z = "k98pro-ready"`).

### 1.2 Host shell routes — SHELL-MAIN 2675-2705

| Path | Name | Component |
|---|---|---|
| `/` | `home` | `index-tgxuW7cu.js` (`HubHomePage`, product marketing/firmware hub — out of scope) |
| `/connect` | `connect` | SHELL-CONNECT (`DeviceConnectPage`) |
| `/devices` | `devices` | SHELL-DEV (`DeviceListPage`) |
| `/k98pro/connect` | — | redirect → `connect` |
| `/k98pro/devices` | — | redirect → `devices` |
| (registered sub-app routes `Ac`) | `k98pro` etc. | host pages under `../pages/{id}.vue` (SHELL-MAIN 2675-2682); K98 host page = SHELL-K98 |

The host uses hash history when loaded from `file:` (Electron) else web history with base `./` (SHELL-MAIN 2706-2708). A guard strips a legacy `?app=` query on `connect`/`devices` (SHELL-MAIN 2709-2718).

### 1.3 Locale

- Supported locale ids resolved from `navigator.language`: `zh_CN`, `ja_JP`, `en_US` (a `ko_KR` case exists but is unreachable because the regex only matches zh/ja/en) (MAIN 7314-7327).
- Default/fallback locale is `zh_CN` (MAIN 7330-7336); persisted under localStorage key `zlxq-starter-locale` (MAIN 7308); host can inject `window.$wujie.props.locale` (MAIN 7309-7312).
- Language dropdown shows only `zh_CN` ("简体中文") and `en_US` ("English") (MAIN 7343-7349; HEADER 40-100). Trigger: 24×24 globe SVG button; menu 100 px wide, bg `#0e1524`, items 5×8 px padding (CSS-HEADER). Disabled while `disableConfig` is set.
- Missing-key fallback goes to `zh_CN`, so a few strings render in Chinese on the English UI (see Open questions).

---

## 2. Host shell — device cards page (`/devices`) — SHELL-DEV

### 2.1 Layout (CSS-SHELL-DEV)

| Element | Spec |
|---|---|
| Page | `.devices-screen`: `min-height:100dvh`, color `#ffffffe6`, font "Source Han Sans CN", background `#04060f url(web-bg-BHsPdP2Z.avif) center/cover fixed`; tokens `--accent:#a6ff1d --purple:#6a2eee --card:rgba(21,24,44,.8) --border:#674991` |
| Top bar | absolute, 64 px high, padding `0 20px 0 24px`; brand logo button (`aria-label` "Back to GS HUB", pushes route `home`; logo width `clamp(200px,10.42vw,320px)`) + language menu component `Ke` (SHELL-DEV 305-318) |
| Content | width `min(calc(100% - clamp(32px,3vw,96px)), clamp(1200px,78vw,2800px))`, padding-top `clamp(104px,11.9444vh,129px)`, padding-bottom 48 px |
| Heading row | `min-height:72px`; `h1` "Your Devices" 32/40 px; summary `p` 16/24 px animated with `device-summary-up/down` transitions (SHELL-DEV 318-330) |
| Add button | `.add-device-button` 187×48, chamfered SVG background (gradient `#9bff31 → #d0ff4f`, hover overlay `#ffffff4d` + border `#70c010`, text `#6a2eee` → `#070a14` on hover), 16×16 plus icon, label "Add New Device"; disabled when discovering/connecting or when 4 devices are listed (`de = 4`, SHELL-DEV 331-339) |
| Error | `.devices-screen__error` role=alert, `#ff9aa6` on `#50000f8c`, shows `store.error` |
| Grid | `.device-grid` `repeat(auto-fit, minmax(min(100%,280px),380px))`, gap 24, margin-top 73 px; at `max-height:800px` cards max 320 px; `max-width:560px` single column |

### 2.2 Device card (SHELL-DEV 340-430, CSS-SHELL-DEV `.device-card*`)

| Part | Content / behaviour |
|---|---|
| Card | `article.device-card` role=button, `aspect-ratio 380/528`, 2 px border `#674991`, radius 2, bg card image `card-background-dark`; grid rows `75.568% / 24.432%`; `--active` (currently selected) border `#a6ff1d` + glow; `--disconnected` cursor not-allowed, image 40 % opacity, name 40 % opacity |
| Media | `.device-card__media` bg `#2f194d url(card-background.png)`; product image from `getDeviceImageUrl` (model `imageKey` → image, else app fallback) at `top:22.055%`, width 97 %, height 56.297 %; fallback TDesign keyboard icon 96 px |
| Name | `h2` 24/32 px, `getDeviceDisplayName` (model display name → `productName` → "K98 Pro" fallback, SHELL-PICKER 7197-7205) |
| Footer (connected) | connection: iconfont `icon-wireless`/`icon-wired` + "2.4G" / "Wired" (`isWirelessDevice` = model wireless or `productId === 4204`, SHELL-PICKER 7205); battery: 24×24 SVG (outline + fill rect width by level: `<30→4, ≤40→7, ≤60→10, ≤80→14, else 17`; bolt path when charging; class `--charging` `#00e031`, `--low` `#f33`) + `"{level}% "` (clamped to 100) |
| Footer (disconnected) | "Disconnected" + 18×18 diamond "?" icon with tooltip `disconnectTip` ("·If the device is already in sleep mode… ·If a 2.4G connection is required…"); hover label `.device-card__disconnect-hover` "Device disconnected" following the pointer (SHELL-DEV 262-266, 421-427) |
| Actions (connected) | `icon-shuomingshu` (tooltip "User Manual") → opens `Instructions-K98Pro-{zn|en}-url` from the version API in a new tab, error toast "The user manual link could not be retrieved…" (SHELL-DEV 231-240); `icon-gujianshengji` (tooltip = firmware version or "—") → for k98pro devices opens the **firmware download modal** (SHELL-DEV 197-214) |
| Click | `selectDevice(id)`; `v2` devices instead open `https://hub.gravastar1.com/gravastar/connect` in a new tab; otherwise `router.push({name: store.deviceApp})` (SHELL-DEV 220-230) |
| Add card | `.device-add-card` (shown while `< 4` devices): 32×32 plus SVG + "Add New Device" 24/32 px; hover swaps to `add-device-bg.svg`; same click as the Add button (SHELL-DEV 431-443) |

Status data: for connected devices exposing capability `device.status.read`, the page invokes `ne.invoke(id, {type:"device.status.read"})` (SHELL-DEV 268-286) → `{batteryLevel, firmwareVersion, isBatteryFull, isCharging, hardwareUuid}` (SHELL-MAIN 7804-7822, reads `getBatteryStatus`, `getDeviceInfo().deviceVersion` prefixed with `V`, `getUuid`). Failed reads on a 2.4G device emit a "wireless-link" change (SHELL-MAIN 7823).

Summary line (SHELL-DEV 252-256): `disconnectedSummary(n)` if any disconnected → else `lowBatterySummary(count)` if any `< 30 %` → else `deviceSummary(count)`.

Add-device flow (SHELL-DEV 289-294): `prepareElectronHidDevicePicker({autoSelect:true})` (Electron picker) → `store.requestDevices()` (WebHID `requestDevice`, `forceRequest:true`, must be user-initiated, SHELL-MAIN 7974-7989 & 7729-7740) → refresh statuses. On mount `refreshDevicesIfRecent()`; if it returns no devices the page replaces the route with `connect` (SHELL-DEV 287-288). Runtime "devices-changed" events re-sync the list (SHELL-DEV 296-301).

### 2.3 Dialogs on the devices page

| Dialog | Trigger | Content | Styling |
|---|---|---|---|
| Release-notes notice `.device-update-notice` | On mount unless localStorage `gs-hub:device-list-update-notice:v1 === "dismissed"` (SHELL-DEV 127-142) | h2 "GS HUB V1.1 Release Notes"; "Dear Users,"; "✨ This update addresses two known issues…"; ol: feature1 (user page load fix), feature2 (display colour distortion fix); "If you encounter any issues… click “Feedback” in the bottom-left corner…"; closing line; footer buttons "Cancel" (purple `#6a2eee`) and "Try Now" (green `#9bff31`, text `#6a2eee`) — both just dismiss | fixed overlay `#15182c80` blur 10; dialog `min(480px,100%)`, min-height 476, bg `driver-update-notice-background-v1-1.png`; buttons 88×32 chamfered clip-path |
| Firmware download modal `.firmware-download-modal` | firmware icon on a k98pro card | h2 "K98Pro Firmware List"; states: "GETTING DOWNLOAD LINK…" / "The download link could not be retrieved. Please try again later." (error colour `#ff8080`) / release row: h3 "K98Pro Firmware Version {V}" + "Latest" badge (green outline shape) + note `versionTip127` ("Note: The toggle switch now includes default volume control functionality; advanced key settings on Mac have been optimized.") + "Download" button (green chamfer shape) that triggers an `<a download>` | dialog `min(520px,100%)`, bg `#0e1524`, shadow `0 20px 48px #0000006b` |

The firmware URL key is chosen by hardware UUID (DEVICE 15-24): `21990232555534` → `Firmware-Keyboards-K98Pro-uk-url`, `21990232555535` → `…-ja-url`, otherwise `…-cn-url` for `zh_CN` or `…-en-url`; the version label is parsed from the filename (`V\d+(\.\d+)*`) (SHELL-DEV 190-193).

### 2.4 Host connect page (`/connect`) — SHELL-CONNECT

`main.connect-screen` with brand header, hero image (`getDefaultConnectImage` = `k98pro-jRxpVtca.avif`, SHELL-PICKER 7197-7203), copy, and a "connect" button; on mount it refreshes devices and auto-selects the first, then `router.replace({name:"devices"})`; the button runs the Electron picker + `requestDevices` + `selectDevice` (SHELL-CONNECT 25-47). Strings: "Click the button below to connect your device", "Authorize & Connect", "SEARCHING…" (SHELL-MAIN 8071-8073).

### 2.5 Host K98 page + device switcher — SHELL-K98

- `.k98pro-page` mounts the sub-app in a `wujie` container (`alive:false`, `sync:false`, `degrade:false`) with props `{activeDeviceId, locale, onDisconnect, onLocaleChange, onOpenDeviceSelector}` (SHELL-K98 380-410, 463-475).
- Loading overlay `Ae.show()` on mount; closed 300 ms after `k98pro-ready` (`Je = 300`) (SHELL-K98 403-407, 421-427).
- `k98pro-disconnect` bus event → `resetConnection()` + `router.replace({name:"connect"})` (SHELL-K98 372-378).
- Device switcher popover (opened by the sub-app header arrow via `onOpenDeviceSelector`): `.device-switcher` 302 px wide, bg `#0c1525`, border `rgba(255,255,255,.16)`, positioned `top:48px`, `left: 252px` (or 16 px when `isCompactLayout` = viewport ≤ 1440 px; SHELL-K98 `j=252, Xe=16`). Header h2 "Select device" + link "Device list ›" (routes to `devices`); optional error (`#ff9aaa`); list (max-height `min(290px, 100vh-156px)`) of items (80×48 thumbnail, name, "Wired"/"2.4G", "Current device" or status "Authorized/Connecting/Connected/Disconnected/Connection error"); empty text "No switchable device"; "Add New Device" green chamfer button 40 px high (SHELL-K98 22-120, CSS-SHELL-K98). Selecting another device reloads the sub-app (`E.value += 1` re-keys the container) or routes to its own app; `v2` devices open the external connect URL (SHELL-K98 315-370).

### 2.6 Host English strings (SHELL-MAIN 8040-8130, `messages.hub.*`)

`connectText`, `connectButton` "Authorize & Connect", `searching` "SEARCHING…", `yourDevices` "Your Devices", `addDevice` "Add New Device", `wired` "Wired", `wireless` "2.4G", `disconnected` "Disconnected", `disconnectHover` "Device disconnected", `disconnectedSummary` "{count} {deviceCount} disconnected. If the device is asleep, press a key to wake it. For a 2.4G connection, check that the keyboard is in 2.4G mode.", `disconnectTip` (two bullet lines), `userManual` "User Manual", `userManualDownloadFailed`, `updateNotice*` (see 2.3), `deviceSummary` "Welcome back. {count} {deviceCount} online and ready.", `lowBatterySummary` "{count} {deviceCount} online. Some batteries are low.", `backToHub` "Back to GS HUB", `genericDevice` "GravaStar device", `deviceSwitcherTitle` "Select device", `deviceList` "Device list", `noSwitchableDevice` "No switchable device", `currentDevice` "Current device", `deviceStatusAuthorized/Connecting/Connected/Disconnected/Error` ("Authorized", "Connecting", "Connected", "Disconnected", "Connection error"), `language` "Language", `fetchingDownload` "GETTING DOWNLOAD LINK…", `firmwareDownloadFailed`, `k98FirmwareListTitle` "K98Pro Firmware List", `k98FirmwareVersionPrefix` "K98Pro Firmware Version", `firmwareLatest` "Latest", `download` "Download", `version127` note.

---

## 3. Sub-app connect page (`/hub`, `/`) — CONNECT

Header: brand logo (`is-mini-brand-logo` 48×48 inverted when the host reports mini mode, CSS-APP `.brand-logo.is-mini-brand-logo`) + language dropdown (CONNECT 425-440). Body switches on whether an authorized device list exists (CONNECT 430-437):

| State | Component | Controls |
|---|---|---|
| No authorized devices | `ConnectDevice` (CONNECT 20-60) | Hero art `png/k98pro-DKcD7Q8z.png` (top 14.29 %, left 22.45 %, width 59.17 % of a 1920×945 stage), h1 "Click the button below to connect your device" (32/48 px, weight 900), p "Note: no device supports connecting to the driver over Bluetooth. Please use the 2.4G receiver or a cable.", button "Authorize & Connect" 247×56 with a Lottie animation background (`connect-button-animation`), chamfered SVG frame, hover text `#070a14`, plus `icon-nextlink` arrow; `aria-busy` while requesting |
| Authorized devices | `DeviceList` (CONNECT 100-330) | Title "Your Devices"; summary chooses `connectSummaryCharging` / `connectSummaryLow` / `connectSummaryHealthy` ("Welcome back — you have {count} device(s) running with a healthy battery level. You're good to go."); "Add New Device" 187×48 button (disabled at 4 devices, `maxDevices = 4`); grid `repeat(4, minmax(0,380px))` gap 24; cards use `webp/K98Pro2-DNHneAC3.webp`; card footer: connection icon (inline SVG wired/wireless) + "Wired"/"2.4G"; battery icon + text "{level}% charging" / "Below 30%" / "{n}%"; actions: user-manual icon (tooltip "User Manual") and firmware icon (tooltip "Firmware {version}", red `update-badge` dot when `hasFirmwareUpdate`); offline card: "Disabled" + help icon with tooltip "·If the keyboard is asleep, press any key to wake it" / "·For a 2.4G connection, check that the switch on the back of the keyboard is in the correct position"; add card "＋ Add New Device" |

Behaviour (CONNECT 333-420): `getAuthorizedDeviceList()` on mount; each device snapshot loads battery/charging/firmware via `getConnectedDeviceSnapshot`; selecting calls `selectConnectedDevice(id)` and `router.push({name:"device"})`; runtime connect/disconnect events flip `isOnline`.

UNVERIFIED: in the hosted GS HUB flow the shell's own `/devices` page is what users see; the sub-app's `/hub` page appears to be the standalone fallback (the host K98 page navigates to the shell `connect` route on disconnect, SHELL-K98 372-378).

---

## 4. Device page (`/device/*`) — PAGE, CSS-PAGE

### 4.1 Frame and background

| Element | Spec |
|---|---|
| `.layout-container__content` | flex row, full height, background `image-set(k98pro-background.avif / .png)` cover; CSS vars `--device-content-max-width:1642px`, `--device-panel-height:420px` (CSS-PAGE) |
| Class toggle | root adds `main-content-config` on `config`/`other`/`screen` pages (PAGE 2495-2497) — no CSS rule matches it; the stylesheet defines `.layout-container__content-config` (config-bg.svg) instead → UNVERIFIED whether the alternate background ever shows |
| Expanded canvas mode | `html[data-viewport-canvas-mode=expanded]` renders a fixed 1920×1080 canvas scaled by `--device-canvas-scale` (CSS-PAGE) |
| Page transition | `page-fade` out-in, 0.16 s opacity (PAGE 2470-2476; CSS-PAGE) |
| `main` | flex column: device-info header (64 px), keyboard stage (shown only on pages in `co = ["performance","customKey","highLevelKey","macro","handle","lighting"]`, PAGE 77 & 2525-2528), then `.page-content` (flex 1, `margin-top:15px`, `overflow:auto`); panels `.device-lighting/.device-custom-key-page/.device-advanced-key-page/.macro-container` are centred at `min(1642px, 100% - 40px)` (CSS-PAGE) |
| Keep-alive | only `DeviceScreen` is kept alive across route switches (PAGE 2531-2536) |

### 4.2 Sidebar `aside.device-sidebar` (PAGE 2480-2525, CSS-PAGE)

| Item | Spec |
|---|---|
| Size | `flex:0 0 238px`, padding `12px 0`, bg `#15182cb3`, `backdrop-filter:blur(5px)`, right border `rgba(255,255,255,.12)`; collapsed = 64 px (`is-collapsed`), auto-collapsed while `(max-width:1440px)` matches (PAGE 2417-2427, `Bs`); transition 0.22 s cubic-bezier(.22,1,.36,1) |
| Logo | expanded 200×40 (`svg/logo-text-COE5nmGy.svg`, or host mini logo); collapsed 28×28 inline "G" SVG (`Ss`, PAGE 2402) |
| Profile switcher `.panes-config` (PAGE 2250-2340) | 48 px row with bg `svg/config-bg-Yirq0LD-.svg` (hover: purple gradient frame with `#67B613` stroke); shows `icon-board-profile` 24 px + current profile name + 12 px `icon-arrow`; disabled (`--disabled`, 55 % opacity) when `disableConfig`. Click opens a TDesign popup (`placement:right-top`, `marginLeft:14px`) `.panes-config__popup` 300 px, bg `#0e1524`: header "Onboard Profile" + link "Manage Profiles ›" (pushes `device-config`, unless menu `config` is disabled); list of profiles (48 px rows, bg `#ffffff0d`, active `#462195` with `#fff3` border; icon `board-profile{1..3}`); clicking switches profile with a full-screen TDesign loading (`eo({loading:true})`) and toast "Switched to: {name}" (`messages.configSwitchSuccess`). Only rendered when `configList.length > 1` |
| Menu `.menu-container` (PAGE 2140-2250) | 7 items, 48 px each, gap 8 px, icon 24 px + label 14 px; active label `#9bff31` weight 500; hover gradient `#5941ff1a→#5941ff33`; animated active indicator (GSAP 0.12 s fade-out / 0.14 s fade-in, 237×46 purple striped SVG, `#271251→#2F1561`) that follows the active item; disabled items 55 % opacity `#fff6`; tooltip (`device-menu-tooltip`, right, delay 140 ms) shows the label when collapsed or when the item is the disabled `screen` item |
| Menu items (MAIN 14538-14566, labels I18N `messages.*`) | `lighting` → "Lighting" (`icon-lighting`); `screen` → "Display Settings" (`icon-display-screen`); `customKey` → "Key Remapping" (`icon-custom-keys`); `highLevelKey` → "Advanced Keys" (`icon-advanced-keys`); `macro` → "Macros" (`icon-macros`); `config` → "Profiles" (`icon-profile-manager`); `other` → "Other Settings" (`icon-more-settings`) |
| Menu badges | `screen` gets a red "wired connection" tag (114×30 red-outline shape, text `messages.useWiredConnection` — English string missing, renders Chinese "请使用有线连接") when the device is on 2.4G (PAGE 2166, 2226-2231); `other` gets a red "Update" tag (`other.firmwareUpdateTag`, 50×20 shape from `firmware-update-tag` SVG) while a firmware update is available and not dismissed (PAGE 2159-2161, 2232-2236); the tag is dismissed when leaving `other` (PAGE 2195-2197) |
| Menu click | switches `fnLayer` to 0 and reloads layer 0 keymap if needed, then `router.push` (PAGE 2185-2192) |
| Footer | "Feedback" button (`icon-feedback` 18 px) opens `https://gravastar.feishu.cn/share/base/form/shrcnKDiOVfbTtD1OMYoXtGWdjc` (PAGE 2428-2430); collapse toggle (`icon-collapse` 20 px, `aria-label` "Collapse sidebar"/"Expand sidebar") |

Menu availability rules (PAGE 476-486): if `deviceInfo.runModeVersion === 255` (bootloader/run-mode) only `other` is enabled and `disableConfig` is set; otherwise `screen` is disabled unless the active HID device is the wired PID (`vendorId 14126 && productId 4325`), and a disabled current menu falls back to `lighting`.

### 4.3 Device-info header `.device-info-container` (PAGE 2340-2400, CSS-PAGE)

64 px row, padding `0 16px`. Left trigger button: `h2` "K98 Pro" (20 px, weight 500) · `icon-wired`/`icon-wireless` 18 px + "Wired" / "2.4G" (wired when PID 4325) · battery SVG 24 px (fill widths 4/7/10/14/17 as on the host card; `--charging` `#00e031`, `--low` `#f33`) + "{level}%" · `icon-arrow` 16 px rotated −90° which calls `window.$wujie.props.onOpenDeviceSelector({left, isCompactLayout})` (PAGE 2352-2358). Right: language dropdown.

### 4.4 Keyboard stage `.device-keyboard` (PAGE 1960-2120, 590-650, CSS-PAGE)

| Aspect | Spec |
|---|---|
| Stage | `section.keyboard-stage` (aria-label "K98 Pro Keyboard") height 380 px; `::before` draws `png/keyboard-baseplate-B4KhJwC6.png` 1085×380 centred; `transform-origin:top center` |
| Responsive scale | ≤1680 px width or ≤920 px height → `scale(.9)`, `margin-bottom:-38px`; ≤1500 → `.86/-53px`; ≤1180 → `.82/-68px`; height ≤860 & width >1180 → `.78/-84px`, bar margin 4 px (CSS-PAGE) |
| Key unit | 42×42 px (`Ee`, PAGE 1330); horizontal gap 0.1309 units (5.5 px), vertical 3.5/42 (PAGE 592-593); container default 885×350, computed as `(max x+w)*42+40` × `(max y+h)*42+60` (PAGE 623-640); keycap block offset `top:+20px`, `left:+20px` (PAGE 1436-1440); container padding 20 px, margin-top 30 px |
| Loading | `TDesign Loading size=large` text "Loading keyboard data…" in a 400 px box while `isKeyboardLoading` (PAGE 1935-1939) |
| Layout source | `keyLayoutStyle` from device (`getKeyLayoutStyle`) or the static tables `layout-us` / `layout-uk` / `layout-jp` (MAIN 8677, 9282, 9894, 10533-10535) chosen by `setLayoutVariantByDeviceUuid` (MAIN 14056) |
| Lighting page split space | when lighting `specialLighting > 1`, the space bar is split into `n` equal cells (`f`, PAGE 596-611) — for K98 Pro `specialLighting` is 1 (GLOBAL 30) so this is latent |

Key cap `.key` (PAGE 1010-1180, CSS-PAGE):

| State/part | Visual |
|---|---|
| Base | absolute, bg `#0e0e14`, border `var(--keyboard-border)` `#707070`, radius 3 px; label 12 px centred in `.key-labels`; icon keys use iconfont 16 px; L-shaped Enter (`isLShaped`) drawn with an SVG path 73×88, width 73 px, label padded 15 px from top |
| Second layer (`keyBorder2`) | optional second rect used for tall/wide keys (`isTallRectangular` adds 5 px), cover rect `var(--keyboard-color)` (PAGE 1436-1450) |
| `active` (selected) | bg `#2f3f1d`, border `#9bff31`; L-shape stroke `#9bff31` |
| `is-pending-bind` (drag hover target) | border `#9bff31`, glow `0 0 0 2px #9bff31c7, 0 0 18px #9bff3180`, pulsing `key-bind-ready` animation 0.64 s alternate, brightness 1.3 |
| `is-custom-drag-source` | cursor grab; dragging → brightness .7 |
| Remapped dot `.key-remapped-indicator` | 5×5 `#9bff31` at top-right when the bound keycode differs from all default keycodes and is not a physical-legend key (PAGE 1798-1801) |
| Macro key | `.key-macro-indicator` "M" in a 24 px circle, 2 px border (PAGE 995-997); tooltip shows the macro name (`M{n+1}` fallback) |
| Advanced key tag | `.key-advanced-indicator` (custom/advanced/macro pages, layer 0 only): key code text 12 px on top, green pill `#9bff31` 37×14 with uppercase tag (`TGL/MT/DKS/SOCD/MPT/END/RS`, PAGE 1230-1237) in `#7f55ff`; the inline SVG version (with caption "Advanced Key") is `display:none` in CSS |
| Advanced hover mark | `.key-advanced-hover-icon` overlay (bg `#2f3036` + `#ffffff1f`, 1 px border) with a 20 px green "+" circle (add) or red "×" circle (remove) icon on the advanced-keys page while an editor for socd/end/mt/tgl is open (PAGE 908-911, 1770-1772) |
| Lighting custom colour | on the lighting page keys painted `rgba(R,G,B)`; font colour black if luminance `(299R+587G+114B)/1000 > 128` else white (PAGE 1372-1385); painted keys show a 12 px pen glyph at the top-right (`.key-color-custom`); when lighting is "Close" cover bg `#000` |
| Tooltip | TDesign `t-tooltip` with `tipInfo` lines (mode/travel — only meaningful on the latent performance page), `keyTip` (`messages.keyTip_{code}` or legend; FILTER 25-33 maps Mac names Cmd/Opt), and the parsed combo string on the custom-key page (`Ctrl+Shift+…`, PAGE 1315-1348) |

Interactions on the stage (PAGE 1510-1610, 1665-1900):

| Gesture | Page | Effect |
|---|---|---|
| Left click | customKey | select single key (`handleSelectKeyClick(...,"single")`); emits `key-click` |
| Left click | highLevelKey | for multi-key types (`socd`, `rs`) → `handleHighLevelKeyClick`; otherwise single select; clicking a key that already carries a configured SOCD/END/MT/TGL (types 1,2,4,6) emits `configured-advanced-key-click` → opens that editor (PAGE 1729-1740) |
| Left click | macro | select key |
| Left click / drag | lighting (only when main effect is Custom) | paint selected keys with the colour-picker colour (`setCustomLightingForKeys`), left-drag paints across keys; right button / right-drag clears (`{0,0,0}`, isCustom false) and sets `contextMenuVisible` (PAGE 1560-1607) |
| Right click | customKey / macro | reset key to its default keycode for the current system/layer (macro page only if the key holds a macro) (PAGE 1512-1530) |
| Drag from candidate → key | customKey / macro | `is-pending-bind` on hover; drop → `updateSelectKeycode` + `setKeyCode`; refused with toast "This key is already bound to an advanced key. Please choose another one." when the target has an advanced key; if the dropped code is a layer-switch key (`61696-61699`) and `fnLayer !== 3` a confirm "Notice / Changing the FN key will clear the function key in the corresponding position on the layer below. Continue?" appears first (PAGE 1536-1558) |
| Drag from key → key | customKey | keys are drag sources (`onCustomKeyMouseDown`) carrying their bound keycode (PAGE 1810-1816) |
| Marquee selection | performance page only (latent) | `.selection-box` 2 px `var(--td-brand-color)` (PAGE 700-760) |

Drag ghost (DRAG 60-110): 42×42 canvas, fill `#11131d`, 2 px `#9bff31` stroke, radius 6, inner 1 px stroke at 50 %, label 12 px bold white or iconfont glyph, `rotate(-3deg)`, `drop-shadow(0 0 9px rgb(155 255 49 / 72%)) drop-shadow(0 12px 20px rgb(0 0 0 / 55%))`; drag starts after 4 px (`F = 4`); body cursor `grabbing`; ends with a `custom-key-drag-end` CustomEvent on the drop target.

### 4.5 Layer / system bar `SidebarLeft.sidebar` (PAGE 780-860, 500-580, CSS-PAGE)

Rendered only on `customKey`, `highLevelKey`, `macro` (PAGE 796); 32 px high, bg `#ffffff08`, min-width 652 px (118 px on highLevelKey where only the system switch shows).

| Control | Type | Options | Behaviour |
|---|---|---|---|
| System switch `.system-switch` | 2-button segmented, chamfered clip-path (5 px cuts), active `#6a2eee`, buttons ≥59 px | "Win" / "Mac" (`SYSTEM_MAP`, PAGE 505-511) | confirm "Notice / Switch system?" (OK only) → `setSystem`, reload layer 0, toast "System switched" or error "Failed to switch system. Make sure the device is connected." (PAGE 550-580) |
| Layer switch `.layer-switch` | 3 buttons ≥100 px, active `#ffffff4d` | "Default Layer", "Fn Layer", "Fn1 Layer" (`keyboardMainLayer`, `keyboardFnLayer` "Fn{n}"+`FnLayer` "Layer"); tooltips: 'Fn layer: hold "Fn + key" to use', 'Fn1 layer: hold "Fn1 + key" to use' | `checkFnLayer(idx)`; the advanced-keys page forces layer 0 (PAGE 1990-1994) |
| "Reset This Layer" | button 28 px, bg `#ffffff1f` | — | confirm header "Reset{Layer name}Key"/body "All key assignments on the current {layer} layer will be cleared and restored to factory presets. Continue?" → `resetLayerKeyMap(layer)` + reload advanced keys (PAGE 512-535) |
| "Reset All Layers" `.is-all` | button, disabled unless `hasCustomKeyChanges` (any `fn0..fn2` binding differs from default) | — | confirm "Restore Defaults / All key assignments on the Default, Fn and Fn1 layers will be cleared… Continue?" → resets layers 0,1,2; toasts "Defaults restored" / "Failed to restore defaults. Make sure the device is connected." (PAGE 536-560) |

### 4.6 Lighting selection bar `.bar` (PAGE 2040-2115, CSS-PAGE)

Only on the lighting page; `is-unavailable` (hidden) unless the main effect is Custom (`isMainCustomLighting`). Four 80×28 chamfered ghost buttons: "Select All", "Invert Selection", "Clear Selection", "Reset" (reset clears all custom key colours) + an 18 px `icon-tip` whose tooltip ("Tip: hold the left mouse button and drag to select multiple keys; right-click to clear the lighting on selected keys.") also auto-shows for 3 s when the `show-custom-lighting-tip` event fires (PAGE 1997-2003).

### 4.7 Page-level device events (PAGE 217-395)

| Event | UI reaction |
|---|---|
| `DEVICE_DONGLE_CONNECT_CHANGE` false / disconnect without `wireless-link` reason | persistent warning toast `.dongle-sleep-message` (top-right, `duration:0`, close button; red text on `#fff0f0`, red "!" circle icon): "The device has disconnected. Please reconnect it or select another device." (PAGE 300-318; CSS-PAGE) |
| Reconnect probe | on connect-change true: up to 3 `getDeviceInfo` attempts 200 ms apart (`Yt = 3`, `po = 200`), then `connectDeviceStatus = true` and the toast closes (PAGE 330-348) |
| Idle refresh | after `pointerdown`/`keydown`/`wheel`, a 1000 ms debounced re-read of profile, OS mode, sleep time and battery (`vo = 1e3`, PAGE 362-372) |
| `SWITCHCONFIG` / `PROFILE_CHANGE` (from device) | toast "Switched to: {name}", cache invalidation, full reload (PAGE 240-246, 286-292) |
| `SYSTEM_CHANGE` | updates Win/Mac and reloads (PAGE 293-297) |
| `BATTERY_CHANGE` | header battery |
| `LIGHTING_EFFECT_CHANGE` | mirrors effect/brightness/speed/direction/colour into the lighting store and debounces a data refresh 300 ms (PAGE 374-392) |
| `CUSTOMCOMMAND` mode (boardId 3670017 only) | toasts "Switched to: Office Mode / CS:GO Player Mode / VALORANT AD Player Mode / VALORANT Release Player Mode / Custom Mode" (PAGE 396-408) — latent for K98 Pro (UNVERIFIED boardId) |
| No keyboard instance on init | modal confirm "Notice / No device connected" with a single "OK" (no close, no overlay/Esc close) → `router.replace({name:"connect"})` (PAGE 440-458) |
| `KEY_CALIBRATION` finished on an uncalibrated key | sets `isCalibrationDialog` (dialog itself belongs to the latent performance page) |
| Wired PID 4325 | 2 s after init, silently `display.updateTime(new Date())` (PAGE 468-474) |

---

## 5. Panels

All panels share: width `min(1642px, 100%-40px)`, height 420 px (`--device-panel-height`), background `rgba(21,24,44,.7)`, 1 px `rgba(255,255,255,.12)` border, `backdrop-filter: blur(5px)` (10 px on macro/config), and the `PanelCorners` overlay (CORNERS): four decorative corner SVGs — top-left 20×12 green `#5A9F11`, top-right 15×11 purple `#631DFF`, bottom-left 15×11 purple `#631DFF`, bottom-right 27×19 green `#5A9F11`, `pointer-events:none`, z-index prop (default 4).

### 5.1 Lighting (`/device/lighting`) — LIGHT, CSS-LIGHT

Layout: `.lighting-panel__tabs` 52 px bar (bg `#27375733`) holding a 280×28 two-segment switch (green sliding indicator, GSAP 0.28 s `power3.out`); body = 3 equal columns, each padded 20 px with right divider; at narrow heights the body becomes a vertically scroll-snapped single column (CSS-LIGHT media overrides).

Tabs (LIGHT 470-473): "Key Backlight" (`key` → `LightType.Main`) and "Side Light" (`side` → `LightType.Side`).

Column 1 "Lighting Effect" (`LightingModePanel`, LIGHT 280-420):

| Control | Spec |
|---|---|
| "Side Light Sync" (key tab only) | label + 19 px help icon (tooltip "When this feature is enabled, it only takes effect when the key backlight and side light use the same lighting effect.") + 48×24 chamfered switch (track `#494949`/`#9bff31`, thumb `#e9e9e9`/`#6a2eee`); persisted in localStorage `k98pro:lighting:side-light-sync` (LIGHT 476-490); turning it on forces "Always On (Static)" if the current main effect is not shared and copies main settings to side (LIGHT 812-822) |
| Effect grid | 3 columns × 32 px buttons (label left, 20 px iconfont right), bg `rgba(255,255,255,.05)`, hover `#ffffff1a`, active `#3d1f7e`; `max-height:282px` scrollable; a tooltip shows the full name only when the label overflows (ResizeObserver, LIGHT 300-322); buttons disabled at 30 % opacity when sync is on and the effect is not available on both light types |

Effect catalogue (MAIN 8567-8675, labels I18N `lighting.modes.*`): main = Off, Custom (Static), Always On (Static), Breathing, Dream Rainbow, Instant Trigger, Walking in Rain, Rainbow Wheel, Ripple, Starry Night, Snow Trail, Endless Flow, Drifting Waves, Shadow Follow, Sine Wave, Left-Right Scan, Spinning Windmill, Rainbow Waterfall, Blossom, Spinning Storm (20 entries); side = Off, Always On (Static), Breathing, Dream Rainbow, Endless Flow, Marquee (6). Icon names: `guanbi, zidingyidengxiao, changliang, huxi, menghuancaihong, yichujifa, yuzhongmanbu, caihonglunpan, lianyikuosan, fanxingdiandian, taxuewuhen, chuanliubuxi, suibozhuliu, ruyingsuixing, zhengxianguangbo, zuoyousaomiao, xuanzhuanfengche, qicaipubu, huakaifugui, xuanzhuanfengbao, paomamoshi`. Selecting "Off" while enabled turns lighting off; selecting an effect calls `lighting.changeEffect` then re-reads `getEffect` (LIGHT 780-811). Choosing Custom on the key tab loads per-key colours and shows the selection tip (LIGHT 800-804).

Column 2 "Lighting Settings" (`LightingSettingsPanel`, LIGHT 424-470):

| Control | Type | Range / step | Disabled when |
|---|---|---|---|
| "Brightness" | `GlobalSlider` (28 px rail `#626476`, track `#6a2eee`, 16×32 hexagonal thumb) + value "{n}%" | 0–100 %; step 5 on key tab with sync off, 25 with sync on or on side tab (`kt`, LIGHT 560); mouse wheel steps by one increment; device mapping main 0–20, side 0–4 (`Xe`, LIGHT 645) | lighting is Off |
| "Speed" | same slider | 0–100 %, step 25 (`Kn = 25`); device 0–4 | Off, or effect ∈ {Custom, Always On} (`v`, LIGHT 525) |
| "Random Color Shift" | 48×24 switch | on/off → device `colorIndex 7` (`Oe = 7`, LIGHT 478) | Off, or effect ∈ {Dream Rainbow, Rainbow Waterfall, Spinning Windmill, Custom} (`Z`, LIGHT 524) |

Column 3 "Color Settings" (`LightingColorPanel`, LIGHT 60-275):

| Control | Spec |
|---|---|
| SV wheel | 320×193 (214×150 in the compact override) gradient square, crosshair cursor, 16 px rotated-square cursor marker; pointer drag sets saturation/intensity |
| Hue bar | 320×18 rainbow strip with `<input type=range min=0 max=100 step=1>` (0–100 → 0–360°) |
| Format toggle | 104×28 two-button shape "HEX" / "RGB" with purple `#6a2eee` active half |
| RGB fields | three inputs `R/G/B`, numeric, `maxlength 3`, clamped 0–255, bg `#ffffff14`, focus `#6a2eee4d` |
| HEX field | single input `maxlength 7`, uppercase, accepts `#RGB`/`#RRGGBB` |
| "Recently Used" | 12 swatches (2 columns × 26 px), localStorage `k98pro.lighting.recent-colors` (max 12), seeded with `#ff0101 #ff0198 #d600fe #4801ff #27adff #26ffc8 #1dff4c #9bff93 #d3ff14 #fed908 #fe5200 #fe6677` (LIGHT 588-597) |
| Disabled | when Off, effect ∈ {Dream Rainbow, Rainbow Waterfall, Spinning Windmill}, or random colour is on (except Custom) (`ke`, LIGHT 526) |

Writes are debounced 120 ms per light type (LIGHT 726-732); errors set `se` and toast "Failed to apply lighting settings" (`lighting.applyFailed`); recent colours debounce 300 ms. Device-originated `LightingEffectChange` events update the panel and, on a side change, auto-switch to the Side tab (LIGHT 660-700).

### 5.2 Display Settings (`/device/screen`) — SCREEN, CSS-SCREEN

Only enabled on the wired PID (see 4.2). Layout: `.screen-container` (margins 20 px) = preview block (max 810 px wide, 419 px high) above the 420 px settings panel with two columns.

Preview block:

| Element | Spec |
|---|---|
| `.display-preview` | 251 px high, radius 16, bg `rgba(255,255,255,.12)`; `img.screen-img` (flex 685 px, 227 px high, bg `#000`, radius 6; `image-rendering:pixelated` when the source is at native size or read from the device) + decorative `png/control-lever-Ct3Bk1Zw.png` 89×227 |
| Tip | "Tip: This feature is unavailable in 2.4G mode" |
| Buttons (88×28 chamfered) | hidden "read display" (`display:none`, SCREEN 934-937); "Sync Time" (purple; shows "Syncing"/"Initializing"; toasts "Time synced"/"Time sync failed"); "Apply" (green; shows "{n}%" while applying to the selected image, or "Initializing"; toasts "Display image applied"/"Failed to apply display image") |
| Preview source | preset thumbnail or its GIF (GIF only after 900 ms hover-free delay `vt`, SCREEN 660-666), custom image blob URL, or device-read PNG |

Settings panel:

| Column | Controls |
|---|---|
| "Presets" (+ help tooltip "Presets help") | vertical list of 4 preset cards (2 px transparent border, active gets a `#9bff31` 2 px frame; hover brightness .6). Order/ids (SCREEN 597-614): id 4 "Preset 3" (`figma-display-preset-4.png`, GIF `figma-display-preset-4-LOXWCh1c.gif`), id 1 "Preset 1" (`…-1.png`, GIF `…-1-D10kuLZy.gif`), id 2 "Preset 2" (`…-2.png`), id 3 "Preset 3" (`…-3.png`) |
| "Custom" (+ "Custom help") | grid `repeat(auto-fill, 260px)` gap 14: upload card (dashed frame, `icon-add` 16 px, "Upload File", hint "Ratio {w}*{h}, GIF/PNG/JPG format, max 3 MB" using `profile.displaySize` default 428×142, SCREEN 590) that shows a conic progress ring "{n}%" + "Uploading, please wait…" while processing; then one card per stored custom image (IndexedDB db `gravastar-screen-display`, store `custom-images`, SCREEN 330-380) with a 28 px delete button (top-right, hover-only) |

Upload rules (SCREEN 380-400, 838-870): accepted `image/gif`, `image/png`, `image/jpeg` or `.tabml`; error "Only GIF, PNG and JPG files are supported" / "Please select a file to upload"; max 3 MB (`Or = 3*1024*1024`) after conversion; static images are letter-boxed onto a black canvas at display size and re-encoded (PNG, then JPEG q0.96 if still >3 MB); GIFs are re-quantised to a 3-3-2-bit palette (256 colours) and frame-stepped until ≤3 MB, else "The GIF … exceeds the size limit of 3 MB…" with "Please delete some frames and try again."; TABML files are passed through (preview placeholder canvas "TABML"). Success toasts: "Custom image saved", "Custom image deleted"; failures: "Failed to load custom images", "The image does not meet the upload requirements", plus the detailed `screen.*` error strings (see §7).

Apply flow (SCREEN 900-945): full-screen mask `.screen-container__apply-mask` (`#04060fd1`, blur 4, cursor wait, z-index max) with "Applying to the screen, please wait…", a 340×31 progress bar (track `#494f68`, fill `#6b27ff`, marker image `svg/upload-icon-vx4BO1nm.svg` 33×32) and "{n}%" in `#9bff31` 24 px bold.

### 5.3 Key Remapping (`/device/custom-key`) — CUSTOM, CSS-CUSTOM, KEYPICK

Panel `.custom-key-panel` with inner padding 20 px. Header (32 px): tab strip + help icon + search.

| Control | Spec |
|---|---|
| Tab strip `.custom-key-tabs` | 100 px × 28 px segments on `#ffffff1f`, chamfered (6 px cuts), green sliding indicator (GSAP 0.28 s); active text `#6a2eee`; tabs (CUSTOM 24-45): "Basic" (0), "Controls" (4), "Lighting" (2), "Mouse" (5), "Macro" (1), "Combos" (7); "Tri-Mode" (6) is appended only when `isthreeDevice` — hard-coded `false` (MAIN 7816) |
| Help | `icon-help` 16 px, tooltip "Changes made here affect this profile and any linked profiles. To remap a key, select it below and drag it onto your keyboard." |
| Search | 200×32 chamfered frame, magnifier icon, placeholder "Search keys"; filters legends across Basic + function tabs (search results grid 328 px high) or macro names/counts; empty → "No matching results" |

Tab contents:

| Tab | Content |
|---|---|
| Basic | fixed 1291×328 grid (`De/Ve`, CUSTOM 693) scaled to fit; four sections (`sec/thir/four/fifth-section`) from `Z9` sections 2–5 (MAIN 14566-14606) with per-key widths via `specialSize` (`width-25/50/60/78/80/93/106/118/146/314` classes, e.g. space `44:314`, Enter `40:118`, Backspace `42:106`, Shift `2097152:146`); keys are `.draggable` 48×48 tiles (bg `#090c17`, border `rgba(255,255,255,.2)`, hover `#3d1f7e`, radius 4); keycode 9999 renders an invisible 25 px spacer; keycode 0 = "Blank Key" |
| Controls / Lighting / Mouse | flex-wrap of 48 px tiles from keycode groups `control`, `light` (+ decorative-lighting extras depending on `lightingArea.length`), `mouse` (MAIN 10609-10622); icon tiles use iconfont glyphs (`I` icon map) and tooltips from `messages.keyTip_*` |
| Macro | cards `custom-key-macro-card` (48 px high, max 92 px) showing the action count badge (top-right) and macro name; only macros with actions and a valid encoded keycode are listed (CUSTOM 735-748); empty state: logo art + "Macro is empty — edit it in Macro Settings first" |
| Combos | `DeviceConfigCustomKeyCombine` (CUSTOM 330-640): left editor (360 px, bg `#04071366`) with h2 "Custom Key Combo", p "Choose 1-4 modifier keys and up to 2 other keys"; group "Modifier Keys" (help "Choose at least one modifier key, plus up to two other keys") = 4 toggle buttons 74×48 (Win labels Ctrl/Shift/Win/Alt, Mac labels Control/Shift/Option/Command; masks ctrl 1, shift 2, alt 4, win 8) showing a 1-based order badge; group "Other Keys" = two dashed slots "Other key {slot}" opening the **KeyboardKeyPicker** anchored to the slot, each with a hover "×" remove; "Add" button 88×28 green at bottom-right (enabled with ≥1 modifier and slot 1 filled) → encodes `0x00 | mask<<16 | key2<<8 | key1`, rejects duplicates ("This key combo already exists"), toasts "Key combo added", persists in localStorage `gravastar:k98pro:custom-combo-keycodes`. Right list "Key Combo List": default combos from `k9`/`combine` group (tooltips "App Shortcuts", "Close current tab", "Open Task Manager", "Switch app", "Cycle windows in the order they were opened") followed by custom ones with a hover "×" delete; each combo chip is click-to-select and drag-to-bind |

Candidate click (CUSTOM 133-160): with a key selected on the stage, click assigns the keycode (`updateKeyCode`) — errors "Please select a keyboard key as the trigger first", the advanced-key conflict toast, or the FN-clear confirm. The older `onApply` combo path (toasts "Please select an associated key first", "Please select at least one modifier key (Win, Shift, Ctrl or Alt)", "Key combo set") remains in the composable (CUSTOM 162-200).

KeyboardKeyPicker dialog (KEYPICK, CSS-KEYPICK): `role=dialog` fixed panel bg `#202036`, 1 px border, radius 2, padding 24, shadow `0 24px 64px #00000059`, mask `#05081214` z-index 3000; title default "Select Key"; close button (`icon-close` 20 px, aria "Close key picker"). Content = full ANSI main block (6 rows of 48 px keys, width = units×48 + gaps×8; e.g. Backspace 2.26 u, Space 5.8 u), nav cluster (3×6 grid: PRTSC LOCK PAUSE / INS HOME PGUP / DEL END PGDN / arrows), and numpad (4×5 grid with tall `+`/Enter and wide `0`). Keys: 48×48, bg `#080b16`, hover/selected `#ffffff14` + `#ffffff52` border; disabled 55 %. Position: anchored below (or above if no room) the anchor with 24 px margins, panel assumed 1339×426 (KEYPICK 24-40); centred when no anchor. Selecting emits `select(keycode)` and closes unless `closeOnSelect=false`.

### 5.4 Advanced Keys (`/device/high-level-key`) — ADV, CSS-ADV

`.device-advanced-key-page` holds a 200 %-wide track; the hub panel and the active editor slide (`translate3d(-50%)`, 0.32 s) when an editor opens (`is-secondary-active`); closing waits 320 ms (`nl`) before unmounting (ADV 760-780). Only layer 0 (`Normal`) and the current system are edited (ADV 700-705). Test-area key chips disappear 500 ms after key-up (`ol`).

Hub panel = 3 columns (24 px padding, middle column bordered):

| Column | Content |
|---|---|
| "Add Advanced Key" (+ help "Advanced Key") · p "Select an advanced key type from the list below, then follow the instructions" | 4 type cards (66 px min, icon 36 px + bold label + small description; hover `#3d1f7e`): "SOCD" — "When two keys are pressed together, instantly trigger the designated key based on your preset"; "Release Trigger (END)" — "A single key can send another key when released"; "Dual Action (MT)" — "One key, two functions — hold and click do different things"; "Toggle (TGL)" — "Click to latch continuous triggering; hold for normal triggering" (ADV 640-668) |
| "Configured Advanced Keys" + count badge "{n}/40" · p "Active advanced keys are shown here" | list items (bg `#ffffff0d`, active `#3d1f7e`): `[source key chips] [type icon 36 px] [target chips]` — SOCD shows both keys twice, END/TGL show source → bound key, MT shows source → hold + click; each has a 16 px `icon-delete` (toasts "{type} configuration deleted" / "SOCD configuration deleted", errors "Failed to delete advanced key configuration" / "Failed to delete SOCD configuration"); clicking an item reopens its editor with data; empty list renders `.advanced-empty-state` (blank) |
| "Key Test" · p "Test your configured advanced keys" | `.advanced-test-area` (`role=textbox`, focusable) with masked SVG patterns (`svg/test-panel-top…`, `svg/test-panel-bottom…`) and empty state (80×80 logo art + "Click a key to test it"); while an editor is closed, physical key presses render `kbd` chips 48 px (bg `#9bff31`, text `#6a2eee`, 20 px bold) labelled with the advanced tag + key (e.g. "MT A") or the legend |

Editor header (`AdvancedKeyEditorHeader`, ADV 40-80): back arrow (aria "Back to Advanced Keys home"), h1 type label, p description, "Cancel" (purple 88×28) and "Confirm" (green; "Confirming" while saving, disabled until valid).

| Editor | Columns / controls | Validation & result |
|---|---|---|
| SOCD (ADV 360-520) | "1. Select key" / "Select 2 keys from the preview above to bind" with two 64×64 boxes "Key 1", "Key 2" (click a box to target it, then click stage keys; clicking a chosen key again clears it) + risk tip (24 px icon + "SOCD is currently restricted or banned in some games (such as CS2)…"); "2. Set SOCD mode" / "Choose what happens when both keys are pressed at the same time": 4 radio rows with help tooltips — "Last Input Priority" (`LastPressWins`=1) "The most recently pressed key overrides the previous one"; "Key 1 Always Wins" (`FixedFirst`=3) "Key 1 always takes priority over Key 2"; "Key 2 Always Wins" (`FixedSecond`=4) "Key 2 always takes priority over Key 1"; "Neutral" (`CancelAll`=0) "When both keys are active, neither is triggered" (values MAIN 403-412) | needs two distinct keys ("Please select two keys on the keyboard first"); writes `{type:SOCD(4), ids:[a,b], responseMode}`; "SOCD written to device" / "Failed to write SOCD" |
| END (ADV 90-200) | "1. Select key" one box "Key"; "2. Bind key" / "Click to choose the key to bind" box labelled "Hold" opening the KeyboardKeyPicker (`closeOnSelect:false`) | "Please select the key you want to configure first" / "Please select the key to trigger on release"; picker key not in keycap table → "This key is unavailable"; writes `{type:END(6), id, keycode}`; "END written to device" / "Failed to write END" |
| MT (ADV 200-360) | source box "Key"; bind boxes "Hold" and "Click" (picker; after choosing Hold it auto-targets Click); "Hold Time" control: value box 140×32 showing "{ms}ms" with up/down steppers ±10 ms, and a `GlobalSlider` min 0.1 max 4 step 0.01 (seconds ×100 → ms ⇒ 10–400 ms), default 1.55 → 155 ms; wheel ±0.01 | "Please select the keys to trigger on hold and on click"; writes `{type:MT(2), id, delay, clickKeycode, holdKeycode}`; "MT written to device" / "Failed to write MT" |
| TGL (ADV 520-640) | source box "Key"; bind box "Key" via picker | "Please select the key to toggle"; writes `{type:TGL(1), id, keycode, delay:200}` (fixed); "TGL written to device" / "Failed to write TGL" |

Keys already used by another advanced key (`occupiedKeyIds`) cannot be selected as a source. Type ids (MAIN 453-470): NONE 0, TGL 1, MT 2, DKS 3, SOCD 4, MPT 5, END 6, RS 7. DKS/MPT/RS have i18n strings and stage support (`multipleHighLevelKey = ["socd","rs"]`, PAGE 750) but no editor/type card is shipped.

### 5.5 Macros (`/device/macro`) — MACRO, CSS-MACRO

List panel `.macro-content` (padding 20, gap 24): header h2 "Macro List" + p "Once set, drag a macro onto a key to bind it" + "Add Macro" button (`icon-add`, ≥88 px). States: "Loading…" (`messages.loadingData`) while fetching; empty → 80×80 logo art + "Macro is empty, click to add" (MACRO 618-626); otherwise rows (48 px, bg `#ffffff0d`, hover `#3d1f7e`, cursor grab) with bold name, action-count badge, and a `icon-more` button that opens a floating 116 px menu (`.macro-row-menu`, teleported) with "Rename" / "Delete" (MACRO 456-470, 640-650). Rows are drag sources carrying the encoded macro keycode (MACRO 483-497). Delete is refused with "This macro is bound to a key. Unbind it before deleting." if any layer/system binding references it (MACRO 415-425). Rename opens the GlobalConfirm input dialog (title "Rename", max 10 chars, counter) (MACRO 426-455).

Editor overlay (MACRO 653-860; CSS-MACRO): fixed right-side sheet `min(60vw,1152px)` (min 720 px), bg `#0b0e1f`, backdrop blur 14, enter 360 ms / leave 220 ms slide from +48 px.

| Control | Type | Range / default |
|---|---|---|
| Title | h2 "Recording Macro" (`app.macroRecording`, chosen because `macro.settingsTitle` === "Macro Settings", MACRO 96-99) + close × | — |
| Name | inline input `maxlength 10`, placeholder "Enter a macro name", width auto-fit 30–240 px, count badge (`actions.length`), pen icon to focus | default `M{n}` |
| "Start Recording" / "Stop Recording" | green button ≥124 px (`icon-start`/`icon-pause`); recording state white bg, `#f66` text | records key/mouse events via the SDK recorder excluding `.macro-exclude` elements; first action delay 0 unless default delay is on |
| "Reset" | ghost button, enabled when actions exist | confirm "Reset / Clear all recorded content in the current macro?" → clears actions |
| "Save" | primary, enabled when actions and name exist | writes all macros, toasts "Macro saved"; if trigger mode/loop changed re-writes bound keycaps ("Failed to bind macro. Make sure the device is connected." on error) |
| "Trigger Mode" | TDesign select 240×32 (popup `macro-trigger-select-popup`) | "Trigger on press" (`Count`), "Repeat while held, stop on release" (`UntilKeyUp`), "Repeat until any key is pressed" (`UntilKeyDown`) |
| "Loop Count" | number input 140×32 with ± steppers (only for "Trigger on press") | min 1, integer |
| "Default Delay" | 48×24 switch + ms input (100×32, hidden until on) with ± steppers | 1 … `ba` = 1048575 ms in code (MAIN 315); default 50 ms (`be = 50`) |
| Action rows | 40 px rows: 12×16 dotted drag handle (pointer drag reorder with auto-scroll 14 px near 48 px edges), key label 88×32 (`#070a14`), Press/Release 132×28 chamfered segmented with animated indicator (`Down`=0 / `Up`=1, MAIN 327), delay input "ms" with steppers (1 … 1048575), `icon-delete` | mouse actions labelled "Mouse Left/Wheel/Right/Back/Forward" |

Storage guard (MACRO 20-24, 218-236): estimated size = 4 + UTF-8 name bytes + 4 × actions per macro vs `getMacroMaxStorageSize`; exceeding shows `macro.storageLimitReached` and a missing max shows `macro.storageUnavailable` — both strings exist only in `zh_CN` (MAIN 6962-6963). Per-macro trigger mode/loop count are cached in localStorage (`j9`, MAIN 14527-14535). Names are truncated to 10 chars (`A = 10`).

### 5.6 Profiles (`/device/config`) — PROFILES, CSS-PROFILES, COPY, SYNC

Two cards side by side (761 px each, bg `#15182cb3`, blur 10, padding 24, gap 20).

Card 1 (aria "Onboard Profiles"):

| Section | Controls |
|---|---|
| Header | p "Local Profiles"; buttons "Import Profile" (purple, opens hidden `<input type=file accept="application/json,.json">`) and "New Profile" (green) |
| "Onboard Profiles" (+ help "About onboard profiles", count "{n}/3") | 3 rows (`board-profile1..3` icons 24 px, name, green "Applying" pill on the active one); row click switches profile (TDesign full-screen loading; toasts "{name} applied" / "Failed to switch profile. Make sure the device is connected."); actions: `icon-pen` "Rename" → input dialog "Rename Profile" (max 10 chars, sanitised to CJK/alphanumerics, `D9` MAIN 7926) → `profile.setProfileName`, toasts "Renamed" / "Rename failed…"; `icon-copy` "Duplicate Profile" → input dialog "New Profile"… ("Duplicated"); rows are drop targets for inactive profiles (`is-drag-over` purple ring) → replaces the onboard profile with the dragged config, toast "Profile replaced" / "Failed to duplicate profile…" |
| "Inactive Profiles" · p "Profiles stored on this platform (browser/PC) are only accessible here. Drag a profile onto an onboard slot to replace it." | draggable rows (`icon-profile-icon`) with `icon-pen` Rename, `icon-delete` Delete (confirm "Delete Profile / Deleted profiles cannot be recovered. Proceed with caution!" → "Deleted"/"Delete failed"), `icon-icon_upload` "Export Profile" (downloads `{name}.json` v2 snapshot, toasts "Profile exported"/"Profile export failed…"); empty → dashed 80 px button `icon-import` "No inactive profiles yet — click to import" |

Card 2 "More" (aria "More profile features"): h1 "More", p "More features are on the way — stay tuned…", empty-state art + "More features coming soon / Stay tuned…".

Data rules: inactive profiles live in localStorage `gravastar:inactive-profile-configs:v1` (COPY 55); creating/duplicating snapshots keymaps for layers ×2 systems, advanced keys, key travel, rapid triggers, lighting effects (Main/Side/Logo), key switch types, safe areas, custom main light, macros and "other settings" (COPY 100-150); import validates that `uuid` matches the connected device (PROFILES 310-330), accepts v1/v2 exports or name-only bundles, toasts "Profile imported" / "Profile import failed. Check the file contents or the device connection." / "No valid onboard profile name found in the imported file". Profile ids: `Default`, `Onboard1`, `Onboard2` (values 0/1/2, MAIN 389-391 & 7926) shown as "Onboard Profile {n}" when unnamed; default-name aliases are listed in MAIN 7932-7934.

### 5.7 Other Settings (`/device/other`) — OTHER, CSS-OTHER, SYNC

`.device-other-settings` (max width `--device-settings-content-max-width` 1200 px) with one panel; loading overlay "Loading…" while the batch read runs. Section h2 "Basic Settings":

| Row | Control | Options / range | Feedback |
|---|---|---|---|
| "Mac Mode" — "In Mac mode, system keys such as Win/Alt are remapped to Option/Command." | 48×24 chamfered switch (busy spinner state) | on = `changeOsMode(MacOS)` | "System switched" / "Failed to switch Mac mode. Make sure the device is connected." |
| "Win Key Lock" — "When enabled, the Win key is locked — useful for preventing accidental presses during gaming." | switch; disabled in Mac mode or while busy | writes `setWinKeyLock`, verifies with `getWinKeyLock` after 180/220 ms, retries once with a fresh keyboard instance (OTHER 236-252); in Mac mode a keymap backup swaps the Win keys | "Failed to set Win key lock…" |
| "Debounce Time(ms)" — "Choose the trigger filtering strategy that suits your switches and typing style." | segmented (`min(560px,100%)` × 28) "Normal", "Leading Edge", "Trailing Edge", "Auto Debounce" (order OTHER 119-131; enum values 0–3 UNVERIFIED mapping) | `setDebounceMode` | "Failed to set debounce mode…" |
| (same row) debounce time | `GlobalSlider` min 1 max 50 (ms; device value µs 1000–50000, `Ee=1`, `We=5e4`), labels "1ms"/"50ms", plus a 140×32 stepper (−, numeric text input, +) with Enter/Esc handling; wheel ±1 | `setDebounceTime` | "Failed to set debounce time…" |
| "Sleep Timer" — "The keyboard sleeps automatically after a period of inactivity to reduce power consumption in wireless mode." | fluid segmented: "30s", "1min", "2min", "5min", "10min", "15min", "30min", "1h", "2h", "Never sleep" (seconds 30/60/120/300/600/900/1800/3600/7200/0, MAIN 14614-14644); disabled when disconnected | `setSleepTime` | "Sleep timer set" / "Failed to set sleep timer" |
| "Polling Rate" — "The device may briefly reconnect after the polling rate is changed — this is normal." | segmented "125", "250", "500", "1K", "2K", "4K", "8K" (`Rate125`=3, `Rate250`=2, `Rate500`=1, `Rate1K`=0, `Rate2K`=6, `Rate4K`=5, `Rate8K`=4, MAIN 360-380) | `setPollingRate` + 120 ms wait | "Polling rate set" / "Failed to set polling rate" |

Section h2 "Device Overview":

| Row | Content |
|---|---|
| Device card | product name, `youxian`/`a-24G` icon + "Wired"/"2.4G", battery SVG + "{n}%" |
| Firmware | h3 "Keyboard Firmware Version" + `V…` + red "Update" tag when newer; p "Latest version {version}" + " — already up to date, no update needed" when current; button "Update Firmware" (green, ≥125 px; `is-disabled` look when current → info toast "Firmware is already up to date", else `window.open(latestFirmwareURL)`). Latest version comes from `POST /gravastar-version` with body `type:Firmware-Keyboards-K98Pro-{en|cn|uk|ja}-url` (SYNC 20-40, DEVICE 15-24); when the sidebar detects an update it auto-navigates to Other and scrolls the firmware row into view once (SYNC 100-120, OTHER 148-160) |
| "Factory Reset" — "Resets all keyboard settings to their factory state. Proceed with caution." | button "Factory Reset" → confirm "Factory Reset / A factory reset returns all keyboard settings to their factory state. Proceed with caution!" with danger-themed "OK" → `resetKeyboard`, wait 1200 ms, re-acquire keyboard, reload everything, `localStorage.clear()` (keeping inactive profiles), toasts "Factory reset" / "Factory reset failed…" |

### 5.8 Latent / unreachable UI found in the bundle

| Area | Evidence | Status |
|---|---|---|
| Performance (travel, rapid trigger, dead zone, axis, calibration, travel test) | performance store + `Ca` per-key info + calibration dialog plumbing (PAGE 25-70, 400-470, 1237-1310), tooltips "Mode: Rapid Trigger / Actuation Point / Press Travel / Release Travel / Mode: First Trigger", strings "Not calibrated / Calibrated / New Calibration / Start Calibration / Calibration complete / Key Test Area" | No route in `ko` (MAIN 158) → unreachable |
| Handle (gamepad) page, tri-mode tab | `co` includes `handle`; keycode groups `xboxHandle`, `classHandle`, `triMode` (MAIN 10615-10617); tab "Tri-Mode" | unreachable (`isthreeDevice=false`) |
| DKS / MPT / RS editors | dialog strings `advancedKeyDialog*` (Dynamic Keystroke, Multi-Point Trigger, Rapid Snap with "How It Works", "Key Features", "Video Guide", "See {title} in action", "Got it"), `dksPress/dksRelease/dksMinTravel/dksMaxTravel`, `mptDepthMustIncrease` | strings only; no component |
| Decorative lighting grid (`LightingLogo` cells) | PAGE 1180-1230, 1610-1660; `lightingArea` empty for K98 Pro (GLOBAL 26-28) | unreachable |
| Login / phone binding / WeChat | `messages.login…wechatInitFailed` | strings only |
| Cloud sync / import by code | `configSyncToCloudTitle`, `configImportPlaceholder` "Enter the profile code", `shareImport/shareExport` | strings only |

---

## 6. Dialogs, toasts and feedback primitives

### 6.1 GlobalConfirm (CONFIRM 200-419, CSS-CONFIRM)

`role=alertdialog`, overlay `#04060fb3` + blur 2, dialog `min(360px, 100vw-32px)`, min-height 194, bg `#0e1524`, padding `16px 20px`, grid rows `24px / ≥44px / 32px` gap 31; title 16 px; close × (hidden when `closeBtn:false`); optional input (36 px, 1 px `rgba(255,255,255,.9)` border, caret `#9bff31`, counter "n/max"); footer buttons 88×28 chamfered — cancel purple, confirm green (danger theme supported via `confirmBtn:{theme:"danger"}` — same colours in CSS, UNVERIFIED styling); Enter confirms, Esc closes (when allowed), Tab is trapped, focus returns to the opener; 160 ms leave delay.

Confirm dialogs used (header / body / buttons):

| Where | Header | Body | Buttons |
|---|---|---|---|
| Device page init without keyboard | "Notice" | "No device connected" | "OK" only, not dismissable |
| System switch | "Notice" | "Switch system?" | "Confirm" only |
| Reset current layer | "Reset{layer}Key" (concatenated) | "All key assignments on the current {layer} layer will be cleared and restored to factory presets. Continue?" | Confirm / Cancel |
| Reset all layers | "Restore Defaults" | "All key assignments on the Default, Fn and Fn1 layers will be cleared and restored to factory presets. Continue?" | Confirm / Cancel |
| Binding a layer key | "Notice" | "Changing the FN key will clear the function key in the corresponding position on the layer below. Continue?" | default |
| Macro reset | "Reset" | "Clear all recorded content in the current macro?" | "OK" / "Cancel" |
| Macro rename | "Rename" | input (placeholder aria "Enter a macro name", max 10, required, counter) | Confirm / Cancel |
| Profile rename / create / duplicate | "Rename Profile" / "New Profile" | input (placeholder "Enter a profile name", max 10, counter) | Confirm / Cancel |
| Profile delete | "Delete Profile" | "Deleted profiles cannot be recovered. Proceed with caution!" | Confirm / Cancel |
| Factory reset | "Factory Reset" | "A factory reset returns all keyboard settings to their factory state. Proceed with caution!" | "OK" (danger) / "Cancel" |

### 6.2 GlobalMessage toasts (TOAST, CSS-TOAST)

Stacks at `top:32px` centre (`top`) or right 24 px (`top-right`); pill 40 px min-height, bg `#0e1524`, 14 px text; icons: success `#00b42a`, error `#f53f3f`, warning `#ff7d00`, info `#165dff`, loading spinner `#9bff31`; default duration 3000 ms (loading 0); optional close button; `role=alert` for error/warning. TDesign `MessagePlugin` is shadowed by this implementation (`M` export).

### 6.3 Other feedback primitives

| Primitive | Spec |
|---|---|
| `global-tooltip` (TDesign Tooltip wrapper, SHELL-PICKER 7150-7195 / CSS-APP) | bg `#1d2129`, radius 2, 8×12 px padding, 14/22 px text, max 304 px, custom 10×4 caret, default delay 120 ms |
| `device-menu-tooltip` | bg `#15182cf5`, 1 px `rgba(155,255,49,.18)` border, 13 px, blur 8 |
| `custom-key-candidate-tooltip` | key tile tooltips, delay 120 ms |
| Macro-key popconfirm (PAGE 862-905) | TDesign Popconfirm theme warning, hover trigger with 200 ms open / 300 ms close, content "Unbind this macro?" → resets the key and toasts "Done" |
| TDesign full-screen Loading (`eo({loading:true})`) | used for profile switch/copy/replace/export (PROFILES) and sidebar profile switch |
| `.other-page-loading`, `.macro-loading`, `.device-keyboard-loading` | inline loading states (see §5) |

---

## 7. Empty, loading and error states (summary)

| Screen | Empty | Loading | Error |
|---|---|---|---|
| Host devices | add card only; route → `connect` when zero devices | `aria-busy` on Add button/cards | `.devices-screen__error` alert; toast for manual URL |
| Sub-app connect | hero + "Authorize & Connect" | `aria-busy` | — |
| Device page | "Notice / No device connected" modal | "Loading keyboard data…" stage | dongle-sleep toast |
| Lighting | — | — | "Failed to apply lighting settings" |
| Screen | — | ring "{n}%", "Initializing", "Syncing", apply mask | many `screen.*` strings (file type, size, GIF frames, IndexedDB, pixel data) |
| Custom keys | "Macro is empty — edit it in Macro Settings first"; "No matching results" | — | advanced-key conflict toast; combo validation toasts |
| Advanced keys | blank configured list; "Click a key to test it" | "Confirming" | write/delete failure toasts |
| Macros | "Macro is empty, click to add" | "Loading…" | bind/delete/storage toasts |
| Profiles | "No inactive profiles yet — click to import"; "More features coming soon / Stay tuned…" | TDesign loading; "Applying" pill; "Creating profile…"/"Replacing profile…" strings exist | rename/copy/import/export/switch toasts |
| Other | — | "Loading…" overlay; switch spinner | per-setting failure toasts |

---

## 8. English strings by feature (I18N)

Namespaces: `messages` (top-level), `commonUi`, `common`, `configPanel`, `lighting`, `macro`, `other`, `highLevel`, `configManage`, `screen`, `app`.

- **Common**: `commonUi` — Confirm, OK, Cancel, Close, Delete, Rename, Reset, Save, "No keyboard device found", Select All, Invert Selection, Clear Selection, `selectTip` "Tip: hold the left mouse button and drag to select multiple keys; right-click to clear the lighting on selected keys."; `common` — Confirm, Cancel; `app.operationSuccess` "Done", `app.unknownError`, `app.dataProcessingFailed` "Data processing failed: {error}", `app.keyboardNotConnected` "Keyboard not connected — please connect the device first", `app.keyboardNotFound`, `app.unsupportedLcdDisplay` "This device does not support the gaming display", `app.deviceSettings`, `app.expandSidebar`/`collapseSidebar`, `app.language`, `app.keyboardStage` "K98 Pro Keyboard", `app.keyboardLoading`, `app.advancedKey`, `app.remappedKey` "Remapped", `app.closeKeyPicker`, `app.deviceSwitchSuccess` "Device switched", `app.deviceAddSuccess` "New device added", `messages.switchDevice` "Switch Device", `messages.addDevice` "Add Device…", `messages.loadingData` "Loading…", `messages.learnMore`.
- **Connect / devices** (`messages.connect*`, `noDevice`, `dongleSleepWarning`): listed in §3 and §4.7.
- **Menu** (`messages`): `menuTitle` "Keyboard Settings", `lighting`, `screen` "Display Settings", `customKey` "Key Remapping", `highLevelKey` "Advanced Keys", `macro` "Macros", `config` "Profiles", `other` "Other Settings", `experienceFeedback` "Feedback"; `configPanel.onboardConfig` "Onboard Profile", `configPanel.manageConfigFiles` "Manage Profiles".
- **Layers / system** (`messages`): `keyboardMainLayer` "Default Layer", `keyboardFnLayer` "Fn{n}", `FnLayer` "Layer", `customLayerContent`, `customLayerContent1`, `customKeyResetCurrentLayer`, `customKeyResetAllLayers`, `customKeyResetAllTitle/Body/Success/Failed`, `restoreLayerBody`, `restoreBody`, `keyboardDialogTitle` "Notice", `keyboardDialogBody` "Switch system?", `keyboardSwitchSuccess` "System switched", `keyboardFnClearTip`, `restoreDefaultLayout`, `restoreing` "Restoring", `keyboardSelectAll/Reverse/Cancel`, `keyboardBindTip` "Click a key on the keyboard above to bind it", `keyboardEditTip`, `keyboardCalibrateTip`, `keyboardCustomTip` "Drag a key from the keyboard below to remap it", `keyboardMacroTip` "Drag a macro from the list below onto a key to bind it", `app.systemSwitchFailed`.
- **Key remapping** (`messages.customKeyTab*`: Basic, Mouse, Special, Macro, Lighting, Controls, Tri-Mode, Combos; `customKeyHelp`; `isExistAdanceKey`; `app.customKeyPanel` "Key Mapping Panel", `customKeySearch`, `customKeyNoResults`, `customKeyMacroEmpty`, `customCombo*` (Title, Description, SystemKeys "Modifier Keys", SystemKeysHelp, AnyKeys "Other Keys", KeySlot, RemoveKeySlot, Add, List "Key Combo List", Remove, Exists, Added, SelectTrigger, SelectAssociated, SelectModifier, SetSuccess, ApplicationShortcut "App Shortcuts", CloseTab, TaskManager, SwitchApp, SwitchToNext), `macroLimitExceeded` "Macro limit of {count} exceeded — please delete some macros first"; key tips `keyTip_*` (Brightness +/−, Next/Previous Track, Stop, Play / Pause, Mute, Volume +/−, Music, Email, Calculator, My Computer, Browser, Next/Previous Lighting Effect, Lighting Color/Brightness/Speed/On-Off/Direction, Side Light variants, Accent Light — Color / On-Off, Factory Reset (hold), Switch to Windows/Mac Layout (hold), Calibrate Switches (hold), Switch to Profile 1–4, Win Key Lock, Blank Key, Switch to Main/Fn1/Fn2/Fn3 Layer, Mouse Release/Left/Right/Middle/Forward/Back/Move/Scroll).
- **Advanced keys** (`highLevel.*` and `messages.highKey*`, `advancedKeyDialog*`, `dks*`, `socd*`, `end*`, `mt*`, `tgl*`, `setAdvanced*`): see §5.4; extra: `highLevel.stepSelectOneDesc` "Select 1 key from the preview above to bind", `highLevel.selectOneKeyboardKeyFirst`, `highLevel.onlyBasicKey` "Advanced keys support basic keys only", `highLevel.writeSuccess` "Advanced key written to device", `highLevel.writeFailed`, `highLevel.selectConfigKeyFirst`, `messages.highKeyOnlyBindBasicChar`, `messages.setAdvancedSelectTwoKeys` "Please select two keys", `messages.setAdvancedSaveSuccess` "Saved", `messages.highKeyDeleteFail` "Delete failed", `messages.delaySliderTitle` "Adjust Time", `messages.mtDelayTitle` "Trigger Time", `messages.tglClickHold` "Click for continuous trigger", `messages.endDelay` "Trigger delay".
- **Macros** (`macro.*`, `messages.macro*`, `app.macroTriggerMode` "Trigger Mode", `app.macroRecording` "Recording Macro"): listTitle, listTip, addMacro, emptyPrefix, clickToAdd, settingsTitle "Macro Settings", namePlaceholder, startRecording, stopRecording, loopCount, defaultDelay, actionDown "Press", actionUp "Release", dragAction "Drag to reorder actions", resetConfirm, saveSuccess, bindFailed, deleteBound, trigger.press/holdRepeat/untilAnyKey; legacy `messages.macroMode*`, `macroDeleteBind` "Unbind this macro?", `macroCompleteKeyInfo`, `macroTimeMaxError` "Time cannot exceed 32768 ms", `macroTimeMinError` "Time cannot be less than 1 ms", `macroBatchEditTimeSuccess`.
- **Lighting** (`lighting.*`): modeTitle "Lighting Effect", settingsTitle "Lighting Settings", colorTitle "Color Settings", switchAria "Side Light Sync", sideLightSyncTip, brightness, speed, randomColor "Random Color Shift", recentlyUsed, applyFailed, tabs.keyBacklight/sideLight, modes.* (§5.1); `messages.lightingDecorTip` "Drag with the left mouse button to change the lighting color; right-click to clear it".
- **Display** (`screen.*`, `messages.screen*`): previewAlt, syncing, syncTime, presets, presetsHelp, custom, customHelp, uploadFile, presetOne/Two/Three, unsupportedFileType, syncSuccess/Failed, screenTips, uploading, uploadingTip, uploadTipDynamic, initializing, apply, applyingToScreen, loadCustomImagesFailed, deleteCustomImageSuccess/Failed, saveCustomImageSuccess, invalidUpload, initFailed, createPreviewFailed, retrySelectImage, uploadSizeExceeded, canvasCreateFailed, compressFailed, imageReadFailed, imageSizeInvalid, fileLabelImage/GifImage/TabmlFile, gifNoFrames, deleteFramesRetry, bitDepthConvert, readStaticPreviewLabel, readDisplaySuccess/Failed, selectUploadFile, pixelLengthError, staticPixelDataError, unknown, indexedDb* (Unsupported/OpenFailed/RequestFailed/TransactionFailed/TransactionAborted), uploadGifImage, selectGifFile, selectedFile, parsingGifFrames, frameAlt, applySuccess, applyFailed; `messages.screenCropSuccess`, `screenGifResolutionError`, `screenNoValidGifFrames`, `screenParseGifFailed`.
- **Profiles** (`configManage.*`, `app.profile*`, `messages.config*`): §5.6 plus `configManage.creating` "Creating profile…", `replacing`, `copying` "Duplicating", `exportConfig`, `importConfig`; `app.profileDefault` "Default Profile", `profileOnboard` "Onboard Profile {n}", `copyCodeSuccess` "Profile code copied to clipboard", `copyFailed`; legacy `messages.configRename…configReplaceCurrentTitle`, `pagination*`, `deviceConnected/Disconnected`, `deviceSn` "SN", `copySnSuccess/Fail`.
- **Other settings** (`other.*`): §5.7 plus `updateGetShakeFail`/`updateSetShakeSuccess`/`updateSetShakeFail` (anti-chatter, unused), `rateSetSuccess/Fail`, `updateSetSleepSuccess/Fail`, `sleep_*` labels.

---

## 9. Design tokens (from shipped CSS)

### 9.1 Colour

| Token / usage | Value | Source |
|---|---|---|
| Accent green (primary CTA fill, active labels, selection) | `#9bff31` (`--lighting-accent`, `--custom-key-accent`, `--macro-accent`, `--other-accent`, `--advanced-accent`) | CSS-LIGHT/CUSTOM/MACRO/OTHER/ADV |
| Accent green variants | `#a6ff1d` (`--device-list-accent`, host `--accent`), `#d0ff4f` (gradient end), `#b5ff68` (button hover), `#a8ff4e` (screen apply hover), `#70c010` (hover border), `#67B613` (profile switcher hover stroke), `#5A9F11` (corner art), `#baff22` (switcher link hover) | CSS-CONNECT, CSS-SHELL-DEV, CSS-OTHER, CSS-SCREEN, CORNERS, CSS-SHELL-K98 |
| Brand purple (secondary CTA, sliders track, active system) | `#6a2eee` (`--lighting-primary`, `--custom-key-primary`, `--macro-primary`, `--other-primary`, `--device-list-purple`) | same |
| Purple variants | `#3d1f7e` (active/hover list rows, active effect), `#4b249f` (selected chip/current device), `#8e69d5` (selected chip border), `#462195` (active profile in switcher), `#45258f` (profile row hover), `#260d5b` (active item chip), `#6b27ff` (apply-progress fill), `#7f55ff` (advanced tag text), `#631DFF` (corner art), `#5941ff1a→#5941ff33` (menu hover gradient), `#271251→#2F1561` (menu indicator), `#4F20B5→#722EDF` (profile switcher hover), `#462377/#2F194D/#241638` (card media gradient) | CSS-* |
| Ink / surfaces | page `#0a0a0a` (body), `#04060f` (deep bg, masks), `#070a14` (hover text on green, key chip bg), `#0e1524` (dialogs, toasts, popups, inputs), `#0e0e14` (keycap), `#090c17`/`#080b16` (candidate tiles), `#11131d` (drag ghost), `#15182cb3` (sidebar/config cards), `rgba(21,24,44,.7)` (panels), `#1d2129` (tooltips), `#202036` (key picker), `#0b0e1f` (macro editor), `#0c1525` (device switcher), `#27375733` (lighting tab bar), `#2f3036` (advanced hover mark), `#494f68` (progress track), `#626476` (slider rail), `#494949`/`#e9e9e9` (switch off track/thumb), `#55576a` ("Applying" pill inner) | CSS-* |
| Text | primary `#fff`/`rgba(255,255,255,.9)`; body `#ffffffe6`; strong `#ffffffeb`/`#fffffff5`; muted `rgba(255,255,255,.6)` `#fff9`; disabled `rgba(255,255,255,.3)`; placeholder `#ffffff6b` | CSS-APP `:root`, CSS-* |
| Lines / fills | `rgba(255,255,255,.12)` (`--*-line`, borders), `.08` (`--other-surface`), `.05` (`--lighting-surface`), `#ffffff0d` (list rows), `#ffffff14`/`#ffffff1f` (ghost buttons, badges), `#ffffff4d` (active layer, overlays) | CSS-* |
| Status | charging `#00e031`; low battery `#f33`; danger/tags `#ff2441` (+ `#ff6d80`, `#ff4661`, `#ff6b7d`, `#ff9aa6`, `#ff9aaa`, `#ff8080`); recording `#f66`; dongle toast red on `#fff0f0`/`#ffd2d2`, close `#ff3d40`; toast icons success `#00b42a`, error `#f53f3f`, warning `#ff7d00`, info `#165dff` | CSS-PAGE, CSS-TOAST, CSS-SHELL-DEV |
| Keyboard legacy vars | `--keyboard-color:#fff`, `--keyboard-border:#707070`, `--keyboard-container:rgba(255,255,255,.5)`, dots `#d22d46 #ac1eb1 #ff4500 #ffa500`, `--content-key-bg-color:rgba(255,255,255,.9)`, `--content-key-bg-border:#3b3939`, `--macro-*` legacy | CSS-APP `:root` |
| Scrollbar | thumb `#6a2eeebd` (hover `#6a2eee`), 5 px wide; `--app-scrollbar-thumb` purple→red gradient for TDesign layout content | CSS-APP, CSS-PAGE |

### 9.2 Typography

- Family: `"Source Han Sans CN", sans-serif` everywhere (37 rules), `"Source Han Sans CN", PingFang SC, "Microsoft YaHei", sans-serif` on connect/sidebar (CSS-APP body, CSS-CONNECT). No web-font is loaded for it (only `iconfont`), so it depends on the OS font; UNVERIFIED whether the shell/Electron bundle ships it.
- Icon font: `iconfont` from `/k98pro-app/woff2/iconfont--pT25bIF.woff2` / `woff/iconfont.woff` (CSS-APP `@font-face`); glyph classes `icon-*` listed in §11.
- Scale: 32/40 px page titles (devices list), 24/32 card names, 20 device name / section h2 (Other), 18/26–27 panel titles (700), 16/24 row titles (500), 14/22 body & buttons, 13 menu tooltip, 12/18–20 helper text, 11 tags, 10/9/8 badges; key cap labels 12 px, advanced chip 20 px bold.
- Body: `-webkit-font-smoothing:antialiased`, `user-select:none` globally (CSS-APP).

### 9.3 Shape, spacing, motion

| Aspect | Value |
|---|---|
| Corner treatment | almost everything is `border-radius:2px` (dialogs, rows, panels, tags); keycaps 3 px; candidate tiles/key boxes 4 px; the display preview 16 px; **chamfered** (cut-corner) `clip-path: polygon(6px 0, 100% 0, 100% 22px, calc(100% - 6px) 100%, 0 100%, 0 6px)` on 28 px buttons, tabs, segmented controls, switches (5 px cuts), "Applying" pill, badge shapes; decorative `PanelCorners` overlays (§5) and SVG frames with the same 45° notch on big buttons (187×48, 247×56) |
| Buttons | primary 88×28 green/`#6a2eee` text weight 500; secondary purple/white; ghost `#ffffff1f`; big CTAs 187×48 (18 px bold) and 247×56 (22 px bold) with gradient SVG backgrounds; hover: `filter:brightness(.92)` (green) / `1.08` (purple); disabled opacity .45–.55 |
| Switch | 48×24 chamfered, thumb 16 px travels 24 px (SVG version) |
| Segmented | 28 px high, indicator = accent green, active text purple weight 600 |
| Slider | 36 px control, 28 px rail, hexagonal 16×32 thumb (white with green inset) |
| Panel geometry | sidebar 238/64 px; panel width ≤1642 px, height 420 px; column padding 20–24 px; list gaps 12–16 px; page-content top margin 15 px |
| Backgrounds | device page `k98pro-background` (avif/png) cover; host devices `web-bg.avif` cover fixed; cards `card-background(-dark).png`; panels translucent with `backdrop-filter: blur(5px|10px)` |
| Easing | `cubic-bezier(.22,1,.36,1)` for most 0.12–0.36 s transitions; GSAP `power3.out` 0.28 s for tab/segment indicators, 0.12/0.14 s menu indicator fade; macro editor slide 0.36/0.22 s; `prefers-reduced-motion` disables animations throughout |
| Breakpoints | 1680 / 1500 / 1440 (sidebar collapse) / 1180 px widths, 920 / 860 px heights (stage scaling); host page 850 / 560 px widths, 800 / 640 px heights |

---

## 10. Static assets and usage

`gshub/k98pro-app/`:

| Asset | Used for |
|---|---|
| `idx_root.html`, `idx_index.html.html`, `idx_device.html`, `idx_preload.html` | identical SPA shells (title "重力星球 HUB", favicon `miniLogo.svg`, module preloads, `Promise.withResolvers` polyfill) |
| `miniLogo.svg` | favicon |
| `png/k98pro-DKcD7Q8z.png` (2.4 MB) | sub-app connect hero keyboard art (CONNECT 12) |
| `png/k98pro-background-pKoZZ5am.png` + `avif/k98pro-background-DWMwsr0f.avif` | device page background (CSS-PAGE `.layout-container__content`) |
| `png/keyboard-baseplate-B4KhJwC6.png` | keyboard stage backplate 1085×380 (CSS-PAGE) |
| `png/web-bg-DtqR4FqR.png` | sub-app connect page background (CSS-CONNECT) |
| `png/control-lever-Ct3Bk1Zw.png` | decorative lever beside the display preview (SCREEN 13) |
| `png/figma-display-preset-{1,2,3,4}-*.png` | display preset thumbnails (SCREEN 597-614) |
| `gif/figma-display-preset-1-D10kuLZy.gif`, `gif/figma-display-preset-4-LOXWCh1c.gif` | animated previews / upload payload for presets id 1 and id 4; preset 4 GIF is prefetched after 4 s of idle on the device page (PAGE 2432-2465) |
| `webp/K98Pro2-DNHneAC3.webp` | device card image on the sub-app "Your Devices" list (CONNECT 62) |
| `svg/config-bg-Yirq0LD-.svg` | profile switcher row background; also `.layout-container__content-config` background (CSS-PAGE) |
| `svg/logo-text-COE5nmGy.svg` | GravaStar wordmark in sidebar/headers (HEADER 106) |
| `svg/test-panel-top-BWO2Vnua.svg`, `svg/test-panel-bottom-tLRFGtFU.svg` | masked decorative patterns in the advanced-key test area (ADV 20-22) |
| `svg/upload-icon-vx4BO1nm.svg` | marker on the display apply-progress bar (SCREEN 616) |
| `svg/light-mute-BZqrkNT2.svg`, `svg/lockwin-BVczEgNY.svg` | inline data-URI icons in MAIN (keycode icon map, e.g. `61961: "lockwin"` Win-lock key); the standalone files are not referenced by CSS (UNVERIFIED direct use) |
| `woff2/iconfont--pT25bIF.woff2`, `woff/iconfont.woff` | icon font |
| `css/*.css` | per-chunk styles mapped in Sources |

`gshub/assets/img/` (host shell): `web-bg-BHsPdP2Z.avif` (devices/connect page bg), `card-background-BpAI7P6L.png` & `card-background-dark-BiAK5zup.png` (device card media/info), `driver-update-notice-background-v1-1-CvDzORVd.png` (release-notes dialog), `add-device-bg-BoYyKqRF.svg` (add-card hover), `k98pro-jRxpVtca.avif` (generic connect image, SHELL-PICKER 7197), `keyboard-k98-pro-8oKNxIly.avif` (K98 Pro card image via model `imageKey` — UNVERIFIED mapping), other product images (`keyboard-k1*`, `keyboard-v60/v75`, `mouse-*`, `headset-mh1*`, `np-pro`, `p9`), `figma-firmware-*` (firmware hub), `logo-text-COE5nmGy.svg`, `bg-logo`, `new-tag-shine`, `iconfont-*`.

---

## 11. Iconfont glyph names (CSS-APP)

Navigation: `lighting, display-screen, custom-keys, advanced-keys, macros, profile-manager, more-settings, feedback, collapse, board-profile, board-profile1..3, profile-icon, help, tip, arrow, icon_arrow, icon_back, nextlink, close, add, delete, pen, copy, more, import, icon_upload, search, start, pause, stop, yuyan (language)`. Device: `wired, wireless, youxian1, mandian-charge, a-Property1* (battery states), shuomingshu (manual), gujianshengji (firmware)`. Advanced keys: `socd, end, mt, tgl`. Lighting effects: the 21 names in §5.1 plus `effect-color, effect-change, effect-prev, effect-direction, effect-luminance-add/reduce, effect-speed-add/reduce, side-effect-*` and `icon_dengxiao_*`. Media/control keys: `calculator, mail, computer, browser, music, play-pause, next, rewind, mute, voice-up, voice-down, light-up, light-down, icon_Folder(1), icon_mouse_left/4..9, mouse-left/right/middle/forward/back, lockwin, sepan, horizontal, jianmaoshanchutubiao/jianmaozengjiatubiao, Vector`.

---

## Open questions

1. `messages.useWiredConnection` (Screen menu tag), `macro.storageLimitReached`, `macro.storageUnavailable` exist only in `zh_CN`; because `fallbackLocale` is `zh_CN` (MAIN 7331) the English UI shows Chinese for them. Four `keyTip_*` entries in the English table are also still Chinese (I18N lines 214-217). Are these known gaps to fix in our own UI?
2. Macro delay inputs clamp to `ba = 1048575` ms (MAIN 315) while the legacy string says "Time cannot exceed 32768 ms" — which limit does the firmware actually enforce?
3. The layout root applies class `main-content-config` on config/other/screen pages but the CSS only defines `.layout-container__content-config` (config-bg.svg background). Is the alternate background intended?
4. Numeric values for the debounce-mode, layer-name, light-type (`Main/Side/Logo` = 1/2/3 order UNVERIFIED), macro loop-type (`UntilKeyDown`=2; `Count`/`UntilKeyUp` ∈ {1,4}) and effect-id enums are still behind unresolved string-table calls; they should be cross-checked against the protocol document before reuse.
5. The K98 Pro card image on the host page depends on a device-model table (`resolveDeviceModel`/`imageKey`) not fully readable in `electron-hid-picker`; confirm which of `keyboard-k98-pro-*.avif` / `k98pro-*.avif` is shown for PIDs 0x10E5/0x106C.
6. Is the sub-app's own `/hub` device list (CONNECT) ever reachable in production, or is it only the standalone/dev entry?
7. The "danger" confirm theme (factory reset) has no distinct CSS — is a red confirm button desired?
8. Latent performance/calibration, handle and tri-mode UIs exist in the bundle (see §5.8); should any be part of our design scope?
9. "Source Han Sans CN" is referenced but never loaded as a web font — what font stack should we ship?
