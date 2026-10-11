<script setup lang="ts">
import { ArrowLeft, Sun, Moon, Check, Link, ExternalLink, Settings, Monitor, Compass, Languages } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { WorkspaceNavigation } from '~/composables/useWorkspaceNavigation'
import type { LocalFontData, TranslationMode, TranslationProvider, TranslationProxyMode, TranslationSettings, TranslationSettingsUpdate } from '~/types/editor'
import { appearanceStorageKey, cssFontFamily, defaultAccentColors, defaultAppearanceSettings, defaultFontFamily, safeFontFamily } from '~/utils/appearance'
import type { AppearanceSettings, AppearanceTextRegion, AppearanceTheme } from '~/utils/appearance'
import packageInfo from '../../package.json'

const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const navigation = inject<WorkspaceNavigation>('workspace-navigation')!
const theme = inject<Ref<string>>('workspace-theme')!
const translationLayout = inject<Ref<'horizontal' | 'vertical'>>('workspace-translation-layout')!
const appearance = inject<Ref<AppearanceSettings>>('workspace-appearance')!
const appearanceError = ref('')
const systemFonts = ref<string[]>([]), systemFontsBusy = ref(false), systemFontsError = ref(false), systemFontsMessage = ref('')
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
const defaultBackgroundColor = computed(() => theme.value === 'dark' ? '#202128' : '#ffffff')
const translationConfig = reactive({ provider: 'google' as TranslationProvider, mode: 'web' as TranslationMode, deeplPlan: 'free' as 'free' | 'pro', proxyMode: 'system' as TranslationProxyMode, proxyHost: '127.0.0.1', proxyPort: 7890, googleConfigured: false, deeplConfigured: false })
const googleApiKey = ref(''), deeplApiKey = ref(''), clearGoogleApiKey = ref(false), clearDeepLApiKey = ref(false)
const translationBusy = ref(false), translationError = ref(''), translationNotice = ref('')
const accountName = computed(() => props.editor.sessionInfo.user?.nickname || props.editor.sessionInfo.user?.username)
const connectionStatus = computed(() => props.editor.initializing ? '正在恢复登录…' : props.editor.connected ? props.editor.sessionInfo.authenticated ? '已连接 ParaTranz' : '登录已过期' : '未连接')
function openAccount() { window.scKit?.openExternal('https://paratranz.cn/users/my') }
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
function saveAppearance() {
  appearanceError.value = ''
  try { localStorage.setItem(appearanceStorageKey, JSON.stringify(appearance.value)) }
  catch { appearanceError.value = '设置已应用，但无法保存到本设备。' }
}
function setAppearanceColor(key: 'backgroundColor', event: Event) {
  const value = (event.target as HTMLInputElement).value
  appearance.value[key] = /^#[\da-f]{6}$/i.test(value) ? value : null
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
}
async function loadTranslationSettings() {
  if (!window.scKit) return
  translationBusy.value = true
  try {
    const result = await window.scKit.getTranslationSettings()
    if (!result.ok || !result.data) throw new Error(result.message || '无法读取翻译设置')
    applyTranslationSettings(result.data)
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
    proxy: { mode: translationConfig.proxyMode, host: translationConfig.proxyHost.trim(), port: Number(translationConfig.proxyPort) },
    ...(googleApiKey.value.trim() ? { googleApiKey: googleApiKey.value.trim() } : clearGoogleApiKey.value ? { clearGoogleApiKey: true } : {}),
    ...(deeplApiKey.value.trim() ? { deeplApiKey: deeplApiKey.value.trim() } : clearDeepLApiKey.value ? { clearDeepLApiKey: true } : {}),
  }
  try {
    const result = await window.scKit.saveTranslationSettings(update)
    if (!result.ok || !result.data) throw new Error(result.message || '保存翻译设置失败')
    applyTranslationSettings(result.data)
    window.dispatchEvent(new CustomEvent('sckit:translation-settings-updated', { detail: result.data }))
    googleApiKey.value = ''; deeplApiKey.value = ''; clearGoogleApiKey.value = false; clearDeepLApiKey.value = false
    translationNotice.value = '翻译服务设置已保存。'
  } catch (reason) { translationError.value = (reason as Error).message || '保存翻译设置失败' }
  finally { translationBusy.value = false }
}
onMounted(() => {
  theme.value = localStorage.getItem('sckit-theme') || 'light'
  try {
    const savedLayout = localStorage.getItem('sckit-translation-layout')
    if (savedLayout === 'horizontal' || savedLayout === 'vertical') translationLayout.value = savedLayout
  } catch { /* Keep the default layout when storage is unavailable. */ }
  void loadTranslationSettings()
})
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
        <div class="settings-row appearance-color-row"><div><h3>背景色</h3><p>更改后会自动调整文字、面板和边框颜色。</p></div><label class="appearance-color-control"><input aria-label="背景色" type="color" :value="appearance.backgroundColor || defaultBackgroundColor" @input="setAppearanceColor('backgroundColor', $event)" /><span>{{ appearance.backgroundColor || '跟随主题默认色' }}</span></label></div>
        <div class="settings-row"><div><h3>中间栏原文和译文</h3><p>设置待翻译字符串列表中的排列方式。</p></div><div class="layout-choices" role="radiogroup" aria-label="中间栏原文和译文排列方式" @keydown="layoutKeydown"><button class="layout-choice" :class="{ selected: translationLayout === 'horizontal' }" role="radio" :aria-checked="translationLayout === 'horizontal'" :tabindex="translationLayout === 'horizontal' ? 0 : -1" @click="setTranslationLayout('horizontal')"><span>左右排列</span><Check v-if="translationLayout === 'horizontal'" :size="14" /></button><button class="layout-choice" :class="{ selected: translationLayout === 'vertical' }" role="radio" :aria-checked="translationLayout === 'vertical'" :tabindex="translationLayout === 'vertical' ? 0 : -1" @click="setTranslationLayout('vertical')"><span>上下排列</span><Check v-if="translationLayout === 'vertical'" :size="14" /></button></div></div>
        <div class="appearance-typography-heading"><div><h3>字体与字号</h3><p>留空时继承“界面默认”；可读取系统字体后搜索选择。</p></div><div class="appearance-typography-actions"><button class="text-button" type="button" :disabled="systemFontsBusy" @click="loadSystemFonts"><LoadingIndicator v-if="systemFontsBusy" :size="13" label="正在读取系统字体" />{{ systemFontsBusy ? '读取中…' : systemFonts.length ? `刷新系统字体（${systemFonts.length}）` : '读取系统字体' }}</button><button class="text-button" type="button" @click="resetAppearance">恢复外观默认值</button></div></div>
        <p v-if="systemFontsMessage" class="appearance-font-status" :class="{ error: systemFontsError }" role="status">{{ systemFontsMessage }}</p>
        <datalist id="appearance-font-suggestions"><option value="Inter, Segoe UI, sans-serif" /><option value="Microsoft YaHei UI, Microsoft YaHei, sans-serif" /><option value="Arial, sans-serif" /><option value="Consolas, monospace" /><option v-for="font in systemFonts" :key="font" :value="font" /></datalist>
        <div class="appearance-typography-grid">
          <div v-for="region in typographyRegions" :key="region.key" class="appearance-typography-row">
            <strong>{{ region.title }}</strong>
            <label><span>字体</span><input :value="fontFamilyInput(region.key)" :style="{ fontFamily: fontFamilyPreview(region.key) }" list="appearance-font-suggestions" :placeholder="region.key === 'ui' ? '系统默认字体' : '继承界面默认'" autocomplete="off" @input="setFontFamily(region.key, $event)" /></label>
            <label><span>字号</span><input :value="appearance.typography[region.key].fontSize ?? ''" type="number" :min="region.key === 'ui' ? 10 : 8" :max="region.key === 'ui' ? 32 : 48" step="1" :placeholder="region.key === 'ui' ? '13' : '继承'" @change="setFontSize(region.key, $event)" /><small>px</small></label>
          </div>
        </div>
        <p v-if="appearanceError" class="sidebar-message error" role="alert">{{ appearanceError }}</p>
      </section>
      <section class="settings-card" aria-labelledby="connection-settings-title">
        <div class="settings-card-heading"><Link :size="20" /><h2 id="connection-settings-title">ParaTranz 连接</h2></div>
        <div class="settings-row"><div><h3 class="settings-connection-status"><span class="online-dot" :class="{ offline: !editor.connected || !editor.sessionInfo.authenticated }"></span><LoadingIndicator v-if="editor.initializing || navigation.busy" :size="14" label="正在更新连接" />{{ connectionStatus }}</h3><p v-if="editor.connected">{{ accountName ? `${accountName} · ` : '' }}{{ editor.sessionInfo.mode === 'token' ? 'API Token（备选）' : '网页登录'  }}</p></div><div class="settings-actions"><button class="button" :class="{ primary: !editor.connected || !editor.sessionInfo.authenticated }" :disabled="navigation.blocked" @click="navigation.showConnection = true">{{ editor.connected && editor.sessionInfo.authenticated ? '更换连接' : editor.connected ? '重新登录' : '连接 ParaTranz' }}</button><button v-if="editor.connected" class="button" :disabled="navigation.blocked" @click="navigation.disconnect">断开连接</button></div></div>
        <div v-if="editor.connected" class="settings-row"><div><h3>词条占用同步</h3><p v-if="editor.sessionInfo.mode === 'token'">需同账号网页登录。</p></div><button class="button" :disabled="editor.presenceLoginBusy || navigation.blocked" @click="editor.loginPresence()"><LoadingIndicator v-if="editor.presenceLoginBusy" :size="14" label="正在登录占用会话" />{{ editor.presenceLoginBusy ? '正在登录…' : '网页登录' }}</button></div>
        <div class="settings-row"><div><h3>ParaTranz 个人设置</h3></div><button class="button" :disabled="!editor.desktop" @click="openAccount">打开个人设置 <ExternalLink :size="14" /></button></div>
      </section>
      <section class="settings-card" aria-labelledby="translation-settings-title">
        <div class="settings-card-heading"><Languages :size="20" /><h2 id="translation-settings-title">翻译服务</h2></div>
        <p class="translation-settings-intro">选择右侧翻译模块的服务商和使用方式，默认翻译方向为英语 → 简体中文。网页版会在右侧面板内显示；API 密钥加密保存在本机，输入框留空会保留已保存的密钥。</p>
        <form class="translation-settings-form" @submit.prevent="saveTranslationSettings">
          <div class="translation-settings-grid">
            <label>默认服务商<select v-model="translationConfig.provider" :disabled="translationBusy || !editor.desktop"><option value="google">Google 翻译</option><option value="deepl">DeepL</option></select></label>
            <label>使用方式<select v-model="translationConfig.mode" :disabled="translationBusy || !editor.desktop"><option value="web">网页版（嵌入右侧栏）</option><option value="api">API</option></select></label>
            <label v-if="translationConfig.provider === 'deepl' && translationConfig.mode === 'api'">DeepL API 计划<select v-model="translationConfig.deeplPlan" :disabled="translationBusy || !editor.desktop"><option value="free">API Free</option><option value="pro">API Pro</option></select></label>
            <label>代理<select v-model="translationConfig.proxyMode" :disabled="translationBusy || !editor.desktop"><option value="system">系统代理</option><option value="direct">不使用代理</option><option value="http">HTTP 代理</option><option value="socks5">SOCKS5 代理</option></select></label>
            <label v-if="['http', 'socks5'].includes(translationConfig.proxyMode)">代理主机<input v-model="translationConfig.proxyHost" :disabled="translationBusy || !editor.desktop" placeholder="127.0.0.1" autocomplete="off" /></label>
            <label v-if="['http', 'socks5'].includes(translationConfig.proxyMode)">代理端口<input v-model.number="translationConfig.proxyPort" :disabled="translationBusy || !editor.desktop" type="number" min="1" max="65535" placeholder="7890" /></label>
          </div>
          <p class="translation-proxy-note">代理设置用于内嵌翻译网页和 API 请求；系统代理会使用系统配置。</p>
          <div class="translation-key-grid">
            <div class="translation-key-field"><label for="google-translation-key">Google Cloud Translation API Key</label><input id="google-translation-key" v-model="googleApiKey" :disabled="translationBusy || !editor.desktop" type="password" autocomplete="new-password" spellcheck="false" :placeholder="translationConfig.googleConfigured ? '已保存，输入新密钥可替换' : '输入 API 密钥'" @input="clearGoogleApiKey = false" /><small>{{ translationConfig.googleConfigured ? '已有密钥安全保存在本机' : '尚未配置' }}</small><label v-if="translationConfig.googleConfigured" class="translation-key-clear"><input v-model="clearGoogleApiKey" :disabled="translationBusy" type="checkbox" />清除已保存的 Google 密钥</label></div>
            <div class="translation-key-field"><label for="deepl-translation-key">DeepL API Key</label><input id="deepl-translation-key" v-model="deeplApiKey" :disabled="translationBusy || !editor.desktop" type="password" autocomplete="new-password" spellcheck="false" :placeholder="translationConfig.deeplConfigured ? '已保存，输入新密钥可替换' : '输入 API 密钥'" @input="clearDeepLApiKey = false" /><small>{{ translationConfig.deeplConfigured ? '已有密钥安全保存在本机' : '尚未配置' }}</small><label v-if="translationConfig.deeplConfigured" class="translation-key-clear"><input v-model="clearDeepLApiKey" :disabled="translationBusy" type="checkbox" />清除已保存的 DeepL 密钥</label></div>
          </div>
          <div class="translation-settings-actions"><button class="button primary" :disabled="translationBusy || !editor.desktop" type="submit"><LoadingIndicator v-if="translationBusy" :size="14" label="正在保存翻译设置" />{{ translationBusy ? '保存中…' : '保存翻译设置' }}</button></div>
          <p v-if="translationError" class="sidebar-message error" role="alert">{{ translationError }}</p>
          <p v-else-if="translationNotice" class="sidebar-message" role="status">{{ translationNotice }}</p>
          <p v-if="!editor.desktop" class="translation-proxy-note">服务商密钥和代理配置需要在桌面应用中保存。</p>
        </form>
      </section>
      <section class="settings-card" aria-labelledby="guide-settings-title"><div class="settings-card-heading"><Compass :size="20" /><h2 id="guide-settings-title">使用引导</h2></div><div class="settings-row"><div><h3>启动引导</h3></div><button class="button" :disabled="navigation.blocked" @click="navigation.openGuide">查看启动引导</button></div></section>
      <section class="settings-card" aria-labelledby="about-title">
        <div class="settings-card-heading"><Settings :size="20" /><h2 id="about-title">关于</h2></div>
        <div class="settings-row"><div><h3>ScTranslateKit</h3></div><span class="settings-version">版本 {{ packageInfo.version }}</span></div>
        <div class="settings-row"><div><h3>运行方式</h3><p><Monitor :size="14" />{{ editor.desktop ? '桌面应用' : '浏览器预览' }}</p></div></div>
      </section>
    </div>
  </main>
</template>
