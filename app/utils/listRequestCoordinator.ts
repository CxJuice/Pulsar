// Owns cancellation for one editor's paginated list requests. A canceled
// request may still settle; the caller's sequence check decides whether to use it.
export class ListRequestCoordinator {
  private active = new Set<string>()
  private cancel: (id: string) => void
  private nextId: () => string

  constructor(cancel: (id: string) => void, nextId = () => crypto.randomUUID()) {
    this.cancel = cancel
    this.nextId = nextId
  }

  async run<T>(send: (id: string) => Promise<T>): Promise<T> {
    const id = this.nextId()
    this.active.add(id)
    try { return await send(id) }
    finally { this.active.delete(id) }
  }

  cancelAll() {
    for (const id of this.active) this.cancel(id)
    this.active.clear()
  }
}
