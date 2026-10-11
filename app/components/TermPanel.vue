<script setup lang="ts">
import { BookOpen, ChevronLeft, ChevronRight, Copy, Pencil, Plus, RotateCw, Search, Trash2, X } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { Term, TermPage } from '~/types/editor'
import type { WorkspaceNavigation } from '~/composables/useWorkspaceNavigation'

const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const emit = defineEmits<{ insert: [text: string] }>()
const navigation = inject<WorkspaceNavigation>('workspace-navigation')!
const root = ref<HTMLElement>(), termInput = ref<HTMLInputElement>()
const scope = ref<'matched' | 'all'>('matched'), search = ref(''), page = ref(1)
const catalog = ref<Term[]>([]), catalogLoaded = ref(false), catalogBusy = ref(false), catalogError = ref(''), loadCount = ref(0)
const formOpen = ref(false), snapshot = ref<Term | null>(null), operation = ref(''), error = ref(''), notice = ref(''), confirmDelete = ref(false), focusedId = ref<number | null>(null)
const form = reactive({ term: '', translation: '', pos: 'noun', note: '', variants: '', caseSensitive: false })
let catalogSequence = 0, operationSequence = 0
const blocked = computed(() => !props.editor.connected || !props.editor.sessionInfo.authenticated || catalogBusy.value || !!operation.value || props.editor.initializing || props.editor.listBusy || props.editor.reloadBusy)
const termList = computed(() => scope.value === 'matched' ? props.editor.terms : catalog.value)
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return termList.value.filter(term => `${term.term} ${term.translation} ${term.note || ''} ${(term.variants || []).join(' ')}`.toLocaleLowerCase().includes(query))
})
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 50)))
const visibleTerms = computed(() => filtered.value.slice((page.value - 1) * 50, page.value * 50))
const busy = computed(() => scope.value === 'matched' ? props.editor.termsBusy : catalogBusy.value)
const loadError = computed(() => scope.value === 'matched' ? props.editor.termsError : catalogError.value)
const posLabels: Record<string, string> = { noun: '名词', verb: '动词', adj: '形容词', adv: '副词' }
const posOptions = computed(() => [
  ...(snapshot.value && !snapshot.value.pos ? [{ value: '', label: '未指定' }] : []),
  ...Object.entries(posLabels).map(([value, label]) => ({ value, label })),
  ...(form.pos && !posLabels[form.pos] ? [{ value: form.pos, label: form.pos }] : []),
])
function content(term: Term) {
  return { term: term.term, translation: term.translation, pos: term.pos || '', note: term.note || '', variants: term.variants || [], caseSensitive: !!term.caseSensitive }
}
const input = computed(() => ({ term: form.term, translation: form.translation, pos: form.pos, note: form.note,
  variants: [...new Set(form.variants.split(/\r?\n/).map(value => value.trim()).filter(Boolean))], caseSensitive: form.caseSensitive }))
const changed = computed(() => !snapshot.value || JSON.stringify(input.value) !== JSON.stringify(content(snapshot.value)))
const canSave = computed(() => formOpen.value && !blocked.value && !!input.value.term.trim() && !!input.value.translation.trim() && changed.value)
const canDelete = computed(() => props.editor.connected && props.editor.sessionInfo.authenticated && ((snapshot.value?.uid !== undefined && snapshot.value.uid === props.editor.sessionInfo.user?.id) ||
  (navigation.projects.find(project => project.id === props.editor.project.id)?.permission || 0) >= 3))

