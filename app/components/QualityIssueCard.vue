<script setup lang="ts">
import { TriangleAlert, LocateFixed, ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { QualityIssue, QualityLocation } from '~/utils/quality'
const props = defineProps<{ issue: QualityIssue; allowInsert?: boolean; allowLocate?: boolean }>()
const emit = defineEmits<{ insert: [text: string]; locate: [location: QualityLocation] }>()
const expanded = ref(false)
watch(() => props.issue, () => { expanded.value = false })
const numeric = computed(() => ['number', 'percentage'].includes(props.issue.type))
const newlineDifference = computed(() => Number(props.issue.target[0]) - Number(props.issue.source[0]))
const newlineMessage = computed(() => `译文${newlineDifference.value > 0 ? '多' : '少'} ${Math.abs(newlineDifference.value)} 次换行`)
const contexts = computed(() => [
  ...(props.issue.locations?.source || []).map(location => ({ side: 'source' as const, location })),
  ...(props.issue.locations?.target || []).map(location => ({ side: 'target' as const, location })),
])
const visibleContexts = computed(() => expanded.value ? contexts.value : contexts.value.slice(0, 4))
function values(rows: string[]) {
  if (['tag_structure', 'url'].includes(props.issue.type)) return rows.map(value => ({ value, count: 1 }))
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row, (counts.get(row) || 0) + 1)
  return [...counts].map(([value, count]) => ({ value, count }))
}
</script>
<template>
  <article class="quality-card" :aria-label="issue.message">
    <div class="qa-issue-body">
      <div class="qa-issue-heading"><TriangleAlert :size="16" /><strong>{{ issue.message }}</strong></div>
      <template v-if="issue.type === 'newline'">
        <p class="qa-difference-message">{{ newlineMessage }}</p>
        <dl class="qa-counts"><div><dt>原文</dt><dd>{{ issue.source[0] }}<small>次</small></dd></div><div class="qa-count-changed"><dt>译文</dt><dd>{{ issue.target[0] }}<small>次</small></dd></div></dl>
      </template>
      <dl v-else-if="issue.source.length || issue.target.length" class="qa-values">
        <template v-if="issue.source.length"><dt>{{ numeric ? '原文未对应' : issue.type === 'tag_structure' ? '原文顺序' : '原文要求' }}</dt><dd><span v-for="(item, index) in values(issue.source)" :key="index" class="qa-value qa-source-value"><span>{{ item.value }}</span><small v-if="item.count > 1">×{{ item.count }}</small></span></dd></template>
        <template v-if="issue.target.length"><dt>{{ numeric ? '译文未对应' : issue.type === 'tag_structure' ? '译文顺序' : '译文出现' }}</dt><dd><span v-for="(item, index) in values(issue.target)" :key="index" class="qa-value qa-target-value"><span>{{ item.value }}</span><small v-if="item.count > 1">×{{ item.count }}</small></span></dd></template>
      </dl>
      <div v-if="contexts.length" class="qa-context-list">
        <div v-for="context in visibleContexts" :key="`${context.side}-${context.location.start}`" class="qa-context" :class="`qa-context-${context.side}`">
          <div class="qa-context-heading"><span>{{ context.side === 'source' ? '原文' : '译文' }} · 第 {{ context.location.line }} 行</span><button v-if="context.side === 'target'" class="qa-locate" :disabled="!allowLocate" :aria-label="`定位译文第 ${context.location.line} 行的 ${context.location.text}`" title="在译文中选中此处" @click="emit('locate', context.location)"><LocateFixed :size="13" />定位</button></div>
          <p class="qa-context-text">{{ context.location.before }}<mark>{{ context.location.text }}</mark>{{ context.location.after }}</p>
        </div>
        <button v-if="contexts.length > 4" class="qa-expand-contexts" :aria-expanded="expanded" @click="expanded = !expanded"><ChevronUp v-if="expanded" :size="14" /><ChevronDown v-else :size="14" />{{ expanded ? '收起' : `显示其余 ${contexts.length - 4} 处` }}</button>
      </div>
      <div v-if="allowInsert && issue.insertable" class="quality-tokens"><button v-for="token in issue.tokens" :key="token" :title="`插入 ${token}`" @click="emit('insert', token)">插入 {{ token }}</button></div>
    </div>
  </article>
</template>
