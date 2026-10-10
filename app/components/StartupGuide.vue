<script setup lang="ts">
import { ArrowRight, FolderOpen, TextCursorInput, Users, CheckCircle2 } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { WorkspaceNavigation } from '~/composables/useWorkspaceNavigation'
defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const navigation = inject<WorkspaceNavigation>('workspace-navigation')!
</script>
<template>
  <main class="startup-guide" aria-label="启动引导">
    <div class="guide-layout">
      <section class="guide-introduction">
        <span class="guide-eyebrow">ScTranslateKit</span>
        <h1>开始你的翻译工作</h1>
        
        <div class="guide-features">
          <article><FolderOpen :size="21" /><h2>项目与文件</h2></article>
          <article><TextCursorInput :size="21" /><h2>翻译建议与术语</h2></article>
          <article><Users :size="21" /><h2>词条占用</h2></article>
        </div>
      </section>
      <section class="guide-login-card" aria-label="开始使用">
        <p v-if="navigation.error || editor.error" class="form-error" role="alert">{{ navigation.error || editor.error }}</p>
        <template v-if="editor.connected && editor.sessionInfo.authenticated">
          <CheckCircle2 class="guide-connected-icon" :size="36" /><h2>已登录 ParaTranz</h2>
          <p v-if="editor.sessionInfo.user?.nickname || editor.sessionInfo.user?.username" class="connection-method-description">{{ editor.sessionInfo.user?.nickname || editor.sessionInfo.user?.username }}</p>
          <p v-if="editor.sessionInfo.mode === 'token'" class="connection-method-description">API Token（备选）</p>
          <button v-if="editor.sessionInfo.mode === 'token'" class="button primary guide-continue" :disabled="navigation.blocked" @click="navigation.showConnection = true">改用网页登录 <ArrowRight :size="16" /></button>
          <button class="button guide-continue" :class="{ primary: editor.sessionInfo.mode !== 'token' }" :disabled="navigation.blocked" @click="navigation.finishGuide()">选择项目和文件 <ArrowRight :size="16" /></button>
        </template>
        <template v-else>
          <ConnectionForm :desktop="editor.desktop" :disabled="navigation.blocked" @pending="value => navigation.loginBusy = value" @connected="session => navigation.connected(0, 0, session)" />
        </template>
      </section>
    </div>
    
  </main>
</template>
