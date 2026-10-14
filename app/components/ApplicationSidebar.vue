<script setup lang="ts">
import { Home, Settings, PanelLeftClose, PanelLeftOpen, Search, RefreshCw, ChevronRight, FolderOpen, FolderClosed, FileText, ChevronsDown, ChevronsUp, LayoutDashboard, History, Megaphone, ListChecks, Files, BookOpen, MessagesSquare, UsersRound, UserRoundPlus, Trophy, Download, Settings2 } from 'lucide-vue-next'
import type { WorkspaceNavigation } from '~/composables/useWorkspaceNavigation'
import type { UnwrapNestedRefs } from 'vue'
import { fileCompletionPercent } from '~/utils/fileSort'
const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>>; navigation: WorkspaceNavigation }>()
const route = useRoute()
const scroll = ref<HTMLElement>()
const positions = new Map<number, number>()
const projectSections = [
  { id: 'overview', label: '概览', icon: LayoutDashboard, path: 'overview' },
  { id: 'history', label: '历史记录', icon: History, path: 'history' },
  { id: 'announcements', label: '公告', icon: Megaphone, path: 'announcements' },
  { id: 'tasks', label: '任务', icon: ListChecks, path: 'tasks' },
  { id: 'files', label: '文件', icon: Files, path: 'files' },
  { id: 'terms', label: '术语', icon: BookOpen, path: 'terms' },
  { id: 'discussions', label: '讨论', icon: MessagesSquare, path: 'issues' },
  { id: 'members', label: '成员', icon: UsersRound, path: 'members' },
  { id: 'applications', label: '申请', icon: UserRoundPlus, path: 'applications' },
  { id: 'leaderboard', label: '排行榜', icon: Trophy, path: 'leaderboard' },
  { id: 'downloads', label: '下载', icon: Download, path: 'artifact' },
  { id: 'project-settings', label: '设置及管理', icon: Settings2, path: 'settings' },
] as const
const selectedProjectSection = ref(route.path === '/editor' ? 'files' : route.path.startsWith('/project-section/') ? projectSections.find(section => section.path === String(route.params.section || ''))?.id || '' : '')
watch(() => props.navigation.browse.id, (id, old) => {
  positions.set(old, scroll.value?.scrollTop || 0)
  selectedProjectSection.value = ''
  nextTick(() => scroll.value?.scrollTo({ top: positions.get(id) || 0 }))
}, { flush: 'pre' })
watch(() => route.path, path => {
  const routeSection = String(route.params.section || '')
  selectedProjectSection.value = path === '/editor' ? 'files'
      : path.startsWith('/project-section/') ? projectSections.find(section => section.path === routeSection)?.id || ''
        : ''
})
function sectionCount(id: string) { return id === 'files' ? props.navigation.files.length : null }
async function openProjectSection(section: typeof projectSections[number]) {
  if (props.navigation.blocked || !props.navigation.projectChosen) return
  if (!section.path) return
  selectedProjectSection.value = section.id
  await props.navigation.openProjectSection(section.path)
}
</script>
<template>
  <aside class="application-sidebar" :class="{ collapsed: navigation.collapsed }" aria-label="项目与文件导航">
    <div class="application-sidebar-heading"><button v-show="!navigation.collapsed" class="sidebar-home" :class="{ active: route.path === '/' }" :aria-current="route.path === '/' ? 'page' : undefined" :disabled="navigation.blocked" title="项目主页" aria-label="项目主页" @click="navigation.goHome"><Home :size="18" /><span>项目主页</span></button><button class="icon-button sidebar-toggle" :aria-label="navigation.collapsed ? '展开侧栏' : '折叠侧栏'" :title="navigation.collapsed ? '展开侧栏' : '折叠侧栏'" :aria-expanded="!navigation.collapsed" @click="navigation.collapsed = !navigation.collapsed"><PanelLeftOpen v-if="navigation.collapsed" :size="18" /><PanelLeftClose v-else :size="18" /></button></div>
    <button v-show="navigation.collapsed && editor.workspaceReady" class="icon-button sidebar-continue" :disabled="navigation.blocked" aria-label="继续翻译" title="继续翻译" @click="navigation.continueEditing"><FileText :size="18" /></button>
    <Transition name="fade"><div ref="scroll" v-show="!navigation.collapsed" class="application-sidebar-scroll">
      <div class="sidebar-section-heading"><strong>我参与的项目 <span>{{ navigation.projects.length }}</span></strong><button class="icon-button small" :disabled="!editor.connected || !editor.sessionInfo.authenticated || navigation.catalogBusy || navigation.blocked" aria-label="刷新项目列表" @click="navigation.loadCatalog"><RefreshCw :size="14" /></button></div>
      <label class="sidebar-search"><Search :size="14" /><input v-model="navigation.projectSearch" :disabled="!editor.connected || !editor.sessionInfo.authenticated" placeholder="搜索项目名称或 ID" aria-label="搜索项目" /></label>
      <p v-if="navigation.catalogError" class="sidebar-message error" role="alert">{{ navigation.catalogError }} <button @click="navigation.loadCatalog">重试</button></p>
      <div :aria-busy="navigation.catalogBusy || editor.initializing">
      <button v-for="project in navigation.filteredProjects" :key="project.id" class="sidebar-project" :class="{ active: navigation.projectChosen && project.id === navigation.browse.id }" :disabled="navigation.blocked || navigation.catalogBusy" @click="navigation.inspectProject(project.id)"><span class="project-avatar">{{ project.name.slice(0, 1) }}</span><span><strong>{{ project.name }}</strong><small>#{{ project.id }}<span v-if="editor.workspaceReady && editor.project.id === project.id"> · 正在翻译</span></small></span><ChevronRight :size="14" /></button>
      <p v-if="editor.connected && editor.sessionInfo.authenticated && !navigation.catalogBusy && !editor.initializing && !navigation.filteredProjects.length" class="sidebar-empty">没有符合条件的项目</p>
      </div>
      <section v-if="navigation.projectChosen" class="sidebar-project-navigation" aria-label="当前项目导航">
        <div class="sidebar-project-navigation-heading"><strong>{{ navigation.browse.name }}</strong><small>#{{ navigation.browse.id }} · {{ navigation.browse.source }} → {{ navigation.browse.dest }}</small></div>
        <nav class="sidebar-project-navigation-items" aria-label="ParaTranz 项目栏目">
          <button v-for="section in projectSections" :key="section.id" class="sidebar-project-navigation-item" :class="{ active: selectedProjectSection === section.id }" :aria-current="selectedProjectSection === section.id ? 'page' : undefined" :disabled="navigation.blocked" :title="section.label" @click="openProjectSection(section)">
            <component :is="section.icon" :size="17" /><span>{{ section.label }}</span><small v-if="sectionCount(section.id) !== null">{{ sectionCount(section.id) }}</small>
          </button>
        </nav>
      </section>
      <section v-if="navigation.projectChosen" class="sidebar-directory" :aria-busy="navigation.busy" aria-label="当前项目目录">
        <div class="sidebar-section-heading"><strong>项目文件 · {{ navigation.files.length }}</strong><div><button class="icon-button small" title="展开全部文件夹" aria-label="展开全部文件夹" :disabled="!!navigation.fileSearch.trim()" @click="navigation.expandFolders"><ChevronsDown :size="15" /></button><button class="icon-button small" title="折叠文件夹，保留根目录" aria-label="折叠全部文件夹" :disabled="!!navigation.fileSearch.trim()" @click="navigation.collapseFolders"><ChevronsUp :size="15" /></button><button class="icon-button small" aria-label="刷新目录" :disabled="navigation.blocked" @click="navigation.inspectProject(navigation.browse.id, true)"><RefreshCw :size="14" /></button></div></div>
        <label class="sidebar-search"><Search :size="14" /><input v-model="navigation.fileSearch" placeholder="搜索文件名或目录" aria-label="搜索侧栏文件" /></label>
        <div class="sidebar-file-groups"><MotionFolder v-for="[folder, entries] in navigation.fileGroups" :key="folder" :open="navigation.folderOpen(folder)" :title="navigation.fileSearch.trim() ? '搜索结果保持展开' : `${navigation.folderOpen(folder) ? '收起' : '展开'} ${folder || '项目根目录'}`" @toggle="navigation.toggleFolder(folder)"><template #heading><ChevronRight :size="14" class="folder-chevron" :class="{ expanded: navigation.folderOpen(folder) }" /><FolderOpen v-if="navigation.folderOpen(folder)" :size="15" /><FolderClosed v-else :size="15" /><span>{{ folder || '项目根目录' }}</span><small>{{ entries.length }}</small></template><p v-if="!entries.length" class="sidebar-empty">根目录暂无文件</p><button v-for="file in entries" :key="file.id" class="sidebar-tree-file" :class="{ active: editor.workspaceReady && navigation.browse.id === editor.project.id && file.id === editor.fileId }" :aria-current="editor.workspaceReady && navigation.browse.id === editor.project.id && file.id === editor.fileId ? 'page' : undefined" :disabled="navigation.blocked" :title="file.name" @click="navigation.chooseFile(file)"><FileText :size="15" /><span>{{ file.name.slice(file.name.lastIndexOf('/') + 1) }}</span><small v-if="editor.workspaceReady && navigation.browse.id === editor.project.id && file.id === editor.fileId">当前</small><small class="sidebar-file-completion" :title="`完成度 ${fileCompletionPercent(file)}% · 已翻译 ${file.translated} / ${file.total} 条`">{{ fileCompletionPercent(file) }}%</small></button></MotionFolder></div>
      </section>
      <p v-if="navigation.error" class="sidebar-message error" role="alert">{{ navigation.error }}</p>
    </div></Transition>
    <div class="application-sidebar-bottom">
      <button class="sidebar-settings" :class="{ active: route.path === '/settings' }" :aria-current="route.path === '/settings' ? 'page' : undefined" :disabled="navigation.blocked" aria-label="设置" title="设置" @click="navigation.goSettings"><Settings :size="18" /><span v-show="!navigation.collapsed">设置</span></button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar-project-navigation{margin:18px -2px 0;padding:14px 2px 0;border-top:1px solid var(--border)}
