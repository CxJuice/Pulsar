<script setup lang="ts">
import { searchHighlightParts } from '~/utils/searchHighlight'
const props = defineProps<{ text: string; query: string }>()
const parts = computed(() => searchHighlightParts(props.text, props.query))
</script>
<template>
  <span class="search-highlighted-text"><template v-for="(part, index) in parts" :key="index"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
</template>
