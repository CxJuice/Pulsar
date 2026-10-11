<script setup lang="ts">
import { TriangleAlert, X, ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const expanded = ref(false), opening = ref<number | null>(null), openError = ref('')
const failures = computed(() => expanded.value ? [...props.editor.submissionFailures].reverse() : props.editor.submissionFailures.slice(-1))
async function open(id: number) {
  if (opening.value !== null) return
  opening.value = id; openError.value = ''
  try { if (await props.editor.openSubmission(id)) await navigateTo('/editor') }
  catch (reason) { openError.value = (reason as Error).message }
  finally { opening.value = null }
}
</script>
<template>
  <aside v-if="editor.submissionFailures.length" class="submission-notifications" aria-label="提交失败通知">
    <article v-for="failure in failures" :key="failure.id" class="submission-warning" role="alert">
      <div class="submission-warning-heading"><TriangleAlert :size="17" /><strong>词条提交失败</strong><button class="icon-button small" aria-label="关闭此提交警告" title="关闭警告，保留草稿" @click="editor.dismissSubmission(failure.id)"><X :size="14" /></button></div>
      <p class="submission-warning-key" :title="failure.item.key">{{ failure.item.key }}</p>
      <p>{{ failure.message }}</p>
      <div class="submission-warning-actions"><span>草稿已保留</span><button class="text-button" :disabled="opening !== null || editor.listBusy || editor.initializing || editor.reloadBusy" @click="open(failure.id)">{{ opening === failure.id ? '正在打开…' : '返回词条' }}</button></div>
    </article>
    <p v-if="openError" class="submission-open-error" role="alert">{{ openError }}</p>
    <button v-if="editor.submissionFailures.length > 1" class="submission-expand" :aria-expanded="expanded" @click="expanded = !expanded"><ChevronUp v-if="expanded" :size="14" /><ChevronDown v-else :size="14" />{{ expanded ? '收起' : `显示其余 ${editor.submissionFailures.length - 1} 条失败` }}</button>
  </aside>
</template>
