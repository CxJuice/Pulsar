<script setup lang="ts">
const props = defineProps<{ text: string; query: string }>()
const parts = computed(() => {
  const text = props.text.replaceAll('\\n', '\n')
  const query = props.query.replaceAll('\\n', '\n')
  if (!query) return [{ text, hit: false }]
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = text.matchAll(new RegExp(escaped, 'gi'))
  const result: Array<{ text: string; hit: boolean }> = []
  let start = 0
  for (const match of matches) {
    if (match.index! > start) result.push({ text: text.slice(start, match.index), hit: false })
    result.push({ text: match[0], hit: true }); start = match.index! + match[0].length
  }
  if (start < text.length) result.push({ text: text.slice(start), hit: false })
  return result
})
</script>
<template>
  <span class="search-highlighted-text"><template v-for="(part, index) in parts" :key="index"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
</template>
