export type SaveMode = 'stay' | 'next' | 'disputed' | 'reviewed'

export const saveModes: Array<{ id: SaveMode; label: string; description: string; next: boolean; stage?: 2 | 5 }> = [
  { id: 'stay', label: '保存翻译', description: '按左侧状态保存，保持编辑位置', next: false },
  { id: 'next', label: '保存并下一条', description: '按左侧状态保存，成功后打开下一条', next: true },
  { id: 'disputed', label: '保存并标记为有疑问', description: '保存译文并设为有疑问，保持编辑位置', next: false, stage: 2 },
  { id: 'reviewed', label: '保存并标记为已审核', description: '保存译文并设为已审核，保持编辑位置', next: false, stage: 5 },
]
