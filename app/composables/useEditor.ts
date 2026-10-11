import type { Draft, FileInfo, HistoryEntry, ProjectInfo, RequestAction, SessionStatus, StringItem, StringPage, Suggestion, Term } from '~/types/editor'
import { qualityIssues } from '~/utils/quality'
import { matchSuggestions } from '~/utils/textWorker'
import { toParaTranzText } from '~/utils/translationText'
import { sortFilesByCompletion } from '~/utils/fileSort'

const emptyProject = (): ProjectInfo => ({ id: 0, name: '', source: '', dest: '' })
const emptyFile = (): FileInfo => ({ id: 0, name: '', project: 0, total: 0, translated: 0, disputed: 0, checked: 0, reviewed: 0, hidden: 0, locked: 0, words: 0 })

export function useEditor() {
  const desktop = ref(false), connected = ref(false), initializing = ref(true)
  const workspaceReady = ref(false)
  const project = ref<ProjectInfo>(emptyProject()), file = ref<FileInfo>(emptyFile())
  const files = ref<FileInfo[]>([]), items = ref<StringItem[]>([])
  const sortedFiles = computed(() => sortFilesByCompletion(files.value))
  const selected = ref<StringItem | null>(items.value[0] || null)
  const text = ref(''), editStage = ref(0), stageFilter = ref<number | null>(0), search = ref(''), searchMode = ref('text')
  const page = ref(1), pageSize = ref(50), pageCount = ref(1), rowCount = ref(0), fileId = ref(0), sort = ref('default')
  const listBusy = ref(false), saving = ref(false), error = ref(''), notice = ref(''), draftStatus = ref('')
  const requestCount = ref(0), reloadBusy = ref(false), exportBusy = ref(false)
  const selectedIds = ref<number[]>([]), drafts = ref<Record<string, Draft>>({})
  const panel = ref<'context' | 'suggestions' | 'history' | 'terms' | 'quality' | 'comments'>('suggestions')
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
  let detachedNeighbors: { previousId?: number; nextId?: number; index: number; page: number } | null = null

  const visibleItems = computed(() => {
    let result = [...items.value]
    if (sort.value === 'key') result.sort((a, b) => a.key.localeCompare(b.key))
    if (sort.value === 'length') result.sort((a, b) => b.original.length - a.original.length)
    if (sort.value === 'updated') result.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    return result
  })
  const dirty = computed(() => !!selected.value && (toParaTranzText(text.value) !== toParaTranzText(selected.value.translation) || editStage.value !== selected.value.stage))
  const locked = computed(() => [9, -1].includes(selected.value?.stage ?? 0))
  const issues = computed(() => selected.value ? qualityIssues(selected.value.original, text.value, selected.value.key) : [])
  const untranslated = computed(() => Math.max(0, file.value.total - file.value.translated - file.value.hidden))
  const draftKey = (item = selected.value) => item ? `${item.project}/${item.id}` : ''

  async function api<T>(action: RequestAction, payload: Record<string, unknown> = {}): Promise<T> {
    const bridge = window.scKit
    if (!bridge) throw new Error('请在 Electron 应用中连接 ParaTranz')
    requestCount.value++
    try {
      const result = await bridge.request<T>(action, payload)
      if (!result.ok) {
        if (result.status === 401) sessionInfo.value.authenticated = false
        throw new Error(result.message || '请求失败')
      }
      return result.data as T
    } finally { requestCount.value-- }
  }
  function choose(item: StringItem | null) {
    ++selectionSequence
    detachedNeighbors = null
    changing = true
    selected.value = item
    const draft = item ? drafts.value[draftKey(item)] : undefined
    text.value = toParaTranzText(draft?.translation ?? item?.translation ?? '')
    editStage.value = draft?.stage ?? item?.stage ?? 0
    draftStatus.value = draft ? '已恢复本地草稿' : ''
    changing = false
    scheduleAux()
    scheduleTerms()
  }
  async function persistDraft(item: StringItem, translation: string, stage: number, remove = false) {
    translation = toParaTranzText(translation)
    const key = draftKey(item)
    const generation = ++draftGeneration
    const draft = { translation, stage, updatedAt: new Date().toISOString() }
    if (remove) delete drafts.value[key]; else drafts.value[key] = draft
    try {
      const write = async () => { await api('draft', { projectId: item.project, stringId: item.id, ...draft, remove }) }
      const pending = draftWrites.then(write, write)
      draftWrites = pending.catch(() => {})
      await pending
      if (generation === draftGeneration && selected.value?.id === item.id) draftStatus.value = remove ? '' : '草稿已保存到本地'
      return true
    } catch (reason) { draftStatus.value = `草稿保存失败：${(reason as Error).message}`; return false }
  }
  async function flushDraft(strict = false) {
    clearTimeout(draftTimer)
    if (!selected.value) return
    let persisted = true
    if (dirty.value) persisted = await persistDraft(selected.value, text.value, editStage.value)
    else if (drafts.value[draftKey()]) persisted = await persistDraft(selected.value, '', 0, true)
    await draftWrites
    if (strict && !persisted) throw new Error(draftStatus.value)
  }
  async function select(item: StringItem) {
    if (saving.value || listBusy.value || initializing.value || reloadBusy.value || selected.value?.id === item.id) return
    const sequence = ++selectionSequence
    await flushDraft()
    if (sequence !== selectionSequence || saving.value || listBusy.value || initializing.value || reloadBusy.value) return
    choose(item)
  }
  function input(value: string) {
    if (saving.value || listBusy.value || initializing.value || reloadBusy.value || locked.value) return
    text.value = toParaTranzText(value)
    if (editStage.value === 0 && value.trim()) editStage.value = 1
    if (editStage.value === 1 && !value.trim()) editStage.value = 0
  }
  watch([text, editStage], () => {
    if (changing || !selected.value || saving.value) return
    clearTimeout(draftTimer)
    const item = selected.value, translation = text.value, stage = editStage.value
    if (dirty.value) {
      draftStatus.value = '正在保存草稿…'
      draftTimer = setTimeout(() => persistDraft(item, translation, stage), 450)
    } else if (drafts.value[draftKey(item)]) {
      draftTimer = setTimeout(() => persistDraft(item, '', 0, true), 450)
    } else draftStatus.value = ''
  }, { flush: 'sync' })

  async function loadStrings(preferredId?: number, retainedSelection?: StringItem) {
    await flushDraft()
    if (!connected.value) return
    const sequence = ++listSequence
    listBusy.value = true; error.value = ''; selectedIds.value = []
    try {
      const data = await api<StringPage>('strings', { projectId: project.value.id, fileId: fileId.value, page: page.value, pageSize: pageSize.value, stage: stageFilter.value, text: search.value, searchMode: searchMode.value })
      if (sequence !== listSequence) return
      items.value = data.results; rowCount.value = data.rowCount; pageCount.value = Math.max(1, data.pageCount); page.value = data.page
      choose(retainedSelection || items.value.find(item => item.id === preferredId) || items.value[0] || null)
    } catch (reason) { if (sequence === listSequence) error.value = (reason as Error).message }
    finally { if (sequence === listSequence) listBusy.value = false }
  }
  async function bootstrap(projectId: number, newFileId: number) {
    if (!sessionInfo.value.authenticated || saving.value || initializing.value && connected.value) return
    await flushDraft()
    initializing.value = true; error.value = ''
    try {
      const [newProject, newFiles, localDrafts] = await Promise.all([api<ProjectInfo>('project', { projectId }), api<FileInfo[]>('files', { projectId }), api<Record<string, Draft>>('drafts')])
      if (!newFiles.length) throw new Error('项目中没有可翻译的文件')
      project.value = newProject; files.value = newFiles; drafts.value = localDrafts
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
    if (saving.value || initializing.value || listBusy.value || id === fileId.value || !files.value.some(entry => entry.id === id)) return
    await flushDraft(); fileId.value = id; file.value = files.value.find(entry => entry.id === id) || file.value
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
  function filter(stage: number | null) { if (saving.value) return; stageFilter.value = stage; page.value = 1; loadStrings() }
  watch([search, searchMode], () => { clearTimeout(searchTimer); if (initializing.value) return; searchTimer = setTimeout(() => { page.value = 1; loadStrings() }, 350) })
  async function paginate(newPage: number) { if (saving.value || listBusy.value) return; page.value = Math.max(1, Math.min(newPage, pageCount.value)); await loadStrings() }
  async function changePageSize(size: number) { pageSize.value = size; page.value = 1; await loadStrings() }

  async function loadTerms(force = false): Promise<void> {
    if (force) { ++termsSequence; termsLoaded = false; termsRequest = undefined }
    const item = selected.value, sequence = termsSequence
    if (!item || !connected.value) { termsBusy.value = false; return }
    if (termsRequest?.sequence === sequence) return termsRequest.promise
    if (termsLoaded && !force) return
    termsBusy.value = true; termsError.value = ''
    const promise = (async () => {
      try {
        const data = await api<Term[]>('terms', { projectId: item.project, stringId: item.id })
        if (sequence === termsSequence) { terms.value = data; termsLoaded = true }
      } catch (reason) { if (sequence === termsSequence) termsError.value = (reason as Error).message }
      finally { if (sequence === termsSequence) { termsBusy.value = false; termsRequest = undefined } }
    })()
    termsRequest = { sequence, promise }
    await promise
    if (termsRequest?.sequence === sequence) termsRequest = undefined
  }
  function scheduleTerms() {
    ++termsSequence
    terms.value = []; termsError.value = ''; termsLoaded = false; termsRequest = undefined
    termsBusy.value = !!selected.value
    if (selected.value) void loadTerms()
  }
  async function loadSuggestions(force = false): Promise<void> {
    if (force) { ++auxSequence; suggestionsLoaded = false; suggestionsRequest = undefined }
    const item = selected.value, sequence = auxSequence
    if (!item || !connected.value) return
    if (suggestionsRequest?.sequence === sequence) return suggestionsRequest.promise
    if (suggestionsLoaded) return
    suggestionsBusy.value = true; suggestionsError.value = ''
    const promise = (async () => {
      try {
        const data = await api<Suggestion[]>('suggestions', { projectId: item.project, stringId: item.id })
        if (sequence !== auxSequence) return
        const matched = await matchSuggestions(data, item.original)
        if (sequence === auxSequence) { suggestions.value = matched; suggestionsLoaded = true }
      } catch (reason) { if (sequence === auxSequence) suggestionsError.value = (reason as Error).message }
      finally { if (sequence === auxSequence) { suggestionsBusy.value = false; suggestionsRequest = undefined } }
    })()
    suggestionsRequest = { sequence, promise }
    await promise
    if (suggestionsRequest?.sequence === sequence) suggestionsRequest = undefined
  }
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

  async function save(next = false, stage?: 2 | 5) {
    if (!connected.value || !sessionInfo.value.authenticated || !selected.value || saving.value || listBusy.value || initializing.value || reloadBusy.value || locked.value) return
    if (stage === 2 || stage === 5) editStage.value = stage
    if (!dirty.value) { if (next) await move(1); return }
    const item = selected.value
    const index = visibleItems.value.findIndex(entry => entry.id === item.id)
    const nextId = visibleItems.value[index + 1]?.id
    const previousId = visibleItems.value[index - 1]?.id
    const previousPage = page.value
    const previousPageCount = pageCount.value
    const advance = next && (!!nextId || previousPage < previousPageCount)
    saving.value = true; error.value = ''; notice.value = ''
    try {
      await flushDraft(true)
      const translation = toParaTranzText(text.value)
      const saved = await api<StringItem>('save', { projectId: project.value.id, stringId: item.id, translation, stage: editStage.value,
        expectedUpdatedAt: item.updatedAt ?? null, expectedTranslation: item.translation, expectedStage: item.stage, expectedOriginal: item.original })
      const itemIndex = items.value.findIndex(entry => entry.id === item.id)
      if (itemIndex !== -1) items.value[itemIndex] = saved
      await persistDraft(item, '', 0, true)
      choose(saved)
      notice.value = '译文已保存至 ParaTranz'
        try {
          file.value = await api<FileInfo>('file', { projectId: project.value.id, fileId: file.value.id })
          const at = files.value.findIndex(entry => entry.id === file.value.id); if (at !== -1) files.value[at] = file.value
        } catch (reason) { error.value = `译文已保存，但文件统计刷新失败：${(reason as Error).message}` }
      const leavesFilter = stageFilter.value !== null && saved.stage !== stageFilter.value
      if (connected.value && (next || leavesFilter)) {
        if (advance && !nextId && !leavesFilter && previousPage < previousPageCount) page.value = previousPage + 1
        await loadStrings(nextId, advance ? undefined : saved)
        if (!items.value.length && page.value > 1) { page.value--; await loadStrings(undefined, advance ? undefined : saved) }
      }
      else if (advance) choose(visibleItems.value.find(entry => entry.id === nextId) || visibleItems.value[0] || null)
      if (!advance && !visibleItems.value.some(entry => entry.id === saved.id)) {
        detachedNeighbors = { previousId, nextId, index, page: previousPage }
        notice.value += ' · 当前词条已不符合列表筛选，仍保留在编辑器中'
      }
    } catch (reason) { error.value = (reason as Error).message }
    finally { saving.value = false }
  }
  async function move(direction: number) {
    if (saving.value || listBusy.value || initializing.value) return
    const at = visibleItems.value.findIndex(item => item.id === selected.value?.id)
    let target = visibleItems.value[at + direction]
    if (at < 0 && detachedNeighbors) {
      const id = direction > 0 ? detachedNeighbors.nextId : detachedNeighbors.previousId
      target = visibleItems.value.find(item => item.id === id)
      if (!target && detachedNeighbors.page === page.value) target = visibleItems.value[detachedNeighbors.index + (direction > 0 ? 0 : -1)]
      if (!target && direction < 0 && detachedNeighbors.page > page.value) target = visibleItems.value.at(-1)
    }
    if (target) await select(target)
    else if (direction > 0 && page.value < pageCount.value) await paginate(page.value + 1)
    else if (direction < 0 && page.value > 1) { await paginate(page.value - 1); const last = visibleItems.value.at(-1); if (last) choose(last) }
  }
  async function reloadSelected() {
    if (!selected.value || !connected.value || reloadBusy.value || saving.value || listBusy.value) return
    const item = selected.value
    reloadBusy.value = true
    try {
      await flushDraft()
      const data = await api<StringItem>('string', { projectId: item.project, stringId: item.id })
      if (selected.value?.id !== item.id || selected.value.project !== item.project) return
      const index = items.value.findIndex(item => item.id === data.id); if (index !== -1) items.value[index] = data
      choose(data); notice.value = '已载入远端版本，本地草稿保留在编辑框'
    } catch (reason) { error.value = (reason as Error).message }
    finally { reloadBusy.value = false }
  }
  async function discardDraft() {
    if (!selected.value) return
    clearTimeout(draftTimer); await persistDraft(selected.value, '', 0, true); choose(selected.value)
  }
  async function resetWorkspace() {
    await flushDraft(); connected.value = false; sessionInfo.value = { authenticated: false, mode: 'none' }
    workspaceReady.value = false
    items.value = []; project.value = emptyProject(); file.value = emptyFile(); files.value = []; drafts.value = {}
    fileId.value = 0; stageFilter.value = 0; search.value = ''; page.value = 1; rowCount.value = 0; pageCount.value = 1; error.value = ''; notice.value = ''; selectedIds.value = []; draftStatus.value = ''
    choose(null)
  }
  async function restoreSession(session: SessionStatus) {
    await flushDraft()
    sessionInfo.value = session; connected.value = session.authenticated; workspaceReady.value = false
    choose(null)
    if (connected.value) drafts.value = await api<Record<string, Draft>>('drafts')
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
    if (presenceLoginBusy.value || saving.value || listBusy.value || initializing.value || reloadBusy.value || !window.scKit) return
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
  onBeforeUnmount(() => { clearTimeout(draftTimer); clearTimeout(searchTimer); ++auxSequence; ++historySequence; ++termsSequence; flushDraft() })
  return { desktop, connected, initializing, workspaceReady, project, file, files, sortedFiles, items, visibleItems, selected, text, editStage, stageFilter, search, searchMode, page, pageSize, pageCount, rowCount, fileId, sort, listBusy, saving, error, notice, draftStatus, dirty, locked, issues, untranslated, selectedIds, panel, suggestions, terms, history, auxBusy, auxError, termsBusy, termsError, sessionInfo, drafts,
    presence, presenceProjectId, presenceLoginBusy, loginPresence, requestCount, reloadBusy, exportBusy, api, input, select, loadStrings, bootstrap, changeFile, refreshFiles, filter, paginate, changePageSize, loadAux, loadTerms, save, move, reloadSelected, discardDraft, resetWorkspace, restoreSession, flushDraft, exportPage }
}
