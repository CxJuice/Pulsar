<script setup lang="ts">
import { CircleCheck, ShieldCheck, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ExternalLink, X } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { StringItem, StringPage } from '~/types/editor'
import type { QualityEntry, QualityReport } from '~/utils/quality'
import { checkFileQuality } from '~/utils/textWorker'
import { toEditorText } from '~/utils/translationText'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const emit = defineEmits<{ insert: [text: string] }>()
const scope = ref<'entry' | 'file'>('entry'), busy = ref(false), status = ref(''), error = ref('')
const report = shallowRef<QualityReport | null>(null), stale = ref(false), page = ref(1), expanded = ref<number[]>([]), entryLimits = ref<Record<number, number>>({})
let sequence = 0
const identity = computed(() => JSON.stringify([props.editor.project.id, props.editor.fileId, props.editor.connected, props.editor.sessionInfo.authenticated, props.editor.sessionInfo.user?.id, props.editor.sessionInfo.mode]))
const pageCount = computed(() => Math.max(1, Math.ceil((report.value?.findings.length || 0) / 25)))
const visible = computed(() => report.value?.findings.slice((page.value - 1) * 25, page.value * 25) || [])
const blocked = computed(() => !props.editor.connected || !props.editor.sessionInfo.authenticated || busy.value || props.editor.initializing || props.editor.listBusy || !props.editor.workspaceReady)
function cancel() { sequence++; busy.value = false; status.value = '' }
watch(identity, () => { cancel(); report.value = null; error.value = ''; stale.value = false; page.value = 1; expanded.value = []; entryLimits.value = {} })
watch(() => [props.editor.text, props.editor.selected?.translation, props.editor.drafts], () => { if (report.value) stale.value = true }, { deep: true })
onBeforeUnmount(cancel)
function toggle(index: number) { expanded.value = expanded.value.includes(index) ? expanded.value.filter(value => value !== index) : [...expanded.value, index] }
function openEntry(entry: QualityEntry) {
  window.scKit?.openExternal(`https://paratranz.cn/projects/${props.editor.project.id}/strings?id=${entry.id}`)
}
async function scan() {
  if (blocked.value) return
  const request = ++sequence, e = props.editor, projectId = e.project.id, fileId = e.fileId
  const account = identity.value, current = () => request === sequence && identity.value === account
  busy.value = true; error.value = ''; status.value = '正在读取词条…'
  try {
    const rows: StringItem[] = []
    {
      let nextPage = 1, lastPage = 1, expectedCount = 0
      do {
        const result = await e.api<StringPage>('strings', { projectId, fileId, page: nextPage, pageSize: 500, stage: null, text: '', searchMode: 'text' })
        if (!current()) return
        if (!Array.isArray(result.results) || !Number.isInteger(result.pageCount) || result.pageCount < 0 || result.pageCount > 100000 || !Number.isInteger(result.rowCount) || result.rowCount < 0 || result.page !== nextPage || result.results.some(row => {
          const rowFile = row.fileId ?? (typeof row.file === 'number' ? row.file : row.file?.id)
          return (row.project !== undefined && row.project !== projectId) || (rowFile !== undefined && rowFile !== fileId) || !Number.isInteger(row.id) || typeof row.key !== 'string' || typeof row.original !== 'string' || typeof row.translation !== 'string'
        })) throw new Error('文件词条返回格式无效，请重新检查')
        rows.push(...result.results); lastPage = Math.max(1, result.pageCount)
        expectedCount = result.rowCount
        if (nextPage < lastPage && !result.results.length) throw new Error('文件词条读取不完整，请重新检查')
        status.value = `正在读取词条… ${rows.length} / ${result.rowCount}`; nextPage++
      } while (nextPage <= lastPage)
      if (new Set(rows.map(row => row.id)).size !== expectedCount) throw new Error('文件词条读取不完整或已变化，请重新检查')
    }
    if (!current()) return
    const entries: QualityEntry[] = [...new Map(rows.map(row => [row.id, row])).values()].map(row => ({
      id: row.id, key: row.key, original: row.original,
      translation: e.selected?.id === row.id ? e.text : e.drafts[`${projectId}/${row.id}`]?.translation ?? row.translation,
    }))
    status.value = `正在检查 ${entries.length} 条词条…`
    const snapshot = JSON.stringify([e.selected?.id, e.text, e.drafts])
    const result = await checkFileQuality(entries)
    if (!current()) return
    report.value = result; page.value = 1; expanded.value = []; entryLimits.value = {}; stale.value = snapshot !== JSON.stringify([e.selected?.id, e.text, e.drafts])
  } catch (reason) { if (current()) error.value = (reason as Error).message }
  finally { if (current()) { busy.value = false; status.value = '' } }
}
</script>
<template>
  <section class="aux-content qa-panel" aria-label="译文质量检查">
    <div class="panel-heading"><span>译文质量检查</span><span class="subtle">本地检查</span></div>
    <div class="qa-scope" role="group" aria-label="检查范围"><button :class="{ active: scope === 'entry' }" :aria-pressed="scope === 'entry'" @click="scope = 'entry'">当前词条</button><button :class="{ active: scope === 'file' }" :aria-pressed="scope === 'file'" @click="scope = 'file'">当前文件</button></div>
    <template v-if="scope === 'entry'">
      <div v-if="!editor.selected" class="empty-state"><ShieldCheck :size="30" /><h3>未选择词条</h3></div>
      <template v-else>
        <div class="quality-summary" :class="{ passed: !editor.issues.length }"><CircleCheck v-if="!editor.issues.length" :size="30" /><ShieldCheck v-else :size="30" /><h3>{{ !editor.text.trim() ? '输入译文后自动检查' : editor.issues.length ? `${editor.issues.length} 项待检查` : '未发现问题' }}</h3></div>
        <QualityIssueCard v-for="issue in editor.issues" :key="issue.type" :issue="issue" :allow-insert="!editor.locked && !editor.saving" @insert="emit('insert', $event)" />
      </template>
    </template>
    <template v-else>
      <div class="qa-file-toolbar"><span :title="editor.file.name">{{ editor.file.name }}</span><button class="button compact" :disabled="blocked" @click="scan">{{ report ? '重新检查' : '检查当前文件' }}</button></div>
      <div v-if="busy" class="qa-progress" role="status"><LoadingIndicator :size="20" :label="status" /><span>{{ status }}</span><button class="icon-button small" title="取消检查" aria-label="取消检查" @click="cancel"><X :size="16" /></button></div>
      <p v-if="error" class="qa-error" role="alert">{{ error }}</p>
      <p v-if="stale" class="qa-stale">译文已变化，请重新检查。</p>
      <div v-if="report" class="qa-file-summary">{{ report.scanned }} 条词条 · {{ report.findings.length }} 项待检查</div>
      <div v-if="report && !report.findings.length" class="quality-summary passed"><CircleCheck :size="30" /><h3>未发现问题</h3></div>
      <div v-for="(finding, index) in visible" :key="`${page}-${index}`" class="qa-finding">
        <QualityIssueCard :issue="finding" />
        <button class="qa-expand" :aria-expanded="expanded.includes((page - 1) * 25 + index)" @click="toggle((page - 1) * 25 + index)"><span>{{ finding.entries.length }} 条相关词条</span><ChevronUp v-if="expanded.includes((page - 1) * 25 + index)" :size="15" /><ChevronDown v-else :size="15" /></button>
        <div v-if="expanded.includes((page - 1) * 25 + index)" class="qa-entries">
          <article v-for="entry in finding.entries.slice(0, entryLimits[(page - 1) * 25 + index] || 50)" :key="entry.id" class="qa-entry"><div class="qa-entry-heading"><strong>{{ entry.key }}</strong><button v-if="editor.desktop && editor.connected" class="icon-button small" title="在 ParaTranz 查看" aria-label="在 ParaTranz 查看此词条" @click="openEntry(entry)"><ExternalLink :size="14" /></button></div><span class="subtle">原文</span><p>{{ toEditorText(entry.original) }}</p><span class="subtle">译文</span><p>{{ toEditorText(entry.translation) || '（空译文）' }}</p></article>
          <button v-if="finding.entries.length > (entryLimits[(page - 1) * 25 + index] || 50)" class="button compact" @click="entryLimits[(page - 1) * 25 + index] = (entryLimits[(page - 1) * 25 + index] || 50) + 50">显示更多词条</button>
        </div>
      </div>
      <div v-if="pageCount > 1" class="qa-pagination"><button class="icon-button small" :disabled="page <= 1" aria-label="上一页检查结果" @click="page--; expanded = []"><ChevronLeft :size="16" /></button><span>{{ page }} / {{ pageCount }}</span><button class="icon-button small" :disabled="page >= pageCount" aria-label="下一页检查结果" @click="page++; expanded = []"><ChevronRight :size="16" /></button></div>
    </template>
  </section>
</template>
