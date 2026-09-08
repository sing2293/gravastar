import type { EventSource, Unsubscribe } from '@/model/device'

/** Minimal typed event emitter; listener errors are isolated so one bad subscriber cannot break a device stream. */
export class Emitter<Events extends Record<string, unknown>> implements EventSource<Events> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>()

  on<K extends keyof Events & string>(event: K, listener: (payload: Events[K]) => void): Unsubscribe {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(listener as (payload: never) => void)
    return () => {
      set!.delete(listener as (payload: never) => void)
    }
  }

  emit<K extends keyof Events & string>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of [...set]) {
      try {
        ;(listener as (payload: Events[K]) => void)(payload)
      } catch (error) {
        console.error(`listener for "${event}" failed`, error)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