.sidebar-project-navigation-heading{display:flex;flex-direction:column;gap:3px;min-width:0;margin:0 2px 10px}
.sidebar-project-navigation-heading strong{overflow:hidden;color:var(--text);font-size:12px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.sidebar-project-navigation-heading small{overflow:hidden;color:var(--muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}
.sidebar-project-navigation-items{display:grid;gap:3px}
.sidebar-project-navigation-item{display:flex;align-items:center;gap:10px;width:100%;min-height:37px;padding:8px 10px;border-radius:5px;color:var(--secondary);font-size:12px;text-align:left;transition:background .12s,color .12s}
.sidebar-project-navigation-item>svg{flex:0 0 auto;color:var(--muted)}
.sidebar-project-navigation-item>span{flex:1;min-width:0}
.sidebar-project-navigation-item>small{min-width:22px;padding:2px 6px;border-radius:10px;background:var(--border);color:var(--secondary);font-size:10px;text-align:center}
.sidebar-project-navigation-item:hover{background:var(--soft);color:var(--text)}
.sidebar-project-navigation-item.active{background:var(--accent);color:var(--accent-foreground,#fff);font-weight:600}
.sidebar-project-navigation-item.active>svg{color:inherit}
.sidebar-project-navigation-item.active>small{background:#ffffff35;color:inherit}
.sidebar-project-navigation-item:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.collapsed .sidebar-project-navigation{display:none}
</style>
