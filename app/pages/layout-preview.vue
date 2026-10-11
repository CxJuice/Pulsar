<script setup lang="ts">
import type { UnwrapNestedRefs } from 'vue'
import type { FileInfo, ProjectInfo, StringItem, Suggestion } from '~/types/editor'

definePageMeta({ keepalive: false })

defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const previewReady = ref(false)
const editor = reactive(useEditor())

const project: ProjectInfo = { id: 4242, name: '右侧栏布局测试', source: 'en', dest: 'zh-CN' }
const file: FileInfo = {
  id: 42420, name: 'UI/Interface/Navigation.strings', project: project.id,
  total: 7, translated: 5, disputed: 1, checked: 2, reviewed: 1, hidden: 0, locked: 0, words: 126,
}
const strings: StringItem[] = ([
  ['NAV_HOME', 'Home', '主页'], ['NAV_SETTINGS', 'Settings', '设置'],
  ['NAV_BACK', 'Go back to the previous screen', '返回上一页'],
  ['NAV_CONTINUE', 'Continue to the next step', '继续下一步'],
  ['NAV_ACCOUNT', 'Manage your account and privacy settings', '管理账户和隐私设置'],
  ['NAV_SEARCH', 'Search for a project, file, or translated string', '搜索项目、文件或已翻译的字符串'],
  ['NAV_SYNC', 'Your changes are saved automatically when you move to another entry', '切换到其他词条时会自动保存更改'],
] as const).map(([key, original, translation], index) => ({
  id: 424200 + index, key, original, translation, stage: index < 5 ? 1 : 0,
  project: project.id, fileId: file.id, file: { id: file.id, name: file.name, project: project.id },
  context: 'Navigation screen · layout preview', words: original.split(/\s+/).length,
  createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
}))

const suggestions: Suggestion[] = ([
  ['NAV_MAIN_MENU', 'Main menu', '主菜单'], ['NAV_RETURN', 'Return to the previous screen', '返回上一个界面'],
  ['NAV_NEXT_STEP', 'Move on to the next step', '前往下一步'], ['NAV_ACCOUNT_SETTINGS', 'Account and privacy settings', '账户与隐私设置'],
  ['NAV_FIND_STRING', 'Find a project, file, or string', '查找项目、文件或词条'],
] as const).map(([key, original, translation], index) => ({
    id: 424300 + index, key, original, translation, matching: 0.9 - index * 0.07,
    localMatching: 0.9 - index * 0.07, project: { id: project.id, name: project.name },
    file: { id: file.id, name: file.name }, updatedAt: '2026-10-10T00:00:00.000Z',
  }))

onMounted(() => {
  if (!import.meta.dev) { void navigateTo('/', { replace: true }); return }
  editor.desktop = false
  editor.connected = false
  editor.initializing = false
  editor.workspaceReady = true
  editor.project = project
  editor.file = file
  editor.files = [file]
  editor.items = strings
  editor.selected = strings[5]!
  editor.text = strings[5]!.translation
  editor.editStage = 1
  editor.stageFilter = null
  editor.search = ''
  editor.page = 1
  editor.pageSize = 50
  editor.pageCount = 1
  editor.rowCount = strings.length
  editor.fileId = file.id
  editor.sort = 'default'
  editor.listBusy = false
  editor.error = ''
  editor.notice = ''
  editor.draftStatus = ''
  editor.panel = 'suggestions'
  editor.suggestions = suggestions
  editor.suggestionsBusy = false
  editor.suggestionsError = ''
  editor.terms = [
    { id: 1, term: 'account', translation: '账户', note: '界面中的用户账户', project: project.id },
    { id: 2, term: 'privacy', translation: '隐私', project: project.id },
    { id: 3, term: 'Search for a project, file, or translated string', translation: '搜索项目、文件或已翻译的字符串', project: project.id },
  ]
  editor.history = []
  editor.termsBusy = false
  editor.termsError = ''
  editor.historyBusy = false
  editor.historyError = ''
  previewReady.value = true
})
</script>

<template>
  <div class="editor-page layout-preview-page">
    <EditorWorkspace v-if="previewReady" :editor="editor" />
    <LoadingRegion v-else :busy="true" initial label="正在准备布局测试页…" />
  </div>
</template>
