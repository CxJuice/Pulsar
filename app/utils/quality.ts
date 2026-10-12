// Ports of SCCL/scripts/{merge_and_check,format_consistency_advisory}.py.
// Game newline escapes are decoded for segment parsing, as in this editor.
import { tokens } from './text'
import type { Term } from '~/types/editor'
import { toEditorText } from './translationText'
import { splitTranslationAlternatives } from './termHighlights'

export interface QualityIssue {
  type: string; message: string; rule: 'SCCL' | 'SCCL 格式提示' | '编辑器'
  source: string[]; target: string[]; tokens: string[]; insertable: boolean
  locations?: { source: QualityLocation[]; target: QualityLocation[] }
}
export interface QualityLocation {
  start: number; end: number; line: number; before: string; text: string; after: string
}
const ignoredKey = 'item_NameFood_bar_snaggle_01_pepper_a'
const equalBag = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
// SCCL advisory uses Decimal(abs(value)); string normalization avoids float loss.
function canonicalNumber(value: string) {
  const clean = value.normalize('NFKC').replace(/\s/g, '').replace(/%$/, '').replace(/^[+-]+/, '')
  const [integer = '0', fraction = ''] = clean.split('.')
  const whole = integer.replace(/^0+(?=\d)/, '') || '0', decimal = fraction.replace(/0+$/, '')
  return decimal ? `${whole}.${decimal}` : whole
}
function normalized(value: string) {
  return toEditorText(value).normalize('NFKC').split('\n').map(line => line.replace(/[ \t\f\v]+/g, ' ').trimEnd()).join('\n').trim()
}
function tagSignature(raw: string) {
  const match = raw.match(/<\s*(\/)?\s*([A-Za-z][\w:-]*)/)
  return match ? `<${match[1] || ''}${match[2]!.toLowerCase()}>` : raw
}
const tagName = (tag: string) => tag.replace(/^<\/?|>$/g, '')
function tagSignatures(text: string) { return [...normalized(text).matchAll(/<\/?[A-Za-z][^>\n\r]*>/g)].map(match => tagSignature(match[0])) }
function balancedNames(text: string) {
  const open = new Map<string, number>(), close = new Map<string, number>()
  for (const tag of tagSignatures(text)) { const counts = tag.startsWith('</') ? close : open, name = tagName(tag); counts.set(name, (counts.get(name) || 0) + 1) }
  return new Set([...open].filter(([name, count]) => count === close.get(name)).map(([name]) => name))
}
function placeholderSignature(raw: string) {
  const value = normalized(raw), match = value.match(/~\s*([A-Za-z_]\w*)\s*[(（](.*)[)）]/s)
  return match ? `~${match[1]}(${match[2]!.replace(/\s/g, '')})` : value
}
function skeleton(value: string) {
  const text = normalized(value), balanced = balancedNames(text), slots: Array<[string, string]> = []
  const result = text.replace(/(~\s*[A-Za-z_]\w*\s*[(（][^\n\r]*?[)）])|(<\/?[A-Za-z][^>\n\r]*>)|(https?:\/\/[^\s<>]+)|([+-]?\s*\d+(?:\.\d+)?\s*[%％])|([+-]?\s*\d+(?:\.\d+)?)/gi,
    (raw, ph, tag, url, pct) => {
      if (ph) { slots.push(['placeholder', placeholderSignature(raw)]); return `<PH:${raw.match(/~\s*([A-Za-z_]\w*)/)![1]!.toLowerCase()}>` }
      if (tag) { const signature = tagSignature(raw); if (!balanced.has(tagName(signature))) return raw; slots.push(['tag', signature]); return `<TAG:${signature.slice(1, -1)}>` }
      const kind = url ? 'url' : pct ? 'percentage' : 'number'
      slots.push([kind, url ? normalized(raw) : canonicalNumber(raw)])
      return url ? '<URL>' : pct ? '<PERCENT>' : '<NUMBER>'
    })
  return { text: normalized(result), slots }
}
function issue(type: string, message: string, source: string[] = [], target: string[] = [], rule: QualityIssue['rule'] = 'SCCL', insert: string[] = []): QualityIssue {
  return { type, message, source, target, rule, tokens: insert, insertable: !!insert.length }
}
function qualityLocation(text: string, start: number, end: number): QualityLocation {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1, nextBreak = text.indexOf('\n', end)
  const lineEnd = nextBreak < 0 ? text.length : nextBreak
  const beforeStart = Math.max(lineStart, start - 48), afterEnd = Math.min(lineEnd, end + 48)
  return { start, end, line: text.slice(0, start).split('\n').length,
    before: (beforeStart > lineStart ? '…' : '') + text.slice(beforeStart, start), text: text.slice(start, end),
    after: text.slice(end, afterEnd) + (afterEnd < lineEnd ? '…' : '') }
}
function entryPlaceholders(value: string) {
  const text = toEditorText(value)
  return [...text.matchAll(/~\s*([\p{L}\p{N}_]+)\s*[(（](.*?)[)）]/gsu)].map(match => ({
    signature: JSON.stringify([match[1], match[2]]), value: match[0],
    location: qualityLocation(text, match.index!, match.index! + match[0].length),
  }))
}
function entryPlaceholderIssues(original: string, translation: string): QualityIssue[] {
  const source = entryPlaceholders(original), target = entryPlaceholders(translation)
  // Multiset comparison, as in SCCL's Counter checks: each occurrence is consumed once.
  function unmatched(rows: typeof source, other: typeof source) {
    const counts = new Map<string, number>()
    for (const row of other) counts.set(row.signature, (counts.get(row.signature) || 0) + 1)
    return rows.filter(row => {
      const count = counts.get(row.signature) || 0
      if (!count) return true
      counts.set(row.signature, count - 1); return false
    })
  }
  const missing = unmatched(source, target), extra = unmatched(target, source)
  if (!missing.length && !extra.length) return []
  const message = !missing.length ? '译文有额外的占位符名称或参数' : !extra.length ? '译文缺少占位符名称或参数' : '占位符名称或参数不一致'
  return [{
    ...issue('key_placeholder', message, missing.map(row => row.value), extra.map(row => row.value), '编辑器', [...new Set(missing.map(row => row.value))]),
    locations: { source: missing.map(row => row.location), target: extra.map(row => row.location) },
  }]
}
// Check all visible numbers, independently of SCCL's key and segment restrictions.
function entryNumbers(value: string) {
  const decoded = toEditorText(value), starts: number[] = [], ends: number[] = []
  let normalizedText = '', offset = 0
  // Keep offsets into the displayed text when normalization expands a character.
  for (const character of decoded) {
    const normalizedCharacter = character.normalize('NFKC').replaceAll('−', '-')
    normalizedText += normalizedCharacter
    for (let index = 0; index < normalizedCharacter.length; index++) { starts.push(offset); ends.push(offset + character.length) }
    offset += character.length
  }
  const plain = normalizedText.replace(/https?:\/\/[^\s<>]+|<\/?[A-Za-z][^>]*>|~\s*[\p{L}\p{N}_]+\s*\([^)]*\)|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]/giu, match => match.replace(/[^\n]/g, ' '))
  const values: Array<{ value: string; location: QualityLocation }> = [], percentages: typeof values = []
  for (const match of plain.matchAll(/(?:(?<![\p{L}\p{N}_])[+-])?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:\s*%)?/gu)) {
    const raw = match[0].replaceAll(',', ''), absolute = canonicalNumber(raw)
    const number = raw.startsWith('-') && absolute !== '0' ? `-${absolute}` : absolute
    const start = starts[match.index!]!, end = ends[match.index! + match[0].length - 1]!
    const location = qualityLocation(decoded, start, end)
    if (raw.endsWith('%')) percentages.push({ value: number + '%', location })
    else values.push({ value: number, location })
  }
  return { values, percentages }
}
function entryNumericIssues(original: string, translation: string): QualityIssue[] {
  const source = entryNumbers(original), target = entryNumbers(translation), result: QualityIssue[] = []
  function unmatched(rows: typeof source.values, other: typeof source.values) {
    const counts = new Map<string, number>()
    for (const row of other) counts.set(row.value, (counts.get(row.value) || 0) + 1)
    return rows.filter(row => {
      const count = counts.get(row.value) || 0
      if (!count) return true
      counts.set(row.value, count - 1); return false
    })
  }
  for (const [kind, message] of [['values', '数字不一致'], ['percentages', '百分比不一致']] as const) {
    const missing = unmatched(source[kind], target[kind]), extra = unmatched(target[kind], source[kind])
    if (missing.length || extra.length) result.push({
      ...issue(kind === 'values' ? 'number' : 'percentage', message, missing.map(row => row.value), extra.map(row => row.value), '编辑器'),
      locations: { source: missing.map(row => row.location), target: extra.map(row => row.location) },
    })
  }
  return result
}

