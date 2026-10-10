<script setup lang="ts">
import { compareSources } from '~/utils/textWorker'
import type { SourceDiffPart } from '~/utils/sourceDiff'
const props = defineProps<{ original: string; current: string; showDiff: boolean }>()
const parts = shallowRef<SourceDiffPart[]>([]), busy = ref(false), failed = ref(false)
let sequence = 0
watch(() => [props.original, props.current, props.showDiff], async () => {
  const request = ++sequence
  parts.value = []; failed.value = false; busy.value = false
  if (!props.showDiff || props.original === props.current) return
  busy.value = true
  try {
    const result = await compareSources(props.original, props.current)
    if (request === sequence) parts.value = result
  } catch { if (request === sequence) failed.value = true }
  finally { if (request === sequence) busy.value = false }
}, { immediate: true })
onBeforeUnmount(() => { sequence++ })
</script>
<template>
  <div class="suggestion-source">
    <span v-if="busy" class="diff-loading"><LoadingIndicator :size="12" label="正在比较原文" />正在比较原文…</span>
    <span v-if="failed" class="diff-loading">差异计算暂不可用</span>
    <template v-if="showDiff && original !== current && !busy && !failed">
      <div class="source-inline-diff" aria-label="原文差异对比" title="同一段落中：红色删除线为移除，绿色为新增"><template v-for="(part, index) in parts" :key="index"><del v-if="part.kind === 'removed'" class="source-removed"><ProtectedText :text="part.text" breaks /></del><ins v-else-if="part.kind === 'added'" class="source-added"><ProtectedText :text="part.text" breaks /></ins><ProtectedText v-else :text="part.text" breaks /></template></div>
    </template>
    <ProtectedText v-else :text="original" breaks />
  </div>
</template>
