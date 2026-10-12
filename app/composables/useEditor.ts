import type { Draft, FileInfo, HistoryEntry, ProjectInfo, RequestAction, SessionStatus, StringItem, StringPage, Suggestion, Term } from '~/types/editor'
import { qualityIssues } from '~/utils/quality'
import { matchSuggestions } from '~/utils/textWorker'
import { toParaTranzText } from '~/utils/translationText'
import { sortFilesByCompletion } from '~/utils/fileSort'
import { EntryAuxCache } from '~/utils/entryAuxCache'
import { ListRequestCoordinator } from '~/utils/listRequestCoordinator'

const emptyProject = (): ProjectInfo => ({ id: 0, name: '', source: '', dest: '' })
const emptyFile = (): FileInfo => ({ id: 0, name: '', project: 0, total: 0, translated: 0, disputed: 0, checked: 0, reviewed: 0, hidden: 0, locked: 0, words: 0 })
interface Submission {
  id: number; item: StringItem; fileId: number; accountId: number; translation: string; stage: number
}
interface SubmissionFailure extends Submission { message: string }

export function useEditor() {
  const desktop = ref(false), connected = ref(false), initializing = ref(true)
  const workspaceReady = ref(false)
  const project = ref<ProjectInfo>(emptyProject()), file = ref<FileInfo>(emptyFile())
  const files = ref<FileInfo[]>([]), items = ref<StringItem[]>([])
  const sortedFiles = computed(() => sortFilesByCompletion(files.value))
  const selected = ref<StringItem | null>(items.value[0] || null)
  const text = ref(''), editStage = ref(0), translationDisplayCleared = ref(false), stageFilter = ref<number | null>(0), search = ref(''), searchMode = ref('text')
  const page = ref(1), pageSize = ref(50), pageCount = ref(1), rowCount = ref(0), fileId = ref(0), sort = ref('default')
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
  let suggestionsLoaded = false, historyLoaded = false
  let suggestionsRequest: { sequence: number; promise: Promise<void> } | undefined
  let historyRequest: { sequence: number; promise: Promise<void> } | undefined
  let termsRequest: { sequence: number; promise: Promise<void> } | undefined
  let draftWrites: Promise<void> = Promise.resolve()
  const detachedNeighbors = shallowRef<{ previousId?: number; nextId?: number; index: number; page: number } | null>(null)
  const termsCache = new EntryAuxCache<Term[]>(), suggestionsCache = new EntryAuxCache<Suggestion[]>(), disputedStringsCache = new EntryAuxCache<StringItem[]>(120_000, 8)
  const updatedStringsCache = shallowRef<{ key: string; items: StringItem[] } | null>(null)
  const listRequests = new ListRequestCoordinator(id => { void window.scKit?.cancelRequest?.(id) })
  const globalSortLimit = 20_000
  let updatedSortNeedsRefresh = false
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined, prefetchSequence = 0, disposed = false
  const auxiliaryKey = (item: StringItem) => JSON.stringify([sessionInfo.value.user?.id, sessionInfo.value.mode, item.project, item.id, item.original])

  function updatedStringsQueryKey() {
    return JSON.stringify([project.value.id, fileId.value, stageFilter.value, searchMode.value, search.value, sort.value])
  }
  function compareUpdated(a: StringItem, b: StringItem) {
    const aTime = Date.parse(a.updatedAt || '') || 0, bTime = Date.parse(b.updatedAt || '') || 0
    return bTime - aTime || b.id - a.id
  }
  function sortByUpdated(rows: StringItem[]) { return [...rows].sort(compareUpdated) }
  function updateUpdatedStringsCache(saved: StringItem, preferSaved = false) {
    const cache = updatedStringsCache.value
    if (sort.value !== 'updated' || !cache || cache.key !== updatedStringsQueryKey()) return false
    if (search.value) {
      updatedStringsCache.value = null
      updatedSortNeedsRefresh = true
      return false
    }

    const rows = [...cache.items], index = rows.findIndex(item => item.project === saved.project && item.id === saved.id)
    const matchesStage = stageFilter.value === null || saved.stage === stageFilter.value
    if (index >= 0) {
      if (matchesStage) rows[index] = saved
      else rows.splice(index, 1)
    } else if (matchesStage) rows.push(saved)
    const sorted = sortByUpdated(rows)
    updatedStringsCache.value = { key: cache.key, items: sorted }
    rowCount.value = sorted.length
    pageCount.value = Math.max(1, Math.ceil(rowCount.value / pageSize.value))
    if (preferSaved && matchesStage) {
      const savedIndex = sorted.findIndex(item => item.project === saved.project && item.id === saved.id)
      if (savedIndex >= 0) page.value = Math.floor(savedIndex / pageSize.value) + 1
    }
    page.value = Math.max(1, Math.min(page.value, pageCount.value))
    items.value = sorted.slice((page.value - 1) * pageSize.value, page.value * pageSize.value)
    return true
  }

  function orderedItems(rows: StringItem[]) {
    const result = [...rows]
    if (sort.value === 'key') result.sort((a, b) => a.key.localeCompare(b.key))
    if (sort.value === 'length') result.sort((a, b) => b.original.length - a.original.length)
    if (sort.value === 'updated') result.sort(compareUpdated)
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
        throw new Error(result.message || '请求失败')
      }
      return result.data as T
    } finally { requestCount.value-- }
  }
  function stopListRequests() {
    listRequests.cancelAll()
  }
  async function listPage(payload: Record<string, unknown>): Promise<StringPage> {
    return listRequests.run(id => api<StringPage>('strings', payload, id))
  }
  function choose(item: StringItem | null, clearTranslation = false) {
    ++selectionSequence
    detachedNeighbors.value = null
    changing = true
    translationDisplayCleared.value = false
    selected.value = item
    const draft = item ? drafts.value[draftKey(item)] : undefined
    text.value = toParaTranzText(draft?.translation ?? item?.translation ?? '')
    editStage.value = draft?.stage ?? item?.stage ?? 0
    if (clearTranslation && item) {
      text.value = ''
      translationDisplayCleared.value = true
      draftStatus.value = draft ? '译文框已清空，本地草稿已保留' : '译文框已清空'
    } else draftStatus.value = draft ? '已恢复本地草稿' : ''
    changing = false
    scheduleAux()
    scheduleTerms()
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
    if (project.value.id === item.project && fileId.value === (item.fileId || item.file?.id || fileId.value)) {
      const priorVisible = visibleItems.value
      const priorVisibleIndex = priorVisible.findIndex(row => row.project === item.project && row.id === item.id)
      if (sameSelection && stageFilter.value !== null && saved.stage !== stageFilter.value && priorVisibleIndex >= 0) {
        detachedNeighbors.value = { previousId: priorVisible[priorVisibleIndex - 1]?.id, nextId: priorVisible[priorVisibleIndex + 1]?.id, index: priorVisibleIndex, page: page.value }
      }
      const updatedCacheHandled = updateUpdatedStringsCache(saved, sameSelection)
      const index = items.value.findIndex(row => row.project === item.project && row.id === item.id)
      const visibleIndex = visibleItems.value.findIndex(row => row.project === item.project && row.id === item.id)
      if (!updatedCacheHandled && index >= 0) {
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
      if (sort.value !== 'default') {
        const key = updatedStringsQueryKey()
        let all = !force && updatedStringsCache.value?.key === key ? updatedStringsCache.value.items : undefined
        if (!all) {
          // ParaTranz does not expose a list sort parameter, so collect the full filtered result before sorting.
          updatedStringsCache.value = null
          const remotePageSize = 800
          const query = { projectId: project.value.id, fileId: fileId.value, pageSize: remotePageSize, stage: stageFilter.value, text: search.value, searchMode: searchMode.value }
          const first = await listPage({ ...query, page: 1 })
          if (sequence !== listSequence) return
          if (first.rowCount > globalSortLimit || first.pageCount * remotePageSize > globalSortLimit + remotePageSize) {
            throw new Error(`全局排序最多处理 ${globalSortLimit.toLocaleString()} 条词条；请先按状态或搜索缩小范围。`)
          }
          listProgress.value = `已读取 1 / ${first.pageCount} 页，正在按${sort.value === 'key' ? '键值' : sort.value === 'length' ? '原文长度' : '修改时间'}排序`
          const fetched = new Map(first.results.map(item => [item.id, item]))
          for (let currentPage = 2; currentPage <= first.pageCount; currentPage++) {
            const data = await listPage({ ...query, page: currentPage })
            if (sequence !== listSequence) return
            for (const item of data.results) fetched.set(item.id, item)
            listProgress.value = `已读取 ${currentPage} / ${first.pageCount} 页，正在整理排序`
          }
          all = orderedItems([...fetched.values()])
          updatedStringsCache.value = { key, items: all }
          updatedSortNeedsRefresh = false
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
          if (first.rowCount > globalSortLimit) throw new Error(`定位原选中词条需要扫描超过 ${globalSortLimit.toLocaleString()} 条记录；请先缩小筛选范围。`)
          let index = first.results.findIndex(item => item.id === retainedSelection.id && item.project === retainedSelection.project)
          for (let remotePage = 2; index < 0 && remotePage <= first.pageCount; remotePage++) {
            const data = await listPage({ ...query, page: remotePage })
            if (sequence !== listSequence) return
            listProgress.value = `正在定位所选词条：${remotePage} / ${first.pageCount} 页`
            const match = data.results.findIndex(item => item.id === retainedSelection.id && item.project === retainedSelection.project)
            if (match >= 0) index = (remotePage - 1) * 800 + match
          }
          if (index >= 0) page.value = Math.floor(index / pageSize.value) + 1
          else notice.value = '当前筛选结果不包含此前选中的词条。'
        }
        const data = await listPage({ projectId: project.value.id, fileId: fileId.value, page: page.value, pageSize: pageSize.value, stage: stageFilter.value, text: search.value, searchMode: searchMode.value })
        if (sequence !== listSequence) return
        items.value = data.results; rowCount.value = data.rowCount; pageCount.value = Math.max(1, data.pageCount); page.value = data.page
      }
      const rows = visibleItems.value
      choose(rows.find(item => item.id === preferredId) || (edge === 'last' ? rows.at(-1) : rows[0]) || null, clearTranslation)
    } catch (reason) { if (sequence === listSequence) error.value = (reason as Error).message }
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
  async function bootstrap(projectId: number, newFileId: number) {
    if (!sessionInfo.value.authenticated || initializing.value && connected.value) return
    try { await flushDraft(true) } catch (reason) { error.value = (reason as Error).message; return }
    clearAuxiliaryCache()
    updatedStringsCache.value = null
    initializing.value = true; error.value = ''
    try {
      const accountId = sessionInfo.value.user?.id
      const [newProject, newFiles, localDrafts, legacy] = await Promise.all([
        api<ProjectInfo>('project', { projectId }), api<FileInfo[]>('files', { projectId }),
        api<Record<string, Draft>>('drafts', { accountId }), api<{ count: number }>('legacyDrafts', { accountId, projectId }),
      ])
      if (!newFiles.length) throw new Error('项目中没有可翻译的文件')
      project.value = newProject; files.value = newFiles; drafts.value = localDrafts; legacyDraftCount.value = legacy.count
      file.value = newFiles.find(entry => entry.id === newFileId) || newFiles[0]!
      fileId.value = file.value.id; connected.value = true; choose(null); page.value = 1
      clearTimeout(searchTimer); search.value = ''; selectedIds.value = []
      localStorage.setItem('sckit-workspace', JSON.stringify({ projectId, fileId: file.value.id }))
      await loadStrings()
      workspaceReady.value = !error.value
    } catch (reason) { error.value = (reason as Error).message }
    finally { initializing.value = false }
  }
  async function changeFile(id: number) {
    if (initializing.value || listBusy.value || id === fileId.value || !files.value.some(entry => entry.id === id)) return
    try { await flushDraft(true) } catch (reason) { error.value = (reason as Error).message; return }
    updatedStringsCache.value = null; fileId.value = id; file.value = files.value.find(entry => entry.id === id) || file.value
    page.value = 1; await loadStrings(); localStorage.setItem('sckit-workspace', JSON.stringify({ projectId: project.value.id, fileId: id }))
  }
  async function refreshFiles() {
    if (!connected.value) return
    const projectId = project.value.id
    const refreshed = await api<FileInfo[]>('files', { projectId })
    if (project.value.id !== projectId) return
    files.value = refreshed
    file.value = refreshed.find(entry => entry.id === fileId.value) || file.value
  }
  function filter(stage: number | null) { stageFilter.value = stage; page.value = 1; loadStrings() }
  watch([search, searchMode], (_value, previous) => {
    clearTimeout(searchTimer)
    if (initializing.value) return
    if (listBusy.value) cancelListLoad(true)
    const preserve = !search.value.trim() && !!previous?.[0] ? selected.value || undefined : undefined
    searchTimer = setTimeout(() => { page.value = 1; void loadStrings(preserve?.id, preserve) }, 350)
  })
  watch(sort, () => { page.value = 1; void loadStrings(selected.value?.id) })
  async function paginate(newPage: number, edge: 'first' | 'last' = 'first', clearTranslation = false) { if (listBusy.value) return; page.value = Math.max(1, Math.min(newPage, pageCount.value)); await loadStrings(undefined, undefined, edge, clearTranslation, false) }
  async function changePageSize(size: number) { pageSize.value = size; page.value = 1; await loadStrings(undefined, undefined, 'first', false, false) }

  async function loadTerms(force = false): Promise<void> {
    if (force) { termsCache.clear(); ++termsSequence; termsLoaded = false; termsRequest = undefined }
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
    if (force) { suggestionsCache.clear(); ++auxSequence; suggestionsLoaded = false; suggestionsRequest = undefined }
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
        file: entry.file || { id: item.fileId || item.file?.id || fileId.value, name: file.value.name, project: entry.project },
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
      if (sort.value === 'updated') {
        const cache = updatedStringsCache.value
        if (cache?.key === updatedStringsQueryKey()) next = cache.items[page.value * pageSize.value]
      } else {
        const data = await api<StringPage>('strings', { projectId: project.value.id, fileId: fileId.value, page: page.value + 1, pageSize: pageSize.value, stage: stageFilter.value, text: search.value, searchMode: searchMode.value })
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
    updatedStringsCache.value = null
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
            if (project.value.id === job.item.project && fileId.value === job.fileId) {
              const priorVisible = visibleItems.value
              const priorVisibleIndex = priorVisible.findIndex(row => row.id === job.item.id)
              if (sameSelection && stageFilter.value !== null && saved.stage !== stageFilter.value && priorVisibleIndex >= 0) {
                detachedNeighbors.value = { previousId: priorVisible[priorVisibleIndex - 1]?.id, nextId: priorVisible[priorVisibleIndex + 1]?.id, index: priorVisibleIndex, page: page.value }
              }
              const updatedCacheHandled = updateUpdatedStringsCache(saved, sameSelection)
              const index = items.value.findIndex(row => row.id === job.item.id)
              const visibleIndex = visibleItems.value.findIndex(row => row.id === job.item.id)
              if (!updatedCacheHandled && index >= 0) {
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
      const updatedCacheHandled = updateUpdatedStringsCache(data, true)
      const index = items.value.findIndex(item => item.id === data.id); if (index !== -1) items.value[index] = data
      choose(data); notice.value = '已载入远端版本，本地草稿保留在编辑框'
      if (!updatedCacheHandled && updatedSortNeedsRefresh && sort.value === 'updated') {
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
    updatedStringsCache.value = null
    updatedSortNeedsRefresh = false
    await flushDraft(true); connected.value = false; sessionInfo.value = { authenticated: false, mode: 'none' }
    workspaceReady.value = false
    items.value = []; project.value = emptyProject(); file.value = emptyFile(); files.value = []; drafts.value = {}; legacyDraftCount.value = 0
    fileId.value = 0; stageFilter.value = 0; search.value = ''; page.value = 1; rowCount.value = 0; pageCount.value = 1; error.value = ''; notice.value = ''; selectedIds.value = []; draftStatus.value = ''
    choose(null)
  }
  async function restoreSession(session: SessionStatus) {
    clearAuxiliaryCache()
    await flushDraft(true)
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
  onMounted(async () => {
    desktop.value = !!window.scKit
    if (desktop.value) {
      try {
        sessionInfo.value = await api<SessionStatus>('session')
        if (sessionInfo.value.authenticated) {
          await restoreSession(sessionInfo.value)
        }
      } catch (reason) { error.value = (reason as Error).message }
    }
    initializing.value = false
  })
  onBeforeUnmount(() => { disposed = true; stopListRequests(); clearAuxiliaryCache(); clearTimeout(draftTimer); clearTimeout(searchTimer); ++auxSequence; ++historySequence; ++termsSequence; flushDraft() })
  return { desktop, connected, initializing, workspaceReady, project, file, files, sortedFiles, items, visibleItems, selected, text, editStage, stageFilter, search, searchMode, page, pageSize, pageCount, rowCount, fileId, sort, listBusy, listProgress, cancelListLoad, pendingCount, submissionFailures, error, notice, draftStatus, dirty, locked, issues, untranslated, selectedIds, panel, suggestions, suggestionsBusy, suggestionsError, terms, history, historyBusy, historyError, auxBusy, auxError, termsBusy, termsError, sessionInfo, drafts, legacyDraftCount, claimLegacyDrafts,
    presence, presenceProjectId, presenceLoginBusy, loginPresence, requestCount, reloadBusy, exportBusy, api, input, select, loadStrings, bootstrap, changeFile, refreshFiles, filter, paginate, changePageSize, loadAux, loadTerms, loadSuggestions, loadHistory, termsFor, suggestionsFor, submissionQueued, dismissSubmission, openSubmission, save, move, reloadSelected, discardDraft, restoreClearedTranslation, savePrefillDraft, savePrefillToParaTranz, translationDisplayCleared, resetWorkspace, restoreSession, flushDraft, waitForSubmissions, exportPage }
}
