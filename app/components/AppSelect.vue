<script setup lang="ts" generic="T extends string | number">
import { Check, ChevronDown } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue: T
  options: readonly { value: T; label: string; disabled?: boolean }[]
  label: string
  disabled?: boolean
}>(), { disabled: false })
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const id = useId()
const root = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>(), menu = ref<HTMLElement>()
const open = ref(false), active = ref(-1), upward = ref(false)
const placement = ref<Record<string, string>>({})
const selected = computed(() => props.options.find(option => option.value === props.modelValue))
const enabled = computed(() => props.options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0))
let typed = '', typedAt = 0
function close() { open.value = false; typed = '' }
function revealActive() {
  nextTick(() => {
    const list = menu.value, option = document.getElementById(`${id}-option-${active.value}`)
    if (!list || !option) return
    const bounds = list.getBoundingClientRect(), item = option.getBoundingClientRect()
    if (item.top < bounds.top + 5) list.scrollTop -= bounds.top + 5 - item.top
    else if (item.bottom > bounds.bottom - 5) list.scrollTop += item.bottom - bounds.bottom + 5
  })
}
function expand() {
  if (props.disabled || !enabled.value.length || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect(), margin = 8, gap = 5
  const below = window.innerHeight - rect.bottom - margin - gap, above = rect.top - margin - gap
  const wanted = Math.min(320, props.options.length * 36 + 12)
  upward.value = below < wanted && above > below
  const width = Math.min(window.innerWidth - margin * 2, Math.max(rect.width, 180))
  placement.value = {
    left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`,
    width: `${width}px`, maxHeight: `${Math.max(0, Math.min(320, upward.value ? above : below))}px`,
    ...(upward.value ? { bottom: `${window.innerHeight - rect.top + gap}px` } : { top: `${rect.bottom + gap}px` })
  }
  const index = props.options.findIndex(option => option.value === props.modelValue && !option.disabled)
  active.value = index < 0 ? enabled.value[0]! : index
  open.value = true
  revealActive()
}
function choose(index: number) {
  const option = props.options[index]
  if (!option || option.disabled || props.disabled) return
  close()
  emit('update:modelValue', option.value)
  trigger.value?.focus()
}
function keydown(event: KeyboardEvent) {
  if (props.disabled) return
  if (open.value) event.stopPropagation()
  if (event.key === 'Tab') { close(); return }
  if (event.key === 'Escape' && open.value) { event.preventDefault(); close(); return }
  if (event.altKey && event.key === 'ArrowUp' && open.value) { event.preventDefault(); close(); return }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !event.ctrlKey && !event.metaKey) {
    event.preventDefault(); event.stopPropagation()
    const wasOpen = open.value
    if (!wasOpen) expand()
    if (!open.value) return
    if (event.key === 'Home') active.value = enabled.value[0]!
    else if (event.key === 'End') active.value = enabled.value.at(-1)!
    else if (wasOpen && !event.altKey) {
      const index = enabled.value.indexOf(active.value) + (event.key === 'ArrowDown' ? 1 : -1)
      active.value = enabled.value[Math.max(0, Math.min(enabled.value.length - 1, index))]!
    }
    revealActive(); return
  }
  if (['Enter', ' '].includes(event.key) && !event.ctrlKey && !event.metaKey) {
    event.preventDefault(); event.stopPropagation()
    if (open.value) choose(active.value); else expand()
    return
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
    event.preventDefault(); event.stopPropagation()
    if (!open.value) expand()
    const now = Date.now()
    typed = now - typedAt > 700 ? event.key : typed + event.key; typedAt = now
    const prefix = typed.toLocaleLowerCase()
    const repeated = [...prefix].every(char => char === prefix[0])
    const start = repeated ? active.value + 1 : active.value
    const candidates = [...enabled.value.filter(index => index >= start), ...enabled.value.filter(index => index < start)]
    const match = candidates.find(index => props.options[index]!.label.toLocaleLowerCase().startsWith(repeated ? prefix[0]! : prefix))
    if (match !== undefined) { active.value = match; revealActive() }
  }
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target) && !menu.value?.contains(event.target)) close()
}
function scroll(event: Event) { if (event.target instanceof Node && !menu.value?.contains(event.target)) close() }
function listen() {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('scroll', scroll, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
}
function cleanup() {
  close()
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('scroll', scroll, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
}
watch(() => props.disabled, value => { if (value) close() })
watch(() => props.options, () => { if (open.value) close() })
watch(() => props.modelValue, () => close())
onMounted(listen)
onActivated(listen)
onDeactivated(cleanup)
onBeforeUnmount(cleanup)
</script>
<template>
  <div ref="root" class="app-select">
    <button ref="trigger" type="button" class="app-select-trigger" role="combobox" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? `${id}-list` : undefined" :aria-activedescendant="open && active >= 0 ? `${id}-option-${active}` : undefined" :disabled="disabled || !enabled.length" :title="selected?.label" @click="open ? close() : expand()" @keydown="keydown" @blur="close">
      <span>{{ selected?.label || '请选择' }}</span><ChevronDown :size="13" :class="{ expanded: open }" />
    </button>
    <Teleport to=".app-shell">
      <Transition name="select-menu">
        <div v-if="open" :id="`${id}-list`" ref="menu" class="app-select-menu" :class="{ upward }" :style="placement" role="listbox" :aria-label="label" @pointerdown.prevent>
          <div v-for="(option, index) in options" :id="`${id}-option-${index}`" :key="option.value" class="app-select-option" :class="{ active: active === index, selected: option.value === modelValue, disabled: option.disabled }" role="option" :aria-selected="option.value === modelValue" :aria-disabled="option.disabled || undefined" :title="option.label" @pointermove="!option.disabled && (active = index)" @click="choose(index)">
            <span class="app-select-check"><Check v-if="option.value === modelValue" :size="14" /></span><span>{{ option.label }}</span>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
