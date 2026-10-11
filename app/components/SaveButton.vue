<script setup lang="ts">
import { Check, ChevronDown, Cloud, TriangleAlert } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import { saveModes, type SaveMode } from '~/utils/saveModes'

type ModeMenu = 'save' | 'disputed'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>>; mode: SaveMode }>()
const emit = defineEmits<{ 'update:mode': [value: SaveMode]; save: []; 'save-disputed': [next: boolean] }>()
const root = ref<HTMLElement>()
const saveTrigger = ref<HTMLButtonElement>(), disputedTrigger = ref<HTMLButtonElement>()
const saveMenu = ref<HTMLElement>(), disputedMenu = ref<HTMLElement>()
const open = ref<ModeMenu | null>(null), disputedMode = ref<SaveMode>('next')
const blocked = computed(() => props.editor.listBusy || props.editor.initializing || props.editor.reloadBusy || props.editor.locked)
const selectedMode = computed(() => saveModes.find(mode => mode.id === props.mode) || saveModes[0]!)
const selectedDisputedMode = computed(() => saveModes.find(mode => mode.id === disputedMode.value) || saveModes[0]!)
const hasQualityIssues = computed(() => props.editor.issues.length > 0)
const saveButtonTitle = computed(() => hasQualityIssues.value ? `${selectedMode.value.description}；${props.editor.issues.length} 项 QA 问题尚未解决` : selectedMode.value.description)
const disputedButtonTitle = computed(() => actionDescription(disputedMode.value, true))
const canSave = computed(() => props.editor.connected && props.editor.sessionInfo.authenticated && !!props.editor.selected && !props.editor.submissionQueued(selectedMode.value.stage ?? props.editor.editStage) && (props.editor.dirty || (selectedMode.value.stage !== undefined && selectedMode.value.stage !== props.editor.selected.stage)))
const canSaveDisputed = computed(() => props.editor.connected && props.editor.sessionInfo.authenticated && !!props.editor.selected && !props.editor.submissionQueued(2) && (props.editor.dirty || props.editor.selected.stage !== 2))