const termProtectedPattern = /<\/?[A-Za-z][^>]*>|~\w+\([^)]*\)|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]/g
const termWordCharacter = /[\p{Script=Latin}\p{N}_]/u
const escapeTermPattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface TermOccurrence { start: number; end: number }

function termSpellingOccurrences(text: string, term: Term, side: 'source' | 'translation', offset = 0): TermOccurrence[] {
  const spellings = side === 'translation'
    ? splitTranslationAlternatives(toEditorText(term.translation))
    : [...(term.match || []), ...(term.variants || []), term.term]
  const occurrences = new Map<string, TermOccurrence>()
  for (const spelling of spellings) {
    if (typeof spelling !== 'string' || !spelling.trim()) continue
    // Look ahead so overlapping occurrences are checked independently too.
    const pattern = new RegExp(`(?=(${escapeTermPattern(spelling)}))`, term.caseSensitive ? 'gu' : 'giu')
    for (const match of text.matchAll(pattern)) {
      const index = match.index!, value = match[1]!, end = index + value.length
      const before = Array.from(text.slice(Math.max(0, index - 2), index)).at(-1) || ''
      const after = Array.from(text.slice(end, end + 2))[0] || ''
      const first = Array.from(value)[0]!, last = Array.from(value).at(-1)!
      if ((termWordCharacter.test(first) && termWordCharacter.test(before)) ||
          (termWordCharacter.test(last) && termWordCharacter.test(after))) continue
      const occurrence = { start: offset + index, end: offset + end }
      occurrences.set(`${occurrence.start}:${occurrence.end}`, occurrence)
    }
  }
  return [...occurrences.values()]
}

