<script setup lang="ts">
import { ArrowLeft, Sun, Moon, Check, Link, ExternalLink, Settings, Monitor, Compass, Languages } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { WorkspaceNavigation } from '~/composables/useWorkspaceNavigation'
import type { AutoUpdateState, LocalFontData, ProxyTestResult, TranslationMode, TranslationProvider, TranslationProxyMode, TranslationSettings, TranslationSettingsUpdate } from '~/types/editor'
import { appearanceStorageKey, cssFontFamily, defaultAccentColors, defaultAppearanceSettings, defaultBackgroundColors, defaultFontFamily, safeFontFamily } from '~/utils/appearance'
import type { AppearanceSettings, AppearanceTextRegion, AppearanceTheme } from '~/utils/appearance'
import { compileTermExemptionRules, defaultTermExemptionRules } from '~/utils/termHighlights'
import packageInfo from '../../package.json'

const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const flushWorkspace = inject<() => Promise<void>>('workspace-flush-surfaces', () => props.editor.flushDraft(true))
const navigation = inject<WorkspaceNavigation>('workspace-navigation')!
const theme = inject<Ref<string>>('workspace-theme')!
const translationLayout = inject<Ref<'horizontal' | 'vertical'>>('workspace-translation-layout')!
const appearance = inject<Ref<AppearanceSettings>>('workspace-appearance')!
const termRecognitionEnabled = inject<Ref<boolean>>('workspace-term-recognition')!
const termExemptionRules = inject<Ref<string[]>>('workspace-term-exemption-rules')!
const termExemptionPatterns = inject<Ref<RegExp[]>>('workspace-term-exemption-patterns')!
const appearanceError = ref('')
const termRecognitionError = ref('')
const termExemptionDraft = ref(termExemptionRules.value.join('\n'))
const termExemptionError = ref(''), termExemptionNotice = ref('')
const systemFonts = ref<string[]>([]), systemFontsBusy = ref(false), systemFontsError = ref(false), systemFontsMessage = ref('')
const buildInfo = ref<{ commit: string; sourceFingerprint: string; builtAt: string } | null>(null)
const autoUpdate = ref<AutoUpdateState>({ status: 'disabled', version: '', percent: 0 })
const autoUpdateBusy = ref(false), autoUpdateError = ref('')
let removeAutoUpdateListener: (() => void) | undefined
const autoUpdateMessage = computed(() => {
  switch (autoUpdate.value.status) {
    case 'checking': return '正在检查更新…'
    case 'available': return `发现 macOS 新版本 ${autoUpdate.value.version}，请下载 DMG 并手动安装。`
    case 'downloading': return `正在下载 ${autoUpdate.value.version || '新版本'}（${autoUpdate.value.percent}%）`
    case 'downloaded': return `${autoUpdate.value.version} 已下载，退出应用时会自动安装。`
    case 'up-to-date': return `已是最新版本${autoUpdate.value.version ? `（${autoUpdate.value.version}）` : ''}。`
    case 'error': return '更新检查或下载失败，可稍后重试。'
    default: return '当前运行方式未启用自动更新。'
  }
})
const typographyRegions: { key: AppearanceTextRegion; title: string }[] = [
  { key: 'ui', title: '界面默认' },
  { key: 'listSource', title: '字符串列表 · 原文' },
  { key: 'listTranslation', title: '字符串列表 · 译文' },
  { key: 'editorSource', title: '中间栏 · 原文' },
  { key: 'editorTranslation', title: '中间栏 · 译文' },
]
const accentThemeOptions: { key: AppearanceTheme; label: string }[] = [
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' },
]
const translationProviderOptions: { value: TranslationProvider; label: string; description: string }[] = [
  { value: 'google', label: 'Google 翻译', description: '内嵌网页或 Cloud Translation API' },
  { value: 'deepl', label: 'DeepL', description: '内嵌网页或 DeepL API' },
  { value: 'llm', label: 'LLM', description: 'OpenAI 兼容 Chat Completions / Responses 接口' },
]
const translationConfig = reactive({ provider: 'google' as TranslationProvider, mode: 'web' as TranslationMode, deeplPlan: 'free' as 'free' | 'pro', proxyMode: 'system' as TranslationProxyMode, proxyHost: '127.0.0.1', proxyPort: 7890, googleConfigured: false, deeplConfigured: false, llmRequestUrl: '', llmModel: '', llmPrefixPrompt: '', llmConfigured: false, clearAfterSaveNext: true, useTermTranslations: true, llmContext: { key: true, recommendations: true, recommendationCount: 1, terms: true, notes: true } })
const googleApiKey = ref(''), deeplApiKey = ref(''), llmApiKey = ref(''), clearGoogleApiKey = ref(false), clearDeepLApiKey = ref(false), clearLlmApiKey = ref(false)
const loadedTranslationConfig = ref('')
const hasUnsavedTranslationSettings = computed(() => !!loadedTranslationConfig.value && (
  JSON.stringify(translationConfig) !== loadedTranslationConfig.value ||
  !!googleApiKey.value || !!deeplApiKey.value || !!llmApiKey.value ||
  clearGoogleApiKey.value || clearDeepLApiKey.value || clearLlmApiKey.value))
