<script setup lang="ts">
import { Settings2, Move, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-vue-next'

export type AuxDockGroup = { kind: 'group'; id: string; tabs: string[]; active: string }
export type AuxDockSplit = { kind: 'split'; id: string; direction: 'horizontal' | 'vertical'; sizes: number[]; children: AuxDockNode[] }
export type AuxDockNode = AuxDockGroup | AuxDockSplit
export type AuxDockTab = { id: string; label: string; count?: number; showCount?: boolean; warning?: boolean; draggable?: boolean }
export type AuxDockZone = 'center' | 'left' | 'right' | 'top' | 'bottom'

const props = defineProps<{
  node: AuxDockNode
  tabs: AuxDockTab[]
  focusedGroupId: string
  draggingTab: string | null
  dropTargetGroupId: string | null
  customizationOpen: boolean
}>()
const emit = defineEmits<{
  select: [panel: string, groupId: string]
  focus: [groupId: string]
  dragStart: [panel: string, groupId: string]
  dragEnter: [groupId: string]
  dragLeave: [groupId: string]
  dragEnd: []
  dock: [value: { panel: string; groupId: string; zone: AuxDockZone }]
  resize: [value: { splitId: string; sizes: number[] }]
  customize: []
}>()
defineSlots<{ panel(props: { panel: string; groupId: string }): unknown }>()

const splitElement = ref<HTMLElement>()
const resizeStart = ref<{ index: number; pointer: number; before: number; after: number; total: number; axisSize: number } | null>(null)
const groupTabs = computed(() => {
  const node = props.node
  return node.kind === 'group' ? props.tabs.filter(tab => node.tabs.includes(tab.id)) : []
})
const splitStyle = computed(() => {
  const node = props.node
  if (node.kind !== 'split') return {}
  const tracks: string[] = []
  node.children.forEach((_, index) => {
    tracks.push(`minmax(0, ${Math.max(1, node.sizes[index] || 1)}fr)`)
    if (index < node.children.length - 1) tracks.push('5px')
  })
  return node.direction === 'horizontal'
    ? { gridTemplateColumns: tracks.join(' '), gridTemplateRows: 'minmax(0, 1fr)' }
    : { gridTemplateRows: tracks.join(' '), gridTemplateColumns: 'minmax(0, 1fr)' }
})
function childPlacement(index: number) {
  return props.node.kind === 'split' && props.node.direction === 'horizontal'
    ? { gridColumn: String(index * 2 + 1), gridRow: '1' }
    : { gridRow: String(index * 2 + 1), gridColumn: '1' }
}
function handlePlacement(index: number) {
  return props.node.kind === 'split' && props.node.direction === 'horizontal'
    ? { gridColumn: String(index * 2 + 2), gridRow: '1' }
    : { gridRow: String(index * 2 + 2), gridColumn: '1' }
}
function startDrag(event: DragEvent, panel: AuxDockTab) {
  if (panel.draggable === false) { event.preventDefault(); return }
  if (props.node.kind !== 'group') { event.preventDefault(); return }
  emit('dragStart', panel.id, props.node.id)
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', panel.id) }
}
function dockTabKeydown(event: KeyboardEvent, panel: AuxDockTab) {
  if (panel.draggable === false || props.node.kind !== 'group' || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return
  const zones: Record<string, AuxDockZone> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' }
  const zone = zones[event.key]
  if (!zone) return
  event.preventDefault()
  event.stopPropagation()
  emit('dock', { panel: panel.id, groupId: props.node.id, zone })
}
function enterDropGroup(event: DragEvent) {
  if (!props.draggingTab || props.node.kind !== 'group') return
  event.preventDefault()
  emit('dragEnter', props.node.id)
}
function leaveDropGroup(event: DragEvent) {
  if (!props.draggingTab || props.node.kind !== 'group') return
  const group = event.currentTarget as HTMLElement
  const next = event.relatedTarget
  if (next instanceof Node && group.contains(next)) return
  emit('dragLeave', props.node.id)
}
function allowDrop(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function dropOnGroup(event: DragEvent, zone: AuxDockZone) {
  event.preventDefault()
  event.stopPropagation()
  const panel = props.draggingTab || event.dataTransfer?.getData('text/plain')
  if (panel && props.node.kind === 'group') emit('dock', { panel, groupId: props.node.id, zone })
  emit('dragEnd')
}
function startResize(event: PointerEvent, index: number) {
  if (props.node.kind !== 'split') return
  event.preventDefault()
  event.stopPropagation()
  const rect = splitElement.value?.getBoundingClientRect()
  if (!rect) return
  const axisSize = props.node.direction === 'horizontal' ? rect.width : rect.height
  const pointer = props.node.direction === 'horizontal' ? event.clientX : event.clientY
  const before = props.node.sizes[index] || 50
  const after = props.node.sizes[index + 1] || 50
  resizeStart.value = { index, pointer, before, after, total: before + after, axisSize }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  emit('focus', props.focusedGroupId)
}
function updateResize(event: PointerEvent) {
  if (!resizeStart.value || props.node.kind !== 'split') return
  const pointer = props.node.direction === 'horizontal' ? event.clientX : event.clientY
  const delta = (pointer - resizeStart.value.pointer) / resizeStart.value.axisSize * 100
  const min = Math.min(18, resizeStart.value.total / 2)
  const before = Math.max(min, Math.min(resizeStart.value.total - min, resizeStart.value.before + delta))
  const sizes = [...props.node.sizes]
  sizes[resizeStart.value.index] = before
  sizes[resizeStart.value.index + 1] = resizeStart.value.total - before
  emit('resize', { splitId: props.node.id, sizes })
}
function endResize() { resizeStart.value = null }
function keyboardResize(event: KeyboardEvent, index: number) {
  if (props.node.kind !== 'split') return
  const negative = props.node.direction === 'horizontal' ? ['ArrowLeft', 'ArrowUp'] : ['ArrowUp', 'ArrowLeft']
  const positive = props.node.direction === 'horizontal' ? ['ArrowRight', 'ArrowDown'] : ['ArrowDown', 'ArrowRight']
  if (!negative.includes(event.key) && !positive.includes(event.key)) return
  event.preventDefault()
  const delta = negative.includes(event.key) ? -2 : 2
  const sizes = [...props.node.sizes]
  const total = (sizes[index] || 50) + (sizes[index + 1] || 50)
  const min = Math.min(18, total / 2)
  sizes[index] = Math.max(min, Math.min(total - min, (sizes[index] || 50) + delta))
  sizes[index + 1] = total - sizes[index]!
  emit('resize', { splitId: props.node.id, sizes })
}
</script>

<template>
  <div v-if="node.kind === 'group'" class="aux-dock-group" :class="{ focused: focusedGroupId === node.id }" @pointerdown="emit('focus', node.id)" @dragenter="enterDropGroup" @dragleave="leaveDropGroup" @dragover="draggingTab && allowDrop($event)" @drop="draggingTab && dropOnGroup($event, 'center')">
    <div class="aux-dock-toolbar">
      <nav class="aux-dock-tabs" :aria-label="`${groupTabs.map(tab => tab.label).join('、')} 面板`">
        <button v-for="tab in groupTabs" :key="tab.id" class="aux-dock-tab" :class="{ active: node.active === tab.id }" :aria-pressed="node.active === tab.id" :aria-keyshortcuts="tab.draggable === false ? undefined : 'Control+Shift+ArrowLeft Control+Shift+ArrowRight Control+Shift+ArrowUp Control+Shift+ArrowDown Meta+Shift+ArrowLeft Meta+Shift+ArrowRight Meta+Shift+ArrowUp Meta+Shift+ArrowDown'" :draggable="tab.draggable !== false" :title="tab.draggable === false ? tab.label : `${tab.label}（拖到面板边缘可分栏；Ctrl/⌘+Shift+方向键也可分栏）`" @dragstart="startDrag($event, tab)" @dragend="emit('dragEnd')" @keydown="dockTabKeydown($event, tab)" @click.stop="emit('select', tab.id, node.id)">
          <span>{{ tab.label }}</span><span v-if="tab.showCount || tab.count" class="tab-count" :class="{ warning: tab.warning }">{{ tab.count }}</span>
        </button>
      </nav>
      <button class="icon-button aux-customize-button" aria-label="自定义右侧栏" title="自定义右侧栏" :aria-expanded="customizationOpen" aria-haspopup="dialog" @click.stop="emit('customize')"><Settings2 :size="16" /></button>
    </div>
    <div class="aux-dock-pane-content" :class="{ 'dictionary-open': node.active === 'dictionary' }">
      <slot name="panel" :panel="node.active" :group-id="node.id" />
    </div>
    <div v-if="draggingTab && dropTargetGroupId === node.id" class="aux-dock-drop-overlay" aria-label="停靠位置">
      <button class="aux-dock-zone center" aria-label="放入此分栏" title="放入此分栏" @dragover="allowDrop" @drop="dropOnGroup($event, 'center')"><Move :size="17" /><span>放入此分栏</span></button>
      <button class="aux-dock-zone left" aria-label="在左侧新建分栏" title="在左侧新建分栏" @dragover="allowDrop" @drop="dropOnGroup($event, 'left')"><ArrowLeft :size="17" /><span>左侧</span></button>
      <button class="aux-dock-zone right" aria-label="在右侧新建分栏" title="在右侧新建分栏" @dragover="allowDrop" @drop="dropOnGroup($event, 'right')"><ArrowRight :size="17" /><span>右侧</span></button>
      <button class="aux-dock-zone top" aria-label="在上方新建分栏" title="在上方新建分栏" @dragover="allowDrop" @drop="dropOnGroup($event, 'top')"><ArrowUp :size="17" /><span>上方</span></button>
      <button class="aux-dock-zone bottom" aria-label="在下方新建分栏" title="在下方新建分栏" @dragover="allowDrop" @drop="dropOnGroup($event, 'bottom')"><ArrowDown :size="17" /><span>下方</span></button>
    </div>
  </div>
  <div v-else ref="splitElement" class="aux-dock-split" :class="node.direction" :style="splitStyle">
    <template v-for="(child, index) in node.children" :key="child.id">
      <AuxDockLayout :node="child" :tabs="tabs" :focused-group-id="focusedGroupId" :dragging-tab="draggingTab" :drop-target-group-id="dropTargetGroupId" :customization-open="customizationOpen" :style="childPlacement(index)" @select="(panel, groupId) => emit('select', panel, groupId)" @focus="emit('focus', $event)" @drag-start="(panel, groupId) => emit('dragStart', panel, groupId)" @drag-enter="emit('dragEnter', $event)" @drag-leave="emit('dragLeave', $event)" @drag-end="emit('dragEnd')" @dock="emit('dock', $event)" @resize="emit('resize', $event)" @customize="emit('customize')">
        <template #panel="scope"><slot name="panel" v-bind="scope" /></template>
      </AuxDockLayout>
      <div v-if="index < node.children.length - 1" class="aux-dock-resize" :class="node.direction" :style="handlePlacement(index)" role="separator" :aria-orientation="node.direction === 'horizontal' ? 'vertical' : 'horizontal'" tabindex="0" aria-label="调整分栏大小" @pointerdown="startResize($event, index)" @pointermove="updateResize" @pointerup="endResize" @pointercancel="endResize" @lostpointercapture="endResize" @keydown="keyboardResize($event, index)" />
    </template>
  </div>
</template>
