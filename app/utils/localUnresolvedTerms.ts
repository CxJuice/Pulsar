import type { CommunityTranslationCandidate, LocalUnresolvedTerm, Term } from '~/types/editor'
import { highlightTerms } from '~/utils/termHighlights'
import { toEditorText } from '~/utils/translationText'

function storageKey(projectId: number | string) {
  return `sckit-local-unresolved-terms:${String(projectId)}`
}

function isCandidate(value: unknown): value is CommunityTranslationCandidate {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<CommunityTranslationCandidate>
  return Number.isInteger(entry.id) && typeof entry.source === 'string' && !!entry.source.trim()
    && typeof entry.category === 'string' && Array.isArray(entry.candidates) && entry.candidates.every(item => typeof item === 'string')
    && typeof entry.topicTitle === 'string' && typeof entry.topicUrl === 'string'
    && (entry.sourceType === '征集' || entry.sourceType === '投票' || entry.sourceType === '归档')
}

export function mergeCommunityTranslationCandidate(previous: CommunityTranslationCandidate | undefined, entry: CommunityTranslationCandidate): CommunityTranslationCandidate {
  if (!previous) return entry
  const previousArchived = previous.sourceType === '归档', entryArchived = entry.sourceType === '归档'
  const archived = previousArchived || entryArchived
  const previousTime = Date.parse(previous.updatedAt || ''), entryTime = Date.parse(entry.updatedAt || '')
  const preferred = previousArchived && !entryArchived
    ? previous
    : entryArchived && !previousArchived
      ? entry
      : previousArchived && entryArchived && Number.isFinite(previousTime) && (!Number.isFinite(entryTime) || previousTime > entryTime)
        ? previous
        : entry
  const candidates = archived
    ? [...new Set(preferred.candidates)]
    : [...new Set([...previous.candidates, ...entry.candidates])]
  return { ...previous, ...entry, ...preferred, candidates }
}

export function readLocalUnresolvedTerms(projectId: number | string): LocalUnresolvedTerm[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(projectId)) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is LocalUnresolvedTerm => isCandidate(entry)
      && typeof (entry as Partial<LocalUnresolvedTerm>).syncedAt === 'string')
  } catch {
    return []
  }
}

export function mergeLocalUnresolvedTerms(projectId: number | string, incoming: CommunityTranslationCandidate[]): LocalUnresolvedTerm[] {
  const current = readLocalUnresolvedTerms(projectId)
  const bySource = new Map(current.map(entry => [entry.source.trim().toLocaleLowerCase(), entry]))
  const downloaded = new Map<string, CommunityTranslationCandidate>()
  for (const entry of incoming) {
    if (!isCandidate(entry)) continue
    const key = entry.source.trim().toLocaleLowerCase()
    downloaded.set(key, mergeCommunityTranslationCandidate(downloaded.get(key), entry))
  }
  const now = new Date().toISOString()
  for (const entry of downloaded.values()) {
    const key = entry.source.trim().toLocaleLowerCase()
    const previous = bySource.get(key)
    bySource.set(key, { ...mergeCommunityTranslationCandidate(previous, entry), syncedAt: now })
  }
  const merged = [...bySource.values()].sort((first, second) => first.source.localeCompare(second.source))
  localStorage.setItem(storageKey(projectId), JSON.stringify(merged))
  return merged
}

export function matchLocalUnresolvedTerms(text: string, entries: LocalUnresolvedTerm[]): LocalUnresolvedTerm[] {
  if (!text || !entries.length) return []
  const terms: Term[] = entries.map((entry, index) => ({ id: index + 1, term: entry.source.trim(), translation: '', caseSensitive: false }))
  const matchedIds = new Set<number>()
  const collect = (plainText: string) => {
    for (const part of highlightTerms(toEditorText(plainText), terms)) {
      for (const term of part.terms || []) matchedIds.add(term.id)
    }
  }
  const protectedPattern = /<\/?[A-Za-z][^>]*>|~\w+\([^)]*\)|\\r\\n|\\n|\\r|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]/g
  let start = 0
  for (const match of text.matchAll(protectedPattern)) {
    if (match.index! > start) collect(text.slice(start, match.index))
    start = match.index! + match[0].length
  }
  if (start < text.length) collect(text.slice(start))
  return entries.filter((_, index) => matchedIds.has(index + 1))
}
