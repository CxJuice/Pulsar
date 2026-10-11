<script setup lang="ts">
import type { UnwrapNestedRefs } from 'vue'
import type { WorkspaceNavigation } from '~/composables/useWorkspaceNavigation'
defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const navigation = inject<WorkspaceNavigation>('workspace-navigation')!
onBeforeRouteLeave(() => !navigation.saving && !navigation.loginBusy)
</script>
<template>
  <div class="project-home">
  <div v-if="!navigation.guideReady || editor.initializing" class="home-initializing" aria-hidden="true" />
  <StartupGuide v-else-if="navigation.showGuide || !editor.connected || !editor.sessionInfo.authenticated" :editor="editor" />
  <ProjectManager v-else :editor="editor" @close="navigation.continueEditing" @connect="navigation.showConnection = true" @pending="navigation.saving = $event" />
  </div>
</template>
