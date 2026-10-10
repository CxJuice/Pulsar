<script setup lang="ts">
withDefaults(defineProps<{ size?: number; label?: string; primary?: boolean }>(), { size: 20, label: '正在加载', primary: false })
const pageLoading = inject<import('vue').ComputedRef<boolean>>('workspace-loading', computed(() => false))
</script>
<template>
  <span v-show="primary || !pageLoading" class="loading-indicator" role="status" :aria-label="label" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle class="loading-track" cx="12" cy="12" r="9" /><circle class="loading-arc" cx="12" cy="12" r="9" /></svg>
  </span>
</template>
