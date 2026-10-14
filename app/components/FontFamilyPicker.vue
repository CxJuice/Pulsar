<script setup lang="ts">
import { ChevronDown, Check } from 'lucide-vue-next'

interface FontOption {
  value: string
  label: string
  preview?: string
}

const props = defineProps<{
  id: string
  label: string
  modelValue: string
  options: FontOption[]
  previewFontFamily: string
  placeholder?: string
}>()
const emit = defineEmits<{ select: [value: string] }>()
const input = ref<HTMLInputElement>()
const draft = ref(props.modelValue)
const open = ref(false)
const typed = ref(false)
const activeIndex = ref(-1)
let closeTimer: ReturnType<typeof setTimeout> | undefined

watch(() => props.modelValue, value => {
  if (!open.value) draft.value = value
})

const filteredOptions = computed(() => {
  if (!typed.value) return props.options
  const query = draft.value.trim().toLocaleLowerCase()
  if (!query) return props.options
  return props.options.filter(option =>
    option.label.toLocaleLowerCase().includes(query) || option.value.toLocaleLowerCase().includes(query),
  )
})

function showOptions() {
  if (closeTimer) clearTimeout(closeTimer)
  open.value = true
  typed.value = false
  activeIndex.value = -1
}

function choose(value: string) {
  draft.value = value
  emit('select', value)
  open.value = false
  typed.value = false
  activeIndex.value = -1
}

function commitCustomValue() {
  const value = draft.value.trim()
  if (value !== props.modelValue) emit('select', value)
  draft.value = value
}

function closeAndCommit() {
  closeTimer = setTimeout(() => {
    commitCustomValue()
    open.value = false
    typed.value = false
    activeIndex.value = -1
  }, 120)
}

function onInput() {
  open.value = true
  typed.value = true
  activeIndex.value = filteredOptions.value.length ? 0 : -1
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) showOptions()
    const count = filteredOptions.value.length
    if (count) activeIndex.value = (activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const option = filteredOptions.value[activeIndex.value]
    if (open.value && option) choose(option.value)
    else commitCustomValue()
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    draft.value = props.modelValue
    open.value = false
    typed.value = false
    activeIndex.value = -1
  }
}
</script>

<template>
  <div class="font-family-picker" @focusout="closeAndCommit">
    <div class="font-family-picker-control">
      <input
        :id="id"
        ref="input"
        v-model="draft"
        role="combobox"
        aria-autocomplete="list"
        :aria-label="label"
        :aria-expanded="open"
        :aria-controls="`${id}-listbox`"
        :aria-activedescendant="open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined"
        :placeholder="placeholder || '搜索或输入字体名称'"
        :style="{ fontFamily: previewFontFamily }"
        autocomplete="off"
        @focus="showOptions"
        @click="showOptions"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="font-family-picker-toggle"
        :aria-label="open ? '收起字体列表' : '展开字体列表'"
        :aria-expanded="open"
        @mousedown.prevent
        @click="open ? (open = false) : showOptions()"
      >
        <ChevronDown :size="14" />
      </button>
    </div>
    <div v-if="open" :id="`${id}-listbox`" class="font-family-picker-options" role="listbox" :aria-label="`${label}选项`">
      <button
        v-for="(option, index) in filteredOptions"
        :id="`${id}-option-${index}`"
        :key="`${option.value}-${index}`"
        type="button"
        role="option"
        :aria-selected="option.value === modelValue"
        :class="{ active: index === activeIndex, selected: option.value === modelValue }"
        :style="option.preview ? { fontFamily: option.preview } : undefined"
        @mousedown.prevent
        @mouseenter="activeIndex = index"
        @click="choose(option.value)"
      >
        <span>{{ option.label }}</span>
        <Check v-if="option.value === modelValue" :size="13" aria-hidden="true" />
      </button>
      <p v-if="!filteredOptions.length" class="font-family-picker-empty">没有匹配项，按 Enter 使用输入内容</p>
    </div>
  </div>
</template>

<style scoped>
.font-family-picker { position:relative;flex:1;min-width:0; }
.font-family-picker-control { position:relative; }
.font-family-picker-control>input { width:100%;min-width:0;height:31px;padding:0 32px 0 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);font-size:11px; }
.font-family-picker-control>input:focus { border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft); }
.font-family-picker-toggle { position:absolute;top:1px;right:1px;display:grid;width:29px;height:29px;place-items:center;border-radius:3px;color:var(--muted); }
.font-family-picker-toggle:hover { background:var(--soft);color:var(--text); }
.font-family-picker-options { position:absolute;z-index:80;top:calc(100% + 4px);right:0;left:0;max-height:250px;overflow:auto;padding:4px;border:1px solid var(--border);border-radius:5px;background:var(--bg);box-shadow:0 8px 24px #0002; }
.font-family-picker-options>button { display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:32px;padding:6px 8px;border-radius:3px;color:var(--text);text-align:left;font-size:11px; }
.font-family-picker-options>button:hover,.font-family-picker-options>button.active { background:var(--accent-soft); }
.font-family-picker-options>button.selected { color:var(--accent); }
.font-family-picker-options>button>span { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.font-family-picker-empty { padding:9px 8px;color:var(--muted);font-size:10px;line-height:1.6; }
</style>
