<script setup lang="ts">
import { Search, ArrowDownToLine, RotateCw } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { useEditor } from '~/composables/useEditor'
import type { MemoryEntry, MemoryPage } from '~/types/editor'
import { displayDate, stageLabels } from '~/utils/text'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const emit = defineEmits<{ replace: [text: string] }>()
const query = ref(''), field = ref('')
const fieldOptions = [{ value: '', label: '文本或键值' }, { value: 'original', label: '原文' }, { value: 'translation', label: '译文' }, { value: 'key', label: '键值' }]
const searchInput = ref<HTMLInputElement>()
const busy = ref(false), error = ref(''), searched = ref(false), activeQuery = ref('')
const result = ref<MemoryPage | null>(null)
let sequence = 0
const count = computed(() => typeof result.value?.rowCount === 'number' ? result.value.rowCount : result.value?.rowCount.value || 0)
const approximate = computed(() => typeof result.value?.rowCount === 'object' && result.value.rowCount.relation !== 'eq')
async function search() {
  const text = query.value.trim(), request = ++sequence
  error.value = ''; busy.value = false
  if (!text) { clear(); return }
  if (new TextEncoder().encode(text).length > 1000) { error.value = '搜索文本不能超过 1000 字节'; return }
  busy.value = true
  const searchField = field.value, projectId = props.editor.project.id
  try {
    if (!props.editor.connected || !props.editor.sessionInfo.authenticated) throw new Error('请先登录 ParaTranz')
    const data = await props.editor.api<MemoryPage>('memory', { projectId, text, field: searchField })
    if (request !== sequence) return
    result.value = data; activeQuery.value = text; searched.value = true
  } catch (reason) { if (request === sequence) error.value = (reason as Error).message }
  finally { if (request === sequence) busy.value = false }
}
function clear() { ++sequence; query.value = ''; activeQuery.value = ''; busy.value = false; error.value = ''; searched.value = false; result.value = null; searchInput.value?.focus() }
watch(query, value => { if (!value) clear() })
function openEntry(entry: MemoryEntry) { window.scKit?.openExternal(`https://paratranz.cn/projects/${entry.project.id}/strings?id=${entry.id}`) }
watch(() => props.editor.project.id, clear)
watch(() => props.editor.connected, clear)
onMounted(() => searchInput.value?.focus())
onBeforeUnmount(() => { ++sequence })
defineExpose({ focus: () => searchInput.value?.focus() })
</script>
<template>
  <section class="memory-search" aria-label="搜索历史翻译">
    <form class="memory-search-form" @submit.prevent="search">
      <AppSelect v-model="field" :options="fieldOptions" label="历史翻译搜索范围" />
      <div class="suggestion-search"><Search :size="15" /><input ref="searchInput" v-model="query" type="search" placeholder="搜索全局历史翻译" aria-label="输入原文、译文或键值进行搜索" @keydown.esc.stop.prevent="clear" /><button v-if="query" type="button" @click="clear">清除</button><button type="submit" aria-label="搜索历史翻译" :disabled="busy || !query.trim()"><LoadingIndicator v-if="busy" :size="15" label="正在搜索历史翻译" /><Search v-else :size="15" /></button></div>
      
    </form>
    <LoadingRegion :busy="busy" :initial="!searched" label="正在搜索历史翻译…">
    <div v-if="error" class="panel-error" role="alert"><p>{{ error }}</p><button class="button" @click="search"><RotateCw :size="14" />重新搜索</button></div>
    <template v-else-if="searched">
      <div class="memory-result-count">{{ approximate ? '至少 ' : '' }}{{ count }} 条结果<span v-if="result && count > result.results.length"> · 显示前 {{ result.results.length }} 条</span></div>
      <div v-if="!result?.results.length" class="empty-state"><Search :size="34" :stroke-width="1.25" /><h3>没有相关结果</h3></div>
      <article v-for="entry in result?.results || []" :key="`${entry.project.id}/${entry.id}`" class="memory-result-card">
        <div class="memory-result-key" :title="entry.key"><SearchHighlightedText :text="entry.key" :query="activeQuery" /></div>
        <div class="memory-result-original"><SearchHighlightedText :text="entry.original" :query="activeQuery" /></div>
        <div class="suggestion-translation"><SearchHighlightedText :text="entry.translation" :query="activeQuery" /></div>
        <div class="memory-result-meta"><span>{{ stageLabels[entry.stage] || '历史翻译' }}</span><span v-if="entry.user">{{ entry.user.nickname || entry.user.username }}</span><time>{{ displayDate(entry.updatedAt || entry.createdAt) }}</time></div>
        <div class="memory-result-footer"><button class="suggestion-origin" :disabled="!editor.desktop" @click="openEntry(entry)">{{ entry.project.name }}</button><button class="button compact" :disabled="!entry.translation || editor.locked" @click="emit('replace', entry.translation)"><ArrowDownToLine :size="14" />使用译文</button></div>
      </article>
      
    </template>
    <slot v-else />
    </LoadingRegion>
  </section>
</template>
