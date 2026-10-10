<script setup lang="ts">
import type { UnwrapNestedRefs } from 'vue'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
onMounted(() => { if (!props.editor.initializing && !props.editor.workspaceReady) navigateTo('/', { replace: true }) })
watch(() => props.editor.initializing, value => { if (!value && !props.editor.workspaceReady) navigateTo('/', { replace: true }) })
onBeforeRouteLeave(async () => {
  if (props.editor.saving) return false
  try { await props.editor.flushDraft(true); return true }
  catch (reason) { props.editor.error = (reason as Error).message; return false }
})
</script>
<template><div class="editor-page"><EditorWorkspace v-if="editor.workspaceReady" :editor="editor" /><LoadingRegion v-else :busy="editor.initializing" initial label="正在打开编辑器…" /></div></template>