function actionDescription(mode: SaveMode, disputed = false) {
  const nextAction = mode === 'next' ? '打开下一条' : '停留在当前词条'
  return disputed
    ? `保存当前译文并标记为有疑问，然后${nextAction}`
    : `保存当前译文，然后${nextAction}`
}
function actionLabel(mode: SaveMode, disputed = false) {
  if (disputed) return mode === 'next' ? '提交疑问并下一条' : '提交疑问并停留'
  return saveModes.find(option => option.id === mode)?.label || saveModes[0]!.label
}
function menuFor(target: ModeMenu) { return target === 'save' ? saveMenu.value : disputedMenu.value }
function triggerFor(target: ModeMenu) { return target === 'save' ? saveTrigger.value : disputedTrigger.value }
function toggle(target: ModeMenu) {
  if (blocked.value) return
  open.value = open.value === target ? null : target
  if (open.value) nextTick(() => menuFor(target)?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
}
function close(focus = false) {
  const previous = open.value
  open.value = null
  if (focus && previous) nextTick(() => triggerFor(previous)?.focus())
}
function select(mode: SaveMode, target: ModeMenu) {
  if (target === 'save') emit('update:mode', mode)
  else disputedMode.value = mode
  close(true)
}
function outside(event: PointerEvent) { if (event.target instanceof Node && !root.value?.contains(event.target)) close() }
function menuKeydown(event: KeyboardEvent, target: ModeMenu) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
  else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    event.stopPropagation()
    const buttons = [...(menuFor(target)?.querySelectorAll<HTMLButtonElement>('button') || [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  } else if (event.key === 'Tab') close()
}
watch(blocked, value => { if (value) close() })
watch(disputedMode, value => { try { localStorage.setItem('sckit-disputed-save-mode', value) } catch { /* Keep the choice for this session. */ } })
onMounted(() => {
  try {
    const saved = localStorage.getItem('sckit-disputed-save-mode')
    if (saved === 'next' || saved === 'stay') disputedMode.value = saved
  } catch { /* Keep the default mode if preferences cannot be read. */ }
  document.addEventListener('pointerdown', outside)
})
onActivated(() => document.addEventListener('pointerdown', outside))
onDeactivated(() => { close(); document.removeEventListener('pointerdown', outside) })
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
<template>
  <div ref="root" class="save-button-control">
    <div class="save-mode-anchor">
      <div class="split-save disputed-split">
        <button class="button disputed-submit" :title="disputedButtonTitle" :disabled="!canSaveDisputed || blocked" @click="emit('save-disputed', selectedDisputedMode.next)"><TriangleAlert :size="14" />{{ actionLabel(disputedMode, true) }}</button>
        <button ref="disputedTrigger" class="save-option disputed-mode-trigger" :disabled="blocked" aria-label="选择疑问提交方式" aria-haspopup="menu" :aria-expanded="open === 'disputed'" title="选择疑问提交方式" @click="toggle('disputed')" @keydown.down.prevent="open !== 'disputed' && toggle('disputed')"><ChevronDown :size="14" /></button>
      </div>
      <Transition name="menu"><div v-if="open === 'disputed'" ref="disputedMenu" class="save-mode-menu" role="menu" aria-label="疑问提交方式" @keydown="menuKeydown($event, 'disputed')">
        <button v-for="option in saveModes" :key="option.id" role="menuitemradio" :aria-checked="disputedMode === option.id" @click="select(option.id, 'disputed')"><span class="save-mode-check"><Check v-if="disputedMode === option.id" :size="15" /></span><span><strong>{{ actionLabel(option.id, true) }}</strong><small>{{ actionDescription(option.id, true) }}</small></span></button>
      </div></Transition>
    </div>
    <div class="save-mode-anchor">
      <div class="split-save" :class="{ 'qa-warning': hasQualityIssues }">
        <button class="button primary" :title="saveButtonTitle" :disabled="!canSave || blocked" @click="emit('save')"><Cloud :size="14" />{{ selectedMode.label }}</button>
        <button ref="saveTrigger" class="save-option" :disabled="blocked" aria-label="选择提交方式" aria-haspopup="menu" :aria-expanded="open === 'save'" title="选择提交方式" @click="toggle('save')" @keydown.down.prevent="open !== 'save' && toggle('save')"><ChevronDown :size="14" /></button>
      </div>
      <Transition name="menu"><div v-if="open === 'save'" ref="saveMenu" class="save-mode-menu" role="menu" aria-label="提交方式" @keydown="menuKeydown($event, 'save')">
        <button v-for="option in saveModes" :key="option.id" role="menuitemradio" :aria-checked="mode === option.id" @click="select(option.id, 'save')"><span class="save-mode-check"><Check v-if="mode === option.id" :size="15" /></span><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span></button>
      </div></Transition>
    </div>
  </div>
</template>
<style scoped>
.save-button-control { display:flex;align-items:center;gap:8px; }
.save-mode-anchor { position:relative;display:flex; }
.disputed-split > .disputed-submit { color:var(--warning);border-color:color-mix(in srgb,var(--warning) 45%,var(--border));white-space:nowrap; }
.disputed-split > .disputed-submit:hover:not(:disabled) { color:var(--warning);border-color:var(--warning);background:color-mix(in srgb,var(--warning) 10%,var(--bg)); }
.disputed-split > .disputed-mode-trigger { color:var(--warning);background:var(--bg);border:1px solid color-mix(in srgb,var(--warning) 45%,var(--border));border-left:0;border-radius:0 4px 4px 0; }
.disputed-split > .disputed-mode-trigger:hover:not(:disabled),.disputed-split > .disputed-mode-trigger[aria-expanded=true] { background:color-mix(in srgb,var(--warning) 10%,var(--bg)); }
.split-save > .button:only-child { border-radius: 4px; }
.split-save.qa-warning > .button,.split-save.qa-warning > .save-option { background:#f1c453;color:#443300;border-color:#96732355; }
.split-save.qa-warning > .button:hover:not(:disabled),.split-save.qa-warning > .save-option:hover:not(:disabled),.split-save.qa-warning > .save-option[aria-expanded=true] { background:#e4b53d; }
</style>
