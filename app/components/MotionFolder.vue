<script setup lang="ts">
defineProps<{ open: boolean; title?: string; disabled?: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const contentId = useId()
</script>
<template>
  <section class="motion-folder">
    <button class="folder-toggle" type="button" :disabled="disabled" :aria-expanded="open" :aria-controls="contentId" :title="title" @click="emit('toggle')"><slot name="heading" /></button>
    <Transition name="expand"><div v-if="open" :id="contentId" class="folder-content"><div><slot /></div></div></Transition>
  </section>
</template>
