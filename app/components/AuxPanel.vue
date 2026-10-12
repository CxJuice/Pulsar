<script setup lang="ts">
import { Lightbulb, History, BookOpen, ShieldCheck, MessageSquare, ArrowDownToLine, Search, TriangleAlert, RotateCw, GitCompareArrows, Languages, GripVertical, ChevronUp, ChevronDown, ExternalLink, X } from 'lucide-vue-next'
import AuxDockLayout, { type AuxDockNode, type AuxDockTab, type AuxDockZone } from './AuxDockLayout.vue'
import type { UnwrapNestedRefs } from 'vue'
import type { useEditor } from '~/composables/useEditor'
import type { AuxCustomizationAction, AuxCustomizationOverlayState, CambridgeDictionaryData, HistoryEntry, LocalUnresolvedTerm, StringItem, Suggestion, TranslationLlmContextSettings, TranslationMode, TranslationPromptContext, TranslationProvider, TranslationSettings } from '~/types/editor'
import { displayDate, stageLabels } from '~/utils/text'
import { toEditorText, toTranslationRequestText } from '~/utils/translationText'
import { replaceSourceTerms } from '~/utils/termHighlights'
import { matchLocalUnresolvedTerms, readLocalUnresolvedTerms } from '~/utils/localUnresolvedTerms'
import { BatchTranslationRequests } from '~/utils/batchPrefill'
import type { QualityLocation } from '~/utils/quality'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>>; compact?: boolean; breaks?: boolean }>()
const emit = defineEmits<{ insert: [text: string]; replace: [text: string]; locate: [location: QualityLocation]; selectionContextMenu: [event: MouseEvent] }>()
const layoutPreview = import.meta.dev && useRoute().path === '/layout-preview'
const termPanel = ref<{ focusTerm: (id: number) => void }>()
const memorySearch = ref<{ focus: () => void }>()
const translatorHost = ref<HTMLElement>(), cambridgeSearch = ref<HTMLInputElement>()
const customizationBounds = ref<HTMLElement>()
const dictionarySelection = useState('cambridge-selected-word', () => '')
const dictionaryTerm = ref(dictionarySelection.value), dictionaryError = ref('')
const dictionaryQueried = ref(false), dictionaryBusy = ref(false)
const dictionaryData = ref<CambridgeDictionaryData | null>(null)
const translationMode = ref<'translate' | 'dictionary'>('translate')
const translationSource = ref(''), translationResult = ref(''), translationError = ref(''), translationResultNotice = ref('')
const translationBusy = ref(false)
const translationProvider = ref<TranslationProvider>('google'), translationAccessMode = ref<TranslationMode>('web')
const useTermTranslations = ref(true)
const translationLlmModel = ref(''), translationLlmContext = ref<TranslationLlmContextSettings>({ key: true, recommendations: true, recommendationCount: 1, terms: true, notes: true })
const translationApiProvider = ref<TranslationProvider | null>(null), translationWebQueried = ref(false)
const translationSettingsReady = ref(false)
let translationRequest = 0, prefillRequest = 0, dictionaryRequest = 0, translationStarting = false, translationEntryVersion = 0
let activeTranslationRequestId: string | null = null, activePrefillRequestId: string | null = null
let prefillFollowsSelection = false
let dictionaryObserver: ResizeObserver | undefined, dictionaryFrame = 0, auxPreferencesFrame = 0
let modalObserver: MutationObserver | undefined
let blockingModalPresent = false
let removeAuxCustomizationActionListener: (() => void) | undefined
function cancelTranslationRequest(requestId: string | null) {
  if (requestId) void window.scKit?.cancelTranslation(requestId).catch(() => undefined)
}
function newTranslationRequestId() { return crypto.randomUUID() }
const batchTranslationRequests = new BatchTranslationRequests(cancelTranslationRequest)
function openHistorySearch() { props.editor.panel = 'suggestions'; nextTick(() => memorySearch.value?.focus()) }
const auxRoot = ref<HTMLElement>()
const activeDockPanels = ref<string[]>([props.editor.panel])
function panelBusyFor(panel: string) { return panel === 'terms' ? props.editor.termsBusy : panel === 'suggestions' ? props.editor.suggestionsBusy : panel === 'history' ? props.editor.historyBusy : false }
function panelHasDataFor(panel: string) { return panel === 'terms' ? props.editor.terms.length > 0 : panel === 'history' ? props.editor.history.length > 0 : props.editor.suggestions.length > 0 }
function panelErrorFor(panel: string) { return panel === 'terms' ? props.editor.termsError : panel === 'suggestions' ? props.editor.suggestionsError : panel === 'history' ? props.editor.historyError : '' }
function retryPanel(panel: string) {
  if (panel === 'terms') void props.editor.loadTerms(true)
  else if (panel === 'suggestions') void props.editor.loadSuggestions(true)
  else if (panel === 'history') void props.editor.loadHistory(true)
}
function searchKeydown(event: KeyboardEvent) {
  if (props.editor.panel !== 'suggestions' || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
  event.preventDefault(); event.stopPropagation()
  openHistorySearch()
}
function focusTerm(id: number) { props.editor.panel = 'terms'; nextTick(() => termPanel.value?.focusTerm(id)) }
const plainSources = ref<number[]>([])
const concordance = ref<{ original: string; projectId: number; projectName: string } | null>(null)
watch(() => props.editor.selected?.id, () => { plainSources.value = [] })
function toggleDiff(id: number) { plainSources.value = plainSources.value.includes(id) ? plainSources.value.filter(value => value !== id) : [...plainSources.value, id] }
function lookup(suggestion?: Suggestion) {
  const e = props.editor
  concordance.value = { original: suggestion?.original || e.selected?.original || '', projectId: suggestion?.project?.id || e.project.id, projectName: suggestion?.project?.name || e.project.name }
}
function openSuggestion(suggestion: Suggestion) { window.scKit?.openExternal(`https://paratranz.cn/projects/${suggestion.project?.id || props.editor.project.id}/strings?id=${suggestion.id}`) }
function matching(value: number) { return Number.isFinite(value) ? `${Math.floor(Math.min(1, Math.max(0, value)) * 100)}%` : '—' }
function openComments() { const e = props.editor; if (e.selected) window.scKit?.openExternal(`https://paratranz.cn/projects/${e.project.id}/strings?id=${e.selected.id}`) }
watch(dictionarySelection, value => { if (value && document.activeElement !== cambridgeSearch.value) dictionaryTerm.value = value })
watch([activeDockPanels, translationMode, translationAccessMode, translationProvider], () => nextTick(scheduleDictionaryBounds))
watch(translatorHost, host => {
  dictionaryObserver?.disconnect()
  if (host) {
    dictionaryObserver = new ResizeObserver(scheduleDictionaryBounds)
    dictionaryObserver.observe(host)
    const scrollport = host.closest<HTMLElement>('.aux-dock-pane-content')
    if (scrollport) dictionaryObserver.observe(scrollport)
  }
  nextTick(scheduleDictionaryBounds)
})
function hostBounds(host?: HTMLElement) {
  const rect = host?.getBoundingClientRect()
  if (!rect || !host) return null
  let left = rect.left + host.clientLeft
  let top = rect.top + host.clientTop
  let right = left + host.clientWidth
  let bottom = top + host.clientHeight
  for (let ancestor = host.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    const clipX = style.overflowX !== 'visible'
    const clipY = style.overflowY !== 'visible'
    if (!clipX && !clipY) continue
    const bounds = ancestor.getBoundingClientRect()
    const clipLeft = bounds.left + ancestor.clientLeft
    const clipTop = bounds.top + ancestor.clientTop
    if (clipX) {
      left = Math.max(left, clipLeft)
      right = Math.min(right, clipLeft + ancestor.clientWidth)
    }
    if (clipY) {
      top = Math.max(top, clipTop)
      bottom = Math.min(bottom, clipTop + ancestor.clientHeight)
    }
  }
  left = Math.max(left, 0)
  top = Math.max(top, 0)
  right = Math.min(right, window.innerWidth)
  bottom = Math.min(bottom, window.innerHeight)
  const width = right - left
  const height = bottom - top
  if (width < 120 || height < 120) return null
  return { x: left, y: top, width, height }
}
const blockingModalSelector = '.modal-backdrop'
function hasBlockingModal() { return Boolean(document.querySelector(blockingModalSelector)) }
function observeBlockingModals() {
  const root = document.querySelector('.app-shell') || document.body
  blockingModalPresent = hasBlockingModal()
  modalObserver = new MutationObserver(() => {
    const present = hasBlockingModal()
    if (present === blockingModalPresent) return
    blockingModalPresent = present
    scheduleDictionaryBounds()
  })
  modalObserver.observe(root, { childList: true, subtree: true })
}
function syncEmbeddedViews(query?: string) {
  const bridge = window.scKit
  if (!bridge) return
  const showTranslator = activeDockPanels.value.includes('dictionary') && translationMode.value === 'translate' && translationAccessMode.value === 'web' && !hasBlockingModal()
  const translatorBounds = showTranslator ? hostBounds(translatorHost.value) : null
  bridge.translatorView({ visible: Boolean(translatorBounds), bounds: translatorBounds, provider: translationProvider.value, text: query ?? (translationWebQueried.value ? translationSource.value : ''), forceText: query !== undefined })
  syncAuxCustomizationOverlay()
}
function syncAuxCustomizationOverlay() {
  const bridge = window.scKit
  if (!bridge?.auxCustomizationOverlay) return
  const rect = customizationBounds.value?.getBoundingClientRect()
  const translationVisible = activeDockPanels.value.includes('dictionary') && translationMode.value === 'translate' && translationAccessMode.value === 'web' && !hasBlockingModal()
  const translationBounds = translationVisible ? hostBounds(translatorHost.value) : null
  const dictionaryGroup = translationBounds ? findPanelGroup(dockLayout.value, 'dictionary') : null
  const showDockZones = Boolean(draggedTab.value && translationBounds && dictionaryGroup)
  let mode: AuxCustomizationOverlayState['mode'] = showDockZones ? 'dock' : 'customize'
  let bounds: AuxCustomizationOverlayState['bounds'] = null
  if (showDockZones && translationBounds) {
    const width = Math.min(280, translationBounds.width)
    const height = Math.min(168, translationBounds.height)
    if (width >= 120 && height >= 120) bounds = {
      x: translationBounds.x + (translationBounds.width - width) / 2,
      y: translationBounds.y + (translationBounds.height - height) / 2,
      width, height,
    }
    else mode = 'customize'
  }
  const showCustomize = !showDockZones && customizationOpen.value && !hasBlockingModal() && rect && rect.width >= 120 && rect.height >= 120
  if (!bounds && showCustomize && rect) bounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  const visible = Boolean(bounds && (mode === 'dock' || showCustomize))
  const shell = document.querySelector<HTMLElement>('.app-shell')
  const style = shell ? getComputedStyle(shell) : undefined
  const theme: Record<string, string> = style ? {
    bg: style.getPropertyValue('--bg').trim(), text: style.getPropertyValue('--text').trim(), border: style.getPropertyValue('--border').trim(),
    accent: style.getPropertyValue('--accent').trim(), 'accent-soft': style.getPropertyValue('--accent-soft').trim(), muted: style.getPropertyValue('--muted').trim(),
    secondary: style.getPropertyValue('--secondary').trim(), shadow: style.getPropertyValue('--shadow').trim(),
    'font-family': style.fontFamily, 'font-size': getComputedStyle(document.body).fontSize,
  } : {}
  const state: AuxCustomizationOverlayState = {
    visible, mode, bounds, theme,
    draggedPanel: mode === 'dock' ? draggedTab.value : null,
    groupId: mode === 'dock' ? dictionaryGroup?.id ?? null : null,
    items: mode === 'dock' ? [] : orderedTabs.value.map((tab, index) => ({
      id: tab.id, label: tab.label, checked: visibleTabIds.value.includes(tab.id),
      disabled: visibleTabIds.value.includes(tab.id) && visibleTabIds.value.length <= 1,
      first: index === 0, last: index === orderedTabs.value.length - 1,
    })),
  }
  bridge.auxCustomizationOverlay(state)
}
function scheduleDictionaryBounds() {
  if (dictionaryFrame) cancelAnimationFrame(dictionaryFrame)
  dictionaryFrame = requestAnimationFrame(() => { dictionaryFrame = 0; syncEmbeddedViews() })
}
async function loadTranslationSelection() {
  if (!window.scKit) return
  try {
    const result = await window.scKit.getTranslationSettings()
    if (!result.ok || !result.data) throw new Error(result.message || '无法读取翻译设置')
    applyTranslationSettings(result.data)
    translationSettingsReady.value = true
  } catch (reason) { translationError.value = (reason as Error).message || '无法读取翻译设置' }
}
function applyTranslationSettings(settings: TranslationSettings) {
  const changed = settings.provider !== translationProvider.value || settings.mode !== translationAccessMode.value || settings.llmModel !== translationLlmModel.value || settings.useTermTranslations !== useTermTranslations.value
  translationSettingsReady.value = true
  translationProvider.value = settings.provider
  translationAccessMode.value = settings.mode
  translationLlmModel.value = settings.llmModel
  useTermTranslations.value = settings.useTermTranslations
  translationLlmContext.value = { ...settings.llmContext }
  if (changed) {
    translationRequest++
    prefillRequest++
    cancelTranslationRequest(activeTranslationRequestId)
    cancelTranslationRequest(activePrefillRequestId)
    batchTranslationRequests.cancelAll()
    activeTranslationRequestId = null
    activePrefillRequestId = null
    prefillFollowsSelection = false
    translationBusy.value = false
    translationResult.value = ''
    translationResultNotice.value = ''
    translationApiProvider.value = null
  }
  nextTick(scheduleDictionaryBounds)
}
function onTranslationSettingsUpdated(event: Event) {
  const settings = (event as CustomEvent<TranslationSettings>).detail
  if (settings) applyTranslationSettings(settings)
}
function normalizeDictionaryTerm(value: string) {
  const term = value.replace(/\s+/g, ' ').trim()
  if (term.length > 100 || !/^[\p{Script=Latin}\p{M}\p{N}'’.,!?;:()\- ]+$/u.test(term) || !/\p{Script=Latin}/u.test(term)) return ''
  return term.replace(/^[^\p{Script=Latin}\p{N}]+|[^\p{Script=Latin}\p{N}]+$/gu, '')
}
function resetCambridgeResult() {
  dictionaryRequest++
  dictionaryBusy.value = false
  dictionaryData.value = null
  dictionaryQueried.value = false
  dictionaryError.value = ''
}
async function queryCambridge(value = dictionaryTerm.value) {
  const term = normalizeDictionaryTerm(value)
  if (!term) { dictionaryError.value = '请输入英文单词或短语'; return }
  dictionaryTerm.value = term
  dictionaryError.value = ''
  dictionaryQueried.value = true
  dictionaryData.value = null
  props.editor.panel = 'dictionary'
  translationMode.value = 'dictionary'
  if (!window.scKit?.lookupCambridge) { dictionaryError.value = '剑桥词典页面读取功能仅在桌面应用中可用'; return }
  const request = ++dictionaryRequest
  dictionaryBusy.value = true
  try {
    const result = await window.scKit.lookupCambridge(term)
    if (request !== dictionaryRequest) return
    if (!result.ok || !result.data) throw new Error(result.message || '剑桥词典暂时不可用')
    dictionaryData.value = result.data
    if (!result.data.entries.length) dictionaryError.value = `剑桥词典没有找到“${term}”的词条`
  } catch (reason) {
    if (request === dictionaryRequest) dictionaryError.value = (reason as Error).message || '读取剑桥词典失败'
  } finally {
    if (request === dictionaryRequest) dictionaryBusy.value = false
  }
}
async function openCambridgeOriginal() {
  const term = normalizeDictionaryTerm(dictionaryTerm.value)
  if (!term || !window.scKit) return
  try { await window.scKit.openCambridgeOriginal(term) }
  catch (reason) { dictionaryError.value = (reason as Error).message || '无法打开剑桥词典原网页' }
}
function openCambridge() {
  props.editor.panel = 'dictionary'
  translationMode.value = 'dictionary'
  const term = normalizeDictionaryTerm(dictionarySelection.value) || normalizeDictionaryTerm(dictionaryTerm.value)
  if (term) { dictionaryTerm.value = term; void queryCambridge(term) }
  else nextTick(scheduleDictionaryBounds)
}
function lookupDictionary(value: string) {
  const term = normalizeDictionaryTerm(value)
  if (!term || /\s/.test(term)) return
  dictionaryTerm.value = term
  void queryCambridge(term)
}
function openTranslation() {
  props.editor.panel = 'dictionary'
  const selection = dictionarySelection.value.trim()
  const word = normalizeDictionaryTerm(selection)
  if (word && !/\s/.test(word)) { lookupDictionary(word); return }
  translationMode.value = 'translate'
  translationSource.value = toTranslationRequestText(selection || props.editor.selected?.original || '', props.breaks !== false)
  translationWebQueried.value = false
  nextTick(scheduleDictionaryBounds)
}
async function sourceWithConfiguredTerms(source: string, translationEntry: StringItem | null, isCurrent: () => boolean) {
  if (translationProvider.value !== 'llm' && useTermTranslations.value && translationEntry && props.editor.connected) {
    const terms = await props.editor.termsFor(translationEntry)
    if (!isCurrent()) return null
    source = replaceSourceTerms(source, terms).text
  }
  return source
}
async function requestConfiguredTranslation(source: string, translationEntry: StringItem | null, isCurrent: () => boolean, requestId: string, requireSelected = true) {
  const preparedSource = await sourceWithConfiguredTerms(source, translationEntry, isCurrent)
  if (preparedSource === null) return null
  source = preparedSource
  const [suggestions, terms] = translationProvider.value === 'llm' && translationEntry
    ? await Promise.all([
      translationLlmContext.value.recommendations ? props.editor.suggestionsFor(translationEntry) : Promise.resolve([]),
      translationLlmContext.value.terms ? props.editor.termsFor(translationEntry) : Promise.resolve([]),
    ]) : [[], []]
  if (!isCurrent()) return null
  if (requireSelected && translationEntry && (props.editor.selected?.id !== translationEntry.id || props.editor.selected?.project !== translationEntry.project)) throw new Error('当前词条已切换，请重新发起翻译')
  const context: TranslationPromptContext = {}
  if (translationProvider.value === 'llm' && translationEntry && translationLlmContext.value.key && translationEntry.key) context.key = translationEntry.key
  if (translationProvider.value === 'llm' && translationEntry && translationLlmContext.value.recommendations) {
    context.recommendations = [...suggestions]
      .sort((first, second) => (second.localMatching ?? 0) - (first.localMatching ?? 0))
      .slice(0, translationLlmContext.value.recommendationCount)
      .map(suggestion => ({ original: suggestion.original, translation: suggestion.translation, similarity: suggestion.localMatching ?? 0 }))
  }
  if (translationProvider.value === 'llm' && translationEntry && translationLlmContext.value.terms) {
    const unresolved = matchLocalUnresolvedTerms(source, readLocalUnresolvedTerms(translationEntry.project))
    const unresolvedBySource = new Map(unresolved.map(entry => [entry.source.trim().toLocaleLowerCase(), entry]))
    const unresolvedNote = (entry: LocalUnresolvedTerm) => {
      const candidates = entry.candidates.filter(Boolean).slice(0, 8)
      return `社区未定译名（${entry.sourceType}，尚未确认）；候选：${candidates.join('、') || '暂无'}。请根据当前语境参考，无法确认时保留原文。`
    }
    const confirmedTerms = terms.map(term => {
      const candidate = unresolvedBySource.get(term.term.trim().toLocaleLowerCase())
      return { term: term.term, translation: term.translation, note: [term.note, candidate ? unresolvedNote(candidate) : ''].filter(Boolean).join('；') }
    })
    const confirmedSources = new Set(terms.map(term => term.term.trim().toLocaleLowerCase()))
    const unresolvedTerms = unresolved
      .filter(entry => !confirmedSources.has(entry.source.trim().toLocaleLowerCase()))
      .map(entry => ({ term: entry.source.trim(), translation: entry.source.trim(), note: unresolvedNote(entry) }))
    context.terms = [...confirmedTerms, ...unresolvedTerms].slice(0, 50)
  }
  if (translationProvider.value === 'llm' && translationEntry && translationLlmContext.value.notes) {
    const comments = (translationEntry.comments || []).map(comment => comment.content || comment.text || '').filter(Boolean)
    context.notes = { entryContext: translationEntry.context || '', comments }
  }
  const result = await window.scKit?.translateToChinese(source, context, requestId)
  if (!isCurrent()) return null
  if (!result?.ok || !result.data?.text) throw new Error(result?.message || '翻译服务不可用')
  return result.data
}
async function translateSelectedText(value = translationSource.value, autoFill = false) {
  if (translationBusy.value || translationStarting) return
  if (!value.trim()) { translationError.value = '请输入要翻译的文本'; return }
  translationStarting = true
  props.editor.panel = 'dictionary'
  translationMode.value = 'translate'
  translationResult.value = ''
  translationError.value = ''
  translationResultNotice.value = ''
  translationApiProvider.value = null
  const entryVersion = translationEntryVersion
  const translationEntry = props.editor.selected
  const translationProjectId = props.editor.project.id
  const translationTextBeforeRequest = props.editor.text
  let request = 0, requestId: string | null = null
  try {
    if (!translationSettingsReady.value) await loadTranslationSelection()
    if (entryVersion !== translationEntryVersion) return
    if (!translationSettingsReady.value) throw new Error(translationError.value || '无法读取翻译设置')
    translationStarting = false
    request = ++translationRequest
    translationBusy.value = true
    if (translationAccessMode.value === 'web') {
      if (!window.scKit?.translatorView) throw new Error('翻译网页仅在桌面应用中嵌入显示。')
      const source = toEditorText(value)
      const preparedSource = await sourceWithConfiguredTerms(source, translationEntry, () => request === translationRequest)
      if (preparedSource === null || request !== translationRequest) return
      translationSource.value = preparedSource
      translationWebQueried.value = true
      await nextTick()
      if (request === translationRequest) syncEmbeddedViews(preparedSource)
      return
    }
    const source = toTranslationRequestText(value, props.breaks !== false)
    translationSource.value = source
    requestId = newTranslationRequestId()
    activeTranslationRequestId = requestId
    const result = await requestConfiguredTranslation(source, translationEntry, () => request === translationRequest, requestId)
    if (request !== translationRequest) return
    if (result) {
      translationResult.value = result.text
      translationApiProvider.value = result.provider
      if (autoFill) {
        if (!translationEntry) translationResultNotice.value = '译文已生成；当前没有选中的词条，无法自动填入。'
        else if (props.editor.project.id !== translationProjectId || props.editor.selected?.id !== translationEntry.id) translationResultNotice.value = '译文已生成；当前词条已切换，未自动填入以避免写错词条。'
        else if (props.editor.text !== translationTextBeforeRequest) translationResultNotice.value = '译文已生成；翻译期间编辑区已有修改，未自动覆盖。'
        else if (props.editor.locked || props.editor.listBusy || props.editor.initializing || props.editor.reloadBusy) translationResultNotice.value = '译文已生成；当前词条不可编辑，译文保留在翻译栏。'
        else emit('replace', result.text)
      }
    }
  } catch (reason) {
    if (entryVersion === translationEntryVersion && (!request || request === translationRequest)) translationError.value = (reason as Error).message || '翻译失败'
  } finally {
    translationStarting = false
    if (requestId && activeTranslationRequestId === requestId) activeTranslationRequestId = null
    if (request && request === translationRequest) translationBusy.value = false
  }
}
function cancelSelectedTranslation() {
  if (!translationBusy.value && !activeTranslationRequestId && !activePrefillRequestId) return
  translationRequest++
  prefillRequest++
  cancelTranslationRequest(activeTranslationRequestId)
  cancelTranslationRequest(activePrefillRequestId)
  batchTranslationRequests.cancelAll()
  activeTranslationRequestId = null
  activePrefillRequestId = null
  prefillFollowsSelection = false
  if (translationAccessMode.value === 'web') window.scKit?.translatorView({ visible: false, bounds: null })
  translationBusy.value = false
  translationError.value = '翻译已停止。'
}
async function translatePrefillEntry(value: string, translationEntry: StringItem | null, showResult: boolean, requireSelected: boolean) {
  const source = toTranslationRequestText(value, props.breaks !== false)
  if (!source.trim()) throw new Error('原文为空，无法翻译')
  if (translationBusy.value) throw new Error('已有翻译正在进行，请先停止当前翻译')
  const entryVersion = translationEntryVersion
  if (!translationSettingsReady.value) await loadTranslationSelection()
  if (requireSelected && entryVersion !== translationEntryVersion) throw new Error('当前词条已切换，请重新发起翻译')
  if (!translationSettingsReady.value) throw new Error(translationError.value || '无法读取翻译设置')
  if (translationAccessMode.value !== 'api') throw new Error('一键翻译预填充仅支持 API 或 AI 模式')
  if (!window.scKit?.translateToChinese) throw new Error('翻译服务仅在桌面应用中可用')
  if (requireSelected && !translationEntry) throw new Error('请先选择词条')
  if (showResult) {
    props.editor.panel = 'dictionary'
    translationMode.value = 'translate'
    translationSource.value = source
    translationResult.value = ''
    translationError.value = ''
    translationResultNotice.value = ''
    translationApiProvider.value = null
  }
  const request = ++prefillRequest
  const requestId = newTranslationRequestId()
  activePrefillRequestId = requestId
  prefillFollowsSelection = requireSelected
  translationBusy.value = true
  try {
    const result = await requestConfiguredTranslation(source, translationEntry, () => request === prefillRequest, requestId, requireSelected)
    if (!result) throw new Error(request === prefillRequest ? '翻译服务没有返回译文' : translationError.value || '翻译已停止。')
    if (showResult) {
      translationResult.value = result.text
      translationApiProvider.value = result.provider
    }
    return result
  } catch (reason) {
    if (request === prefillRequest && showResult) translationError.value = (reason as Error).message || '翻译失败'
    throw reason
  } finally {
    if (activePrefillRequestId === requestId) { activePrefillRequestId = null; prefillFollowsSelection = false }
    if (request === prefillRequest) translationBusy.value = false
  }
}
async function translateForPrefill(value: string) {
  return translatePrefillEntry(value, props.editor.selected, true, true)
}
async function translateEntryForPrefill(item: StringItem) {
  if (activeTranslationRequestId || activePrefillRequestId || translationStarting) throw new Error('已有侧栏翻译正在进行，请先停止当前翻译')
  const source = toTranslationRequestText(item.original, props.breaks !== false)
  if (!source.trim()) throw new Error('原文为空，无法翻译')
  if (!translationSettingsReady.value || translationAccessMode.value !== 'api') throw new Error('请先启用 API 或 AI 翻译模式')
  if (!window.scKit?.translateToChinese) throw new Error('翻译服务仅在桌面应用中可用')
  translationBusy.value = true
  try {
    return await batchTranslationRequests.run(async (requestId, isCurrent) => {
      const result = await requestConfiguredTranslation(source, item, isCurrent, requestId, false)
      if (!result) throw new Error(isCurrent() ? '翻译服务没有返回译文' : '翻译已停止。')
      return result
    })
  } finally { translationBusy.value = !!(activeTranslationRequestId || activePrefillRequestId || batchTranslationRequests.size) }
}
function cancelPrefillTranslation() {
  if (!activePrefillRequestId && !batchTranslationRequests.size) return
  prefillRequest++
  cancelTranslationRequest(activePrefillRequestId)
  batchTranslationRequests.cancelAll()
  activePrefillRequestId = null
  prefillFollowsSelection = false
  translationBusy.value = false
  translationError.value = '翻译已停止。'
}
const canPrefillTranslation = computed(() => translationSettingsReady.value && translationAccessMode.value === 'api')
watch([() => props.editor.selected?.project, () => props.editor.selected?.id, () => props.editor.selected?.original], () => {
  translationEntryVersion++
  translationRequest++
  cancelTranslationRequest(activeTranslationRequestId)
  activeTranslationRequestId = null
  if (prefillFollowsSelection) cancelPrefillTranslation()
  if (!activePrefillRequestId && !batchTranslationRequests.size) translationBusy.value = false
  translationSource.value = toTranslationRequestText(props.editor.selected?.original || '', props.breaks !== false)
  translationResult.value = ''
  translationError.value = ''
  translationApiProvider.value = null
  translationWebQueried.value = false
  nextTick(scheduleDictionaryBounds)
}, { immediate: true })
defineExpose({ focusTerm, openHistorySearch, lookupDictionary, translateSelectedText, cancelSelectedTranslation, translateForPrefill, translateEntryForPrefill, cancelPrefillTranslation, canPrefillTranslation, translationBusy })
function listenDictionaryLayout() {
  window.addEventListener('resize', scheduleDictionaryBounds)
  document.addEventListener('scroll', scheduleDictionaryBounds, true)
}
onMounted(() => {
  listenDictionaryLayout()
  observeBlockingModals()
  removeAuxCustomizationActionListener = window.scKit?.onAuxCustomizationAction(handleAuxCustomizationAction)
  window.addEventListener('sckit:translation-settings-updated', onTranslationSettingsUpdated)
  window.addEventListener('dragend', endDockDrag, true)
  window.addEventListener('blur', endDockDrag)
  document.addEventListener('visibilitychange', endDockDrag)
  document.addEventListener('keydown', cancelDockDragOnEscape)
  loadTranslationSelection()
  auxPreferencesFrame = requestAnimationFrame(() => {
    auxPreferencesFrame = 0
    loadAuxTabPreferences()
  })
  document.addEventListener('pointerdown', closeAuxCustomizationOnOutside)
})
onDeactivated(() => {
  endDockDrag()
  customizationOpen.value = false
  dictionaryRequest++
  translationRequest++
  cancelTranslationRequest(activeTranslationRequestId)
  activeTranslationRequestId = null
  cancelPrefillTranslation()
  translationBusy.value = false
  window.scKit?.translatorView({ visible: false, bounds: null })
  window.scKit?.auxCustomizationOverlay({ visible: false, bounds: null, items: [], theme: {} })
  dictionaryObserver?.disconnect()
})
onActivated(() => { observeBlockingModals(); nextTick(scheduleDictionaryBounds) })
onBeforeUnmount(() => {
  window.removeEventListener('sckit:translation-settings-updated', onTranslationSettingsUpdated)
  window.removeEventListener('dragend', endDockDrag, true)
  window.removeEventListener('blur', endDockDrag)
  document.removeEventListener('visibilitychange', endDockDrag)
  document.removeEventListener('keydown', cancelDockDragOnEscape)
  window.removeEventListener('resize', scheduleDictionaryBounds)
  document.removeEventListener('scroll', scheduleDictionaryBounds, true)
  document.removeEventListener('pointerdown', closeAuxCustomizationOnOutside)
  if (dictionaryFrame) cancelAnimationFrame(dictionaryFrame)
  if (auxPreferencesFrame) cancelAnimationFrame(auxPreferencesFrame)
  dictionaryObserver?.disconnect()
  modalObserver?.disconnect()
  removeAuxCustomizationActionListener?.()
  translationRequest++
  cancelTranslationRequest(activeTranslationRequestId)
  activeTranslationRequestId = null
  cancelPrefillTranslation()
  dictionaryRequest++
  window.scKit?.translatorView({ visible: false, bounds: null })
  window.scKit?.auxCustomizationOverlay({ visible: false, bounds: null, items: [], theme: {} })
})
function historyTranslation(entry: HistoryEntry) {
  let target = entry.target
  if (typeof target === 'string') { try { target = JSON.parse(target) } catch { target = undefined } }
  const value = entry.translation ?? (typeof target === 'object' ? target?.translation : undefined) ?? (entry.field === 'translation' ? entry.to : undefined)
  return typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : ''
}
const tabs = [
  { id: 'suggestions', label: '建议', icon: Lightbulb }, { id: 'history', label: '历史', icon: History },
  { id: 'terms', label: '术语', icon: BookOpen }, { id: 'quality', label: 'QA', icon: ShieldCheck }, { id: 'comments', label: '评论', icon: MessageSquare },
  { id: 'dictionary', label: '翻译', icon: BookOpen },
] as const
type AuxTabId = typeof tabs[number]['id']
type DockPanelId = AuxTabId | 'context'
const defaultTabOrder: AuxTabId[] = tabs.map(tab => tab.id)
const tabPreferencesKey = 'sckit-aux-panel-preferences'
const tabOrder = ref<AuxTabId[]>([...defaultTabOrder])
const visibleTabIds = ref<AuxTabId[]>([...defaultTabOrder])
const customizationOpen = ref(false)
watch([customizationOpen, tabOrder, visibleTabIds], () => nextTick(scheduleDictionaryBounds), { deep: true })
const draggedTab = ref<string | null>(null)
const dropTargetGroupId = ref<string | null>(null)
watch(draggedTab, () => nextTick(scheduleDictionaryBounds))
const customizeDraggedTab = ref<AuxTabId | null>(null)
const dropTargetTab = ref<AuxTabId | null>(null)
const preferencesLoaded = ref(false)
const focusedGroupId = ref('aux-group-root')
const dockLayout = ref<AuxDockNode>({ kind: 'group', id: 'aux-group-root', tabs: [...defaultTabOrder], active: 'suggestions' })
const orderedTabs = computed(() => tabOrder.value.map(id => tabs.find(tab => tab.id === id)!))
const configuredTabs = computed(() => tabOrder.value.filter(id => visibleTabIds.value.includes(id)).map(id => tabs.find(tab => tab.id === id)!))
const dockTabs = computed<AuxDockTab[]>(() => [
  ...(props.compact ? [{ id: 'context', label: '上下文', draggable: true }] : []),
  ...configuredTabs.value.map(tab => ({
    id: tab.id,
    label: tab.label,
    draggable: true,
    showCount: tab.id === 'suggestions',
    count: tab.id === 'suggestions' ? props.editor.suggestions.length : tab.id === 'terms' ? props.editor.terms.length : tab.id === 'quality' && props.editor.text ? props.editor.issues.length : 0,
    warning: tab.id === 'quality',
  })),
])
const orderedDockIds = computed<DockPanelId[]>(() => [...(props.compact ? ['context' as const] : []), ...configuredTabs.value.map(tab => tab.id)])
function isAuxTabId(value: unknown): value is AuxTabId { return typeof value === 'string' && tabs.some(tab => tab.id === value) }
function isDockPanelId(value: unknown): value is DockPanelId { return isAuxTabId(value) ? visibleTabIds.value.includes(value) : value === 'context' }
function freshDockId(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` }
function normalizeDockSizes(values: number[], count: number) {
  const usable = Array.from({ length: count }, (_, index) => Number.isFinite(values[index]) && values[index]! > 0 ? values[index]! : 1)
  const total = usable.reduce((sum, value) => sum + value, 0) || count
  return usable.map(value => value / total * 100)
}
function projectDockNode(node: AuxDockNode, includeContext: boolean): AuxDockNode | null {
  if (node.kind === 'group') {
    const tabs = node.tabs.filter(panel => panel !== 'context' || includeContext)
    if (!tabs.length) return null
    return { ...node, tabs, active: tabs.includes(node.active) ? node.active : tabs[0]! }
  }
  const children: AuxDockNode[] = [], sizes: number[] = []
  node.children.forEach((child, index) => {
    const projected = projectDockNode(child, includeContext)
    if (projected) { children.push(projected); sizes.push(node.sizes[index] || 1) }
  })
  if (!children.length) return null
  if (children.length === 1) return children[0]!
  return { ...node, children, sizes: normalizeDockSizes(sizes, children.length) }
}
const visibleDockLayout = computed(() => projectDockNode(dockLayout.value, props.compact) || dockLayout.value)
const visibleFocusedGroupId = computed(() => {
  const visible = visibleDockLayout.value
  return findDockGroup(visible, focusedGroupId.value)?.id || findPanelGroup(visible, props.editor.panel)?.id || visible.id
})
function normalizeDockNode(raw: any, seenPanels: Set<string>, seenGroups: Set<string>, depth = 0): AuxDockNode | null {
  if (!raw || typeof raw !== 'object' || depth > 10) return null
  let id = typeof raw.id === 'string' && raw.id ? raw.id : freshDockId(raw.kind === 'split' ? 'split' : 'group')
  if (seenGroups.has(id)) id = freshDockId('group')
  seenGroups.add(id)
  if (raw.kind === 'group') {
    const groupTabs: string[] = []
    if (Array.isArray(raw.tabs)) for (const value of raw.tabs) {
      if (isDockPanelId(value) && !seenPanels.has(value)) { groupTabs.push(value); seenPanels.add(value) }
    }
    if (!groupTabs.length) return null
    return { kind: 'group', id, tabs: groupTabs, active: groupTabs.includes(raw.active) ? raw.active : groupTabs[0]! }
  }
  if (raw.kind !== 'split' || !['horizontal', 'vertical'].includes(raw.direction) || !Array.isArray(raw.children)) return null
  const children: AuxDockNode[] = [], sizes: number[] = []
  raw.children.slice(0, 8).forEach((child: unknown, index: number) => {
    const normalized = normalizeDockNode(child, seenPanels, seenGroups, depth + 1)
    if (normalized) { children.push(normalized); sizes.push(Array.isArray(raw.sizes) ? Number(raw.sizes[index]) : 1) }
  })
  if (!children.length) return null
  if (children.length === 1) return children[0]!
  return { kind: 'split', id, direction: raw.direction, children, sizes: normalizeDockSizes(sizes, children.length) }
}
function makeDefaultDockLayout(): AuxDockNode {
  const ids = orderedDockIds.value
  const active = ids.includes(props.editor.panel as DockPanelId) ? props.editor.panel as DockPanelId : ids[0] || 'suggestions'
  return { kind: 'group', id: freshDockId('group'), tabs: [...ids], active }
}
function sortDockNode(node: AuxDockNode): AuxDockNode {
  if (node.kind === 'group') {
    const order = orderedDockIds.value
    return { ...node, tabs: [...node.tabs].sort((left, right) => order.indexOf(left as DockPanelId) - order.indexOf(right as DockPanelId)) }
  }
  return { ...node, children: node.children.map(sortDockNode) }
}
function appendPanelToGroup(node: AuxDockNode, groupId: string, panel: DockPanelId, activate = false): boolean {
  if (node.kind === 'group') {
    if (node.id !== groupId) return false
    if (!node.tabs.includes(panel)) node.tabs.push(panel)
    if (activate) node.active = panel
    return true
  }
  for (const child of node.children) if (appendPanelToGroup(child, groupId, panel, activate)) return true
  return false
}
function appendPanelToFirstGroup(node: AuxDockNode, panel: DockPanelId): boolean {
  if (node.kind === 'group') { if (!node.tabs.includes(panel)) node.tabs.push(panel); return true }
  return node.children.length ? appendPanelToFirstGroup(node.children[0]!, panel) : false
}
function findDockGroup(node: AuxDockNode, groupId: string): Extract<AuxDockNode, { kind: 'group' }> | null {
  if (node.kind === 'group') return node.id === groupId ? node : null
  for (const child of node.children) { const found = findDockGroup(child, groupId); if (found) return found }
  return null
}
function findPanelGroup(node: AuxDockNode, panel: string): Extract<AuxDockNode, { kind: 'group' }> | null {
  if (node.kind === 'group') return node.tabs.includes(panel) ? node : null
  for (const child of node.children) { const found = findPanelGroup(child, panel); if (found) return found }
  return null
}
function setGroupActive(node: AuxDockNode, groupId: string, panel: DockPanelId): boolean {
  const group = findDockGroup(node, groupId)
  if (!group || !group.tabs.includes(panel)) return false
  group.active = panel
  return true
}
function removePanelFromDock(node: AuxDockNode, panel: string): AuxDockNode | null {
  if (node.kind === 'group') {
    const remaining = node.tabs.filter(id => id !== panel)
    if (!remaining.length) return null
    return { ...node, tabs: remaining, active: node.active === panel ? remaining[0]! : node.active }
  }
  const children: AuxDockNode[] = [], sizes: number[] = []
  node.children.forEach((child, index) => {
    const next = removePanelFromDock(child, panel)
    if (next) { children.push(next); sizes.push(node.sizes[index] || 1) }
  })
  if (!children.length) return null
  if (children.length === 1) return children[0]!
  return { ...node, children, sizes: normalizeDockSizes(sizes, children.length) }
}
function splitGroupAt(node: AuxDockNode, groupId: string, added: Extract<AuxDockNode, { kind: 'group' }>, zone: AuxDockZone): { node: AuxDockNode; found: boolean } {
  if (node.kind === 'group') {
    if (node.id !== groupId) return { node, found: false }
    const horizontal = zone === 'left' || zone === 'right'
    const before = zone === 'left' || zone === 'top'
    return { node: { kind: 'split', id: freshDockId('split'), direction: horizontal ? 'horizontal' : 'vertical', sizes: [50, 50], children: before ? [added, node] : [node, added] }, found: true }
  }
  for (let index = 0; index < node.children.length; index++) {
    const result = splitGroupAt(node.children[index]!, groupId, added, zone)
    if (result.found) {
      const children = [...node.children]
      children[index] = result.node
      return { node: { ...node, children }, found: true }
    }
  }
  return { node, found: false }
}
function refreshActiveDockPanels() {
  const active: string[] = []
  const visit = (node: AuxDockNode) => { if (node.kind === 'group') active.push(node.active); else node.children.forEach(visit) }
  visit(dockLayout.value)
  activeDockPanels.value = active
}
function appendMissingDockPanels() {
  for (const panel of orderedDockIds.value) if (!findPanelGroup(dockLayout.value, panel)) appendPanelToFirstGroup(dockLayout.value, panel)
  dockLayout.value = sortDockNode(dockLayout.value)
}
function loadAuxTabPreferences() {
  if (layoutPreview) {
    try {
      const saved = JSON.parse(localStorage.getItem(tabPreferencesKey) || 'null')
      if (saved?.layout?.id === 'layout-preview-root') localStorage.removeItem(tabPreferencesKey)
    } catch { /* Preview layout does not depend on browser storage. */ }
    tabOrder.value = [...defaultTabOrder]
    visibleTabIds.value = [...defaultTabOrder]
    dockLayout.value = {
      kind: 'split', id: 'layout-preview-root', direction: 'horizontal', sizes: [50, 50],
      children: [
        { kind: 'group', id: 'layout-preview-left', tabs: ['suggestions', 'history', 'terms'], active: 'suggestions' },
        { kind: 'group', id: 'layout-preview-right', tabs: ['quality', 'comments', 'dictionary'], active: 'quality' },
      ],
    }
    appendMissingDockPanels()
    preferencesLoaded.value = true
    refreshActiveDockPanels()
    return
  }
  let saved: any = null
  try {
    saved = JSON.parse(localStorage.getItem(tabPreferencesKey) || 'null')
    if (saved?.layout?.id === 'layout-preview-root') {
      localStorage.removeItem(tabPreferencesKey)
      saved = null
    }
    if (saved?.version === 1) {
      const order: AuxTabId[] = []
      if (Array.isArray(saved.order)) for (const value of saved.order) if (isAuxTabId(value) && !order.includes(value)) order.push(value)
      tabOrder.value = [...order, ...defaultTabOrder.filter(id => !order.includes(id))]
      const visible: AuxTabId[] = []
      if (Array.isArray(saved.visible)) for (const value of saved.visible) if (isAuxTabId(value) && !visible.includes(value)) visible.push(value)
      visibleTabIds.value = Array.isArray(saved.visible) ? visible : [...defaultTabOrder]
      if (!visibleTabIds.value.length) visibleTabIds.value = [...defaultTabOrder]
    }
  } catch { /* Keep the default tabs when browser storage is unavailable or invalid. */ }
  const seenPanels = new Set<string>(), seenGroups = new Set<string>()
  dockLayout.value = normalizeDockNode(saved?.layout, seenPanels, seenGroups) || makeDefaultDockLayout()
  appendMissingDockPanels()
  if (props.editor.panel !== 'context' && !visibleTabIds.value.includes(props.editor.panel as AuxTabId)) props.editor.panel = configuredTabs.value[0]?.id || 'suggestions'
  if (props.editor.panel === 'context' && !props.compact) props.editor.panel = configuredTabs.value[0]?.id || 'suggestions'
  const currentGroup = findPanelGroup(dockLayout.value, props.editor.panel)
  if (currentGroup) { currentGroup.active = props.editor.panel; focusedGroupId.value = currentGroup.id }
  else if (props.editor.panel !== 'context') { appendPanelToFirstGroup(dockLayout.value, props.editor.panel); const group = findPanelGroup(dockLayout.value, props.editor.panel); if (group) { group.active = props.editor.panel; focusedGroupId.value = group.id } }
  if (!findDockGroup(dockLayout.value, focusedGroupId.value)) focusedGroupId.value = findPanelGroup(dockLayout.value, props.editor.panel)?.id || 'aux-group-root'
  preferencesLoaded.value = true
  refreshActiveDockPanels()
  saveAuxTabPreferences()
}
function saveAuxTabPreferences() {
  if (layoutPreview) return
  try { localStorage.setItem(tabPreferencesKey, JSON.stringify({ version: 1, order: tabOrder.value, visible: visibleTabIds.value, layout: dockLayout.value })) }
  catch { /* Keep tab preferences for this session when browser storage is unavailable. */ }
}
function toggleAuxTab(id: AuxTabId) {
  if (visibleTabIds.value.includes(id)) {
    if (visibleTabIds.value.length <= 1) return
    visibleTabIds.value = visibleTabIds.value.filter(value => value !== id)
    dockLayout.value = removePanelFromDock(dockLayout.value, id) || makeDefaultDockLayout()
    if (props.editor.panel === id) props.editor.panel = configuredTabs.value[0]?.id || 'suggestions'
  } else {
    visibleTabIds.value = [...visibleTabIds.value, id]
    if (!appendPanelToGroup(dockLayout.value, focusedGroupId.value, id)) appendPanelToFirstGroup(dockLayout.value, id)
  }
  appendMissingDockPanels()
  refreshActiveDockPanels()
  saveAuxTabPreferences()
}
function reorderAuxTab(id: AuxTabId, targetId: AuxTabId) {
  if (id === targetId) return
  const next = [...tabOrder.value]
  const fromIndex = next.indexOf(id), targetIndex = next.indexOf(targetId)
  if (fromIndex < 0 || targetIndex < 0) return
  next.splice(fromIndex, 1)
  next.splice(fromIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, id)
  tabOrder.value = next
  dockLayout.value = sortDockNode(dockLayout.value)
  saveAuxTabPreferences()
}
function moveAuxTab(id: AuxTabId, direction: -1 | 1) {
  const index = tabOrder.value.indexOf(id), nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= tabOrder.value.length) return
  const next = [...tabOrder.value]
  ;[next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!]
  tabOrder.value = next
  dockLayout.value = sortDockNode(dockLayout.value)
  saveAuxTabPreferences()
}
function startCustomizeDrag(event: DragEvent, id: AuxTabId) {
  customizeDraggedTab.value = id
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }
}
function dropCustomizeTab(event: DragEvent, targetId: AuxTabId) {
  event.preventDefault()
  const sourceId = customizeDraggedTab.value || (event.dataTransfer?.getData('text/plain') as AuxTabId | undefined)
  if (sourceId && isAuxTabId(sourceId)) reorderAuxTab(sourceId, targetId)
  customizeDraggedTab.value = null
  dropTargetTab.value = null
}
function handleDockDrop(value: { panel: string; groupId: string; zone: AuxDockZone }) {
  const panel = value.panel
  if (!isDockPanelId(panel) || (isAuxTabId(panel) && !visibleTabIds.value.includes(panel))) return
  const source = findPanelGroup(dockLayout.value, panel)
  if (!source) return
  if (value.zone === 'center') {
    if (source.id === value.groupId) setGroupActive(dockLayout.value, value.groupId, panel)
    else {
      const remaining = removePanelFromDock(dockLayout.value, panel)
      if (!remaining || !appendPanelToGroup(remaining, value.groupId, panel, true)) return
      dockLayout.value = remaining
    }
    focusedGroupId.value = value.groupId
  } else {
    if (source.id === value.groupId && source.tabs.length <= 1) return
    const remaining = removePanelFromDock(dockLayout.value, panel)
    if (!remaining) return
    const group: Extract<AuxDockNode, { kind: 'group' }> = { kind: 'group', id: freshDockId('group'), tabs: [panel], active: panel }
    const result = splitGroupAt(remaining, value.groupId, group, value.zone)
    if (!result.found) return
    dockLayout.value = result.node
    focusedGroupId.value = group.id
  }
  props.editor.panel = panel
  dockLayout.value = sortDockNode(dockLayout.value)
  refreshActiveDockPanels()
  saveAuxTabPreferences()
}
function selectDockPanel(panel: string, groupId: string) {
  if (!isDockPanelId(panel) || !setGroupActive(dockLayout.value, groupId, panel)) return
  focusedGroupId.value = groupId
  props.editor.panel = panel
  refreshActiveDockPanels()
  saveAuxTabPreferences()
}
function resizeDockSplit(value: { splitId: string; childIds: string[]; sizes: number[] }) {
  const visit = (node: AuxDockNode): boolean => {
    if (node.kind === 'group') return false
    if (node.id === value.splitId) {
      const containsId = (candidate: AuxDockNode, id: string): boolean => candidate.id === id || candidate.kind === 'split' && candidate.children.some(child => containsId(child, id))
      const childOwners = value.childIds.map(id => node.children.findIndex(child => containsId(child, id)))
      const visibleTotal = childOwners.reduce((total, index) => total + (index >= 0 ? node.sizes[index] || 0 : 0), 0)
      const sizes = normalizeDockSizes(value.sizes, value.childIds.length)
      childOwners.forEach((ownerIndex, visibleIndex) => {
        if (ownerIndex >= 0) node.sizes[ownerIndex] = sizes[visibleIndex]! * visibleTotal / 100
      })
      return true
    }
    return node.children.some(visit)
  }
  visit(dockLayout.value)
  saveAuxTabPreferences()
}
function syncEditorPanel(panel: string) {
  if (panel === 'context' && !props.compact) { props.editor.panel = configuredTabs.value[0]?.id || 'suggestions'; return }
  if (isAuxTabId(panel) && !visibleTabIds.value.includes(panel)) visibleTabIds.value = [...visibleTabIds.value, panel]
  if (!isDockPanelId(panel)) return
  let group = findPanelGroup(dockLayout.value, panel)
  if (!group) {
    if (!appendPanelToGroup(dockLayout.value, focusedGroupId.value, panel)) appendPanelToFirstGroup(dockLayout.value, panel)
    group = findPanelGroup(dockLayout.value, panel)
  }
  if (group) { group.active = panel; focusedGroupId.value = group.id }
  appendMissingDockPanels()
  refreshActiveDockPanels()
  saveAuxTabPreferences()
}
watch(() => props.editor.panel, panel => { if (preferencesLoaded.value) syncEditorPanel(panel) }, { flush: 'sync' })
watch(() => props.compact, () => {
  if (!preferencesLoaded.value) return
  appendMissingDockPanels()
  if (props.editor.panel === 'context' && !props.compact) props.editor.panel = configuredTabs.value[0]?.id || 'suggestions'
  refreshActiveDockPanels()
  saveAuxTabPreferences()
})
function beginDockDrag(panel: string, groupId: string) {
  if (!isDockPanelId(panel)) return
  draggedTab.value = panel
  dropTargetGroupId.value = groupId
  customizationOpen.value = false
}
function updateDockDropTarget(groupId: string) {
  if (draggedTab.value) dropTargetGroupId.value = groupId
}
function clearDockDropTarget(groupId: string) {
  if (dropTargetGroupId.value === groupId) dropTargetGroupId.value = null
}
function endDockDrag() {
  draggedTab.value = null
  dropTargetGroupId.value = null
}
function cancelDockDragOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && draggedTab.value) endDockDrag()
}
function updateDockFocus(groupId: string) {
  focusedGroupId.value = groupId
  const group = findDockGroup(dockLayout.value, groupId)
  if (group && isDockPanelId(group.active) && props.editor.panel !== group.active) props.editor.panel = group.active
}
function closeAuxCustomizationOnOutside(event: PointerEvent) {
  if (customizationOpen.value && !auxRoot.value?.contains(event.target as Node)) customizationOpen.value = false
}
function handleAuxCustomizationAction(action: AuxCustomizationAction) {
  if (action.type === 'dock') {
    if (isAuxTabId(action.panel) && visibleTabIds.value.includes(action.panel)) handleDockDrop({ panel: action.panel, groupId: action.groupId, zone: action.zone })
    endDockDrag()
    return
  }
  if (!customizationOpen.value) return
  if (action.type === 'close') { customizationOpen.value = false; return }
  if (!isAuxTabId(action.id)) return
  if (action.type === 'toggle') toggleAuxTab(action.id)
  else if (action.type === 'move') moveAuxTab(action.id, action.direction)
  else if (action.type === 'reorder' && isAuxTabId(action.targetId)) reorderAuxTab(action.id, action.targetId)
}
</script>
<template>
  <aside ref="auxRoot" class="aux-panel" aria-label="翻译辅助面板" @keydown="searchKeydown">
    <AuxDockLayout class="aux-dock-layout" :node="visibleDockLayout" :tabs="dockTabs" :focused-group-id="visibleFocusedGroupId" :dragging-tab="draggedTab" :drop-target-group-id="dropTargetGroupId" :customization-open="customizationOpen" @select="selectDockPanel" @focus="updateDockFocus" @drag-start="beginDockDrag" @drag-enter="updateDockDropTarget" @drag-leave="clearDockDropTarget" @drag-end="endDockDrag" @dock="handleDockDrop" @resize="resizeDockSplit" @customize="customizationOpen = !customizationOpen">
      <template #panel="{ panel }">
      <section v-if="panel === 'dictionary'" class="cambridge-panel" :class="{ 'translation-web-panel': translationMode === 'translate' && translationAccessMode === 'web', 'translation-api-panel': translationMode === 'translate' && translationAccessMode !== 'web' }" aria-label="翻译模块">
        <nav class="translation-mode-tabs" aria-label="翻译方式"><button :class="{ active: translationMode === 'translate' }" :aria-pressed="translationMode === 'translate'" @click="translationMode = 'translate'">文本翻译</button><button :class="{ active: translationMode === 'dictionary' }" :aria-pressed="translationMode === 'dictionary'" @click="openCambridge()">剑桥字典</button></nav>
        <template v-if="translationMode === 'dictionary'">
          <form class="cambridge-search" @submit.prevent="queryCambridge()">
            <div><input id="cambridge-word" ref="cambridgeSearch" v-model="dictionaryTerm" aria-label="剑桥字典查询" maxlength="100" autocomplete="off" placeholder="例如 example" @input="resetCambridgeResult" /><button class="button compact primary" :disabled="!dictionaryTerm.trim()" type="submit"><Search :size="13" />查询</button></div>
          </form>
          <div class="cambridge-result-list" aria-label="剑桥词典释义">
            <div v-if="dictionaryQueried" class="cambridge-result-toolbar">
              <div><strong>{{ dictionaryData?.word || dictionaryTerm.trim() }}</strong><div class="cambridge-pronunciations"><span v-if="dictionaryData?.ukPronunciation">英 {{ dictionaryData.ukPronunciation }}</span><span v-if="dictionaryData?.usPronunciation">美 {{ dictionaryData.usPronunciation }}</span></div></div>
              <button class="button compact cambridge-original-button" type="button" title="在浏览器中打开剑桥词典原网页" @click="openCambridgeOriginal"><ExternalLink :size="13" />原网页</button>
            </div>
            <p v-if="dictionaryBusy" class="cambridge-result-note" role="status"><span class="cambridge-loading-status"><LoadingIndicator :size="18" label="正在读取剑桥词典" />正在读取剑桥词典…</span></p>
            <p v-else-if="dictionaryError" class="sidebar-message error cambridge-result-error" role="alert">{{ dictionaryError }}</p>
            <template v-else-if="dictionaryData?.entries.length">
              <section v-for="(entry, entryIndex) in dictionaryData.entries" :key="`${entry.headword}-${entryIndex}`" class="cambridge-entry">
                <header class="cambridge-entry-heading"><strong>{{ entry.partOfSpeech || '词条' }}</strong><span v-if="entry.grammar">{{ entry.grammar }}</span></header>
                <section v-for="(sense, senseIndex) in entry.senses" :key="`${sense.guideWord}-${senseIndex}`" class="cambridge-sense">
                  <h3 v-if="sense.guideWord" class="cambridge-guideword">{{ sense.guideWord }}</h3>
                  <div v-for="(definition, definitionIndex) in sense.definitions" :key="`${definition.definition}-${definitionIndex}`" class="cambridge-definition">
                    <div class="cambridge-definition-label"><span v-if="definition.level" class="cambridge-level">{{ definition.level }}</span><span class="cambridge-definition-english">{{ definition.definition }}</span></div>
                    <strong v-if="definition.translation" class="cambridge-definition-translation">{{ definition.translation }}</strong>
                    <div v-if="definition.examples.length" class="cambridge-examples"><div v-for="(example, exampleIndex) in definition.examples" :key="exampleIndex" class="cambridge-example"><span>{{ example.english }}</span><small v-if="example.chinese">{{ example.chinese }}</small></div></div>
                  </div>
                </section>
              </section>
            </template>
            <p v-else-if="dictionaryQueried && dictionaryData" class="cambridge-result-note">没有找到可展示的释义。</p>
            <p v-else-if="!editor.desktop" class="cambridge-result-note">词典页面读取和展示仅在桌面应用中可用。</p>
            <p v-else class="cambridge-result-note">输入英文单词或短语后查询简体中文释义。</p>
          </div>
        </template>
        <template v-else>
          <div v-if="translationAccessMode === 'web'" class="translation-web-content">
            <p class="translation-web-note">文本会发送到 {{ translationProvider === 'google' ? 'Google' : 'DeepL' }} 网页；网页模式无法读取返回译文。如需自动填入编辑区，请在设置中切换到 API 模式。</p>
            <div ref="translatorHost" class="cambridge-view-host translation-web-host" :aria-label="translationProvider === 'google' ? 'Google 翻译网页' : 'DeepL 网页翻译'"><p v-if="!editor.desktop" class="cambridge-preview-note">内嵌翻译网页仅在桌面应用中显示。</p></div>
          </div>
          <template v-else>
            <form class="translation-form" @submit.prevent="translateSelectedText(translationSource, true)" @keydown.ctrl.enter.stop.prevent="translateSelectedText(translationSource, true)">
              <label for="translation-source">当前句子或选中的文本</label>
              <textarea id="translation-source" v-model="translationSource" rows="5" placeholder="输入或从编辑区右键选择文本" />
              <div class="translation-form-actions"><button v-if="translationResult" class="button compact translation-prefill-button" type="button" aria-label="再次将译文填入编辑区译文框" title="再次将译文填入编辑区译文框" :disabled="editor.locked || editor.listBusy || editor.initializing || editor.reloadBusy" @click="emit('replace', translationResult)"><ArrowDownToLine :size="16" /></button><button class="button compact primary" :disabled="translationBusy || !translationSource.trim()" type="submit"><LoadingIndicator v-if="translationBusy" :size="13" label="正在翻译" /><Languages v-else :size="14" />{{ translationBusy ? '翻译中…' : translationProvider === 'llm' ? 'LLM 翻译并填入' : 'API 翻译并填入' }}</button><button v-if="translationBusy" class="button compact" type="button" @click="cancelSelectedTranslation"><X :size="14" />停止翻译</button></div>
            </form>
          <section class="translation-result" aria-live="polite">
            <div class="translation-result-heading"><strong>中文译文</strong><span v-if="translationApiProvider" class="subtle">{{ translationApiProvider === 'google' ? 'Google API' : translationApiProvider === 'deepl' ? 'DeepL API' : `LLM · ${translationLlmModel}` }}</span></div>
            <p v-if="translationResultNotice" class="sidebar-message" role="status">{{ translationResultNotice }}</p>
            <div v-if="translationBusy" class="panel-loading"><LoadingIndicator :size="20" label="正在翻译文本" /><span>正在翻译…</span></div>
            <p v-else-if="translationError" class="sidebar-message error" role="alert">{{ translationError }}</p>
            <p v-else-if="translationResult" class="translation-result-text">{{ translationResult }}</p>
            <p v-else class="subtle translation-placeholder">右键编辑区中的选中文本，可在此通过 API 翻译成简体中文。单个英文单词会打开剑桥英汉词典；API 密钥和代理在「设置 → 翻译服务」中配置。</p>
          </section>
          </template>
        </template>
      </section>
      <TermPanel v-if="panel === 'terms'" ref="termPanel" :editor="editor" @insert="emit('insert', $event)" />
      <QualityPanel v-if="panel === 'quality'" :editor="editor" @insert="emit('insert', $event)" @locate="emit('locate', $event)" />
      <Transition name="panel" mode="out-in"><div v-if="!['terms', 'quality', 'dictionary'].includes(panel)" :key="panel" class="aux-content">
      <template v-if="panel === 'context'"><slot name="context" /></template>
      <div v-else-if="panelBusyFor(panel) && !panelHasDataFor(panel) && panel === 'history'" class="panel-loading"><LoadingIndicator :size="24" label="正在获取辅助信息" /><span>正在获取{{ tabs.find(tab => tab.id === panel)?.label }}…</span></div>
      <div v-else-if="panelErrorFor(panel) && !panelBusyFor(panel) && panel === 'history'" class="panel-error" role="alert"><TriangleAlert :size="22" /><p>{{ panelErrorFor(panel) }}</p><button class="button" @click="retryPanel(panel)"><RotateCw :size="14" />重新获取</button></div>
      <template v-else-if="panel === 'suggestions'">
        <div class="panel-heading suggestion-heading"><span>{{ editor.suggestions.length }} 可用建议</span><button class="button compact" :disabled="!editor.selected" @click="lookup()">词汇索引</button></div>
        <TranslationMemorySearch ref="memorySearch" :editor="editor" @replace="emit('replace', $event)">
          <LoadingRegion :busy="panelBusyFor(panel)" :initial="!editor.suggestions.length" label="正在获取建议…">
          <div v-if="panelErrorFor(panel) && !panelBusyFor(panel)" class="panel-error" role="alert"><TriangleAlert :size="22" /><p>{{ panelErrorFor(panel) }}</p><button class="button" @click="retryPanel(panel)"><RotateCw :size="14" />重新获取</button></div>
          <template v-else>
        <div v-if="!editor.suggestions.length" class="empty-state"><Lightbulb :size="34" :stroke-width="1.25" /><h3>暂无相似文本</h3></div>
        <article v-for="(suggestion, index) in editor.suggestions" :key="suggestion.id" class="suggestion-card">
          <div class="match-badge" title="本地计算的完整原文 Levenshtein 相似度"><strong>{{ matching(suggestion.localMatching ?? 0) }}</strong><span>匹配</span></div>
          <div class="suggestion-body" @contextmenu="emit('selectionContextMenu', $event)">
            <div class="suggestion-translation">{{ suggestion.translation.replaceAll('\\n', '\n') }}</div>
            <SuggestionSource :original="suggestion.original" :current="editor.selected?.original || ''" :show-diff="!plainSources.includes(suggestion.id)" />
            <div class="suggestion-meta"><span v-if="suggestion.stage === 2" class="stage-badge stage-2">有疑问</span><span v-if="suggestion.updatedAt">于 {{ displayDate(suggestion.updatedAt) }} </span><span v-if="suggestion.user">由 {{ suggestion.user.nickname || suggestion.user.username }} </span><span>来自 </span><button class="suggestion-origin" :disabled="!editor.desktop" :title="suggestion.key" @click="openSuggestion(suggestion)">{{ suggestion.project?.name || editor.project.name }}<span v-if="suggestion.file?.name"> / {{ suggestion.file.name }}</span></button><span> · {{ editor.project.dest }}</span><div v-if="!suggestion.file?.name" class="suggestion-key" :title="suggestion.key">{{ suggestion.key }}</div><button class="suggestion-occurrences" @click="lookup(suggestion)">显示所有出现的情况</button></div>
          </div>
          <div class="suggestion-actions"><button class="icon-button small" :aria-label="`切换建议 ${index + 1} 的原文差异`" :aria-pressed="!plainSources.includes(suggestion.id)" :title="plainSources.includes(suggestion.id) ? '显示与当前原文的差异' : '显示建议原文'" @click="toggleDiff(suggestion.id)"><GitCompareArrows :size="15" /></button><button class="icon-button small" :disabled="!suggestion.translation || editor.locked" :aria-label="`使用建议 ${index + 1}`" title="使用此译文" @click="emit('replace', suggestion.translation)"><ArrowDownToLine :size="15" /></button><span class="memory-label">TM</span></div>
        </article>
        
          </template>
          </LoadingRegion>
        </TranslationMemorySearch>
      </template>
      <template v-else-if="panel === 'history'">
        <div class="panel-heading"><span>词条历史</span><span class="subtle">{{ editor.history.length }} 条记录</span></div>
        <div v-if="!editor.history.length" class="empty-state"><History :size="34" :stroke-width="1.25" /><h3>还没有修改记录</h3></div>
        <article v-for="(entry, index) in editor.history" :key="entry.id || index" class="history-card"><div class="history-dot"></div><div class="history-body"><div class="history-heading"><strong>{{ entry.user?.nickname || entry.user?.username || '项目成员' }}</strong><time>{{ displayDate(entry.createdAt) }}</time></div><p class="subtle">{{ entry.operation || '更新词条' }}<span v-if="entry.stage !== undefined"> · {{ stageLabels[entry.stage] }}</span></p><div v-if="historyTranslation(entry)" class="history-text">{{ historyTranslation(entry) }}</div></div></article>
      </template>
      <template v-else>
        <div class="panel-heading"><span>词条评论</span><span class="subtle">{{ editor.selected?.comments?.length || 0 }} 条</span></div>
        <div v-if="!editor.selected?.comments?.length" class="empty-state"><MessageSquare :size="34" :stroke-width="1.25" /><h3>这条词条还没有评论</h3></div>
        <article v-for="(comment, index) in editor.selected?.comments || []" :key="comment.id || index" class="comment-card"><div class="history-heading"><strong>{{ comment.user?.nickname || comment.user?.username || '项目成员' }}</strong><time>{{ displayDate(comment.createdAt) }}</time></div><p>{{ comment.content || comment.text }}</p></article>
        <button v-if="editor.selected" class="button comment-link" :disabled="!editor.desktop" @click="openComments">在 ParaTranz 中查看 <MessageSquare :size="14" /></button>
      </template>
      </div></Transition>
      </template>
    </AuxDockLayout>
    <section v-if="customizationOpen" ref="customizationBounds" class="aux-customize-popover" :style="editor.desktop ? { visibility: 'hidden', pointerEvents: 'none' } : undefined" :aria-hidden="editor.desktop ? 'true' : undefined" :inert="editor.desktop" role="dialog" aria-label="自定义右侧栏" @click.stop @keydown.esc.stop="customizationOpen = false">
      <header><strong>自定义右侧栏</strong><button class="icon-button small" aria-label="关闭自定义面板" @click="customizationOpen = false"><X :size="15" /></button></header>
      <p>勾选要显示的模块；拖动标签到分栏边缘可左右或上下拆分。</p>
      <ol class="aux-customize-list">
        <li v-for="(tab, index) in orderedTabs" :key="tab.id" :class="{ dragging: customizeDraggedTab === tab.id, 'drop-target': dropTargetTab === tab.id }" draggable="true" @dragstart="startCustomizeDrag($event, tab.id)" @dragover.prevent="dropTargetTab = tab.id" @dragleave="dropTargetTab === tab.id && (dropTargetTab = null)" @drop="dropCustomizeTab($event, tab.id)" @dragend="customizeDraggedTab = null; dropTargetTab = null">
          <span class="aux-customize-grip" aria-hidden="true"><GripVertical :size="14" /></span>
          <label><input type="checkbox" :checked="visibleTabIds.includes(tab.id)" :disabled="visibleTabIds.includes(tab.id) && visibleTabIds.length <= 1" @change="toggleAuxTab(tab.id)" /><span>{{ tab.label }}</span></label>
          <button class="icon-button small" :aria-label="`将${tab.label}移到上方`" :disabled="index === 0" @click="moveAuxTab(tab.id, -1)"><ChevronUp :size="14" /></button>
          <button class="icon-button small" :aria-label="`将${tab.label}移到下方`" :disabled="index === tabOrder.length - 1" @click="moveAuxTab(tab.id, 1)"><ChevronDown :size="14" /></button>
        </li>
      </ol>
    </section>
    <div class="aux-bottom"><span class="online-dot" :class="{ offline: !editor.connected || !editor.sessionInfo.authenticated }"></span>{{ editor.connected && editor.sessionInfo.authenticated ? '来自 ParaTranz' : '未连接' }}</div>
    <Teleport to=".app-shell"><Transition name="dialog"><ConcordanceDialog v-if="concordance" :editor="editor" v-bind="concordance" @close="concordance = null" @use="emit('replace', $event)" /></Transition></Teleport>
  </aside>
</template>
