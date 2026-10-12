export const MAX_PREFILL_CONCURRENCY = 16

export function normalizePrefillConcurrency(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count >= 1 ? Math.min(MAX_PREFILL_CONCURRENCY, Math.floor(count)) : 1
}

export async function runConcurrentPrefill<T>(items: readonly T[], concurrency: number,
  process: (item: T) => Promise<void>, shouldStop: () => boolean): Promise<void> {
  let next = 0
  const worker = async () => {
    while (!shouldStop()) {
      const index = next++
      if (index >= items.length) return
      await process(items[index]!)
    }
  }
  const workers = Array.from({ length: Math.min(normalizePrefillConcurrency(concurrency), items.length) }, worker)
  const results = await Promise.allSettled(workers)
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}

// Cancellation also settles requests still preparing their translation context.
// Their eventual context response cannot start a canceled translation.
export class BatchTranslationRequests {
  private active = new Map<string, () => void>()
  private cancel: (id: string) => void
  private nextId: () => string

  constructor(cancel: (id: string) => void, nextId = () => crypto.randomUUID()) {
    this.cancel = cancel
    this.nextId = nextId
  }

  get size() { return this.active.size }

  async run<T>(send: (id: string, isCurrent: () => boolean) => Promise<T>): Promise<T> {
    const id = this.nextId()
    let rejectCancellation!: (reason: Error) => void
    const canceled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject })
    const cancel = () => { rejectCancellation(new Error('翻译已停止。')); this.cancel(id) }
    const isCurrent = () => this.active.get(id) === cancel
    this.active.set(id, cancel)
    const pending = Promise.resolve().then(() => {
      if (!isCurrent()) throw new Error('翻译已停止。')
      return send(id, isCurrent)
    })
    try { return await Promise.race([pending, canceled]) }
    finally { if (isCurrent()) this.active.delete(id) }
  }

  cancelAll() {
    const requests = [...this.active.values()]
    this.active.clear()
    for (const cancel of requests) cancel()
  }
}
