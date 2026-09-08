# GravaStar Hub

An open web configurator for the **GravaStar K98 Pro** keyboard and the **GravaStar Mercury** (Compx-based) mice — one
app instead of two vendor tools, plus **music sync**: the keyboard's per-key RGB follows whatever is playing on your
computer.

It runs entirely in the browser over [WebHID](https://developer.mozilla.org/docs/Web/API/WebHID_API): nothing is
installed, no data leaves your machine. Chrome, Edge and Arc work; Safari and Firefox have no WebHID.

## Features

| Keyboard (K98 Pro, USB or 2.4 GHz) | Mouse (Mercury M1 Pro / M2 / X / X Pro) |
|---|---|
| Key remapping on 3 layers × Windows/macOS tables, full key catalog (media, mouse, lighting, layers, shortcuts…) | DPI stages (count, values, colours), active stage |
| Lighting: 20 main effects, side/logo zones, brightness/speed/colour, per-key custom colours | Report rate up to what the link allows (125 Hz – 8 kHz) |
| **Music sync** from system audio, a browser tab, or the microphone — four presets | Sensor: lift-off distance, motion sync, ripple control, angle snapping, performance mode, angle tune |
| Hall-effect performance: actuation point, rapid trigger, dead zones, live travel view, switch calibration | Buttons: mouse functions, DPI switch/lock, fire key, keyboard shortcuts, media keys, macros |
| Advanced keys: SOCD, dual-action (MT), toggle (TGL), release trigger (END), DKS, multi-point (MPT), rapid snap (RS) | Light bar modes, colour, brightness, speed; sleep timer; onboard profiles |
| Macros with recording, storage meter, key binding | Receiver pairing, long-range mode; settings export/import compatible with the vendor `.bin` |
| LCD display: upload GIF/PNG/JPG (re-encoded to the panel), clock sync | Factory reset |
| Settings: OS layout, polling rate, sleep, debounce, Win-lock, resets; onboard profiles | |

Open the app with `?sim=1` to get a simulated keyboard and mouse and try every panel without hardware.

## Development

Requires Node ≥ 22.12 (the repo was built with Node 24, Vite 8, TypeScript 7).

```sh
npm install
npm run dev        # http://localhost:5173  (add ?sim=1 for simulated devices)
npm test           # vitest — codecs, drivers over simulated firmware, audio analysis, GIF encoder
npm run typecheck
npm run build      # dist/
```

Deploying: any static host works. `vercel.json` is included (framework **Vite**, output `dist`). WebHID needs a secure
context, which HTTPS hosting provides.

### Layout

```
src/hid/core       WebHID transport, request queue, device matching
src/drivers/k98pro K98 Pro protocol: codec, dongle framing, config, keymap, lighting, macros, performance, advanced keys, display
src/drivers/compx  Compx mouse protocol: frames, EEPROM records, link, driver
src/model          device-agnostic contracts the UI renders from
src/sim            simulated firmware for both devices (tests + ?sim=1)
src/audio          audio capture, analysis, music presets, sync engine
src/display        GIF encoder / image preparation for the LCD
src/ui, src/store  React UI and the device store
docs/              ARCHITECTURE.md and the reverse-engineering notes the drivers are built from
tools/re           scripts used to recover the vendor protocols
```

## How it was built

The vendor web tools were read, not their firmware: the K98 Pro tool's obfuscated protocol library was deobfuscated
and the mouse tool's published source maps were used. Every command, byte layout and enum is documented with line
citations in [docs/reverse-engineering](docs/reverse-engineering/), and the drivers' unit tests use the worked byte
examples from those documents. Anything the code did not settle is marked *UNVERIFIED* there and *experimental* in
the app.

## Status and safety

- Validated so far against simulated firmware only; the K98 Pro over USB is the first hardware target, then the 2.4 GHz
  receiver, then the mice. Panels that touch unverified areas say so.
- Every write goes to the device's onboard memory exactly as the vendor tool would send it. Keep a settings export
  before experimenting with the mouse, and use *Factory reset* if a keyboard setting misbehaves.
- Firmware flashing is intentionally not exposed.

This project is not affiliated with GravaStar or Compx.
