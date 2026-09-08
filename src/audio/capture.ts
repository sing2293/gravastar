import type { AudioSourceInfo, AudioSourceKind } from './types'

export interface CapturedAudio {
  stream: MediaStream
  kind: AudioSourceKind
  label: string
  stop(): void
}

/**
 * What this browser can capture. System audio via `getDisplayMedia` needs Chrome ≥ 141 on macOS ≥ 14.2 (Windows and
 * ChromeOS have had it longer); the picker only offers it when the OS supports it, so we can only advise here.
 */
export function audioSources(): AudioSourceInfo[] {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  const display = !!md?.getDisplayMedia
  const mic = !!md?.getUserMedia
  const isMac = /Mac OS X/.test(navigator.userAgent)
  return [
    {
      kind: 'system',
      label: 'What this computer is playing (speakers, headphones or Bluetooth — any app)',
      available: display,
      hint: isMac
        ? 'Chrome opens a share dialog: pick “Entire Screen”, tick “Also share system audio”, press Share. Only the sound is used; the picture is discarded at once. Needs Chrome 141+ on macOS 14.2+ and Screen & System Audio Recording permission for Chrome.'
        : 'Chrome opens a share dialog: pick the screen, tick “Also share system audio”, press Share. Only the sound is used; the picture is discarded at once.',
    },
    { kind: 'tab', label: 'One browser tab (Spotify web, YouTube…)', available: display, hint: 'Pick the tab that is playing and tick “Share tab audio”.' },
    { kind: 'microphone', label: 'An input device', available: mic, hint: 'The microphone hears the room; a loopback device (BlackHole, Loopback, VB-Cable, “Stereo Mix”) hears the output directly.' },
  ]
}

/**
 * Audio input devices (microphones and virtual loopback devices such as BlackHole / Loopback / VB-Cable / "Stereo
 * Mix"). Labels are only revealed once the page has had microphone permission.
 */
export async function audioInputDevices(): Promise<{ deviceId: string; label: string }[]> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!md?.enumerateDevices) return []
  const devices = await md.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }))
}

export async function captureAudio(kind: AudioSourceKind, deviceId?: string): Promise<CapturedAudio> {
  const md = navigator.mediaDevices
  if (!md) throw new Error('Media capture is not available in this browser')
  const noProcessing = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  let stream: MediaStream
  if (kind === 'microphone') {
    stream = await md.getUserMedia({ audio: deviceId ? { ...noProcessing, deviceId: { exact: deviceId } } : noProcessing })
  } else {
    // The spec requires video for getDisplayMedia; we drop the video track immediately. `displaySurface` opens the
    // picker on the right pane ("Entire Screen" carries the system audio, a tab carries its own).
    const constraints = {
      video: { frameRate: 1, width: 16, height: 16, displaySurface: kind === 'system' ? 'monitor' : 'browser' },
      audio: { ...noProcessing, suppressLocalAudioPlayback: false },
      systemAudio: 'include',
      selfBrowserSurface: kind === 'tab' ? 'include' : 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: kind === 'system' ? 'include' : 'exclude',
      preferCurrentTab: false,
    } as DisplayMediaStreamOptions & Record<string, unknown>
    stream = await md.getDisplayMedia(constraints)
    for (const t of stream.getVideoTracks()) {
      t.stop()
      stream.removeTrack(t)
    }
  }
  const audio = stream.getAudioTracks()[0]
  if (!audio) {
    for (const t of stream.getTracks()) t.stop()
    throw new Error(kind === 'microphone' ? 'No microphone available' : 'No audio was shared — tick “Share system audio” / “Share tab audio” in the dialog')
  }
  return {
    stream,
    kind,
    label: audio.label || kind,
    stop() {
      for (const t of stream.getTracks()) t.stop()
    },
  }
}
