// Ports of SCCL/scripts/{merge_and_check,format_consistency_advisory}.py.
// Game newline escapes are decoded for segment parsing, as in this editor.
import { tokens } from './text'
import { toEditorText } from './translationText'

export interface QualityIssue {
  type: string; message: string; rule: 'SCCL' | 'SCCL 格式提示' | '编辑器'
  source: string[]; target: string[]; tokens: string[]; insertable: boolean
}
export interface QualityEntry { id: number; key: string; original: string; translation: string }
export interface QualityFinding extends QualityIssue { entries: QualityEntry[] }
export interface QualityReport { scanned: number; findings: QualityFinding[] }
const ignoredKey = 'item_NameFood_bar_snaggle_01_pepper_a'
const percentage = /[+-]?\s*\d+(?:\.\d+)?\s*[%％]/g
const pairs = (text: string) => [...text.matchAll(/~\s*([\p{L}\p{N}_]+)\s*[(（](.*?)[)）]/gsu)].map(match => [match[1]!, match[2]!] as const)
const equalBag = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
const stripTags = (text: string) => text.replace(/<\/?[A-Za-z][^>]*>/g, '')
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function inspected(text: string, scopes: string[]) {
  let cleaned = toEditorText(text)
  for (const scope of new Set(scopes)) cleaned = cleaned.replace(new RegExp(`~\\s*${escapeRegex(scope)}\\s*[(（][^\\n\\r]*?[)）]`, 'g'), '')
  return {
    colon: [...cleaned.matchAll(/[:：]\s*([^\n\r]*)/g)].map(match => match[1]!).filter(part => !/^\s*\/\//.test(part)).map(stripTags),
    paren: [...cleaned.matchAll(/[(（]([^）)]*)[）)]/g)].map(match => stripTags(match[1]!)),
  }
}
function percentages(parts: string[], advisory = false) {
  return parts.flatMap(part => [...part.matchAll(percentage)].map(match => advisory ? canonicalNumber(match[0]) : match[0].replace(/\s/g, '').replaceAll('％', '%')))
}
function numbers(parts: string[], position: 'colon' | 'paren', advisory = false) {
  return parts.flatMap(part => {
    const clean = part.replace(percentage, '')
    const values = position === 'colon'
      ? (clean.match(advisory ? /^\s*([+-]?\s*\d+(?:\.\d+)?)/ : /^\s*([+-]?\d+)/)?.slice(1) || [])
      : [...clean.matchAll(advisory ? /[+-]?\s*\d+(?:\.\d+)?/g : /[+-]?\d+/g)].map(match => match[0])
    return values.map(value => advisory ? canonicalNumber(value) : BigInt(value).toString())
  })
}
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
function numericIssues(original: string, translation: string, advisory: boolean): QualityIssue[] {
  const scopes = [...pairs(original), ...pairs(translation)].map(pair => pair[0])
  const source = inspected(original, scopes), target = inspected(translation, scopes), result: QualityIssue[] = []
  const rule = advisory ? 'SCCL 格式提示' : 'SCCL'
  const sourcePercent = percentages([...source.colon, ...source.paren], advisory)
  let targetPercent = percentages([...target.colon, ...target.paren], advisory)
  if (sourcePercent.length && !targetPercent.length) targetPercent = percentages([stripTags(toEditorText(translation))], advisory)
  if (!equalBag(sourcePercent, targetPercent)) result.push(issue('percentage', '百分比不一致', sourcePercent, targetPercent, rule))
  for (const position of ['colon', 'paren'] as const) {
    const a = numbers(source[position], position, advisory), b = numbers(target[position], position, advisory)
    if ((position === 'colon' || a.length) && !equalBag(a, b)) result.push(issue(`number_${position}`, position === 'colon' ? '冒号后数字不一致' : '括号内数字不一致', a, b, rule))
  }
  return result
}
export function qualityIssues(original: string, translation: string, key = ''): QualityIssue[] {
  if (!translation.trim()) return [issue('empty', '译文为空', [], [], '编辑器')]
  const result: QualityIssue[] = [], target = translation.trim()
  const formal = key !== ignoredKey, advisory = !key.endsWith(',P')
  if (formal) {
    const sourcePairs = pairs(original), targetPairs = pairs(target)
    const same = (a: readonly string[], b: readonly string[]) => a[0] === b[0] && a[1] === b[1]
    const missing = sourcePairs.filter(a => !targetPairs.some(b => same(a, b))).map(pair => `~${pair[0]}(${pair[1]})`)
    const extra = targetPairs.filter(a => !sourcePairs.some(b => same(a, b))).map(pair => `~${pair[0]}(${pair[1]})`)
    if (missing.length || extra.length) result.push(issue('key_placeholder', '占位符名称或参数不一致', missing, extra, 'SCCL', [...new Set(missing)]))
    if (key.startsWith('item_')) result.push(...numericIssues(original, target, false))
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
    if (key.startsWith('item_Desc')) for (const finding of numericIssues(normalized(original), normalized(target), true)) {
      if (!result.some(item => item.type === finding.type)) result.push(finding)
    }
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
export function checkQualityFile(corpus: QualityEntry[]): QualityReport {
  const effective = new Map<string, QualityEntry>()
  for (const entry of corpus) if (!effective.has(entry.key) || entry.id > effective.get(entry.key)!.id) effective.set(entry.key, entry)
  const entries = [...effective.values()], findings: QualityFinding[] = [], signatures = new Set<string>()
  function add(finding: QualityIssue, rows: QualityEntry[]) {
    const sorted = [...rows].sort((a, b) => a.key.localeCompare(b.key)), signature = JSON.stringify([finding.type, sorted.map(row => row.key)])
    if (!signatures.has(signature)) { signatures.add(signature); findings.push({ ...finding, entries: sorted }) }
  }
  for (const entry of entries) if (entry.translation.trim()) for (const finding of qualityIssues(entry.original, entry.translation, entry.key)) add(finding, [entry])
  const types = new Map<string, QualityEntry[]>()
  for (const entry of entries) if (entry.translation.trim() && entry.original.includes('Item Type: ') && /物品类型\s*[:：]/.test(entry.translation)) {
    const english = toEditorText(entry.original.split('Item Type: ')[1]!).split('\n')[0]!, rows = types.get(english) || []
    rows.push(entry); types.set(english, rows)
  }
  for (const [english, rows] of types) {
    const targets = [...new Set(rows.map(row => toEditorText(row.translation.trim().split(/物品类型\s*[:：]/)[1]!).split('\n')[0]!))].sort()
    if (targets.length > (english === 'Heavy Utility' ? 2 : 1)) add(issue('item_type_mapping', '同一物品类型出现不同译法', [english], targets), rows)
  }
  const exact = new Map<string, QualityEntry[]>(), templates = new Map<string, QualityEntry[]>()
  for (const entry of entries) {
    const original = normalized(entry.original)
    if (entry.key.endsWith(',P') || [...original].length < 80) continue
    const exactRows = exact.get(original) || []; exactRows.push(entry); exact.set(original, exactRows)
    const template = skeleton(original)
    const fixed = template.text.replace(/<(?:PH:[^>]+|TAG:[^>]+|URL|PERCENT|NUMBER)>/g, '').match(/[A-Za-z0-9\u3400-\u9fff]/g)?.length || 0
    if (template.slots.some(slot => slot[0] !== 'tag') && fixed >= 4) { const rows = templates.get(template.text) || []; rows.push(entry); templates.set(template.text, rows) }
  }
  function compareGroup(rows: QualityEntry[], template: boolean) {
    if (rows.length < 2 || (template && new Set(rows.map(row => normalized(row.original))).size < 2)) return
    const translated = rows.filter(row => normalized(row.translation)), targets = [...new Set(translated.map(row => template ? skeleton(row.translation).text : normalized(row.translation)))]
    if (rows.some(row => !normalized(row.translation))) add(issue('missing_template', '模板组内存在空译文', [], [], 'SCCL 格式提示'), rows)
    if (targets.length > 1) add(issue(template ? 'template_conflict' : 'exact_conflict', template ? '参数模板出现不同固定文本' : '相同原文出现不同译文', [], [], 'SCCL 格式提示'), rows)
  }
  for (const rows of exact.values()) compareGroup(rows, false)
  for (const rows of templates.values()) compareGroup(rows, true)
  return { scanned: entries.length, findings }
}
