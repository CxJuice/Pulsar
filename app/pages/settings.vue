<script setup lang="ts">
import { ArrowLeft, Sun, Moon, Check, Link, ExternalLink, Settings, Monitor, Compass } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { WorkspaceNavigation } from '~/composables/useWorkspaceNavigation'
import packageInfo from '../../package.json'

const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const navigation = inject<WorkspaceNavigation>('workspace-navigation')!
const theme = inject<Ref<string>>('workspace-theme')!
const appearanceError = ref('')
const accountName = computed(() => props.editor.sessionInfo.user?.nickname || props.editor.sessionInfo.user?.username)
const connectionStatus = computed(() => props.editor.initializing ? '正在恢复登录…' : props.editor.connected ? props.editor.sessionInfo.authenticated ? '已连接 ParaTranz' : '登录已过期' : '未连接')
function openAccount() { window.scKit?.openExternal('https://paratranz.cn/users/my') }
function setTheme(value: 'light' | 'dark') {
  theme.value = value; appearanceError.value = ''
  try { localStorage.setItem('sckit-theme', value) }
  catch { appearanceError.value = '主题已应用，但无法保存到本设备。' }
}
function themeKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  setTheme(theme.value === 'light' ? 'dark' : 'light')
  nextTick(() => document.querySelector<HTMLButtonElement>('.theme-choice[aria-checked="true"]')?.focus())
}
</script>
<template>
  <main class="settings-page" aria-label="应用设置">
    <header class="settings-header"><div><h1>设置</h1></div><button class="button" :disabled="navigation.blocked" @click="navigation.goHome"><ArrowLeft :size="15" />返回主页</button></header>
    <div class="settings-content">
      <div v-if="navigation.error" class="sidebar-message error" role="alert">{{ navigation.error }}</div>
      <section class="settings-card" aria-labelledby="appearance-title">
        <div class="settings-card-heading"><Sun :size="20" /><h2 id="appearance-title">外观</h2></div>
        <div class="settings-row"><div><h3>主题</h3></div><div class="theme-choices" role="radiogroup" aria-label="工作台主题" @keydown="themeKeydown"><button class="theme-choice" :class="{ selected: theme === 'light' }" role="radio" :aria-checked="theme === 'light'" :tabindex="theme === 'light' ? 0 : -1" @click="setTheme('light')"><Sun :size="17" /><span>浅色</span><Check v-if="theme === 'light'" :size="14" /></button><button class="theme-choice" :class="{ selected: theme === 'dark' }" role="radio" :aria-checked="theme === 'dark'" :tabindex="theme === 'dark' ? 0 : -1" @click="setTheme('dark')"><Moon :size="17" /><span>深色</span><Check v-if="theme === 'dark'" :size="14" /></button></div></div>
        <p v-if="appearanceError" class="sidebar-message error" role="alert">{{ appearanceError }}</p>
      </section>
      <section class="settings-card" aria-labelledby="connection-settings-title">
        <div class="settings-card-heading"><Link :size="20" /><h2 id="connection-settings-title">ParaTranz 连接</h2></div>
        <div class="settings-row"><div><h3 class="settings-connection-status"><span class="online-dot" :class="{ offline: !editor.connected || !editor.sessionInfo.authenticated }"></span><LoadingIndicator v-if="editor.initializing || navigation.busy" :size="14" label="正在更新连接" />{{ connectionStatus }}</h3><p v-if="editor.connected">{{ accountName ? `${accountName} · ` : '' }}{{ editor.sessionInfo.mode === 'token' ? 'API Token（备选）' : '网页登录'  }}</p></div><div class="settings-actions"><button class="button" :class="{ primary: !editor.connected || !editor.sessionInfo.authenticated }" :disabled="navigation.blocked" @click="navigation.showConnection = true">{{ editor.connected && editor.sessionInfo.authenticated ? '更换连接' : editor.connected ? '重新登录' : '连接 ParaTranz' }}</button><button v-if="editor.connected" class="button" :disabled="navigation.blocked" @click="navigation.disconnect">断开连接</button></div></div>
        <div v-if="editor.connected" class="settings-row"><div><h3>词条占用同步</h3><p v-if="editor.sessionInfo.mode === 'token'">需同账号网页登录。</p></div><button class="button" :disabled="editor.presenceLoginBusy || navigation.blocked" @click="editor.loginPresence()"><LoadingIndicator v-if="editor.presenceLoginBusy" :size="14" label="正在登录占用会话" />{{ editor.presenceLoginBusy ? '正在登录…' : '网页登录' }}</button></div>
        <div class="settings-row"><div><h3>ParaTranz 个人设置</h3></div><button class="button" :disabled="!editor.desktop" @click="openAccount">打开个人设置 <ExternalLink :size="14" /></button></div>
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
