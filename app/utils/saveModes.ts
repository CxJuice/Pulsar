export type SaveMode = 'next' | 'disputed' | 'reviewed'

export const saveModes: Array<{ id: SaveMode; label: string; description: string; next: boolean; stage?: 2 | 5 }> = [
  { id: 'next', label: '提交并下一条', description: '后台提交并立即打开下一条', next: true },
  { id: 'disputed', label: '提交并标记为有疑问', description: '后台提交为有疑问并立即打开下一条', next: true, stage: 2 },
  { id: 'reviewed', label: '提交并标记为已审核', description: '后台提交为已审核并立即打开下一条', next: true, stage: 5 },
]
