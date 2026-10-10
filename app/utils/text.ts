export const stageLabels: Record<number, string> = { '-1': '已隐藏', 0: '未翻译', 1: '已翻译', 2: '有疑问', 3: '已检查', 5: '已审核', 9: '已锁定' }
export function tokens(text: string): string[] {
  return text.match(/<\/?[A-Za-z][^>]*>|~\w+\([^)]*\)|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]/g) || []
}
export function displayDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
