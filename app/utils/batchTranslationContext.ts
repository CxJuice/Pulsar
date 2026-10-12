import { sourceSimilarity } from './suggestionMatch.ts'
import type { StringItem } from '../types/editor'

export interface TranslationContextGroup {
  representative: StringItem
  items: StringItem[]
  variantTemplate?: string
}

export const SHARED_CONTEXT_SIMILARITY = 0.4
function normalize(source: string) { return source.toLowerCase().replace(/\s+/g, ' ').trim() }
function words(source: string) { return source.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [] }
const functionWords = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'to', 'for', 'and', 'or', 'with', 'is', 'are', 'this', 'that'])
function hasSharedContent(first: string, second: string) {
  const content = new Set(words(first).filter(word => /^\p{L}[\p{L}\p{N}_]{2,}$/u.test(word) && !functionWords.has(word)))
  const shared = [...new Set(words(second))].filter(word => content.has(word))
  return shared.length >= 2 && shared.join('').length >= 8
}
function variantTemplate(group: TranslationContextGroup): string | undefined {
  if (group.items.length < 2) return undefined
  const exemplar = words(normalize(group.representative.original))
  const members = group.items.map(item => words(normalize(item.original)))
  if (members.some(tokens => tokens.length > 128)) return undefined
  if (members.some(tokens => tokens.length !== exemplar.length)) {
    let prefix = 0, suffix = 0
    const minimum = members.reduce((result, tokens) => Math.min(result, tokens.length), Infinity)
    while (prefix < minimum && members.every(tokens => tokens[prefix] === exemplar[prefix])) prefix++
    while (suffix < minimum - prefix && members.every(tokens => tokens[tokens.length - suffix - 1] === exemplar[exemplar.length - suffix - 1])) suffix++
    const shared = [...exemplar.slice(0, prefix), ...(suffix ? exemplar.slice(-suffix) : [])]
    const maximum = members.reduce((result, tokens) => Math.max(result, tokens.length), 0)
    if (shared.length / maximum < 0.6 || !hasSharedContent(shared.join(' '), shared.join(' '))) return undefined
    return [...exemplar.slice(0, prefix), '[variant]', ...(suffix ? exemplar.slice(-suffix) : [])].join(' ')
  }
  let changed = false
  const template = exemplar.map((token, index) => {
    if (members.every(tokens => tokens[index] === token)) return token
    changed = true
    return '[variant]'
  })
  return changed ? template.join(' ') : undefined
}

function scope(item: StringItem) { return `${item.project}/${item.fileId || item.file?.id || 0}/` }
export function groupTranslationContexts(items: readonly StringItem[]): TranslationContextGroup[] {
  const groups: TranslationContextGroup[] = []
  const exact = new Map<string, TranslationContextGroup>()
  const scopedGroups = new Map<string, TranslationContextGroup[]>()
  for (const item of items) {
    const prefix = scope(item), source = item.original
    let group = exact.get(prefix + source)
    if (!group) {
      for (const candidate of scopedGroups.get(prefix) || []) {
        const comparison = candidate.representative.original, maximum = Math.max(comparison.length, source.length)
        // Length alone provides an exact upper bound, without changing the score.
        if (maximum && Math.min(comparison.length, source.length) / maximum <= SHARED_CONTEXT_SIMILARITY) continue
        // Use the very same complete-string algorithm as the suggestion badge.
        // Compare to a fixed exemplar to avoid chaining low-similarity endpoints.
        if (sourceSimilarity(source, comparison) > SHARED_CONTEXT_SIMILARITY) { group = candidate; break }
      }
    }
    if (!group) {
      group = { representative: item, items: [] }
      groups.push(group)
      const candidates = scopedGroups.get(prefix) || []
      candidates.push(group)
      scopedGroups.set(prefix, candidates)
    }
    group.items.push(item)
    exact.set(prefix + source, group)
  }
  for (const group of groups) group.variantTemplate = variantTemplate(group)
  return groups
}

// One immutable reference load per group, with no model warmup or global barrier.
// Each caller still sends and cancels its own translation independently.
export class BatchTranslationContextPool<T> {
  private groups = new Map<string, TranslationContextGroup>()
  private pending = new Map<TranslationContextGroup, Promise<T>>()
  private loadReference: (group: TranslationContextGroup) => Promise<T>
  constructor(items: readonly StringItem[], loadReference: (group: TranslationContextGroup) => Promise<T>) {
    this.loadReference = loadReference
    for (const group of groupTranslationContexts(items)) {
      for (const item of group.items) this.groups.set(`${scope(item)}${item.id}`, group)
    }
  }
  load(item: StringItem): Promise<T> {
    const group = this.groups.get(`${scope(item)}${item.id}`)
    if (!group) return Promise.reject(new Error('词条不属于当前批量翻译'))
    const existing = this.pending.get(group)
    if (existing) return existing
    const promise = Promise.resolve().then(() => this.loadReference(group))
    this.pending.set(group, promise)
    // A failed auxiliary request must not poison later entries in the group.
    void promise.catch(() => { if (this.pending.get(group) === promise) this.pending.delete(group) })
    return promise
  }
}
