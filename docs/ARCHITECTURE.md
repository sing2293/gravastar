# GravaStar Hub — architecture

One web app (Chrome / Edge / Arc, WebHID) that configures the GravaStar **K98 Pro** keyboard and the Compx-based
GravaStar **mice** (Mercury M1 Pro / M2 / X / X Pro), replacing the two vendor tools documented in
[reverse-engineering/](reverse-engineering/README.md). It adds one feature neither vendor tool has on the keyboard:
**music sync** — lighting driven by whatever is playing on the computer.

Stack: React 19 + TypeScript 7 + Vite 8, Zustand for state, Vitest for tests. No UI kit; a small design-token CSS
layer (see *Design* below). Everything device-related is framework-free TypeScript so it is unit-testable without a
browser or hardware.

## Layers

```
src/
  hid/core/          WebHID primitives (no product knowledge)
  drivers/k98pro/    K98 Pro protocol → implements KeyboardDevice capabilities
  drivers/compx/     Compx mouse protocol → implements MouseDevice capabilities
  model/             device-agnostic types the UI renders from (capabilities, profiles, keymaps, lighting…)
  audio/             capture + analysis for music sync (source-agnostic; emits LightingFrame)
  sim/               fake transports/devices so the whole UI runs with no hardware
  store/             Zustand stores (devices, active device, per-panel drafts, settings)
  ui/                pages, panels, components, theme
```

### `hid/core` — WebHID primitives
- `HidTransport`: wraps one `HIDDevice`: `open/close`, `send(reportId, bytes)`, an `inputReports` async stream, and a
  **per-device serialized request queue** with timeouts and retries. Nothing above this layer touches `HIDDevice`.
- `matchers.ts`: VID/PID/usagePage/usage filters and collection/report-id discovery (both vendors pick the interface
  by usage page and read the report ID off the output-report collection).
- `registry.ts`: known products → `{ displayName, kind, image, connection: 'wired'|'wireless', createDriver() }`.
  The K98 Pro registers two PIDs (wired `0x10E5`, 2.4G dongle `0x106C`); connection type is decided by PID, not by
  asking the user.

### `drivers/*` — one folder per protocol family
Rules that apply to every driver:
1. **Pure packet functions.** `encodeX(args): Uint8Array` / `decodeX(bytes): T` are pure and unit-tested against the
   worked byte examples in the protocol docs. No I/O inside codecs.
2. **Services** compose packets with the transport (`config`, `keymap`, `performance`, `advancedKeys`, `lighting`,
   `macros`, `display`, `profiles`, `reset` for the keyboard; `dpi`, `reportRate`, `sensor`, `keys`, `macros`,
   `lighting`, `oled`, `power`, `profiles`, `firmware` for the mouse). Each service takes a transport interface, so
   it runs unchanged against `sim/`.
3. **Both keyboard link types are first-class.** Wired and 2.4G share codecs; the K98 Pro's framed transport
   (`0x66` header, sync flags, ACK/retry) sits *between* codec and HID and is enabled by connection type. Anything
   only exercised over the dongle is tagged `// UNVERIFIED(wireless)` until validated on hardware and surfaced to
   the user as *experimental*.
4. **Capabilities, not device classes, drive the UI.** A driver returns a `Capabilities` object (which panels exist,
   ranges, enums, counts — e.g. profile slots, macro storage, lighting effects, DPI levels). The UI never branches
   on product names.
5. Device-initiated events (key-travel monitor, calibration progress, battery, dongle connect/disconnect, mouse
   status bitmasks) are exposed as typed event streams.

### `model/` — what the UI edits
Device-agnostic, serializable state: `Profile`, `Keymap` (layers × keys → `KeyAction`), `AdvancedKey` variants
(DKS/MT/TGL/SOCD/END/MPT/RS), `Performance` (per-key actuation/reset/rapid-trigger), `Lighting` (effect, color,
brightness, speed, per-key colors), `Macro`, `DisplayImage`, `MouseDpi`, `MouseSensor`, `MouseKeys`. Import/export
is JSON of these types; vendor profile files are converted at the edge.

### `audio/` — music sync
- `sources.ts`: three capture sources, tried in this order of preference and always user-selectable:
  1. **System audio** — `getDisplayMedia({ audio: true, video: true })` with the video track stopped immediately.
     Chrome ≥ 141 on macOS ≥ 14.2 exposes a "share system audio" option; Windows/ChromeOS have had it longer.
  2. **Browser tab** — same API, user picks the tab playing music (YouTube, Spotify web…).
  3. **Microphone** — `getUserMedia({ audio })`, what the Compx tool's "recorder music" mode uses.
- `analyzer.ts`: `AnalyserNode` FFT → normalized bands (bass/mid/treble + N columns), RMS energy, and a simple
  onset/beat detector with adaptive threshold. Runs on `requestAnimationFrame`.
- `musicSync.ts`: maps analysis frames to `LightingFrame`s through presets (spectrum-across-columns, bass pulse,
  VU meter, color cycle on beat) and **rate-limits device writes** (≤ 30 Hz keyboard per-key RGB; mouse color
  updates ≤ 20 Hz), coalescing frames when the queue is busy. The device is put in its "custom/static" mode first
  and restored afterwards.

### `sim/`
`SimK98Pro` and `SimCompxMouse` implement the transport interface with in-memory state and reply like the real
firmware (as documented). `?sim=1` in the URL lists them as devices so every panel is usable and testable without
hardware; drivers' integration tests run against them.

## Design
Dark, instrument-like, matching the keyboard's look: background `#070a14` / surfaces `#0e1524`, text `#ffffff` at
100/60/30 %, accent lime `#9bff31`, secondary purple `#6a2eee`, danger `#ff2441`, keyboard key face `#2e2f32`
with `#3b3939` border. Tokens live in `src/ui/theme.css`; light mode is not a goal. Layout: left device sidebar,
top tab bar per device, keyboard/mouse stage on the left of each panel, controls on the right.

## Validation order (hardware we have: K98 Pro, wired)
1. `hid/core` + keyboard `config` service: read firmware version, battery, polling rate — proves framing + CRC.
2. `keymap` read/write of a single key, then `lighting` effect/brightness, then per-key RGB (needed for music sync).
3. `performance` / `advancedKeys` / `macros` / `display` / `profiles`.
4. Plug in the dongle → repeat 1–3 over 2.4G (framed transport).
5. Mouse driver: sim-only until a Compx mouse is available.

## Non-goals (for now)
Firmware flashing UI (documented, not exposed), the vendor cloud features (phone login, profile codes), Electron
packaging, light theme.
