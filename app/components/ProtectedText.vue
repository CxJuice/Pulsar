<script setup lang="ts">
import type { Term } from '~/types/editor'
import { highlightTerms, termDescription } from '~/utils/termHighlights'
const props = defineProps<{ text: string; breaks?: boolean; interactive?: boolean; disabled?: boolean; terms?: Term[] }>()
const emit = defineEmits<{ insert: [token: string]; term: [term: Term] }>()
function hasActiveTextSelection() {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed
}
function insertToken(event: MouseEvent, token: string) {
  if (hasActiveTextSelection()) { event.preventDefault(); return }
  emit('insert', token)
}
function insertTerm(event: MouseEvent, term: Term) {
  if (hasActiveTextSelection()) { event.preventDefault(); return }
  emit('term', term)
}
const pieces = computed(() => {
  const pattern = /<\/?[A-Za-z][^>]*>|~\w+\([^)]*\)|\\r\\n|\\n|\\r|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]/g
  const result: Array<{ text: string; token: boolean; newline?: boolean; terms?: Term[] }> = []
  const plain = (text: string) => result.push(...highlightTerms(text, props.terms || []).map(piece => ({ ...piece, token: false })))
  let start = 0
  for (const match of props.text.matchAll(pattern)) {
    if (match.index! > start) plain(props.text.slice(start, match.index))
    result.push({ text: match[0], token: true, newline: ['\\r\\n', '\\n', '\\r'].includes(match[0]) }); start = match.index! + match[0].length
  }
  if (start < props.text.length) plain(props.text.slice(start))
  return result
})
</script>
<template>
  <span class="protected-text"><template v-for="(piece, index) in pieces" :key="index"><template v-if="piece.token"><template v-if="piece.newline && breaks">{{ '\n' }}</template><button v-else-if="interactive" class="inline-token" :class="{ newline: piece.newline }" :title="`插入 ${piece.text}`" :disabled="disabled" @click="insertToken($event, piece.text)">{{ piece.text }}</button><span v-else class="inline-token" :class="{ newline: piece.newline }">{{ piece.text }}</span></template><template v-else-if="piece.terms?.length"><button v-if="interactive" class="term-highlight" :title="`点击填入译文\n${termDescription(piece.terms)}`" :aria-label="`填入术语译文 ${piece.terms[0]!.translation}`" :disabled="disabled || !piece.terms[0]!.translation.trim()" @click="insertTerm($event, piece.terms[0]!)">{{ piece.text }}</button><mark v-else class="term-highlight" :title="termDescription(piece.terms)">{{ piece.text }}</mark></template><template v-else>{{ piece.text }}</template></template></span>
</template>
