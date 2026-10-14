<script setup lang="ts">
import { Activity, ArrowRight, BookOpen, CalendarDays, Check, FileText, FolderOpen, History, Languages, Megaphone, MessageSquare, RefreshCw, UsersRound } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { FileInfo, HistoryEntry } from '~/types/editor'
import type { WorkspaceNavigation } from '~/composables/useWorkspaceNavigation'
import { fileCompletionPercent, sortFilesByCompletion } from '~/utils/fileSort'

const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>>; navigation: WorkspaceNavigation }>()
const recent = ref<HistoryEntry[]>([])
const busy = ref(false)
const error = ref('')
const sequence = ref(0)
const totals = computed(() => props.navigation.files.reduce((sum, file) => ({
  words: sum.words + file.words,
  strings: sum.strings + file.total,
  translated: sum.translated + file.translated,
  checked: sum.checked + file.checked,
  reviewed: sum.reviewed + file.reviewed,
}), { words: 0, strings: 0, translated: 0, checked: 0, reviewed: 0 }))
const translationPercent = computed(() => totals.value.strings ? Math.min(100, Math.round(totals.value.translated / totals.value.strings * 100)) : 0)
const reviewPercent = computed(() => totals.value.strings ? Math.min(100, Math.round(totals.value.reviewed / totals.value.strings * 100)) : 0)
const recentFiles = computed(() => sortFilesByCompletion(props.navigation.files).slice(0, 7))
const projectVersion = computed(() => String(props.navigation.browse.version || props.navigation.browse.currentVersion || ''))

function dateText(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date)
}
function operationText(value?: string) {
  return ({ translate: '翻译', edit: '编辑', check: '校对', review: '审核', reset: '重置', dispute: '标记疑问', rollback: '回滚', lock: '锁定', hide: '隐藏', import: '导入' } as Record<string, string>)[value || ''] || value || '更新'
}
function historyKey(item: HistoryEntry) {
  if (typeof item.target === 'string') return item.target
  const target = item.target as Record<string, unknown> | undefined
  return String(target?.key || (item.tid ? `词条 ${item.tid}` : '项目记录'))
}
function historyDescription(item: HistoryEntry) {
  if (item.field) return `${item.field}：${item.from || '（空）'} → ${item.to || item.translation || '（空）'}`
  if (item.translation) return item.translation
  return item.to || item.from || ''
}
async function refresh() {
  const id = ++sequence.value
  busy.value = true
  error.value = ''
  try {
    const result = await props.editor.api<{ results?: HistoryEntry[] } | HistoryEntry[]>('projectSection', { projectId: props.navigation.browse.id, section: 'history', page: 1, pageSize: 8 })
    if (id !== sequence.value) return
    recent.value = Array.isArray(result) ? result : result.results || []
  } catch (reason) {
    if (id === sequence.value) error.value = (reason as Error).message || '最近项目动态读取失败'
  } finally {
    if (id === sequence.value) busy.value = false
  }
}
async function openLatest(item: HistoryEntry) {
  if (item.tid) await props.navigation.openString(props.navigation.browse.id, item.tid)
}
async function startTranslation() {
  if (props.editor.workspaceReady && props.editor.project.id === props.navigation.browse.id) {
    await props.navigation.continueEditing()
    return
  }
  const next = sortFilesByCompletion(props.navigation.files)[0]
  if (next) await props.navigation.chooseFile(next)
  else await props.navigation.openProjectSection('files')
}
watch(() => props.navigation.browse.id, () => { recent.value = []; void refresh() }, { immediate: true })
</script>

