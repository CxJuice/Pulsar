<script setup lang="ts">
import { Search, RefreshCw, FolderOpen, FolderClosed, ChevronsDown, ChevronsUp, FileText, ChevronRight, Pencil, ExternalLink, ArrowRight, Check } from 'lucide-vue-next'
import type { UnwrapNestedRefs } from 'vue'
import type { useEditor } from '~/composables/useEditor'
import type { FileInfo, ProjectInfo } from '~/types/editor'
import { fileCompletionPercent } from '~/utils/fileSort'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const emit = defineEmits<{ close: []; connect: []; pending: [value: boolean] }>()
const root = ref<HTMLElement>()
const navigation = inject<import('~/composables/useWorkspaceNavigation').WorkspaceNavigation>('workspace-navigation')!
let active = true
const positions = new Map<number, number>()
function rememberScroll(id = navigation.browse.id) { positions.set(id, root.value?.querySelector('.manager-files')?.scrollTop || 0) }
function restoreScroll() { nextTick(() => root.value?.querySelector('.manager-files')?.scrollTo({ top: positions.get(navigation.browse.id) || 0 })) }
onBeforeRouteLeave(() => { rememberScroll(); return true })
onActivated(() => { active = true; restoreScroll() })
onDeactivated(() => { active = false })
const pageLoading = inject<import('vue').ComputedRef<boolean>>('workspace-loading', computed(() => false))
const { projectChosen, projects, browse, files, busy, saving, error, notice, fileSearch, fileGroups } = toRefs(navigation)
const { folderOpen, toggleFolder, expandFolders, collapseFolders, chooseFile } = navigation
function inspectProject(id: number) { return navigation.inspectProject(id, true) }
const editProject = ref(false), editFile = ref<FileInfo | null>(null), name = ref(''), description = ref('')
const canManage = computed(() => props.editor.connected && props.editor.sessionInfo.authenticated && (projects.value.find(entry => entry.id === browse.value.id)?.permission || 0) >= 3)
const folderCount = computed(() => fileGroups.value.filter(([folder]) => folder !== '').length)
const allFoldersExpanded = computed(() => fileGroups.value.filter(([folder]) => folder !== '').every(([folder]) => folderOpen(folder)))
const anyFolderExpanded = computed(() => fileGroups.value.some(([folder]) => folder !== '' && folderOpen(folder)))
const totals = computed(() => files.value.reduce((sum, file) => ({ total: sum.total + file.total, translated: sum.translated + file.translated }), { total: 0, translated: 0 }))
function progress(file: FileInfo) { return fileCompletionPercent(file) }
function baseName(path: string) { return path.slice(path.lastIndexOf('/') + 1) }
function beginProjectEdit() { editFile.value = null; editProject.value = true; name.value = browse.value.name; description.value = browse.value.desc || ''; error.value = ''; notice.value = '' }
function beginFileEdit(file: FileInfo) { editProject.value = false; editFile.value = file; name.value = file.name; error.value = ''; notice.value = '' }
function cancelEdit() { if (!saving.value) { editProject.value = false; editFile.value = null } }
async function saveDetails() {
  if (saving.value || !name.value.trim() || !canManage.value) return
  saving.value = true; error.value = ''; notice.value = ''
  try {
    const e = props.editor, projectId = browse.value.id
    if (editFile.value) {
      const file = editFile.value
      const saved = await e.api<FileInfo>('renameFile', { projectId, fileId: file.id, name: name.value, expectedName: file.name })
      files.value = files.value.map(entry => entry.id === saved.id ? saved : entry)
      if (e.project.id === projectId) { e.files = e.files.map(entry => entry.id === saved.id ? saved : entry); if (e.fileId === saved.id) e.file = saved }
    } else {
      const saved = await e.api<ProjectInfo>('updateProject', { projectId, name: name.value, desc: description.value, expectedName: browse.value.name, expectedDesc: browse.value.desc || '' })
      browse.value = saved; projects.value = projects.value.map(entry => entry.id === projectId ? { ...entry, name: saved.name } : entry)
      if (e.project.id === projectId) e.project = saved
    }
    notice.value = '修改已保存至 ParaTranz'
    editProject.value = false; editFile.value = null
  } catch (reason) { error.value = (reason as Error).message }
  finally { saving.value = false }
}
function external(kind: 'project' | 'file', file?: FileInfo) { window.scKit?.openExternal(`https://paratranz.cn/projects/${browse.value.id}/${kind === 'file' ? `strings?file=${file!.id}` : ''}`) }
watch(saving, value => emit('pending', value))
watch(() => browse.value.id, (_id, old) => { if (active) { rememberScroll(old); restoreScroll() } cancelEdit(); notice.value = '' })
</script>
<template>
  <section ref="root" class="project-manager" aria-label="项目与文件管理" @keydown.ctrl.s.prevent.stop="(editFile || editProject) && saveDetails()">
    <header class="manager-header"><div><h1>项目主页</h1></div><div class="manager-header-actions"><span class="manager-session"><span class="online-dot" :class="{ offline: !editor.connected }"></span>{{ editor.initializing ? '正在恢复登录…' : editor.connected ? (editor.sessionInfo.authenticated ? '已连接 ParaTranz' : '登录已过期') : '未连接' }}</span><button v-if="editor.workspaceReady" class="button" :disabled="navigation.blocked" @click="emit('close')"><ArrowRight :size="16" />继续翻译</button><button v-if="!editor.connected" class="button primary" :disabled="editor.initializing" @click="emit('connect')">连接 ParaTranz</button></div></header>
    <div class="manager-body">
      <main class="manager-files" aria-label="项目文件管理" :aria-busy="busy || saving">
        
        <div v-if="error" class="sidebar-message error" role="alert">{{ error }}</div><div v-if="notice" class="sidebar-message" role="status"><Check :size="14" />{{ notice }}</div>
        <div v-if="editor.error" class="sidebar-message error" role="alert">{{ editor.error }}</div>
        <Transition name="panel" mode="out-in"><div v-if="!projectChosen" key="welcome" class="manager-welcome" :class="{ 'manager-welcome-loading': pageLoading }" :aria-hidden="pageLoading || undefined"><FolderOpen :size="48" :stroke-width="1.2" /><h2>选择一个项目</h2></div>
        
        <div v-else :key="browse.id" class="manager-project-content">
        
        <div class="sidebar-project-summary"><div class="manager-project-heading"><h2>{{ browse.name }}</h2><div><button class="button compact" :disabled="busy || saving || !canManage" :title="canManage ? '修改项目名称与说明' : '需要项目管理员权限'" @click="beginProjectEdit"><Pencil :size="14" />修改项目资料</button><button class="button compact" aria-label="在 ParaTranz 查看项目" :disabled="!editor.desktop" @click="external('project')"><ExternalLink :size="13" />ParaTranz</button></div></div><div><span>#{{ browse.id }} · {{ browse.source }} → {{ browse.dest }}</span></div><p v-if="browse.desc">{{ browse.desc }}</p><div class="sidebar-project-totals"><span><strong>{{ files.length.toLocaleString() }}</strong> 个文件</span><span><strong>{{ totals.total.toLocaleString() }}</strong> 条词条</span><span><strong>{{ totals.translated.toLocaleString() }}</strong> 已翻译</span></div></div>
        <Transition name="panel"><form v-if="editProject || editFile" class="sidebar-edit" @submit.prevent="saveDetails"><strong>{{ editFile ? '重命名 / 移动文件' : '修改项目资料' }}</strong><label for="sidebar-edit-name">{{ editFile ? '完整文件路径（使用 / 分隔）' : '项目名称' }}</label><input id="sidebar-edit-name" v-model="name" :disabled="saving" required :maxlength="editFile ? 1000 : 500" /><template v-if="editProject"><label for="sidebar-project-desc">项目说明</label><textarea id="sidebar-project-desc" v-model="description" :disabled="saving" rows="4" maxlength="50000" /></template><div><button type="button" class="button compact" :disabled="saving" @click="cancelEdit">取消</button><button class="button compact primary" :disabled="saving || !name.trim()"><LoadingIndicator v-if="saving" :size="13" label="正在保存项目资料" />{{ saving ? '保存中…' : '保存修改' }}</button></div></form></Transition>
        <div class="manager-files-heading"><div><h3>项目文件</h3></div><span>{{ files.length }} 个文件</span></div>
        <div class="manager-file-toolbar"><label class="sidebar-search"><Search :size="14" /><input id="manager-file-search" v-model="fileSearch" placeholder="搜索文件名或目录" aria-label="搜索项目文件" /></label><button class="button compact" aria-label="刷新项目文件" :disabled="editor.initializing || busy || saving" @click="inspectProject(browse.id)"><RefreshCw :size="14" :class="{ spin: busy }" />刷新</button><button class="button compact" :disabled="!folderCount || allFoldersExpanded || !!fileSearch.trim()" @click="expandFolders"><ChevronsDown :size="14" />展开文件夹</button><button class="button compact" :disabled="!folderCount || !anyFolderExpanded || !!fileSearch.trim()" @click="collapseFolders"><ChevronsUp :size="14" />折叠文件夹</button></div>
        
        <div class="sidebar-file-groups"><MotionFolder v-for="[folder, entries] in fileGroups" :key="folder" :open="folderOpen(folder)" :class="{ 'root-file-group': folder === '' }" :title="fileSearch.trim() ? '搜索结果保持展开' : `${folderOpen(folder) ? '收起' : '展开'} ${folder || '项目根目录'}`" @toggle="toggleFolder(folder)"><template #heading><ChevronRight class="folder-chevron" :class="{ expanded: folderOpen(folder) }" :size="16" /><FolderOpen v-if="folderOpen(folder)" :size="17" /><FolderClosed v-else :size="17" /><span>{{ folder || '项目根目录' }}<small v-if="folder === ''" class="root-directory-label">根目录</small></span><small>{{ entries.length }} 个文件</small><small class="folder-action-hint">{{ folderOpen(folder) ? '收起' : '展开' }}</small></template><p v-if="!entries.length" class="sidebar-empty">根目录暂无文件</p><div v-for="file in entries" :key="file.id" class="sidebar-file" :class="{ active: editor.workspaceReady && browse.id === editor.project.id && file.id === editor.fileId }"><button class="sidebar-file-select" :disabled="navigation.blocked" :title="file.name" @click="chooseFile(file)"><FileText :size="20" /><span><strong>{{ baseName(file.name) }} <span v-if="editor.workspaceReady && browse.id === editor.project.id && file.id === editor.fileId" class="manager-active-file">正在翻译</span></strong><small>{{ file.translated.toLocaleString() }} / {{ file.total.toLocaleString() }} 条已翻译 · {{ progress(file) }}%</small><span class="sidebar-progress"><span :style="{ width: `${progress(file)}%` }" /></span></span><span class="manager-enter-file">开始翻译 <ChevronRight :size="15" /></span></button><div class="sidebar-file-actions"><button class="icon-button" :aria-label="`重命名文件 ${file.name}`" :disabled="saving || !canManage" :title="canManage ? '重命名 / 移动文件' : '需要项目管理员权限'" @click="beginFileEdit(file)"><Pencil :size="15" /></button><button class="icon-button" :aria-label="`在 ParaTranz 查看文件 ${file.name}`" :disabled="!editor.desktop" @click="external('file', file)"><ExternalLink :size="15" /></button></div></div></MotionFolder></div>
        <p v-if="!fileGroups.length" class="sidebar-empty">没有符合条件的文件</p>
        </div></Transition>
      </main>
    </div>
  </section>
</template>
