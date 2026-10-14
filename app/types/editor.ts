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
  id?: number; tid?: number; project?: number; createdAt: string; operation?: string; user?: TinyUser
  translation?: string; stage?: number; field?: string; from?: string; to?: string
  target?: Record<string, unknown> | string; [key: string]: unknown
}
export type StringSearchField = 'text' | 'original' | 'translation' | 'key' | 'context'
export type StringSearchOperator = '=' | '@=' | '^=' | '$=' | '~=' | '!=' | '!@=' | '!^=' | '!$=' | '!~='
export interface StringSearchCondition { field: StringSearchField; operator: StringSearchOperator; value: string }
export interface StringFilterUser { id: number; username: string; nickname?: string; avatar?: string }
export interface StringFileLabel { id: number; name: string; color?: string; [key: string]: unknown }
export interface AdvancedStringFilters {
  conditions: StringSearchCondition[]
  filename: string
  fileLabels: StringFileLabel[]
  stages: number[]
  createdAtFrom: string
  createdAtTo: string
  updatedAtFrom: string
  updatedAtTo: string
  lastModifiedScope: '' | 'me' | 'others'
  lastModifiedBy: StringFilterUser[]
  translateBy: StringFilterUser[]
  reviewBy: StringFilterUser[]
  searchInCurrentFile: boolean
  ignoreCase: boolean
  includeHidden: boolean
}
export interface CommentEntry {
  id?: number; createdAt?: string; content?: string; text?: string; user?: TinyUser; uid?: number
}
export interface StringItem {
  id: number; key: string; original: string; translation: string; stage: number
  project: number; fileId?: number; file?: { id: number; name: string; project: number }
  context: string; words: number; createdAt: string; updatedAt: string | null
  history?: HistoryEntry[]; comments?: CommentEntry[]; user?: TinyUser; version?: number
  overwroteConflict?: boolean
}
export interface StringPage { results: StringItem[]; page: number; pageSize: number; rowCount: number; pageCount: number }
export interface ProjectInfo { id: number; name: string; source: string; dest: string; desc?: string; permission?: number; createdAt?: string; version?: string; tagRules?: Array<{type:number;source?:string;string?:string}>; [key: string]: unknown }
export interface ProjectSummary { id: number; name: string; permission?: number; privacy?: number }
export interface Suggestion {
  localMatching?: number; stage?: number
  id: number; key: string; original: string; translation: string; matching: number; contains?: number
  project?: { id: number; name: string }; file?: { id: number; name: string }; user?: TinyUser; updatedAt?: string
}
export interface Term { id: number; term: string; translation: string; note?: string | null; pos?: string | null; match?: string[]; variants?: string[] | null; caseSensitive?: boolean; uid?: number; project?: number; updatedAt?: string | null }
export interface TermPage { results: Term[]; page: number; pageSize: number; rowCount: number; pageCount: number }
export interface CommunityTranslationCandidate {
  id: number; source: string; category: string; candidates: string[]
  topicTitle: string; topicUrl: string; sourceType: '征集' | '投票' | '归档'; updatedAt?: string
}
export interface LocalUnresolvedTerm extends CommunityTranslationCandidate { syncedAt: string }
export interface CommunityTranslationFeed { entries: CommunityTranslationCandidate[]; warnings: string[]; fetchedAt: string; latestModifiedAt?: string; changed?: boolean }
export interface MemoryEntry {
  id: number; key: string; original: string; translation: string; stage: number
  project: { id: number; name: string }; user?: TinyUser; createdAt: string; updatedAt: string | null
}
export interface MemoryPage {
  results: MemoryEntry[]; page: number; pageSize: number
  rowCount: number | { value: number; relation: string }
}
export interface Draft { translation: string; stage: number; updatedAt: string }
export interface SessionStatus { authenticated: boolean; mode: string; user?: TinyUser | null; connectionEpoch?: number }
export interface ServiceResult<T = unknown> { ok: boolean; data?: T; status?: number; message?: string }
export type TranslationProvider = 'google' | 'deepl' | 'llm'
export type TranslationMode = 'web' | 'api'
export type TranslationProxyMode = 'system' | 'direct' | 'http' | 'socks5'
export interface TranslationLlmContextSettings { key: boolean; recommendations: boolean; recommendationCount: number; terms: boolean; notes: boolean }
export interface TranslationSettings {
  provider: TranslationProvider; mode: TranslationMode; deeplPlan: 'free' | 'pro'
  proxy: { mode: TranslationProxyMode; host: string; port: number }
  googleConfigured: boolean; deeplConfigured: boolean
  llmRequestUrl: string; llmModel: string; llmPrompt: string; llmPrefixPrompt: string; llmConfigured: boolean; llmContext: TranslationLlmContextSettings
  clearAfterSaveNext: boolean; useTermTranslations: boolean
}
export interface TranslationSettingsUpdate {
  provider: TranslationProvider; mode: TranslationMode; deeplPlan: 'free' | 'pro'
  proxy: { mode: TranslationProxyMode; host: string; port: number }
  googleApiKey?: string | null; deeplApiKey?: string | null
  clearGoogleApiKey?: boolean; clearDeepLApiKey?: boolean
  llmRequestUrl: string; llmModel: string; llmPrompt: string; llmPrefixPrompt: string; llmApiKey?: string | null; clearLlmApiKey?: boolean
  llmContext: TranslationLlmContextSettings
  clearAfterSaveNext?: boolean; useTermTranslations?: boolean
}
export interface ProxyTestResult {
  proxy: { mode: TranslationProxyMode; host: string; port: number }
  ok: boolean
  results: Array<{ target: string; ok: boolean; status?: number; elapsedMs: number; message?: string }>
}
export interface TranslationSelectionUpdate { provider?: TranslationProvider; mode?: TranslationMode }
export interface McpSettings {
  enabled: boolean; port: number; token: string; defaultPrompt: string
  permissions: { readWorkspace: boolean; allowBackgroundAccess: boolean; syncWithFrontend: boolean; prefillDrafts: boolean; overwriteExistingTranslations: boolean; saveToParaTranz: boolean; saveStages: number[] }
  running: boolean; lifecycle?: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'; url: string; error: string; activeRequests: number; lastRequestAt: string | null
}
export interface McpSettingsUpdate { enabled: boolean; port: number; defaultPrompt: string; permissions: McpSettings['permissions']; rotateToken?: boolean }
export interface McpDraftUpdate { accountId?: number; connectionEpoch?: number; projectId: number; stringId: number; draft: Draft }
export interface McpRemoteSavedUpdate { accountId?: number; connectionEpoch?: number; projectId: number; stringId: number; item: StringItem; draftPresent: boolean; draftCleared: boolean }
export interface TranslationSharedReference {
  recommendations?: Array<{ original: string; translation: string; similarity?: number }>
  terms?: Array<{ term: string; translation: string; note?: string }>
  exemplar?: string
  variantTemplate?: string
}
export interface TranslationPromptContext extends TranslationSharedReference {
  key?: string
  shared?: TranslationSharedReference
  notes?: { entryContext?: string; comments?: string[] }
  // Local cache controls, never included in the provider prompt.
  cacheScope?: string
  bypassCache?: boolean
}
export interface AuxCustomizationOverlayItem { id: string; label: string; checked: boolean; disabled: boolean; first: boolean; last: boolean }
export interface AuxCustomizationOverlayState {
  visible: boolean
  mode?: 'customize' | 'dock'
  bounds: { x: number; y: number; width: number; height: number } | null
  items: AuxCustomizationOverlayItem[]
  theme: Record<string, string>
  draggedPanel?: string | null
  groupId?: string | null
}
export type AuxCustomizationAction =
  | { type: 'close' }
  | { type: 'toggle'; id: string }
  | { type: 'move'; id: string; direction: -1 | 1 }
  | { type: 'reorder'; id: string; targetId: string }
  | { type: 'dock'; panel: string; groupId: string; zone: 'center' | 'left' | 'right' | 'top' | 'bottom' }
