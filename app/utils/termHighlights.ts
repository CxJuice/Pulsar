import type { Term } from '~/types/editor'
import { toEditorText } from '~/utils/translationText'

export interface TermTextPart { text: string; terms?: Term[] }
export interface SourceTermReplacement { source: string; translation: string; term: Term }
const wordCharacter = /[\p{Script=Latin}\p{N}_]/u
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function splitTranslationAlternatives(value: string) {
  return value.split(/\s*[\/／]\s*/u).map(part => part.trim()).filter(Boolean)
}

export function highlightTerms(text: string, terms: Term[], side: 'source' | 'translation' = 'source'): TermTextPart[] {
  const spellings = (term: Term) => side === 'translation' ? splitTranslationAlternatives(toEditorText(term.translation)) : [...(term.match || []), ...(term.variants || []), term.term]
  const variants = new Map<string, Term[]>()
  for (const term of terms) {
    for (const value of spellings(term)) {
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
    const matched = variants.get(value.toLocaleLowerCase())?.filter(term => !term.caseSensitive || spellings(term).includes(value)) || []
    if (!matched.length) continue
    if (index > start) result.push({ text: text.slice(start, index) })
    result.push({ text: value, terms: matched })
    start = end
  }
  if (start < text.length) result.push({ text: text.slice(start) })
  return result.length ? result : [{ text }]
}

export function replaceSourceTerms(text: string, terms: Term[]) {
  const replacements: SourceTermReplacement[] = []
  const replacePlainText = (value: string) => highlightTerms(value, terms).map(part => {
    const term = part.terms?.[0]
    if (!term?.translation.trim()) return part.text
    // Multiple approved names are alternatives, not a literal phrase to inject.
    const translation = splitTranslationAlternatives(toEditorText(term.translation))[0] || ''
    replacements.push({ source: part.text, translation, term })
    return translation
  }).join('')
  const result: string[] = []
  const protectedPattern = /<\/?[A-Za-z][^>]*>|~\w+\([^)]*\)|\\n|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]/g
  let start = 0
  for (const match of text.matchAll(protectedPattern)) {
    if (match.index! > start) result.push(replacePlainText(text.slice(start, match.index)))
    result.push(match[0])
    start = match.index! + match[0].length
  }
  if (start < text.length) result.push(replacePlainText(text.slice(start)))
  return { text: result.join(''), replacements }
}

export function highlightTranslatedTerms(text: string, terms: Term[]): TermTextPart[] {
  // Tags and variable parameters are protected syntax, not translated prose.
  const pattern = /<\/?[A-Za-z][^>]*>|~\w+\([^)]*\)|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]/g
  const result: TermTextPart[] = []
  let start = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > start) result.push(...highlightTerms(text.slice(start, match.index), terms, 'translation'))
    result.push({ text: match[0] }); start = match.index! + match[0].length
  }
  if (start < text.length) result.push(...highlightTerms(text.slice(start), terms, 'translation'))
  return result.length ? result : [{ text }]
}

export function termDescription(terms: Term[]) {
  return terms.map(term => `${term.term} → ${splitTranslationAlternatives(term.translation).join(' / ')}${term.pos ? ` (${term.pos})` : ''}${term.note ? `\n${term.note}` : ''}`).join('\n\n')
}