async function loadCatalog(force = false) {
  if (catalogBusy.value || (catalogLoaded.value && !force)) return
  const sequence = ++catalogSequence, projectId = props.editor.project.id
  catalogBusy.value = true; catalogError.value = ''; loadCount.value = 0
  try {
    if (!props.editor.connected || !props.editor.sessionInfo.authenticated) return
    const rows: Term[] = []
    let nextPage = 1, lastPage = 1
    do {
      const result = await props.editor.api<TermPage>('projectTerms', { projectId, page: nextPage, pageSize: 800 })
      if (sequence !== catalogSequence) return
      if (!Array.isArray(result.results) || !Number.isInteger(result.pageCount) || result.pageCount < 0 || result.pageCount > 100000) throw new Error('术语列表格式无效')
      rows.push(...result.results); loadCount.value = rows.length
      lastPage = Math.max(1, result.pageCount); nextPage++
    } while (nextPage <= lastPage)
    if (sequence !== catalogSequence) return
    catalog.value = [...new Map(rows.map(term => [term.id, term])).values()]; catalogLoaded.value = true
  } catch (reason) { if (sequence === catalogSequence) catalogError.value = (reason as Error).message }
  finally { if (sequence === catalogSequence) catalogBusy.value = false }
}
function setScope(value: 'matched' | 'all') { scope.value = value; search.value = ''; page.value = 1; if (value === 'all') loadCatalog() }
function refresh() { if (scope.value === 'all') loadCatalog(true); else props.editor.loadTerms(true) }
function closeForm() { if (operation.value) return; formOpen.value = false; snapshot.value = null; confirmDelete.value = false; error.value = '' }
function formKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 's' || event.key === 'Enter')) {
    event.preventDefault(); event.stopPropagation(); save()
  } else if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation()
    if (!operation.value) { if (confirmDelete.value) confirmDelete.value = false; else closeForm() }
  }
}
function fill(term?: Term) {
  Object.assign(form, term ? { ...content(term), variants: (term.variants || []).join('\n') } : { term: '', translation: '', pos: 'noun', note: '', variants: '', caseSensitive: false })
}
function beginCreate() {
  if (blocked.value || formOpen.value) return
  snapshot.value = null; fill(); error.value = ''; notice.value = ''; confirmDelete.value = false; formOpen.value = true
  nextTick(() => termInput.value?.focus())
}
async function beginEdit(term: Term, reload = false) {
  if (blocked.value || (formOpen.value && !reload)) return
  const sequence = ++operationSequence, projectId = props.editor.project.id
  operation.value = 'load'; error.value = ''; notice.value = ''
  try {
    const full = await props.editor.api<Term>('term', { projectId, termId: term.id })
    if (sequence !== operationSequence) return
    if (!full || !full.id || typeof full.term !== 'string') throw new Error('术语不存在，请刷新列表')
    snapshot.value = JSON.parse(JSON.stringify(full)); fill(snapshot.value!); formOpen.value = true; confirmDelete.value = false
    nextTick(() => termInput.value?.focus())
  } catch (reason) { if (sequence === operationSequence) error.value = (reason as Error).message }
  finally { if (sequence === operationSequence) operation.value = '' }
}
async function save() {
  if (!canSave.value) return
  const sequence = ++operationSequence, projectId = props.editor.project.id, previous: Term | null = snapshot.value ? JSON.parse(JSON.stringify(snapshot.value)) : null, body = { ...input.value }
  operation.value = 'save'; error.value = ''; notice.value = ''
  try {
      const saved = await props.editor.api<Term>(previous ? 'updateTerm' : 'createTerm', { projectId, ...body, ...(previous ? { termId: previous.id, expected: previous } : {}) })
      if (!saved || !saved.id || typeof saved.term !== 'string') throw new Error('术语已提交，但返回格式无效，请刷新列表核对')
    if (sequence !== operationSequence) return
    if (catalogLoaded.value) catalog.value = [...catalog.value.filter(term => term.id !== saved.id), saved]
    formOpen.value = false; snapshot.value = null; confirmDelete.value = false; focusedId.value = saved.id
    notice.value = '术语已保存'
    await props.editor.loadTerms(true)
  } catch (reason) { if (sequence === operationSequence) error.value = (reason as Error).message }
  finally { if (sequence === operationSequence) operation.value = '' }
}
async function remove() {
  if (blocked.value || !snapshot.value || !confirmDelete.value || !canDelete.value) return
  const sequence = ++operationSequence, projectId = props.editor.project.id, term: Term = JSON.parse(JSON.stringify(snapshot.value))
  operation.value = 'delete'; error.value = ''; notice.value = ''
  try {
    await props.editor.api('deleteTerm', { projectId, termId: term.id, expected: term })
    if (sequence !== operationSequence) return
    catalog.value = catalog.value.filter(value => value.id !== term.id)
    formOpen.value = false; snapshot.value = null; confirmDelete.value = false
    notice.value = '术语已删除'
    await props.editor.loadTerms(true)
  } catch (reason) { if (sequence === operationSequence) error.value = (reason as Error).message }
  finally { if (sequence === operationSequence) operation.value = '' }
}
function focusTerm(id: number) {
  scope.value = 'matched'; search.value = ''; focusedId.value = id
  const index = props.editor.terms.findIndex(term => term.id === id); page.value = Math.max(1, Math.floor(index / 50) + 1)
  nextTick(() => { const card = root.value?.querySelector<HTMLElement>(`[data-term-id="${id}"]`); card?.focus({ preventScroll: true }); card?.scrollIntoView({ block: 'nearest' }) })
}
defineExpose({ focusTerm })
watch(search, () => { page.value = 1 })
watch(pageCount, count => { page.value = Math.min(page.value, count) })
watch(() => props.editor.selected?.id, () => { if (scope.value === 'matched') { search.value = ''; page.value = 1; focusedId.value = null } })
watch(() => [props.editor.project.id, props.editor.connected, props.editor.sessionInfo.user?.id, props.editor.sessionInfo.mode], () => {
  ++catalogSequence; ++operationSequence; catalogBusy.value = false; catalogLoaded.value = false; catalog.value = []; catalogError.value = ''
  operation.value = ''; formOpen.value = false; snapshot.value = null; confirmDelete.value = false; error.value = ''; notice.value = ''; search.value = ''; page.value = 1; focusedId.value = null
  if (scope.value === 'all' && props.editor.panel === 'terms') loadCatalog()
})
watch(() => props.editor.panel, value => { if (value === 'terms' && scope.value === 'all') loadCatalog() })
onBeforeUnmount(() => { ++catalogSequence; ++operationSequence })
</script>

