import type { Term } from '~/types/editor'
import { toEditorText } from '~/utils/translationText'

export interface TermTextPart { text: string; terms?: Term[] }
export interface SourceTermReplacement { source: string; translation: string; term: Term }
const wordCharacter = /[\p{Script=Latin}\p{N}_]/u
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const defaultTermExemptionRules = [
  String.raw`\(Forward/Backward/Left/Right\)`,
  String.raw`[\p{L}\p{N}_-]+/s(?![\p{L}\p{N}_-])`,
]
export function compileTermExemptionRules(rules: readonly string[]) {
  const patterns: RegExp[] = []
  for (const [index, rule] of rules.entries()) {
    const source = rule.trim()
    if (!source) continue
    try { patterns.push(new RegExp(source, 'giu')) }
    catch { return { patterns: [], error: `第 ${index + 1} 行规则无效，请检查正则表达式。` } }
  }
  return { patterns, error: '' }
}
const defaultTermExemptionPatterns = compileTermExemptionRules(defaultTermExemptionRules).patterns
function findExemptionRanges(value: string, exemptionPatterns: readonly RegExp[]) {
  const ranges: Array<{ start: number; end: number }> = []
  for (const pattern of exemptionPatterns) {
    const matcher = new RegExp(pattern.source, 'giu')
    for (const match of value.matchAll(matcher)) {
      const start = match.index!, end = start + match[0].length
      if (match[0].includes('/') || match[0].includes('／')) ranges.push({ start, end })
    }
  }
  return ranges
}
export function splitTranslationAlternatives(value: string, exemptionPatterns: readonly RegExp[] = defaultTermExemptionPatterns) {
  const protectedSlashes = new Set<number>()
  for (const { start, end } of findExemptionRanges(value, exemptionPatterns)) {
    for (let index = start; index < end; index++) {
      if (value[index] === '/' || value[index] === '／') protectedSlashes.add(index)
    }
  }
  const alternatives: string[] = []
  let start = 0
  for (let index = 0; index < value.length; index++) {
    if ((value[index] === '/' || value[index] === '／') && !protectedSlashes.has(index)) {
      alternatives.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  alternatives.push(value.slice(start).trim())
  return alternatives.filter(Boolean)
}
export function termTranslationAlternatives(term: Pick<Term, 'term' | 'translation' | 'match' | 'variants'>, exemptionPatterns: readonly RegExp[] = defaultTermExemptionPatterns) {
  const translation = toEditorText(term.translation)
  const sourceSpellings = [term.term, ...(term.match || []), ...(term.variants || [])]
  if (sourceSpellings.some(spelling => typeof spelling === 'string' && findExemptionRanges(spelling, exemptionPatterns).length > 0)) {
    return translation.trim() ? [translation.trim()] : []
  }
  return splitTranslationAlternatives(translation, exemptionPatterns)
}

export function highlightTerms(text: string, terms: Term[], side: 'source' | 'translation' = 'source', exemptionPatterns: readonly RegExp[] = defaultTermExemptionPatterns): TermTextPart[] {
  const spellings = (term: Term) => side === 'translation' ? termTranslationAlternatives(term, exemptionPatterns) : [...(term.match || []), ...(term.variants || []), term.term]
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

export function replaceSourceTerms(text: string, terms: Term[], exemptionPatterns: readonly RegExp[] = defaultTermExemptionPatterns) {
  const replacements: SourceTermReplacement[] = []
  const replacePlainText = (value: string) => highlightTerms(value, terms, 'source', exemptionPatterns).map(part => {
    const term = part.terms?.[0]
    if (!term?.translation.trim()) return part.text
    const translation = toEditorText(term.translation)
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

export function highlightTranslatedTerms(text: string, terms: Term[], exemptionPatterns: readonly RegExp[] = defaultTermExemptionPatterns): TermTextPart[] {
  // Tags and variable parameters are protected syntax, not translated prose.
  const pattern = /<\/?[A-Za-z][^>]*>|~\w+\([^)]*\)|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]/g
  const result: TermTextPart[] = []
  let start = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > start) result.push(...highlightTerms(text.slice(start, match.index), terms, 'translation', exemptionPatterns))
    result.push({ text: match[0] }); start = match.index! + match[0].length
  }
  if (start < text.length) result.push(...highlightTerms(text.slice(start), terms, 'translation', exemptionPatterns))
  return result.length ? result : [{ text }]
}

export function termDescription(terms: Term[], exemptionPatterns: readonly RegExp[] = defaultTermExemptionPatterns) {
  return terms.map(term => `${term.term} → ${termTranslationAlternatives(term, exemptionPatterns).join(' / ')}${term.pos ? ` (${term.pos})` : ''}${term.note ? `\n${term.note}` : ''}`).join('\n\n')
}
