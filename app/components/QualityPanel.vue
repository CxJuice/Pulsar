<script setup lang="ts">
import { CircleCheck, ShieldCheck } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { QualityLocation } from '~/utils/quality'
import { toEditorText } from '~/utils/translationText'
defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const emit = defineEmits<{ insert: [text: string]; locate: [location: QualityLocation] }>()
</script>
<template>
  <section class="aux-content qa-panel" aria-label="当前词条质量检查">
    <div v-if="!editor.selected" class="empty-state"><ShieldCheck :size="30" /><h3>未选择词条</h3></div>
    <template v-else-if="toEditorText(editor.text).trim()">
      <div class="quality-summary" :class="{ passed: !editor.issues.length, 'has-issues': !!editor.issues.length }" role="status">
        <CircleCheck v-if="!editor.issues.length" :size="20" /><ShieldCheck v-else :size="20" />
        <h3>{{ editor.issues.length ? `${editor.issues.length} 项问题` : '未发现问题' }}</h3>
      </div>
      <QualityIssueCard v-for="issue in editor.issues" :key="issue.type" :issue="issue" :allow-insert="!editor.locked && !editor.listBusy && !editor.initializing && !editor.reloadBusy" :allow-locate="!editor.locked && !editor.listBusy && !editor.initializing && !editor.reloadBusy" @insert="emit('insert', $event)" @locate="emit('locate', $event)" />
    </template>
  </section>
</template>
