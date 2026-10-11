<script setup lang="ts">
import { CircleCheck, ShieldCheck } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { QualityLocation } from '~/utils/quality'
import { toEditorText } from '~/utils/translationText'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const emit = defineEmits<{ insert: [text: string]; locate: [location: QualityLocation] }>()
const termCheckIncomplete = computed(() => props.editor.termsBusy || !!props.editor.termsError || !props.editor.connected)
const passed = computed(() => !props.editor.issues.length && !termCheckIncomplete.value)
const termCheckMessage = computed(() => props.editor.termsBusy
  ? '正在加载术语表，完成后会检查译文是否使用登记译名。'
  : props.editor.termsError
    ? `术语表加载失败，未能完成术语使用检查：${props.editor.termsError}`
    : !props.editor.connected
      ? '未连接 ParaTranz，无法检查术语表使用情况。'
      : '')
</script>
<template>
  <section class="aux-content qa-panel" aria-label="当前词条质量检查">
    <div v-if="!props.editor.selected" class="empty-state"><ShieldCheck :size="30" /><h3>未选择词条</h3></div>
    <template v-else-if="toEditorText(props.editor.text).trim()">
      <div class="quality-summary" :class="{ passed, 'has-issues': !passed }" role="status">
        <CircleCheck v-if="passed" :size="20" /><ShieldCheck v-else :size="20" />
        <h3>{{ props.editor.issues.length ? `${props.editor.issues.length} 项问题` : termCheckIncomplete ? '术语检查未完成' : '未发现问题' }}</h3>
      </div>
      <p v-if="termCheckMessage" class="qa-term-check-status" :class="{ error: !!props.editor.termsError }" role="status">{{ termCheckMessage }}</p>
      <QualityIssueCard v-for="issue in props.editor.issues" :key="issue.type" :issue="issue" :allow-insert="!props.editor.locked && !props.editor.listBusy && !props.editor.initializing && !props.editor.reloadBusy" :allow-locate="!props.editor.locked && !props.editor.listBusy && !props.editor.initializing && !props.editor.reloadBusy" @insert="emit('insert', $event)" @locate="emit('locate', $event)" />
    </template>
  </section>
</template>
