// Share completed results and in-flight requests between selection and prefetch.
export class EntryAuxCache<T> {
  private entries = new Map<string, { at: number; value: T }>()
  private requests = new Map<string, Promise<T>>()

  constructor(private ttl = 120_000, private limit = 32) {}

  read(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return
    if (Date.now() - entry.at >= this.ttl) { this.entries.delete(key); return }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  load(key: string, fetch: () => Promise<T>): Promise<T> {
    const cached = this.read(key)
    if (cached !== undefined) return Promise.resolve(cached)
    const pending = this.requests.get(key)
    if (pending) return pending
    const request: Promise<T> = Promise.resolve().then(fetch).then(value => {
      // Clearing or replacing a request must also invalidate its eventual result.
      if (this.requests.get(key) === request) {
        this.entries.delete(key)
        this.entries.set(key, { at: Date.now(), value })
        while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
      }
      return value
    }).finally(() => { if (this.requests.get(key) === request) this.requests.delete(key) })
    this.requests.set(key, request)
    return request
  }

  clear() { this.entries.clear(); this.requests.clear() }
}
