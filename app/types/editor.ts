export interface TinyUser { id: number; username: string; nickname?: string; avatar?: string }
export interface OccupyingUser { id: number; username: string; editing: number; editStartedAt: string; editorSessionId: string }
export interface PresenceState {
  projectId: number; status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable'
  editors: OccupyingUser[]; userId: number | null; sessionId: string | null; message: string
}
export interface FileInfo {
  id: number; name: string; project: number; total: number; translated: number
  disputed: number; checked: number; reviewed: number; hidden: number; locked: number; words: number
}
export interface HistoryEntry {
  id?: number; createdAt: string; operation?: string; user?: TinyUser
  translation?: string; stage?: number; field?: string; from?: string; to?: string
  target?: Record<string, unknown> | string; [key: string]: unknown
}
export interface CommentEntry {
  id?: number; createdAt?: string; content?: string; text?: string; user?: TinyUser; uid?: number
}
export interface StringItem {
  id: number; key: string; original: string; translation: string; stage: number
  project: number; fileId?: number; file?: { id: number; name: string; project: number }
  context: string; words: number; createdAt: string; updatedAt: string | null
  history?: HistoryEntry[]; comments?: CommentEntry[]; user?: TinyUser; version?: number
}
export interface StringPage { results: StringItem[]; page: number; pageSize: number; rowCount: number; pageCount: number }
export interface ProjectInfo { id: number; name: string; source: string; dest: string; desc?: string; tagRules?: Array<{type:number;source?:string;string?:string}> }
export interface ProjectSummary { id: number; name: string; permission?: number; privacy?: number }
export interface Suggestion {
  localMatching?: number
  id: number; key: string; original: string; translation: string; matching: number; contains?: number
  project?: { id: number; name: string }; file?: { id: number; name: string }; user?: TinyUser; updatedAt?: string
}
export interface Term { id: number; term: string; translation: string; note?: string | null; pos?: string | null; match?: string[]; variants?: string[] | null; caseSensitive?: boolean; uid?: number; project?: number; updatedAt?: string | null }
export interface TermPage { results: Term[]; page: number; pageSize: number; rowCount: number; pageCount: number }
export interface MemoryEntry {
  id: number; key: string; original: string; translation: string; stage: number
  project: { id: number; name: string }; user?: TinyUser; createdAt: string; updatedAt: string | null
}
export interface MemoryPage {
  results: MemoryEntry[]; page: number; pageSize: number
  rowCount: number | { value: number; relation: string }
}
export interface Draft { translation: string; stage: number; updatedAt: string }
export interface SessionStatus { authenticated: boolean; mode: string; user?: TinyUser | null }
export interface ServiceResult<T = unknown> { ok: boolean; data?: T; status?: number; message?: string }
export type RequestAction = 'session' | 'projects' | 'project' | 'updateProject' | 'files' | 'file' | 'renameFile' | 'strings' | 'string' | 'suggestions' | 'memory' | 'terms' | 'projectTerms' | 'term' | 'createTerm' | 'updateTerm' | 'deleteTerm' | 'history' | 'save' | 'drafts' | 'draft'
export interface DesktopBridge {
  presence(target: { projectId: number; stringId: number | null }): Promise<ServiceResult<PresenceState>>
  loginPresence(project: number): Promise<ServiceResult>
  onPresence(callback: (state: PresenceState) => void): () => void
  request<T = unknown>(action: RequestAction, payload?: Record<string, unknown>): Promise<ServiceResult<T>>
  connect(token: string, remember: boolean, project: number): Promise<ServiceResult<SessionStatus>>
  login(project: number): Promise<ServiceResult<SessionStatus>>
  disconnect(): Promise<ServiceResult>
  openExternal(url: string): Promise<void>
  exportData(content: string, defaultName: string): Promise<boolean>
  window(action: 'minimize' | 'maximize' | 'close'): void
}
declare global { interface Window { scKit?: DesktopBridge } }
