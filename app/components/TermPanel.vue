<script setup lang="ts">
import { BookOpen, ChevronLeft, ChevronRight, Copy, Pencil, Plus, RotateCw, Search, Trash2, X } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { CommunityTranslationCandidate, LocalUnresolvedTerm, Term, TermPage } from '~/types/editor'
import type { WorkspaceNavigation } from '~/composables/useWorkspaceNavigation'
import { translationCollectionUrl, translationVoteUrl } from '~/data/communityTranslationSources'
import { termTranslationAlternatives } from '~/utils/termHighlights'
import { matchLocalUnresolvedTerms, mergeLocalUnresolvedTerms, readLocalUnresolvedTerms } from '~/utils/localUnresolvedTerms'
import { deleteProjectTerm, projectTermCatalogScope, readProjectTermCatalog, syncProjectTermCatalog, upsertProjectTerm } from '~/utils/projectTermCatalogCache'

const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const emit = defineEmits<{ insert: [text: string] }>()
const navigation = inject<WorkspaceNavigation>('workspace-navigation')!
const termRecognitionEnabled = inject<Ref<boolean>>('workspace-term-recognition')!
const termExemptionPatterns = inject<Ref<RegExp[]>>('workspace-term-exemption-patterns')!
const root = ref<HTMLElement>(), termInput = ref<HTMLInputElement>()
type TermScope = 'matched' | 'all'
type TermListItem =
  | { kind: 'term'; key: string; term: Term; candidate?: LocalUnresolvedTerm }
  | { kind: 'candidate'; key: string; entry: LocalUnresolvedTerm }
