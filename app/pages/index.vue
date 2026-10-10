<script setup lang="ts">
import type { UnwrapNestedRefs } from 'vue'
defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
</script>
<template><ProjectHome :editor="editor" /></template>
