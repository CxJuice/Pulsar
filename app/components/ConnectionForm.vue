<script setup lang="ts">
import { ExternalLink, KeyRound, ArrowRight, ChevronDown } from 'lucide-vue-next'
import type { SessionStatus } from '~/types/editor'
const props = withDefaults(defineProps<{ desktop: boolean; disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{ connected: [session: SessionStatus]; pending: [value: boolean] }>()
const methodInFlight = ref<'token' | 'login'>('login')
const token = ref(''), remember = ref(false), busy = ref(false), error = ref(''), showToken = ref(false)
const tokenId = useId(), primaryButton = ref<HTMLButtonElement>()
const blocked = computed(() => props.disabled || busy.value || !props.desktop)
function setBusy(value: boolean) { busy.value = value; emit('pending', value) }
function openTokenPage() { window.scKit?.openExternal('https://paratranz.cn/users/my') }
async function connect(method: 'token' | 'login') {
  if (blocked.value || (method === 'token' && !token.value.trim())) return
  methodInFlight.value = method; error.value = ''; setBusy(true)
  try {
    if (!window.scKit) throw new Error('请使用桌面应用登录 ParaTranz')
    const result = method === 'token'
      ? await window.scKit.connect(token.value.trim(), remember.value, 0)
      : await window.scKit.login(0)
    if (!result.ok || !result.data?.authenticated) throw new Error(result.message || '登录未完成，请重试')
    token.value = ''; setBusy(false); emit('connected', result.data)
  } catch (reason) { error.value = (reason as Error).message }
  finally { setBusy(false) }
}
defineExpose({ focus: () => primaryButton.value?.focus() })
</script>
<template>
  <div class="connection-form" :aria-busy="busy">
    <div class="web-login-heading"><strong>网页登录</strong><span>推荐</span></div>
    
    <button ref="primaryButton" type="button" class="button primary login-button" :disabled="blocked" @click="connect('login')"><LoadingIndicator v-if="busy && methodInFlight === 'login'" :size="17" label="正在登录 ParaTranz" /><ExternalLink v-else :size="17" />{{ busy && methodInFlight === 'login' ? '等待网页登录…' : '登录 ParaTranz' }}<ArrowRight :size="17" /></button>
    <p v-if="busy && methodInFlight === 'login'" class="connection-progress-hint subtle" role="status">请在登录窗口完成登录。</p>
    <p class="connection-method-description">网页登录状态会保存在本机，重新打开应用时会自动恢复；主动断开连接或会话过期后需要重新登录。</p>
    <MotionFolder class="token-fallback" :open="showToken" :disabled="busy" title="API Token 备选登录" @toggle="showToken = !showToken">
      <template #heading><KeyRound :size="15" /><span>使用 API Token</span><small>备选登录</small><ChevronDown :size="15" :class="{ expanded: showToken }" /></template>
      <div class="token-fallback-content">
        <p class="connection-method-description">词条占用需同账号网页登录。</p>
        <label class="field-label" :for="tokenId">API Token</label>
        <input :id="tokenId" v-model="token" class="form-input" type="password" placeholder="粘贴 ParaTranz API Token" autocomplete="off" :disabled="blocked" @keydown.enter.prevent="connect('token')" />
        <div class="token-options"><label><input v-model="remember" type="checkbox" :disabled="blocked" /> 在此设备上记住 Token</label><button type="button" class="text-button" :disabled="blocked" @click="openTokenPage">获取 Token <ExternalLink :size="12" /></button></div>
        <button type="button" class="button token-connect" :disabled="blocked || !token.trim()" @click="connect('token')"><LoadingIndicator v-if="busy && methodInFlight === 'token'" :size="16" label="正在验证 Token" />{{ busy && methodInFlight === 'token' ? '正在验证…' : '使用 Token 登录' }}</button>
        
      </div>
    </MotionFolder>
    <p v-if="!desktop" class="browser-note">请在桌面应用中登录 ParaTranz。</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </div>
</template>
