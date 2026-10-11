<script setup lang="ts">
import { Minus, Square, X } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>>; caption?: string }>()
async function windowAction(action: 'minimize' | 'maximize' | 'close') {
  if (action === 'close') {
    try { await props.editor.flushDraft(true) }
    catch (reason) { props.editor.error = (reason as Error).message; return }
  }
  window.scKit?.window(action)
}
</script>
<template>
  <div class="titlebar"><div class="titlebar-brand"><span class="brand-symbol" aria-label="SC">SC</span><span>ScTranslateKit</span><span class="titlebar-caption">{{ caption || '翻译工作台' }}</span></div><div class="titlebar-right"><span v-if="editor.pendingCount" class="titlebar-submit-status" role="status">后台提交 {{ editor.pendingCount }} 条</span><template v-if="editor.desktop"><button aria-label="最小化" @click="windowAction('minimize')"><Minus :size="14" /></button><button aria-label="最大化或还原" @click="windowAction('maximize')"><Square :size="11" /></button><button class="window-close" aria-label="关闭应用" @click="windowAction('close')"><X :size="15" /></button></template></div></div>
</template>
