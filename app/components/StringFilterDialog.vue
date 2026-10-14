<script setup lang="ts">
import { Search, X, Plus, Trash2 } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { AdvancedStringFilters, StringFileLabel, StringFilterUser, StringSearchCondition, StringSearchField, StringSearchOperator } from '~/types/editor'
import type { useEditor } from '~/composables/useEditor'
import { stageLabels } from '~/utils/text'

type UserFilterKey = 'lastModifiedBy' | 'translateBy' | 'reviewBy'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>>; initialSort: string }>()
const emit = defineEmits<{ close: []; apply: [filters: AdvancedStringFilters, sort: string] }>()
const emptyFilters = (): AdvancedStringFilters => ({
  conditions: [], filename: '', fileLabels: [], stages: [], createdAtFrom: '', createdAtTo: '', updatedAtFrom: '', updatedAtTo: '',
  lastModifiedScope: '', lastModifiedBy: [], translateBy: [], reviewBy: [], searchInCurrentFile: true, ignoreCase: false, includeHidden: false,
})
function copyFilters(filters: AdvancedStringFilters): AdvancedStringFilters {
  return { ...filters, conditions: filters.conditions.map(item => ({ ...item })), fileLabels: filters.fileLabels.map(item => ({ ...item })), stages: [...filters.stages],
    lastModifiedBy: filters.lastModifiedBy.map(item => ({ ...item })), translateBy: filters.translateBy.map(item => ({ ...item })), reviewBy: filters.reviewBy.map(item => ({ ...item })) }
}
const draft = reactive(copyFilters(props.editor.advancedFilters))
if (!draft.stages.length && props.editor.stageFilter !== null) draft.stages.push(props.editor.stageFilter)
const sort = ref(props.initialSort)
const dialog = ref<HTMLElement>()
const availableFileLabels = ref<StringFileLabel[]>([])
const fileLabelsBusy = ref(false)
const fileLabelsError = ref('')
let previousFocus: HTMLElement | null = null
const fieldOptions: Array<{ value: StringSearchField; label: string }> = [
  { value: 'text', label: '文本' }, { value: 'original', label: '原文' }, { value: 'translation', label: '译文' },
  { value: 'key', label: '键值' }, { value: 'context', label: '上下文' },
]
const operatorOptions: Array<{ value: StringSearchOperator; label: string }> = [
  { value: '=', label: '包含' }, { value: '@=', label: '等于' }, { value: '^=', label: '开头是' },
  { value: '$=', label: '结尾是' }, { value: '~=', label: '正则匹配' }, { value: '!=', label: '不包含' },
  { value: '!@=', label: '不等于' }, { value: '!^=', label: '开头不是' }, { value: '!$=', label: '结尾不是' }, { value: '!~=', label: '正则不匹配' },
]
const stages = Object.entries(stageLabels).map(([value, label]) => ({ value: Number(value), label }))
const sortOptions = [
  { value: 'default', label: '默认顺序' }, { value: 'key', label: '键值 A–Z' },
  { value: 'updated', label: '最近修改' }, { value: 'length', label: '原文长度' },
]
const userFilters: Array<{ key: UserFilterKey; label: string }> = [
  { key: 'lastModifiedBy', label: '最后修改者' }, { key: 'translateBy', label: '译者' }, { key: 'reviewBy', label: '审核者' },
]
const userQueries = reactive<Record<UserFilterKey, string>>({ lastModifiedBy: '', translateBy: '', reviewBy: '' })
const userResults = reactive<Record<UserFilterKey, StringFilterUser[]>>({ lastModifiedBy: [], translateBy: [], reviewBy: [] })
const userBusy = reactive<Record<UserFilterKey, boolean>>({ lastModifiedBy: false, translateBy: false, reviewBy: false })
const userErrors = reactive<Record<UserFilterKey, string>>({ lastModifiedBy: '', translateBy: '', reviewBy: '' })
const statusSummary = computed(() => draft.stages.length ? draft.stages.map(stage => stageLabels[stage] || String(stage)).join('、') : '所有状态')
const dialogError = ref('')

