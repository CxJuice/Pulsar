<script setup lang="ts">
import { Search, X, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { useEditor } from '~/composables/useEditor'
import type { StringItem, StringPage } from '~/types/editor'
import { stageLabels } from '~/utils/text'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>>; original: string; projectId: number; projectName: string }>()
const emit = defineEmits<{ close: []; use: [text: string] }>()
const query = ref(props.original), results = ref<StringItem[]>([]), busy = ref(false), error = ref('')
const page = ref(1), pageCount = ref(1), rowCount = ref(0), searched = ref('')
const dialog = ref<HTMLElement>(), input = ref<HTMLInputElement>()
let previousFocus: HTMLElement | null = null
let sequence = 0
async function search(newPage = 1) {
  const request = ++sequence, text = query.value.trim()
  busy.value = false
  if (!text) { error.value = '请输入要查询的原文'; return }
  if (new TextEncoder().encode(text).length > 1000) { error.value = '原文过长，请选择较短的片段查询（最多 1000 UTF-8 字节）'; return }
  busy.value = true; error.value = ''
  try {
    if (!props.editor.connected || !props.editor.sessionInfo.authenticated) throw new Error('请先登录 ParaTranz')
    const data = await props.editor.api<StringPage>('strings', { projectId: props.projectId, text, searchMode: 'original', page: newPage, pageSize: 50 })
    if (request !== sequence) return
    results.value = data.results; page.value = data.page; pageCount.value = Math.max(1, data.pageCount); rowCount.value = data.rowCount; searched.value = text
  } catch (reason) { if (request === sequence) error.value = (reason as Error).message }
  finally { if (request === sequence) busy.value = false }
}
function open(item: StringItem) { window.scKit?.openExternal(`https://paratranz.cn/projects/${item.project}/strings?id=${item.id}`) }
function escape(event: KeyboardEvent) { if (event.key === 'Escape') { event.stopPropagation(); emit('close') } }
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') || [])
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => { previousFocus = document.activeElement as HTMLElement; input.value?.focus(); document.addEventListener('keydown', escape, true); search() })
onBeforeUnmount(() => { sequence++; document.removeEventListener('keydown', escape, true); if (previousFocus?.isConnected) previousFocus.focus() })
</script>
<template>
  <div class="modal-backdrop" @click.self="emit('close')"><section ref="dialog" class="concordance-dialog" role="dialog" aria-modal="true" aria-label="词汇索引" @keydown="trapFocus">
    <header><h2>词汇索引</h2><button class="icon-button" aria-label="关闭词汇索引" @click="emit('close')"><X :size="18" /></button></header>
    <p class="concordance-scope">{{ projectName }} · 所有文件、所有状态</p>
    <form class="concordance-search" @submit.prevent="search()"><Search :size="16" /><input ref="input" v-model="query" aria-label="查询原文" placeholder="输入原文或片段" /><button class="button" :disabled="busy">查询</button></form>
    <p v-if="searched" class="concordance-summary">{{ rowCount }} 条结果</p>
    <LoadingRegion :busy="busy" :initial="!searched" label="正在查询…"><div v-if="error" class="panel-error" role="alert">{{ error }}</div>
    <div v-else class="concordance-results"><p v-if="!results.length" class="empty-state">没有匹配的词条</p><article v-for="item in results" :key="item.id" class="concordance-row"><div class="concordance-pair"><div><ProtectedText :text="item.original" /></div><div>{{ item.translation || '尚无译文' }}</div></div><div class="concordance-meta"><span>{{ item.file?.name || `词条 ${item.id}` }} · {{ stageLabels[item.stage] }}</span><button class="text-button" :disabled="!editor.desktop" @click="open(item)">查看词条 <ExternalLink :size="12" /></button><button class="text-button" :disabled="!item.translation || editor.locked || editor.saving" @click="emit('use', item.translation); emit('close')">使用译文</button></div></article></div></LoadingRegion>
    <footer><span>{{ page }} / {{ pageCount }} 页</span><button class="icon-button" aria-label="上一页查询结果" :disabled="busy || page <= 1 || query.trim() !== searched" @click="search(page - 1)"><ChevronLeft :size="18" /></button><button class="icon-button" aria-label="下一页查询结果" :disabled="busy || page >= pageCount || query.trim() !== searched" @click="search(page + 1)"><ChevronRight :size="18" /></button></footer>
  </section></div>
</template>
