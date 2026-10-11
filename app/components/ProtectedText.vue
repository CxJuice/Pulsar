<script setup lang="ts">
import type { Term } from '~/types/editor'
import { highlightTerms, termDescription } from '~/utils/termHighlights'
import { searchHighlightParts } from '~/utils/searchHighlight'
const props = defineProps<{ text: string; breaks?: boolean; interactive?: boolean; disabled?: boolean; terms?: Term[]; searchQuery?: string }>()
const emit = defineEmits<{ insert: [token: string]; term: [terms: Term[], position: { x: number; y: number; focus: boolean }] }>()
const termRecognitionEnabled = inject<Ref<boolean>>('workspace-term-recognition')!
const termExemptionPatterns = inject<Ref<RegExp[]>>('workspace-term-exemption-patterns')!
const recognizedTerms = computed(() => termRecognitionEnabled.value ? props.terms || [] : [])
const describeTerms = (terms: Term[]) => termDescription(terms, termExemptionPatterns.value)
function hasActiveTextSelection() {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed
}
function insertToken(event: MouseEvent, token: string) {
  if (hasActiveTextSelection()) { event.preventDefault(); return }
  emit('insert', token)
}
function insertTerm(event: MouseEvent, terms: Term[]) {
  if (hasActiveTextSelection()) { event.preventDefault(); return }
  const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const rect = button?.getBoundingClientRect()
  const keyboard = event.detail === 0
  emit('term', terms, {
    x: keyboard && rect ? rect.left + rect.width / 2 : event.clientX,
    y: keyboard && rect ? rect.bottom : event.clientY,
    focus: keyboard,
  })
}
const pieces = computed(() => {
  const pattern = /<\/?[A-Za-z][^>]*>|~\w+\([^)]*\)|\\r\\n|\\n|\\r|\{\{[^}]+\}\}|\{\w+\}|%(?:\d+\$)?[sdif]/g
  const result: Array<{ text: string; token: boolean; newline?: boolean; terms?: Term[]; searchParts?: ReturnType<typeof searchHighlightParts> }> = []
  const plain = (text: string) => result.push(...highlightTerms(text, recognizedTerms.value, 'source', termExemptionPatterns.value).map(piece => ({ ...piece, token: false, searchParts: searchHighlightParts(piece.text, props.searchQuery || '') })))
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
  <span class="protected-text"><template v-for="(piece, index) in pieces" :key="index"><template v-if="piece.token"><template v-if="piece.newline && breaks">{{ '\n' }}</template><button v-else-if="interactive" class="inline-token" :class="{ newline: piece.newline }" :title="`插入 ${piece.text}`" :disabled="disabled" @click="insertToken($event, piece.text)">{{ piece.text }}</button><span v-else class="inline-token" :class="{ newline: piece.newline }">{{ piece.text }}</span></template><template v-else-if="piece.terms?.length"><button v-if="interactive" class="term-highlight" :title="describeTerms(piece.terms)" :aria-label="`选择填入译名：${describeTerms(piece.terms)}`" :disabled="disabled || !piece.terms.some(term => term.translation.trim())" @click="insertTerm($event, piece.terms)"><template v-for="(part, partIndex) in piece.searchParts" :key="partIndex"><mark v-if="part.hit" class="search-match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></button><mark v-else class="term-highlight" :title="describeTerms(piece.terms)"><template v-for="(part, partIndex) in piece.searchParts" :key="partIndex"><span v-if="part.hit" class="search-match">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></mark></template><template v-else><template v-for="(part, partIndex) in piece.searchParts" :key="partIndex"><mark v-if="part.hit" class="search-match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></template></template></span>
</template>
