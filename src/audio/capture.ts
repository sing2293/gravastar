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
    { kind: 'system', label: 'System audio (everything playing on this computer)', available: display, hint: isMac ? 'In the share dialog choose “Entire Screen” and tick “Share system audio” (Chrome 141+, macOS 14.2+).' : 'In the share dialog choose the screen and tick “Share system audio”.' },
    { kind: 'tab', label: 'A browser tab (Spotify, YouTube…)', available: display, hint: 'Pick the tab that is playing and tick “Share tab audio”.' },
    { kind: 'microphone', label: 'Microphone', available: mic, hint: 'Reacts to the room — works everywhere, less precise.' },
  ]
}

export async function captureAudio(kind: AudioSourceKind): Promise<CapturedAudio> {
  const md = navigator.mediaDevices
  if (!md) throw new Error('Media capture is not available in this browser')
  const noProcessing = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  let stream: MediaStream
  if (kind === 'microphone') {
    stream = await md.getUserMedia({ audio: noProcessing })
  } else {
    // The spec requires video for getDisplayMedia; we drop the video track immediately.
    const constraints = {
      video: { frameRate: 1, width: 16, height: 16 },
      audio: { ...noProcessing, suppressLocalAudioPlayback: false },
      systemAudio: 'include',
      selfBrowserSurface: kind === 'tab' ? 'include' : 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: kind === 'system' ? 'include' : 'exclude',
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