function termOccurrencesInProse(text: string, term: Term, side: 'source' | 'translation'): TermOccurrence[] {
  const occurrences: TermOccurrence[] = []
  let start = 0
  for (const match of text.matchAll(termProtectedPattern)) {
    if (match.index! > start) occurrences.push(...termSpellingOccurrences(text.slice(start, match.index), term, side, start))
    start = match.index! + match[0].length
  }
  if (start < text.length) occurrences.push(...termSpellingOccurrences(text.slice(start), term, side, start))
  return occurrences
}

function termUsageIssues(original: string, translation: string, terms: Term[]): QualityIssue[] {
  if (!terms.length) return []
  const source = toEditorText(original), target = toEditorText(translation)
  const sourceMatches = terms
    .filter(term => term.translation.trim())
    .map(term => ({ term, occurrences: termOccurrencesInProse(source, term, 'source') }))
    .filter(match => match.occurrences.length)
  // A phrase's registered translation covers the shorter terms inside that phrase.
  // Keep a short term required when it also occurs outside any longer matched phrase.
  const expectedTerms = sourceMatches
    .filter(({ term, occurrences }) => occurrences.some(occurrence => !sourceMatches.some(({ term: other, occurrences: otherOccurrences }) =>
      other.id !== term.id && other.translation.trim() && otherOccurrences.some(otherOccurrence =>
        otherOccurrence.end - otherOccurrence.start > occurrence.end - occurrence.start &&
        otherOccurrence.start <= occurrence.start && otherOccurrence.end >= occurrence.end))))
    .map(({ term }) => term)
  const missing = expectedTerms.filter(term => !termOccurrencesInProse(target, term, 'translation').length)
  return missing.length
    ? [issue('term_usage', '译文未使用术语表中的对应译名', missing.map(term => term.term), missing.map(term => toEditorText(term.translation)), '编辑器')]
    : []
}