const translationBusy = ref(false), translationError = ref(''), translationNotice = ref('')
const proxyTestBusy = ref(false), proxyTestError = ref(''), proxyTestResult = ref<ProxyTestResult | null>(null)
let proxyTestRequest = 0
watch(() => [translationConfig.proxyMode, translationConfig.proxyHost, translationConfig.proxyPort], () => {
  proxyTestRequest++
  proxyTestBusy.value = false
  proxyTestError.value = ''
  proxyTestResult.value = null
})
const translationProxySummary = computed(() => translationConfig.proxyMode === 'system' ? '使用系统代理' : translationConfig.proxyMode === 'direct' ? '直连' : `${translationConfig.proxyMode.toUpperCase()} · ${translationConfig.proxyHost}:${translationConfig.proxyPort}`)
watch(() => translationConfig.provider, provider => {
  if (provider === 'llm') translationConfig.mode = 'api'
})
const accountName = computed(() => props.editor.sessionInfo.user?.nickname || props.editor.sessionInfo.user?.username)
const connectionStatus = computed(() => props.editor.initializing ? '正在恢复登录…' : props.editor.connected ? props.editor.sessionInfo.authenticated ? '已连接 ParaTranz' : '登录已过期' : '未连接')
function openAccount() { window.scKit?.openExternal('https://paratranz.cn/users/my') }
async function refreshAutoUpdateStatus() {
  if (!window.scKit) return
  try {
    const result = await window.scKit.getAutoUpdateStatus()
    if (result.ok && result.data) autoUpdate.value = result.data
  } catch { /* The update status can be checked again from this page. */ }
}
async function checkForUpdates() {
  if (!window.scKit) return
  autoUpdateBusy.value = true
  autoUpdateError.value = ''
  try {
    const result = await window.scKit.checkForUpdates()
    if (!result.ok || !result.data) throw new Error(result.message || '检查更新失败')
    autoUpdate.value = result.data
  } catch (reason) { autoUpdateError.value = (reason as Error).message || '检查更新失败' }
  finally { autoUpdateBusy.value = false }
}
async function installDownloadedUpdate() {
  if (!window.scKit) return
  autoUpdateBusy.value = true
  autoUpdateError.value = ''
  try {
    const result = await window.scKit.installUpdate()
    if (!result.ok) throw new Error(result.message || '无法安装更新')
  } catch (reason) { autoUpdateError.value = (reason as Error).message || '无法安装更新' }
  finally { autoUpdateBusy.value = false }
}
async function downloadMacUpdate() {
  if (!window.scKit || !autoUpdate.value.downloadUrl) return
  autoUpdateError.value = ''
  try { await window.scKit.openExternal(autoUpdate.value.downloadUrl) }
  catch (reason) { autoUpdateError.value = (reason as Error).message || '无法打开 macOS 更新下载页' }
}
function setTheme(value: 'light' | 'dark') {
  theme.value = value; appearanceError.value = ''
  try { localStorage.setItem('sckit-theme', value) }
  catch { appearanceError.value = '主题已应用，但无法保存到本设备。' }
}
function setTranslationLayout(value: 'horizontal' | 'vertical') {
  translationLayout.value = value; appearanceError.value = ''
  try { localStorage.setItem('sckit-translation-layout', value) }
  catch { appearanceError.value = '布局已应用，但无法保存到本设备。' }
}
function saveTermRecognitionSetting() {
  termRecognitionError.value = ''
  try { localStorage.setItem('sckit-term-recognition-enabled', termRecognitionEnabled.value ? '1' : '0') }
  catch { termRecognitionError.value = '设置已应用，但无法保存到本设备。' }
}
function saveTermExemptionRules() {
  termExemptionError.value = ''
  termExemptionNotice.value = ''
  const rules = termExemptionDraft.value.split(/\r?\n/u).map(rule => rule.trim()).filter(Boolean)
  const compiled = compileTermExemptionRules(rules)
  if (compiled.error) { termExemptionError.value = compiled.error; return }
  termExemptionRules.value = rules
  termExemptionPatterns.value = compiled.patterns
  try {
    localStorage.setItem('sckit-term-exemption-rules', JSON.stringify(rules))
    termExemptionNotice.value = `已应用 ${rules.length} 条豁免规则。`
  } catch { termExemptionError.value = '规则已应用，但无法保存到本设备。' }
}
function resetTermExemptionRules() {
  termExemptionDraft.value = defaultTermExemptionRules.join('\n')
  saveTermExemptionRules()
}
function saveAppearance() {
  appearanceError.value = ''
  try { localStorage.setItem(appearanceStorageKey, JSON.stringify(appearance.value)) }
  catch { appearanceError.value = '设置已应用，但无法保存到本设备。' }
}
function setAppearanceColor(themeName: AppearanceTheme, event: Event) {
  const value = (event.target as HTMLInputElement).value
  appearance.value.backgroundColors[themeName] = /^#[\da-f]{6}$/i.test(value) ? value : null
  saveAppearance()
}
function resetAppearanceColor(themeName: AppearanceTheme) {
  appearance.value.backgroundColors[themeName] = null
  saveAppearance()
}
function setAccentColor(themeName: AppearanceTheme, event: Event) {
  const value = (event.target as HTMLInputElement).value
  appearance.value.accentColors[themeName] = /^#[\da-f]{6}$/i.test(value) ? value : null
  saveAppearance()
}
function resetAccentColor(themeName: AppearanceTheme) {
  appearance.value.accentColors[themeName] = null
  saveAppearance()
}
function setFontFamily(region: AppearanceTextRegion, event: Event) {
  const value = (event.target as HTMLInputElement).value.trim()
  const installedFont = systemFonts.value.find(font => font === value)
  appearance.value.typography[region].fontFamily = installedFont ? `system:${installedFont}` : safeFontFamily(value, '')
  saveAppearance()
}
function fontFamilyInput(region: AppearanceTextRegion) {
  const value = appearance.value.typography[region].fontFamily
  return value.startsWith('system:') ? value.slice('system:'.length) : value
}
function fontFamilyPreview(region: AppearanceTextRegion) {
  const value = appearance.value.typography[region].fontFamily || appearance.value.typography.ui.fontFamily
  return cssFontFamily(value, defaultFontFamily)
}
async function loadSystemFonts() {
  const queryLocalFonts = window.queryLocalFonts
  systemFontsMessage.value = ''; systemFontsError.value = false
  if (!queryLocalFonts) {
    systemFontsError.value = true
    systemFontsMessage.value = '当前环境不支持读取系统字体；仍可手动输入字体名称。'
    return
  }
  systemFontsBusy.value = true
  try {
    const fonts: LocalFontData[] = await queryLocalFonts()
    systemFonts.value = [...new Set(fonts.map(font => font.family.trim()).filter(Boolean))]
      .sort((first, second) => first.localeCompare(second, undefined, { sensitivity: 'base' }))
    systemFontsMessage.value = systemFonts.value.length
      ? `已读取 ${systemFonts.value.length} 种系统字体，可在字体框中搜索并选择。`
      : '没有读取到系统字体；仍可手动输入字体名称。'
  } catch (reason) {
    systemFontsError.value = true
    systemFontsMessage.value = (reason as Error).name === 'NotAllowedError'
      ? '未获得读取系统字体的权限；仍可手动输入字体名称。'
      : '读取系统字体失败；仍可手动输入字体名称。'
  } finally { systemFontsBusy.value = false }
}
function setFontSize(region: AppearanceTextRegion, event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  const min = region === 'ui' ? 10 : 8
  const max = region === 'ui' ? 32 : 48
  appearance.value.typography[region].fontSize = Number.isFinite(value) && value > 0 ? Math.min(max, Math.max(min, Math.round(value))) : region === 'ui' ? 13 : null
  saveAppearance()
}
function resetAppearance() {
  appearance.value = defaultAppearanceSettings()
  saveAppearance()
}
function themeKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  setTheme(theme.value === 'light' ? 'dark' : 'light')
  nextTick(() => document.querySelector<HTMLButtonElement>('.theme-choice[aria-checked="true"]')?.focus())
}
function layoutKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  setTranslationLayout(translationLayout.value === 'horizontal' ? 'vertical' : 'horizontal')
  nextTick(() => document.querySelector<HTMLButtonElement>('.layout-choice[aria-checked="true"]')?.focus())
}
function applyTranslationSettings(settings: TranslationSettings) {
  translationConfig.provider = settings.provider
  translationConfig.mode = settings.mode
  translationConfig.deeplPlan = settings.deeplPlan
  translationConfig.proxyMode = settings.proxy.mode
  translationConfig.proxyHost = settings.proxy.host
  translationConfig.proxyPort = settings.proxy.port
  translationConfig.googleConfigured = settings.googleConfigured
  translationConfig.deeplConfigured = settings.deeplConfigured
  translationConfig.llmRequestUrl = settings.llmRequestUrl
  translationConfig.llmModel = settings.llmModel
  translationConfig.llmPrefixPrompt = settings.llmPrefixPrompt
  translationConfig.llmConfigured = settings.llmConfigured
  translationConfig.clearAfterSaveNext = settings.clearAfterSaveNext
  translationConfig.useTermTranslations = settings.useTermTranslations
  Object.assign(translationConfig.llmContext, settings.llmContext)
}
async function testProxy() {
  if (!window.scKit) { proxyTestError.value = '代理测试仅在桌面应用中可用。'; return }
  const request = ++proxyTestRequest
  proxyTestBusy.value = true; proxyTestError.value = ''; proxyTestResult.value = null
  try {
    const result = await window.scKit.testProxy({ mode: translationConfig.proxyMode, host: translationConfig.proxyHost.trim(), port: Number(translationConfig.proxyPort) })
    if (request !== proxyTestRequest) return
    if (!result.ok || !result.data) throw new Error(result.message || '代理测试失败')
    proxyTestResult.value = result.data
  } catch (reason) { if (request === proxyTestRequest) proxyTestError.value = (reason as Error).message || '代理测试失败' }
  finally { if (request === proxyTestRequest) proxyTestBusy.value = false }
}
function formatProxyTestResult(result: ProxyTestResult) {
  return result.results.map(item => {
    let host = item.target
    try { host = new URL(item.target).hostname } catch { /* Keep the origin when parsing is unavailable. */ }
    const status = item.status ? `HTTP ${item.status}` : item.ok ? '连接成功' : item.message || '失败'
    return `${host}: ${status} · ${item.elapsedMs} ms`
  }).join('；')
}
async function loadTranslationSettings() {
  if (!window.scKit) return
  if (translationBusy.value) return
  if (hasUnsavedTranslationSettings.value) { translationNotice.value = '表单中有未保存修改，已保留输入。'; return }
  const formBefore = JSON.stringify([translationConfig, googleApiKey.value, deeplApiKey.value, llmApiKey.value, clearGoogleApiKey.value, clearDeepLApiKey.value, clearLlmApiKey.value])
  translationBusy.value = true
  try {
    const result = await window.scKit.getTranslationSettings()
    if (!result.ok || !result.data) throw new Error(result.message || '无法读取翻译设置')
    if (formBefore !== JSON.stringify([translationConfig, googleApiKey.value, deeplApiKey.value, llmApiKey.value, clearGoogleApiKey.value, clearDeepLApiKey.value, clearLlmApiKey.value])) {
      translationNotice.value = '读取设置期间表单发生修改，已保留输入。'
      return
    }
    applyTranslationSettings(result.data)
    loadedTranslationConfig.value = JSON.stringify(translationConfig)
  } catch (reason) { translationError.value = (reason as Error).message || '无法读取翻译设置' }
  finally { translationBusy.value = false }
}
async function saveTranslationSettings() {
  if (!window.scKit) { translationError.value = '翻译服务设置仅在桌面应用中可用。'; return }
  translationBusy.value = true; translationError.value = ''; translationNotice.value = ''
  const update: TranslationSettingsUpdate = {
    provider: translationConfig.provider,
    mode: translationConfig.mode,
    deeplPlan: translationConfig.deeplPlan,
    llmRequestUrl: translationConfig.llmRequestUrl.trim(),
    llmModel: translationConfig.llmModel.trim(),
    llmPrefixPrompt: translationConfig.llmPrefixPrompt,
    llmContext: { ...translationConfig.llmContext },
    clearAfterSaveNext: translationConfig.clearAfterSaveNext,
    useTermTranslations: translationConfig.useTermTranslations,
    proxy: { mode: translationConfig.proxyMode, host: translationConfig.proxyHost.trim(), port: Number(translationConfig.proxyPort) },
    ...(translationConfig.provider === 'google' && translationConfig.mode === 'api' ? googleApiKey.value.trim() ? { googleApiKey: googleApiKey.value.trim() } : clearGoogleApiKey.value ? { clearGoogleApiKey: true } : {} : {}),
    ...(translationConfig.provider === 'deepl' && translationConfig.mode === 'api' ? deeplApiKey.value.trim() ? { deeplApiKey: deeplApiKey.value.trim() } : clearDeepLApiKey.value ? { clearDeepLApiKey: true } : {} : {}),
    ...(translationConfig.provider === 'llm' ? llmApiKey.value.trim() ? { llmApiKey: llmApiKey.value.trim() } : clearLlmApiKey.value ? { clearLlmApiKey: true } : {} : {}),
  }
  try {
    await flushWorkspace()
    await props.editor.waitForSubmissions()
    const result = await window.scKit.saveTranslationSettings(update)
    if (!result.ok || !result.data) throw new Error(result.message || '保存翻译设置失败')
    applyTranslationSettings(result.data)
    if (translationConfig.provider === 'google') { googleApiKey.value = ''; clearGoogleApiKey.value = false }
    if (translationConfig.provider === 'deepl') { deeplApiKey.value = ''; clearDeepLApiKey.value = false }
    if (translationConfig.provider === 'llm') { llmApiKey.value = ''; clearLlmApiKey.value = false }
    loadedTranslationConfig.value = JSON.stringify(translationConfig)
    window.dispatchEvent(new CustomEvent('sckit:translation-settings-updated', { detail: result.data }))
    translationNotice.value = '翻译服务设置已保存。'
  } catch (reason) { translationError.value = (reason as Error).message || '保存翻译设置失败' }
  finally { translationBusy.value = false }
}
onMounted(() => {
  void window.scKit?.getBuildInfo?.().then(info => { buildInfo.value = info })
  removeAutoUpdateListener = window.scKit?.onAutoUpdateStatus(state => { autoUpdate.value = state })
  void refreshAutoUpdateStatus()
  theme.value = localStorage.getItem('sckit-theme') || 'light'
  try {
    const savedLayout = localStorage.getItem('sckit-translation-layout')
    if (savedLayout === 'horizontal' || savedLayout === 'vertical') translationLayout.value = savedLayout
  } catch { /* Keep the default layout when storage is unavailable. */ }
  void loadTranslationSettings()
})
onActivated(() => { if (loadedTranslationConfig.value) void loadTranslationSettings(); void refreshAutoUpdateStatus() })
onBeforeUnmount(() => { removeAutoUpdateListener?.() })
</script>
<template>
  <main class="settings-page" aria-label="应用设置">
    <header class="settings-header"><div><h1>设置</h1></div><button class="button" :disabled="navigation.blocked" @click="navigation.goHome"><ArrowLeft :size="15" />返回主页</button></header>
    <div class="settings-content">
      <div v-if="navigation.error" class="sidebar-message error" role="alert">{{ navigation.error }}</div>
      <section class="settings-card" aria-labelledby="appearance-title">
        <div class="settings-card-heading"><Sun :size="20" /><h2 id="appearance-title">外观</h2></div>
        <div class="settings-row"><div><h3>主题</h3></div><div class="theme-choices" role="radiogroup" aria-label="工作台主题" @keydown="themeKeydown"><button class="theme-choice" :class="{ selected: theme === 'light' }" role="radio" :aria-checked="theme === 'light'" :tabindex="theme === 'light' ? 0 : -1" @click="setTheme('light')"><Sun :size="17" /><span>浅色</span><Check v-if="theme === 'light'" :size="14" /></button><button class="theme-choice" :class="{ selected: theme === 'dark' }" role="radio" :aria-checked="theme === 'dark'" :tabindex="theme === 'dark' ? 0 : -1" @click="setTheme('dark')"><Moon :size="17" /><span>深色</span><Check v-if="theme === 'dark'" :size="14" /></button></div></div>
        <div class="settings-row appearance-accent-row"><div><h3>主题色</h3><p>分别为浅色和深色主题设置强调色。</p></div><div class="appearance-accent-grid" role="group" aria-label="浅色和深色主题色"><div v-for="option in accentThemeOptions" :key="option.key" class="appearance-accent-option" :class="{ current: theme === option.key }"><div class="appearance-accent-heading"><Sun v-if="option.key === 'light'" :size="15" /><Moon v-else :size="15" /><strong>{{ option.label }}主题</strong><span v-if="theme === option.key" class="appearance-accent-current">当前</span></div><label class="appearance-accent-control"><input :aria-label="`${option.label}主题色`" type="color" :value="appearance.accentColors[option.key] || defaultAccentColors[option.key]" @input="setAccentColor(option.key, $event)" /><span><strong>{{ appearance.accentColors[option.key] || defaultAccentColors[option.key] }}</strong><small>{{ appearance.accentColors[option.key] ? '自定义颜色' : '默认颜色' }}</small></span></label><button class="text-button appearance-accent-reset" type="button" :disabled="!appearance.accentColors[option.key]" @click="resetAccentColor(option.key)">恢复默认</button></div></div></div>
        <div class="settings-row appearance-accent-row"><div><h3>背景色</h3><p>分别为浅色和深色主题设置背景色，文字、面板和边框会自动调整。</p></div><div class="appearance-accent-grid" role="group" aria-label="浅色和深色主题背景色"><div v-for="option in accentThemeOptions" :key="option.key" class="appearance-accent-option" :class="{ current: theme === option.key }"><div class="appearance-accent-heading"><Sun v-if="option.key === 'light'" :size="15" /><Moon v-else :size="15" /><strong>{{ option.label }}主题</strong><span v-if="theme === option.key" class="appearance-accent-current">当前</span></div><label class="appearance-accent-control"><input :aria-label="`${option.label}主题背景色`" type="color" :value="appearance.backgroundColors[option.key] || defaultBackgroundColors[option.key]" @input="setAppearanceColor(option.key, $event)" /><span><strong>{{ appearance.backgroundColors[option.key] || defaultBackgroundColors[option.key] }}</strong><small>{{ appearance.backgroundColors[option.key] ? '自定义颜色' : '默认颜色' }}</small></span></label><button class="text-button appearance-accent-reset" type="button" :disabled="!appearance.backgroundColors[option.key]" @click="resetAppearanceColor(option.key)">恢复默认</button></div></div></div>
        <div class="settings-row"><div><h3>中间栏原文和译文</h3><p>设置待翻译字符串列表中的排列方式。</p></div><div class="layout-choices" role="radiogroup" aria-label="中间栏原文和译文排列方式" @keydown="layoutKeydown"><button class="layout-choice" :class="{ selected: translationLayout === 'horizontal' }" role="radio" :aria-checked="translationLayout === 'horizontal'" :tabindex="translationLayout === 'horizontal' ? 0 : -1" @click="setTranslationLayout('horizontal')"><span>左右排列</span><Check v-if="translationLayout === 'horizontal'" :size="14" /></button><button class="layout-choice" :class="{ selected: translationLayout === 'vertical' }" role="radio" :aria-checked="translationLayout === 'vertical'" :tabindex="translationLayout === 'vertical' ? 0 : -1" @click="setTranslationLayout('vertical')"><span>上下排列</span><Check v-if="translationLayout === 'vertical'" :size="14" /></button></div></div>
        <div class="appearance-typography-heading"><div><h3>字体与字号</h3><p>留空时继承“界面默认”；可读取系统字体后搜索选择。</p></div><div class="appearance-typography-actions"><button class="text-button" type="button" :disabled="systemFontsBusy" @click="loadSystemFonts"><LoadingIndicator v-if="systemFontsBusy" :size="13" label="正在读取系统字体" />{{ systemFontsBusy ? '读取中…' : systemFonts.length ? `刷新系统字体（${systemFonts.length}）` : '读取系统字体' }}</button><button class="text-button" type="button" @click="resetAppearance">恢复外观默认值</button></div></div>
        <p v-if="systemFontsMessage" class="appearance-font-status" :class="{ error: systemFontsError }" role="status">{{ systemFontsMessage }}</p>
        <datalist id="appearance-font-suggestions"><option value="Inter, Segoe UI, sans-serif" /><option value="Microsoft YaHei UI, Microsoft YaHei, sans-serif" /><option value="Arial, sans-serif" /><option value="Consolas, monospace" /><option v-for="font in systemFonts" :key="font" :value="font" /></datalist>
        <div class="appearance-typography-grid">
          <div v-for="region in typographyRegions" :key="region.key" class="appearance-typography-row">
            <strong>{{ region.title }}</strong>
            <label><span>字体</span><input :aria-label="`${region.title}字体`" :value="fontFamilyInput(region.key)" :style="{ fontFamily: fontFamilyPreview(region.key) }" list="appearance-font-suggestions" :placeholder="region.key === 'ui' ? '系统默认字体' : '继承界面默认'" autocomplete="off" @input="setFontFamily(region.key, $event)" /></label>
            <label><span>字号</span><input :aria-label="`${region.title}字号`" :value="appearance.typography[region.key].fontSize ?? ''" type="number" :min="region.key === 'ui' ? 10 : 8" :max="region.key === 'ui' ? 32 : 48" step="1" :placeholder="region.key === 'ui' ? '13' : '继承'" @change="setFontSize(region.key, $event)" /><small>px</small></label>
          </div>
        </div>
        <p v-if="appearanceError" class="sidebar-message error" role="alert">{{ appearanceError }}</p>
      </section>
      <section class="settings-card" aria-labelledby="term-recognition-title">
        <div class="settings-card-heading"><Languages :size="20" /><h2 id="term-recognition-title">术语识别</h2></div>
        <div class="settings-row"><div><h3>自动识别与拆分术语</h3><p>在原文和译文中匹配项目术语，并将用“/”或“／”分隔的译名拆成独立候选。关闭后不再自动匹配、标记或拆分候选。</p></div><label class="term-recognition-toggle"><input v-model="termRecognitionEnabled" type="checkbox" @change="saveTermRecognitionSetting" /><span>启用</span></label></div>
        <div class="term-exemption-rules">
          <label for="term-exemption-rules"><strong>斜杠分割豁免规则</strong><small>每行一条 JavaScript 正则表达式，不含首尾斜杠。规则会检查术语原文、变体和译文：原文或变体命中时，关联译文整体作为一个候选；译文命中的片段内“/”和“／”不会用于拆分。规则忽略大小写。默认保护括号内的方向组合和单词/s。</small></label>
          <textarea id="term-exemption-rules" v-model="termExemptionDraft" rows="4" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="每行一条正则表达式" />
          <div class="term-exemption-actions"><button class="button" type="button" @click="resetTermExemptionRules">恢复默认</button><button class="button primary" type="button" @click="saveTermExemptionRules">应用规则</button></div>
          <p v-if="termExemptionError" class="sidebar-message error" role="alert">{{ termExemptionError }}</p>
          <p v-else-if="termExemptionNotice" class="sidebar-message" role="status">{{ termExemptionNotice }}</p>
        </div>
        <p v-if="termRecognitionError" class="sidebar-message error" role="alert">{{ termRecognitionError }}</p>
      </section>
      <section class="settings-card" aria-labelledby="connection-settings-title">
        <div class="settings-card-heading"><Link :size="20" /><h2 id="connection-settings-title">ParaTranz 连接</h2></div>
        <div class="settings-row"><div><h3 class="settings-connection-status"><span class="online-dot" :class="{ offline: !editor.connected || !editor.sessionInfo.authenticated }"></span><LoadingIndicator v-if="editor.initializing || navigation.busy" :size="14" label="正在更新连接" />{{ connectionStatus }}</h3><p v-if="editor.connected">{{ accountName ? `${accountName} · ` : '' }}{{ editor.sessionInfo.mode === 'token' ? 'API Token（备选）' : '网页登录'  }}</p></div><div class="settings-actions"><button class="button" :class="{ primary: !editor.connected || !editor.sessionInfo.authenticated }" :disabled="navigation.blocked" @click="navigation.showConnection = true">{{ editor.connected && editor.sessionInfo.authenticated ? '更换连接' : editor.connected ? '重新登录' : '连接 ParaTranz' }}</button><button v-if="editor.connected" class="button" :disabled="navigation.blocked" @click="navigation.disconnect">断开连接</button></div></div>
        <div v-if="editor.connected" class="settings-row"><div><h3>词条占用同步</h3><p v-if="editor.sessionInfo.mode === 'token'">需同账号网页登录。</p></div><button class="button" :disabled="editor.presenceLoginBusy || navigation.blocked" @click="editor.loginPresence()"><LoadingIndicator v-if="editor.presenceLoginBusy" :size="14" label="正在登录占用会话" />{{ editor.presenceLoginBusy ? '正在登录…' : '网页登录' }}</button></div>
        <div class="settings-row"><div><h3>ParaTranz 个人设置</h3></div><button class="button" :disabled="!editor.desktop" @click="openAccount">打开个人设置 <ExternalLink :size="14" /></button></div>
      </section>
      <section class="settings-card" aria-labelledby="translation-settings-title">
        <div class="settings-card-heading"><Languages :size="20" /><h2 id="translation-settings-title">翻译服务</h2></div>
        <p class="translation-settings-intro">设置右侧翻译模块的默认服务。翻译方向为英语 → 简体中文；API 密钥会加密保存在本机，密钥输入框留空会保留已保存的值。网络与代理设置会同时用于 ParaTranz 登录、API 请求、内嵌翻译网页和后台服务。</p>
        <form class="translation-settings-form" @submit.prevent="saveTranslationSettings">
          <section class="translation-settings-section" aria-labelledby="translation-service-heading">
            <header class="translation-section-heading"><span class="translation-section-index">01</span><div><h3 id="translation-service-heading">服务商与调用方式</h3><p>选择右侧模块默认使用的翻译服务。</p></div></header>
            <div class="translation-provider-picker" role="radiogroup" aria-label="翻译服务商">
              <label v-for="option in translationProviderOptions" :key="option.value" class="translation-provider-option" :class="{ selected: translationConfig.provider === option.value }">
                <input v-model="translationConfig.provider" type="radio" name="translation-provider" :value="option.value" :disabled="translationBusy || !editor.desktop" />
                <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
              </label>
            </div>
            <fieldset v-if="translationConfig.provider !== 'llm'" class="translation-mode-picker" :disabled="translationBusy || !editor.desktop">
              <legend>调用方式</legend>
              <label class="translation-mode-option" :class="{ selected: translationConfig.mode === 'web' }">
                <input v-model="translationConfig.mode" type="radio" name="translation-mode" value="web" />
                <span><strong>内嵌网页</strong><small>在右侧翻译面板中打开服务商网页。</small></span>
              </label>
              <label class="translation-mode-option" :class="{ selected: translationConfig.mode === 'api' }">
                <input v-model="translationConfig.mode" type="radio" name="translation-mode" value="api" />
                <span><strong>API</strong><small>直接发送文本并返回译文，需要 API 密钥。</small></span>
              </label>
            </fieldset>
            <div v-else class="translation-fixed-mode"><strong>API 调用</strong><span>使用下方配置的 OpenAI 兼容接口。</span></div>
          </section>

          <section class="translation-settings-section" aria-labelledby="translation-behavior-heading">
            <header class="translation-section-heading"><span class="translation-section-index">02</span><div><h3 id="translation-behavior-heading">翻译行为</h3><p>调整编辑器提交和全文翻译的默认行为。</p></div></header>
            <div class="translation-context-grid">
              <label class="translation-context-option"><input v-model="translationConfig.clearAfterSaveNext" :disabled="translationBusy || !editor.desktop" type="checkbox" /><span><strong>下一条为空时清空译文框</strong><small>下一条已有译文或本地草稿会自动加载；仅在没有译文和草稿时清空显示。</small></span></label>
              <label class="translation-context-option"><input v-model="translationConfig.useTermTranslations" :disabled="translationBusy || !editor.desktop" type="checkbox" /><span><strong>Google / DeepL 翻译时保留项目译名</strong><small>默认开启；翻译前先替换已登记术语。LLM 使用下方“项目术语”上下文设置。</small></span></label>
            </div>
          </section>

          <section v-if="translationConfig.provider === 'llm'" class="translation-settings-section" aria-labelledby="translation-llm-heading">
            <header class="translation-section-heading"><span class="translation-section-index">03</span><div><h3 id="translation-llm-heading">LLM 接口</h3><p>填写完整的 OpenAI 兼容请求 URL 和模型。</p></div></header>
            <div class="translation-settings-grid">
              <label>完整请求 URL<input v-model="translationConfig.llmRequestUrl" :disabled="translationBusy || !editor.desktop" type="url" placeholder="https://api.openai.com/v1/chat/completions" required autocomplete="url" /></label>
              <label>模型 ID<input v-model="translationConfig.llmModel" :disabled="translationBusy || !editor.desktop" placeholder="填写服务商提供的模型 ID" required autocomplete="off" /></label>
            </div>
            <p class="translation-context-disclosure">填写完整接口路径，应用会直接请求该 URL。Chat Completions 示例：/v1/chat/completions；Responses 示例：/v1/responses。</p>
            <div class="translation-credential-field">
              <label for="llm-translation-key">API Key</label>
              <input id="llm-translation-key" v-model="llmApiKey" :disabled="translationBusy || !editor.desktop" type="password" autocomplete="new-password" spellcheck="false" :placeholder="translationConfig.llmConfigured ? '已保存，输入新密钥可替换' : '远程服务填写密钥；本机环回服务可留空'" @input="clearLlmApiKey = false" />
              <small>{{ translationConfig.llmConfigured ? '已有密钥加密保存在本机；留空会保留' : '远程 HTTPS 服务需要密钥；本机环回地址可不填' }}</small>
              <label v-if="translationConfig.llmConfigured" class="translation-key-clear"><input v-model="clearLlmApiKey" :disabled="translationBusy" type="checkbox" />清除已保存的密钥</label>
            </div>
            <p class="translation-context-disclosure">每次翻译会将当前文本和已启用的参考信息发送到上述 API 地址。</p>
          </section>

          <section v-else-if="translationConfig.mode === 'api'" class="translation-settings-section" aria-labelledby="translation-api-key-heading">
            <header class="translation-section-heading"><span class="translation-section-index">03</span><div><h3 id="translation-api-key-heading">API 凭据</h3><p>密钥仅用于当前选中的服务商，输入新密钥可替换已保存的值。</p></div></header>
            <label v-if="translationConfig.provider === 'deepl'" class="translation-plan-field">DeepL API 计划<select v-model="translationConfig.deeplPlan" :disabled="translationBusy || !editor.desktop"><option value="free">API Free</option><option value="pro">API Pro</option></select></label>
            <div class="translation-credential-field">
              <label :for="translationConfig.provider === 'google' ? 'google-translation-key' : 'deepl-translation-key'">{{ translationConfig.provider === 'google' ? 'Google Cloud Translation API Key' : 'DeepL API Key' }}</label>
              <input v-if="translationConfig.provider === 'google'" id="google-translation-key" v-model="googleApiKey" :disabled="translationBusy || !editor.desktop" type="password" autocomplete="new-password" spellcheck="false" :placeholder="translationConfig.googleConfigured ? '已保存，输入新密钥可替换' : '输入 API 密钥'" @input="clearGoogleApiKey = false" />
              <input v-else id="deepl-translation-key" v-model="deeplApiKey" :disabled="translationBusy || !editor.desktop" type="password" autocomplete="new-password" spellcheck="false" :placeholder="translationConfig.deeplConfigured ? '已保存，输入新密钥可替换' : '输入 API 密钥'" @input="clearDeepLApiKey = false" />
              <small v-if="translationConfig.provider === 'google'">{{ translationConfig.googleConfigured ? '已有密钥加密保存在本机；留空会保留' : '尚未保存密钥' }}</small>
              <small v-else>{{ translationConfig.deeplConfigured ? '已有密钥加密保存在本机；留空会保留' : '尚未保存密钥' }}</small>
              <label v-if="translationConfig.provider === 'google' && translationConfig.googleConfigured" class="translation-key-clear"><input v-model="clearGoogleApiKey" :disabled="translationBusy" type="checkbox" />清除已保存的密钥</label>
              <label v-else-if="translationConfig.provider === 'deepl' && translationConfig.deeplConfigured" class="translation-key-clear"><input v-model="clearDeepLApiKey" :disabled="translationBusy" type="checkbox" />清除已保存的密钥</label>
            </div>
          </section>
          <p v-else class="translation-mode-hint">内嵌网页不需要 API 密钥，翻译网页会显示在右侧面板中。</p>

          <section v-if="translationConfig.provider === 'llm'" class="translation-settings-section" aria-labelledby="translation-prompt-heading">
            <header class="translation-section-heading"><span class="translation-section-index">04</span><div><h3 id="translation-prompt-heading">提示词与输出格式</h3><p>为模型补充语气、术语或返回格式要求。</p></div></header>
            <label class="translation-prompt-field"><span>自定义前置提示词</span><textarea v-model="translationConfig.llmPrefixPrompt" :disabled="translationBusy || !editor.desktop" maxlength="12000" rows="5" placeholder='例如：请使用正式、简洁的简体中文；按 JSON 格式返回 {"translation": "译文"}。' /><small><span>作为系统指令前置发送；留空时使用默认翻译规则。</span><span>{{ translationConfig.llmPrefixPrompt.length.toLocaleString() }} / 12,000</span></small></label>
          </section>

          <section v-if="translationConfig.provider === 'llm'" class="translation-settings-section" aria-labelledby="translation-context-heading">
            <header class="translation-section-heading"><span class="translation-section-index">05</span><div><h3 id="translation-context-heading">参考上下文</h3><p>选择随当前文本一起发送给模型的辅助信息。</p></div></header>
            <div class="translation-context-grid">
              <label class="translation-context-option"><input v-model="translationConfig.llmContext.key" :disabled="translationBusy || !editor.desktop" type="checkbox" /><span><strong>词条键值</strong><small>帮助模型理解文本用途。</small></span></label>
              <div class="translation-context-recommendations">
                <label class="translation-context-option"><input v-model="translationConfig.llmContext.recommendations" :disabled="translationBusy || !editor.desktop" type="checkbox" /><span><strong>ParaTranz 翻译建议</strong><small>按本地相似度从高到低排序。</small></span></label>
                <label class="translation-context-count"><span>发送建议数量</span><input v-model.number="translationConfig.llmContext.recommendationCount" :disabled="translationBusy || !editor.desktop || !translationConfig.llmContext.recommendations" type="number" min="1" max="20" step="1" /><small>最多 20 条</small></label>
              </div>
              <label class="translation-context-option"><input v-model="translationConfig.llmContext.terms" :disabled="translationBusy || !editor.desktop" type="checkbox" /><span><strong>项目术语</strong><small>包含术语备注。</small></span></label>
              <label class="translation-context-option"><input v-model="translationConfig.llmContext.notes" :disabled="translationBusy || !editor.desktop" type="checkbox" /><span><strong>译名备注</strong><small>包含词条上下文和评论。</small></span></label>
            </div>
            <p class="translation-context-disclosure">词条键值、建议、术语和译名备注默认开启，可分别关闭；建议数量默认为 1 条。</p>
          </section>

          <details class="translation-network-settings" open>
            <summary><span><strong>网络与代理</strong><small>{{ translationProxySummary }}</small></span><span class="translation-details-caret" aria-hidden="true">⌄</span></summary>
            <p>这是应用级代理，会用于 ParaTranz 登录、项目数据请求、内嵌翻译网页、翻译 API 和后台服务；系统代理模式会跟随本机配置。</p>
            <div class="translation-settings-grid">
              <label>代理方式<select v-model="translationConfig.proxyMode" :disabled="translationBusy || !editor.desktop"><option value="system">系统代理</option><option value="direct">不使用代理</option><option value="http">HTTP 代理</option><option value="socks5">SOCKS5 代理</option></select></label>
              <label v-if="['http', 'socks5'].includes(translationConfig.proxyMode)">代理主机<input v-model="translationConfig.proxyHost" :disabled="translationBusy || !editor.desktop" placeholder="127.0.0.1" autocomplete="off" /></label>
              <label v-if="['http', 'socks5'].includes(translationConfig.proxyMode)">代理端口<input v-model.number="translationConfig.proxyPort" :disabled="translationBusy || !editor.desktop" type="number" min="1" max="65535" placeholder="7890" /></label>
            </div>
            <div class="translation-proxy-actions"><button class="button" type="button" :disabled="translationBusy || proxyTestBusy || !editor.desktop" @click="testProxy"><LoadingIndicator v-if="proxyTestBusy" :size="14" label="正在测试代理" />{{ proxyTestBusy ? '测试中…' : '测试代理连通性' }}</button><span v-if="proxyTestResult" class="translation-proxy-result" :class="{ error: !proxyTestResult.ok }" role="status">{{ proxyTestResult.ok ? '代理可用' : '代理不可用' }} · {{ formatProxyTestResult(proxyTestResult) }}</span></div>
            <p v-if="proxyTestError" class="translation-proxy-test-error" role="alert">{{ proxyTestError }}</p>
          </details>

          <div class="translation-settings-footer"><p>更改后保存，新的默认服务将应用到右侧翻译模块。</p><button class="button primary" :disabled="translationBusy || !editor.desktop" type="submit"><LoadingIndicator v-if="translationBusy" :size="14" label="正在保存翻译设置" />{{ translationBusy ? '保存中…' : '保存设置' }}</button></div>
          <p v-if="translationError" class="sidebar-message error" role="alert">{{ translationError }}</p>
          <p v-else-if="translationNotice" class="sidebar-message" role="status">{{ translationNotice }}</p>
          <p v-if="!editor.desktop" class="translation-proxy-note">服务商密钥和代理配置需要在桌面应用中保存。</p>
        </form>
      </section>
      <section class="settings-card" aria-labelledby="guide-settings-title"><div class="settings-card-heading"><Compass :size="20" /><h2 id="guide-settings-title">使用引导</h2></div><div class="settings-row"><div><h3>启动引导</h3></div><button class="button" :disabled="navigation.blocked" @click="navigation.openGuide">查看启动引导</button></div></section>
      <section class="settings-card" aria-labelledby="about-title">
        <div class="settings-card-heading"><Settings :size="20" /><h2 id="about-title">关于</h2></div>
        <div class="settings-row"><div><h3>Pulsar</h3></div><span class="settings-version">版本 {{ packageInfo.version }}</span></div>
        <div class="settings-row"><div><h3>自动更新</h3><p>{{ autoUpdateMessage }}</p><p v-if="autoUpdateError" class="sidebar-message error" role="alert">{{ autoUpdateError }}</p></div><div v-if="editor.desktop" class="settings-actions"><button v-if="autoUpdate.status === 'downloaded'" class="button primary" :disabled="autoUpdateBusy" @click="installDownloadedUpdate">{{ autoUpdateBusy ? '正在重启…' : '立即重启并安装' }}</button><button v-else-if="autoUpdate.status === 'available' && autoUpdate.downloadUrl" class="button primary" @click="downloadMacUpdate">下载 macOS 更新</button><button v-else class="button" :disabled="autoUpdateBusy || ['disabled', 'checking', 'downloading'].includes(autoUpdate.status)" @click="checkForUpdates">{{ autoUpdateBusy || autoUpdate.status === 'checking' ? '正在检查…' : autoUpdate.status === 'downloading' ? '正在下载…' : '检查更新' }}</button></div></div>
        <div class="settings-row"><div><h3>运行方式</h3><p><Monitor :size="14" />{{ editor.desktop ? '桌面应用' : '浏览器预览' }}</p></div></div>
        <div v-if="buildInfo" class="settings-row"><div><h3>运行中的构建</h3><p>提交 {{ buildInfo.commit.slice(0, 12) }} · 源码指纹 {{ buildInfo.sourceFingerprint.slice(0, 12) }}</p></div></div>
      </section>
    </div>
  </main>
</template>
