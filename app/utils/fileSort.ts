import type { FileInfo } from '~/types/editor'

export function fileCompletion(file: FileInfo): number {
  return file.total > 0 ? Math.min(1, Math.max(0, file.translated / file.total)) : 0
}

export function fileCompletionPercent(file: FileInfo): number {
  return file.total > 0 ? Math.floor(Math.min(100, Math.max(0, file.translated * 100 / file.total))) : 0
}

export function sortFilesByCompletion(files: readonly FileInfo[]): FileInfo[] {
  return [...files].sort((a, b) => fileCompletion(a) - fileCompletion(b)
    || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) || a.id - b.id)
}
