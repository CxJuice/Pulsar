// The editor uses real line breaks; ParaTranz stores the game's literal escapes.
export function toEditorText(value: string): string {
  return value.replace(/\\r\\n|\\n|\\r|\r\n?/g, '\n')
}

export function toParaTranzText(value: string): string {
  return toEditorText(value).replaceAll('\n', '\\n')
}
