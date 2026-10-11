<script setup lang="ts">
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Copy, Undo2, Search, Filter, Check, CheckCheck, Circle, TriangleAlert, Settings2, Keyboard, BarChart3, BookOpen, ExternalLink, RefreshCw, Download, X, Minus, Square, Link, MoreHorizontal, TextCursorInput, WrapText, ShieldCheck, Cloud, Monitor, FolderOpen, Files } from 'lucide-vue-next'
import { stageLabels, displayDate, tokens } from '~/utils/text'
import type { UnwrapNestedRefs } from 'vue'
import type { Term } from '~/types/editor'
import { saveModes, type SaveMode } from '~/utils/saveModes'
import { toEditorText } from '~/utils/translationText'
import type { QualityLocation } from '~/utils/quality'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const e = props.editor
const navigation = inject<import('~/composables/useWorkspaceNavigation').WorkspaceNavigation>('workspace-navigation')!
const showConnection = toRef(navigation, 'showConnection'), showShortcuts = ref(false), showOverview = ref(false), showMenu = ref(false)
async function openManager() { await navigation.goHome() }
function changeFile(id: number) { const file = e.files.find(f => f.id === id); if (file) navigation.chooseFile(file) }
const fileOptions = computed(() => e.sortedFiles.map(file => ({ value: file.id, label: file.name })))
const searchOptions = [{ value: 'text', label: '文本与键值' }, { value: 'original', label: '原文' }, { value: 'translation', label: '译文' }, { value: 'key', label: '键值' }, { value: 'context', label: '上下文' }]
const stageOptions = [{ value: 'all', label: '所有状态' }, ...Object.entries(stageLabels).map(([value, label]) => ({ value: Number(value), label }))]
const sortOptions = [{ value: 'default', label: '默认' }, { value: 'key', label: '键值 A–Z' }, { value: 'length', label: '原文长度' }, { value: 'updated', label: '最近更新' }]
const pageSizeOptions = [50, 100, 200, 500].map(value => ({ value, label: `${value} / 页` }))
const saveStageOptions = [0, 1, 2, 3, 5].map(value => ({ value, label: stageLabels[value]! }))
const theme = inject<Ref<string>>('workspace-theme')!, showBreaks = ref(true), saveMode = ref<SaveMode>('stay')
watch(saveMode, value => { try { localStorage.setItem('sckit-save-mode', value) } catch { /* Keep the choice for this session. */ } })
function changeSaveStage(stage: number) {
  if (e.locked || e.saving || e.listBusy || e.initializing || e.reloadBusy) return
  e.editStage = stage
  const mode = saveModes.find(option => option.id === saveMode.value)
  if (mode?.stage !== undefined && mode.stage !== stage) saveMode.value = 'stay'
}
function submitSelectedMode() {
  const mode = saveModes.find(option => option.id === saveMode.value) || saveModes[0]!
  return e.save(mode.next, mode.stage)
}
const translationInput = ref<HTMLTextAreaElement>(), workspace = ref<HTMLElement>(), editorPanel = ref<HTMLElement>()
const translationText = computed(() => toEditorText(e.text))
const leftWidth = ref(47), rightWidth = ref(26.5), narrowLeftWidth = ref(53), narrow = ref(false)
const editingContent = ref<HTMLElement>()
const auxiliaryPanel = ref<{ focusTerm: (id: number) => void; openHistorySearch: () => void }>()
function focusTerm(term: Term) { e.panel = 'terms'; nextTick(() => auxiliaryPanel.value?.focusTerm(term.id)) }
let active = true
function updateCompactLayout() {
  if (!active || !workspace.value?.clientWidth) return
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
const shortcuts = [ ['Ctrl + S', '保存译文'], ['Ctrl + Enter', '保存并下一条'], ['Tab', '编辑框中保存并下一条'], ['Alt + ↑ / ↓', '上一条 / 下一条'], ['Ctrl + 1', '翻译建议'], ['Ctrl + 2', '词条历史'], ['Ctrl + 4', '项目术语'], ['Ctrl + 5', '词条评论'], ['Ctrl + F', '搜索字符串'], ['Ctrl + Shift + F', '搜索历史翻译'] ]
function insert(value: string) {
  if (e.locked || e.saving || e.listBusy || e.initializing || e.reloadBusy) return
  const field = translationInput.value
  const content = translationText.value, inserted = toEditorText(value)
  const start = field?.selectionStart ?? content.length, end = field?.selectionEnd ?? start
  e.input(content.slice(0, start) + inserted + content.slice(end))
  nextTick(() => { field?.focus(); field?.setSelectionRange(start + inserted.length, start + inserted.length) })
}
function replace(value: string) { if (!e.locked && !e.saving && !e.listBusy && !e.initializing && !e.reloadBusy) { e.input(value); nextTick(() => translationInput.value?.focus()) } }
async function locateQuality(location: QualityLocation) {
  if (e.locked || e.saving || e.listBusy || e.initializing || e.reloadBusy) return
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
  if (showConnection.value || showShortcuts.value || showOverview.value) { if (event.key === 'Escape') { showShortcuts.value = false; showOverview.value = false } return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); e.save(); return }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); e.save(true); return }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); auxiliaryPanel.value?.openHistorySearch(); return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); document.querySelector<HTMLInputElement>('#string-search')?.focus(); return }
  if (event.ctrlKey && ['1', '2', '4', '5'].includes(event.key)) { event.preventDefault(); e.panel = ({ '1': 'suggestions', '2': 'history', '4': 'terms', '5': 'comments' } as const)[event.key as '1' | '2' | '4' | '5']; return }
  if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); e.move(event.key === 'ArrowUp' ? -1 : 1) }
}
function editorKeydown(event: KeyboardEvent) { if (event.key === 'Tab' && !event.shiftKey && e.dirty) { event.preventDefault(); e.save(true) } }
function fitTranslation() {
  if (!active || CSS.supports('field-sizing', 'content')) return
  const field = translationInput.value
  if (!field) return
  field.style.height = '160px'
  field.style.height = `${Math.max(160, field.scrollHeight)}px`
}
let fitFrame = 0
function scheduleFit() { cancelAnimationFrame(fitFrame); fitFrame = requestAnimationFrame(fitTranslation) }
watch(() => [e.text, e.selected?.id], () => nextTick(scheduleFit))
watch(() => e.selected?.id, () => { savedScroll.clear(); nextTick(() => { if (narrow.value) editingContent.value?.scrollTo({ top: 0 }); else editorPanel.value?.querySelector('.editor-scroll')?.scrollTo({ top: 0 }) }) })
function resize(event: PointerEvent, side: 'left' | 'right') {
  const rect = workspace.value?.getBoundingClientRect(); if (!rect) return
  const move = (pointer: PointerEvent) => {
    const width = rect.width
    if (side === 'left' && narrow.value) narrowLeftWidth.value = Math.max(28, Math.min((pointer.clientX - rect.left) / width * 100, 100 - 280 / width * 100))
    else if (side === 'left') leftWidth.value = Math.max(28, Math.min((pointer.clientX - rect.left) / width * 100, 100 - rightWidth.value - 250 / width * 100))
    else rightWidth.value = Math.max(220 / width * 100, Math.min((rect.right - pointer.clientX) / width * 100, 100 - leftWidth.value - 250 / width * 100))
  }
  const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); document.body.style.cursor = ''; document.body.style.userSelect = '' }
  document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; window.addEventListener('pointermove', move); window.addEventListener('pointerup', end)
  event.preventDefault()
}
const savedScroll = new Map<string, number>()
let layoutObserver: ResizeObserver | undefined
function activate() {
  active = true
  window.addEventListener('keydown', keydown)
  nextTick(() => {
    updateCompactLayout()
    for (const [selector, top] of savedScroll) workspace.value?.querySelector(selector)?.scrollTo({ top })
  })
}
function deactivate() {
  active = false
  window.removeEventListener('keydown', keydown)
  showMenu.value = false
}
function rememberScroll() {
  for (const selector of ['.string-list', '.editor-scroll', '.editing-content', '.aux-scroll']) {
    const node = workspace.value?.querySelector(selector)
    if (node) savedScroll.set(selector, node.scrollTop)
  }
}
onBeforeRouteLeave(() => { rememberScroll(); return true })
onMounted(() => {
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
    saveMode.value = saveModes.find(option => option.id === stored)?.id || 'stay'
  } catch { /* Use the default when storage is unavailable. */ }
  activate()
})
onActivated(activate)
onDeactivated(deactivate)
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown); cancelAnimationFrame(fitFrame); editorObserver?.disconnect(); layoutObserver?.disconnect() })
</script>
<template>
  <div class="editor-workspace">
    <header class="workspace-header">
      <div class="project-navigation"><button class="project-name" :title="e.project.name" @click="openManager">{{ e.project.name }}<ChevronDown :size="13" /></button><span class="breadcrumb-divider">/</span><div class="file-picker"><AppSelect :model-value="e.fileId" :options="fileOptions" label="翻译文件" :disabled="navigation.blocked" @update:model-value="changeFile" /></div></div>
      <div class="header-actions"><div v-if="e.connected && !['connected', 'idle'].includes(e.presence.state.status)" class="presence-status" :class="e.presence.state.status" role="status"><LoadingIndicator v-if="['connecting', 'reconnecting'].includes(e.presence.state.status)" :size="12" label="正在同步占用" /><span v-else class="online-dot" :class="{ offline: e.presence.state.status !== 'connected' }"></span><span :title="e.presence.state.message || e.presence.state.editors.map(user => `${user.username} · 词条 ${user.editing}`).join('\n')">{{ e.presence.state.status === 'connected' ? `${e.presence.onlineCount} 人正在编辑` : e.presence.state.message || '正在同步占用…' }}</span><button v-if="e.presence.state.status === 'unavailable'" class="text-button" :disabled="e.presenceLoginBusy" @click="e.loginPresence()">{{ e.presenceLoginBusy ? '登录中…' : '网页登录' }}</button></div><button class="button compact" title="实时检查当前译文中的数字、百分比、标签和变量" @click="e.panel = 'quality'"><ShieldCheck :size="15" /><span>QA 检查</span></button><button class="button compact" @click="showOverview = true"><BarChart3 :size="15" /><span>概览</span></button><button class="button compact" @click="e.panel = 'terms'"><BookOpen :size="15" /><span>术语</span></button><button class="connection-button" :class="{ live: e.connected }" @click="showConnection = true"><span class="online-dot" :class="{ offline: !e.connected }"></span>{{ e.connected ? (e.sessionInfo.authenticated ? '已连接' : '登录已过期') : '连接 ParaTranz' }}</button><div class="menu-anchor"><button class="icon-button" aria-label="工作台设置" @click="showMenu = !showMenu"><MoreHorizontal :size="19" /></button><Transition name="menu"><div v-if="showMenu" class="dropdown-menu"><button @click="toggleTheme"><Settings2 :size="15" />{{ theme === 'light' ? '切换到深色模式' : '切换到浅色模式' }}</button><button @click="showShortcuts = true; showMenu = false"><Keyboard :size="15" />快捷键</button><button :disabled="e.exportBusy" @click="e.exportPage(); showMenu = false"><Download :size="15" />导出当前页 / 选中词条</button><button v-if="e.connected" @click="disconnect"><Link :size="15" />断开连接</button></div></Transition></div></div>
    </header>
    <Transition name="banner"><div v-if="e.error" class="error-banner" role="alert"><TriangleAlert :size="16" /><span>{{ e.error }}</span><button v-if="e.connected" @click="e.reloadSelected()">重新载入词条</button><button class="icon-button" aria-label="关闭错误提示" @click="e.error = ''"><X :size="15" /></button></div></Transition>
    <div class="workspace-shell">
    <main ref="workspace" class="workspace" :style="{ '--list-width': `${narrow ? narrowLeftWidth : leftWidth}%`, '--aux-share': `${rightWidth / (100 - leftWidth) * 100}%` }">
      <section class="list-panel" aria-label="字符串列表">
        <nav class="status-tabs" aria-label="词条筛选"><button :class="{ active: e.stageFilter === null }" @click="e.filter(null)"><strong>{{ e.file.total }}</strong><span>全部</span></button><button :class="{ active: e.stageFilter === 0 }" @click="e.filter(0)"><strong>{{ e.untranslated }}</strong><span>未翻译</span></button><button :class="{ active: e.stageFilter === 2 }" @click="e.filter(2)"><strong>{{ e.file.disputed }}</strong><span>有疑问</span></button></nav>
        <div class="filters"><div class="search-bar"><span class="filter-label"><Filter :size="13" />过滤器</span><Search :size="15" /><input id="string-search" v-model="e.search" placeholder="按文本或键值搜索" aria-label="搜索字符串" :disabled="e.saving" /><button v-if="e.search" class="icon-button small" aria-label="清除搜索" @click="e.search = ''"><X :size="14" /></button></div><div class="filter-controls"><AppSelect v-model="e.searchMode" :options="searchOptions" label="搜索范围" /><AppSelect :model-value="e.stageFilter ?? 'all'" :options="stageOptions" label="词条状态" :disabled="e.saving" @update:model-value="value => e.filter(value === 'all' ? null : Number(value))" /><span class="filter-spacer"></span><span class="sort-label">本页排序</span><AppSelect v-model="e.sort" :options="sortOptions" label="本页排序" /><input type="checkbox" :checked="selectedAll" aria-label="选择当前页全部词条" @change="toggleAll" /></div></div>
        <div class="string-list" role="listbox" aria-label="待翻译字符串" :aria-busy="e.listBusy">
          <LoadingRegion :busy="e.listBusy || e.initializing" :initial="!e.items.length" label="正在加载词条…">
          <div v-if="!e.visibleItems.length" class="empty-state"><Search :size="32" /><h3>没有符合条件的词条</h3><button class="button" @click="e.search = ''; e.filter(null)">清除筛选</button></div>
          <template v-else><div v-for="(item, index) in e.visibleItems" :key="item.id" class="string-row" :class="{ selected: e.selected?.id === item.id }" role="option" :aria-selected="e.selected?.id === item.id" @click="e.select(item)"><div class="row-status"><CheckCheck v-if="item.stage === 5 || item.stage === 3" :size="15" /><Check v-else-if="item.stage === 1" :size="15" /><TriangleAlert v-else-if="item.stage === 2" :size="14" /><Circle v-else :size="11" :fill="item.stage === 0 ? 'currentColor' : 'none'" /><span>{{ (e.page - 1) * e.pageSize + index + 1 }}</span></div><button type="button" class="row-content" :title="item.key" :aria-label="`打开词条 ${item.key}`" :disabled="e.saving || e.listBusy || e.initializing || e.reloadBusy"><span class="row-source"><ProtectedText :text="item.original" :terms="e.selected?.id === item.id ? e.terms : []" /></span><span class="row-translation">{{ item.translation }}</span><OccupancyBadge :users="e.presence.byString.get(item.id) || []" :user-id="e.presence.state.userId" compact icon-only /></button><input type="checkbox" :checked="e.selectedIds.includes(item.id)" :aria-label="`选择词条 ${item.key}`" @click.stop @change="toggleSelected(item.id)" /></div></template>
          </LoadingRegion>
        </div>
        <footer class="list-footer"><span>{{ e.connected ? e.rowCount : e.visibleItems.length }} 条<span v-if="e.selectedIds.length"> · 已选 {{ e.selectedIds.length }}</span></span><div class="pagination"><button class="icon-button small" aria-label="第一页" :disabled="e.page === 1 || e.listBusy" @click="e.paginate(1)"><ChevronsLeft :size="15" /></button><button class="icon-button small" aria-label="上一页" :disabled="e.page === 1 || e.listBusy" @click="e.paginate(e.page - 1)"><ChevronLeft :size="15" /></button><span>{{ e.page }} / {{ e.pageCount }}</span><button class="icon-button small" aria-label="下一页" :disabled="e.page === e.pageCount || e.listBusy" @click="e.paginate(e.page + 1)"><ChevronRight :size="15" /></button><button class="icon-button small" aria-label="最后一页" :disabled="e.page === e.pageCount || e.listBusy" @click="e.paginate(e.pageCount)"><ChevronsRight :size="15" /></button></div><AppSelect :model-value="e.pageSize" :options="pageSizeOptions" label="每页词条数量" @update:model-value="e.changePageSize" /></footer>
      </section>
      <div class="resize-handle" role="separator" aria-label="调整字符串列表宽度" aria-orientation="vertical" @pointerdown="resize($event, 'left')"></div>
      <div class="editing-columns">
      <div ref="editingContent" class="editing-content">
      <section ref="editorPanel" class="editor-panel" aria-label="译文编辑器" :aria-busy="e.reloadBusy || e.saving">
        <template v-if="e.selected"><div class="editor-scroll"><div class="source-area"><div class="source-heading"><div class="source-heading-title"><span>待翻译的字符串</span><span class="current-occupancy" :title="e.presence.occupied ? '其他用户正在编辑此词条，你仍可编辑和提交。' : undefined"><OccupancyBadge :users="e.presence.current" :user-id="e.presence.state.userId" /></span></div><span class="source-metadata"><span v-if="e.termsBusy" class="source-term-status"><LoadingIndicator :size="12" label="正在获取术语" />正在获取术语…</span><button v-else-if="e.termsError" class="source-term-status term-error" :title="e.termsError" @click="e.loadTerms(true)">术语获取失败 · 重试</button><button v-else-if="e.terms.length" class="source-term-status" @click="e.panel = 'terms'">{{ e.terms.length }} 条术语</button><span class="stage-badge" :class="`stage-${e.selected.stage}`">{{ stageLabels[e.selected.stage] }}</span></span></div><div class="source-content"><ProtectedText :text="e.selected.original" :breaks="showBreaks" :terms="e.terms" interactive @insert="insert" @term="focusTerm" /></div></div>
          <div class="toolbelt"><button class="icon-button" title="复制原文到译文框" aria-label="复制原文到译文框" :disabled="e.locked || e.saving || e.listBusy || e.initializing || e.reloadBusy" @click="replace(e.selected.original)"><Copy :size="16" /></button><button class="icon-button" title="恢复当前远端译文" aria-label="恢复远端译文" :disabled="!e.dirty || e.saving" @click="e.discardDraft()"><Undo2 :size="16" /></button><button class="icon-button" :class="{ pressed: showBreaks }" title="显示原文的转义换行" aria-label="切换原文换行显示" @click="showBreaks = !showBreaks"><WrapText :size="17" /></button><button class="icon-button" title="打开术语" aria-label="打开术语面板" @click="e.panel = 'terms'"><BookOpen :size="16" /></button><span class="toolbelt-spacer"></span><span class="character-count">{{ translationText.length }} 字符</span></div>
          <div class="translation-area"><textarea ref="translationInput" :value="translationText" aria-label="译文" placeholder="在此输入翻译" spellcheck="false" :disabled="e.locked || e.saving || e.listBusy || e.initializing || e.reloadBusy" @input="e.input(($event.target as HTMLTextAreaElement).value)" @keydown="editorKeydown"></textarea><div v-if="e.locked" class="locked-notice">此词条{{ stageLabels[e.selected.stage] }}，编辑已禁用。</div><div v-if="availableTokens.length" class="token-tray"><span>标记</span><button v-for="token in availableTokens" :key="token" :title="`插入 ${token}`" :disabled="e.locked || e.saving || e.listBusy || e.initializing || e.reloadBusy" @click="insert(token)">{{ token }}</button></div><div class="save-row"><div class="save-controls"><AppSelect :model-value="e.editStage" :options="saveStageOptions" label="保存为词条状态" :disabled="e.locked || e.saving || e.listBusy || e.initializing || e.reloadBusy" @update:model-value="changeSaveStage" /><SaveButton v-model:mode="saveMode" :editor="e" @save="submitSelectedMode" /></div></div></div>
          <div class="editor-hint"><span class="draft-status"><LoadingIndicator v-if="e.saving || e.draftStatus.startsWith('正在')" :size="12" label="正在保存译文或草稿" /><span v-else-if="e.dirty" class="draft-dot"></span>{{ e.saving ? '正在提交…' : e.draftStatus || (e.notice ? e.notice : 'Tab 保存并下一条') }}</span></div>
          <StringDetails :editor="e" class="desktop-details" />
        </div>
          <EditorNavigation :editor="e" class="desktop-editor-footer" @open="openString" />
        </template><div v-else class="empty-state editor-empty"><TextCursorInput :size="38" :stroke-width="1.2" /><h3>选一条字符串，开始翻译</h3></div>
      </section>
      <div class="resize-handle aux-resize-handle" role="separator" aria-label="调整辅助面板宽度" aria-orientation="vertical" @pointerdown="resize($event, 'right')"></div>
      <AuxPanel ref="auxiliaryPanel" :editor="e" :compact="narrow" @insert="insert" @replace="replace" @locate="locateQuality"><template #context><StringDetails :editor="e" /></template></AuxPanel>
      </div>
      <EditorNavigation v-if="e.selected" :editor="e" class="compact-editor-footer" @open="openString" />
      </div>
    </main>
    </div>
    <Transition name="dialog"><div v-if="showShortcuts || showOverview" class="modal-backdrop" @click.self="showShortcuts = false; showOverview = false"><section class="info-dialog" role="dialog" aria-modal="true" :aria-label="showShortcuts ? '快捷键' : '文件概览'"><button class="icon-button modal-close" aria-label="关闭窗口" @click="showShortcuts = false; showOverview = false"><X :size="18" /></button><template v-if="showShortcuts"><Keyboard :size="28" class="dialog-icon" /><h2>快捷键</h2><div v-for="[key, label] in shortcuts" :key="key" class="shortcut-row"><span>{{ label }}</span><kbd>{{ key }}</kbd></div></template><template v-else><BarChart3 :size="28" class="dialog-icon" /><h2>文件概览</h2><p class="dialog-description">{{ e.file.name }}<span v-if="!e.connected"> · 7 条样例</span></p><div class="progress-heading"><strong>{{ progress }}<small>%</small></strong><span>{{ e.file.translated }} / {{ e.file.total }} 已翻译</span></div><div class="progress-track"><span :style="{ width: `${progress}%` }"></span></div><div class="overview-stats"><div><span>未翻译</span><strong>{{ e.untranslated }}</strong></div><div><span>有疑问</span><strong>{{ e.file.disputed }}</strong></div><div><span>已检查</span><strong>{{ e.file.checked }}</strong></div><div><span>已审核</span><strong>{{ e.file.reviewed }}</strong></div></div></template></section></div></Transition>
  </div>
</template>
