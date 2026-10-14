import type { UnwrapNestedRefs } from 'vue'
import type { FileInfo, ProjectInfo, ProjectSummary } from '~/types/editor'
import { sortFilesByCompletion } from '~/utils/fileSort'

// Owned by app.vue: navigation never recreates the sidebar or its directory state.
export function useWorkspaceNavigation(e: UnwrapNestedRefs<ReturnType<typeof useEditor>>, flushSurfaces: () => Promise<void> = () => e.flushDraft(true)) {
  const route = useRoute()
  const startupCanOpenProject = route.path === '/' || route.path === '/projects'
  const projectChosen = ref(false), collapsed = ref(false)
  const projects = ref<ProjectSummary[]>([]), browse = ref<ProjectInfo>({ ...e.project }), files = ref<FileInfo[]>([])
  const catalogBusy = ref(false), catalogReady = ref(false), busy = ref(false), saving = ref(false)
  const loadingLabel = ref('')
  const catalogError = ref(''), error = ref(''), notice = ref('')
  const projectSearch = ref(''), fileSearch = ref(''), expandedFolders = ref<string[]>([''])
  const showConnection = ref(false)
  const showGuide = ref(false), guideReady = ref(false), loginBusy = ref(false)
  let guideCompleted = false, startupChecked = false, startupProjectDecisionMade = false
  let catalogSequence = 0
  const cache = new Map<number, { project: ProjectInfo; files: FileInfo[]; search: string; folders: string[] }>()
  const blocked = computed(() => loginBusy.value || busy.value || saving.value || e.initializing || e.listBusy || e.reloadBusy)
  const filteredProjects = computed(() => projects.value.filter(p => `${p.name} ${p.id}`.toLocaleLowerCase().includes(projectSearch.value.toLocaleLowerCase())))
  const fileGroups = computed(() => {
    const groups = new Map<string, FileInfo[]>([['', []]])
    const query = fileSearch.value.trim().toLocaleLowerCase()
    for (const file of sortFilesByCompletion(files.value.filter(f => f.name.toLocaleLowerCase().includes(query)))) {
      const folder = file.name.includes('/') ? file.name.slice(0, file.name.lastIndexOf('/')) : ''
      let entries = groups.get(folder)
      if (!entries) { entries = []; groups.set(folder, entries) }
      entries.push(file)
    }
    return [...groups].filter(([, entries]) => !query || entries.length).sort(([a], [b]) => a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))
  })
  function folderOpen(folder: string) { return !!fileSearch.value.trim() || expandedFolders.value.includes(folder) }
  function toggleFolder(folder: string) {
    if (!fileSearch.value.trim()) expandedFolders.value = folderOpen(folder) ? expandedFolders.value.filter(v => v !== folder) : [...expandedFolders.value, folder]
  }
  function expandFolders() { expandedFolders.value = fileGroups.value.map(([folder]) => folder) }
  function collapseFolders() { expandedFolders.value = [''] }
  function remember() {
    if (!projectChosen.value) return
    cache.set(browse.value.id, { project: browse.value, files: files.value, search: fileSearch.value, folders: [...expandedFolders.value] })
    try { localStorage.setItem('sckit-current-project', String(browse.value.id)) } catch { /* Keep project navigation available when storage is unavailable. */ }
  }
  function restore(id: number) {
    const saved = cache.get(id)
    if (!saved) return false
    browse.value = saved.project; files.value = saved.files; fileSearch.value = saved.search; expandedFolders.value = [...saved.folders]; projectChosen.value = true
    return true
  }
  async function run(action: () => Promise<void>, label = '') {
    if (blocked.value) return
    busy.value = true; loadingLabel.value = label; error.value = ''
    try { await flushSurfaces(); await action() }
    catch (reason) { error.value = (reason as Error).message }
    finally { busy.value = false; loadingLabel.value = '' }
  }
  function finishGuide() {
    showGuide.value = false; guideCompleted = true
    try { localStorage.setItem('sckit-guide-completed', '1') } catch { /* Keep the choice for this session. */ }
  }
  async function openGuide() { await run(async () => { await navigateTo('/'); showGuide.value = true }) }
  async function goHome() { await run(async () => { await navigateTo('/') }) }
  async function goSettings() { await run(async () => { await navigateTo('/settings') }) }
  async function openProjectSection(section: string) {
    if (!projectChosen.value || !['overview', 'history', 'announcements', 'tasks', 'files', 'terms', 'issues', 'members', 'applications', 'leaderboard', 'artifact', 'settings'].includes(section)) return
    await run(async () => { await navigateTo(`/project-section/${section}`) }, '正在打开项目栏目…')
  }
  async function loadCatalog() {
    if (catalogBusy.value || e.initializing) return
    const session = e.connected, account = e.sessionInfo, request = ++catalogSequence
    catalogBusy.value = true; catalogError.value = ''
    try {
      const loaded = session && account.authenticated ? await e.api<ProjectSummary[]>('projects') : []
      if (request !== catalogSequence || session !== e.connected || account !== e.sessionInfo) return
      projects.value = loaded
      if (e.workspaceReady && !projects.value.some(p => p.id === e.project.id)) projects.value.unshift({ id: e.project.id, name: e.project.name })
      catalogReady.value = true
    } catch (reason) { if (request === catalogSequence) catalogError.value = (reason as Error).message }
    finally { if (request === catalogSequence) catalogBusy.value = false }
  }
  async function fetchProject(id: number) {
    if (!e.connected || !e.sessionInfo.authenticated) throw new Error('请先登录 ParaTranz')
    const [project, loaded] = await Promise.all([e.api<ProjectInfo>('project', { projectId: id }), e.api<FileInfo[]>('files', { projectId: id })])
    browse.value = project; files.value = loaded; projectChosen.value = true
    if (!projects.value.some(p => p.id === project.id)) projects.value.push({ id: project.id, name: project.name })
    if (e.workspaceReady && e.project.id === id) { e.project = project; e.files = loaded; e.file = loaded.find(f => f.id === e.fileId) || e.file }
    remember()
  }
  async function inspectProject(id: number, refresh = false) {
    await run(async () => {
      if (!refresh) {
        remember()
        if (showGuide.value) finishGuide()
        if (!restore(id)) { projectChosen.value = false; files.value = []; fileSearch.value = ''; expandedFolders.value = [''] }
        await navigateTo('/project-section/overview')
      }
      if (refresh || !projectChosen.value || browse.value.id !== id) await fetchProject(id)
    }, '正在加载项目…')
  }
  async function chooseFile(file: FileInfo) {
    await run(async () => {
      e.error = ''
      if (!await e.openFile(browse.value.id, file.id)) return
      if (e.error) throw new Error(e.error)
      remember(); await navigateTo('/editor')
    }, '正在打开文件…')
  }
  async function continueEditing() {
    if (!e.workspaceReady) return
    await run(async () => {
      alignEditor()
      await navigateTo('/editor')
    })
  }
  async function openString(projectId: number, stringId: number) {
    if (blocked.value) return false
    let opened = false
    await run(async () => {
      if (!await e.openString(projectId, stringId)) return
      alignEditor()
      await navigateTo('/editor')
      await nextTick()
      document.querySelector<HTMLElement>('.string-list .string-row[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
      opened = true
    }, '正在定位词条…')
    if (!opened && error.value) e.error = error.value
    return opened
  }
  async function goBack() {
    if (blocked.value || !e.canGoBack) return false
    let returned = false
    await run(async () => {
      if (!await e.goBack()) return
      alignEditor()
      await navigateTo('/editor')
      await nextTick()
      document.querySelector<HTMLElement>('.string-list .string-row[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
      returned = true
    }, '正在返回上一个词条…')
    if (!returned && error.value) e.error = error.value
    return returned
  }
  async function openOccurrences(projectId: number, original: string) {
    if (blocked.value) return false
    let opened = false
    await run(async () => {
      if (!await e.openOccurrences(projectId, original)) return
      alignEditor()
      await navigateTo('/editor')
      opened = true
    }, '正在查找所有出现的情况…')
    if (!opened && error.value) e.error = error.value
    return opened
  }
  function alignEditor() {
    if (!e.workspaceReady) return
    remember()
    if (!restore(e.project.id)) { fileSearch.value = ''; expandedFolders.value = [''] }
    browse.value = e.project; files.value = e.files; projectChosen.value = true
    remember()
  }
  async function disconnect() {
    await run(async () => {
      const result = await window.scKit?.disconnect()
      if (!result?.ok) throw new Error(result?.message || '断开失败')
      await e.resetWorkspace(); reset(); showGuide.value = true; await navigateTo('/'); await loadCatalog()
    })
  }
  async function connected(_projectId: number, _fileId: number, session: typeof e.sessionInfo) {
    showConnection.value = false
    await run(async () => { await e.restoreSession(session); reset(); finishGuide(); await navigateTo('/'); await loadCatalog() })
  }
  function reset() {
    ++catalogSequence; catalogBusy.value = false; catalogError.value = ''
    cache.clear(); projectChosen.value = false; projects.value = []; files.value = []; catalogReady.value = false; expandedFolders.value = ['']; fileSearch.value = ''; error.value = ''; notice.value = ''
  }
  watch(() => e.initializing, value => { if (!value && !projects.value.length) loadCatalog() })
  watch(() => e.connected, () => { reset(); loadCatalog() })
  watch(() => e.files, value => {
    if (projectChosen.value && browse.value.id === e.project.id) files.value = value
  })
  watch(() => [guideReady.value, e.initializing], () => {
    if (!guideReady.value || e.initializing || startupChecked) return
    startupChecked = true
    if (e.connected && e.sessionInfo.authenticated) finishGuide()
    else showGuide.value = true
  })
  watch(() => [guideReady.value, e.initializing, catalogBusy.value, catalogReady.value, e.connected, e.sessionInfo.authenticated, showGuide.value], () => {
    if (!startupCanOpenProject || startupProjectDecisionMade || !guideReady.value || e.initializing || catalogBusy.value || !catalogReady.value ||
      !e.connected || !e.sessionInfo.authenticated || showGuide.value) return
    startupProjectDecisionMade = true
    let rememberedId = 0
    try {
      rememberedId = Number(localStorage.getItem('sckit-current-project'))
      if (!Number.isInteger(rememberedId) || rememberedId <= 0) {
        const previousWorkspace = JSON.parse(localStorage.getItem('sckit-workspace') || 'null')
        rememberedId = Number(previousWorkspace?.projectId) || 0
      }
    } catch { /* Fall back to the first available project when storage is unavailable. */ }
    const project = projects.value.find(candidate => candidate.id === rememberedId) || projects.value[0]
    if (project) void inspectProject(project.id)
  })
  onMounted(() => {
    try { guideCompleted = localStorage.getItem('sckit-guide-completed') === '1' } catch { /* Show the guide when storage is unavailable. */ }
    guideReady.value = true
    loadCatalog()
  })
  return { projectChosen, collapsed, projects, browse, files, catalogBusy, busy, saving, loadingLabel, catalogError, error, notice,
    projectSearch, fileSearch, expandedFolders, showConnection, showGuide, guideReady, loginBusy, blocked, filteredProjects, fileGroups,
    folderOpen, toggleFolder, expandFolders, collapseFolders, goHome, goSettings, openProjectSection, openGuide, finishGuide, loadCatalog, inspectProject, chooseFile, continueEditing, openString, goBack, openOccurrences, alignEditor, connected, disconnect }
}

export type WorkspaceNavigation = UnwrapNestedRefs<ReturnType<typeof useWorkspaceNavigation>>
