import type { AdvancedStringFilters, Draft, FileInfo, HistoryEntry, ProjectInfo, RequestAction, SessionStatus, StringFileLabel, StringItem, StringPage, Suggestion, Term } from '~/types/editor'
import { qualityIssues } from '~/utils/quality'
import { matchSuggestions } from '~/utils/textWorker'
import { toParaTranzText } from '~/utils/translationText'
import { sortFilesByCompletion } from '~/utils/fileSort'
import { EntryAuxCache } from '~/utils/entryAuxCache'
import { ListRequestCoordinator } from '~/utils/listRequestCoordinator'

const emptyProject = (): ProjectInfo => ({ id: 0, name: '', source: '', dest: '' })
const emptyFile = (): FileInfo => ({ id: 0, name: '', project: 0, total: 0, translated: 0, disputed: 0, checked: 0, reviewed: 0, hidden: 0, locked: 0, words: 0 })
const emptyAdvancedFilters = (): AdvancedStringFilters => ({
  conditions: [], filename: '', fileLabels: [], stages: [], createdAtFrom: '', createdAtTo: '', updatedAtFrom: '', updatedAtTo: '',
  lastModifiedScope: '', lastModifiedBy: [], translateBy: [], reviewBy: [], searchInCurrentFile: true, ignoreCase: false, includeHidden: false,
})
function serviceErrorStatus(reason: unknown) {
  return reason && typeof reason === 'object' && 'status' in reason && typeof reason.status === 'number'
    ? reason.status
    : undefined
}
function cloneAdvancedFilters(filters: AdvancedStringFilters): AdvancedStringFilters {
  return { ...filters, conditions: filters.conditions.map(condition => ({ ...condition })), fileLabels: filters.fileLabels.map(label => ({ ...label })), stages: [...filters.stages],
    lastModifiedBy: filters.lastModifiedBy.map(user => ({ ...user })), translateBy: filters.translateBy.map(user => ({ ...user })), reviewBy: filters.reviewBy.map(user => ({ ...user })) }
}
interface Submission {
  id: number; item: StringItem; fileId: number; accountId: number; translation: string; stage: number
}
interface SubmissionFailure extends Submission { message: string }
interface WorkspaceLocation {
  projectId: number
  fileId: number
  stringId?: number
  key?: string
  fileName?: string
  stageFilter: number | null
  search: string
  searchMode: string
  sort: string
  page: number
  pageSize: number
  advancedFilters: AdvancedStringFilters
}
export function useEditor() {
  const desktop = ref(false), connected = ref(false), initializing = ref(true)
  const workspaceReady = ref(false)
  const project = ref<ProjectInfo>(emptyProject()), file = ref<FileInfo>(emptyFile())
  const files = ref<FileInfo[]>([]), items = ref<StringItem[]>([])
  const sortedFiles = computed(() => sortFilesByCompletion(files.value))
  const selected = ref<StringItem | null>(items.value[0] || null)
  const navigationHistory = ref<WorkspaceLocation[]>([])
  const canGoBack = computed(() => navigationHistory.value.length > 0)
  const backNavigationTitle = computed(() => {
    const previous = navigationHistory.value.at(-1)
    if (!previous) return '返回上一个词条和文件'
    const locationName = previous.fileId === 0 ? '全文聚合' : previous.fileName || `文件 ${previous.fileId}`
    return `返回 ${locationName} · ${previous.key || '此前位置'}`
  })
  const text = ref(''), editStage = ref(0), translationDisplayCleared = ref(false), stageFilter = ref<number | null>(0), search = ref(''), searchMode = ref('text')
  const page = ref(1), pageSize = ref(50), pageCount = ref(1), rowCount = ref(0), fileId = ref(0), sort = ref('default')
  const advancedFilters = ref<AdvancedStringFilters>(emptyAdvancedFilters())
  const aggregateMode = computed(() => project.value.id > 0 && fileId.value === 0)
  const allFilesScope = computed(() => aggregateMode.value || (fileId.value > 0 && !advancedFilters.value.searchInCurrentFile))
  const aggregateFile = computed<FileInfo>(() => {
    const summary = { ...emptyFile(), name: '全文聚合', project: project.value.id }
    for (const entry of files.value) {
      summary.total += entry.total; summary.translated += entry.translated
      summary.disputed += entry.disputed; summary.checked += entry.checked; summary.reviewed += entry.reviewed
      summary.hidden += entry.hidden; summary.locked += entry.locked; summary.words += entry.words
    }
    return summary
  })
  watch(aggregateFile, summary => { if (aggregateMode.value) file.value = summary }, { flush: 'sync' })
  function stringFileName(item: StringItem) {
    const sourceFileId = item.fileId || item.file?.id
    return item.file?.name || files.value.find(entry => entry.id === sourceFileId)?.name
      || (sourceFileId ? `文件 ${sourceFileId}` : aggregateMode.value ? '未知文件' : file.value.name)
  }
  function inCurrentScope(item: StringItem, fallbackFileId = fileId.value) {
    return project.value.id === item.project && (allFilesScope.value || fileId.value === (item.fileId || item.file?.id || fallbackFileId))
  }
  function captureWorkspaceLocation(): WorkspaceLocation | null {
    if (!workspaceReady.value || project.value.id <= 0) return null
    const item = selected.value
    const sourceFileId = item?.fileId || item?.file?.id || fileId.value
    const sourceFile = item?.file?.name || files.value.find(entry => entry.id === sourceFileId)?.name || file.value.name
    return {
      projectId: project.value.id,
      // Keep the active scope (including the all-files aggregate) separate from
      // the file that owns the selected string.
      fileId: fileId.value,
      ...(item ? { stringId: item.id, key: item.key } : {}),
      ...(sourceFile ? { fileName: sourceFile } : {}),
      stageFilter: stageFilter.value,
      search: search.value,
      searchMode: searchMode.value,
      sort: sort.value,
      page: page.value,
      pageSize: pageSize.value,
      advancedFilters: cloneAdvancedFilters(advancedFilters.value),
    }
  }
  function rememberWorkspaceLocation(previous: WorkspaceLocation | null, target?: { projectId: number; fileId: number; stringId?: number }) {
    if (!previous) return
    if (target && previous.projectId === target.projectId &&
      (previous.stringId === target.stringId || (!previous.stringId && previous.fileId === target.fileId))) return
    navigationHistory.value = [...navigationHistory.value, previous]
  }
  const listBusy = ref(false), listProgress = ref(''), error = ref(''), notice = ref(''), draftStatus = ref('')
  const pendingSubmissions = ref<Submission[]>([]), submissionFailures = ref<SubmissionFailure[]>([])
  const pendingCount = computed(() => pendingSubmissions.value.length)
  const submissionQueue: Array<{ submission: Submission; persisted: Promise<boolean> }> = []
  const submittedVersions = new Map<string, StringItem>()
  let submissionId = 0, processingSubmissions = false
  const submissionProcessing = ref(false)
  const requestCount = ref(0), reloadBusy = ref(false), exportBusy = ref(false)
  const selectedIds = ref<number[]>([]), drafts = ref<Record<string, Draft>>({})
  const legacyDraftCount = ref(0)
  const panel = ref<'context' | 'suggestions' | 'history' | 'terms' | 'quality' | 'comments' | 'dictionary'>('suggestions')
  const suggestions = ref<Suggestion[]>([]), terms = ref<Term[]>([]), history = ref<HistoryEntry[]>([])
  const auxiliaryCacheVersion = ref(0)
  const termsBusy = ref(false), termsError = ref('')
  const suggestionsBusy = ref(false), suggestionsError = ref(''), historyBusy = ref(false), historyError = ref('')
  const auxBusy = computed(() => panel.value === 'suggestions' ? suggestionsBusy.value : panel.value === 'history' ? historyBusy.value : false)
  const auxError = computed(() => panel.value === 'suggestions' ? suggestionsError.value : panel.value === 'history' ? historyError.value : '')
  const sessionInfo = ref<SessionStatus>({ authenticated: false, mode: 'none' })
  const presenceProjectId = ref(0)
  const presenceLoginBusy = ref(false)
  const presence = reactive(usePresence(presenceProjectId, computed(() => selected.value?.id || null), computed(() => desktop.value && connected.value && sessionInfo.value.authenticated), computed(() => workspaceReady.value && ![9, -1].includes(selected.value?.stage ?? 0))))
  let draftTimer: ReturnType<typeof setTimeout>, searchTimer: ReturnType<typeof setTimeout>
  let listSequence = 0, auxSequence = 0, historySequence = 0, termsSequence = 0, selectionSequence = 0, changing = false, draftGeneration = 0, termsLoaded = false
  let suggestionsLoaded = false, historyLoaded = false, openingString = false, suppressFilterWatch = false
  let suggestionsRequest: { sequence: number; promise: Promise<void> } | undefined
  let historyRequest: { sequence: number; promise: Promise<void> } | undefined
  let termsRequest: { sequence: number; promise: Promise<void> } | undefined
  let draftWrites: Promise<void> = Promise.resolve()
  const detachedNeighbors = shallowRef<{ previousId?: number; nextId?: number; index: number; page: number } | null>(null)
  const termsCache = new EntryAuxCache<Term[]>(), suggestionsCache = new EntryAuxCache<Suggestion[]>(), disputedStringsCache = new EntryAuxCache<StringItem[]>(120_000, 8)
  const clientSortedStringsCache = shallowRef<{ key: string; items: StringItem[] } | null>(null)
  const listRequests = new ListRequestCoordinator(id => { void window.scKit?.cancelRequest?.(id) })
  const globalSortLimit = 20_000
  let updatedSortNeedsRefresh = false
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined, prefetchSequence = 0, disposed = false
  const auxiliaryKey = (item: StringItem) => JSON.stringify([sessionInfo.value.user?.id, sessionInfo.value.mode, item.project, item.id, item.original])
  function reportMcpWorkspaceContext() {
    if (!import.meta.client || !window.scKit) return
    if (disposed || !connected.value || !workspaceReady.value || !sessionInfo.value.authenticated) { window.scKit.reportMcpWorkspaceContext(null); return }
    const item = selected.value
    window.scKit.reportMcpWorkspaceContext({
      accountId: sessionInfo.value.user?.id, connectionEpoch: sessionInfo.value.connectionEpoch,
      project: { id: project.value.id, name: project.value.name },
      file: { id: file.value.id, name: file.value.name },
      selected: item ? {
        id: item.id, key: item.key, original: item.original, translation: item.translation,
        stage: item.stage, context: item.context, updatedAt: item.updatedAt,
        fileId: item.fileId || item.file?.id || file.value.id,
      } : null,
      editorText: text.value,
      editorStage: editStage.value,
      dirty: dirty.value,
      terms: terms.value.map(term => ({ term: term.term, translation: term.translation, note: term.note || '' })),
    })
  }
  function hasAdvancedFilterCriteria() {
    const filters = advancedFilters.value
    return filters.conditions.some(condition => condition.value !== '' || ['@=', '!@='].includes(condition.operator)) ||
      !!filters.filename.trim() || filters.stages.length > 0 || !!filters.createdAtFrom || !!filters.createdAtTo ||
      !!filters.updatedAtFrom || !!filters.updatedAtTo || !!filters.lastModifiedScope || filters.lastModifiedBy.length > 0 ||
      filters.translateBy.length > 0 || filters.reviewBy.length > 0 || filters.ignoreCase || filters.includeHidden ||
      (fileId.value > 0 && !filters.searchInCurrentFile)
  }
  function stringFilterParams(includeSort = true): Array<[string, string]> {
    const filters = advancedFilters.value, params: Array<[string, string]> = []
    for (const condition of filters.conditions) {
      if (!condition.value && !['@=', '!@='].includes(condition.operator)) continue
      params.push([`${condition.field}${condition.operator}`, condition.value])
    }
    if (filters.stages.length) for (const stage of filters.stages) params.push(['stage', String(stage)])
    for (const label of filters.fileLabels) params.push(['fileLabel', String(label.id)])
    for (const user of filters.lastModifiedBy) params.push(['uid', String(user.id)])
    for (const user of filters.translateBy) params.push(['translateBy', String(user.id)])
    for (const user of filters.reviewBy) params.push(['reviewBy', String(user.id)])
    if (filters.lastModifiedScope && sessionInfo.value.user?.id) {
      const id = sessionInfo.value.user.id * (filters.lastModifiedScope === 'others' ? -1 : 1)
      params.push(['uid', String(id)])
    }
    if (filters.filename.trim()) params.push(['filename', filters.filename.trim()])
    const asIsoDate = (value: string) => {
      const timestamp = Date.parse(value)
      return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value
    }
    if (filters.createdAtFrom) params.push(['createdAt>=', asIsoDate(filters.createdAtFrom)])
    if (filters.createdAtTo) params.push(['createdAt<=', asIsoDate(filters.createdAtTo)])
    if (filters.updatedAtFrom) params.push(['updatedAt>=', asIsoDate(filters.updatedAtFrom)])
    if (filters.updatedAtTo) params.push(['updatedAt<=', asIsoDate(filters.updatedAtTo)])
    if (hasAdvancedFilterCriteria()) params.push(['advanced', '1'])
    const mode = (filters.ignoreCase ? 1 : 0) | (filters.includeHidden ? 4 : 0)
    if (mode) params.push(['mode', String(mode)])
    if (includeSort && sort.value === 'key') params.push(['orderBy', 'key'])
    else if (includeSort && sort.value === 'updated') params.push(['orderBy', '-updatedAt'])
    return params
  }
  function lengthStringsQueryKey() {
    return JSON.stringify([project.value.id, fileId.value, stageFilter.value, searchMode.value, search.value, sort.value, advancedFilters.value])
  }
  function updateSortedViewAfterSave(preferSaved = false) {
    if (sort.value === 'key') {
      // A compatibility fallback caches remote pages; refresh their row data after edits.
      clientSortedStringsCache.value = null
    } else if (sort.value === 'updated') {
      // ParaTranz owns updatedAt and the order of ties. Refresh its page after a save.
      clientSortedStringsCache.value = null
      updatedSortNeedsRefresh = true
      if (preferSaved) page.value = 1
    } else if (sort.value === 'length') {
      // A stage change can alter the cached filtered set, so rebuild it on the next page load.
      clientSortedStringsCache.value = null
    }
  }

  function orderedItems(rows: StringItem[]) {
    const result = [...rows]
    if (sort.value === 'length') result.sort((a, b) => b.original.length - a.original.length)
    return result
  }
  const visibleItems = computed(() => orderedItems(items.value))
  function adjacentItem(direction: number) {
    if (!selected.value) return undefined
    const rows = visibleItems.value, at = rows.findIndex(item => item.id === selected.value!.id)
    if (at >= 0) return rows[at + direction]
    const neighbors = detachedNeighbors.value
    if (!neighbors) return direction > 0 ? rows[0] : undefined
    const id = direction > 0 ? neighbors.nextId : neighbors.previousId
    const remembered = rows.find(item => item.id === id)
    if (remembered) return remembered
    if (neighbors.page === page.value) return rows[neighbors.index + (direction > 0 ? 0 : -1)]
    if (direction < 0 && neighbors.page > page.value) return rows.at(-1)
    return undefined
  }
  const nextLocalItem = computed(() => adjacentItem(1))
  const dirty = computed(() => {
    const item = selected.value
    if (!item) return false
    if (translationDisplayCleared.value) return false
    const queued = pendingSubmissions.value.findLast(job => job.item.project === item.project && job.item.id === item.id)
    return toParaTranzText(text.value) !== toParaTranzText(queued?.translation ?? item.translation) || editStage.value !== (queued?.stage ?? item.stage)
  })
  watch(() => [connected.value, workspaceReady.value, sessionInfo.value, project.value.id, project.value.name, file.value.id, file.value.name, selected.value, text.value, editStage.value, dirty.value, terms.value],
    reportMcpWorkspaceContext, { deep: true, flush: 'sync' })
  const locked = computed(() => [9, -1].includes(selected.value?.stage ?? 0))
  const issues = computed(() => selected.value ? qualityIssues(selected.value.original, text.value, selected.value.key, terms.value) : [])
  const untranslated = computed(() => Math.max(0, file.value.total - file.value.translated - file.value.hidden))
  const draftKey = (item = selected.value) => item ? `${item.project}/${item.id}` : ''
  const pendingFor = (item: StringItem) => pendingSubmissions.value.some(job => job.item.project === item.project && job.item.id === item.id)
  function submissionQueued(stage = editStage.value) {
    if (!selected.value) return false
    const latest = pendingSubmissions.value.findLast(job => job.item.project === selected.value!.project && job.item.id === selected.value!.id)
    return !!latest && latest.translation === toParaTranzText(text.value) && latest.stage === stage
  }

  async function api<T>(action: RequestAction, payload: Record<string, unknown> = {}, requestId?: string): Promise<T> {
    const bridge = window.scKit
    if (!bridge) throw new Error('请在 Electron 应用中连接 ParaTranz')
    requestCount.value++
    try {
      const result = await bridge.request<T>(action, payload, requestId)
      if (!result.ok) {
        if (result.status === 401) sessionInfo.value.authenticated = false
        const error = new Error(result.message || '请求失败')
        Object.assign(error, { status: result.status })
        throw error
      }
      const data = result.data
      if (action === 'string' || action === 'save') return normalizeStringItem(data) as T
      const stringPage = data as unknown as StringPage
      if (action === 'strings' && data && typeof data === 'object' && Array.isArray(stringPage.results)) {
        return { ...stringPage, results: stringPage.results.map(normalizeStringItem) } as T
      }
      return data as T
    } finally { requestCount.value-- }
  }
  function normalizeStringItem(value: unknown): StringItem {
    if (!value || typeof value !== 'object') return value as StringItem
    // ParaTranz returns `file` as a numeric ID; the editor uses `fileId` plus
    // an optional expanded file object for display and scope checks.
    const item = value as Record<string, unknown>
    const file = item.file
    const nestedFile = file && typeof file === 'object' ? file as Record<string, unknown> : null
    const candidates = [item.fileId, typeof file === 'number' ? file : undefined, nestedFile?.id]
    const sourceFileId = candidates.find(candidate => typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0)
    return {
      ...item,
      ...(typeof sourceFileId === 'number' ? { fileId: sourceFileId } : {}),
      ...(typeof file === 'number' ? { file: undefined } : {}),
    } as unknown as StringItem
  }
  function stopListRequests() {
    listRequests.cancelAll()
  }
  async function listPage(payload: Record<string, unknown>, includeSort = true): Promise<StringPage> {
    return listRequests.run(id => api<StringPage>('strings', {
      ...payload, filterParams: stringFilterParams(includeSort), searchInCurrentFile: advancedFilters.value.searchInCurrentFile,
    }, id))
  }
  function remoteStringPageSize(page: StringPage, requestedPageSize: number) {
    return Number.isInteger(page.pageSize) && page.pageSize > 0
      ? Math.min(page.pageSize, 800)
      : requestedPageSize
  }
  function remoteStringPageCount(page: StringPage, requestedPageSize: number) {
    return Math.max(1, Math.ceil(Math.max(0, page.rowCount) / remoteStringPageSize(page, requestedPageSize)))
  }
  function sortFetchedStrings(rows: StringItem[], mode: string) {
    const result = [...rows]
    if (mode === 'key') return result.sort((a, b) => a.key.localeCompare(b.key) || a.id - b.id)
    if (mode === 'updated') return result.sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0) || b.id - a.id)
    return result.sort((a, b) => b.original.length - a.original.length)
  }
  async function loadClientSortedFallback(sequence: number, preferredId?: number, retainedSelection?: StringItem, edge: 'first' | 'last' = 'first', clearTranslation = false) {
    const query = { projectId: project.value.id, fileId: fileId.value, pageSize: 800, stage: stageFilter.value, text: search.value, searchMode: searchMode.value }
    const first = await listPage({ ...query, page: 1 }, false)
    if (sequence !== listSequence) return
    const remotePageCount = remoteStringPageCount(first, query.pageSize)
    if (!allFilesScope.value && first.rowCount > globalSortLimit) {
      throw new Error(`单文件全局排序最多处理 ${globalSortLimit.toLocaleString()} 条词条；请先按状态或搜索缩小范围。`)
    }
    listProgress.value = `已读取 1 / ${remotePageCount} 页，正在兼容排序方式`
    const fetched = new Map(first.results.map(item => [item.id, item]))
    for (let currentPage = 2; currentPage <= remotePageCount; currentPage++) {
      const data = await listPage({ ...query, page: currentPage }, false)
      if (sequence !== listSequence) return
      for (const item of data.results) fetched.set(item.id, item)
      listProgress.value = `已读取 ${currentPage} / ${remotePageCount} 页，正在整理排序`
    }
    const all = sortFetchedStrings([...fetched.values()], sort.value)
    clientSortedStringsCache.value = { key: lengthStringsQueryKey(), items: all }
    rowCount.value = all.length
    pageCount.value = Math.max(1, Math.ceil(rowCount.value / pageSize.value))
    if (retainedSelection) {
      const index = all.findIndex(item => item.id === retainedSelection.id && item.project === retainedSelection.project)
      if (index >= 0) page.value = Math.floor(index / pageSize.value) + 1
      else notice.value = '当前筛选结果不包含此前选中的词条。'
    }
    page.value = Math.max(1, Math.min(page.value, pageCount.value))
    items.value = all.slice((page.value - 1) * pageSize.value, page.value * pageSize.value)
    if (sort.value === 'updated') updatedSortNeedsRefresh = false
    const rows = visibleItems.value
    choose(rows.find(item => item.id === preferredId) || (edge === 'last' ? rows.at(-1) : rows[0]) || null, clearTranslation)
  }
  function choose(item: StringItem | null, clearTranslation = false) {
    ++selectionSequence
    detachedNeighbors.value = null
    changing = true
    translationDisplayCleared.value = false
    selected.value = item
    const draft = item ? drafts.value[draftKey(item)] : undefined
    // An empty local draft must not hide a translation that still exists remotely.
    // Keep the draft intact, but load the remote value as the editor baseline.
    const blankDraft = !!draft && !draft.translation.trim()
    const blankDraftWithRemoteTranslation = blankDraft && !!item?.translation.trim()
    const visibleDraft = blankDraft ? undefined : draft
    text.value = toParaTranzText(visibleDraft?.translation ?? item?.translation ?? '')
    editStage.value = visibleDraft?.stage ?? item?.stage ?? 0
    // A stage-0 list row can omit its translation; confirm blank entries by ID
    // before treating the editor as empty or allowing a blank submission.
    if (item && item.stage === 0 && connected.value && sessionInfo.value.authenticated && !text.value.trim()) {
      translationDisplayCleared.value = true
      draftStatus.value = '正在核对远端译文…'
      void confirmBlankUntranslatedItem(item, selectionSequence)
    // Clearing after submit must not hide the next entry's translation or prefilled draft.
    } else if (clearTranslation && item && !draft && !text.value) {
      text.value = ''
      translationDisplayCleared.value = true
      draftStatus.value = '译文框已清空'
    } else draftStatus.value = blankDraftWithRemoteTranslation
      ? '已显示远端译文（本地空草稿仍保留）'
      : draft ? '已恢复本地草稿' : ''
    changing = false
    scheduleAux()
    scheduleTerms()
  }
  async function confirmBlankUntranslatedItem(item: StringItem, sequence: number) {
    try {
      const latest = await api<StringItem>('string', { projectId: item.project, stringId: item.id })
      if (sequence !== selectionSequence || selected.value?.project !== item.project || selected.value.id !== item.id) return

      const index = items.value.findIndex(row => row.project === latest.project && row.id === latest.id)
      if (index >= 0) items.value[index] = latest
      selected.value = latest

      // Keep any typing the user started while the verification request was in flight.
      if (!translationDisplayCleared.value || text.value.trim()) return
      const draft = drafts.value[draftKey(latest)]
      const blankDraft = !!draft && !draft.translation.trim()
      const visibleDraft = blankDraft ? undefined : draft
      changing = true
      text.value = toParaTranzText(visibleDraft?.translation ?? latest.translation ?? '')
      editStage.value = visibleDraft?.stage ?? latest.stage ?? 0
      translationDisplayCleared.value = !text.value.trim()
      draftStatus.value = text.value.trim()
        ? blankDraft ? '已显示远端译文（本地空草稿仍保留）' : visibleDraft ? '已恢复本地草稿' : '已加载远端译文'
        : '远端译文为空；译文框已清空'
      changing = false
    } catch {
      if (sequence === selectionSequence && selected.value?.project === item.project && selected.value.id === item.id && translationDisplayCleared.value) {
        draftStatus.value = '远端译文读取失败，已阻止空提交'
      }
    } finally {
      changing = false
    }
  }
  function restoreClearedTranslation() {
    const item = selected.value
    if (!translationDisplayCleared.value || !item) return
    changing = true
    translationDisplayCleared.value = false
    const draft = drafts.value[draftKey(item)]
    text.value = toParaTranzText(draft?.translation ?? item.translation ?? '')
    editStage.value = draft?.stage ?? item.stage ?? 0
    draftStatus.value = draft ? '已恢复本地草稿' : ''
    changing = false
  }
  async function persistDraft(item: StringItem, translation: string, stage: number, remove = false) {
    translation = toParaTranzText(translation)
    const accountId = sessionInfo.value.user?.id
    if (!accountId) { draftStatus.value = '草稿保存失败：请先登录'; return false }
    const key = draftKey(item)
    const generation = ++draftGeneration
    const draft = { translation, stage, updatedAt: new Date().toISOString() }
    const previousDraft = drafts.value[key]
    if (remove) delete drafts.value[key]; else drafts.value[key] = draft
    try {
      const write = async () => { await api('draft', { accountId, projectId: item.project, stringId: item.id, ...draft, remove }) }
      const pending = draftWrites.then(write, write)
      draftWrites = pending.catch(() => {})
      await pending
      if (generation === draftGeneration && selected.value?.id === item.id) draftStatus.value = remove ? '' : '草稿已保存到本地'
      return true
    } catch (reason) {
      if (generation === draftGeneration) {
        if (previousDraft) drafts.value[key] = previousDraft
        else delete drafts.value[key]
        if (selected.value?.project === item.project && selected.value.id === item.id) draftStatus.value = `草稿保存失败：${(reason as Error).message}`
      }
      return false
    }
  }
  async function savePrefillDraft(item: StringItem, translation: string, expectedDraftVersion?: string | null) {
    const normalized = toParaTranzText(translation), current = selected.value?.project === item.project && selected.value.id === item.id
    if (expectedDraftVersion !== undefined &&
      ((drafts.value[draftKey(item)]?.updatedAt ?? null) !== expectedDraftVersion ||
        (current && dirty.value) || !!item.translation.trim())) {
      throw new Error('翻译期间已有新的人工编辑或草稿，已跳过此词条')
    }
    const wasClean = current && !dirty.value
    if (!await persistDraft(item, normalized, 0)) throw new Error(draftStatus.value || '本机草稿保存失败')
    if (wasClean && selected.value?.project === item.project && selected.value.id === item.id && !dirty.value) {
      changing = true
      translationDisplayCleared.value = false
      text.value = normalized
      editStage.value = 0
      changing = false
    }
  }
  async function savePrefillToParaTranz(item: StringItem, translation: string, expectedDraftVersion?: string | null) {
    if (!connected.value || !sessionInfo.value.authenticated) throw new Error('请先登录 ParaTranz')
    if ([9, -1].includes(item.stage)) throw new Error('此词条已锁定，无法保存')
    const accountId = sessionInfo.value.user?.id
    if (!accountId) throw new Error('请重新登录后提交')
    const normalized = toParaTranzText(translation)
    await savePrefillDraft(item, normalized, expectedDraftVersion)
    const saved = await api<StringItem>('save', { projectId: item.project, stringId: item.id, translation: normalized, stage: 0,
      expectedUserId: accountId, expectedUpdatedAt: item.updatedAt ?? null, expectedTranslation: item.translation,
      expectedStage: item.stage, expectedOriginal: item.original })
    const key = draftKey(item), sameSelection = selected.value?.project === item.project && selected.value.id === item.id
    if (inCurrentScope(item)) {
      const priorVisible = visibleItems.value
      const priorVisibleIndex = priorVisible.findIndex(row => row.project === item.project && row.id === item.id)
      if (sameSelection && stageFilter.value !== null && saved.stage !== stageFilter.value && priorVisibleIndex >= 0) {
        detachedNeighbors.value = { previousId: priorVisible[priorVisibleIndex - 1]?.id, nextId: priorVisible[priorVisibleIndex + 1]?.id, index: priorVisibleIndex, page: page.value }
      }
      updateSortedViewAfterSave(sameSelection)
      const index = items.value.findIndex(row => row.project === item.project && row.id === item.id)
      const visibleIndex = visibleItems.value.findIndex(row => row.project === item.project && row.id === item.id)
      if (index >= 0) {
        if (stageFilter.value !== null && saved.stage !== stageFilter.value) {
          if (sameSelection) detachedNeighbors.value = { previousId: visibleItems.value[visibleIndex - 1]?.id, nextId: visibleItems.value[visibleIndex + 1]?.id, index: visibleIndex, page: page.value }
          items.value.splice(index, 1)
          rowCount.value = Math.max(0, rowCount.value - 1)
          pageCount.value = Math.max(1, Math.ceil(rowCount.value / pageSize.value))
        } else items.value[index] = saved
      }
    }
    if (sameSelection) {
      const newerInput = toParaTranzText(text.value) !== normalized || editStage.value !== 0
      selected.value = saved
      if (newerInput) await persistDraft(saved, text.value, editStage.value)
      else {
        changing = true
        translationDisplayCleared.value = false
        text.value = normalized
        editStage.value = 0
        changing = false
        if (drafts.value[key]?.translation === normalized) await persistDraft(saved, '', 0, true)
      }
    } else if (drafts.value[key]?.translation === normalized) await persistDraft(saved, '', 0, true)
    if (updatedSortNeedsRefresh && sort.value === 'updated') {
      updatedSortNeedsRefresh = false
      await loadStrings(selected.value?.id)
    }
    return saved
  }
  async function flushDraft(strict = false) {
    clearTimeout(draftTimer)
    if (!selected.value) return
    if (translationDisplayCleared.value) { await draftWrites; return }
    let persisted = true
    if (dirty.value || pendingFor(selected.value)) persisted = await persistDraft(selected.value, text.value, editStage.value)
    else if (drafts.value[draftKey()] && !pendingFor(selected.value)) persisted = await persistDraft(selected.value, '', 0, true)
    await draftWrites
    if (strict && !persisted) throw new Error(draftStatus.value)
  }
  async function select(item: StringItem, clearTranslation = false) {
    if (listBusy.value || initializing.value || reloadBusy.value || selected.value?.id === item.id) return
    const sequence = ++selectionSequence
    try { await flushDraft(true) } catch (reason) { error.value = (reason as Error).message; return }
    if (sequence !== selectionSequence || listBusy.value || initializing.value || reloadBusy.value) return
    choose(item, clearTranslation)
  }
  function input(value: string) {
    if (listBusy.value || initializing.value || reloadBusy.value || locked.value) return
    translationDisplayCleared.value = false
    text.value = toParaTranzText(value)
    if (editStage.value === 0 && value.trim()) editStage.value = 1
    if (editStage.value === 1 && !value.trim()) editStage.value = 0
  }
  watch([text, editStage], () => {
    if (changing || !selected.value || translationDisplayCleared.value) return
    clearTimeout(draftTimer)
    const item = selected.value, translation = text.value, stage = editStage.value
    if (dirty.value || pendingFor(item)) {
      draftStatus.value = '正在保存草稿…'
      draftTimer = setTimeout(() => persistDraft(item, translation, stage), 450)
    } else if (drafts.value[draftKey(item)] && !pendingFor(item)) {
      draftTimer = setTimeout(() => persistDraft(item, '', 0, true), 450)
    } else draftStatus.value = ''
  }, { flush: 'sync' })

  async function loadStrings(preferredId?: number, retainedSelection?: StringItem, edge: 'first' | 'last' = 'first', clearTranslation = false, force = true) {
    const sequence = ++listSequence
    stopListRequests()
    listBusy.value = false; listProgress.value = ''
    try { await flushDraft(true) } catch (reason) { error.value = (reason as Error).message; return }
    if (!connected.value || sequence !== listSequence) return
    listBusy.value = true; listProgress.value = ''; error.value = ''; selectedIds.value = []
    try {
      if (sort.value === 'length' || (!force && clientSortedStringsCache.value?.key === lengthStringsQueryKey())) {
        const key = lengthStringsQueryKey()
        let all = !force && clientSortedStringsCache.value?.key === key ? clientSortedStringsCache.value.items : undefined
        if (!all) {
          // ParaTranz has no original-length sort, so collect the filtered result and sort it locally.
          clientSortedStringsCache.value = null
          const remotePageSize = 800
          const query = { projectId: project.value.id, fileId: fileId.value, pageSize: remotePageSize, stage: stageFilter.value, text: search.value, searchMode: searchMode.value }
          const first = await listPage({ ...query, page: 1 })
          if (sequence !== listSequence) return
          const remotePageCount = remoteStringPageCount(first, remotePageSize)
          if (!allFilesScope.value && first.rowCount > globalSortLimit) {
            throw new Error(`单文件全局排序最多处理 ${globalSortLimit.toLocaleString()} 条词条；请先按状态或搜索缩小范围。`)
          }
          listProgress.value = `已读取 1 / ${remotePageCount} 页，正在按原文长度排序`
          const fetched = new Map(first.results.map(item => [item.id, item]))
          for (let currentPage = 2; currentPage <= remotePageCount; currentPage++) {
            const data = await listPage({ ...query, page: currentPage })
            if (sequence !== listSequence) return
            for (const item of data.results) fetched.set(item.id, item)
            listProgress.value = `已读取 ${currentPage} / ${remotePageCount} 页，正在整理排序`
          }
          all = sortFetchedStrings([...fetched.values()], sort.value)
          clientSortedStringsCache.value = { key, items: all }
        }
        if (sequence !== listSequence) return
        rowCount.value = all.length
        pageCount.value = Math.max(1, Math.ceil(rowCount.value / pageSize.value))
        if (retainedSelection) {
          const index = all.findIndex(item => item.id === retainedSelection.id && item.project === retainedSelection.project)
          if (index >= 0) page.value = Math.floor(index / pageSize.value) + 1
          else notice.value = '当前筛选结果不包含此前选中的词条。'
        }
        page.value = Math.max(1, Math.min(page.value, pageCount.value))
        items.value = all.slice((page.value - 1) * pageSize.value, page.value * pageSize.value)
      } else {
        if (retainedSelection) {
          const query = { projectId: project.value.id, fileId: fileId.value, pageSize: 800, stage: stageFilter.value, text: search.value, searchMode: searchMode.value }
          const first = await listPage({ ...query, page: 1 })
          if (sequence !== listSequence) return
          if (!allFilesScope.value && first.rowCount > globalSortLimit) throw new Error(`定位原选中词条需要扫描超过 ${globalSortLimit.toLocaleString()} 条记录；请先缩小筛选范围。`)
          const remotePageCount = remoteStringPageCount(first, query.pageSize)
          const actualRemotePageSize = remoteStringPageSize(first, query.pageSize)
          let index = first.results.findIndex(item => item.id === retainedSelection.id && item.project === retainedSelection.project)
          for (let remotePage = 2; index < 0 && remotePage <= remotePageCount; remotePage++) {
            const data = await listPage({ ...query, page: remotePage })
            if (sequence !== listSequence) return
            listProgress.value = `正在定位所选词条：${remotePage} / ${remotePageCount} 页`
            const match = data.results.findIndex(item => item.id === retainedSelection.id && item.project === retainedSelection.project)
            if (match >= 0) index = (remotePage - 1) * actualRemotePageSize + match
          }
          if (index >= 0) page.value = Math.floor(index / pageSize.value) + 1
          else notice.value = '当前筛选结果不包含此前选中的词条。'
        }
        const data = await listPage({ projectId: project.value.id, fileId: fileId.value, page: page.value, pageSize: pageSize.value, stage: stageFilter.value, text: search.value, searchMode: searchMode.value })
        if (sequence !== listSequence) return
        items.value = data.results; rowCount.value = data.rowCount; pageCount.value = Math.max(1, data.pageCount); page.value = data.page
      }
      if (sort.value === 'updated') updatedSortNeedsRefresh = false
      const rows = visibleItems.value
      choose(rows.find(item => item.id === preferredId) || (edge === 'last' ? rows.at(-1) : rows[0]) || null, clearTranslation)
    } catch (reason) {
      if (sequence === listSequence && serviceErrorStatus(reason) === 405 && ['key', 'updated'].includes(sort.value)) {
        try { await loadClientSortedFallback(sequence, preferredId, retainedSelection, edge, clearTranslation) }
        catch (fallbackReason) { if (sequence === listSequence) error.value = (fallbackReason as Error).message }
      } else if (sequence === listSequence) error.value = (reason as Error).message
    }
    finally { if (sequence === listSequence) { listBusy.value = false; listProgress.value = '' } }
  }
  function cancelListLoad(silent = false) {
    if (!listBusy.value) return
    ++listSequence
    stopListRequests()
    listBusy.value = false
    listProgress.value = ''
    notice.value = silent ? '' : '已停止加载词条列表。'
  }
  async function bootstrap(projectId: number, newFileId: number, query?: { text: string; searchMode: 'key' | 'original'; item?: StringItem }) {
    if (!sessionInfo.value.authenticated || initializing.value && connected.value) return
    try { await flushDraft(true) } catch (reason) { error.value = (reason as Error).message; return }
    clearAuxiliaryCache()
    clientSortedStringsCache.value = null
    initializing.value = true; error.value = ''
    try {
      const accountId = sessionInfo.value.user?.id
      const [newProject, newFiles, localDrafts, legacy] = await Promise.all([
        api<ProjectInfo>('project', { projectId }), api<FileInfo[]>('files', { projectId }),
        api<Record<string, Draft>>('drafts', { accountId }), api<{ count: number }>('legacyDrafts', { accountId, projectId }),
      ])
      if (!newFiles.length) throw new Error('项目中没有可翻译的文件')
      if (query?.item && !newFiles.some(entry => entry.id === newFileId)) throw new Error('目标文件不可用，无法定位词条')
      project.value = newProject; files.value = newFiles; drafts.value = localDrafts; legacyDraftCount.value = legacy.count
      advancedFilters.value = emptyAdvancedFilters()
      file.value = newFileId === 0 ? aggregateFile.value : newFiles.find(entry => entry.id === newFileId) || newFiles[0]!
      fileId.value = file.value.id; connected.value = true; choose(null); page.value = 1
      if (aggregateMode.value) stageFilter.value = null
      clearTimeout(searchTimer); search.value = query?.text || ''; selectedIds.value = []
      if (query) { searchMode.value = query.searchMode; stageFilter.value = null }
      localStorage.setItem('sckit-workspace', JSON.stringify({ projectId, fileId: file.value.id }))
      await loadStrings(query?.item?.id, query?.item)
      workspaceReady.value = !error.value
    } catch (reason) { error.value = (reason as Error).message }
    finally { initializing.value = false }
  }
  async function changeFile(id: number, recordHistory = true) {
    if (initializing.value || listBusy.value || id === fileId.value || (id !== 0 && !files.value.some(entry => entry.id === id))) return
    const previousLocation = recordHistory ? captureWorkspaceLocation() : null
    error.value = ''
    try { await flushDraft(true) } catch (reason) { error.value = (reason as Error).message; return }
    clientSortedStringsCache.value = null; fileId.value = id; file.value = id === 0 ? aggregateFile.value : files.value.find(entry => entry.id === id) || file.value
    if (aggregateMode.value) stageFilter.value = null
    page.value = 1; await loadStrings()
    if (error.value) return
    rememberWorkspaceLocation(previousLocation, { projectId: project.value.id, fileId: id })
    localStorage.setItem('sckit-workspace', JSON.stringify({ projectId: project.value.id, fileId: id }))
  }
  async function openFile(projectId: number, id: number, recordHistory = true) {
    if (initializing.value || listBusy.value || reloadBusy.value) return false
    if (!connected.value || !sessionInfo.value.authenticated) throw new Error('请先登录 ParaTranz')
    if (workspaceReady.value && project.value.id === projectId && fileId.value === id) return true
    const previousLocation = recordHistory ? captureWorkspaceLocation() : null
    error.value = ''
    if (workspaceReady.value && project.value.id === projectId) await changeFile(id, false)
    else await bootstrap(projectId, id)
    if (error.value) throw new Error(error.value)
    if (!workspaceReady.value || project.value.id !== projectId || fileId.value !== id) return false
    rememberWorkspaceLocation(previousLocation, { projectId, fileId: id })
    return true
  }
  async function refreshFiles() {
    if (!connected.value) return
    const projectId = project.value.id
    const refreshed = await api<FileInfo[]>('files', { projectId })
    if (project.value.id !== projectId) return
    files.value = refreshed
    file.value = aggregateMode.value ? aggregateFile.value : refreshed.find(entry => entry.id === fileId.value) || file.value
  }
  async function openString(projectId: number, stringId: number, recordHistory = true) {
    if (initializing.value || listBusy.value || reloadBusy.value) return false
    if (!connected.value || !sessionInfo.value.authenticated) throw new Error('请先登录 ParaTranz')
    const previousLocation = recordHistory ? captureWorkspaceLocation() : null
    reloadBusy.value = true; openingString = true; error.value = ''; notice.value = ''
    advancedFilters.value = emptyAdvancedFilters()
    clearTimeout(searchTimer)
    try {
      const item = await api<StringItem>('string', { projectId, stringId })
      if (!item || item.id !== stringId || item.project !== projectId) throw new Error('未找到目标词条')
      const targetFileId = item.fileId || item.file?.id
      if (!targetFileId) throw new Error('目标词条缺少文件信息，无法定位')
      await flushDraft(true)
      if (!workspaceReady.value || project.value.id !== projectId) {
        await bootstrap(projectId, targetFileId, { text: item.key, searchMode: 'key', item })
        if (error.value) throw new Error(error.value)
      }
      const targetFile = files.value.find(entry => entry.id === targetFileId)
      if (!targetFile) throw new Error('目标文件不可用，无法定位词条')
      fileId.value = targetFileId; file.value = targetFile
      clientSortedStringsCache.value = null
      // Search by key so a jump does not need to scan every page of a large file.
      stageFilter.value = null; searchMode.value = 'key'; search.value = item.key; page.value = 1
      await nextTick()
      await loadStrings(item.id, item)
      if (error.value) throw new Error(error.value)
      choose(item)
      rememberWorkspaceLocation(previousLocation, { projectId, fileId: targetFileId, stringId: item.id })
      localStorage.setItem('sckit-workspace', JSON.stringify({ projectId, fileId: targetFileId }))
      return true
    } finally { openingString = false; reloadBusy.value = false }
  }
  async function openOccurrences(projectId: number, original: string) {
    if (initializing.value || listBusy.value || reloadBusy.value) return false
    if (!connected.value || !sessionInfo.value.authenticated) throw new Error('请先登录 ParaTranz')
    const query = original.trim()
    if (!query) throw new Error('请输入要查询的原文')
    if (new TextEncoder().encode(query).length > 1000) throw new Error('原文过长，请选择较短的片段查询（最多 1000 UTF-8 字节）')
    const previousLocation = captureWorkspaceLocation()
    reloadBusy.value = true; openingString = true; error.value = ''; notice.value = ''
    clearTimeout(searchTimer)
    try {
      await flushDraft(true)
      sort.value = 'default'
      advancedFilters.value = emptyAdvancedFilters()
      await nextTick()
      if (!workspaceReady.value || project.value.id !== projectId) {
        await bootstrap(projectId, 0, { text: query, searchMode: 'original' })
      } else {
        clientSortedStringsCache.value = null
        fileId.value = 0; file.value = aggregateFile.value
        stageFilter.value = null; searchMode.value = 'original'; search.value = query; page.value = 1
        await nextTick()
        await loadStrings()
      }
      if (error.value) throw new Error(error.value)
      rememberWorkspaceLocation(previousLocation)
      localStorage.setItem('sckit-workspace', JSON.stringify({ projectId, fileId: 0 }))
      return true
    } finally { openingString = false; reloadBusy.value = false }
  }
  async function goBack() {
    const previous = navigationHistory.value.at(-1)
    if (!previous || initializing.value || listBusy.value || reloadBusy.value) return false
    let retained: StringItem | undefined
    let restored = false
    if (previous.stringId) {
      restored = await openString(previous.projectId, previous.stringId, false)
      retained = selected.value || undefined
    } else {
      restored = await openFile(previous.projectId, previous.fileId, false)
    }
    if (restored) {
      // Opening a linked string uses a temporary key search. Restore the exact
      // view the user came from before loading its original result page.
      openingString = true
      try {
        clearTimeout(searchTimer)
        error.value = ''
        fileId.value = previous.fileId
        file.value = previous.fileId === 0
          ? aggregateFile.value
          : files.value.find(entry => entry.id === previous.fileId) || file.value
        stageFilter.value = previous.stageFilter
        searchMode.value = previous.searchMode
        search.value = previous.search
        sort.value = previous.sort
        pageSize.value = previous.pageSize
        page.value = previous.page
        advancedFilters.value = cloneAdvancedFilters(previous.advancedFilters)
        clientSortedStringsCache.value = null
        await nextTick()
        await loadStrings(previous.stringId, retained)
        restored = project.value.id === previous.projectId && fileId.value === previous.fileId && !error.value
      } finally { openingString = false }
      if (restored) localStorage.setItem('sckit-workspace', JSON.stringify({ projectId: previous.projectId, fileId: previous.fileId }))
    }
    if (restored) navigationHistory.value = navigationHistory.value.slice(0, -1)
    return restored
  }
  function filter(stage: number | null) { advancedFilters.value.stages = []; stageFilter.value = stage; page.value = 1; loadStrings() }
  function applyAdvancedFilters(filters: AdvancedStringFilters, nextSort = sort.value) {
    advancedFilters.value = cloneAdvancedFilters(filters)
    stageFilter.value = null
    const sortChanged = sort.value !== nextSort
    sort.value = nextSort
    page.value = 1
    clientSortedStringsCache.value = null
    if (!sortChanged) void loadStrings()
  }
  function clearFilters() {
    clearTimeout(searchTimer)
    suppressFilterWatch = true
    search.value = ''; searchMode.value = 'text'; stageFilter.value = null
    advancedFilters.value = emptyAdvancedFilters(); sort.value = 'default'; page.value = 1
    clientSortedStringsCache.value = null
    void nextTick(() => { suppressFilterWatch = false; void loadStrings(selected.value?.id) })
  }
  watch([search, searchMode], (_value, previous) => {
    clearTimeout(searchTimer)
    if (initializing.value || openingString || suppressFilterWatch) return
    if (listBusy.value) cancelListLoad(true)
    const preserve = !search.value.trim() && !!previous?.[0] ? selected.value || undefined : undefined
    searchTimer = setTimeout(() => { page.value = 1; void loadStrings(preserve?.id, preserve) }, 350)
  })
  watch(sort, () => { if (openingString || suppressFilterWatch) return; page.value = 1; void loadStrings(selected.value?.id) })
  async function paginate(newPage: number, edge: 'first' | 'last' = 'first', clearTranslation = false) { if (listBusy.value) return; page.value = Math.max(1, Math.min(newPage, pageCount.value)); await loadStrings(undefined, undefined, edge, clearTranslation, false) }
  async function changePageSize(size: number) { pageSize.value = size; page.value = 1; await loadStrings(undefined, undefined, 'first', false, false) }

  async function loadTerms(force = false): Promise<void> {
    if (force) { auxiliaryCacheVersion.value++; termsCache.clear(); ++termsSequence; termsLoaded = false; termsRequest = undefined }
    const item = selected.value, sequence = termsSequence
    if (!item || !connected.value) { termsBusy.value = false; return }
    if (termsRequest?.sequence === sequence) return termsRequest.promise
    if (termsLoaded && !force) return
    const key = auxiliaryKey(item), cached = termsCache.read(key)
    if (cached !== undefined) { terms.value = cached; termsLoaded = true; termsBusy.value = false; termsError.value = ''; return }
    termsBusy.value = true; termsError.value = ''
    const promise = (async () => {
      try {
        const data = await termsCache.load(key, () => api<Term[]>('terms', { projectId: item.project, stringId: item.id }))
        if (sequence === termsSequence) { terms.value = data; termsLoaded = true }
      } catch (reason) { if (sequence === termsSequence) termsError.value = (reason as Error).message }
      finally { if (sequence === termsSequence) { termsBusy.value = false; termsRequest = undefined } }
    })()
    termsRequest = { sequence, promise }
    await promise
    if (termsRequest?.sequence === sequence) termsRequest = undefined
    if (force) scheduleNextPrefetch()
  }
  function termsFor(item: StringItem): Promise<Term[]> {
    return termsCache.load(auxiliaryKey(item), () => api<Term[]>('terms', { projectId: item.project, stringId: item.id }))
  }
  function scheduleTerms() {
    ++termsSequence
    terms.value = []; termsError.value = ''; termsLoaded = false; termsRequest = undefined
    termsBusy.value = !!selected.value
    if (selected.value) void loadTerms()
  }
  async function loadSuggestions(force = false): Promise<void> {
    if (force) { auxiliaryCacheVersion.value++; suggestionsCache.clear(); ++auxSequence; suggestionsLoaded = false; suggestionsRequest = undefined }
    const item = selected.value, sequence = auxSequence
    if (!item || !connected.value) return
    if (suggestionsRequest?.sequence === sequence) return suggestionsRequest.promise
    if (suggestionsLoaded) return
    const key = auxiliaryKey(item), cached = suggestionsCache.read(key)
    if (cached !== undefined) { suggestions.value = cached; suggestionsLoaded = true; suggestionsBusy.value = false; suggestionsError.value = ''; return }
    suggestionsBusy.value = true; suggestionsError.value = ''
    const promise = (async () => {
      try {
        const matched = await suggestionsCache.load(key, () => fetchSuggestions(item))
        if (sequence === auxSequence) { suggestions.value = matched; suggestionsLoaded = true }
      } catch (reason) { if (sequence === auxSequence) suggestionsError.value = (reason as Error).message }
      finally { if (sequence === auxSequence) { suggestionsBusy.value = false; suggestionsRequest = undefined } }
    })()
    suggestionsRequest = { sequence, promise }
    await promise
    if (suggestionsRequest?.sequence === sequence) suggestionsRequest = undefined
    if (force) scheduleNextPrefetch()
  }
  function suggestionsFor(item: StringItem): Promise<Suggestion[]> {
    return suggestionsCache.load(auxiliaryKey(item), () => fetchSuggestions(item))
  }
  async function fetchSuggestions(item: StringItem) {
    const [data, disputed] = await Promise.all([
      api<Suggestion[]>('suggestions', { projectId: item.project, stringId: item.id }),
      fetchDisputedStrings(item).catch(() => []),
    ])
    const candidates = new Map(data.map(suggestion => [suggestion.id, suggestion]))
    for (const entry of disputed) {
      if (entry.id === item.id || !entry.translation.trim()) continue
      const existing = candidates.get(entry.id)
      candidates.set(entry.id, existing ? { ...existing, stage: 2 } : {
        id: entry.id, key: entry.key, original: entry.original, translation: entry.translation,
        matching: 0, stage: 2, project: { id: entry.project, name: project.value.name },
        file: entry.file || { id: entry.fileId || item.fileId || item.file?.id || fileId.value, name: stringFileName(entry), project: entry.project },
        user: entry.user, updatedAt: entry.updatedAt || undefined,
      })
    }
    return matchSuggestions([...candidates.values()], item.original)
  }
  async function fetchDisputedStrings(item: StringItem): Promise<StringItem[]> {
    const sourceFileId = item.fileId || item.file?.id || (project.value.id === item.project ? fileId.value : 0)
    if (!sourceFileId) return []
    return disputedStringsCache.load(`${item.project}/${sourceFileId}`, async () => {
      const pageSize = 800
      const first = await api<StringPage>('strings', { projectId: item.project, fileId: sourceFileId, page: 1, pageSize, stage: 2 })
      const entries = [...first.results]
      for (let page = 2; page <= first.pageCount; page++) {
        const next = await api<StringPage>('strings', { projectId: item.project, fileId: sourceFileId, page, pageSize, stage: 2 })
        entries.push(...next.results)
      }
      return entries.filter(entry => entry.stage === 2)
    })
  }
  function clearAuxiliaryCache() {
    auxiliaryCacheVersion.value++
    clearTimeout(prefetchTimer); ++prefetchSequence
    termsCache.clear(); suggestionsCache.clear(); disputedStringsCache.clear()
  }
  function scheduleNextPrefetch() {
    clearTimeout(prefetchTimer)
    const sequence = ++prefetchSequence, item = selected.value
    if (disposed || !item || !connected.value || !sessionInfo.value.authenticated || listBusy.value || initializing.value || reloadBusy.value) return
    // Finish foreground requests first so background work cannot delay this entry.
    void Promise.allSettled([loadTerms(), loadSuggestions()]).then(() => {
      if (sequence !== prefetchSequence || disposed || !connected.value || !sessionInfo.value.authenticated) return
      prefetchTimer = setTimeout(() => { void prefetchNext(sequence).catch(() => {}) }, 120)
    })
  }
  async function prefetchNext(sequence: number) {
    const valid = () => !disposed && sequence === prefetchSequence && connected.value && sessionInfo.value.authenticated && !listBusy.value && !initializing.value && !reloadBusy.value
    if (!valid()) return
    let next = nextLocalItem.value
    if (!next && page.value < pageCount.value) {
      const cache = clientSortedStringsCache.value
      if (cache?.key === lengthStringsQueryKey()) next = cache.items[page.value * pageSize.value]
      else {
        const data = await listPage({ projectId: project.value.id, fileId: fileId.value, page: page.value + 1, pageSize: pageSize.value, stage: stageFilter.value, text: search.value, searchMode: searchMode.value })
        if (!valid()) return
        next = orderedItems(data.results)[0]
      }
    }
    if (!next || !valid()) return
    const upcoming = next, key = auxiliaryKey(upcoming)
    await Promise.allSettled([
      termsCache.load(key, () => api<Term[]>('terms', { projectId: upcoming.project, stringId: upcoming.id })),
      suggestionsCache.load(key, () => fetchSuggestions(upcoming)),
    ])
  }
  watch([selected, nextLocalItem, sort, page, pageSize, stageFilter, search, searchMode, fileId, listBusy, initializing, reloadBusy], scheduleNextPrefetch)
  watch([connected, () => sessionInfo.value.authenticated, () => sessionInfo.value.user?.id, () => sessionInfo.value.mode], () => {
    clearAuxiliaryCache()
    clientSortedStringsCache.value = null
  }, { flush: 'sync' })
  async function loadHistory(force = false): Promise<void> {
    if (force) { ++historySequence; historyLoaded = false; historyRequest = undefined }
    const item = selected.value, sequence = historySequence
    if (!item || !connected.value) return
    if (historyRequest?.sequence === sequence) return historyRequest.promise
    if (historyLoaded) return
    historyBusy.value = true; historyError.value = ''
    const promise = (async () => {
      try {
        const data = await api<{ results: HistoryEntry[] } | HistoryEntry[]>('history', { projectId: item.project, stringId: item.id })
        if (sequence === historySequence) { history.value = Array.isArray(data) ? data : data.results || []; historyLoaded = true }
      } catch (reason) { if (sequence === historySequence) historyError.value = (reason as Error).message }
      finally { if (sequence === historySequence) { historyBusy.value = false; historyRequest = undefined } }
    })()
    historyRequest = { sequence, promise }
    await promise
    if (historyRequest?.sequence === sequence) historyRequest = undefined
  }
  async function loadAux(force = true) {
    if (panel.value === 'suggestions') await loadSuggestions(force)
    else if (panel.value === 'history') await loadHistory(force)
  }
  function scheduleAux() {
    ++auxSequence; ++historySequence
    suggestions.value = []; history.value = []
    suggestionsError.value = ''; historyError.value = ''
    suggestionsLoaded = false; historyLoaded = false
    suggestionsRequest = undefined; historyRequest = undefined
    suggestionsBusy.value = false; historyBusy.value = false
    // Suggestions start on every selection, including while QA or terms is open.
    void loadSuggestions()
    if (panel.value === 'history') void loadHistory()
  }
  watch(panel, () => { void loadAux(false) })

  function save(next = true, stage?: 2 | 5, clearTranslationAfterNext = false) {
    if (!connected.value || !sessionInfo.value.authenticated || !selected.value || listBusy.value || initializing.value || reloadBusy.value || locked.value) return
    if (stage === 2 || stage === 5) editStage.value = stage
    if (!dirty.value || submissionQueued()) { if (next) void move(1, clearTranslationAfterNext); return }
    const accountId = sessionInfo.value.user?.id
    if (!accountId) { error.value = '请重新登录后提交'; return }
    const item = { ...selected.value }, translation = toParaTranzText(text.value)
    // Resolve the exact displayed neighbor before queuing or updating the entry.
    const following = next ? adjacentItem(1) : undefined
    const submission: Submission = { id: ++submissionId, item, fileId: fileId.value, accountId, translation, stage: editStage.value }
    clearTimeout(draftTimer)
    // Capture and preserve this exact draft before leaving the entry. Upload never reads the next entry's editor state.
    const persisted = persistDraft(item, translation, submission.stage)
    pendingSubmissions.value.push(submission)
    submissionQueue.push({ submission, persisted })
    submissionFailures.value = submissionFailures.value.filter(failure => failure.item.project !== item.project || failure.item.id !== item.id || failure.accountId !== accountId)
    notice.value = ''
    if (next) {
      if (following) choose(following, clearTranslationAfterNext)
      else if (page.value < pageCount.value) { choose(null); void paginate(page.value + 1, 'first', clearTranslationAfterNext) }
    }
    void processSubmissions()
  }
  async function processSubmissions() {
    if (processingSubmissions) return
    processingSubmissions = true
    submissionProcessing.value = true
    try {
      while (submissionQueue.length) {
        const { submission: job, persisted } = submissionQueue.shift()!
        const key = draftKey(job.item), versionKey = `${job.accountId}/${key}`
        try {
          if (!await persisted) throw new Error('本地草稿保存失败，未上传。请返回词条重试。')
          if (!connected.value || !sessionInfo.value.authenticated || sessionInfo.value.user?.id !== job.accountId) throw new Error('登录已变更或过期，请使用原账号重新提交。本地草稿已保留。')
          const base = submittedVersions.get(versionKey) || job.item
          const saved = await api<StringItem>('save', { projectId: job.item.project, stringId: job.item.id,
            translation: job.translation, stage: job.stage, expectedUserId: job.accountId,
            expectedUpdatedAt: base.updatedAt ?? null, expectedTranslation: base.translation, expectedStage: base.stage, expectedOriginal: base.original })
          if (saved.overwroteConflict) notice.value = `已覆盖 ${job.item.key || '#' + job.item.id} 的远端新修改。`
          submittedVersions.set(versionKey, saved)
          // The saved translation can now be a suggestion for another entry.
          suggestionsCache.clear(); disputedStringsCache.clear()
          if (sessionInfo.value.user?.id === job.accountId) {
            const sameSelection = selected.value?.project === job.item.project && selected.value.id === job.item.id
            if (inCurrentScope(job.item, job.fileId)) {
              const priorVisible = visibleItems.value
              const priorVisibleIndex = priorVisible.findIndex(row => row.id === job.item.id)
              if (sameSelection && stageFilter.value !== null && saved.stage !== stageFilter.value && priorVisibleIndex >= 0) {
                detachedNeighbors.value = { previousId: priorVisible[priorVisibleIndex - 1]?.id, nextId: priorVisible[priorVisibleIndex + 1]?.id, index: priorVisibleIndex, page: page.value }
              }
              updateSortedViewAfterSave(sameSelection)
              const index = items.value.findIndex(row => row.id === job.item.id)
              const visibleIndex = visibleItems.value.findIndex(row => row.id === job.item.id)
              if (index >= 0) {
                if (stageFilter.value !== null && saved.stage !== stageFilter.value) {
                  if (sameSelection) detachedNeighbors.value = { previousId: visibleItems.value[visibleIndex - 1]?.id, nextId: visibleItems.value[visibleIndex + 1]?.id, index: visibleIndex, page: page.value }
                  items.value.splice(index, 1); rowCount.value = Math.max(0, rowCount.value - 1)
                  pageCount.value = Math.max(1, Math.ceil(rowCount.value / pageSize.value))
                } else items.value[index] = saved
              }
            }
            // Update only the remote baseline; preserve newer typing and never change the current selection.
            if (sameSelection) selected.value = saved
            const draft = drafts.value[key]
            const newerInput = sameSelection && (toParaTranzText(text.value) !== job.translation || editStage.value !== job.stage)
            const newerSubmission = pendingSubmissions.value.some(other => other.id > job.id && other.item.project === job.item.project && other.item.id === job.item.id)
            if (sameSelection) clearTimeout(draftTimer)
            if (newerInput && selected.value) {
              if (!await persistDraft(selected.value, text.value, editStage.value)) throw new Error('译文已上传，但后续编辑的草稿保存失败。请返回词条保存。')
            }
            else if (!newerSubmission && (sameSelection || (draft?.translation === job.translation && draft.stage === job.stage))) {
              if (!await persistDraft(job.item, '', 0, true)) throw new Error('译文已上传，但本地草稿清理失败。请返回词条核对。')
            }
          }
        } catch (reason) {
          if (!drafts.value[key]) {
            const sameSelection = selected.value?.project === job.item.project && selected.value.id === job.item.id
            await persistDraft(job.item, sameSelection ? text.value : job.translation, sameSelection ? editStage.value : job.stage)
          }
          submissionFailures.value.push({ ...job, message: (reason as Error).message })
        } finally {
          pendingSubmissions.value = pendingSubmissions.value.filter(other => other.id !== job.id)
          if (!pendingSubmissions.value.some(other => other.item.project === job.item.project && other.item.id === job.item.id && other.accountId === job.accountId)) submittedVersions.delete(versionKey)
        }
      }
    } finally {
      processingSubmissions = false
      submissionProcessing.value = false
      if (updatedSortNeedsRefresh && sort.value === 'updated' && workspaceReady.value && connected.value && sessionInfo.value.authenticated) {
        updatedSortNeedsRefresh = false
        await loadStrings(selected.value?.id)
      }
      scheduleNextPrefetch()
      if (workspaceReady.value && connected.value && sessionInfo.value.authenticated) void refreshFiles().catch(() => {})
    }
  }
  function dismissSubmission(id: number) { submissionFailures.value = submissionFailures.value.filter(failure => failure.id !== id) }
  async function openSubmission(id: number) {
    const failure = submissionFailures.value.find(job => job.id === id)
    if (!failure || listBusy.value || initializing.value || reloadBusy.value) return false
    if (!sessionInfo.value.authenticated || sessionInfo.value.user?.id !== failure.accountId) throw new Error('请先使用提交时的账号登录')
    await flushDraft(true)
    const preserved = drafts.value[draftKey(failure.item)] || { translation: failure.translation, stage: failure.stage, updatedAt: new Date().toISOString() }
    if (!workspaceReady.value || project.value.id !== failure.item.project || fileId.value !== failure.fileId) {
      await bootstrap(failure.item.project, failure.fileId)
      if (error.value) throw new Error(error.value)
    }
    const sequence = selectionSequence
    const data = await api<StringItem>('string', { projectId: failure.item.project, stringId: failure.item.id })
    if (sequence !== selectionSequence || project.value.id !== failure.item.project || fileId.value !== failure.fileId || sessionInfo.value.user?.id !== failure.accountId) return false
    const restored = drafts.value[draftKey(data)]
    if (!restored || restored.updatedAt < preserved.updatedAt) drafts.value[draftKey(data)] = preserved
    choose(data)
    return true
  }
  async function move(direction: number, clearTranslation = false) {
    if (listBusy.value || initializing.value) return
    const target = adjacentItem(direction)
    if (target) await select(target, clearTranslation)
    else if (direction > 0 && page.value < pageCount.value) await paginate(page.value + 1, 'first', clearTranslation)
    else if (direction < 0 && page.value > 1) await paginate(page.value - 1, 'last')
  }
  async function reloadSelected() {
    if (!selected.value || !connected.value || reloadBusy.value || listBusy.value) return
    const item = selected.value
    clearAuxiliaryCache()
    reloadBusy.value = true
    try {
      await flushDraft()
      const data = await api<StringItem>('string', { projectId: item.project, stringId: item.id })
      if (selected.value?.id !== item.id || selected.value.project !== item.project) return
      updateSortedViewAfterSave(true)
      const index = items.value.findIndex(item => item.id === data.id); if (index !== -1) items.value[index] = data
      choose(data); notice.value = '已载入远端版本，本地草稿保留在编辑框'
      if (updatedSortNeedsRefresh && sort.value === 'updated') {
        updatedSortNeedsRefresh = false
        await loadStrings(data.id)
      }
    } catch (reason) { error.value = (reason as Error).message }
    finally { reloadBusy.value = false }
  }
  async function discardDraft() {
    if (!selected.value) return
    clearTimeout(draftTimer); await persistDraft(selected.value, '', 0, true); choose(selected.value)
  }
  async function resetWorkspace() {
    clearAuxiliaryCache()
    clientSortedStringsCache.value = null
    updatedSortNeedsRefresh = false
    navigationHistory.value = []
    await flushDraft(true); connected.value = false; sessionInfo.value = { authenticated: false, mode: 'none' }
    workspaceReady.value = false
    items.value = []; project.value = emptyProject(); file.value = emptyFile(); files.value = []; drafts.value = {}; legacyDraftCount.value = 0
    fileId.value = 0; stageFilter.value = 0; search.value = ''; page.value = 1; rowCount.value = 0; pageCount.value = 1; error.value = ''; notice.value = ''; selectedIds.value = []; draftStatus.value = ''
    choose(null)
  }
  async function restoreSession(session: SessionStatus) {
    clearAuxiliaryCache()
    await flushDraft(true)
    navigationHistory.value = []
    sessionInfo.value = session; connected.value = session.authenticated; workspaceReady.value = false
    choose(null)
    if (connected.value) drafts.value = await api<Record<string, Draft>>('drafts', { accountId: sessionInfo.value.user?.id })
  }
  function waitForSubmissions(): Promise<void> {
    if (!pendingCount.value && !submissionProcessing.value) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { stop(); reject(new Error('后台提交仍在进行，请稍后重试关闭')) }, 55_000)
      const stop = watch([pendingCount, submissionProcessing], ([count, processing]) => {
        if (count === 0 && !processing) { clearTimeout(timeout); stop(); resolve() }
      }, { flush: 'post' })
    })
  }
  async function claimLegacyDrafts() {
    const accountId = sessionInfo.value.user?.id, projectId = project.value.id
    if (!accountId || !projectId) return
    await flushDraft(true)
    const result = await api<{ imported: number }>('claimLegacyDrafts', { accountId, projectId })
    drafts.value = await api<Record<string, Draft>>('drafts', { accountId })
    legacyDraftCount.value = (await api<{ count: number }>('legacyDrafts', { accountId, projectId })).count
    if (selected.value) choose(selected.value)
    notice.value = `已将 ${result.imported} 条旧草稿归入当前账号`
  }
  async function exportPage() {
    if (exportBusy.value) return
    exportBusy.value = true
    try {
    const data = selectedIds.value.length ? visibleItems.value.filter(item => selectedIds.value.includes(item.id)) : visibleItems.value
    const content = JSON.stringify(data.map(({ id, key, original, translation, stage, context }) => ({ id, key, original, translation, stage, context })), null, 2)
    const name = `sckit-${project.value.id}-${fileId.value}-page${page.value}.json`
    if (window.scKit) await window.scKit.exportData(content, name)
    else { const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url) }
    } catch (reason) { error.value = (reason as Error).message }
    finally { exportBusy.value = false }
  }
  async function loginPresence() {
    if (presenceLoginBusy.value || listBusy.value || initializing.value || reloadBusy.value || !window.scKit) return
    presenceLoginBusy.value = true
    try {
      await flushDraft(true)
      const result = await window.scKit.loginPresence(presenceProjectId.value || project.value.id)
      if (!result.ok) throw new Error(result.message || '未完成占用同步登录')
      await presence.retry()
    } catch (reason) { error.value = (reason as Error).message }
    finally { presenceLoginBusy.value = false }
  }
  let removeMcpDraftUpdate: (() => void) | undefined, removeMcpRemoteSaved: (() => void) | undefined
  onMounted(async () => {
    desktop.value = !!window.scKit
    if (desktop.value) {
      removeMcpDraftUpdate = window.scKit?.onMcpDraftUpdated(update => {
        if (update.accountId !== undefined && update.accountId !== sessionInfo.value.user?.id) return
        if (update.connectionEpoch !== undefined && update.connectionEpoch !== sessionInfo.value.connectionEpoch) return
        if (!Number.isInteger(update.projectId) || !Number.isInteger(update.stringId) || !update.draft) return
        const key = `${update.projectId}/${update.stringId}`
        const previousDraft = drafts.value[key]
        drafts.value[key] = update.draft
        if (selected.value?.project !== update.projectId || selected.value.id !== update.stringId || (dirty.value && (text.value !== previousDraft?.translation || editStage.value !== previousDraft?.stage))) return
        changing = true
        translationDisplayCleared.value = false
        text.value = toParaTranzText(update.draft.translation)
        editStage.value = update.draft.stage
        draftStatus.value = 'MCP 已填入本机草稿'
        changing = false
      })
      removeMcpRemoteSaved = window.scKit?.onMcpRemoteSaved(update => {
        if (update.accountId !== undefined && update.accountId !== sessionInfo.value.user?.id) return
        if (update.connectionEpoch !== undefined && update.connectionEpoch !== sessionInfo.value.connectionEpoch) return
        const saved = normalizeStringItem(update.item)
        if (!Number.isInteger(update.projectId) || !Number.isInteger(update.stringId) ||
          saved?.project !== update.projectId || saved?.id !== update.stringId) return
        const key = `${update.projectId}/${update.stringId}`
        const sameSelection = selected.value?.project === update.projectId && selected.value.id === update.stringId
        const editorWasClean = sameSelection && !dirty.value
        const previousDraft = drafts.value[key]
        if (update.draftCleared) delete drafts.value[key]
        if (inCurrentScope(saved)) {
          const priorVisible = visibleItems.value
          const priorVisibleIndex = priorVisible.findIndex(row => row.project === update.projectId && row.id === update.stringId)
          if (sameSelection && stageFilter.value !== null && saved.stage !== stageFilter.value && priorVisibleIndex >= 0) {
            detachedNeighbors.value = { previousId: priorVisible[priorVisibleIndex - 1]?.id, nextId: priorVisible[priorVisibleIndex + 1]?.id, index: priorVisibleIndex, page: page.value }
          }
          updateSortedViewAfterSave(sameSelection)
          const index = items.value.findIndex(row => row.project === update.projectId && row.id === update.stringId)
          const visibleIndex = visibleItems.value.findIndex(row => row.project === update.projectId && row.id === update.stringId)
          if (index >= 0) {
            if (stageFilter.value !== null && saved.stage !== stageFilter.value) {
              if (sameSelection) detachedNeighbors.value = { previousId: visibleItems.value[visibleIndex - 1]?.id, nextId: visibleItems.value[visibleIndex + 1]?.id, index: visibleIndex, page: page.value }
              items.value.splice(index, 1)
              rowCount.value = Math.max(0, rowCount.value - 1)
              pageCount.value = Math.max(1, Math.ceil(rowCount.value / pageSize.value))
            } else items.value[index] = saved
          }
        }
        if (sameSelection) {
          selected.value = saved
          if (editorWasClean || (update.draftCleared && toParaTranzText(text.value) === saved.translation && editStage.value === previousDraft?.stage)) {
            changing = true
            translationDisplayCleared.value = false
            text.value = toParaTranzText(saved.translation)
            editStage.value = saved.stage
            changing = false
          }
          draftStatus.value = update.draftPresent && !update.draftCleared ? 'MCP 已直接保存到 ParaTranz；本机草稿仍保留' : 'MCP 已直接保存到 ParaTranz'
        }
        if (updatedSortNeedsRefresh && sort.value === 'updated' && workspaceReady.value && connected.value && sessionInfo.value.authenticated) {
          updatedSortNeedsRefresh = false
          void loadStrings(selected.value?.id)
        }
        suggestionsCache.clear(); disputedStringsCache.clear()
      })
      try {
        sessionInfo.value = await api<SessionStatus>('session')
        if (sessionInfo.value.authenticated) {
          await restoreSession(sessionInfo.value)
        }
      } catch (reason) { error.value = (reason as Error).message }
    }
    initializing.value = false
  })
  onBeforeUnmount(() => { window.scKit?.reportMcpWorkspaceContext(null); removeMcpDraftUpdate?.(); removeMcpRemoteSaved?.(); disposed = true; stopListRequests(); clearAuxiliaryCache(); clearTimeout(draftTimer); clearTimeout(searchTimer); ++auxSequence; ++historySequence; ++termsSequence; flushDraft() })
  const translationCacheState = { auxiliaryCacheVersion }
  return { ...translationCacheState, desktop, connected, initializing, workspaceReady, project, file, files, sortedFiles, aggregateMode, allFilesScope, showSourceFile: allFilesScope, aggregateFile, stringFileName, items, visibleItems, selected, canGoBack, backNavigationTitle, text, editStage, stageFilter, search, searchMode, advancedFilters, applyAdvancedFilters, clearFilters, page, pageSize, pageCount, rowCount, fileId, sort, listBusy, listProgress, cancelListLoad, pendingCount, submissionFailures, error, notice, draftStatus, dirty, locked, issues, untranslated, selectedIds, panel, suggestions, suggestionsBusy, suggestionsError, terms, history, historyBusy, historyError, auxBusy, auxError, termsBusy, termsError, sessionInfo, drafts, legacyDraftCount, claimLegacyDrafts,
    presence, presenceProjectId, presenceLoginBusy, loginPresence, requestCount, reloadBusy, exportBusy, api, input, select, loadStrings, bootstrap, changeFile, openFile, refreshFiles, openString, openOccurrences, goBack, filter, paginate, changePageSize, loadAux, loadTerms, loadSuggestions, loadHistory, termsFor, suggestionsFor, submissionQueued, dismissSubmission, openSubmission, save, move, reloadSelected, discardDraft, restoreClearedTranslation, savePrefillDraft, savePrefillToParaTranz, translationDisplayCleared, resetWorkspace, restoreSession, flushDraft, waitForSubmissions, exportPage }
}
