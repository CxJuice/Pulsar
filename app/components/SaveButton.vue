<script setup lang="ts">
import { Check, ChevronDown, Cloud } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import { saveModes, type SaveMode } from '~/utils/saveModes'

const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>>; mode: SaveMode }>()
const emit = defineEmits<{ 'update:mode': [value: SaveMode]; save: [] }>()
const root = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>(), menu = ref<HTMLElement>()
const open = ref(false)
const blocked = computed(() => props.editor.listBusy || props.editor.initializing || props.editor.reloadBusy || props.editor.locked)
const selectedMode = computed(() => saveModes.find(mode => mode.id === props.mode) || saveModes[0]!)
const hasQualityIssues = computed(() => props.editor.issues.length > 0)
const canSave = computed(() => props.editor.connected && props.editor.sessionInfo.authenticated && !!props.editor.selected && !props.editor.submissionQueued(selectedMode.value.stage ?? props.editor.editStage) && (props.editor.dirty || (selectedMode.value.stage !== undefined && selectedMode.value.stage !== props.editor.selected.stage)))
function toggle() {
  if (blocked.value) return
  open.value = !open.value
  if (open.value) nextTick(() => menu.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
}
function close(focus = false) { open.value = false; if (focus) nextTick(() => trigger.value?.focus()) }
function select(mode: SaveMode) { emit('update:mode', mode); close(true) }
function outside(event: PointerEvent) { if (event.target instanceof Node && !root.value?.contains(event.target)) close() }
function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
  else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    event.stopPropagation()
    const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button') || [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[target]?.focus()
  } else if (event.key === 'Tab') close()
}
watch(blocked, value => { if (value) close() })
onMounted(() => document.addEventListener('pointerdown', outside))
onActivated(() => document.addEventListener('pointerdown', outside))
onDeactivated(() => { close(); document.removeEventListener('pointerdown', outside) })
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
<template>
  <div ref="root" class="save-button-control">
    <div class="split-save" :class="{ 'qa-warning': hasQualityIssues }">
      <button class="button primary" :title="hasQualityIssues ? `${editor.issues.length} 项 QA 问题尚未解决` : undefined" :disabled="!canSave || blocked" @click="emit('save')"><Cloud :size="14" />{{ selectedMode.label }}</button>
      <button v-if="saveModes.length > 1" ref="trigger" class="save-option" :disabled="blocked" aria-label="选择提交方式" aria-haspopup="menu" :aria-expanded="open" title="选择提交方式" @click="toggle" @keydown.down.prevent="!open && toggle()"><ChevronDown :size="14" /></button>
    </div>
    <Transition name="menu"><div v-if="open && saveModes.length > 1" ref="menu" class="save-mode-menu" role="menu" aria-label="提交方式" @keydown="menuKeydown">
      <button v-for="option in saveModes" :key="option.id" role="menuitemradio" :aria-checked="mode === option.id" @click="select(option.id)"><span class="save-mode-check"><Check v-if="mode === option.id" :size="15" /></span><span><strong>{{ option.label }}</strong></span></button>
    </div></Transition>
  </div>
</template>
<style scoped>
.split-save > .button:only-child { border-radius: 4px; }
.split-save.qa-warning > .button,.split-save.qa-warning > .save-option { background:#f1c453;color:#443300;border-color:#96732355; }
.split-save.qa-warning > .button:hover:not(:disabled),.split-save.qa-warning > .save-option:hover:not(:disabled),.split-save.qa-warning > .save-option[aria-expanded=true] { background:#e4b53d; }
</style>
