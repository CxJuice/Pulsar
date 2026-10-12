import { sourceSimilarity } from './suggestionMatch.ts'
import { SHARED_CONTEXT_SIMILARITY } from './batchTranslationContext.ts'
import type { StringItem } from '../types/editor'

interface ReferenceEntry<T> { source: string; at: number; promise: Promise<T>; characters: number }

// Scoped references survive selection changes without accumulating chat history.
export class TranslationContextCache<T> {
  private entries = new Set<ReferenceEntry<T>>()
  private currentScope = ''
  private characters = 0
  private generation = 0
  private ttl: number
  private limit: number
  private maximumCharacters: number
  private now: () => number

  constructor({ ttl = 120_000, limit = 32, maximumCharacters = 1_000_000, now = Date.now } = {}) {
    this.ttl = ttl; this.limit = limit; this.maximumCharacters = maximumCharacters; this.now = now
  }
  clear() { this.generation++; this.entries.clear(); this.characters = 0 }
  private remove(entry: ReferenceEntry<T>) {
    if (this.entries.delete(entry)) this.characters -= entry.characters
  }
  load(scope: string, item: StringItem, fetch: (representative: StringItem) => Promise<T>): Promise<T> {
    if (scope !== this.currentScope) { this.clear(); this.currentScope = scope }
    const now = this.now()
    let match: ReferenceEntry<T> | undefined, best = SHARED_CONTEXT_SIMILARITY
    for (const entry of this.entries) {
      if (now - entry.at >= this.ttl) { this.remove(entry); continue }
      const maximum = Math.max(entry.source.length, item.original.length)
      if (maximum && Math.min(entry.source.length, item.original.length) / maximum <= best) continue
      const similarity = sourceSimilarity(entry.source, item.original)
      if (similarity > best) { match = entry; best = similarity }
      if (similarity === 1) break
    }
    if (match) { this.entries.delete(match); this.entries.add(match); return match.promise }
    const generation = this.generation, snapshot = { ...item }
    const entry: ReferenceEntry<T> = { source: snapshot.original, at: now, characters: snapshot.original.length, promise: undefined! }
    this.characters += entry.characters
    this.entries.add(entry)
    entry.promise = Promise.resolve().then(() => fetch(snapshot)).then(reference => {
      if (generation === this.generation && this.entries.has(entry)) {
        const characters = JSON.stringify(reference).length
        this.characters += characters; entry.characters += characters
        this.trim()
      }
      return reference
    }).catch(reason => { if (generation === this.generation) this.remove(entry); throw reason })
    this.trim()
    return entry.promise
  }
  private trim() {
    while (this.entries.size > this.limit || this.characters > this.maximumCharacters) {
      const oldest = this.entries.values().next().value
      if (!oldest) break
      this.remove(oldest)
    }
  }
}