<template>
  <main class="project-overview">
    <header class="overview-project-header">
      <div class="overview-mark" aria-hidden="true">{{ navigation.browse.name.slice(0, 1) || 'P' }}</div>
      <div class="overview-project-copy">
        <div class="overview-breadcrumb">项目工作区 <span>/</span> {{ navigation.browse.name }}</div>
        <h1>{{ navigation.browse.name }}</h1>
        <div class="overview-project-meta">
          <span><Languages :size="13" />{{ navigation.browse.source || '原文' }} → {{ navigation.browse.dest || '译文' }}</span>
          <span><UsersRound :size="13" />项目 #{{ navigation.browse.id }}</span>
          <span v-if="navigation.browse.createdAt"><CalendarDays :size="13" />创建于 {{ dateText(navigation.browse.createdAt) }}</span>
          <span v-if="projectVersion">版本 {{ projectVersion }}</span>
        </div>
        <p v-if="navigation.browse.desc">{{ navigation.browse.desc }}</p>
      </div>
      <div class="overview-project-actions">
        <button class="button primary" :disabled="navigation.blocked || !navigation.files.length" @click="startTranslation"><FileText :size="15" />{{ editor.workspaceReady && editor.project.id === navigation.browse.id ? '继续翻译' : '开始翻译' }}</button>
        <button class="button" :disabled="navigation.blocked" @click="navigation.openProjectSection('files')"><FolderOpen :size="15" />浏览文件</button>
      </div>
    </header>

    <div class="overview-scroll">
      <section class="overview-metrics" aria-label="项目翻译统计">
        <div class="overview-metric"><span>总字数</span><strong>{{ totals.words.toLocaleString() }}</strong><small>按文件统计</small></div>
        <div class="overview-metric"><span>总词条</span><strong>{{ totals.strings.toLocaleString() }}</strong><small>{{ navigation.files.length.toLocaleString() }} 个项目文件</small></div>
        <div class="overview-metric"><span>已翻译</span><strong>{{ totals.translated.toLocaleString() }}</strong><div class="overview-meter"><span :style="{ width: `${translationPercent}%` }" /></div><small>{{ translationPercent }}% 完成</small></div>
        <div class="overview-metric"><span>已审核</span><strong>{{ totals.reviewed.toLocaleString() }}</strong><div class="overview-meter review"><span :style="{ width: `${reviewPercent}%` }" /></div><small>{{ reviewPercent }}% 已审核 · {{ totals.checked.toLocaleString() }} 已校对</small></div>
      </section>

      <div class="overview-columns">
        <section class="overview-panel overview-files-panel">
          <header class="overview-panel-heading"><div><h2><FolderOpen :size="16" />文件进度</h2><p>按文件查看翻译与审核进度，选择文件即可进入编辑器。</p></div><button class="button compact" :disabled="navigation.blocked" @click="navigation.openProjectSection('files')">全部文件<ArrowRight :size="13" /></button></header>
          <div v-if="!recentFiles.length" class="overview-empty">当前项目没有可翻译文件。</div>
          <div v-for="file in recentFiles" :key="file.id" class="overview-file-row">
            <button class="overview-file-open" :disabled="navigation.blocked" :title="`打开 ${file.name}`" @click="navigation.chooseFile(file)"><FileText :size="15" /><span>{{ file.name }}</span><small>{{ file.translated.toLocaleString() }} / {{ file.total.toLocaleString() }}</small></button>
            <div class="overview-file-progress"><span :style="{ width: `${fileCompletionPercent(file)}%` }" /></div>
            <small class="overview-file-percent">{{ fileCompletionPercent(file) }}%</small>
          </div>
          <p v-if="navigation.files.length > recentFiles.length" class="overview-more">显示完成度最低的 {{ recentFiles.length }} 个文件，共 {{ navigation.files.length.toLocaleString() }} 个。</p>
        </section>

        <section class="overview-panel overview-activity-panel">
          <header class="overview-panel-heading"><div><h2><Activity :size="16" />最近动态</h2><p>项目最近发生的翻译、校对和审核变更。</p></div><button class="icon-button small" aria-label="刷新最近动态" title="刷新" :disabled="busy" @click="refresh"><RefreshCw :size="14" :class="{ spin: busy }" /></button></header>
          <div v-if="error" class="overview-error" role="alert">{{ error }} <button @click="refresh">重试</button></div>
          <div v-else-if="busy && !recent.length" class="overview-empty">正在读取最近动态…</div>
          <div v-else-if="!recent.length" class="overview-empty">还没有项目动态。</div>
          <div v-for="(item, index) in recent" :key="item.id || `${item.tid}-${index}`" class="overview-activity-row">
            <span class="overview-activity-dot" :class="`operation-${item.operation || 'update'}`"><Check v-if="item.operation === 'review' || item.operation === 'check'" :size="12" /><History v-else :size="12" /></span>
            <div class="overview-activity-copy"><div><strong>{{ item.user?.nickname || item.user?.username || `用户 ${item.uid || ''}` }}</strong><span class="overview-operation">{{ operationText(item.operation) }}</span><button v-if="item.tid" class="overview-history-key" @click="openLatest(item)">{{ historyKey(item) }}</button><span v-else>{{ historyKey(item) }}</span></div><p v-if="historyDescription(item)">{{ historyDescription(item) }}</p><small>{{ dateText(item.createdAt) }}</small></div>
            <button v-if="item.tid" class="icon-button small" :disabled="navigation.blocked" :aria-label="`打开词条 ${historyKey(item)}`" title="在编辑器中打开" @click="openLatest(item)"><ArrowRight :size="14" /></button>
          </div>
          <button class="overview-history-link" :disabled="navigation.blocked" @click="navigation.openProjectSection('history')"><History :size="13" />查看完整历史记录<ArrowRight :size="13" /></button>
        </section>
      </div>

      <nav class="overview-shortcuts" aria-label="项目管理快捷入口">
        <button @click="navigation.openProjectSection('announcements')"><span><Megaphone :size="16" /></span><strong>公告</strong><small>查看项目通知</small></button>
        <button @click="navigation.openProjectSection('terms')"><span><BookOpen :size="16" /></span><strong>术语</strong><small>统一译名与变体</small></button>
        <button @click="navigation.openProjectSection('issues')"><span><MessageSquare :size="16" /></span><strong>讨论</strong><small>参与项目协作</small></button>
        <button @click="navigation.openProjectSection('members')"><span><UsersRound :size="16" /></span><strong>成员</strong><small>查看成员与贡献</small></button>
      </nav>
    </div>
  </main>
