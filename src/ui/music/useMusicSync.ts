/**
 * React glue for the app's single `musicEngine`: status subscription, engine options, the per-session UI state
 * every music view shares (chosen source, start errors) and an animation-frame ticker for live meters.
 * Nothing here owns the session — a panel unmounting never stops a running sync.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { musicEngine, type MusicSyncOptions } from '@/audio/musicSync'
import type { AudioSourceKind, MusicSyncStatus } from '@/audio/types'

const subscribe = (onChange: () => void) => musicEngine.onStatus(onChange)
const statusSnapshot = () => musicEngine.getStatus()
const runningSnapshot = () => musicEngine.getStatus().running

/** Engine status; re-renders on every publish (≈ once a second while running, plus sink and lifecycle changes). */
export function useMusicStatus(): MusicSyncStatus {
  return useSyncExternalStore(subscribe, statusSnapshot)
}

/** Only the running flag, so shell chrome (the sidebar) is not re-rendered by fps updates. */
export function useMusicRunning(): boolean {
  return useSyncExternalStore(subscribe, runningSnapshot)
}

/** Engine options mirrored into React state; `update` writes through to the engine. */
export function useEngineOptions(): [MusicSyncOptions, (patch: Partial<MusicSyncOptions>) => void] {
  const [options, setOptions] = useState(musicEngine.options)
  const update = useCallback((patch: Partial<MusicSyncOptions>) => {
    musicEngine.update(patch)
    setOptions(musicEngine.options)
  }, [])
  return [options, update]
}

interface MusicUiState {
  source: AudioSourceKind
  starting: boolean
  /** `performance.now()` when the current session started; gives previews a session time close to the engine's. */
  startedAt: number
  /** Opening the source failed (share dialog dismissed, no audio shared); the engine only reports sink errors. */
  startError?: string
  setSource(kind: AudioSourceKind): void
  start(): Promise<void>
  stop(): Promise<void>
}

/** Session UI state lives outside components so it survives navigating between the global page and device tabs. */
export const useMusicUi = create<MusicUiState>((set, get) => ({
  source: 'system',
  starting: false,
  startedAt: 0,
  setSource: (source) => set({ source }),
  async start() {
    if (get().starting) return
    set({ starting: true, startError: undefined })
    try {
      await musicEngine.start(get().source)
      set({ startedAt: performance.now() })
    } catch (error) {
      set({ startError: (error as Error).message })
    } finally {
      set({ starting: false })
    }
  },
  stop: () => musicEngine.stop(),
}))

/** Seconds since the session started — the engine's `MusicFrame.t`, to within the sink preparation time. */
export function sessionTime(): number {
  return (performance.now() - useMusicUi.getState().startedAt) / 1000
}

/** Bumps a counter on every animation frame while `active`, so live meters redraw and idle pages stay idle. */
export function useFrameTicker(active: boolean): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    let handle = 0
    const loop = () => {
      setN((v) => (v + 1) % 1e9)
      handle = requestAnimationFrame(loop)
    }
    handle = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(handle)
  }, [active])
  return n
}
