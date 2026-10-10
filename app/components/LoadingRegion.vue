<script setup lang="ts">
withDefaults(defineProps<{ busy: boolean; label?: string; initial?: boolean; skeleton?: boolean }>(), { label: '正在加载…', initial: false, skeleton: true })
const pageLoading = inject<import('vue').ComputedRef<boolean>>('workspace-loading', computed(() => false))
</script>
<template>
  <div class="loading-region" :aria-busy="busy">
    <div v-if="busy && initial && !pageLoading" class="loading-placeholder" role="status"><LoadingIndicator :size="28" :label="label" /><span>{{ label }}</span><div v-if="skeleton" class="loading-skeleton" aria-hidden="true"><i /><i /><i /></div></div>
    <div v-else :inert="busy || undefined" class="loading-region-content" :class="{ 'loading-retained': busy }"><slot /></div>
    <Transition name="fade"><span v-if="busy && !initial && !pageLoading" class="loading-region-status" role="status"><LoadingIndicator :size="14" :label="label" />{{ label }}</span></Transition>
  </div>
</template>