</template>

<style scoped>
.project-overview{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;background:var(--soft)}
.overview-project-header{display:flex;align-items:center;gap:18px;padding:22px 26px;border-bottom:1px solid var(--border);background:var(--bg)}
.overview-mark{display:grid;place-items:center;flex:0 0 76px;width:76px;height:76px;border:1px solid var(--border);border-radius:8px;background:var(--accent-soft);color:var(--accent);font-size:32px;font-weight:650}
.overview-project-copy{flex:1;min-width:0}.overview-breadcrumb{margin-bottom:7px;color:var(--muted);font-size:10px}.overview-breadcrumb span{padding:0 6px;color:var(--border)}.overview-project-copy h1{color:var(--text);font-size:20px;font-weight:650;overflow-wrap:anywhere}.overview-project-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px;color:var(--muted);font-size:10px}.overview-project-meta>span{display:flex;align-items:center;gap:5px}.overview-project-meta svg{color:var(--accent)}.overview-project-copy>p{max-width:980px;margin-top:8px;color:var(--secondary);font-size:11px;line-height:1.75;white-space:pre-wrap}.overview-project-actions{display:flex;flex:0 0 auto;gap:7px}.overview-project-actions .button{min-height:34px}
.overview-scroll{min-height:0;flex:1;overflow:auto;padding:18px 22px 24px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.overview-metrics{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));border:1px solid var(--border);background:var(--bg)}.overview-metric{display:flex;min-width:0;flex-direction:column;gap:5px;padding:14px 16px;border-right:1px solid var(--border)}.overview-metric:last-child{border-right:0}.overview-metric>span{color:var(--secondary);font-size:10px}.overview-metric>strong{color:var(--text);font-size:21px;font-weight:650;font-variant-numeric:tabular-nums}.overview-metric>small{color:var(--muted);font-size:9px}.overview-meter,.overview-file-progress{height:5px;overflow:hidden;border-radius:4px;background:var(--border)}.overview-meter>span,.overview-file-progress>span{display:block;height:100%;border-radius:inherit;background:var(--accent);transition:width .2s}.overview-meter.review>span{background:#339e75}
.overview-columns{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(330px,1fr);gap:14px;margin-top:14px}.overview-panel{min-width:0;border:1px solid var(--border);background:var(--bg)}.overview-panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:13px 15px;border-bottom:1px solid var(--border)}.overview-panel-heading h2{display:flex;align-items:center;gap:7px;color:var(--text);font-size:12px;font-weight:600}.overview-panel-heading h2 svg{color:var(--accent)}.overview-panel-heading p{margin-top:4px;color:var(--muted);font-size:9px;line-height:1.5}.overview-file-row{display:grid;grid-template-columns:minmax(0,1fr) 92px 38px;align-items:center;gap:12px;padding:9px 15px;border-bottom:1px solid var(--border)}.overview-file-open{display:flex;align-items:center;gap:8px;min-width:0;text-align:left;color:var(--text)}.overview-file-open>svg{flex:0 0 auto;color:var(--muted)}.overview-file-open>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.overview-file-open>small,.overview-file-percent{color:var(--muted);font-size:9px;font-variant-numeric:tabular-nums;white-space:nowrap}.overview-file-percent{text-align:right}.overview-more{padding:9px 15px;color:var(--muted);font-size:9px}.overview-activity-row{display:flex;align-items:flex-start;gap:9px;padding:9px 13px;border-bottom:1px solid var(--border)}.overview-activity-dot{display:grid;place-items:center;flex:0 0 23px;width:23px;height:23px;border:1px solid var(--border);border-radius:50%;color:var(--accent)}.overview-activity-dot.operation-review,.overview-activity-dot.operation-check{color:#339e75}.overview-activity-copy{flex:1;min-width:0}.overview-activity-copy>div{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--secondary);font-size:10px}.overview-activity-copy>div strong{color:var(--text);font-weight:550}.overview-operation{padding:2px 5px;border-radius:3px;background:var(--accent-soft);color:var(--accent);font-size:9px}.overview-history-key{overflow:hidden;max-width:240px;color:var(--accent);font-size:10px;text-overflow:ellipsis;white-space:nowrap;text-align:left}.overview-activity-copy>p{display:-webkit-box;margin-top:4px;overflow:hidden;color:var(--secondary);font-size:9px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-line-clamp:2;-webkit-box-orient:vertical}.overview-activity-copy>small{display:block;margin-top:4px;color:var(--muted);font-size:9px}.overview-empty{padding:22px 12px;color:var(--muted);font-size:10px;text-align:center}.overview-error{padding:12px;color:var(--warning);font-size:10px}.overview-history-link{display:flex;align-items:center;gap:6px;padding:10px 14px;color:var(--accent);font-size:10px}.overview-history-link svg:last-child{margin-left:auto}.overview-shortcuts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin-top:14px;border:1px solid var(--border);background:var(--border)}.overview-shortcuts>button{display:grid;grid-template-columns:28px 1fr;grid-template-rows:auto auto;column-gap:8px;align-items:center;padding:12px;background:var(--bg);text-align:left}.overview-shortcuts>button:hover{background:var(--accent-soft)}.overview-shortcuts>button>span{grid-row:1/3;display:grid;place-items:center;width:28px;height:28px;border-radius:4px;background:var(--accent-soft);color:var(--accent)}.overview-shortcuts strong{color:var(--text);font-size:10px;font-weight:550}.overview-shortcuts small{margin-top:3px;color:var(--muted);font-size:9px}
@media(max-width:1050px){.overview-columns{grid-template-columns:1fr}.overview-activity-panel{min-height:180px}}
@media(max-width:720px){.overview-project-header{align-items:flex-start;flex-wrap:wrap;padding:15px}.overview-mark{flex-basis:48px;width:48px;height:48px;font-size:21px}.overview-project-copy{width:calc(100% - 68px)}.overview-project-copy h1{font-size:16px}.overview-project-actions{width:100%;padding-left:66px}.overview-scroll{padding:12px}.overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.overview-metric:nth-child(2){border-right:0}.overview-metric:nth-child(-n+2){border-bottom:1px solid var(--border)}.overview-file-row{grid-template-columns:minmax(0,1fr) 55px 30px;gap:7px;padding:9px}.overview-file-open>small{display:none}.overview-shortcuts{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