function addCondition() { draft.conditions.push({ field: 'text', operator: '=', value: '' }) }
function removeCondition(index: number) { draft.conditions.splice(index, 1) }
function toggleStage(stage: number, checked: boolean) {
  if (checked && !draft.stages.includes(stage)) draft.stages.push(stage)
  if (!checked) draft.stages = draft.stages.filter(value => value !== stage)
}
function toggleFileLabel(label: StringFileLabel, checked: boolean) {
  if (checked && !draft.fileLabels.some(item => item.id === label.id)) draft.fileLabels.push(label)
  if (!checked) draft.fileLabels = draft.fileLabels.filter(item => item.id !== label.id)
}
async function loadFileLabels() {
  if (!props.editor.connected || !props.editor.sessionInfo.authenticated) return
  fileLabelsBusy.value = true; fileLabelsError.value = ''
  try {
    const result = await props.editor.api<unknown>('fileLabels', { projectId: props.editor.project.id })
    const rows = Array.isArray(result) ? result : result && typeof result === 'object' && Array.isArray((result as { results?: unknown[] }).results) ? (result as { results: unknown[] }).results : []
    availableFileLabels.value = rows.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const label = item as Record<string, unknown>, id = Number(label.id)
      const name = [label.name, label.label, label.title].find(value => typeof value === 'string' && value.trim())
      return Number.isSafeInteger(id) && id > 0 && typeof name === 'string' ? [{ ...label, id, name: name.trim() } as StringFileLabel] : []
    })
  } catch (error) { fileLabelsError.value = (error as Error).message || '文件标签读取失败' }
  finally { fileLabelsBusy.value = false }
}
async function searchUsers(key: UserFilterKey) {
  const query = userQueries[key].trim()
  if (!query) { userErrors[key] = '请输入用户名或昵称'; return }
  if (!props.editor.connected || !props.editor.sessionInfo.authenticated) { userErrors[key] = '请先连接并登录 ParaTranz'; return }
  userBusy[key] = true; userErrors[key] = ''
  try {
    const result = await props.editor.api<unknown>('userSearch', { projectId: props.editor.project.id, query })
    const rows = Array.isArray(result) ? result : result && typeof result === 'object' && Array.isArray((result as { results?: unknown[] }).results) ? (result as { results: unknown[] }).results : []
    userResults[key] = rows.filter((item): item is StringFilterUser => !!item && typeof item === 'object' && Number.isSafeInteger((item as StringFilterUser).id) && typeof (item as StringFilterUser).username === 'string')
  } catch (error) { userErrors[key] = (error as Error).message || '用户查询失败' }
  finally { userBusy[key] = false }
}
function addUser(key: UserFilterKey, user: StringFilterUser) {
  const selected = draft[key]
  if (!selected.some(item => item.id === user.id)) selected.push(user)
  if (key === 'lastModifiedBy') draft.lastModifiedScope = ''
  userResults[key] = userResults[key].filter(item => item.id !== user.id)
}
function removeUser(key: UserFilterKey, id: number) { draft[key] = draft[key].filter(user => user.id !== id) }
function changeModifierScope(value: '' | 'me' | 'others') {
  draft.lastModifiedScope = value
  if (value) draft.lastModifiedBy = []
}
function resetDraft() {
  Object.assign(draft, emptyFilters())
  userQueries.lastModifiedBy = userQueries.translateBy = userQueries.reviewBy = ''
  userResults.lastModifiedBy = userResults.translateBy = userResults.reviewBy = []
  userErrors.lastModifiedBy = userErrors.translateBy = userErrors.reviewBy = ''
  sort.value = 'default'; dialogError.value = ''
}
function submit() { dialogError.value = ''; emit('apply', copyFilters(draft), sort.value) }
function escape(event: KeyboardEvent) { if (event.key === 'Escape') { event.stopPropagation(); emit('close') } }
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || [])
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => { previousFocus = document.activeElement as HTMLElement; document.addEventListener('keydown', escape, true); dialog.value?.querySelector<HTMLElement>('button')?.focus(); void loadFileLabels() })
onBeforeUnmount(() => { document.removeEventListener('keydown', escape, true); if (previousFocus?.isConnected) previousFocus.focus() })
</script>

