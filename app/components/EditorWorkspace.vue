<script setup lang="ts">
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Copy, Undo2, Search, Filter, Check, CheckCheck, Circle, TriangleAlert, Settings2, Keyboard, BarChart3, BookOpen, ExternalLink, RefreshCw, Download, X, Minus, Square, Link, MoreHorizontal, TextCursorInput, WrapText, Cloud, Monitor, FolderOpen, Files, Languages } from 'lucide-vue-next'
import { stageLabels, displayDate, tokens } from '~/utils/text'
import type { UnwrapNestedRefs } from 'vue'
import type { LocalUnresolvedTerm, StringItem, StringPage, Term, TranslationSettings } from '~/types/editor'
import { saveModes, type SaveMode } from '~/utils/saveModes'
import { toEditorText } from '~/utils/translationText'
import { searchHighlightParts } from '~/utils/searchHighlight'
import { highlightTranslatedTerms, replaceSourceTerms, termTranslationAlternatives } from '~/utils/termHighlights'
import { readLocalUnresolvedTerms } from '~/utils/localUnresolvedTerms'
import type { QualityLocation } from '~/utils/quality'
import { MAX_PREFILL_CONCURRENCY, normalizePrefillConcurrency, runConcurrentPrefill } from '~/utils/batchPrefill'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const e = props.editor
const navigation = inject<import('~/composables/useWorkspaceNavigation').WorkspaceNavigation>('workspace-navigation')!
const showConnection = toRef(navigation, 'showConnection'), showShortcuts = ref(false), showOverview = ref(false), showMenu = ref(false)
async function openManager() { await navigation.goHome() }
function changeFile(id: number) { const file = e.files.find(f => f.id === id); if (file) navigation.chooseFile(file) }
const fileOptions = computed(() => e.sortedFiles.map(file => ({ value: file.id, label: file.name })))
const searchOptions = [{ value: 'text', label: '文本与键值' }, { value: 'original', label: '原文' }, { value: 'translation', label: '译文' }, { value: 'key', label: '键值' }, { value: 'context', label: '上下文' }]
const stageOptions = [{ value: 'all' as const, label: '所有状态' }, ...Object.entries(stageLabels).map(([value, label]) => ({ value: Number(value), label }))]
const sortOptions = [{ value: 'default', label: '默认' }, { value: 'key', label: '键值 A–Z' }, { value: 'length', label: '原文长度' }, { value: 'updated', label: '最近修改' }]
const pageSizeOptions = [50, 100, 200, 500].map(value => ({ value, label: `${value} / 页` }))
const saveStageOptions = [0, 1, 2, 3, 5].map(value => ({ value, label: stageLabels[value]! }))
const theme = inject<Ref<string>>('workspace-theme')!, showBreaks = ref(true), saveMode = ref<SaveMode>('next'), clearAfterSaveNext = ref(true)
const termRecognitionEnabled = inject<Ref<boolean>>('workspace-term-recognition')!
const termExemptionPatterns = inject<Ref<RegExp[]>>('workspace-term-exemption-patterns')!
const translationLayout = inject<Ref<'horizontal' | 'vertical'>>('workspace-translation-layout')!
const communityUnresolvedTerms = useState<LocalUnresolvedTerm[]>('sckit-community-unresolved-terms', () => [])
watch(() => e.project.id, projectId => { communityUnresolvedTerms.value = readLocalUnresolvedTerms(projectId) }, { immediate: true })
watch(saveMode, value => { try { localStorage.setItem('sckit-save-mode', value) } catch { /* Keep the choice for this session. */ } })
function changeSaveStage(stage: number) {
  if (e.locked || e.listBusy || e.initializing || e.reloadBusy) return
  e.restoreClearedTranslation()
  typingGroupOpen = false
  e.editStage = stage
  const mode = saveModes.find(option => option.id === saveMode.value)
  if (mode?.stage !== undefined && mode.stage !== stage) saveMode.value = 'next'
}
function submitSelectedMode() {
  const mode = saveModes.find(option => option.id === saveMode.value) || saveModes[0]!
  return e.save(mode.next, mode.stage, clearAfterSaveNext.value)
}
function submitDisputedMode(next: boolean) { return e.save(next, 2, clearAfterSaveNext.value) }
const translationInput = ref<HTMLTextAreaElement>(), workspace = ref<HTMLElement>(), editorPanel = ref<HTMLElement>(), sourceContent = ref<HTMLElement>()
const dictionarySelection = useState('cambridge-selected-word', () => '')
watch(() => [e.project.id, e.selected?.id], () => { dictionarySelection.value = '' })
type TermTranslationOption = { translation: string; terms: string[] }
type TermTranslationPosition = { x: number; y: number; focus: boolean }
const termTranslationOptions = ref<TermTranslationOption[]>([]), termTranslationPopup = ref<HTMLElement>()
const termTranslationPopupStyle = ref({ left: '0px', top: '0px' })
watch(() => e.selected?.id, closeTermTranslationPicker)
watch(termRecognitionEnabled, enabled => { if (!enabled) closeTermTranslationPicker() })
const translationText = computed(() => toEditorText(e.text))
const originalSearchQuery = computed(() => ['text', 'original'].includes(e.searchMode) ? e.search : '')
const translationSearchQuery = computed(() => ['text', 'translation'].includes(e.searchMode) ? e.search : '')
const translationHighlights = computed(() => highlightTranslatedTerms(translationText.value, termRecognitionEnabled.value ? e.terms : [], termExemptionPatterns.value).map(piece => ({ ...piece, searchParts: searchHighlightParts(piece.text, translationSearchQuery.value) })))
const translationHighlightOffset = ref({ top: 0, left: 0 })
function syncTranslationHighlightScroll() {
  translationHighlightOffset.value = { top: translationInput.value?.scrollTop || 0, left: translationInput.value?.scrollLeft || 0 }
}
function storedPanelLayout() {
  const defaults = { left: 47, right: 26.5, narrowLeft: 53 }
  if (!import.meta.client) return defaults
  try {
    const saved = JSON.parse(localStorage.getItem('sckit-panel-layout') || 'null')
    if (saved?.version === 1 && [saved.left, saved.right, saved.narrowLeft].every(value => typeof value === 'number' && Number.isFinite(value)) &&
      saved.left >= 28 && saved.right > 0 && saved.left + saved.right < 100 && saved.narrowLeft >= 28 && saved.narrowLeft < 100) return saved
  } catch { /* Use the initial proportions when storage is unavailable or invalid. */ }
  return defaults
}
const storedLayout = storedPanelLayout()
const leftWidth = ref<number>(storedLayout.left), rightWidth = ref<number>(storedLayout.right), narrowLeftWidth = ref<number>(storedLayout.narrowLeft), narrow = ref(false)
const workspaceWidth = ref(0)
const layoutWidths = computed(() => {
  const width = workspaceWidth.value || 1600, editorMinimum = 250 / width * 100
  const right = Math.max(220 / width * 100, Math.min(rightWidth.value, 100 - 28 - editorMinimum))
  const left = Math.max(28, Math.min(leftWidth.value, 100 - right - editorMinimum))
  return { left, right, narrowLeft: Math.max(28, Math.min(narrowLeftWidth.value, 100 - 280 / width * 100)) }
})
let panelLayoutTimer: ReturnType<typeof setTimeout> | undefined
function rememberPanelLayout() {
  clearTimeout(panelLayoutTimer)
  try { localStorage.setItem('sckit-panel-layout', JSON.stringify({ version: 1, left: leftWidth.value, right: rightWidth.value, narrowLeft: narrowLeftWidth.value })) }
  catch { /* Retain the proportions for this session when storage is unavailable. */ }
}
watch([leftWidth, rightWidth, narrowLeftWidth], () => { clearTimeout(panelLayoutTimer); panelLayoutTimer = setTimeout(rememberPanelLayout, 200) })
const editingContent = ref<HTMLElement>()
const auxiliaryPanel = ref<{ focusTerm: (id: number) => void; openHistorySearch: () => void; lookupDictionary: (word: string) => void; translateSelectedText: (text?: string, autoFill?: boolean) => Promise<void>; cancelSelectedTranslation: () => void; translateForPrefill: (text: string) => Promise<{ text: string }>; translateEntryForPrefill: (item: StringItem) => Promise<{ text: string }>; cancelPrefillTranslation: () => void; canPrefillTranslation: boolean; translationBusy: boolean }>()
const showBatchPrefill = ref(false), batchPrefillBusy = ref(false), batchPrefillError = ref('')
const batchPrefillSaving = ref(false), batchStopRequested = ref(false)
const batchPrefillScope = ref<'selected' | 'untranslated'>('selected'), batchPrefillDestination = ref<'local' | 'paratranz'>('local')
const batchPrefillConcurrency = ref(1)
watch(batchPrefillConcurrency, value => {
  try { localStorage.setItem('sckit-batch-prefill-concurrency', String(normalizePrefillConcurrency(value))) }
  catch { /* Keep the setting for this session. */ }
})
const batchPrefillProgress = ref(0), batchPrefillTotal = ref(0), batchPrefillSkipped = ref(0)
const batchPrefillSucceeded = ref(0), batchPrefillFailed = ref(0), batchPrefillFailures = ref<string[]>([])
const batchFailedItems = ref<StringItem[]>([]), batchRetryItems = ref<StringItem[] | null>(null)
const batchReport = ref<Array<{ key: string; id: number; status: 'saved' | 'failed' | 'skipped'; message?: string }>>([])
let batchPrefillRun = 0
const selectionContextMenu = ref<{ x: number; y: number; text: string; selected: string; word: string } | null>(null)
const preservedSelection = computed(() => selectionContextMenu.value ? replaceSourceTerms(selectionContextMenu.value.text, e.terms, termExemptionPatterns.value) : null)
function closeTermTranslationPicker() { termTranslationOptions.value = [] }
function positionTermTranslationPicker(position: TermTranslationPosition) {
  termTranslationPopupStyle.value = { left: `${position.x + 10}px`, top: `${position.y + 10}px` }
  void nextTick(() => {
    const popup = termTranslationPopup.value
    if (!popup) return
    const rect = popup.getBoundingClientRect(), gap = 8
    let left = position.x + 10, top = position.y + 10
    if (left + rect.width > window.innerWidth - gap) left = position.x - rect.width - 10
    if (top + rect.height > window.innerHeight - gap) top = position.y - rect.height - 10
    left = Math.max(gap, Math.min(left, window.innerWidth - rect.width - gap))
    top = Math.max(gap, Math.min(top, window.innerHeight - rect.height - gap))
    termTranslationPopupStyle.value = { left: `${left}px`, top: `${top}px` }
    if (position.focus) popup.querySelector<HTMLButtonElement>('.term-fill-pill')?.focus()
  })
}
function insertTerm(terms: Term[], position: TermTranslationPosition) {
  const options = new Map<string, TermTranslationOption>()
  for (const term of terms) {
    for (const translation of termTranslationAlternatives(term, termExemptionPatterns.value)) {
      const key = translation.toLocaleLowerCase(), previous = options.get(key)
      if (previous) {
        if (!previous.terms.includes(term.term)) previous.terms.push(term.term)
      } else options.set(key, { translation, terms: [term.term] })
    }
  }
  const choices = [...options.values()]
  if (choices.length === 1) { closeTermTranslationPicker(); insert(choices[0]!.translation) }
  else if (choices.length > 1) {
    termTranslationOptions.value = choices
    positionTermTranslationPicker(position)
  } else closeTermTranslationPicker()
}
function chooseTermTranslation(option: TermTranslationOption) {
  closeTermTranslationPicker()
  insert(option.translation)
}
function dismissTermTranslationPicker(event: PointerEvent) {
  if (!termTranslationOptions.value.length) return
  const target = event.target
  if (target instanceof Element && (termTranslationPopup.value?.contains(target) || target.closest('.term-highlight'))) return
  closeTermTranslationPicker()
}
function singleEnglishWord(value: string) {
  const term = value.trim().replace(/^[^\p{Script=Latin}\p{M}]+|[^\p{Script=Latin}\p{M}]+$/gu, '')
  return /^[\p{Script=Latin}\p{M}]+(?:['’\-][\p{Script=Latin}\p{M}]+)*$/u.test(term) ? term : ''
}
function selectedSourceText(selection: Selection): string | undefined {
  if (!selection.rangeCount) return
  const range = selection.getRangeAt(0), source = sourceContent.value
  if (!source?.contains(range.startContainer) || !source.contains(range.endContainer)) return
  const textFromNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || ''
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return ''
    if (node instanceof HTMLBRElement) return '\n'
    return Array.from(node.childNodes, textFromNode).join('')
  }
  return textFromNode(range.cloneContents())
}
function translateCurrentSource() {
  const selection = window.getSelection()
  const selected = selection && !selection.isCollapsed ? selectedSourceText(selection) : undefined
  const source = selected?.trim() ? selected : e.selected?.original || ''
  if (source.trim()) void auxiliaryPanel.value?.translateSelectedText(source, true)
}
function openSelectedTextMenu(event: MouseEvent) {
  const field = event.target === translationInput.value ? translationInput.value : undefined
  let selected = ''
  if (field && field.selectionStart !== field.selectionEnd) selected = field.value.slice(field.selectionStart, field.selectionEnd)
  else {
    const selection = window.getSelection()
    const selectionZone = event.currentTarget instanceof HTMLElement ? event.currentTarget : sourceContent.value
    if (selection && !selection.isCollapsed && selection.rangeCount && selectionZone?.contains(selection.getRangeAt(0).commonAncestorContainer)) selected = selectedSourceText(selection) ?? selection.toString()
  }
  const trimmed = toEditorText(selected).trim()
  const word = trimmed ? singleEnglishWord(trimmed) : ''
  const text = trimmed ? selected : e.selected?.original || ''
  if (!text.trim()) return
  event.preventDefault()
  selectionContextMenu.value = { x: event.clientX, y: event.clientY, text, selected: trimmed, word }
}
function selectionMenuStyle(menu: { x: number; y: number; word: string }) {
  const menuHeight = !menu.word && (e.termsBusy || (preservedSelection.value?.replacements.length || 0) > 0) ? 136 : 100
  return { left: `${Math.max(8, Math.min(menu.x, window.innerWidth - 240))}px`, top: `${Math.max(8, Math.min(menu.y, window.innerHeight - menuHeight))}px` }
}
function runSelectionContextAction(preserveTerms = false) {
  const action = selectionContextMenu.value
  if (!action) return
  selectionContextMenu.value = null
  if (action.word) auxiliaryPanel.value?.lookupDictionary(action.word)
  else {
    const source = preserveTerms ? replaceSourceTerms(action.text, e.terms, termExemptionPatterns.value).text : action.text
    void auxiliaryPanel.value?.translateSelectedText(source)
  }
}
let active = true
function updateCompactLayout() {
  if (!active || !workspace.value?.clientWidth) return
  workspaceWidth.value = workspace.value.clientWidth
  const compact = workspace.value.clientWidth <= 1456
  if (compact === narrow.value) return
  narrow.value = compact
  if (!narrow.value && e.panel === 'context') e.panel = 'suggestions'
  nextTick(fitTranslation)
}
let editorObserver: ResizeObserver | undefined
useLayoutMotion(workspace, narrow, ['.editor-panel', '.aux-panel'])
const selectedAll = computed(() => e.visibleItems.length > 0 && e.visibleItems.every(item => e.selectedIds.includes(item.id)))
const availableTokens = computed(() => [...new Set(tokens(e.selected?.original || ''))])
const progress = computed(() => e.file.total ? Math.round(e.file.translated / e.file.total * 100) : 0)
const shortcuts = [ ['Ctrl + S', '按当前保存模式提交'], ['Ctrl + Enter', '按当前保存模式提交'], ['Tab', '编辑框中按当前模式提交'], ['Alt + Z / Ctrl + Z', '撤销译文编辑或填充'], ['Alt + Shift + Z / Ctrl + Y', '重做译文编辑或填充'], ['Alt + ↑ / ↓', '上一条 / 下一条'], ['Ctrl + 1', '翻译建议'], ['Ctrl + 2', '词条历史'], ['Ctrl + 4', '项目术语'], ['Ctrl + 5', '词条评论'], ['Ctrl + F', '搜索字符串'], ['Ctrl + Shift + F', '搜索历史翻译'] ]
function captureTranslationScroll(field: HTMLTextAreaElement) {
  const positions: { node: HTMLElement; top: number; left: number }[] = []
  for (let node: HTMLElement | null = field; node; node = node.parentElement) {
    positions.push({ node, top: node.scrollTop, left: node.scrollLeft })
  }
  return () => {
    for (const { node, top, left } of positions) {
      node.scrollTop = top
      node.scrollLeft = left
    }
  }
}
let insertionVersion = 0
type TranslationSnapshot = {
  text: string; stage: number; start: number; end: number
  direction: 'forward' | 'backward' | 'none'; restoreScroll?: () => void
}
type TranslationEdit = { before: TranslationSnapshot; after: TranslationSnapshot; kind: string; time: number }
const undoEdits: TranslationEdit[] = [], redoEdits: TranslationEdit[] = []
let pendingInput: TranslationSnapshot | undefined, compositionStart: TranslationSnapshot | undefined
let writingTranslation = false, typingGroupOpen = false
function canEditTranslation() { return !!e.selected && !e.locked && !e.listBusy && !e.initializing && !e.reloadBusy }
async function loadAllUntranslated(projectId: number, fileId: number, run: number) {
  const pageSize = 800
  const first = await e.api<StringPage>('strings', { projectId, fileId, page: 1, pageSize, stage: 0 })
  const result = [...first.results]
  for (let page = 2; page <= first.pageCount; page++) {
    if (run !== batchPrefillRun || batchStopRequested.value) throw new Error('翻译已停止。')
    const next = await e.api<StringPage>('strings', { projectId, fileId, page, pageSize, stage: 0 })
    result.push(...next.results)
  }
  return result.filter(item => item.stage === 0)
}
function entryHasPrefill(item: StringItem) {
  const localDraft = e.drafts[`${item.project}/${item.id}`]
  const isCurrentDirty = e.selected?.project === item.project && e.selected.id === item.id && e.dirty
  return !!item.translation.trim() || !!localDraft?.translation.trim() || isCurrentDirty
}
function openBatchPrefill() {
  if (!e.connected || batchPrefillBusy.value) return
  batchPrefillScope.value = e.selectedIds.length ? 'selected' : 'untranslated'
  batchPrefillDestination.value = 'local'
  batchPrefillError.value = ''
  batchPrefillProgress.value = 0
  batchPrefillTotal.value = 0
  batchPrefillSkipped.value = 0
  batchPrefillSucceeded.value = 0; batchPrefillFailed.value = 0; batchPrefillFailures.value = []; batchFailedItems.value = []; batchRetryItems.value = null; batchReport.value = []
  showBatchPrefill.value = true
}
function stopBatchPrefill(message = '') {
  if (!batchPrefillBusy.value) return
  batchStopRequested.value = true
  auxiliaryPanel.value?.cancelPrefillTranslation()
  batchPrefillError.value = message || (batchPrefillSaving.value ? '已收到停止请求；当前条目保存完成后将停止。' : '正在停止翻译…')
}
watch([() => e.project.id, () => e.fileId, () => e.connected, () => e.sessionInfo.user?.id], () => {
  if (batchPrefillBusy.value) stopBatchPrefill('连接或当前文件已变化，批量预填充已停止。')
})
async function startBatchPrefill() {
  if (batchPrefillBusy.value) return
  if (!e.connected || !e.sessionInfo.authenticated) { batchPrefillError.value = '请先登录 ParaTranz 并打开项目。'; return }
  if (!auxiliaryPanel.value?.canPrefillTranslation) { batchPrefillError.value = '请在设置中启用 API 或 AI 翻译模式后再开始。'; return }
  if (!auxiliaryPanel.value.translateEntryForPrefill) { batchPrefillError.value = '翻译模块尚未就绪，请稍后重试。'; return }
  if (auxiliaryPanel.value.translationBusy) { batchPrefillError.value = '侧栏翻译正在进行，请先停止当前翻译。'; return }
  const panel = auxiliaryPanel.value
  const run = ++batchPrefillRun, projectId = e.project.id, fileId = e.fileId, accountId = e.sessionInfo.user?.id
  const destination = batchPrefillDestination.value
  batchPrefillConcurrency.value = normalizePrefillConcurrency(batchPrefillConcurrency.value)
  const concurrency = batchPrefillConcurrency.value
  const canContinue = () => run === batchPrefillRun && !batchStopRequested.value && e.connected && e.sessionInfo.authenticated && e.sessionInfo.user?.id === accountId && e.project.id === projectId && e.fileId === fileId
  const retryItems = batchRetryItems.value
  batchRetryItems.value = null
  batchPrefillBusy.value = true
  batchStopRequested.value = false
  batchPrefillError.value = ''
  batchPrefillProgress.value = 0
  batchPrefillTotal.value = 0
  batchPrefillSkipped.value = 0
  batchPrefillSucceeded.value = 0; batchPrefillFailed.value = 0; batchPrefillFailures.value = []; batchFailedItems.value = []; batchReport.value = []
  try {
    await e.flushDraft(true)
    if (!canContinue()) return
    let sourceItems: StringItem[]
    if (retryItems) sourceItems = retryItems.map(item => ({ ...item }))
    else if (batchPrefillScope.value === 'selected') {
      sourceItems = e.visibleItems.filter(item => e.selectedIds.includes(item.id)).map(item => ({ ...item }))
    } else sourceItems = await loadAllUntranslated(projectId, fileId, run)
    if (!canContinue()) return
    const targets = sourceItems.filter(item => ![9, -1].includes(item.stage) && !!item.original.trim() && !entryHasPrefill(item))
    batchPrefillSkipped.value = sourceItems.length - targets.length
    for (const item of sourceItems.filter(item => !targets.includes(item))) batchReport.value.push({ key: item.key, id: item.id, status: 'skipped' })
    batchPrefillTotal.value = targets.length
    if (!targets.length) {
      batchPrefillError.value = sourceItems.length ? '所选范围内没有可翻译条目；已有译文、本机草稿或未保存编辑的条目已跳过。' : '所选范围内没有条目。'
      return
    }
    let saveQueue = Promise.resolve()
    await runConcurrentPrefill(targets, concurrency, async item => {
      if (!canContinue()) return
      let processed = false, savingStarted = false
      try {
        const draftVersion = e.drafts[`${item.project}/${item.id}`]?.updatedAt ?? null
        if (entryHasPrefill(item)) { batchPrefillSkipped.value++; batchReport.value.push({ key: item.key, id: item.id, status: 'skipped' }); processed = true; return }
        const translated = await panel.translateEntryForPrefill(item)
        if (!canContinue()) return
        const save = saveQueue.then(async () => {
          if (!canContinue()) return
          processed = true
          if (entryHasPrefill(item)) { batchPrefillSkipped.value++; batchReport.value.push({ key: item.key, id: item.id, status: 'skipped' }); return }
          savingStarted = true
          batchPrefillSaving.value = true
          let overwroteConflict = false
          try {
            const saved = destination === 'paratranz' ? await e.savePrefillToParaTranz(item, translated.text, draftVersion) : undefined
            overwroteConflict = !!saved?.overwroteConflict
            if (destination !== 'paratranz') await e.savePrefillDraft(item, translated.text, draftVersion)
          } finally { batchPrefillSaving.value = false }
          batchPrefillSucceeded.value++
          batchReport.value.push({ key: item.key, id: item.id, status: 'saved', message: overwroteConflict ? '已覆盖远端新修改' : undefined })
        })
        saveQueue = save.catch(() => {})
        await save
      } catch (reason) {
        if (run !== batchPrefillRun || (!canContinue() && !savingStarted)) return
        processed = true
        const message = `${item.key || item.id}: ${(reason as Error).message || '失败'}`
        batchPrefillFailures.value.push(message); batchFailedItems.value.push(item); batchPrefillFailed.value++
        batchReport.value.push({ key: item.key, id: item.id, status: 'failed', message })
      } finally {
        if (processed && run === batchPrefillRun) batchPrefillProgress.value++
      }
    }, () => !canContinue())
    if (!canContinue()) return
    if (destination === 'paratranz') await e.refreshFiles().catch(() => {})
    const overwritten = batchReport.value.filter(row => row.message === '已覆盖远端新修改').length
    batchPrefillError.value = `已处理 ${batchPrefillProgress.value} / ${batchPrefillTotal.value} 条：成功 ${batchPrefillSucceeded.value}、失败 ${batchPrefillFailed.value}、跳过 ${batchPrefillSkipped.value} 条` +
      (overwritten ? `；其中 ${overwritten} 条覆盖了远端新修改。` : '。')
  } catch (reason) {
    if (run === batchPrefillRun) batchPrefillError.value = (reason as Error).message || '批量预填充失败'
  } finally {
    if (run === batchPrefillRun) {
      if (batchStopRequested.value) batchPrefillError.value = `已停止：成功 ${batchPrefillSucceeded.value}、失败 ${batchPrefillFailed.value}、跳过 ${batchPrefillSkipped.value} 条。`
      batchPrefillBusy.value = false; batchPrefillSaving.value = false; batchStopRequested.value = false
    }
  }
}
function retryBatchFailures() {
  if (!batchFailedItems.value.length || batchPrefillBusy.value) return
  batchRetryItems.value = [...batchFailedItems.value]
  void startBatchPrefill()
}
async function exportBatchReport() {
  const content = JSON.stringify({ projectId: e.project.id, fileId: e.fileId, results: batchReport.value }, null, 2)
  const name = `sckit-batch-${e.project.id}-${e.fileId}.json`
  if (window.scKit) await window.scKit.exportData(content, name)
  else { const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url) }
}
function closeBatchPrefill() {
  if (batchPrefillBusy.value) return
  showBatchPrefill.value = false
}
function translationSnapshot(text = translationText.value): TranslationSnapshot {
  const field = translationInput.value
  return { text, stage: e.editStage, start: Math.min(field?.selectionStart ?? text.length, text.length),
    end: Math.min(field?.selectionEnd ?? text.length, text.length), direction: field?.selectionDirection || 'none',
    restoreScroll: field ? captureTranslationScroll(field) : undefined }
}
function writeTranslation(value: string) {
  writingTranslation = true
  try { e.input(value) } finally { writingTranslation = false }
}
function resetTranslationHistory() {
  undoEdits.length = redoEdits.length = 0
  pendingInput = compositionStart = undefined
  typingGroupOpen = false
  ++insertionVersion
}
// A reload/discard can replace the text without changing the entry ID. Background
// saves only update its remote baseline, so they do not invalidate this history.
watch(() => [e.project.id, e.selected?.id, e.text], () => {
  if (!writingTranslation) resetTranslationHistory()
}, { flush: 'sync' })
function recordTranslationEdit(before: TranslationSnapshot, after: TranslationSnapshot, kind: string) {
  if (before.text === after.text) return
  const time = Date.now(), previous = undoEdits.at(-1)
  const typing = ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(kind)
  if (typing && typingGroupOpen && previous?.kind === kind && time - previous.time < 750 &&
    previous.after.text === before.text && previous.after.start === before.start && previous.after.end === before.end &&
    before.start === before.end && after.start === after.end) {
    previous.after = after; previous.time = time
  } else {
    undoEdits.push({ before, after, kind, time })
    if (undoEdits.length > 100) undoEdits.shift()
  }
  redoEdits.length = 0
  typingGroupOpen = typing
}
function restoreTranslationSelection(snapshot: TranslationSnapshot) {
  const field = translationInput.value, selectedId = e.selected?.id, projectId = e.project.id, version = ++insertionVersion
  nextTick(() => {
    if (!active || !field || field !== translationInput.value || field.disabled || version !== insertionVersion ||
      e.selected?.id !== selectedId || e.project.id !== projectId || field.value !== snapshot.text) return
    fitTranslation()
    field.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction)
    field.focus({ preventScroll: true })
    snapshot.restoreScroll?.()
    syncTranslationHighlightScroll()
  })
}
function changeTranslation(value: string, start: number, end = start) {
  if (!canEditTranslation() || compositionStart) return
  const before = translationSnapshot(), updated = toEditorText(value)
  writeTranslation(updated)
  const after = { ...translationSnapshot(updated), start, end, direction: 'none' as const, restoreScroll: before.restoreScroll }
  recordTranslationEdit(before, after, 'fill')
  pendingInput = undefined; typingGroupOpen = false
  restoreTranslationSelection(after)
}
function insert(value: string) {
  const content = translationText.value, inserted = toEditorText(value), before = translationSnapshot()
  const start = before.start, end = before.end
  const updated = content.slice(0, start) + inserted + content.slice(end)
  changeTranslation(updated, start + inserted.length)
}
function replace(value: string) { const updated = toEditorText(value); changeTranslation(updated, updated.length) }
function undoTranslation(redo = false) {
  if (!canEditTranslation() || compositionStart) return
  const source = redo ? redoEdits : undoEdits, target = redo ? undoEdits : redoEdits, edit = source.pop()
  if (!edit) return
  const expected = redo ? edit.before : edit.after, snapshot = redo ? edit.after : edit.before
  if (translationText.value !== expected.text) { resetTranslationHistory(); return }
  const restoreStage = e.editStage === expected.stage
  writeTranslation(snapshot.text)
  if (restoreStage) e.editStage = snapshot.stage
  target.push(edit)
  pendingInput = undefined; typingGroupOpen = false
  restoreTranslationSelection(snapshot)
}
function beforeTranslationInput(event: InputEvent) {
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    if (event.cancelable) { event.preventDefault(); undoTranslation(event.inputType === 'historyRedo') }
    return
  }
  if (!compositionStart) pendingInput = translationSnapshot()
}
function translationChanged(event: Event) {
  if (!canEditTranslation()) return
  const field = event.target as HTMLTextAreaElement, before = pendingInput || translationSnapshot()
  const kind = (event as InputEvent).inputType
  if (kind === 'historyUndo' || kind === 'historyRedo') {
    field.value = translationText.value
    undoTranslation(kind === 'historyRedo'); return
  }
  // Ignore the browser's separate undo stack: keyboard and beforeinput history
  // requests are handled above so typed edits and fills always undo in order.
  ++insertionVersion
  writeTranslation(field.value)
  if (!compositionStart) recordTranslationEdit(before, translationSnapshot(), kind || 'input')
  pendingInput = undefined
}
function beginTranslationComposition() { typingGroupOpen = false; pendingInput = undefined; compositionStart = translationSnapshot() }
function endTranslationComposition(event: CompositionEvent) {
  const before = compositionStart
  compositionStart = undefined
  if (!before || !canEditTranslation()) return
  writeTranslation((event.target as HTMLTextAreaElement).value)
  recordTranslationEdit(before, translationSnapshot(), 'composition')
  pendingInput = undefined; typingGroupOpen = false
}
function syncDictionarySelection() {
  const input = translationInput.value
  let selected = ''
  if (input && document.activeElement === input) {
    if (input.selectionStart !== input.selectionEnd) selected = input.value.slice(input.selectionStart, input.selectionEnd)
  } else {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.rangeCount && sourceContent.value?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      selected = selection.toString()
    }
  }
  selected = selected.replace(/\s+/g, ' ').trim()
  dictionarySelection.value = selected.length <= 100 && /^[\p{Script=Latin}\p{M}\p{N}'’.,!?;:()\- ]+$/u.test(selected) && /\p{Script=Latin}/u.test(selected)
    ? selected.replace(/^[^\p{Script=Latin}\p{N}]+|[^\p{Script=Latin}\p{N}]+$/gu, '') : ''
}
async function locateQuality(location: QualityLocation) {
  if (e.locked || e.listBusy || e.initializing || e.reloadBusy) return
  const selectedId = e.selected?.id, content = translationText.value
  if (content.slice(location.start, location.end) !== location.text) return
  await nextTick()
  const field = translationInput.value
  if (!field || field.disabled || e.selected?.id !== selectedId || field.value !== content) return
  field.focus({ preventScroll: true })
  field.setSelectionRange(location.start, location.end)
  const scroller = narrow.value ? editingContent.value : editorPanel.value?.querySelector<HTMLElement>('.editor-scroll')
  if (!scroller) return
  // Measure the selected span with the textarea's wrapping and typography.
  const mirror = document.createElement('div'), marker = document.createElement('span'), style = getComputedStyle(field)
  mirror.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;'
  for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'tab-size', 'text-indent', 'padding', 'box-sizing', 'border-width', 'border-style', 'word-break', 'direction']) mirror.style.setProperty(property, style.getPropertyValue(property))
  mirror.style.width = `${field.getBoundingClientRect().width}px`
  marker.textContent = content.slice(location.start, location.end)
  mirror.append(document.createTextNode(content.slice(0, location.start)), marker, document.createTextNode(content.slice(location.end)))
  document.body.append(mirror)
  try {
    const top = field.getBoundingClientRect().top + marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top
    scroller.scrollTop += top - scroller.getBoundingClientRect().top - scroller.clientHeight / 3
  } finally { mirror.remove() }
}
function toggleAll() { e.selectedIds = selectedAll.value ? [] : e.visibleItems.map(item => item.id) }
function toggleSelected(id: number) { e.selectedIds = e.selectedIds.includes(id) ? e.selectedIds.filter(value => value !== id) : [...e.selectedIds, id] }
function toggleTheme() { theme.value = theme.value === 'light' ? 'dark' : 'light'; localStorage.setItem('sckit-theme', theme.value); showMenu.value = false }
async function disconnect() { await navigation.disconnect(); showMenu.value = false }
function openString() { if (e.selected) window.scKit?.openExternal(`https://paratranz.cn/projects/${e.project.id}/strings?id=${e.selected.id}`) }
function keydown(event: KeyboardEvent) {
  if (document.querySelector('.concordance-dialog')) { if ((event.ctrlKey || event.metaKey) && ['s', 'Enter'].includes(event.key)) event.preventDefault(); return }
  if (showBatchPrefill.value) { if (event.key === 'Escape') batchPrefillBusy.value ? stopBatchPrefill() : closeBatchPrefill(); return }
  if (showConnection.value || showShortcuts.value || showOverview.value) { if (event.key === 'Escape') { showShortcuts.value = false; showOverview.value = false } return }
  if (event.key === 'Escape' && termTranslationOptions.value.length) { event.preventDefault(); closeTermTranslationPicker(); return }
  if (event.key === 'Escape' && selectionContextMenu.value) { selectionContextMenu.value = null; return }
  const key = event.key.toLowerCase(), target = event.target instanceof Element ? event.target : null
  const otherInput = target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') && target !== translationInput.value
  const altUndo = event.altKey && !event.ctrlKey && !event.metaKey && key === 'z' && !otherInput
  const editorUndo = target === translationInput.value && !event.altKey && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(key)
  if (!event.defaultPrevented && !event.isComposing && (altUndo || editorUndo)) {
    event.preventDefault(); undoTranslation(key === 'y' || event.shiftKey); return
  }
  if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void submitSelectedMode(); return }
  if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submitSelectedMode(); return }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); auxiliaryPanel.value?.openHistorySearch(); return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); document.querySelector<HTMLInputElement>('#string-search')?.focus(); return }
  if (event.ctrlKey && ['1', '2', '4', '5'].includes(event.key)) { event.preventDefault(); e.panel = ({ '1': 'suggestions', '2': 'history', '4': 'terms', '5': 'comments' } as const)[event.key as '1' | '2' | '4' | '5']; return }
  if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); e.move(event.key === 'ArrowUp' ? -1 : 1) }
}
function editorKeydown(event: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) ||
    ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) typingGroupOpen = false
  if (!event.isComposing && event.key === 'Tab' && !event.shiftKey && e.dirty) { event.preventDefault(); void submitSelectedMode() }
}
function filterEditorCopy(event: ClipboardEvent) {
  if (!event.clipboardData) return
  let selectedText = ''
  if (event.target instanceof HTMLTextAreaElement && event.target.selectionStart !== event.target.selectionEnd) {
    selectedText = event.target.value.slice(event.target.selectionStart, event.target.selectionEnd)
    selectedText = selectedText.replace(/\r/g, '')
    event.preventDefault()
    event.clipboardData.clearData()
    event.clipboardData.setData('text/plain', selectedText)
    return
  } else {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) {
      const sourceText = selectedSourceText(selection)
      if (sourceText !== undefined) {
        selectedText = sourceText.replace(/\r/g, '')
        event.preventDefault()
        event.clipboardData.clearData()
        event.clipboardData.setData('text/plain', selectedText)
        return
      }
      selectedText = selection.toString()
    }
  }
  const clipboardText = selectedText.replace(/\r/g, '')
  if (clipboardText === selectedText) return
  event.preventDefault()
  event.clipboardData.clearData()
  event.clipboardData.setData('text/plain', clipboardText)
}
function fitTranslation() {
  if (!active || CSS.supports('field-sizing', 'content')) return
  const field = translationInput.value
  if (!field) return
  const restoreScroll = captureTranslationScroll(field)
  field.style.height = '160px'
  field.style.height = `${Math.max(160, field.scrollHeight)}px`
  restoreScroll()
}
let fitFrame = 0
function scheduleFit() { cancelAnimationFrame(fitFrame); fitFrame = requestAnimationFrame(fitTranslation) }
watch(() => [e.text, e.selected?.id], () => nextTick(scheduleFit))
watch(() => [e.text, e.selected?.id], () => nextTick(syncTranslationHighlightScroll))
watch(() => e.selected?.id, () => { savedScroll.clear(); nextTick(() => { if (narrow.value) editingContent.value?.scrollTo({ top: 0 }); else editorPanel.value?.querySelector('.editor-scroll')?.scrollTo({ top: 0 }) }) })
let stopResizing: (() => void) | undefined
function resize(event: PointerEvent, side: 'left' | 'right') {
  if (event.button !== 0) return
  stopResizing?.()
  const rect = workspace.value?.getBoundingClientRect(); if (!rect) return
  if (!narrow.value) { const widths = layoutWidths.value; leftWidth.value = widths.left; rightWidth.value = widths.right }
  const move = (pointer: PointerEvent) => {
    const width = rect.width
    if (side === 'left' && narrow.value) narrowLeftWidth.value = Math.max(28, Math.min((pointer.clientX - rect.left) / width * 100, 100 - 280 / width * 100))
    else if (side === 'left') leftWidth.value = Math.max(28, Math.min((pointer.clientX - rect.left) / width * 100, 100 - rightWidth.value - 250 / width * 100))
    else rightWidth.value = Math.max(220 / width * 100, Math.min((rect.right - pointer.clientX) / width * 100, 100 - leftWidth.value - 250 / width * 100))
  }
  const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end); document.body.style.cursor = ''; document.body.style.userSelect = ''; stopResizing = undefined; rememberPanelLayout() }
  stopResizing = end
  document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', end)
  event.preventDefault()
}
function separatorLimits(side: 'left' | 'right') {
  const width = workspace.value?.getBoundingClientRect().width || workspaceWidth.value || 1600
  const current = layoutWidths.value
  if (side === 'left' && narrow.value) return { min: 28, max: 100 - 280 / width * 100, value: current.narrowLeft }
  if (side === 'left') return { min: 28, max: 100 - current.right - 250 / width * 100, value: current.left }
  return { min: current.left + 250 / width * 100, max: 100 - 220 / width * 100, value: 100 - current.right }
}
function separatorKeydown(event: KeyboardEvent, side: 'left' | 'right') {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const { min, max, value } = separatorLimits(side)
  const next = Math.max(min, Math.min(max, event.key === 'Home' ? min : event.key === 'End' ? max : value + (event.key === 'ArrowRight' ? 2 : -2)))
  if (side === 'left' && narrow.value) narrowLeftWidth.value = next
  else if (side === 'left') leftWidth.value = next
  else rightWidth.value = 100 - next
  rememberPanelLayout()
}
const savedScroll = new Map<string, number>()
let layoutObserver: ResizeObserver | undefined
function activate() {
  active = true
  window.addEventListener('keydown', keydown)
  document.addEventListener('selectionchange', syncDictionarySelection)
  nextTick(() => {
    updateCompactLayout()
    for (const [selector, top] of savedScroll) workspace.value?.querySelector(selector)?.scrollTo({ top })
  })
}
function deactivate() {
  active = false
  if (batchPrefillBusy.value) stopBatchPrefill()
  stopResizing?.()
  rememberPanelLayout()
  dictionarySelection.value = ''
  window.removeEventListener('keydown', keydown)
  document.removeEventListener('selectionchange', syncDictionarySelection)
  showMenu.value = false
}
function rememberScroll() {
  for (const selector of ['.string-list', '.editor-scroll', '.editing-content', '.aux-scroll']) {
    const node = workspace.value?.querySelector(selector)
    if (node) savedScroll.set(selector, node.scrollTop)
  }
}
onBeforeRouteLeave(() => { rememberScroll(); return true })
async function loadTranslationBehavior() {
  if (!window.scKit) return
  try {
    const result = await window.scKit.getTranslationSettings()
    if (result.ok && result.data) clearAfterSaveNext.value = result.data.clearAfterSaveNext
  } catch { /* Keep the default behavior if preferences cannot be read. */ }
}
function onTranslationSettingsUpdated(event: Event) {
  const settings = (event as CustomEvent<TranslationSettings>).detail
  if (batchPrefillBusy.value) stopBatchPrefill('翻译设置已更新，批量预填充已停止。')
  if (settings) clearAfterSaveNext.value = settings.clearAfterSaveNext
}
onMounted(() => {
  window.addEventListener('sckit:translation-settings-updated', onTranslationSettingsUpdated)
  document.addEventListener('pointerdown', dismissTermTranslationPicker, true)
  void loadTranslationBehavior()
  let previousWidth = 0
  editorObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width || 0
    if (width === previousWidth) return
    previousWidth = width; scheduleFit()
  })
  if (editorPanel.value) editorObserver.observe(editorPanel.value)
  layoutObserver = new ResizeObserver(updateCompactLayout)
  if (workspace.value) layoutObserver.observe(workspace.value)
  try {
    const stored = localStorage.getItem('sckit-save-mode')
    saveMode.value = saveModes.find(option => option.id === stored)?.id || 'next'
    batchPrefillConcurrency.value = normalizePrefillConcurrency(localStorage.getItem('sckit-batch-prefill-concurrency'))
  } catch { /* Use the default when storage is unavailable. */ }
  activate()
})
onActivated(activate)
onDeactivated(deactivate)
onBeforeUnmount(() => { if (batchPrefillBusy.value) stopBatchPrefill(); stopResizing?.(); rememberPanelLayout(); window.removeEventListener('keydown', keydown); window.removeEventListener('sckit:translation-settings-updated', onTranslationSettingsUpdated); document.removeEventListener('pointerdown', dismissTermTranslationPicker, true); document.removeEventListener('selectionchange', syncDictionarySelection); cancelAnimationFrame(fitFrame); editorObserver?.disconnect(); layoutObserver?.disconnect() })
</script>
<template>
  <div class="editor-workspace" @click="selectionContextMenu = null">
    <header class="workspace-header">
      <div class="project-navigation"><button class="project-name" :title="e.project.name" @click="openManager">{{ e.project.name }}<ChevronDown :size="13" /></button><span class="breadcrumb-divider">/</span><div class="file-picker"><AppSelect :model-value="e.fileId" :options="fileOptions" label="翻译文件" :disabled="navigation.blocked" @update:model-value="changeFile" /></div></div>
      <div class="header-actions"><div v-if="e.connected && !['connected', 'idle'].includes(e.presence.state.status)" class="presence-status" :class="e.presence.state.status" role="status"><LoadingIndicator v-if="['connecting', 'reconnecting'].includes(e.presence.state.status)" :size="12" label="正在同步占用" /><span v-else class="online-dot" :class="{ offline: e.presence.state.status !== 'connected' }"></span><span :title="e.presence.state.message || e.presence.state.editors.map(user => `${user.username} · 词条 ${user.editing}`).join('\n')">{{ e.presence.state.status === 'connected' ? `${e.presence.onlineCount} 人正在编辑` : e.presence.state.message || '正在同步占用…' }}</span><button v-if="e.presence.state.status === 'unavailable'" class="text-button" :disabled="e.presenceLoginBusy" @click="e.loginPresence()">{{ e.presenceLoginBusy ? '登录中…' : '网页登录' }}</button></div><button class="connection-button" :class="{ live: e.connected }" @click="showConnection = true"><span class="online-dot" :class="{ offline: !e.connected }"></span>{{ e.connected ? (e.sessionInfo.authenticated ? '已连接' : '登录已过期') : '连接 ParaTranz' }}</button><div class="menu-anchor"><button class="icon-button" aria-label="工作台设置" @click="showMenu = !showMenu"><MoreHorizontal :size="19" /></button><Transition name="menu"><div v-if="showMenu" class="dropdown-menu"><button @click="toggleTheme"><Settings2 :size="15" />{{ theme === 'light' ? '切换到深色模式' : '切换到浅色模式' }}</button><button @click="showShortcuts = true; showMenu = false"><Keyboard :size="15" />快捷键</button><button :disabled="e.exportBusy" @click="e.exportPage(); showMenu = false"><Download :size="15" />导出当前页 / 选中词条</button><button v-if="e.connected" @click="disconnect"><Link :size="15" />断开连接</button></div></Transition></div></div>
    </header>
    <Transition name="banner"><div v-if="e.error" class="error-banner" role="alert"><TriangleAlert :size="16" /><span>{{ e.error }}</span><button v-if="e.connected" @click="e.reloadSelected()">重新载入词条</button><button class="icon-button" aria-label="关闭错误提示" @click="e.error = ''"><X :size="15" /></button></div></Transition>
    <div class="workspace-shell" @copy="filterEditorCopy">
    <main ref="workspace" class="workspace" :style="{ '--list-width': `${narrow ? layoutWidths.narrowLeft : layoutWidths.left}%`, '--aux-share': `${layoutWidths.right / (100 - layoutWidths.left) * 100}%` }">
      <section class="list-panel" aria-label="字符串列表">
        <nav class="status-tabs" aria-label="词条筛选"><button :class="{ active: e.stageFilter === null }" @click="e.filter(null)"><strong>{{ e.file.total }}</strong><span>全部</span></button><button :class="{ active: e.stageFilter === 0 }" @click="e.filter(0)"><strong>{{ e.untranslated }}</strong><span>未翻译</span></button><button :class="{ active: e.stageFilter === 2 }" @click="e.filter(2)"><strong>{{ e.file.disputed }}</strong><span>有疑问</span></button></nav>
        <div class="filters"><div class="search-bar"><span class="filter-label"><Filter :size="13" />过滤器</span><Search :size="15" /><input id="string-search" v-model="e.search" :placeholder="e.searchMode === 'original' ? '搜索原文' : e.searchMode === 'translation' ? '搜索译文' : e.searchMode === 'key' ? '搜索键值' : e.searchMode === 'context' ? '搜索上下文' : '按文本或键值搜索'" aria-label="搜索字符串" /><button v-if="e.search" class="icon-button small" aria-label="清除搜索" @click="e.search = ''"><X :size="14" /></button></div><div class="filter-controls"><AppSelect v-model="e.searchMode" :options="searchOptions" label="搜索范围" /><AppSelect :model-value="e.stageFilter ?? 'all'" :options="stageOptions" label="词条状态" @update:model-value="value => e.filter(value === 'all' ? null : Number(value))" /><span class="filter-spacer"></span><span class="sort-label">排序方式</span><AppSelect v-model="e.sort" :options="sortOptions" label="排序方式" /><input type="checkbox" :checked="selectedAll" aria-label="选择当前页全部词条" @change="toggleAll" /></div></div>
        <div v-if="e.listProgress" class="batch-prefill-toolbar" role="status"><span>{{ e.listProgress }}</span><button class="button compact" @click="e.cancelListLoad()">停止加载</button></div>
        <div v-if="e.connected" class="batch-prefill-toolbar"><span>{{ e.selectedIds.length ? `已选 ${e.selectedIds.length} 条` : `本文件未翻译 ${e.untranslated} 条` }}</span><button class="button compact primary batch-prefill-button" :disabled="!batchPrefillBusy && (e.listBusy || e.initializing || e.reloadBusy)" :title="batchPrefillBusy ? '停止批量翻译' : '选择已选词条或本文件所有未翻译词条，并选择保存位置'" @click="batchPrefillBusy ? stopBatchPrefill() : openBatchPrefill()"><X v-if="batchPrefillBusy" :size="14" /><Languages v-else :size="14" />{{ batchPrefillBusy ? `停止 ${batchPrefillProgress}/${batchPrefillTotal}` : '全文翻译并预填充' }}</button></div>
        <div class="string-list" :class="`translation-layout-${translationLayout}`" role="listbox" aria-label="待翻译字符串" :aria-busy="e.listBusy">
          <LoadingRegion :busy="e.listBusy || e.initializing" :initial="!e.items.length" :label="e.listProgress || '正在加载词条…'">
          <div v-if="!e.visibleItems.length" class="empty-state"><Search :size="32" /><h3>没有符合条件的词条</h3><button class="button" @click="e.search = ''; e.filter(null)">清除筛选</button></div>
          <template v-else><div v-for="(item, index) in e.visibleItems" :key="item.id" class="string-row" :class="{ selected: e.selected?.id === item.id }" role="option" :aria-selected="e.selected?.id === item.id" @click="e.select(item)"><div class="row-status"><CheckCheck v-if="item.stage === 5 || item.stage === 3" :size="15" /><Check v-else-if="item.stage === 1" :size="15" /><TriangleAlert v-else-if="item.stage === 2" :size="14" /><Circle v-else :size="11" :fill="item.stage === 0 ? 'currentColor' : 'none'" /><span>{{ (e.page - 1) * e.pageSize + index + 1 }}</span></div><button type="button" class="row-content" :title="item.key" :aria-label="`打开词条 ${item.key}`" :disabled="e.listBusy || e.initializing || e.reloadBusy"><span class="row-source"><ProtectedText :text="item.original" :terms="e.selected?.id === item.id ? e.terms : []" :unresolved-terms="e.selected?.id === item.id ? communityUnresolvedTerms : []" :search-query="originalSearchQuery" /></span><span class="row-translation"><SearchHighlightedText :text="item.translation" :query="translationSearchQuery" /></span><OccupancyBadge :users="e.presence.byString.get(item.id) || []" :user-id="e.presence.state.userId" compact icon-only /></button><input type="checkbox" :checked="e.selectedIds.includes(item.id)" :aria-label="`选择词条 ${item.key}`" @click.stop @change="toggleSelected(item.id)" /></div></template>
          </LoadingRegion>
        </div>
        <footer class="list-footer"><span>{{ e.connected ? e.rowCount : e.visibleItems.length }} 条<span v-if="e.selectedIds.length"> · 已选 {{ e.selectedIds.length }}</span></span><div class="pagination"><button class="icon-button small" aria-label="第一页" :disabled="e.page === 1 || e.listBusy" @click="e.paginate(1)"><ChevronsLeft :size="15" /></button><button class="icon-button small" aria-label="上一页" :disabled="e.page === 1 || e.listBusy" @click="e.paginate(e.page - 1)"><ChevronLeft :size="15" /></button><span>{{ e.page }} / {{ e.pageCount }}</span><button class="icon-button small" aria-label="下一页" :disabled="e.page === e.pageCount || e.listBusy" @click="e.paginate(e.page + 1)"><ChevronRight :size="15" /></button><button class="icon-button small" aria-label="最后一页" :disabled="e.page === e.pageCount || e.listBusy" @click="e.paginate(e.pageCount)"><ChevronsRight :size="15" /></button></div><AppSelect :model-value="e.pageSize" :options="pageSizeOptions" label="每页词条数量" @update:model-value="e.changePageSize" /></footer>
      </section>
      <div class="resize-handle" role="separator" tabindex="0" aria-label="调整字符串列表宽度" aria-orientation="vertical" :aria-valuemin="Math.round(separatorLimits('left').min)" :aria-valuemax="Math.round(separatorLimits('left').max)" :aria-valuenow="Math.round(separatorLimits('left').value)" @pointerdown="resize($event, 'left')" @keydown="separatorKeydown($event, 'left')"></div>
      <div class="editing-columns">
      <div ref="editingContent" class="editing-content">
      <section ref="editorPanel" class="editor-panel" aria-label="译文编辑器" :aria-busy="e.reloadBusy">
        <template v-if="e.selected"><div class="editor-scroll"><div class="source-area"><div class="source-heading"><div class="source-heading-title"><span>待翻译的字符串</span><span class="current-occupancy" :title="e.presence.occupied ? '其他用户正在编辑此词条，你仍可编辑和提交。' : undefined"><OccupancyBadge :users="e.presence.current" :user-id="e.presence.state.userId" /></span></div><span class="source-metadata"><span v-if="e.termsBusy" class="source-term-status"><LoadingIndicator :size="12" label="正在获取术语" />正在获取术语…</span><button v-else-if="e.termsError" class="source-term-status term-error" :title="e.termsError" @click="e.loadTerms(true)">术语获取失败 · 重试</button><button v-else-if="e.terms.length" class="source-term-status" @click="e.panel = 'terms'">{{ e.terms.length }} 条术语</button><span class="stage-badge" :class="`stage-${e.selected.stage}`">{{ stageLabels[e.selected.stage] }}</span></span></div><div ref="sourceContent" class="source-content" @contextmenu="openSelectedTextMenu"><ProtectedText :text="e.selected.original" :breaks="showBreaks" :terms="e.terms" :unresolved-terms="communityUnresolvedTerms" :search-query="originalSearchQuery" interactive :disabled="e.locked || e.listBusy || e.initializing || e.reloadBusy" @insert="insert" @term="insertTerm" /></div></div>
          <div class="toolbelt"><button class="icon-button" title="复制原文到译文框" aria-label="复制原文到译文框" :disabled="e.locked || e.listBusy || e.initializing || e.reloadBusy" @click="replace(e.selected.original)"><Copy :size="16" /></button><button class="icon-button" :title="auxiliaryPanel?.translationBusy ? '正在翻译…' : '翻译原文并填入译文框'" aria-label="翻译原文并填入译文框" :disabled="!e.selected.original.trim() || e.listBusy || e.initializing || e.reloadBusy || auxiliaryPanel?.translationBusy" @mousedown.prevent @click="translateCurrentSource"><Languages :size="16" /></button><button class="icon-button" title="恢复当前远端译文" aria-label="恢复当前远端译文" :disabled="!e.dirty && !e.translationDisplayCleared" @click="e.discardDraft()"><Undo2 :size="16" /></button><button class="icon-button" :class="{ pressed: showBreaks }" title="显示原文的转义换行；开启时，发送给 API/AI 前会将 \n 转成真实换行" aria-label="切换原文换行显示与 API/AI 换行替换" @click="showBreaks = !showBreaks"><WrapText :size="17" /></button><button class="icon-button" title="打开术语" aria-label="打开术语面板" @click="e.panel = 'terms'"><BookOpen :size="16" /></button><span class="toolbelt-spacer"></span><span class="character-count">{{ translationText.length }} 字符</span></div>
          <div class="translation-area"><div class="translation-editor"><div class="translation-highlights" aria-hidden="true"><div :style="{ transform: `translate(${-translationHighlightOffset.left}px, ${-translationHighlightOffset.top}px)` }"><template v-for="(piece, index) in translationHighlights" :key="index"><template v-for="(part, partIndex) in piece.searchParts" :key="partIndex"><mark v-if="piece.terms?.length" class="translated-term-highlight" :class="{ 'search-match': part.hit }">{{ part.text }}</mark><mark v-else-if="part.hit" class="search-match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></template></div></div><textarea ref="translationInput" :value="translationText" aria-label="译文" @select="syncDictionarySelection" @keyup="syncDictionarySelection" @mouseup="syncDictionarySelection" @contextmenu="openSelectedTextMenu" placeholder="在此输入翻译" spellcheck="false" :disabled="e.locked || e.listBusy || e.initializing || e.reloadBusy" @beforeinput="beforeTranslationInput" @input="translationChanged" @compositionstart="beginTranslationComposition" @compositionend="endTranslationComposition" @pointerdown="typingGroupOpen = false" @blur="typingGroupOpen = false" @scroll="syncTranslationHighlightScroll" @keydown="editorKeydown"></textarea></div><div v-if="e.locked" class="locked-notice">此词条{{ stageLabels[e.selected.stage] }}，编辑已禁用。</div><div v-if="availableTokens.length" class="token-tray"><span>标记</span><button v-for="token in availableTokens" :key="token" :title="`插入 ${token}`" :disabled="e.locked || e.listBusy || e.initializing || e.reloadBusy" @click="insert(token)">{{ token }}</button></div><div class="save-row"><div class="save-controls"><AppSelect :model-value="e.editStage" :options="saveStageOptions" label="保存为词条状态" :disabled="e.locked || e.listBusy || e.initializing || e.reloadBusy" @update:model-value="changeSaveStage" /><SaveButton v-model:mode="saveMode" :editor="e" @save="submitSelectedMode" @save-disputed="submitDisputedMode" /></div></div></div>
          <div class="editor-hint"><span class="draft-status"><LoadingIndicator v-if="e.draftStatus.startsWith('正在')" :size="12" label="正在保存草稿" /><span v-else-if="e.dirty" class="draft-dot"></span>{{ e.draftStatus || (e.notice ? e.notice : 'Tab 提交并下一条') }}</span></div>
          <StringDetails :editor="e" class="desktop-details" />
        </div>
          <EditorNavigation :editor="e" class="desktop-editor-footer" @open="openString" />
        </template><div v-else class="empty-state editor-empty"><TextCursorInput :size="38" :stroke-width="1.2" /><h3>选一条字符串，开始翻译</h3></div>
      </section>
      <div class="resize-handle aux-resize-handle" role="separator" tabindex="0" aria-label="调整辅助面板宽度" aria-orientation="vertical" :aria-valuemin="Math.round(separatorLimits('right').min)" :aria-valuemax="Math.round(separatorLimits('right').max)" :aria-valuenow="Math.round(separatorLimits('right').value)" @pointerdown="resize($event, 'right')" @keydown="separatorKeydown($event, 'right')"></div>
      <AuxPanel ref="auxiliaryPanel" :editor="e" :compact="narrow" :breaks="showBreaks" @insert="insert" @replace="replace" @locate="locateQuality" @selection-context-menu="openSelectedTextMenu"><template #context><StringDetails :editor="e" /></template></AuxPanel>
      </div>
      <EditorNavigation v-if="e.selected" :editor="e" class="compact-editor-footer" @open="openString" />
      </div>
    </main>
    </div>
    <Teleport to=".app-shell"><Transition name="fade"><div v-if="termTranslationOptions.length" ref="termTranslationPopup" class="term-translation-popup" role="menu" aria-label="选择要填入的译名" :style="termTranslationPopupStyle" @pointerdown.stop @click.stop><button v-for="option in termTranslationOptions" :key="option.translation" class="term-fill-pill" role="menuitem" @click="chooseTermTranslation(option)">{{ option.translation }}</button></div></Transition></Teleport>
    <Transition name="dialog"><div v-if="showBatchPrefill" class="modal-backdrop" @click.self="closeBatchPrefill"><section class="info-dialog batch-prefill-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-prefill-title" :aria-busy="batchPrefillBusy"><button class="icon-button modal-close" aria-label="关闭批量预填充窗口" :disabled="batchPrefillBusy" @click="closeBatchPrefill"><X :size="18" /></button><Languages :size="28" class="dialog-icon" /><h2 id="batch-prefill-title">全文翻译并预填充</h2><p class="dialog-description">翻译当前文件中的原文。读取时已有译文、本机草稿和未保存编辑的条目会跳过；提交到 ParaTranz 时若远端随后发生修改，仍会覆盖。</p><fieldset class="batch-prefill-options" :disabled="batchPrefillBusy"><legend>选择翻译范围</legend><label><input v-model="batchPrefillScope" type="radio" name="batch-prefill-scope" value="selected" /><span><strong>已选中的文本</strong><small>{{ e.selectedIds.length }} 条，仅限当前列表页的勾选项。</small></span></label><label><input v-model="batchPrefillScope" type="radio" name="batch-prefill-scope" value="untranslated" /><span><strong>本文件所有未翻译文本</strong><small>读取整个当前文件的未翻译条目（约 {{ e.untranslated }} 条），不受当前页和搜索结果限制。</small></span></label></fieldset><fieldset class="batch-prefill-options" :disabled="batchPrefillBusy"><legend>选择保存位置</legend><label><input v-model="batchPrefillDestination" type="radio" name="batch-prefill-destination" value="local" /><span><strong>只保存在本机</strong><small>保存为本机草稿，ParaTranz 词条状态保持不变。</small></span></label><label><input v-model="batchPrefillDestination" type="radio" name="batch-prefill-destination" value="paratranz" /><span><strong>保存到 ParaTranz</strong><small>提交译文并将词条状态设为“未翻译”。</small></span></label></fieldset><fieldset class="batch-prefill-options" :disabled="batchPrefillBusy"><legend>执行设置</legend><label class="batch-prefill-concurrency" for="batch-prefill-concurrency"><span><strong>并发数量</strong><small id="batch-prefill-concurrency-description">同时翻译的条目数，默认 1。按翻译服务允许的并发数量设置。</small></span><input id="batch-prefill-concurrency" v-model.number="batchPrefillConcurrency" class="form-input" type="number" min="1" :max="MAX_PREFILL_CONCURRENCY" step="1" aria-describedby="batch-prefill-concurrency-description" @change="batchPrefillConcurrency = normalizePrefillConcurrency(batchPrefillConcurrency)" /></label></fieldset><div v-if="batchPrefillBusy" class="batch-prefill-progress" role="status"><div><LoadingIndicator :size="15" label="正在翻译" />正在翻译并保存 {{ batchPrefillProgress }} / {{ batchPrefillTotal }} 条</div><div class="progress-track"><span :style="{ width: `${batchPrefillTotal ? batchPrefillProgress / batchPrefillTotal * 100 : 0}%` }"></span></div></div><p v-if="batchPrefillError" class="batch-prefill-result" role="status">{{ batchPrefillError }}</p><details v-if="batchPrefillFailures.length"><summary>查看全部 {{ batchPrefillFailures.length }} 条失败记录</summary><p v-for="(failure, index) in batchPrefillFailures" :key="index">{{ failure }}</p></details><div v-if="batchReport.length" class="batch-prefill-actions"><button class="button compact" :disabled="batchPrefillBusy" @click="exportBatchReport">导出处理报告</button><button v-if="batchFailedItems.length" class="button compact" :disabled="batchPrefillBusy" @click="retryBatchFailures">重试失败项</button></div><div class="batch-prefill-actions"><button class="button" :disabled="batchPrefillBusy" @click="closeBatchPrefill">关闭</button><button v-if="batchPrefillBusy" class="button primary" @click="stopBatchPrefill()"><X :size="14" />停止</button><button v-else class="button primary" :disabled="!auxiliaryPanel?.canPrefillTranslation || (batchPrefillScope === 'selected' && !e.selectedIds.length) || !e.connected || !e.sessionInfo.authenticated" @click="startBatchPrefill"><Languages :size="14" />开始翻译并预填充</button></div></section></div></Transition>
    <Transition name="dialog"><div v-if="showShortcuts || showOverview" class="modal-backdrop" @click.self="showShortcuts = false; showOverview = false"><section class="info-dialog" role="dialog" aria-modal="true" :aria-label="showShortcuts ? '快捷键' : '文件概览'"><button class="icon-button modal-close" aria-label="关闭窗口" @click="showShortcuts = false; showOverview = false"><X :size="18" /></button><template v-if="showShortcuts"><Keyboard :size="28" class="dialog-icon" /><h2>快捷键</h2><div v-for="[key, label] in shortcuts" :key="key" class="shortcut-row"><span>{{ label }}</span><kbd>{{ key }}</kbd></div></template><template v-else><BarChart3 :size="28" class="dialog-icon" /><h2>文件概览</h2><p class="dialog-description">{{ e.file.name }}<span v-if="!e.connected"> · 7 条样例</span></p><div class="progress-heading"><strong>{{ progress }}<small>%</small></strong><span>{{ e.file.translated }} / {{ e.file.total }} 已翻译</span></div><div class="progress-track"><span :style="{ width: `${progress}%` }"></span></div><div class="overview-stats"><div><span>未翻译</span><strong>{{ e.untranslated }}</strong></div><div><span>有疑问</span><strong>{{ e.file.disputed }}</strong></div><div><span>已检查</span><strong>{{ e.file.checked }}</strong></div><div><span>已审核</span><strong>{{ e.file.reviewed }}</strong></div></div></template></section></div></Transition>
    <Teleport to=".app-shell"><Transition name="menu"><div v-if="selectionContextMenu" class="selection-context-menu" role="menu" :style="selectionMenuStyle(selectionContextMenu)" @click.stop><button role="menuitem" @click="runSelectionContextAction()">{{ selectionContextMenu.word ? '查询剑桥中文释义' : selectionContextMenu.selected ? '翻译所选内容到简体中文' : '翻译当前句子到简体中文' }}</button><button v-if="!selectionContextMenu.word && (e.termsBusy || (preservedSelection?.replacements.length || 0) > 0)" role="menuitem" :disabled="e.termsBusy || !preservedSelection?.replacements.length" @click="runSelectionContextAction(true)">{{ e.termsBusy ? '保留译名翻译（术语加载中…）' : `保留译名翻译（${preservedSelection?.replacements.length} 处）` }}</button><p>{{ selectionContextMenu.text }}</p></div></Transition></Teleport>
  </div>
</template>
