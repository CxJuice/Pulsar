export type SearchHighlightPart = { text: string; hit: boolean }

export function searchHighlightParts(value: string, query: string): SearchHighlightPart[] {
  const text = value.replaceAll('\\n', '\n')
  const normalizedQuery = query.replaceAll('\\n', '\n')
  if (!normalizedQuery) return [{ text, hit: false }]

  const escaped = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const result: SearchHighlightPart[] = []
  let start = 0
  for (const match of text.matchAll(new RegExp(escaped, 'gi'))) {
    if (match.index! > start) result.push({ text: text.slice(start, match.index), hit: false })
    result.push({ text: match[0], hit: true })
    start = match.index! + match[0].length
  }
  if (start < text.length) result.push({ text: text.slice(start), hit: false })
  return result
}
