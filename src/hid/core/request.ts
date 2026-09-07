/** Concurrency and timing primitives for talking to a device: one request at a time, with timeouts and retries. */

export class TimeoutError extends Error {
  override readonly name = 'TimeoutError'
  constructor(label: string, readonly ms: number) {
    super(`${label} timed out after ${ms} ms`)
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Rejects with `TimeoutError` if `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export interface RetryOptions {
  /** Total attempts including the first one. */
  attempts: number
  /** Delay between attempts; a function receives the 1-based attempt that just failed. */
  delayMs?: number | ((failedAttempt: number) => number)
  /** Return false to stop retrying for this error. */
  shouldRetry?: (error: unknown, failedAttempt: number) => boolean
}

export async function retry<T>(task: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = Math.max(1, options.attempts)
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await task(attempt)
    } catch (error) {
      lastError = error
      if (attempt === attempts || (options.shouldRetry && !options.shouldRetry(error, attempt))) break
      const delay = typeof options.delayMs === 'function' ? options.delayMs(attempt) : (options.delayMs ?? 0)
      if (delay > 0) await sleep(delay)
    }
  }
  throw lastError
}

/**
 * Runs tasks strictly one after another. Every device gets one queue so that a request and the wait for its
 * response can never interleave with another request's bytes.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private pending = 0

  get size(): number {
    return this.pending
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.pending++
    const result = this.tail.then(task, task)
    this.tail = result.catch(() => undefined).finally(() => {
      this.pending--
    })
    return result
  }
}

/** A promise plus its resolvers, for request/response matching. */
export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