export interface LocalFontData { family: string; fullName?: string; postscriptName?: string; style?: string }
export interface CambridgeDictionaryData {
  word: string; url: string; ukPronunciation: string; usPronunciation: string
  entries: Array<{
    headword: string; partOfSpeech: string; grammar: string
    senses: Array<{
      guideWord: string; partOfSpeech: string; grammar: string
      definitions: Array<{
        level: string; definition: string; translation: string
        examples: Array<{ english: string; chinese: string }>
      }>
    }>
  }>
}
export type RequestAction = 'session' | 'projects' | 'project' | 'updateProject' | 'files' | 'fileLabels' | 'file' | 'renameFile' | 'strings' | 'string' | 'suggestions' | 'memory' | 'terms' | 'projectTerms' | 'term' | 'createTerm' | 'updateTerm' | 'deleteTerm' | 'history' | 'projectSection' | 'projectSectionDetail' | 'projectSectionAction' | 'downloadArtifact' | 'userSearch' | 'save' | 'drafts' | 'draft' | 'legacyDrafts' | 'claimLegacyDrafts'
export interface AutoUpdateState { status: 'disabled' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'; version: string; percent: number; downloadUrl?: string }
export interface DesktopBridge {
  presence(target: { projectId: number; stringId: number | null }): Promise<ServiceResult<PresenceState>>
  loginPresence(project: number): Promise<ServiceResult>
  onPresence(callback: (state: PresenceState) => void): () => void
  request<T = unknown>(action: RequestAction, payload?: Record<string, unknown>, requestId?: string): Promise<ServiceResult<T>>
  saveProjectArtifact(projectId: number, filename?: string): Promise<ServiceResult<{ saved: boolean; canceled?: boolean }>>
  cancelRequest(requestId: string): Promise<ServiceResult>
  connect(token: string, remember: boolean, project: number): Promise<ServiceResult<SessionStatus>>
  login(project: number): Promise<ServiceResult<SessionStatus>>
  disconnect(): Promise<ServiceResult>
  lookupCambridge(query: string): Promise<ServiceResult<CambridgeDictionaryData>>
  openCambridgeOriginal(query: string): Promise<void>
  fetchCommunityTranslationCandidates(): Promise<ServiceResult<CommunityTranslationFeed>>
  fetchArchivedTranslationCandidates(): Promise<ServiceResult<CommunityTranslationFeed>>
  auxCustomizationOverlay(state: AuxCustomizationOverlayState): void
  onAuxCustomizationAction(callback: (action: AuxCustomizationAction) => void): () => void
  getTranslationSettings(): Promise<ServiceResult<TranslationSettings>>
  getMcpSettings(): Promise<ServiceResult<McpSettings>>
  saveMcpSettings(settings: McpSettingsUpdate): Promise<ServiceResult<McpSettings>>
  reportMcpWorkspaceContext(context: Record<string, unknown> | null): void
  onMcpDraftUpdated(callback: (update: McpDraftUpdate) => void): () => void
  onMcpRemoteSaved(callback: (update: McpRemoteSavedUpdate) => void): () => void
  testProxy(proxy: TranslationSettingsUpdate['proxy']): Promise<ServiceResult<ProxyTestResult>>
  saveTranslationSettings(settings: TranslationSettingsUpdate): Promise<ServiceResult<TranslationSettings>>
  saveTranslationSelection(selection: TranslationSelectionUpdate): Promise<ServiceResult<TranslationSettings>>
  translateToChinese(text: string, context: TranslationPromptContext | undefined, requestId: string): Promise<ServiceResult<{ text: string; provider: TranslationProvider; localCacheHit?: boolean; elapsedMs?: number; providerCachedInputTokens?: number }>>
  cancelTranslation(requestId: string): Promise<ServiceResult>
  openExternal(url: string): Promise<void>
  translatorView(state: { visible: boolean; bounds: { x: number; y: number; width: number; height: number } | null; provider?: TranslationProvider; text?: string; forceText?: boolean }): void
  exportData(content: string, defaultName: string): Promise<boolean>
  window(action: 'minimize' | 'maximize' | 'close'): void
  onBeforeClose(callback: () => void): () => void
  closeResponse(ok: boolean, message?: string): void
  getBuildInfo(): Promise<{ commit: string; sourceFingerprint: string; builtAt: string } | null>
  getAutoUpdateStatus(): Promise<ServiceResult<AutoUpdateState>>
  checkForUpdates(): Promise<ServiceResult<AutoUpdateState>>
  installUpdate(): Promise<ServiceResult>
  onAutoUpdateStatus(callback: (state: AutoUpdateState) => void): () => void
  onSessionRestored(callback: (result: { ok: boolean; message: string; sessionLost?: boolean }) => void): () => void
}
declare global { interface Window { scKit?: DesktopBridge; queryLocalFonts?: () => Promise<LocalFontData[]> } }