const scope = ref<TermScope>('matched'), search = ref(''), page = ref(1)
const catalog = ref<Term[]>([]), catalogLoaded = ref(false), catalogBusy = ref(false), catalogError = ref(''), loadCount = ref(0)
const communityEntries = ref<CommunityTranslationCandidate[]>([]), communityBusy = ref(false), communityError = ref(''), communityWarnings = ref<string[]>([]), communityFetchedAt = ref('')
const localTerms = ref<LocalUnresolvedTerm[]>([]), localError = ref('')
const sharedUnresolvedTerms = useState<LocalUnresolvedTerm[]>('sckit-community-unresolved-terms', () => [])
function setLocalTerms(entries: LocalUnresolvedTerm[]) {
  localTerms.value = entries
  sharedUnresolvedTerms.value = entries
}
const formOpen = ref(false), snapshot = ref<Term | null>(null), operation = ref(''), error = ref(''), notice = ref(''), confirmDelete = ref(false), focusedId = ref<number | null>(null)
const form = reactive({ term: '', translation: '', pos: 'noun', note: '', variants: '', caseSensitive: false })
let catalogSequence = 0, communitySequence = 0, operationSequence = 0
const blocked = computed(() => !props.editor.connected || !props.editor.sessionInfo.authenticated || catalogBusy.value || (scope.value === 'all' && communityBusy.value) || !!operation.value || props.editor.initializing || props.editor.listBusy || props.editor.reloadBusy)
const communityProject = computed(() => String(props.editor.project.id).includes('8340'))
const mergedCandidates = computed(() => {
  const entries = new Map<string, LocalUnresolvedTerm>()
  for (const entry of localTerms.value) entries.set(entry.source.trim().toLocaleLowerCase(), entry)
  const feed = new Map<string, CommunityTranslationCandidate>()
  for (const entry of communityEntries.value) {
    const key = entry.source.trim().toLocaleLowerCase(), previous = feed.get(key)
    feed.set(key, { ...previous, ...entry, candidates: [...new Set([...(previous?.candidates || []), ...entry.candidates])] })
  }
  for (const [key, entry] of feed) {
    const previous = entries.get(key)
    entries.set(key, { ...previous, ...entry, candidates: entry.candidates, syncedAt: communityFetchedAt.value || previous?.syncedAt || '' })
  }
  return [...entries.values()]
})
const termItems = computed<TermListItem[]>(() => {
  const candidates = new Map(mergedCandidates.value.map(entry => [entry.source.trim().toLocaleLowerCase(), entry]))
  const matchedSources = new Set<string>()
  const items = catalog.value.map((term): TermListItem => {
    const source = term.term.trim().toLocaleLowerCase(), candidate = candidates.get(source)
    matchedSources.add(source)
    return { kind: 'term', key: `term:${term.id}`, term, ...(candidate ? { candidate } : {}) }
  })
  for (const entry of mergedCandidates.value) {
    const source = entry.source.trim().toLocaleLowerCase()
    if (!matchedSources.has(source)) items.push({ kind: 'candidate', key: `candidate:${entry.id}:${source}`, entry })
  }
  return items.sort((first, second) => {
    const firstText = first.kind === 'term' ? first.term.term : first.entry.source
    const secondText = second.kind === 'term' ? second.term.term : second.entry.source
    return firstText.localeCompare(secondText)
  })
})
// Community unresolved status is editorial metadata, so keep it visible even
// when automatic glossary recognition is disabled.
const matchedCandidates = computed(() => matchLocalUnresolvedTerms(props.editor.selected?.original || '', mergedCandidates.value))
const termList = computed<TermListItem[]>(() => {
  if (scope.value === 'all') return termItems.value
  const candidates = new Map(matchedCandidates.value.map(entry => [entry.source.trim().toLocaleLowerCase(), entry]))
  const matchedSources = new Set<string>()
  const items = props.editor.terms.map((term): TermListItem => {
    const source = term.term.trim().toLocaleLowerCase(), candidate = candidates.get(source)
    matchedSources.add(source)
    return { kind: 'term', key: `term:${term.id}`, term, ...(candidate ? { candidate } : {}) }
  })
  for (const entry of matchedCandidates.value) {
    const source = entry.source.trim().toLocaleLowerCase()
    if (!matchedSources.has(source)) items.push({ kind: 'candidate', key: `candidate:${entry.id}:${source}`, entry })
  }
  return items
})
const filteredTerms = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return termList.value.filter(item => {
    const text = item.kind === 'term'
      ? `${item.term.term} ${item.term.translation} ${item.term.note || ''} ${(item.term.variants || []).join(' ')} ${item.candidate?.category || ''} ${item.candidate?.candidates.join(' ') || ''} ${item.candidate?.topicTitle || ''}`
      : `${item.entry.source} ${item.entry.category} ${item.entry.candidates.join(' ')} ${item.entry.topicTitle} ${item.entry.sourceType}`
    return text.toLocaleLowerCase().includes(query)
  })
})
const filteredCount = computed(() => filteredTerms.value.length)
const pageCount = computed(() => Math.max(1, Math.ceil(filteredCount.value / 50)))
const visibleTerms = computed(() => filteredTerms.value.slice((page.value - 1) * 50, page.value * 50))
const busy = computed(() => scope.value === 'matched' ? props.editor.termsBusy || (communityProject.value && communityBusy.value) : catalogBusy.value || (communityProject.value && communityBusy.value))
const loadError = computed(() => scope.value === 'matched' ? props.editor.termsError : catalogError.value && !catalog.value.length && !mergedCandidates.value.length ? catalogError.value : '')
const posLabels: Record<string, string> = { noun: '名词', verb: '动词', adj: '形容词', adv: '副词' }
function unresolvedStatus() { return '译名未定 · 正在投票' }
function translationChoices(term: Term) {
  return termRecognitionEnabled.value ? termTranslationAlternatives(term, termExemptionPatterns.value) : term.translation.trim() ? [term.translation.trim()] : []
}
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
  const scopeKey = projectTermCatalogScope(projectId, props.editor.sessionInfo.user?.id, props.editor.sessionInfo.mode)
  catalogBusy.value = true; catalogError.value = ''; loadCount.value = 0
  try {
    if (!catalogLoaded.value) {
      try {
        const cached = await readProjectTermCatalog(scopeKey)
        if (sequence !== catalogSequence) return
        if (cached) {
          catalog.value = cached.terms; catalogLoaded.value = true
        }
      } catch (reason) {
        if (sequence !== catalogSequence) return
        catalogError.value = `读取本机术语缓存失败：${(reason as Error).message}`
      }
    }
    if (!force && catalogLoaded.value) return
    if (!props.editor.connected || !props.editor.sessionInfo.authenticated) {
      if (!catalogLoaded.value) catalogError.value = '尚无本机术语缓存，请连接 ParaTranz 后重试'
      return
    }
    const rows: Term[] = []
    let nextPage = 1, lastPage = 1, expectedRowCount = 0
    do {
      const result = await props.editor.api<TermPage>('projectTerms', { projectId, page: nextPage, pageSize: 800 })
      if (sequence !== catalogSequence) return
      if (!Array.isArray(result.results) || !Number.isInteger(result.pageCount) || result.pageCount < 0 || result.pageCount > 100000 || !Number.isInteger(result.rowCount) || result.rowCount < 0) throw new Error('术语列表格式无效')
      if (nextPage === 1) {
        lastPage = Math.max(1, result.pageCount)
        expectedRowCount = result.rowCount
      } else if (result.pageCount !== lastPage || result.rowCount !== expectedRowCount) {
        throw new Error('术语列表在同步期间发生变化，请重试')
      }
      if (result.results.some(term => !term || !Number.isInteger(term.id) || typeof term.term !== 'string' || typeof term.translation !== 'string')) throw new Error('术语列表包含无效记录')
      rows.push(...result.results); loadCount.value = rows.length
      nextPage++
    } while (nextPage <= lastPage)
    if (sequence !== catalogSequence) return
    const unique = new Map(rows.map(term => [term.id, term]))
    if (unique.size !== rows.length || unique.size !== expectedRowCount) throw new Error('术语分页结果不完整，保留现有缓存并请重试')
    const terms = [...unique.values()]
    catalog.value = terms; catalogLoaded.value = true
    await syncProjectTermCatalog(scopeKey, terms)
    if (sequence !== catalogSequence) return
    catalogError.value = ''
  } catch (reason) { if (sequence === catalogSequence) catalogError.value = (reason as Error).message }
  finally { if (sequence === catalogSequence) catalogBusy.value = false }
}
function setScope(value: TermScope) {
  scope.value = value; search.value = ''; page.value = 1
  if (value === 'all') {
    void loadCatalog()
    if (communityProject.value && !communityFetchedAt.value) void loadCommunityCandidates()
  }
}
function refresh() {
  if (scope.value === 'all') {
    void loadCatalog(true)
    if (communityProject.value) {
      communityFetchedAt.value = ''
      void loadCommunityCandidates()
    }
  }
  else props.editor.loadTerms(true)
}
function openForum(url: string) {
  if (props.editor.desktop) void window.scKit?.openExternal(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}
async function loadCommunityCandidates() {
  if (!communityProject.value || communityBusy.value) return
  const sequence = ++communitySequence
  communityBusy.value = true; communityError.value = ''; communityWarnings.value = []
  try {
    const result = await window.scKit?.fetchCommunityTranslationCandidates()
    if (sequence !== communitySequence) return
    if (!result) throw new Error('请在 ScTranslateKit 桌面应用中打开译名讨论页')
    if (!result.ok || !result.data) throw new Error(result.message || '译名讨论页暂时无法读取')
    communityEntries.value = result.data.entries
    communityWarnings.value = result.data.warnings
    communityFetchedAt.value = result.data.fetchedAt
    try {
      setLocalTerms(mergeLocalUnresolvedTerms(props.editor.project.id, result.data.entries))
      localError.value = ''
    } catch (reason) {
      localError.value = `已自动获取未定译名，但无法保存到本机术语库：${(reason as Error).message}`
    }
  } catch (reason) {
    if (sequence === communitySequence) communityError.value = (reason as Error).message
  } finally {
    if (sequence === communitySequence) communityBusy.value = false
  }
}
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
    if (catalogLoaded.value) {
      catalog.value = [...catalog.value.filter(term => term.id !== saved.id), saved]
      void upsertProjectTerm(projectTermCatalogScope(projectId, props.editor.sessionInfo.user?.id, props.editor.sessionInfo.mode), saved).catch(() => undefined)
    }
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
    if (catalogLoaded.value) void deleteProjectTerm(projectTermCatalogScope(projectId, props.editor.sessionInfo.user?.id, props.editor.sessionInfo.mode), term.id).catch(() => undefined)
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
watch(() => props.editor.project.id, () => {
  ++communitySequence; communityBusy.value = false; communityEntries.value = []; communityError.value = ''; communityWarnings.value = []; communityFetchedAt.value = ''
  localError.value = ''
  setLocalTerms(communityProject.value ? readLocalUnresolvedTerms(props.editor.project.id) : [])
  if (communityProject.value) void loadCommunityCandidates()
}, { immediate: true })
watch(() => props.editor.panel, value => {
  if (value === 'terms' && scope.value === 'all') loadCatalog()
  if (value === 'terms' && communityProject.value) void loadCommunityCandidates()
})
onBeforeUnmount(() => { ++catalogSequence; ++communitySequence; ++operationSequence })
</script>

<template>
  <section ref="root" class="term-manager" aria-label="术语管理">
    <div class="panel-heading"><span>项目术语</span><div class="term-manager-actions"><div v-if="communityProject" class="term-community-links" aria-label="社区译名活动"><button class="button compact" @click="openForum(translationVoteUrl)">投票</button><button class="button compact" @click="openForum(translationCollectionUrl)">征集</button></div><button class="icon-button small" aria-label="刷新术语" :disabled="busy || blocked" @click="refresh"><RotateCw :size="14" /></button><button class="button compact" :disabled="blocked || formOpen" @click="beginCreate"><Plus :size="14" />新增术语</button></div></div>
    <div class="term-scope" role="group" aria-label="术语范围"><button :class="{ active: scope === 'matched' }" :aria-pressed="scope === 'matched'" @click="setScope('matched')">当前词条 <span>{{ termList.length }}</span></button><button :class="{ active: scope === 'all' }" :aria-pressed="scope === 'all'" @click="setScope('all')">全部词条 <span v-if="catalogLoaded">{{ termItems.length }}</span></button></div>
    <div class="term-search"><Search :size="15" /><input v-model="search" :placeholder="scope === 'all' ? '搜索全部词条' : '筛选当前词条术语'" aria-label="搜索术语" /><button v-if="search" class="icon-button small" aria-label="清除术语搜索" @click="search = ''"><X :size="13" /></button></div>
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
    <p v-if="scope === 'all' && catalogError && catalog.length" class="community-feed-warning" role="status">术语同步失败，继续显示本机缓存：{{ catalogError }}</p>
    <p v-if="scope === 'all' && communityWarnings.length" class="community-feed-warning" role="status">部分讨论帖读取失败：{{ communityWarnings.join('；') }}</p>
    <p v-if="scope === 'all' && catalogError && mergedCandidates.length" class="community-feed-warning" role="status">项目术语加载失败，仍显示已合并的候选内容：{{ catalogError }}</p>
    <p v-if="scope === 'all' && communityError" class="community-feed-warning" role="status">社区候选同步失败，仍显示本机已缓存的内容：{{ communityError }}</p>
    <p v-if="scope === 'all' && localError" class="community-feed-warning" role="status">{{ localError }}</p>
    <LoadingRegion :busy="busy" :initial="!filteredCount" :label="scope === 'all' && loadCount ? `${catalogLoaded ? '正在同步' : '正在加载'}术语（${loadCount}）…` : '正在加载术语…'">
      <div v-if="loadError" class="panel-error" role="alert"><p>{{ loadError }}</p><button class="button compact" :disabled="busy" @click="refresh">重新获取</button></div>
      <div v-else-if="!filteredCount" class="empty-state"><BookOpen :size="34" :stroke-width="1.25" /><h3>{{ search ? '没有搜索结果' : scope === 'all' ? '暂无项目术语' : '没有匹配的术语' }}</h3></div>
      <template v-else>
        <article v-for="item in visibleTerms" :key="item.key" class="term-card" :class="{ 'community-term-card': item.kind === 'candidate', 'focused-term': item.kind === 'term' && focusedId === item.term.id }" :data-term-id="item.kind === 'term' ? item.term.id : undefined" tabindex="-1">
          <template v-if="item.kind === 'term'">
            <div class="term-header">
              <strong>{{ item.term.term }}</strong><span class="term-pos">{{ posLabels[item.term.pos || ''] || item.term.pos }}</span>
              <button class="icon-button small" :disabled="blocked || formOpen" :aria-label="`编辑术语 ${item.term.term}`" title="编辑术语" @click="beginEdit(item.term)"><Pencil :size="15" /></button>
              <button v-if="item.candidate || translationChoices(item.term).length <= 1" class="icon-button small" :disabled="editor.locked || editor.listBusy || editor.initializing || editor.reloadBusy" :aria-label="item.candidate ? `填入未定译名原文 ${item.term.term}` : `插入术语 ${item.term.term}`" :title="item.candidate ? '论坛译名未定，填入原文' : '插入术语译文'" @mousedown.prevent @click="emit('insert', item.candidate ? item.term.term : item.term.translation)"><Copy :size="15" /></button>
            </div>
            <div v-if="!item.candidate && translationChoices(item.term).length > 1" class="term-translation-options" aria-label="多个术语译名"><span>选择译名并点击填入</span><button v-for="translation in translationChoices(item.term)" :key="translation" type="button" class="term-translation-option" :disabled="editor.locked || editor.listBusy || editor.initializing || editor.reloadBusy" :aria-label="`填入译名 ${translation}`" @mousedown.prevent @click="emit('insert', translation)">{{ translation }}</button></div>
            <div v-else class="term-translation">{{ item.term.translation }}</div>
            <div v-if="item.term.variants?.length" class="term-variants"><span v-for="variant in item.term.variants" :key="variant">{{ variant }}</span></div>
            <p v-if="item.term.note" class="term-note">{{ item.term.note }}</p>
            <template v-if="item.candidate"><div class="community-candidates" aria-label="相关译名未定候选">
              <button type="button" class="community-term-status" :disabled="editor.locked || editor.listBusy || editor.initializing || editor.reloadBusy" :title="`译名未定，点击填入原文 ${item.term.term}`" @mousedown.prevent @click="emit('insert', item.term.term)">{{ unresolvedStatus() }} · {{ item.candidate.category }}</button>
              <button v-for="candidate in item.candidate.candidates" :key="candidate" type="button" class="community-candidate-option" :disabled="editor.locked || editor.listBusy || editor.initializing || editor.reloadBusy" :title="`论坛候选「${candidate}」尚未确认，点击填入原文 ${item.term.term}`" @mousedown.prevent @click="emit('insert', item.term.term)">{{ candidate }}</button>
              <button class="text-button" @click="openForum(item.candidate!.topicUrl)">讨论帖</button>
            </div></template>
          </template>
          <template v-else>
            <div class="term-header"><strong>{{ item.entry.source }}</strong><span class="term-pos">{{ item.entry.category }}</span><button type="button" class="community-term-status" :disabled="editor.locked || editor.listBusy || editor.initializing || editor.reloadBusy" :title="`译名未定，点击填入原文 ${item.entry.source}`" @mousedown.prevent @click="emit('insert', item.entry.source)">{{ unresolvedStatus() }}</button><button class="button compact" @click="openForum(item.entry.topicUrl)">讨论帖</button></div>
            <div v-if="item.entry.candidates.length" class="community-candidates" aria-label="论坛候选译名"><button v-for="candidate in item.entry.candidates" :key="candidate" type="button" class="community-candidate-option" :disabled="editor.locked || editor.listBusy || editor.initializing || editor.reloadBusy" :title="`论坛候选「${candidate}」尚未确认，点击填入原文 ${item.entry.source}`" @mousedown.prevent @click="emit('insert', item.entry.source)">{{ candidate }}</button></div>
            <p v-else class="term-note">尚未发现候选译名</p><p class="term-note">{{ item.entry.topicTitle }}</p>
          </template>
        </article>
      </template>
    </LoadingRegion>
    <div v-if="filteredCount > 50" class="term-pagination"><span>{{ filteredCount }} 条术语</span><button class="icon-button small" aria-label="上一页术语" :disabled="page === 1" @click="page--"><ChevronLeft :size="15" /></button><span>{{ page }} / {{ pageCount }}</span><button class="icon-button small" aria-label="下一页术语" :disabled="page === pageCount" @click="page++"><ChevronRight :size="15" /></button></div>
  </section>
</template>