export function qualityIssues(original: string, translation: string, key = '', terms: Term[] = []): QualityIssue[] {
  if (!toEditorText(translation).trim()) return []
  const target = translation, result = [...termUsageIssues(original, translation, terms), ...entryNumericIssues(original, translation), ...entryPlaceholderIssues(original, translation)]
  const formal = key !== ignoredKey, advisory = !key.endsWith(',P')
  if (formal) {
    const a = (toEditorText(original).match(/\n/g) || []).length, b = (toEditorText(target).match(/\n/g) || []).length
    if (a !== b) result.push(issue('newline', '换行数量不一致', [String(a)], [String(b)]))
  }
  if (advisory && normalized(original)) {
    const a = skeleton(original), b = skeleton(target), values = (slots: typeof a.slots, kind: string) => slots.filter(slot => slot[0] === kind).map(slot => slot[1])
    const phA = values(a.slots, 'placeholder'), phB = values(b.slots, 'placeholder')
    if (!equalBag(phA, phB) && !result.some(item => item.type === 'key_placeholder')) result.push(issue('placeholder_count', '占位符数量或名称不一致', phA, phB, 'SCCL 格式提示'))
    const urlsA = values(a.slots, 'url'), urlsB = values(b.slots, 'url')
    if (urlsA.length && JSON.stringify(urlsA) !== JSON.stringify(urlsB)) result.push(issue('url', 'URL 内容或顺序不一致', urlsA, urlsB, 'SCCL 格式提示'))
    const expected = balancedNames(original), tagsA = tagSignatures(original).filter(tag => expected.has(tagName(tag))), tagsB = tagSignatures(target).filter(tag => expected.has(tagName(tag)))
    if (JSON.stringify(tagsA) !== JSON.stringify(tagsB)) result.push(issue('tag_structure', '成对标签结构不一致', tagsA, tagsB, 'SCCL 格式提示'))
    if (!formal) {
      const a = (toEditorText(original).match(/\n/g) || []).length, b = (toEditorText(target).match(/\n/g) || []).length
      if (a !== b) result.push(issue('newline', '换行数量不一致', [String(a)], [String(b)], 'SCCL 格式提示'))
    }
  }
  if (original.includes('Item Type: ') && !/物品类型\s*[:：]/.test(target)) result.push(issue('item_type_label', '译文缺少物品类型标签', ['物品类型：']))
  // Retain the editor's brace/printf and unpaired-tag checks without duplicating SCCL placeholders.
  const generic = (value: string) => tokens(value).filter(token => !token.startsWith('~') && !(result.some(item => item.type === 'tag_structure') && token.startsWith('<')))
  const sourceTokens = generic(original), targetTokens = generic(target)
  const count = (values: string[], token: string) => values.filter(value => value === token).length
  const missing = [...new Set(sourceTokens)].filter(token => count(targetTokens, token) < count(sourceTokens, token))
  const extra = [...new Set(targetTokens)].filter(token => count(targetTokens, token) > count(sourceTokens, token))
  if (missing.length) result.push(issue('missing', '译文缺少标记或变量', missing, [], '编辑器', missing))
  if (extra.length) result.push(issue('extra', '译文有额外的标记或变量', [], extra, '编辑器'))
  if (translation !== translation.trim()) result.push(issue('whitespace', '译文首尾存在空白', [], [], '编辑器'))
  return result
}
