import leven from 'leven'
import type { Suggestion } from '~/types/editor'

// Standard normalized Levenshtein, with unit insertion/deletion/substitution costs.
// https://rapidfuzz.github.io/RapidFuzz/Usage/distance/Levenshtein.html
// Distance implementation: https://github.com/sindresorhus/leven
// Compare complete original strings; preserve case, symbols, tags and whitespace.
export function sourceSimilarity(original: string, current: string): number {
  const maximum = Math.max(original.length, current.length)
  return maximum === 0 ? 1 : 1 - leven(original, current) / maximum
}

export function prepareSuggestions(candidates: Suggestion[], current: string): Suggestion[] {
  return candidates.map(suggestion => ({
    ...suggestion,
    localMatching: sourceSimilarity(typeof suggestion.original === 'string' ? suggestion.original : '', current),
  }))
    .sort((a, b) => b.localMatching - a.localMatching || a.id - b.id)
}