<template>
  <section ref="root" class="term-manager" aria-label="术语管理">
    <div class="panel-heading"><span>项目术语</span><div class="term-manager-actions"><button class="icon-button small" aria-label="刷新术语" :disabled="busy || blocked" @click="refresh"><RotateCw :size="14" /></button><button class="button compact" :disabled="blocked || formOpen" @click="beginCreate"><Plus :size="14" />新增术语</button></div></div>
    <div class="term-scope" role="group" aria-label="术语范围"><button :class="{ active: scope === 'matched' }" :aria-pressed="scope === 'matched'" @click="setScope('matched')">当前词条 <span>{{ editor.terms.length }}</span></button><button :class="{ active: scope === 'all' }" :aria-pressed="scope === 'all'" @click="setScope('all')">全部术语 <span v-if="catalogLoaded">{{ catalog.length }}</span></button></div>
    <div class="term-search"><Search :size="15" /><input v-model="search" :placeholder="scope === 'all' ? '搜索项目术语' : '筛选当前词条术语'" aria-label="搜索术语" /><button v-if="search" class="icon-button small" aria-label="清除术语搜索" @click="search = ''"><X :size="13" /></button></div>
    <div v-if="operation === 'load'" class="term-operation" role="status"><LoadingIndicator :size="14" label="正在载入术语" />正在载入术语…</div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="notice" class="term-notice" role="status">{{ notice }}</p>
    <Transition name="panel"><form v-if="formOpen" class="term-edit-form" aria-label="术语编辑表单" @submit.prevent="save" @keydown="formKeydown">
      <div class="term-form-heading"><strong>{{ snapshot ? '编辑术语' : '新增术语' }}</strong><button type="button" class="icon-button small" aria-label="关闭术语编辑" :disabled="!!operation" @click="closeForm"><X :size="15" /></button></div>
      <label>术语原文<input ref="termInput" v-model="form.term" class="form-input" required maxlength="1000" :disabled="!!operation" /></label>
      <label>术语译文<textarea v-model="form.translation" class="form-input" required rows="2" maxlength="4000" :disabled="!!operation" /></label>
      <div class="term-pos-field"><span>词性</span><AppSelect v-model="form.pos" :options="posOptions" label="术语词性" :disabled="!!operation" /></div>
      <label>变体<textarea v-model="form.variants" class="form-input" rows="2" placeholder="每行一个变体" maxlength="100000" :disabled="!!operation" /></label>
      <label>备注<textarea v-model="form.note" class="form-input" rows="3" maxlength="12000" :disabled="!!operation" /></label>
      <label class="term-case-toggle"><input v-model="form.caseSensitive" type="checkbox" :disabled="!!operation" />区分大小写</label>
      <div class="term-form-actions"><button v-if="snapshot" type="button" class="icon-button small term-delete" aria-label="删除此术语" :title="canDelete ? '删除术语' : '仅创建者或管理员可删除'" :disabled="blocked || !canDelete" @click="confirmDelete = !confirmDelete"><Trash2 :size="15" /></button><button v-if="snapshot && error" type="button" class="button compact" :disabled="blocked" @click="beginEdit(snapshot, true)">重新载入</button><span></span><button type="button" class="button compact" :disabled="!!operation" @click="closeForm">取消</button><button class="button primary compact" :disabled="!canSave"><LoadingIndicator v-if="operation === 'save'" :size="13" label="正在保存术语" />{{ operation === 'save' ? '保存中…' : '保存术语' }}</button></div>
      <div v-if="confirmDelete && snapshot" class="term-delete-confirm" role="group" aria-label="确认删除术语"><strong>删除「{{ snapshot.term }}」？</strong><div><button type="button" class="button compact" :disabled="!!operation" @click="confirmDelete = false">取消</button><button type="button" class="button compact danger" :disabled="blocked || !canDelete" @click="remove"><LoadingIndicator v-if="operation === 'delete'" :size="13" label="正在删除术语" />确认删除</button></div></div>
    </form></Transition>
    <LoadingRegion :busy="busy" :initial="!termList.length" :label="scope === 'all' && loadCount ? `正在加载术语（${loadCount}）…` : '正在加载术语…'">
      <div v-if="loadError" class="panel-error" role="alert"><p>{{ loadError }}</p><button class="button compact" :disabled="busy" @click="refresh">重新获取</button></div>
      <div v-else-if="!filtered.length" class="empty-state"><BookOpen :size="34" :stroke-width="1.25" /><h3>{{ search ? '没有搜索结果' : scope === 'all' ? '暂无项目术语' : '没有匹配的术语' }}</h3></div>
      <article v-for="term in visibleTerms" :key="term.id" class="term-card" :class="{ 'focused-term': focusedId === term.id }" :data-term-id="term.id" tabindex="-1"><div class="term-header"><strong>{{ term.term }}</strong><span class="term-pos">{{ posLabels[term.pos || ''] || term.pos }}</span><button class="icon-button small" :disabled="blocked || formOpen" :aria-label="`编辑术语 ${term.term}`" title="编辑术语" @click="beginEdit(term)"><Pencil :size="15" /></button><button class="icon-button small" :disabled="editor.locked || editor.listBusy || editor.reloadBusy" :aria-label="`插入术语 ${term.term}`" @click="emit('insert', term.translation)"><Copy :size="15" /></button></div><div class="term-translation">{{ term.translation }}</div><div v-if="term.variants?.length" class="term-variants"><span v-for="variant in term.variants" :key="variant">{{ variant }}</span></div><p v-if="term.note" class="term-note">{{ term.note }}</p></article>
    </LoadingRegion>
    <div v-if="filtered.length > 50" class="term-pagination"><span>{{ filtered.length }} 条术语</span><button class="icon-button small" aria-label="上一页术语" :disabled="page === 1" @click="page--"><ChevronLeft :size="15" /></button><span>{{ page }} / {{ pageCount }}</span><button class="icon-button small" aria-label="下一页术语" :disabled="page === pageCount" @click="page++"><ChevronRight :size="15" /></button></div>
  </section>
</template>
