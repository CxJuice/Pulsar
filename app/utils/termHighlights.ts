import type { Term } from '~/types/editor'

export interface TermTextPart { text: string; terms?: Term[] }
const wordCharacter = /[\p{Script=Latin}\p{N}_]/u
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function highlightTerms(text: string, terms: Term[]): TermTextPart[] {
  const variants = new Map<string, Term[]>()
  for (const term of terms) {
    for (const value of [...(term.match || []), ...(term.variants || []), term.term]) {
      if (typeof value !== 'string' || !value.trim()) continue
      const key = value.toLocaleLowerCase()
      const entries = variants.get(key) || []
      if (!entries.some(entry => entry.id === term.id)) entries.push(term)
      variants.set(key, entries)
    }
  }
  if (!variants.size || !text) return [{ text }]
  const choices = [...variants.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(choices.map(escapePattern).join('|'), 'giu')
  const result: TermTextPart[] = []
  let start = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index!, value = match[0], end = index + value.length
    const before = Array.from(text.slice(Math.max(0, index - 2), index)).at(-1) || ''
    const after = Array.from(text.slice(end, end + 2))[0] || ''
    const first = Array.from(value)[0]!, last = Array.from(value).at(-1)!
    if ((wordCharacter.test(first) && wordCharacter.test(before)) || (wordCharacter.test(last) && wordCharacter.test(after))) continue
    const matched = variants.get(value.toLocaleLowerCase())?.filter(term => !term.caseSensitive || [...(term.match || []), ...(term.variants || []), term.term].includes(value)) || []
    if (!matched.length) continue
    if (index > start) result.push({ text: text.slice(start, index) })
    result.push({ text: value, terms: matched })
    start = end
  }
  if (start < text.length) result.push({ text: text.slice(start) })
  return result.length ? result : [{ text }]
}

export function termDescription(terms: Term[]) {
  return terms.map(term => `${term.term} → ${term.translation}${term.pos ? ` (${term.pos})` : ''}${term.note ? `\n${term.note}` : ''}`).join('\n\n')
}
