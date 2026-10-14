<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  url?: string | null
  label: string
  size?: number
}>(), { size: 34 })

const failedUrl = ref('')
const imageUrl = computed(() => {
  const value = props.url?.trim()
  if (!value) return ''

  try {
    const parsed = new URL(value, 'https://paratranz.cn')
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
})
const showImage = computed(() => !!imageUrl.value && failedUrl.value !== imageUrl.value)
const initial = computed(() => props.label.trim().slice(0, 1).toLocaleUpperCase() || 'U')

watch(imageUrl, () => { failedUrl.value = '' })

function handleImageError() {
  failedUrl.value = imageUrl.value
}
</script>

<template>
  <span
    class="member-avatar"
    :style="{ width: `${size}px`, height: `${size}px`, flexBasis: `${size}px` }"
    aria-hidden="true"
  >
    <img v-if="showImage" :src="imageUrl" alt="" loading="lazy" @error="handleImageError" />
    <template v-else>{{ initial }}</template>
  </span>
</template>

<style scoped>
.member-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
}

.member-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
