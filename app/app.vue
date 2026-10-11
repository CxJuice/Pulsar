<script setup lang="ts">
const editor = reactive(useEditor())
const navigation = reactive(useWorkspaceNavigation(editor))
const theme = ref('light')
const route = useRoute()
const loadingLabel = computed(() => {
  if (navigation.showConnection || navigation.loginBusy) return ''
  if (!navigation.guideReady) return '正在准备工作台…'
  if (navigation.loadingLabel) return navigation.loadingLabel
  if (editor.initializing) return '正在准备工作台…'
  return navigation.catalogBusy ? '正在加载项目…' : ''
})
const pageLoading = computed(() => !!loadingLabel.value)
provide('workspace-loading', pageLoading)
watch(() => route.path, path => { if (path === '/editor') navigation.alignEditor() })
watchEffect(() => {
  editor.presenceProjectId = route.path === '/editor' && editor.workspaceReady ? editor.project.id : navigation.projectChosen ? navigation.browse.id : 0
})
provide('workspace-navigation', navigation)
provide('workspace-theme', theme)
onMounted(() => { theme.value = localStorage.getItem('sckit-theme') || 'light' })
</script>
<template>
  <div class="app-shell" :data-theme="theme">
    <WorkspaceTitlebar :editor="editor" :caption="route.path === '/editor' ? '翻译工作台' : route.path === '/settings' ? '设置' : '项目主页'" />
    <SubmissionNotifications :editor="editor" />
    <div class="application-body">
      <ApplicationSidebar :editor="editor" :navigation="navigation" />
      <div class="application-content" :aria-busy="pageLoading">
        <div class="application-page"><NuxtPage :editor="editor" :keepalive="true" :transition="{ name: 'page', mode: 'out-in' }" /></div>
        <div v-show="pageLoading" class="project-loading-status" role="status"><span><LoadingIndicator :size="20" :label="loadingLabel" primary />{{ loadingLabel }}</span></div>
      </div>
    </div>
    <Transition name="dialog"><ConnectionDialog v-if="navigation.showConnection" :desktop="editor.desktop" @close="navigation.showConnection = false" @pending="value => navigation.loginBusy = value" @connected="navigation.connected" /></Transition>
  </div>
</template>
