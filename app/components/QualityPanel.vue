<script setup lang="ts">
import { CircleCheck, ShieldCheck } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const emit = defineEmits<{ insert: [text: string] }>()
</script>
<template>
  <section class="aux-content qa-panel" aria-label="当前词条质量检查">
    <div class="panel-heading"><span>当前词条质量检查</span><span class="subtle">实时检查</span></div>
    <div v-if="!editor.selected" class="empty-state"><ShieldCheck :size="30" /><h3>未选择词条</h3></div>
    <template v-else>
      <div class="quality-summary" :class="{ passed: !!editor.text.trim() && !editor.issues.length }">
        <CircleCheck v-if="editor.text.trim() && !editor.issues.length" :size="30" /><ShieldCheck v-else :size="30" />
        <h3>{{ !editor.text.trim() ? '输入译文后自动检查' : editor.issues.length ? `${editor.issues.length} 项待检查` : '未发现问题' }}</h3>
      </div>
      <QualityIssueCard v-for="issue in editor.issues" :key="issue.type" :issue="issue" :allow-insert="!editor.locked && !editor.saving" @insert="emit('insert', $event)" />
    </template>
  </section>
</template>
