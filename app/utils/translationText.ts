// Decode only the game's literal \n marker. Existing CR characters stay attached
// to the following LF when the source contains a mixed CR + literal \n pair.
export function toEditorText(value: string): string {
  return value.replace(/\\n/g, '\n')
}

// Count only the game's literal \n marker. Callers normalize physical line endings first.
export function countLineBreaks(value: string): number {
  return value.match(/\\n/g)?.length ?? 0
}

export function toTranslationRequestText(value: string, replaceEscapedLineBreaks = true): string {
  return replaceEscapedLineBreaks ? toEditorText(value) : toParaTranzText(value)
}

export function toParaTranzText(value: string): string {
  // Treat a raw CR followed by the game's literal \n as one delimiter, then
  // encode escaped or physical newlines in ParaTranz's canonical form.
  return value.replace(/\r\\n|\\n|\r\n|\n/g, '\\n')
}