<template>
  <div class="modal-backdrop string-filter-backdrop" @click.self="emit('close')">
    <section ref="dialog" class="string-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="string-filter-title" @keydown="trapFocus">
      <header class="string-filter-header"><div><h2 id="string-filter-title">高级筛选</h2><p>组合条件会同时生效。当前状态范围：{{ statusSummary }}</p></div><button class="icon-button" aria-label="关闭高级筛选" @click="emit('close')"><X :size="18" /></button></header>
      <div class="string-filter-body">
        <section class="string-filter-section"><div class="string-filter-section-heading"><div><h3>文本条件</h3><p>可组合多条条件；正则表达式按 ParaTranz 规则匹配。</p></div><button class="button compact" @click="addCondition"><Plus :size="14" />添加条件</button></div>
          <div v-if="!draft.conditions.length" class="string-filter-empty">未添加额外文本条件</div>
          <div v-for="(condition, index) in draft.conditions" :key="index" class="string-filter-condition">
            <select v-model="condition.field" class="form-input" :aria-label="`第 ${index + 1} 条条件的字段`"><option v-for="field in fieldOptions" :key="field.value" :value="field.value">{{ field.label }}</option></select>
            <select v-model="condition.operator" class="form-input" :aria-label="`第 ${index + 1} 条条件的匹配方式`"><option v-for="operator in operatorOptions" :key="operator.value" :value="operator.value">{{ operator.label }}</option></select>
            <input v-model="condition.value" class="form-input" :aria-label="`第 ${index + 1} 条条件的内容`" placeholder="搜索字符串或正则表达式" @keydown.enter.prevent="submit" />
            <button class="icon-button small" :aria-label="`删除第 ${index + 1} 条条件`" @click="removeCondition(index)"><Trash2 :size="14" /></button>
          </div>
        </section>

        <section class="string-filter-section"><h3>状态与文件</h3>
          <div class="string-filter-checks"><label v-for="stage in stages" :key="stage.value"><input type="checkbox" :checked="draft.stages.includes(stage.value)" @change="toggleStage(stage.value, ($event.target as HTMLInputElement).checked)" /><span>{{ stage.label }}</span></label></div>
          <label class="string-filter-field"><span>文件名或路径</span><input v-model="draft.filename" class="form-input" placeholder="例如 Data/Items.json" /></label>
          <div v-if="fileLabelsBusy" class="string-filter-empty">正在读取文件标签…</div>
          <p v-else-if="fileLabelsError" class="string-filter-error" role="alert">{{ fileLabelsError }}</p>
          <div v-else-if="availableFileLabels.length" class="string-filter-field"><span>文件标签</span><div class="string-filter-checks"><label v-for="label in availableFileLabels" :key="label.id"><input type="checkbox" :checked="draft.fileLabels.some(item => item.id === label.id)" @change="toggleFileLabel(label, ($event.target as HTMLInputElement).checked)" /><span>{{ label.name }}</span></label></div></div>
          <label v-if="editor.fileId > 0" class="string-filter-toggle"><input v-model="draft.searchInCurrentFile" type="checkbox" /><span><strong>仅搜索当前文件</strong><small>取消后在整个项目中搜索，并在结果中显示来源文件。</small></span></label>
          <label class="string-filter-toggle"><input v-model="draft.includeHidden" type="checkbox" /><span><strong>包含隐藏词条</strong></span></label>
          <label class="string-filter-toggle"><input v-model="draft.ignoreCase" type="checkbox" /><span><strong>忽略大小写</strong></span></label>
        </section>

        <section class="string-filter-section"><h3>日期范围</h3><div class="string-filter-date-grid">
          <label><span>创建时间从</span><input v-model="draft.createdAtFrom" class="form-input" type="datetime-local" /></label>
          <label><span>到</span><input v-model="draft.createdAtTo" class="form-input" type="datetime-local" /></label>
          <label><span>修改时间从</span><input v-model="draft.updatedAtFrom" class="form-input" type="datetime-local" /></label>
          <label><span>到</span><input v-model="draft.updatedAtTo" class="form-input" type="datetime-local" /></label>
        </div></section>

        <section class="string-filter-section"><h3>用户</h3>
          <div class="string-filter-modifier"><span>最后修改者</span><select class="form-input" :value="draft.lastModifiedScope" aria-label="最后修改范围" @change="changeModifierScope(($event.target as HTMLSelectElement).value as '' | 'me' | 'others')"><option value="">不限</option><option value="me">我</option><option value="others">其他用户</option></select></div>
          <div v-for="filter in userFilters" :key="filter.key" class="string-filter-user"><label :for="`user-filter-${filter.key}`">{{ filter.label }}</label>
            <div class="string-filter-user-search"><input :id="`user-filter-${filter.key}`" v-model="userQueries[filter.key]" class="form-input" :placeholder="`按用户名或昵称查询${filter.label}`" @keydown.enter.prevent="searchUsers(filter.key)" /><button class="button compact" :disabled="userBusy[filter.key]" @click="searchUsers(filter.key)"><LoadingIndicator v-if="userBusy[filter.key]" :size="13" label="正在查询用户" /><Search v-else :size="13" />查询</button></div>
            <p v-if="userErrors[filter.key]" class="string-filter-error" role="alert">{{ userErrors[filter.key] }}</p>
            <div v-if="userResults[filter.key].length" class="string-filter-user-results"><button v-for="user in userResults[filter.key]" :key="user.id" class="string-filter-user-result" @click="addUser(filter.key, user)"><span>{{ user.nickname || user.username }}</span><small>@{{ user.username }}</small><Plus :size="13" /></button></div>
            <div v-if="draft[filter.key].length" class="string-filter-chips"><span v-for="user in draft[filter.key]" :key="user.id" class="string-filter-chip">{{ user.nickname || user.username }}<small>@{{ user.username }}</small><button :aria-label="`移除 ${user.username}`" @click="removeUser(filter.key, user.id)"><X :size="12" /></button></span></div>
          </div>
        </section>

        <section class="string-filter-section"><h3>排序</h3><label class="string-filter-field"><span>结果顺序</span><select v-model="sort" class="form-input"><option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label></section>
        <p v-if="dialogError" class="string-filter-error" role="alert">{{ dialogError }}</p>
      </div>
      <footer class="string-filter-footer"><button class="button" @click="resetDraft">重置</button><span></span><button class="button" @click="emit('close')">取消</button><button class="button primary" @click="submit">应用筛选</button></footer>
    </section>
  </div>
</template>
