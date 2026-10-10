<script setup lang="ts">
import { X, LogIn } from 'lucide-vue-next'
import type { SessionStatus } from '~/types/editor'
defineProps<{ desktop: boolean }>()
const emit = defineEmits<{ close: []; connected: [projectId: number, fileId: number, session: SessionStatus]; pending: [value: boolean] }>()
const busy = ref(false), root = ref<HTMLElement>(), form = ref<{ focus: () => void }>()
const titleId = useId()
function pending(value: boolean) { busy.value = value; emit('pending', value) }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); if (!busy.value) emit('close') }
  if (event.key !== 'Tab') return
  const controls = [...(root.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]') || [])]
  const first = controls[0], last = controls.at(-1)
  if (!first) { event.preventDefault(); root.value?.focus(); return }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
let previousFocus: HTMLElement | null = null
onMounted(() => { previousFocus = document.activeElement as HTMLElement; form.value?.focus() })
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus() })
</script>
<template>
  <div class="modal-backdrop" @click.self="!busy && emit('close')">
    <section ref="root" class="connection-dialog" tabindex="-1" :aria-busy="busy" role="dialog" aria-modal="true" :aria-labelledby="titleId" @keydown="keydown">
      <button class="icon-button modal-close" aria-label="关闭连接窗口" :disabled="busy" @click="emit('close')"><X :size="18" /></button>
      <div class="connection-mark"><LogIn :size="28" /></div>
      <h1 :id="titleId">登录 ParaTranz</h1>
      
      <ConnectionForm ref="form" :desktop="desktop" @pending="pending" @connected="session => emit('connected', 0, 0, session)" />
      <button type="button" class="text-button login-defer" :disabled="busy" @click="emit('close')">暂不登录</button>
    </section>
  </div>
</template>
