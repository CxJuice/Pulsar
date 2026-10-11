<script setup lang="ts">
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { useEditor } from '~/composables/useEditor'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const emit = defineEmits<{ open: [] }>()
const index = computed(() => props.editor.visibleItems.findIndex(item => item.id === props.editor.selected?.id))
</script>
<template>
<footer class="editor-footer"><button class="icon-button small" title="上一条 · Alt + ↑" aria-label="上一条字符串" :disabled="editor.listBusy" @click="editor.move(-1)"><ChevronLeft :size="17" /></button><span v-if="index >= 0">{{ index + 1 }} / {{ editor.visibleItems.length }}</span><span v-else title="当前词条已不符合列表筛选">筛选外</span><button class="icon-button small" title="下一条 · Alt + ↓" aria-label="下一条字符串" :disabled="editor.listBusy" @click="editor.move(1)"><ChevronRight :size="17" /></button><span class="editor-footer-spacer"></span><button class="text-button" :disabled="!editor.desktop" @click="emit('open')">ParaTranz <ExternalLink :size="12" /></button></footer>
</template>
