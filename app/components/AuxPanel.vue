<script setup lang="ts">
import { Lightbulb, History, BookOpen, ShieldCheck, MessageSquare, ArrowDownToLine, Search, TriangleAlert, RotateCw, GitCompareArrows } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { useEditor } from '~/composables/useEditor'
import type { HistoryEntry, Suggestion } from '~/types/editor'
import { displayDate, stageLabels } from '~/utils/text'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>>; compact?: boolean }>()
const emit = defineEmits<{ insert: [text: string]; replace: [text: string] }>()
const termPanel = ref<{ focusTerm: (id: number) => void }>()
const memorySearch = ref<{ focus: () => void }>()
function openHistorySearch() { props.editor.panel = 'suggestions'; nextTick(() => memorySearch.value?.focus()) }
const auxRoot = ref<HTMLElement>()
const panelBusy = computed(() => props.editor.panel === 'terms' ? props.editor.termsBusy : props.editor.auxBusy)
const panelHasData = computed(() => props.editor.panel === 'terms' ? props.editor.terms.length > 0 : props.editor.panel === 'history' ? props.editor.history.length > 0 : props.editor.suggestions.length > 0)
const panelError = computed(() => props.editor.panel === 'terms' ? props.editor.termsError : props.editor.auxError)
function retryPanel() { if (props.editor.panel === 'terms') props.editor.loadTerms(true); else props.editor.loadAux() }
function searchKeydown(event: KeyboardEvent) {
  if (props.editor.panel !== 'suggestions' || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
  event.preventDefault(); event.stopPropagation()
  openHistorySearch()
}
function focusTerm(id: number) { nextTick(() => termPanel.value?.focusTerm(id)) }

defineExpose({ focusTerm, openHistorySearch })
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
function historyTranslation(entry: HistoryEntry) {
  let target = entry.target
  if (typeof target === 'string') { try { target = JSON.parse(target) } catch { target = undefined } }
  const value = entry.translation ?? (typeof target === 'object' ? target?.translation : undefined) ?? (entry.field === 'translation' ? entry.to : undefined)
  return typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : ''
}
const tabs = [
  { id: 'suggestions', label: '建议', icon: Lightbulb }, { id: 'history', label: '历史', icon: History },
  { id: 'terms', label: '术语', icon: BookOpen }, { id: 'quality', label: 'QA', icon: ShieldCheck }, { id: 'comments', label: '评论', icon: MessageSquare },
] as const
const visibleTabs = computed(() => props.compact ? [{ id: 'context' as const, label: '上下文' }, ...tabs] : tabs)
</script>
<template>
  <aside ref="auxRoot" class="aux-panel" aria-label="翻译辅助面板" @keydown="searchKeydown">
    <div class="aux-scroll">
    <nav class="aux-tabs" aria-label="辅助面板标签">
      <button v-for="tab in visibleTabs" :key="tab.id" :class="{ active: editor.panel === tab.id }" :aria-pressed="editor.panel === tab.id" @click="editor.panel = tab.id"><span>{{ tab.label }}</span><span v-if="tab.id === 'suggestions' && editor.panel === 'suggestions' && editor.suggestions.length" class="tab-count">{{ editor.suggestions.length }}</span><span v-if="tab.id === 'terms' && editor.terms.length" class="tab-count">{{ editor.terms.length }}</span><span v-if="tab.id === 'quality' && editor.text && editor.issues.length" class="tab-count warning">{{ editor.issues.length }}</span></button>
    </nav>
      <TermPanel ref="termPanel" v-show="editor.panel === 'terms'" :editor="editor" @insert="emit('insert', $event)" />
      <QualityPanel v-show="editor.panel === 'quality'" :editor="editor" @insert="emit('insert', $event)" />
      <Transition name="panel" mode="out-in"><div v-show="!['terms', 'quality'].includes(editor.panel)" :key="editor.panel" class="aux-content">
      <template v-if="editor.panel === 'context'"><slot name="context" /></template>
      <div v-else-if="panelBusy && !panelHasData && editor.panel === 'history'" class="panel-loading"><LoadingIndicator :size="24" label="正在获取辅助信息" /><span>正在获取{{ tabs.find(tab => tab.id === editor.panel)?.label }}…</span></div>
      <div v-else-if="panelError && !panelBusy && editor.panel === 'history'" class="panel-error" role="alert"><TriangleAlert :size="22" /><p>{{ panelError }}</p><button class="button" @click="retryPanel"><RotateCw :size="14" />重新获取</button></div>
      <template v-else-if="editor.panel === 'suggestions'">
        <div class="panel-heading suggestion-heading"><span>{{ editor.suggestions.length }} 可用建议</span><button class="button compact" :disabled="!editor.selected" @click="lookup()">词汇索引</button></div>
        <TranslationMemorySearch ref="memorySearch" :editor="editor" @replace="emit('replace', $event)">
          <LoadingRegion :busy="panelBusy" :initial="!editor.suggestions.length" label="正在获取建议…">
          <div v-if="panelError && !panelBusy" class="panel-error" role="alert"><TriangleAlert :size="22" /><p>{{ panelError }}</p><button class="button" @click="retryPanel"><RotateCw :size="14" />重新获取</button></div>
          <template v-else>
        <div v-if="!editor.suggestions.length" class="empty-state"><Lightbulb :size="34" :stroke-width="1.25" /><h3>暂无翻译建议</h3></div>
        <article v-for="(suggestion, index) in editor.suggestions" :key="suggestion.id" class="suggestion-card">
          <div class="match-badge" title="本地计算的完整原文 Levenshtein 相似度"><strong>{{ matching(suggestion.localMatching ?? 0) }}</strong><span>匹配</span></div>
          <div class="suggestion-body">
            <div class="suggestion-translation">{{ suggestion.translation.replaceAll('\\n', '\n') }}</div>
            <SuggestionSource :original="suggestion.original" :current="editor.selected?.original || ''" :show-diff="!plainSources.includes(suggestion.id)" />
            <div class="suggestion-meta"><span v-if="suggestion.updatedAt">于 {{ displayDate(suggestion.updatedAt) }} </span><span v-if="suggestion.user">由 {{ suggestion.user.nickname || suggestion.user.username }} </span><span>来自 </span><button class="suggestion-origin" :disabled="!editor.desktop" :title="suggestion.key" @click="openSuggestion(suggestion)">{{ suggestion.project?.name || editor.project.name }}<span v-if="suggestion.file?.name"> / {{ suggestion.file.name }}</span></button><span> · {{ editor.project.dest }}</span><div v-if="!suggestion.file?.name" class="suggestion-key" :title="suggestion.key">{{ suggestion.key }}</div><button class="suggestion-occurrences" @click="lookup(suggestion)">显示所有出现的情况</button></div>
          </div>
          <div class="suggestion-actions"><button class="icon-button small" :aria-label="`切换建议 ${index + 1} 的原文差异`" :aria-pressed="!plainSources.includes(suggestion.id)" :title="plainSources.includes(suggestion.id) ? '显示与当前原文的差异' : '显示建议原文'" @click="toggleDiff(suggestion.id)"><GitCompareArrows :size="15" /></button><button class="icon-button small" :disabled="!suggestion.translation || editor.locked || editor.saving" :aria-label="`使用建议 ${index + 1}`" title="使用此译文" @click="emit('replace', suggestion.translation)"><ArrowDownToLine :size="15" /></button><span class="memory-label">TM</span></div>
        </article>
        
          </template>
          </LoadingRegion>
        </TranslationMemorySearch>
      </template>
      <template v-else-if="editor.panel === 'history'">
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
    </div>
    <div class="aux-bottom"><span class="online-dot" :class="{ offline: !editor.connected || !editor.sessionInfo.authenticated }"></span>{{ editor.connected && editor.sessionInfo.authenticated ? '来自 ParaTranz' : '未连接' }}</div>
    <Teleport to=".app-shell"><Transition name="dialog"><ConcordanceDialog v-if="concordance" :editor="editor" v-bind="concordance" @close="concordance = null" @use="emit('replace', $event)" /></Transition></Teleport>
  </aside>
</template>
