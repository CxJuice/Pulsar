<script setup lang="ts">
import { UserRound } from 'lucide-vue-next'
import type { OccupyingUser } from '~/types/editor'
const props = defineProps<{ users: OccupyingUser[]; userId: number | null; compact?: boolean; iconOnly?: boolean }>()
const label = computed(() => props.users.map(user => `${user.username}${user.id === props.userId ? '（我）' : ''}`).join('、'))
const tooltip = computed(() => props.users.map(user => `${user.username} 正在编辑${user.editStartedAt ? ` · 开始于 ${new Date(user.editStartedAt).toLocaleTimeString()}` : ''}`).join('\n'))
</script>
<template>
  <span v-if="users.length" class="occupancy-badge" :class="{ compact, 'icon-only': iconOnly, mine: users.every(user => user.id === userId) }" :title="tooltip" :aria-label="`${label} 正在编辑`"><UserRound :size="13" /><span v-if="!iconOnly">{{ label }}</span><span v-if="!compact && !iconOnly">正在编辑</span></span>
</template>
