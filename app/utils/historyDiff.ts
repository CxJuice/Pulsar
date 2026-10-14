export type HistoryTextPart = { text: string; kind: 'same' | 'removed' | 'added' }
export type HistoryComparison = { changes: HistoryTextPart[] }

export function compareHistoryText(beforeText: string | null, afterText: string | null): HistoryComparison | null {
  if (beforeText === null && afterText === null) return null

  const beforeValue = beforeText ?? ''
  const afterValue = afterText ?? ''
  const beforeTokens = beforeValue.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || []
  const afterTokens = afterValue.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || []
  const changes: HistoryTextPart[] = []
  const append = (text: string, kind: HistoryTextPart['kind']) => {
    if (!text) return
    const previous = changes.at(-1)
    if (previous?.kind === kind) previous.text += text
    else changes.push({ text, kind })
  }

  if (beforeValue === afterValue) {
    append(beforeValue, 'same')
  } else if ((beforeTokens.length + 1) * (afterTokens.length + 1) > 250_000) {
    let prefix = 0, suffix = 0
    while (prefix < beforeTokens.length && prefix < afterTokens.length && beforeTokens[prefix] === afterTokens[prefix]) prefix++
    while (suffix < beforeTokens.length - prefix && suffix < afterTokens.length - prefix && beforeTokens[beforeTokens.length - 1 - suffix] === afterTokens[afterTokens.length - 1 - suffix]) suffix++
    append(beforeTokens.slice(0, prefix).join(''), 'same')
    append(beforeTokens.slice(prefix, beforeTokens.length - suffix).join(''), 'removed')
    append(afterTokens.slice(prefix, afterTokens.length - suffix).join(''), 'added')
    append(afterTokens.slice(afterTokens.length - suffix).join(''), 'same')
  } else {
    const columns = afterTokens.length + 1, rows = beforeTokens.length + 1
    const lcs = new Uint32Array(rows * columns)
    for (let i = beforeTokens.length - 1; i >= 0; i--) {
      for (let j = afterTokens.length - 1; j >= 0; j--) {
        const cell = i * columns + j
        lcs[cell] = beforeTokens[i] === afterTokens[j]
          ? (lcs[(i + 1) * columns + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * columns + j] ?? 0, lcs[i * columns + j + 1] ?? 0)
      }
    }
    let i = 0, j = 0
    while (i < beforeTokens.length || j < afterTokens.length) {
      if (i < beforeTokens.length && j < afterTokens.length && beforeTokens[i] === afterTokens[j]) {
        append(beforeTokens[i]!, 'same'); i++; j++
      } else if (i < beforeTokens.length && (j === afterTokens.length || (lcs[(i + 1) * columns + j] ?? 0) >= (lcs[i * columns + j + 1] ?? 0))) {
        append(beforeTokens[i++]!, 'removed')
      } else {
        append(afterTokens[j++]!, 'added')
      }
    }
  }
  if (!changes.length) changes.push({ text: '（空）', kind: 'same' })
  return { changes }
}
