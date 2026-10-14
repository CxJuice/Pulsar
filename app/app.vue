<script setup lang="ts">
import { appearanceCssVariables, appearanceStorageKey, defaultAppearanceSettings, parseAppearanceSettings } from '~/utils/appearance'
import { compileTermExemptionRules, defaultTermExemptionRules } from '~/utils/termHighlights'

const editor = reactive(useEditor())
const closeFlushers = new Set<() => Promise<void>>()
async function flushEditorSurfaces() {
  await editor.flushDraft(true)
  await Promise.all([...closeFlushers].map(flush => flush()))
}
provide('workspace-close-flusher', (flush: () => Promise<void>) => {
  closeFlushers.add(flush)
  return () => closeFlushers.delete(flush)
})
provide('workspace-flush-surfaces', flushEditorSurfaces)
async function prepareClose() {
  try {
    await flushEditorSurfaces()
    await editor.waitForSubmissions()
    window.scKit?.closeResponse(true)
  } catch (reason) {
    editor.error = (reason as Error).message
    window.scKit?.closeResponse(false, editor.error)
  }
}
let removeBeforeClose: (() => void) | undefined
let removeSessionRestored: (() => void) | undefined
async function sessionRestored(result: { ok: boolean; message: string; sessionLost?: boolean }) {
  if (!result.ok) {
    editor.error = result.message || '登录恢复失败，可在项目主页重试登录'
    if (result.sessionLost) { editor.connected = false; editor.sessionInfo = { authenticated: false, mode: 'none' } }
    return
  }
  const observedSession = editor.sessionInfo
  try {
    const session = await editor.api<import('~/types/editor').SessionStatus>('session')
    if (editor.sessionInfo !== observedSession) return
    if (session.authenticated) {
      if (editor.connected && editor.sessionInfo.user?.id === session.user?.id) { editor.sessionInfo = session; return }
      await editor.restoreSession(session)
      navigation.finishGuide()
    }
  } catch (reason) { editor.error = (reason as Error).message }
}
const navigation = reactive(useWorkspaceNavigation(editor, flushEditorSurfaces))
const theme = ref('light')
const translationLayout = ref<'horizontal' | 'vertical'>('horizontal')
const appearance = ref(defaultAppearanceSettings())
const termRecognitionEnabled = ref(true)
const termExemptionRules = ref([...defaultTermExemptionRules])
const defaultTermExemptionPatterns = compileTermExemptionRules(defaultTermExemptionRules).patterns
const termExemptionPatterns = shallowRef(defaultTermExemptionPatterns)
if (import.meta.client) {
  try { termRecognitionEnabled.value = localStorage.getItem('sckit-term-recognition-enabled') !== '0' }
  catch { /* Keep term recognition enabled when local storage is unavailable. */ }
  try {
    const savedRules = JSON.parse(localStorage.getItem('sckit-term-exemption-rules') || 'null')
    if (Array.isArray(savedRules) && savedRules.every((rule): rule is string => typeof rule === 'string')) {
      const cleanedRules = savedRules.map(rule => rule.trim()).filter(Boolean)
      const compiledRules = compileTermExemptionRules(cleanedRules)
      if (!compiledRules.error) {
        termExemptionRules.value = cleanedRules
        termExemptionPatterns.value = compiledRules.patterns
      }
    }
  } catch { /* Use the default exemption rules when storage is unavailable or invalid. */ }
}
const appearanceStyle = computed(() => appearanceCssVariables(appearance.value, theme.value))
const route = useRoute()
const loadingLabel = computed(() => {
  if (route.path === '/layout-preview') return ''
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
provide('workspace-translation-layout', translationLayout)
provide('workspace-appearance', appearance)
provide('workspace-term-recognition', termRecognitionEnabled)
provide('workspace-term-exemption-rules', termExemptionRules)
provide('workspace-term-exemption-patterns', termExemptionPatterns)
onMounted(() => {
  removeBeforeClose = window.scKit?.onBeforeClose(() => { void prepareClose() })
  removeSessionRestored = window.scKit?.onSessionRestored(result => { void sessionRestored(result) })
  theme.value = localStorage.getItem('sckit-theme') || 'light'
  try {
    const savedLayout = localStorage.getItem('sckit-translation-layout')
    if (savedLayout === 'horizontal' || savedLayout === 'vertical') translationLayout.value = savedLayout
    appearance.value = parseAppearanceSettings(localStorage.getItem(appearanceStorageKey))
  } catch { /* Use the default layout when storage is unavailable. */ }
})
onBeforeUnmount(() => { removeBeforeClose?.(); removeSessionRestored?.() })
</script>
<template>
  <div class="app-shell" :data-theme="theme" :style="appearanceStyle">
    <WorkspaceTitlebar :editor="editor" :caption="route.path === '/layout-preview' ? '本地布局测试' : route.path === '/editor' ? '翻译工作台' : route.path === '/settings' ? '设置' : route.path === '/project-section/overview' || route.path === '/' ? '项目主页' : route.path.startsWith('/project-section/') ? '项目栏目' : '项目主页'" />
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
