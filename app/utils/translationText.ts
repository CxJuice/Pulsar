// The editor uses real line breaks; ParaTranz stores the game's literal escapes.
export function toEditorText(value: string): string {
  return value.replace(/\\r\\n|\\n|\\r|\r\n?/g, '\n')
}

export function toTranslationRequestText(value: string, replaceEscapedLineBreaks = true): string {
  return replaceEscapedLineBreaks ? toEditorText(value) : toParaTranzText(value)
}

export function toParaTranzText(value: string): string {
  return toEditorText(value).replaceAll('\n', '\\n')
}
