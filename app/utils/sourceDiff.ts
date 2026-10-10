export interface SourceDiffPart { kind: 'same' | 'added' | 'removed'; text: string }
interface SourceToken { text: string; start: number; end: number; protected: boolean }
const protectedPattern = /^(?:<\/?[A-Za-z][^>]*>|~\w+\([^)]*\)|\\[nr]|\r?\n|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif])$/
const tokenPattern = /<\/?[A-Za-z][^>]*>|~\w+\([^)]*\)|\\[nr]|\r?\n|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]|[\p{Script=Han}]|[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|\d+|[^\s]/gu
const weakWords = new Set('a an the and or but of to in on at for by with from as is are was were be been being it its this that these those we you they our your their have has had do does did will would can could may should'.split(' '))
function tokenize(text: string): SourceToken[] {
  return Array.from(text.matchAll(tokenPattern), match => ({ text: match[0], start: match.index!, end: match.index! + match[0].length, protected: protectedPattern.test(match[0]) }))
}
function weight(token: SourceToken) {
  if (token.protected) return 12
  if (weakWords.has(token.text.toLowerCase())) return 1
  return /[\p{L}\p{N}]/u.test(token.text) ? Math.min(8, Array.from(token.text).length + 2) : 1
}

// Whitespace is preserved in slices, but never aligns unrelated phrases.
// Isolated filler words within replacements are grouped with the changed phrase.
export function sourceDiff(memory: string, current: string): SourceDiffPart[] {
  if (memory === current) return [{ kind: 'same', text: current }]
  const before = tokenize(memory), after = tokenize(current), parts: SourceDiffPart[] = []
  function append(kind: SourceDiffPart['kind'], text: string) {
    if (!text) return
    const last = parts.at(-1)
    if (last?.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  if ((before.length + 1) * (after.length + 1) > 1_000_000) {
    append('removed', memory); append('added', current); return parts
  }
  const width = after.length + 1, scores = new Uint32Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      scores[i * width + j] = before[i]!.text === after[j]!.text
        ? scores[(i + 1) * width + j + 1]! + weight(before[i]!)
        : Math.max(scores[(i + 1) * width + j]!, scores[i * width + j + 1]!)
    }
  }
  const matches: Array<{ a: number; b: number }> = []
  let i = 0, j = 0
  while (i < before.length && j < after.length) {
    if (before[i]!.text === after[j]!.text) { matches.push({ a: i++, b: j++ }) }
    else if (scores[(i + 1) * width + j]! >= scores[i * width + j + 1]!) i++
    else j++
  }
  let oldEnd = 0, newEnd = 0
  for (let at = 0; at < matches.length;) {
    const first = matches[at]!
    let end = at + 1
    while (end < matches.length) {
      const previous = matches[end - 1]!, next = matches[end]!
      if (next.a !== previous.a + 1 || next.b !== previous.b + 1 ||
        memory.slice(before[previous.a]!.end, before[next.a]!.start) !== current.slice(after[previous.b]!.end, after[next.b]!.start)) break
      end++
    }
    const last = matches[end - 1]!, run = before.slice(first.a, last.a + 1)
    const meaningful = run.filter(token => !weakWords.has(token.text.toLowerCase()) && /[\p{L}\p{N}]/u.test(token.text) && !token.protected)
    const hanOnly = meaningful.length > 0 && meaningful.every(token => /^[\p{Script=Han}]$/u.test(token.text))
    const edge = (first.a === 0 && first.b === 0) || (last.a === before.length - 1 && last.b === after.length - 1)
    if (edge || run.some(token => token.protected) || meaningful.length >= (hanOnly ? 4 : 2)) {
      let oldStart = before[first.a]!.start, newStart = after[first.b]!.start
      while (oldStart > oldEnd && newStart > newEnd && /\s/.test(memory[oldStart - 1]!) && memory[oldStart - 1] === current[newStart - 1]) { oldStart--; newStart-- }
      append('removed', memory.slice(oldEnd, oldStart)); append('added', current.slice(newEnd, newStart))
      append('same', memory.slice(oldStart, before[last.a]!.end))
      oldEnd = before[last.a]!.end; newEnd = after[last.b]!.end
    }
    at = end
  }
  const oldTail = memory.slice(oldEnd), newTail = current.slice(newEnd)
  if (oldTail === newTail) append('same', oldTail)
  else { append('removed', oldTail); append('added', newTail) }
  return parts
}

