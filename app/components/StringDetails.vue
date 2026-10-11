<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { useEditor } from '~/composables/useEditor'
import { stageLabels, displayDate } from '~/utils/text'
defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
</script>
<template>
<div v-if="editor.selected" class="details-area"><div class="details-heading"><span>词条上下文</span><button class="icon-button small" title="重新载入远端词条，保留草稿" aria-label="重新载入远端词条" :disabled="!editor.connected || editor.reloadBusy || editor.listBusy" @click="editor.reloadSelected()"><RefreshCw :size="14" :class="{ spin: editor.reloadBusy }" /></button></div><div class="details-grid"><div><label>关键字</label><p class="key-value">{{ editor.selected.key }}</p><label>词条 ID</label><p>{{ editor.selected.id }}</p><label>状态</label><p>{{ stageLabels[editor.selected.stage] }}</p></div><div><label>上下文</label><p class="context-value">{{ editor.selected.context || '暂无上下文' }}</p><label>更多信息</label><dl><dt>长度</dt><dd>{{ editor.selected.words }} 单词</dd><dt>文件</dt><dd>{{ editor.selected.file?.name || editor.file.name }}</dd><dt>更新时间</dt><dd>{{ displayDate(editor.selected.updatedAt) }}</dd></dl></div></div></div>
</template>
