// Ports of SCCL/scripts/{merge_and_check,format_consistency_advisory}.py.
// Game newline escapes are decoded for segment parsing, as in this editor.
import { tokens } from './text'
import { toEditorText } from './translationText'

export interface QualityIssue {
  type: string; message: string; rule: 'SCCL' | 'SCCL 格式提示' | '编辑器'
  source: string[]; target: string[]; tokens: string[]; insertable: boolean
}
const ignoredKey = 'item_NameFood_bar_snaggle_01_pepper_a'
const pairs = (text: string) => [...text.matchAll(/~\s*([\p{L}\p{N}_]+)\s*[(（](.*?)[)）]/gsu)].map(match => [match[1]!, match[2]!] as const)
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
// Check all visible numbers, independently of SCCL's key and segment restrictions.
function entryNumbers(value: string) {
  const plain = toEditorText(value).normalize('NFKC').replaceAll('−', '-')
    .replace(/https?:\/\/[^\s<>]+|<\/?[A-Za-z][^>]*>|~\s*[\p{L}\p{N}_]+\s*\([^)]*\)|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]/giu, ' ')
  const values: string[] = [], percentages: string[] = []
  for (const match of plain.matchAll(/(?:(?<![\p{L}\p{N}_])[+-])?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:\s*%)?/gu)) {
    const raw = match[0].replaceAll(',', ''), absolute = canonicalNumber(raw)
    const number = raw.startsWith('-') && absolute !== '0' ? `-${absolute}` : absolute
    if (raw.endsWith('%')) percentages.push(number + '%')
    else values.push(number)
  }
  return { values, percentages }
}
function entryNumericIssues(original: string, translation: string): QualityIssue[] {
  const source = entryNumbers(original), target = entryNumbers(translation), result: QualityIssue[] = []
  if (!equalBag(source.values, target.values)) result.push(issue('number', '数字不一致', source.values, target.values, '编辑器'))
  if (!equalBag(source.percentages, target.percentages)) result.push(issue('percentage', '百分比不一致', source.percentages, target.percentages, '编辑器'))
  return result
}
export function qualityIssues(original: string, translation: string, key = ''): QualityIssue[] {
  if (!translation.trim()) return [issue('empty', '译文为空', [], [], '编辑器')]
  const target = translation.trim(), result = entryNumericIssues(original, target)
  const formal = key !== ignoredKey, advisory = !key.endsWith(',P')
  if (formal) {
    const sourcePairs = pairs(original), targetPairs = pairs(target)
    const same = (a: readonly string[], b: readonly string[]) => a[0] === b[0] && a[1] === b[1]
    const missing = sourcePairs.filter(a => !targetPairs.some(b => same(a, b))).map(pair => `~${pair[0]}(${pair[1]})`)
    const extra = targetPairs.filter(a => !sourcePairs.some(b => same(a, b))).map(pair => `~${pair[0]}(${pair[1]})`)
    if (missing.length || extra.length) result.push(issue('key_placeholder', '占位符名称或参数不一致', missing, extra, 'SCCL', [...new Set(missing)]))
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
