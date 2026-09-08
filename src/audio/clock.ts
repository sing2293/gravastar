/**
 * Tick sources for the analysis loop.
 *
 * `requestAnimationFrame` stops entirely while a tab is hidden and page timers are throttled to about once a second,
 * so a sync driven by either dies the moment the user switches to Spotify or a game. A running audio graph is the one
 * clock the browser keeps at full rate in the background: a ScriptProcessorNode's `audioprocess` events are
 * dispatched from the audio thread regardless of visibility (and a tab that is capturing audio is exempt from being
 * frozen or discarded). `audioClock` is the default; `frameClock` is the fallback for engines without Web Audio.
 */
export interface TickSource {
  readonly kind: 'audio' | 'frame'
  start(cb: () => void): void
  stop(): void
}

const clampPow2 = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, 2 ** Math.round(Math.log2(Math.max(1, n)))))

/** Ticks from the audio thread, every `bufferSize / sampleRate` seconds (1024 samples @ 48 kHz ≈ 21 ms ≈ 47 Hz). */
export function audioClock(ctx: AudioContext, input?: AudioNode, targetMs = 20): TickSource {
  let node: ScriptProcessorNode | undefined
  let mute: GainNode | undefined
  return {
    kind: 'audio',
    start(cb) {
      const size = clampPow2((targetMs / 1000) * ctx.sampleRate, 256, 16384)
      node = ctx.createScriptProcessor(size, 1, 1)
      node.onaudioprocess = () => cb()
      // The node only runs while it reaches the destination; a muted gain keeps the captured audio off the speakers.
      mute = ctx.createGain()
      mute.gain.value = 0
      input?.connect(node)
      node.connect(mute)
      mute.connect(ctx.destination)
    },
    stop() {
      if (!node) return
      node.onaudioprocess = null
      try {
        input?.disconnect(node)
      } catch {
        /* already gone */
      }
      node.disconnect()
      mute?.disconnect()
      node = undefined
      mute = undefined
    },
  }
}

export const supportsAudioClock = (ctx: AudioContext): boolean => typeof ctx.createScriptProcessor === 'function'

/** Animation frames while visible, a (throttled) interval while hidden — the best a page can do without audio. */
export function frameClock(targetMs = 20): TickSource {
  let raf = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let tick: (() => void) | undefined
  const loop = () => {
    tick?.()
    raf = requestAnimationFrame(loop)
  }
  const onVisibility = () => {
    cancelAnimationFrame(raf)
    if (timer) clearInterval(timer)
    timer = undefined
    if (!tick) return
    if (document.hidden) timer = setInterval(tick, targetMs)
    else raf = requestAnimationFrame(loop)
  }
  return {
    kind: 'frame',
    start(cb) {
      tick = cb
      document.addEventListener('visibilitychange', onVisibility)
      onVisibility()
    },
    stop() {
      tick = undefined
      document.removeEventListener('visibilitychange', onVisibility)
      onVisibility()
    },
  }
}
