<script setup lang="ts">
import { Check, Download, RefreshCw, X } from 'lucide-vue-next'
import type { AutoUpdateState } from '~/types/editor'

const notifiedVersionsKey = 'sckit-update-notified-versions'
const notice = ref<AutoUpdateState | null>(null)
const actionBusy = ref(false)
const actionError = ref('')
const dialogRoot = ref<HTMLElement>()
const notifiedVersions = new Set<string>()
let removeAutoUpdateListener: (() => void) | undefined
let previousFocus: HTMLElement | null = null

function readNotifiedVersions() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(notifiedVersionsKey) || '[]')
    if (Array.isArray(saved)) {
      for (const version of saved) if (typeof version === 'string' && version) notifiedVersions.add(version)
    }
  } catch { /* Keep the in-memory history if local storage is unavailable or invalid. */ }
}

function rememberVersion(version: string) {
  notifiedVersions.add(version)
  try { localStorage.setItem(notifiedVersionsKey, JSON.stringify([...notifiedVersions])) }
  catch { /* The version remains suppressed for this app session. */ }
}

function observeUpdate(state: AutoUpdateState) {
  if (!state.version) return
  if (notice.value?.version === state.version) notice.value = { ...state }
  if (!['available', 'downloaded'].includes(state.status) || notifiedVersions.has(state.version)) return
  rememberVersion(state.version)
  actionError.value = ''
  notice.value = { ...state }
}

function close() { notice.value = null }

async function downloadMacUpdate() {
  if (!window.scKit || !notice.value?.downloadUrl || actionBusy.value) return
  actionBusy.value = true
  actionError.value = ''
  try {
    await window.scKit.openExternal(notice.value.downloadUrl)
    close()
  } catch (reason) { actionError.value = (reason as Error).message || '无法打开 macOS 更新下载页' }
  finally { actionBusy.value = false }
}

async function installUpdate() {
  if (!window.scKit || actionBusy.value) return
  actionBusy.value = true
  actionError.value = ''
  try {
    const result = await window.scKit.installUpdate()
    if (!result.ok) actionError.value = result.message || '无法安装更新'
  } catch (reason) { actionError.value = (reason as Error).message || '无法安装更新' }
  finally { actionBusy.value = false }
}

function trapFocus(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); close(); return }
  if (event.key !== 'Tab') return
  const controls = [...(dialogRoot.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') || [])]
  const first = controls[0], last = controls.at(-1)
  if (!first) { event.preventDefault(); dialogRoot.value?.focus(); return }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

watch(() => !!notice.value, async opened => {
  if (opened) {
    previousFocus = document.activeElement as HTMLElement
    await nextTick()
    dialogRoot.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  } else if (previousFocus?.isConnected) {
    await nextTick()
    previousFocus.focus()
    previousFocus = null
  }
}, { flush: 'post' })

onMounted(() => {
  if (!window.scKit) return
  readNotifiedVersions()
  removeAutoUpdateListener = window.scKit.onAutoUpdateStatus(observeUpdate)
  void window.scKit.getAutoUpdateStatus().then(result => {
    if (result.ok && result.data) observeUpdate(result.data)
  }).catch(() => { /* Manual update checks remain available in Settings. */ })
})
onBeforeUnmount(() => { removeAutoUpdateListener?.() })

const isMacDownload = computed(() => notice.value?.status === 'available' && !!notice.value.downloadUrl)
const installReady = computed(() => notice.value?.status === 'downloaded')
const title = computed(() => installReady.value ? '更新已准备好' : isMacDownload.value ? '发现 macOS 新版本' : notice.value?.status === 'downloading' ? '正在下载更新' : '发现新版本')
const description = computed(() => {
  if (isMacDownload.value) return '请下载 DMG 并手动打开安装。安装前请保存当前工作。'
  if (installReady.value) return '新版本已下载完成，重启 Pulsar 即可安装更新。'
  if (notice.value?.status === 'downloading') return `Pulsar 正在后台下载新版本${notice.value.percent ? `，已完成 ${notice.value.percent}%` : ''}。下载完成后即可安装。`
  return 'Pulsar 正在后台准备新版本，下载完成后即可安装。'
})
</script>

<template>
  <Transition name="dialog">
    <div v-if="notice" class="modal-backdrop update-notice-backdrop" @click.self="close">
      <section ref="dialogRoot" class="info-dialog update-notice-dialog" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="update-notice-title" @keydown="trapFocus">
        <button class="icon-button modal-close" aria-label="关闭更新提示" @click="close"><X :size="18" /></button>
        <div class="connection-mark update-notice-mark">
          <Check v-if="installReady" :size="25" />
          <Download v-else-if="isMacDownload" :size="25" />
          <RefreshCw v-else :size="24" :class="{ spin: notice.status === 'downloading' }" />
        </div>
        <h2 id="update-notice-title">{{ title }}</h2>
        <p class="dialog-description">{{ description }}</p>
        <div v-if="notice.status === 'downloading'" class="update-notice-progress" role="progressbar" :aria-valuenow="notice.percent" aria-valuemin="0" aria-valuemax="100">
          <span :style="{ width: `${notice.percent}%` }"></span>
        </div>
        <p class="update-notice-version">版本 {{ notice.version }}</p>
        <p v-if="actionError" class="form-error update-notice-error" role="alert">{{ actionError }}</p>
        <div class="update-notice-actions">
          <button v-if="isMacDownload || installReady" class="button" :disabled="actionBusy" @click="close">稍后</button>
          <button v-if="isMacDownload" class="button primary" :disabled="actionBusy" @click="downloadMacUpdate"><Download :size="14" />下载更新</button>
          <button v-else-if="installReady" class="button primary" :disabled="actionBusy" @click="installUpdate">{{ actionBusy ? '正在重启…' : '立即重启并安装' }}</button>
          <button v-else class="button primary" :disabled="actionBusy" @click="close">知道了</button>
        </div>
      </section>
    </div>
  </Transition>
</template>
