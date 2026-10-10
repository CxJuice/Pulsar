import leven from 'leven'
import type { Suggestion } from '~/types/editor'

const MIN_SCORE = 0.7

// Standard normalized Levenshtein, with unit insertion/deletion/substitution costs.
// https://rapidfuzz.github.io/RapidFuzz/Usage/distance/Levenshtein.html
// Distance implementation: https://github.com/sindresorhus/leven
// Compare complete original strings; preserve case, symbols, tags and whitespace.
export function sourceSimilarity(original: string, current: string): number {
  const maximum = Math.max(original.length, current.length)
  return maximum === 0 ? 1 : 1 - leven(original, current) / maximum
}

export function prepareSuggestions(candidates: Suggestion[], current: string): Suggestion[] {
  return candidates.flatMap(suggestion => {
    if (!current.trim() || typeof suggestion.original !== 'string' || !suggestion.original.trim() ||
      typeof suggestion.translation !== 'string' || !suggestion.translation.trim()) return []
    return [{ ...suggestion, localMatching: sourceSimilarity(suggestion.original, current) }]
  }).filter(suggestion => suggestion.localMatching >= MIN_SCORE)
    .sort((a, b) => b.localMatching - a.localMatching || a.id - b.id)
}
