export type SaveMode = 'next' | 'stay'

export const saveModes: Array<{ id: SaveMode; label: string; description: string; next: boolean; stage?: 2 | 5 }> = [
  { id: 'next', label: '提交并下一条', description: '后台提交并立即打开下一条', next: true },
  { id: 'stay', label: '只保存', description: '后台提交并停留在当前词条', next: false },
]
