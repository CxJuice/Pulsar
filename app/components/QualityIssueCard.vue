<script setup lang="ts">
import { TriangleAlert } from 'lucide-vue-next'
import type { QualityIssue } from '~/utils/quality'
defineProps<{ issue: QualityIssue; allowInsert?: boolean }>()
const emit = defineEmits<{ insert: [text: string] }>()
</script>
<template>
  <article class="quality-card">
    <TriangleAlert :size="16" />
    <div class="qa-issue-body"><div class="qa-issue-heading"><strong>{{ issue.message }}</strong><span class="qa-rule">{{ issue.rule }}</span></div>
      <dl v-if="issue.source.length || issue.target.length" class="qa-values">
        <dt>原文</dt><dd>{{ issue.source.length ? issue.source.join(' · ') : '无' }}</dd>
        <dt>译文</dt><dd>{{ issue.target.length ? issue.target.join(' · ') : '无' }}</dd>
      </dl>
      <div v-if="allowInsert && issue.insertable" class="quality-tokens"><button v-for="token in issue.tokens" :key="token" title="插入缺少的标记" @click="emit('insert', token)">{{ token }}</button></div>
    </div>
  </article>
</template>
