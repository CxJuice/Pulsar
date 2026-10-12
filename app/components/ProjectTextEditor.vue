<script setup lang="ts">
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, LoaderCircle, Save, Search, X } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { useEditor } from '~/composables/useEditor'
import type { FileInfo, ProjectInfo, StringItem, StringPage, Term } from '~/types/editor'
import { toEditorText, toParaTranzText } from '~/utils/translationText'
import { stageLabels } from '~/utils/text'
import { qualityIssues } from '~/utils/quality'

type EditorState = UnwrapNestedRefs<ReturnType<typeof useEditor>>
type WorkRow = {
  projectId: number
  base: StringItem
  translation: string
  stage: number
  saving: boolean
  reloading: boolean
  error: string
  draftState: 'saved' | 'pending' | ''
  draftUpdatedAt: string
  terms?: Term[]
  termsBusy: boolean
  termsError: string
  termsGeneration: number
  termsRequest?: Promise<void>
}

const props = defineProps<{ editor: EditorState; project: ProjectInfo; open: boolean }>()
const emit = defineEmits<{ close: []; pending: [value: boolean]; filesUpdated: [files: FileInfo[]] }>()
const page = ref(1), pageSize = ref(50), pageCount = ref(1), rowCount = ref(0)
const search = ref(''), query = ref(''), stageFilter = ref<number | null>(null)
const rows = ref<WorkRow[]>([]), busy = ref(false), savingAll = ref(false)
const dialogRoot = ref<HTMLElement>()
let previousFocus: HTMLElement | null = null
function backgroundInert(value: boolean) {
  for (const selector of ['.app-shell > .titlebar', '.application-sidebar', '.manager-header']) {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) element.inert = value
  }
}
function dialogKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !hasPendingWork.value) { event.preventDefault(); event.stopPropagation(); emit('close'); return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); event.stopPropagation()
    if (changedRows.value.length && !hasPendingWork.value) void saveAll()
    return
  }
  if (event.key !== 'Tab') return
  const controls = [...(dialogRoot.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])]
    .filter(element => element.getClientRects().length > 0)
  if (!controls.length) { event.preventDefault(); return }
  const first = controls[0]!, last = controls.at(-1)!
  if (event.shiftKey && (document.activeElement === first || !dialogRoot.value?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || !dialogRoot.value?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
}
const refreshingFiles = ref(false)
const error = ref(''), searchTimer = ref<ReturnType<typeof setTimeout>>()
const batchSummary = ref('')
const workById = reactive(new Map<number, WorkRow>())
const draftTimers = new Map<number, ReturnType<typeof setTimeout>>()
const draftWrites = new Map<number, Promise<void>>()
const registerCloseFlusher = inject<((flush: () => Promise<void>) => () => void) | undefined>('workspace-close-flusher', undefined)
let removeCloseFlusher: (() => void) | undefined
let loadSequence = 0

const changedRows = computed(() => [...workById.values()].filter(row => isDirty(row) && !isLocked(row)))
const hasPendingWork = computed(() => busy.value || savingAll.value || refreshingFiles.value || [...workById.values()].some(row => row.saving || row.reloading))
const canEdit = computed(() => props.editor.connected && props.editor.sessionInfo.authenticated)
const saveAllLabel = computed(() => savingAll.value ? '正在提交…' : '保存全部更改' + (changedRows.value.length ? ' · ' + changedRows.value.length : ''))
const pageSizeOptions = [50, 100, 200].map(value => ({ value, label: value + ' / 页' }))
const stageOptions = [
  { value: 'all', label: '全部状态' },
  ...[0, 1, 2, 3, 5].map(value => ({ value: String(value), label: stageLabels[value] || String(value) })),
]

function isLocked(row: WorkRow) { return row.base.stage === 9 || row.base.stage === -1 }
function isDirty(row: WorkRow) {
  return toParaTranzText(row.translation) !== toParaTranzText(row.base.translation) || row.stage !== row.base.stage
}
function rowQualityIssues(row: WorkRow) { return isDirty(row) ? qualityIssues(row.base.original, row.translation, row.base.key, row.terms || []) : [] }
async function ensureRowTerms(row: WorkRow) {
  if (row.terms) return
  if (row.termsRequest) return row.termsRequest
  const generation = ++row.termsGeneration
  const item = row.base
  row.termsBusy = true; row.termsError = ''
  const request = Promise.resolve().then(() => props.editor.termsFor(item)).then(terms => {
    if (row.termsGeneration === generation) row.terms = terms
  }).catch(reason => {
    if (row.termsGeneration === generation) row.termsError = '术语检查暂不可用：' + (reason as Error).message
  }).finally(() => {
    if (row.termsGeneration === generation) { row.termsBusy = false; row.termsRequest = undefined }
  })
  row.termsRequest = request
  return request
}
function invalidateRowTerms(row: WorkRow) {
  row.termsGeneration++
  row.terms = undefined; row.termsBusy = false; row.termsRequest = undefined; row.termsError = ''
}
function fileName(item: StringItem) { return item.file?.name || props.editor.files.find(file => file.id === item.fileId)?.name || '文件 ' + (item.fileId || '') }
function rowFor(item: StringItem): WorkRow {
  const existing = workById.get(item.id)
  if (existing) {
    if (!isDirty(existing)) {
      if (existing.base.original !== item.original) invalidateRowTerms(existing)
      existing.base = item
      existing.translation = toEditorText(item.translation)
      existing.stage = item.stage
    }
    return existing
  }
  const draftKey = props.project.id + '/' + item.id
  const draft = props.editor.drafts[draftKey]
  const row: WorkRow = {
    projectId: props.project.id,
    base: item,
    translation: toEditorText(draft?.translation ?? item.translation),
    stage: draft?.stage ?? item.stage,
    saving: false,
    reloading: false,
    error: '',
    draftState: draft ? 'saved' : '',
    draftUpdatedAt: draft?.updatedAt || '',
    terms: undefined,
    termsBusy: false,
    termsError: '',
    termsGeneration: 0,
  }
  workById.set(item.id, row)
  if (draft && isDirty(row)) void ensureRowTerms(row)
  return row
}

async function loadPage() {
  if (!props.open) return
  const sequence = ++loadSequence, projectId = props.project.id
  busy.value = true; error.value = ''
  try {
    const data = await props.editor.api<StringPage>('strings', {
      projectId, page: page.value, pageSize: pageSize.value, stage: stageFilter.value,
      text: query.value.trim(), searchMode: 'text',
    })
    if (sequence !== loadSequence || projectId !== props.project.id) return
    rows.value = data.results.map(rowFor)
    rowCount.value = data.rowCount
    pageCount.value = Math.max(1, data.pageCount)
    page.value = data.page
  } catch (reason) {
    if (sequence === loadSequence) error.value = (reason as Error).message
  } finally {
    if (sequence === loadSequence) busy.value = false
  }
}

function setSearch(value: string) {
  search.value = value
  clearTimeout(searchTimer.value)
  searchTimer.value = setTimeout(() => { query.value = search.value; page.value = 1 }, 300)
}
function setStage(value: string) { stageFilter.value = value === 'all' ? null : Number(value); page.value = 1 }
function updateRow(row: WorkRow) {
  row.translation = toEditorText(row.translation)
  if (row.base.stage === 0) row.stage = row.translation.trim() ? 1 : 0
  row.error = ''
  if (isDirty(row)) void ensureRowTerms(row)
  if (!isDirty(row)) {
    clearTimeout(draftTimers.get(row.base.id))
    draftTimers.delete(row.base.id)
    row.draftState = ''
    const key = row.projectId + '/' + row.base.id
    const oldDraft = props.editor.drafts[key]
    if (oldDraft?.updatedAt === row.draftUpdatedAt) {
      void removeRevertedDraft(row, oldDraft.updatedAt).catch(() => {})
    }
    return
  }
  const priorTimestamp = Date.parse(row.draftUpdatedAt) || 0
  const updatedAt = new Date(Math.max(Date.now(), priorTimestamp + 1)).toISOString()
  row.draftUpdatedAt = updatedAt
  row.draftState = 'pending'
  props.editor.drafts[row.projectId + '/' + row.base.id] = {
    translation: toParaTranzText(row.translation), stage: row.stage, updatedAt,
  }
  clearTimeout(draftTimers.get(row.base.id))
  draftTimers.set(row.base.id, setTimeout(() => { void persistDraft(row).catch(() => {}) }, 450))
}

async function persistDraft(row: WorkRow) {
  const timer = draftTimers.get(row.base.id)
  if (timer) clearTimeout(timer)
  draftTimers.delete(row.base.id)
  if (!isDirty(row) || !row.draftUpdatedAt) return
  const updatedAt = row.draftUpdatedAt, translation = toParaTranzText(row.translation), stage = row.stage
  const accountId = props.editor.sessionInfo.user?.id
  const write = (draftWrites.get(row.base.id) || Promise.resolve()).catch(() => {}).then(() =>
    props.editor.api('draft', { accountId, projectId: row.projectId, stringId: row.base.id, translation, stage, updatedAt }).then(() => undefined))
  draftWrites.set(row.base.id, write)
  try {
    await write
    if (row.draftUpdatedAt === updatedAt) row.draftState = 'saved'
  } catch (reason) {
    if (row.draftUpdatedAt === updatedAt) row.draftState = ''
    row.error = '草稿保存失败：' + (reason as Error).message
    throw reason
  }
}
async function removeRevertedDraft(row: WorkRow, updatedAt: string) {
  const key = row.projectId + '/' + row.base.id
  if (props.editor.drafts[key]?.updatedAt !== updatedAt) return
  const accountId = props.editor.sessionInfo.user?.id
  const write = (draftWrites.get(row.base.id) || Promise.resolve()).catch(() => {}).then(() =>
    props.editor.api('draft', { accountId, projectId: row.projectId, stringId: row.base.id, remove: true }).then(() => undefined))
  draftWrites.set(row.base.id, write)
  try {
    await write
    if (props.editor.drafts[key]?.updatedAt === updatedAt) delete props.editor.drafts[key]
  } catch (reason) { row.error = '本地草稿清理失败：' + (reason as Error).message; throw reason }
}
async function flushAllDrafts() {
  const pending = [...workById.values()].map(row => isDirty(row) ? persistDraft(row)
    : row.draftUpdatedAt && props.editor.drafts[row.projectId + '/' + row.base.id]?.updatedAt === row.draftUpdatedAt
      ? removeRevertedDraft(row, row.draftUpdatedAt) : Promise.resolve())
  const results = await Promise.allSettled([...pending, ...draftWrites.values()])
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw new Error('全文编辑草稿保存失败：' + (failed.reason as Error).message)
}

async function removeDraftIfCurrent(row: WorkRow, updatedAt: string) {
  const key = row.projectId + '/' + row.base.id
  if (props.editor.drafts[key]?.updatedAt !== updatedAt) return
  try {
    const write = (draftWrites.get(row.base.id) || Promise.resolve()).catch(() => {}).then(() =>
      props.editor.api('draft', { accountId: props.editor.sessionInfo.user?.id, projectId: row.projectId, stringId: row.base.id, remove: true }).then(() => undefined))
    draftWrites.set(row.base.id, write)
    await write
    if (props.editor.drafts[key]?.updatedAt === updatedAt) delete props.editor.drafts[key]
  } catch (reason) {
    row.error = '译文已提交，但本地草稿未能清理：' + (reason as Error).message
  }
}

async function saveRow(row: WorkRow, refreshWorkspace = true) {
  if (row.saving || !isDirty(row) || isLocked(row) || !canEdit.value) return false
  const accountId = props.editor.sessionInfo.user?.id
  if (!accountId) { row.error = '请重新登录后提交'; return false }
  if (props.editor.project.id === props.project.id && props.editor.selected?.id === row.base.id && props.editor.dirty) {
    row.error = '当前翻译工作台仍有未保存修改，请先保存或放弃该词条的修改。'
    return false
  }

  const base = row.base, translation = toParaTranzText(row.translation), stage = row.stage
  const draftVersion = row.draftUpdatedAt
  row.saving = true; row.error = ''
  try {
    await ensureRowTerms(row)
    if (isDirty(row)) await persistDraft(row)
    const saved = await props.editor.api<StringItem>('save', {
      projectId: row.projectId, stringId: base.id, translation, stage, expectedUserId: accountId,
      expectedUpdatedAt: base.updatedAt ?? null, expectedTranslation: base.translation,
      expectedStage: base.stage, expectedOriginal: base.original,
    })
    row.base = saved
    row.translation = toEditorText(saved.translation)
    row.stage = saved.stage
    row.draftState = ''
    row.error = ''
    await removeDraftIfCurrent(row, draftVersion)
    if (props.editor.project.id === props.project.id) {
      props.editor.items = props.editor.items.map(item => item.id === saved.id ? saved : item)
      if (props.editor.selected?.id === saved.id) {
        const currentText = props.editor.text
        const currentStage = props.editor.editStage
        const stayedAtBase = toParaTranzText(currentText) === toParaTranzText(base.translation) && currentStage === base.stage
        props.editor.selected = saved
        if (stayedAtBase) { props.editor.text = saved.translation; props.editor.editStage = saved.stage }
      }
      const currentFileId = base.fileId || base.file?.id
      if (refreshWorkspace && props.editor.workspaceReady && currentFileId === props.editor.fileId) {
        await props.editor.loadStrings(props.editor.selected?.id)
      }
    }
    return true
  } catch (reason) {
    row.error = (reason as Error).message
    return false
  } finally {
    row.saving = false
  }
}

async function refreshFiles() {
  refreshingFiles.value = true
  try {
    const files = await props.editor.api<FileInfo[]>('files', { projectId: props.project.id })
    emit('filesUpdated', files)
  } catch (reason) { error.value = '译文已提交，文件进度刷新失败：' + (reason as Error).message }
  finally { refreshingFiles.value = false }
}
async function saveAll() {
  if (savingAll.value || !changedRows.value.length) return
  const batch = [...changedRows.value]
  const refreshWorkspace = props.editor.workspaceReady && props.editor.project.id === props.project.id &&
    batch.some(row => (row.base.fileId || row.base.file?.id) === props.editor.fileId)
  savingAll.value = true
  let savedCount = 0
  const qaRows: string[] = [], failedRows: string[] = [], overwrittenRows: string[] = []
  batchSummary.value = ''
  try {
    for (const row of batch) {
      await ensureRowTerms(row)
      const label = row.base.key || '#' + row.base.id
      if (rowQualityIssues(row).length || row.termsError) qaRows.push(label)
      if (await saveRow(row, false)) {
        savedCount++
        if (row.base.overwroteConflict) overwrittenRows.push(label)
      }
      else failedRows.push(label)
    }
    batchSummary.value = `已保存 ${savedCount} / ${batch.length} 条` +
      (overwrittenRows.length ? `；已覆盖远端新修改：${overwrittenRows.join('、')}` : '') +
      (qaRows.length ? `；QA 提示或术语检查未完成：${qaRows.join('、')}` : '') +
      (failedRows.length ? `；保存失败：${failedRows.join('、')}` : '')
    if (savedCount) {
      await refreshFiles()
      await loadPage()
      if (refreshWorkspace) await props.editor.loadStrings(props.editor.selected?.id)
    }
  } finally { savingAll.value = false }
}
async function saveOne(row: WorkRow) {
  await ensureRowTerms(row)
  const label = row.base.key || '#' + row.base.id
  const warning = rowQualityIssues(row).length || row.termsError
  if (await saveRow(row)) {
    batchSummary.value = `已保存 ${label}` + (row.base.overwroteConflict ? '；已覆盖远端新修改。' : '') +
      (warning ? '；保存前有 QA 提示或术语检查未完成，请核对该词条。' : '')
    await refreshFiles(); await loadPage()
  }
}
function hasVersionConflict(row: WorkRow) { return /已被其他人修改|请重新载入|版本信息/.test(row.error) }
async function reloadRemote(row: WorkRow) {
  if (row.reloading || row.saving) return
  row.reloading = true
  try {
    const latest = await props.editor.api<StringItem>('string', { projectId: row.projectId, stringId: row.base.id })
    const localTranslation = row.translation, localStage = row.stage
    if (latest.original !== row.base.original) invalidateRowTerms(row)
    row.base = latest
    row.translation = localTranslation
    row.stage = localStage
    row.error = ''
    updateRow(row)
  } catch (reason) { row.error = (reason as Error).message }
  finally { row.reloading = false }
}

watch(() => props.open, open => {
  backgroundInert(open)
  if (open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void loadPage()
    nextTick(() => dialogRoot.value?.querySelector<HTMLInputElement>('input[aria-label="搜索项目全部文本"]')?.focus())
  } else nextTick(() => { if (previousFocus?.isConnected) previousFocus.focus(); previousFocus = null })
}, { flush: 'post' })
watch([page, pageSize, query, stageFilter], () => { if (props.open) void loadPage() })
watch(() => props.project.id, () => {
  ++loadSequence
  for (const row of workById.values()) if (isDirty(row)) void persistDraft(row)
  workById.clear(); rows.value = []; rowCount.value = 0; page.value = 1; pageCount.value = 1
  query.value = ''; search.value = ''; error.value = ''
  batchSummary.value = ''
  if (props.open) void loadPage()
})
watch(hasPendingWork, value => emit('pending', value), { immediate: true })
onMounted(() => { removeCloseFlusher = registerCloseFlusher?.(flushAllDrafts) })
onBeforeUnmount(() => {
  backgroundInert(false)
  removeCloseFlusher?.()
  clearTimeout(searchTimer.value)
  for (const timer of draftTimers.values()) clearTimeout(timer)
  for (const row of workById.values()) if (isDirty(row)) void persistDraft(row).catch(() => {})
})
</script>

<template>
  <Transition name="dialog">
    <div v-if="open" class="modal-backdrop project-text-backdrop" @click.self="!hasPendingWork && emit('close')">
      <section ref="dialogRoot" class="project-text-editor" role="dialog" aria-modal="true" :aria-label="project.name + ' 全文编辑器'" :aria-busy="busy || savingAll" @keydown="dialogKeydown">
        <header class="project-text-header">
          <div class="project-text-title"><span><FileText :size="20" /></span><div><h2>编辑全部文本</h2><p>{{ project.name }} · 跨文件编辑项目译文</p></div></div>
          <button class="icon-button" aria-label="关闭全文编辑器" title="关闭" :disabled="hasPendingWork" @click="emit('close')"><X :size="18" /></button>
        </header>
        <div class="project-text-toolbar">
          <label class="project-text-search"><Search :size="15" /><input :value="search" placeholder="搜索原文、译文、键值或上下文" aria-label="搜索项目全部文本" @input="setSearch(($event.target as HTMLInputElement).value)" /><button v-if="search" class="icon-button small" aria-label="清除搜索" @click="setSearch('')"><X :size="14" /></button></label>
          <select :value="stageFilter ?? 'all'" aria-label="按词条状态筛选" @change="setStage(($event.target as HTMLSelectElement).value)"><option v-for="option in stageOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
          <AppSelect :model-value="pageSize" :options="pageSizeOptions" label="每页词条数量" @update:model-value="pageSize = Number($event); page = 1" />
          <button class="button primary" :disabled="!changedRows.length || hasPendingWork || !canEdit" @click="saveAll"><LoaderCircle v-if="savingAll" class="spin" :size="14" /><Save v-else :size="14" />{{ saveAllLabel }}</button>
        </div>
        <p class="project-text-hint">可搜索整个项目并编辑任意文件中的译文；未提交的修改会保存为本地草稿。提交时若远端已有新修改，当前译文仍会覆盖。锁定词条不能编辑。</p>
        <div v-if="error" class="sidebar-message error project-text-error" role="alert">{{ error }}</div>
        <div v-if="batchSummary" class="sidebar-message project-text-error" role="status">{{ batchSummary }}</div>
        <div class="project-text-summary"><span>{{ rowCount.toLocaleString() }} 条文本</span><span>第 {{ page }} / {{ pageCount }} 页</span><span v-if="changedRows.length" class="project-text-dirty">{{ changedRows.length }} 条有未提交修改</span><span v-if="editor.requestCount" class="project-text-request">正在与 ParaTranz 同步…</span></div>
        <div class="project-text-table-wrap">
          <table class="project-text-table">
            <thead><tr><th>键值 / 文件</th><th>原文</th><th>译文（可编辑）</th><th aria-label="操作"></th></tr></thead>
            <tbody>
              <tr v-if="busy && !rows.length"><td colspan="4" class="project-text-empty"><LoaderCircle class="spin" :size="20" />正在加载项目文本…</td></tr>
              <tr v-else-if="!rows.length"><td colspan="4" class="project-text-empty">{{ error ? '加载失败，请检查连接后重试。' : '没有符合条件的文本。' }}</td></tr>
              <tr v-for="row in rows" :key="row.base.id" :class="{ 'project-text-row-dirty': isDirty(row), 'project-text-row-locked': isLocked(row) }">
                <td class="project-text-key"><strong>{{ row.base.key || '#' + row.base.id }}</strong><small>{{ fileName(row.base) }}</small></td>
                <td class="project-text-source">{{ row.base.original }}</td>
                <td class="project-text-translation"><textarea v-model="row.translation" :aria-label="'编辑 ' + (row.base.key || row.base.id) + ' 的译文'" :disabled="busy || row.saving || row.reloading || isLocked(row) || !canEdit" rows="3" @input="updateRow(row)" /><small v-if="isLocked(row)" class="project-text-lock">此词条已锁定</small><small v-else-if="row.draftState === 'saved' && isDirty(row)" class="project-text-draft">草稿已保存</small><small v-else-if="row.draftState === 'pending' && isDirty(row)" class="project-text-draft">正在保存草稿…</small><small v-if="isDirty(row) && row.termsBusy" class="project-text-draft">正在检查术语…</small><small v-if="isDirty(row) && row.termsError" class="project-text-qa" role="status">{{ row.termsError }}</small><small v-if="rowQualityIssues(row).length" class="project-text-qa" role="status">QA 提示：{{ rowQualityIssues(row).map(issue => issue.message).join('；') }}</small><small v-if="row.error" class="project-text-row-error" role="alert">{{ row.error }}</small><button v-if="hasVersionConflict(row)" class="project-text-reload" :disabled="row.reloading || row.saving" @click="reloadRemote(row)"><LoaderCircle v-if="row.reloading" class="spin" :size="12" />载入最新版本并保留此译文</button></td>
                <td class="project-text-action"><button class="button compact" :disabled="!isDirty(row) || row.saving || row.reloading || busy || !canEdit || isLocked(row)" :aria-label="'保存 ' + (row.base.key || row.base.id)" @click="saveOne(row)"><LoaderCircle v-if="row.saving" class="spin" :size="14" /><Save v-else :size="14" />保存</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="project-text-footer">
          <span>{{ rows.length ? (page - 1) * pageSize + 1 + '–' + ((page - 1) * pageSize + rows.length).toLocaleString() + ' 条' : ' ' }}</span>
          <div><button class="button compact" :disabled="page <= 1 || busy || savingAll" @click="page--"><ChevronLeft :size="14" />上一页</button><button class="button compact" :disabled="page >= pageCount || busy || savingAll" @click="page++">下一页<ChevronRight :size="14" /></button></div>
          <button class="button" :disabled="hasPendingWork" @click="emit('close')"><ArrowLeft :size="14" />返回项目视图</button>
        </footer>
      </section>
    </div>
  </Transition>
</template>
