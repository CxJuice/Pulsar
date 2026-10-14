<script setup lang="ts">
import { Activity, ArrowDownToLine, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, ChevronsDown, ChevronsUp, Download, ExternalLink, Files, FileText, FolderClosed, FolderOpen, History, LayoutDashboard, ListChecks, Megaphone, MessageSquare, Pencil, Pin, Plus, RefreshCw, Search, Send, Settings2, Trash2, Trophy, UserRoundPlus, UsersRound, X } from 'lucide-vue-next'
import type { Component, UnwrapNestedRefs } from 'vue'
import type { FileInfo, Term, TermPage } from '~/types/editor'
import type { WorkspaceNavigation } from '~/composables/useWorkspaceNavigation'
import { fileCompletion } from '~/utils/fileSort'
import { compareHistoryText, type HistoryComparison } from '~/utils/historyDiff'
import { projectTermCatalogScope, readProjectTermCatalog, syncProjectTermCatalog } from '~/utils/projectTermCatalogCache'
import ProjectHome from '~/components/ProjectHome.vue'
import UserAvatar from '~/components/UserAvatar.vue'

type Row = Record<string, unknown>
type Column = { key: string; label: string; fields: string[]; kind?: 'date' | 'status' | 'percent' | 'number'; width?: string }
type SectionConfig = { title: string; description: string; icon: Component; paged?: boolean; columns: Column[] }
type DialogMode = 'detail' | 'form' | ''
type FormMode = 'create' | 'edit' | 'reply' | 'member-add' | 'member-edit' | 'application-approve' | 'application-reject'

const memberRoleOrder = [
  { permission: 10, id: 'owner', title: '负责人' },
  { permission: 3, id: 'managers', title: '管理' },
  { permission: 2, id: 'proofreaders', title: '校对' },
  { permission: 1, id: 'translators', title: '翻译' },
] as const

const props = defineProps<{ editor: UnwrapNestedRefs<ReturnType<typeof useEditor>> }>()
const route = useRoute()
const navigation = inject<WorkspaceNavigation>('workspace-navigation')!
const pageSize = 50
const configs: Record<string, SectionConfig> = {
  overview: { title: '概览', description: '项目进度、文件状态与最近动态。', icon: LayoutDashboard, columns: [] },
  history: { title: '历史记录', description: '按时间查看项目词条变更，并可直接定位到对应词条。', icon: History, paged: true, columns: [
    { key: 'date', label: '时间', fields: ['createdAt'], kind: 'date', width: '150px' }, { key: 'user', label: '成员', fields: ['user.nickname', 'user.username', 'uid'], width: '140px' }, { key: 'operation', label: '操作', fields: ['operation'], kind: 'status', width: '100px' }, { key: 'key', label: '词条', fields: ['target.key', 'tid'], width: '180px' }, { key: 'field', label: '字段', fields: ['field'], width: '100px' }, { key: 'from', label: '修改前', fields: ['from'] }, { key: 'to', label: '修改后', fields: ['to'] },
  ] },
  announcements: { title: '公告', description: '查看项目公告、发布更新，并管理自己有权限编辑的公告。', icon: Megaphone, paged: true, columns: [
    { key: 'title', label: '标题', fields: ['title'], width: '260px' }, { key: 'category', label: '分类', fields: ['category'], width: '120px' }, { key: 'author', label: '发布者', fields: ['user.nickname', 'user.username', 'uid'], width: '150px' }, { key: 'comments', label: '回复', fields: ['commentsCount'], kind: 'number', width: '90px' }, { key: 'bumped', label: '置顶', fields: ['bumpedAt'], kind: 'status', width: '90px' }, { key: 'date', label: '发布时间', fields: ['createdAt'], kind: 'date', width: '170px' },
  ] },
  tasks: { title: '任务', description: '查看任务目标和进度，创建任务、维护关联文件或标记任务完成。', icon: ListChecks, paged: true, columns: [
    { key: 'title', label: '任务', fields: ['title'], width: '260px' }, { key: 'status', label: '状态', fields: ['status'], kind: 'status', width: '110px' }, { key: 'goal', label: '目标', fields: ['goal.translate', 'goal.check', 'goal.review'], width: '200px' }, { key: 'progress', label: '进度', fields: ['taskFiles'], kind: 'percent', width: '150px' }, { key: 'files', label: '文件', fields: ['taskFiles.length'], kind: 'number', width: '90px' }, { key: 'deadline', label: '截止时间', fields: ['deadline'], kind: 'date', width: '170px' },
  ] },
  files: { title: '文件', description: '浏览项目文件和翻译进度，选择文件后进入内置翻译编辑器。', icon: Files, columns: [
    { key: 'name', label: '文件', fields: ['name'] }, { key: 'total', label: '词条', fields: ['total'], kind: 'number', width: '100px' }, { key: 'translated', label: '已翻译', fields: ['translated'], kind: 'number', width: '100px' }, { key: 'checked', label: '已校对', fields: ['checked'], kind: 'number', width: '100px' }, { key: 'reviewed', label: '已审核', fields: ['reviewed'], kind: 'number', width: '100px' }, { key: 'completion', label: '完成度', fields: ['translated', 'total'], kind: 'percent', width: '120px' },
  ] },
  terms: { title: '术语', description: '管理当前项目的术语原文、译文、词性、变体和备注。', icon: BookOpen, paged: true, columns: [
    { key: 'term', label: '原文', fields: ['term'], width: '220px' }, { key: 'translation', label: '译文', fields: ['translation'], width: '240px' }, { key: 'pos', label: '词性', fields: ['pos'], width: '100px' }, { key: 'variants', label: '变体', fields: ['variants'], width: '180px' }, { key: 'note', label: '备注', fields: ['note'] }, { key: 'updatedAt', label: '更新时间', fields: ['updatedAt'], kind: 'date', width: '170px' },
  ] },
  issues: { title: '讨论', description: '发起讨论、回复、订阅主题，并管理自己有权限编辑的讨论。', icon: MessageSquare, paged: false, columns: [
    { key: 'title', label: '主题', fields: ['title'], width: '300px' }, { key: 'author', label: '发起者', fields: ['user.nickname', 'user.username', 'uid'], width: '150px' }, { key: 'status', label: '状态', fields: ['status'], kind: 'status', width: '110px' }, { key: 'comments', label: '回复', fields: ['commentsCount', 'replies.length', 'activities.length'], kind: 'number', width: '90px' }, { key: 'updatedAt', label: '最近更新', fields: ['updatedAt', 'createdAt'], kind: 'date', width: '170px' },
  ] },
  members: { title: '成员', description: '查看成员贡献、调整项目权限和备注，或邀请已注册用户。', icon: UsersRound, columns: [
    { key: 'member', label: '成员', fields: ['user.nickname', 'user.username', 'nickname', 'username'], width: '220px' }, { key: 'permission', label: '权限', fields: ['permission'], kind: 'status', width: '120px' }, { key: 'translated', label: '翻译', fields: ['translated'], kind: 'number', width: '100px' }, { key: 'edited', label: '编辑', fields: ['edited'], kind: 'number', width: '100px' }, { key: 'reviewed', label: '审核', fields: ['reviewed'], kind: 'number', width: '100px' }, { key: 'points', label: '贡献值', fields: ['totalPoints'], kind: 'number', width: '110px' }, { key: 'note', label: '备注', fields: ['note'] },
  ] },
  applications: { title: '申请', description: '查看加入项目的申请并处理待审核申请。', icon: UserRoundPlus, paged: true, columns: [
    { key: 'applicant', label: '申请者', fields: ['user.nickname', 'user.username', 'nickname', 'username', 'uid'], width: '200px' }, { key: 'status', label: '状态', fields: ['status'], kind: 'status', width: '110px' }, { key: 'message', label: '申请说明', fields: ['message', 'content', 'reason'] }, { key: 'reason', label: '处理理由', fields: ['reason'], width: '220px' }, { key: 'createdAt', label: '申请时间', fields: ['createdAt'], kind: 'date', width: '170px' },
  ] },
  leaderboard: { title: '排行榜', description: '按项目贡献查看成员排名和翻译、编辑、审核数量。', icon: Trophy, paged: true, columns: [
    { key: 'rank', label: '排名', fields: ['rank', 'position'], kind: 'number', width: '90px' }, { key: 'user', label: '成员', fields: ['user.nickname', 'user.username', 'nickname', 'username'], width: '220px' }, { key: 'points', label: '贡献值', fields: ['totalPoints', 'score', 'points'], kind: 'number', width: '130px' }, { key: 'translated', label: '翻译', fields: ['translated'], kind: 'number', width: '110px' }, { key: 'edited', label: '编辑', fields: ['edited'], kind: 'number', width: '110px' }, { key: 'reviewed', label: '审核', fields: ['reviewed'], kind: 'number', width: '110px' },
  ] },
  artifact: { title: '下载', description: '查看历史导出版本，生成新导出并保存压缩包到本机。', icon: Download, paged: true, columns: [
    { key: 'createdAt', label: '导出时间', fields: ['createdAt'], kind: 'date', width: '190px' }, { key: 'total', label: '总词条', fields: ['total'], kind: 'number', width: '110px' }, { key: 'translated', label: '已翻译', fields: ['translated'], kind: 'number', width: '110px' }, { key: 'reviewed', label: '已审核', fields: ['reviewed'], kind: 'number', width: '110px' }, { key: 'disputed', label: '有疑问', fields: ['disputed'], kind: 'number', width: '110px' }, { key: 'duration', label: '打包耗时', fields: ['duration'], kind: 'number', width: '110px' },
  ] },
  settings: { title: '设置及管理', description: '查看项目资料与协作权限，维护项目名称和介绍。', icon: Settings2, columns: [] },
}

const sectionId = computed(() => String(route.params.section || ''))
const config = computed(() => configs[sectionId.value])
const page = ref(1), search = ref(''), statusFilter = ref('all'), taskStatusFilter = ref('all'), memberRoleFilter = ref('all'), categoryFilter = ref(''), announcementPinnedOnly = ref(false)
const historyType = ref(''), historyBegin = ref(''), historyEnd = ref('')
const artifactAgreement = ref(false), projectSettingsName = ref(''), projectSettingsDesc = ref(''), projectSettingsExpected = shallowRef<{ name: string; desc: string } | null>(null), projectSettingsBusy = ref(false)
const fileEditTarget = shallowRef<FileInfo | null>(null), fileEditName = ref(''), fileSaving = ref(false), expandedFileFolders = ref<string[]>([''])
const payload = shallowRef<unknown>(null), busy = ref(false), actionBusy = ref(''), error = ref(''), notice = ref('')
const dialogMode = ref<DialogMode>(''), detail = shallowRef<Row | null>(null), activeRow = shallowRef<Row | null>(null), detailBusy = ref(false), detailError = ref('')
const formMode = ref<FormMode>('create'), formError = ref(''), formBusy = ref(false)
const userMatches = ref<Row[]>([]), userSearchBusy = ref(false), selectedMemberUser = shallowRef<Row | null>(null), memberSearch = ref('')
const selectedTaskFile = ref(''), taskFileMode = ref(1)
const form = reactive({ title: '', content: '', category: 'announcement', bumped: false, internal: false, deadline: '', translate: '', check: '', review: '', term: '', translation: '', pos: '', note: '', variants: '', caseSensitive: false, permission: 1, memberNote: '', reason: '' })
let requestSequence = 0, detailSequence = 0, memberSearchTimer: ReturnType<typeof setTimeout> | undefined, termCatalogProjectId = 0

const sectionTitle = computed(() => config.value?.title || '项目栏目')
const rowList = computed(() => rowsFrom(payload.value))
const matchedRows = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return rowList.value.filter(row => {
    if (query && !JSON.stringify(row).toLocaleLowerCase().includes(query)) return false
    if (sectionId.value === 'tasks' && taskStatusFilter.value !== 'all' && Number(rawField(row, ['status'])) !== Number(taskStatusFilter.value)) return false
    if (sectionId.value === 'members' && memberRoleFilter.value !== 'all' && Number(rawField(row, ['permission'])) !== Number(memberRoleFilter.value)) return false
    return true
  })
})
const orderedRows = computed(() => sectionId.value === 'leaderboard'
  ? [...matchedRows.value].sort((left, right) => leaderboardContribution(right) - leaderboardContribution(left))
  : matchedRows.value)
const visibleRows = computed(() => ['terms', 'leaderboard'].includes(sectionId.value)
  ? orderedRows.value.slice((page.value - 1) * pageSize, page.value * pageSize)
  : orderedRows.value)
const groupedFiles = computed(() => fileGroups(matchedRows.value))
const fileFolderCount = computed(() => groupedFiles.value.filter(([folder]) => folder !== '').length)
const allFileFoldersExpanded = computed(() => groupedFiles.value.filter(([folder]) => folder !== '').every(([folder]) => expandedFileFolders.value.includes(folder)))
const anyFileFolderExpanded = computed(() => groupedFiles.value.some(([folder]) => folder !== '' && expandedFileFolders.value.includes(folder)))
const memberGroups = computed(() => {
  const buckets = new Map<number, Row[]>()
  for (const row of visibleRows.value) {
    const permission = numericField(row, ['permission']) ?? 0
    buckets.set(permission, [...(buckets.get(permission) || []), row])
  }
  const knownGroups = memberRoleOrder
    .map(group => ({ ...group, rows: buckets.get(group.permission) || [] }))
    .filter(group => group.rows.length > 0)
  const otherGroups = [...buckets.entries()]
    .filter(([permission]) => !memberRoleOrder.some(group => group.permission === permission))
    .sort(([left], [right]) => left - right)
    .map(([permission, rows]) => ({
      id: `permission-${permission}`,
      permission,
      title: permission ? permissionLabel(permission) : '其他权限',
      rows,
    }))
  return [...knownGroups, ...otherGroups]
})
const activeTasks = computed(() => visibleRows.value.filter(row => Number(rawField(row, ['status'])) !== 1))
const finishedTasks = computed(() => visibleRows.value.filter(row => Number(rawField(row, ['status'])) === 1))
const topLeaderboardScore = computed(() => Math.max(1, ...(sectionId.value === 'leaderboard' ? matchedRows.value : visibleRows.value).map(leaderboardContribution)))
const latestArtifact = computed(() => visibleRows.value[0] || null)
const projectPermission = computed(() => permissionLabel(currentPermission.value))
const currentPermission = computed(() => navigation.browse.permission || navigation.projects.find(project => project.id === navigation.browse.id)?.permission || 0)
const canManage = computed(() => currentPermission.value >= 3)
const totalCount = computed(() => sectionId.value === 'terms' ? matchedRows.value.length : numericField(payload.value, ['rowCount', 'total', 'totalCount', 'count', 'pagination.total']) ?? rowList.value.length)
const pageCount = computed(() => Math.max(1, numericField(payload.value, ['pageCount', 'pages', 'pagination.pageCount']) ?? Math.ceil(totalCount.value / pageSize)))
const canGoNext = computed(() => page.value < pageCount.value || (!numericField(payload.value, ['pageCount', 'pages']) && rowList.value.length >= pageSize))
const detailTitle = computed(() => activeRow.value ? fieldValue(detail.value || activeRow.value, titleFields.value) : '')
const titleFields = computed(() => sectionId.value === 'terms' ? ['term'] : sectionId.value === 'files' ? ['name'] : ['title', 'name', 'term', 'user.nickname', 'user.username', 'nickname', 'username'])
const detailFiles = computed(() => rowsFrom(detail.value?.taskFiles || detail.value?.files))
const detailActivities = computed(() => rowsFrom(detail.value?.activities || detail.value?.replies || detail.value?.comments))
const subscribed = computed(() => {
  const uid = props.editor.sessionInfo.user?.id
  return uid !== undefined && rowsFrom(detail.value?.subscribers).some(item => numericField(item, ['uid', 'user.id']) === uid)
})
const headerAction = computed(() => ({ announcements: canManage.value, tasks: canManage.value, issues: true, terms: true, members: canManage.value, artifact: true } as Record<string, boolean>)[sectionId.value] || false)
const headerActionLabel = computed(() => ({ announcements: '发布公告', tasks: '创建任务', issues: '发起讨论', terms: '新建术语', members: '添加成员', artifact: '重新生成压缩包' } as Record<string, string>)[sectionId.value] || '')
const headerActionIcon = computed(() => ({ announcements: Megaphone, tasks: Plus, issues: MessageSquare, terms: Plus, members: UserRoundPlus, artifact: RefreshCw } as Record<string, Component>)[sectionId.value] || Plus)

function objectValue(value: unknown): Row | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined }
function rowsFrom(value: unknown): Row[] {
  if (Array.isArray(value)) return value.map(objectValue).filter((row): row is Row => !!row)
  const record = objectValue(value)
  if (!record) return []
  for (const key of ['results', 'items', 'records', 'rows', 'files', 'terms', 'tasks', 'issues', 'members', 'announcements', 'applications', 'artifacts', 'scores', 'data', 'activities', 'replies', 'comments', 'taskFiles']) {
    const nested = record[key]
    if (Array.isArray(nested)) return rowsFrom(nested)
    const deeper = rowsFrom(nested)
    if (deeper.length) return deeper
  }
  return []
}
function rawField(value: unknown, paths: string[]): unknown {
  for (const path of paths) {
    let current: unknown = value
    for (const key of path.split('.')) {
      if (key === 'length' && Array.isArray(current)) current = current.length
      else current = objectValue(current)?.[key]
    }
    if (current !== null && current !== undefined && current !== '') return current
  }
  return undefined
}
function numericField(value: unknown, paths: string[]): number | undefined {
  const raw = rawField(value, paths)
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))) return Number(raw)
  return undefined
}
function fieldValue(value: unknown, paths: string[]): string {
  const raw = rawField(value, paths)
  if (raw === undefined || raw === null) return ''
  if (Array.isArray(raw)) return raw.map(item => fieldValue(item, ['name', 'nickname', 'username', 'term', 'title']) || String(item)).join(' · ')
  if (typeof raw === 'object') return fieldValue(raw, ['nickname', 'username', 'name', 'title', 'text'])
  return String(raw)
}
function recordId(row: Row) { return numericField(row, ['id', 'tid', 'file.id']) }
function displayDate(value: unknown) {
  if (typeof value !== 'string' || !value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
function statusText(section: string, value: unknown) {
  if (section === 'tasks') return Number(value) === 1 ? '已完成' : '进行中'
  if (section === 'issues') return Number(value) === 1 ? '已关闭' : '讨论中'
  if (section === 'applications') return Number(value) === 2 ? '已通过' : Number(value) === 1 ? '已拒绝' : '待审核'
  if (section === 'members') return ({ 1: '翻译者', 2: '校对者', 3: '管理员', 10: '所有者' } as Record<number, string>)[Number(value)] || String(value ?? '—')
  if (section === 'terms') return ({ noun: '名词', verb: '动词', adj: '形容词', adv: '副词' } as Record<string, string>)[String(value)] || String(value ?? '—')
  if (section === 'history') return ({ translate: '翻译', edit: '编辑', check: '校对', reset: '重置', dispute: '标记疑问', review: '审核', rollback: '回滚', lock: '锁定', hide: '隐藏', import: '导入', term: '术语', comment: '注释' } as Record<string, string>)[String(value)] || String(value ?? '—')
  if (section === 'announcements') return value ? '已置顶' : '—'
  return String(value ?? '—')
}
function columnText(row: Row, column: Column, index: number) {
  if (column.key === 'rank') return String((page.value - 1) * pageSize + index + 1)
  if (column.key === 'goal') {
    const goal = objectValue(row.goal) || {}
    return [['翻译', goal.translate], ['校对', goal.check], ['审核', goal.review]].filter(([, value]) => typeof value === 'number').map(([label, value]) => `${label} ${Math.round(Number(value) * 100)}%`).join(' · ') || '未设目标'
  }
  if (column.key === 'progress') {
    const files = rowsFrom(row.taskFiles)
    const total = files.reduce((sum, file) => sum + (numericField(file, ['total']) || 0), 0)
    const translated = files.reduce((sum, file) => sum + (numericField(file, ['translated']) || 0), 0)
    return total ? `${Math.round(translated / total * 100)}%` : '—'
  }
  if (column.key === 'completion') {
    const total = numericField(row, ['total']) || 0
    const translated = numericField(row, ['translated']) || 0
    return total ? `${Math.round(translated / total * 100)}%` : '0%'
  }
  const raw = rawField(row, column.fields)
  if (column.kind === 'date') return displayDate(raw)
  if (column.kind === 'status') return statusText(sectionId.value, raw)
  if (column.kind === 'number') return typeof raw === 'number' ? raw.toLocaleString() : String(raw ?? '0')
  if (Array.isArray(raw)) return raw.map(item => fieldValue(item, ['name', 'nickname', 'username', 'term']) || String(item)).join(' · ') || '—'
  if (typeof raw === 'object' && raw) return fieldValue(raw, ['name', 'nickname', 'username', 'term']) || '—'
  const text = String(raw ?? '')
  if (sectionId.value === 'issues' && column.key === 'status') return statusText('issues', raw)
  if (sectionId.value === 'history' && column.key === 'operation') return statusText('history', raw)
  return text || '—'
}
function canEdit(row: Row) {
  const uid = numericField(row, ['uid', 'user.id'])
  if (['announcements', 'tasks', 'members'].includes(sectionId.value)) return canManage.value
  if (['applications', 'files', 'leaderboard', 'history', 'artifact'].includes(sectionId.value)) return false
  return canManage.value || (uid !== undefined && uid === props.editor.sessionInfo.user?.id)
}
function fileFrom(row: Row): FileInfo | undefined {
  const file = objectValue(row.file) || row
  const id = numericField(file, ['id']), name = fieldValue(file, ['name'])
  if (!id || !name) return undefined
  return navigation.files.find(item => item.id === id) || { id, name, project: navigation.browse.id, total: numericField(file, ['total']) || 0, translated: numericField(file, ['translated']) || 0, disputed: numericField(file, ['disputed']) || 0, checked: numericField(file, ['checked']) || 0, reviewed: numericField(file, ['reviewed']) || 0, hidden: numericField(file, ['hidden']) || 0, locked: numericField(file, ['locked']) || 0, words: numericField(file, ['words']) || 0 }
}

function dateBoundary(value: string, end = false) {
  if (!value) return ''
  return `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`
}
function filePercent(file: unknown) {
  const total = numericField(file, ['total']) || 0
  const translated = numericField(file, ['translated']) || 0
  return total ? Math.min(100, Math.round(translated / total * 100)) : 0
}
function fileGroups(rows: Row[]) {
  const groups = new Map<string, Row[]>()
  const orderedRows = [...rows].sort((a, b) => {
    const leftFile = fileFrom(a), rightFile = fileFrom(b)
    return (leftFile ? fileCompletion(leftFile) : 0) - (rightFile ? fileCompletion(rightFile) : 0)
      || fieldValue(a, ['name']).localeCompare(fieldValue(b, ['name']), 'zh-CN', { numeric: true })
      || (recordId(a) || 0) - (recordId(b) || 0)
  })
  for (const row of orderedRows) {
    const name = fieldValue(row, ['name'])
    const folder = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : ''
    groups.set(folder, [...(groups.get(folder) || []), row])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}
function fileFolderOpen(folder: string) { return !!search.value.trim() || expandedFileFolders.value.includes(folder) }
function toggleFileFolder(folder: string) {
  if (search.value.trim()) return
  expandedFileFolders.value = fileFolderOpen(folder) ? expandedFileFolders.value.filter(value => value !== folder) : [...expandedFileFolders.value, folder]
}
function expandFileFolders() { expandedFileFolders.value = groupedFiles.value.map(([folder]) => folder) }
function collapseFileFolders() { expandedFileFolders.value = [''] }
function beginFileEdit(row: Row) {
  const file = fileFrom(row)
  if (!file || !canManage.value) return
  fileEditTarget.value = file; fileEditName.value = file.name; error.value = ''; notice.value = ''
}
function cancelFileEdit() { if (!fileSaving.value) fileEditTarget.value = null }
async function saveFileEdit() {
  const file = fileEditTarget.value, name = fileEditName.value.trim(), projectId = navigation.browse.id
  if (!file || !name || fileSaving.value || !canManage.value) return
  fileSaving.value = true; error.value = ''; notice.value = ''
  try {
    const saved = await props.editor.api<FileInfo>('renameFile', { projectId, fileId: file.id, name, expectedName: file.name })
    navigation.files = navigation.files.map(entry => entry.id === saved.id ? saved : entry)
    payload.value = navigation.files
    if (props.editor.project.id === projectId) {
      props.editor.files = props.editor.files.map(entry => entry.id === saved.id ? saved : entry)
      if (props.editor.fileId === saved.id) props.editor.file = saved
    }
    fileEditTarget.value = null; notice.value = '修改已保存至 ParaTranz'
  } catch (reason) { error.value = (reason as Error).message || '文件修改失败' }
  finally { fileSaving.value = false }
}
function openFileInParaTranz(row: Row) {
  const file = fileFrom(row)
  if (file && props.editor.desktop) void window.scKit?.openExternal(`https://paratranz.cn/projects/${navigation.browse.id}/strings?file=${file.id}`)
}
async function refreshSection() {
  if (sectionId.value !== 'files') { await load(); return }
  await navigation.inspectProject(navigation.browse.id, true)
  payload.value = navigation.files
  error.value = navigation.error
}
function excerpt(row: Row, limit = 180) {
  const text = fieldValue(row, ['content']).replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
function announcementAuthor(row: Row) { return fieldValue(row, ['user.nickname', 'user.username']) || `用户 ${fieldValue(row, ['uid'])}` }
function historyKey(row: Row) {
  const target = rawField(row, ['target.key', 'key'])
  return String(target || (recordId(row) ? `词条 ${recordId(row)}` : '项目记录'))
}
const historyComparisonCache = new WeakMap<Row, HistoryComparison | null>()
function historyText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value, null, 2) ?? String(value) } catch { return String(value) }
}
function historyComparison(row: Row): HistoryComparison | null {
  if (historyComparisonCache.has(row)) return historyComparisonCache.get(row) ?? null
  let target = row.target
  if (typeof target === 'string') { try { target = JSON.parse(target) } catch { target = undefined } }
  const beforeText = historyText(row.from)
  const afterText = historyText(row.to ?? row.translation ?? objectValue(target)?.translation)
  if (beforeText === null && afterText === null) { historyComparisonCache.set(row, null); return null }

  const result = compareHistoryText(beforeText, afterText)
  historyComparisonCache.set(row, result)
  return result
}
function memberName(row: Row) { return fieldValue(row, ['user.nickname', 'user.username', 'nickname', 'username']) || `用户 ${fieldValue(row, ['uid'])}` }
function leaderboardContribution(row: Row) { return numericField(row, ['totalPoints', 'total_points', 'points']) || 0 }
function announcementCategory(row: Row) { return fieldValue(row, ['category']) === 'blog' ? '项目动态' : '公告' }
function applicationMessage(row: Row) { return fieldValue(row, ['message', 'content']) }
async function editRow(row: Row) {
  await openDetails(row)
  if (!detailError.value) startForm('edit', row)
}
function taskProgress(row: Row) {
  const files = rowsFrom(row.taskFiles)
  const total = files.reduce((sum, file) => sum + (numericField(file, ['total']) || 0), 0)
  const translated = files.reduce((sum, file) => sum + (numericField(file, ['translated']) || 0), 0)
  return total ? Math.min(100, Math.round(translated / total * 100)) : 0
}
function permissionLabel(value: unknown) { return statusText('members', value) }
function rowKey(row: Row, index: number) { return String(recordId(row) ?? `${sectionId.value}-${index}`) }
async function load(force = false) {
  const sequence = ++requestSequence, projectId = navigation.browse.id, section = sectionId.value
  if (!config.value || !navigation.projectChosen) { payload.value = null; busy.value = false; error.value = navigation.projectChosen ? '未知的项目栏目' : '请先选择 ParaTranz 项目'; return }
  if (section === 'overview') { payload.value = null; error.value = ''; busy.value = false; return }
  if (section === 'settings') {
    busy.value = true; error.value = ''
    try {
      const project = await props.editor.api<Row>('project', { projectId })
      if (sequence !== requestSequence) return
      payload.value = project
      projectSettingsName.value = fieldValue(project, ['name'])
      projectSettingsDesc.value = fieldValue(project, ['desc'])
      projectSettingsExpected.value = { name: projectSettingsName.value, desc: projectSettingsDesc.value }
    } catch (reason) { if (sequence === requestSequence) error.value = (reason as Error).message || '项目设置读取失败' }
    finally { if (sequence === requestSequence) busy.value = false }
    return
  }
  if (section === 'files') { payload.value = navigation.files; error.value = ''; busy.value = false; return }
  if (section === 'terms') {
    if (!force && termCatalogProjectId === projectId && Array.isArray(payload.value)) { busy.value = false; return }
    busy.value = true; error.value = ''; notice.value = ''
    try {
      const scope = projectTermCatalogScope(projectId, props.editor.sessionInfo.user?.id, props.editor.sessionInfo.mode)
      if (!force) {
        try {
          const cached = await readProjectTermCatalog(scope)
          if (sequence !== requestSequence) return
          if (cached) payload.value = cached.terms
        } catch { /* The remote catalog remains authoritative when local storage is unavailable. */ }
      }
      const allTerms: Term[] = []
      let nextPage = 1, lastPage = 1, expectedRows = 0
      do {
        const result = await props.editor.api<TermPage>('projectTerms', { projectId, page: nextPage, pageSize: 800 })
        if (sequence !== requestSequence) return
        if (!Array.isArray(result.results) || !Number.isInteger(result.pageCount) || !Number.isInteger(result.rowCount) || result.pageCount < 0 || result.pageCount > 100000 || result.rowCount < 0) throw new Error('术语目录分页数据无效')
        if (nextPage === 1) { lastPage = Math.max(1, result.pageCount); expectedRows = result.rowCount }
        else if (result.pageCount !== lastPage || result.rowCount !== expectedRows) throw new Error('术语目录在同步期间发生变化，请重试')
        if (result.results.some(term => !term || !Number.isInteger(term.id) || typeof term.term !== 'string' || typeof term.translation !== 'string')) throw new Error('术语目录包含无效记录')
        allTerms.push(...result.results)
        nextPage++
      } while (nextPage <= lastPage)
      if (sequence !== requestSequence) return
      const unique = new Map(allTerms.map(term => [term.id, term]))
      if (unique.size !== allTerms.length || unique.size !== expectedRows) throw new Error('术语目录分页结果不完整，请重试')
      const sorted = [...unique.values()].sort((a, b) => a.term.localeCompare(b.term) || a.id - b.id)
      payload.value = sorted
      termCatalogProjectId = projectId
      try { await syncProjectTermCatalog(scope, sorted) } catch { /* Keep the current remote result usable without local persistence. */ }
    } catch (reason) { if (sequence === requestSequence) error.value = (reason as Error).message || '术语目录加载失败' }
    finally { if (sequence === requestSequence) busy.value = false }
    return
  }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const query: Record<string, unknown> = { projectId, section, page: page.value, pageSize }
    if (section === 'issues' && statusFilter.value !== 'all') query.status = Number(statusFilter.value)
    if (section === 'applications' && statusFilter.value !== 'all') query.status = Number(statusFilter.value)
    if (section === 'announcements' && categoryFilter.value) query.category = categoryFilter.value
    if (section === 'announcements' && announcementPinnedOnly.value) query.bumped = true
    if (section === 'history') {
      if (historyType.value) query.type = historyType.value
      if (search.value.trim()) query.keyword = search.value.trim()
      if (historyBegin.value) query.begin = dateBoundary(historyBegin.value)
      if (historyEnd.value) query.end = dateBoundary(historyEnd.value, true)
    }
    payload.value = await props.editor.api<unknown>('projectSection', query)
  } catch (reason) { if (sequence === requestSequence) error.value = (reason as Error).message || `${sectionTitle.value}加载失败` }
  finally { if (sequence === requestSequence) busy.value = false }
}
async function openDetails(row: Row) {
  const sequence = ++detailSequence
  activeRow.value = row; detail.value = row; detailError.value = ''; dialogMode.value = 'detail'; detailBusy.value = false
  if (sectionId.value === 'issues') form.content = ''
  const id = recordId(row), section = sectionId.value
  if (!id || !['announcements', 'tasks', 'issues', 'terms'].includes(section)) return
  detailBusy.value = true
  try {
    const action = section === 'terms' ? 'term' : 'projectSectionDetail'
    const result = await props.editor.api<Row>(action, section === 'terms' ? { projectId: navigation.browse.id, termId: id } : { projectId: navigation.browse.id, section, resourceId: id })
    if (sequence === detailSequence) detail.value = objectValue(result) || row
  } catch (reason) { if (sequence === detailSequence) detailError.value = (reason as Error).message || '详情读取失败' }
  finally { if (sequence === detailSequence) detailBusy.value = false }
}
function resetForm() {
  Object.assign(form, { title: '', content: '', category: 'announcement', bumped: false, internal: false, deadline: '', translate: '', check: '', review: '', term: '', translation: '', pos: '', note: '', variants: '', caseSensitive: false, permission: 1, memberNote: '', reason: '' })
  formError.value = ''; selectedMemberUser.value = null; userMatches.value = []; memberSearch.value = ''
}
function toDateInput(value: unknown) {
  if (typeof value !== 'string' || !value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
function startForm(mode: FormMode, row?: Row) {
  resetForm(); formMode.value = mode
  activeRow.value = mode === 'create' || mode === 'member-add' ? null : row || activeRow.value
  const current = mode === 'create' || mode === 'member-add' ? {} : row || detail.value || {}
  form.title = fieldValue(current, ['title'])
  form.content = fieldValue(current, ['content'])
  form.category = fieldValue(current, ['category']) || 'announcement'
  form.bumped = !!rawField(current, ['bumpedAt'])
  form.internal = !!rawField(current, ['internal'])
  form.deadline = toDateInput(rawField(current, ['deadline']))
  const goal = objectValue(current.goal) || {}
  form.translate = typeof goal.translate === 'number' ? String(Math.round(goal.translate * 100)) : ''
  form.check = typeof goal.check === 'number' ? String(Math.round(goal.check * 100)) : ''
  form.review = typeof goal.review === 'number' ? String(Math.round(goal.review * 100)) : ''
  form.term = fieldValue(current, ['term'])
  form.translation = fieldValue(current, ['translation'])
  form.pos = fieldValue(current, ['pos'])
  form.note = fieldValue(current, ['note'])
  const variants = rawField(current, ['variants'])
  form.variants = Array.isArray(variants) ? variants.join('\n') : ''
  form.caseSensitive = !!rawField(current, ['caseSensitive'])
  form.permission = numericField(current, ['permission']) || 1
  form.memberNote = fieldValue(current, ['note'])
  dialogMode.value = 'form'
}
async function callSectionAction(operation: string, data: Row = {}, row = activeRow.value) {
  const resourceId = row ? recordId(row) : undefined
  actionBusy.value = operation; formError.value = ''; error.value = ''; notice.value = ''
  try {
    await props.editor.api('projectSectionAction', { projectId: navigation.browse.id, section: sectionId.value, operation, ...(resourceId ? { resourceId } : {}), data })
    await load()
    notice.value = '操作已完成'
    if (dialogMode.value === 'detail' && row) await openDetails(row)
    return true
  } catch (reason) {
    const message = (reason as Error).message || '操作失败'
    formError.value = message
    if (!dialogMode.value) error.value = message
    return false
  }
  finally { actionBusy.value = '' }
}
async function submitForm() {
  if (formBusy.value) return
  formBusy.value = true; formError.value = ''
  try {
    const section = sectionId.value, row = activeRow.value
    if (section === 'announcements') {
      const data = { title: form.title.trim(), content: form.content, category: form.category.trim() || 'announcement', bumped: form.bumped, internal: form.internal }
      if (await callSectionAction(formMode.value === 'edit' ? 'update' : 'create', data, formMode.value === 'edit' ? row : null)) dialogMode.value = ''
      return
    }
    if (section === 'tasks') {
      const goal: Record<string, number> = {}
      for (const [key, value] of [['translate', form.translate], ['check', form.check], ['review', form.review]] as const) if (value.trim()) goal[key] = Number(value) / 100
      if (formMode.value === 'create' && !Object.keys(goal).length) throw new Error('请至少填写一个任务目标百分比')
      if (Object.values(goal).some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('任务目标须为 0 到 100 的百分比')
      const data: Row = { title: form.title.trim(), content: form.content, goal, bumped: form.bumped, deadline: form.deadline ? new Date(form.deadline).toISOString() : null }
      if (await callSectionAction(formMode.value === 'edit' ? 'update' : 'create', data, formMode.value === 'edit' ? row : null)) dialogMode.value = ''
      return
    }
    if (section === 'issues') {
      const operation = formMode.value === 'reply' ? 'reply' : formMode.value === 'edit' ? 'update' : 'create'
      const data = formMode.value === 'reply' ? { content: form.content } : { title: form.title.trim(), content: form.content }
      if (await callSectionAction(operation, data, formMode.value === 'create' ? null : row)) {
        if (formMode.value === 'reply') form.content = ''
        else dialogMode.value = ''
      }
      return
    }
    if (section === 'terms') {
      const variants = [...new Set(form.variants.split(/\r?\n/).map(value => value.trim()).filter(Boolean))]
      const data: Omit<Term, 'id'> = { term: form.term.trim(), translation: form.translation.trim(), pos: form.pos, note: form.note, variants, caseSensitive: form.caseSensitive }
      const operation = formMode.value === 'edit' ? 'updateTerm' : 'createTerm'
      const result = formMode.value === 'edit' && row
        ? await props.editor.api(operation, { projectId: navigation.browse.id, termId: recordId(row), expected: detail.value || row, ...data })
        : await props.editor.api(operation, { projectId: navigation.browse.id, ...data })
      void result
      dialogMode.value = ''; termCatalogProjectId = 0; page.value = 1; await load(true); notice.value = '术语已保存'; return
    }
    if (section === 'members') {
      if (formMode.value === 'member-add') {
        const uid = numericField(selectedMemberUser.value, ['id', 'uid'])
        if (!uid) throw new Error('请先搜索并选择一个用户')
        if (await callSectionAction('add', { uid, permission: form.permission }, null)) dialogMode.value = ''
      } else if (formMode.value === 'member-edit' && row) {
        if (await callSectionAction('update', { permission: form.permission, note: form.memberNote }, row)) dialogMode.value = ''
      }
      return
    }
    if (section === 'applications' && row) {
      const operation = formMode.value === 'application-approve' ? 'approve' : 'reject'
      if (await callSectionAction(operation, { reason: form.reason }, row)) dialogMode.value = ''
    }
  } catch (reason) { formError.value = (reason as Error).message || '表单内容无效' }
  finally { formBusy.value = false }
}
function formTitle() {
  if (formMode.value === 'reply') return '回复讨论'
  if (formMode.value === 'member-add') return '添加项目成员'
  if (formMode.value === 'member-edit') return '编辑成员权限'
  if (formMode.value === 'application-approve') return '通过申请'
  if (formMode.value === 'application-reject') return '拒绝申请'
  return `${formMode.value === 'edit' ? '编辑' : '新建'}${sectionTitle.value.replace(/s$/, '')}`
}
function startHeaderAction() {
  if (sectionId.value === 'artifact') { void callSectionAction('generate', {}, null); return }
  startForm(sectionId.value === 'announcements' ? 'create' : sectionId.value === 'tasks' ? 'create' : sectionId.value === 'issues' ? 'create' : sectionId.value === 'terms' ? 'create' : 'member-add')
}
function closeDialog() { if (formBusy.value || actionBusy.value || detailBusy.value) return; dialogMode.value = ''; detailError.value = ''; formError.value = '' }
async function searchMembers() {
  clearTimeout(memberSearchTimer)
  const query = memberSearch.value.trim()
  if (!query) { userMatches.value = []; return }
  userSearchBusy.value = true
  try { userMatches.value = rowsFrom(await props.editor.api<unknown>('userSearch', { projectId: navigation.browse.id, query })) }
  catch (reason) { formError.value = (reason as Error).message || '用户搜索失败' }
  finally { userSearchBusy.value = false }
}
function selectMemberUser(user: Row) { selectedMemberUser.value = user; memberSearch.value = fieldValue(user, ['nickname', 'username']) }
async function deleteActive() {
  const row = activeRow.value
  if (!row) return
  const operation = sectionId.value === 'terms' ? 'deleteTerm' : 'delete'
  if (!window.confirm(`确定删除「${fieldValue(row, titleFields.value) || sectionTitle.value}」吗？`)) return
  if (sectionId.value === 'terms') {
    actionBusy.value = operation; formError.value = ''
    try {
      await props.editor.api('deleteTerm', { projectId: navigation.browse.id, termId: recordId(row), expected: detail.value || row })
      dialogMode.value = ''; termCatalogProjectId = 0; await load(true); notice.value = '术语已删除'
    } catch (reason) { formError.value = (reason as Error).message || '删除失败' }
    finally { actionBusy.value = '' }
  } else if (await callSectionAction(operation, {}, row)) dialogMode.value = ''
}
async function toggleIssueStatus() {
  if (!activeRow.value) return
  const status = numericField(detail.value || activeRow.value, ['status']) === 1 ? 0 : 1
  await callSectionAction('update', { status }, activeRow.value)
}
async function toggleTask(operation: 'finish' | 'pin' | 'unpin') {
  if (!activeRow.value) return
  await callSectionAction(operation, {}, activeRow.value)
}
async function toggleSubscription() {
  if (!activeRow.value) return
  await callSectionAction(subscribed.value ? 'unsubscribe' : 'subscribe', {}, activeRow.value)
}
async function manageTaskFile(operation: 'addFile' | 'removeFile', row?: Row) {
  if (!activeRow.value) return
  const selected = operation === 'addFile' ? Number(selectedTaskFile.value) : numericField(row || {}, ['file.id', 'fileId', 'id'])
  if (!selected) return
  if (operation === 'removeFile' && !window.confirm('从任务中移除这个文件？')) return
  const done = await callSectionAction(operation, operation === 'addFile' ? { fileId: selected, mode: taskFileMode.value } : { fileId: selected }, activeRow.value)
  if (done) selectedTaskFile.value = ''
}
async function saveArtifact() {
  if (!artifactAgreement.value) { error.value = '请先确认遵守项目许可协议'; return }
  actionBusy.value = 'download-artifact'; error.value = ''
  try {
    const result = await window.scKit?.saveProjectArtifact(navigation.browse.id, `${navigation.browse.name}-最新导出.zip`)
    if (!result?.ok) throw new Error(result?.message || '导出文件下载失败')
    notice.value = result.data?.canceled ? '已取消保存' : '导出文件已保存到本机'
  } catch (reason) { error.value = (reason as Error).message || '导出文件下载失败' }
  finally { actionBusy.value = '' }
}
async function saveProjectSettings() {
  const expected = projectSettingsExpected.value
  if (!expected || projectSettingsBusy.value) return
  const name = projectSettingsName.value.trim(), desc = projectSettingsDesc.value
  if (!name || name.length > 500 || desc.length > 50_000) { error.value = '项目名称须为 1 到 500 个字符，项目介绍最多 50000 个字符'; return }
  projectSettingsBusy.value = true; error.value = ''; notice.value = ''
  try {
    await props.editor.api('updateProject', { projectId: navigation.browse.id, expectedName: expected.name, expectedDesc: expected.desc, name, desc })
    projectSettingsExpected.value = { name, desc }
    payload.value = { ...objectValue(payload.value), name, desc }
    Object.assign(navigation.browse, { name, desc })
    const summary = navigation.projects.find(item => item.id === navigation.browse.id)
    if (summary) summary.name = name
    notice.value = '项目资料已保存'
  } catch (reason) { error.value = (reason as Error).message || '项目资料保存失败' }
  finally { projectSettingsBusy.value = false }
}
function changeFilter() { if (page.value !== 1) page.value = 1; else void load() }
function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') closeDialog() }
watch(sectionId, () => { page.value = 1; search.value = ''; statusFilter.value = 'all'; taskStatusFilter.value = 'all'; memberRoleFilter.value = 'all'; categoryFilter.value = ''; announcementPinnedOnly.value = false; historyType.value = ''; historyBegin.value = ''; historyEnd.value = ''; artifactAgreement.value = false; dialogMode.value = ''; fileEditTarget.value = null })
watch(() => navigation.browse.id, () => { termCatalogProjectId = 0; payload.value = null; page.value = 1; fileEditTarget.value = null; expandedFileFolders.value = [''] })
watch(() => [sectionId.value, navigation.browse.id, page.value] as const, () => { void load() }, { immediate: true })
watch(memberSearch, value => {
  clearTimeout(memberSearchTimer)
  if (selectedMemberUser.value && value !== fieldValue(selectedMemberUser.value, ['nickname', 'username'])) selectedMemberUser.value = null
  if (value.trim().length >= 1) memberSearchTimer = setTimeout(() => { void searchMembers() }, 250)
})
watch(dialogMode, mode => { if (mode) window.addEventListener('keydown', closeOnEscape); else window.removeEventListener('keydown', closeOnEscape) })
onBeforeUnmount(() => { clearTimeout(memberSearchTimer); window.removeEventListener('keydown', closeOnEscape) })
</script>

<template>
  <ProjectHome v-if="sectionId === 'overview'" :editor="props.editor" />
  <main v-else class="project-section-page">
    <header class="section-header">
      <div class="section-heading">
        <div class="section-breadcrumb">{{ navigation.browse.name }} <span>/</span> #{{ navigation.browse.id }}</div>
        <div class="section-title"><component :is="config?.icon || Files" :size="20" /><h1>{{ sectionTitle }}</h1><span v-if="busy" class="section-saving">同步中</span></div>
        <p>{{ config?.description || '在 Pulsar 工作区中管理项目内容。' }}</p>
      </div>
      <div class="section-header-actions">
        <button v-if="headerAction" class="button compact primary" :disabled="busy || !!actionBusy || navigation.blocked" @click="startHeaderAction"><component :is="headerActionIcon" :size="14" />{{ headerActionLabel }}</button>
        <button class="button compact" :disabled="busy || !!actionBusy || (sectionId === 'files' && navigation.busy)" title="重新载入" @click="refreshSection"><RefreshCw :size="14" :class="{ spin: busy || (sectionId === 'files' && navigation.busy) }" />刷新</button>
      </div>
    </header>

    <div v-if="!['settings', 'artifact'].includes(sectionId)" class="section-toolbar">
      <label v-if="['history', 'announcements', 'tasks', 'files', 'terms', 'issues', 'members', 'applications', 'leaderboard'].includes(sectionId)" class="section-search"><Search :size="14" /><input v-model="search" :placeholder="`搜索${sectionTitle}`" :aria-label="`搜索${sectionTitle}`" @keyup.enter="sectionId === 'history' && changeFilter()" /></label>
      <template v-if="sectionId === 'files'">
        <button class="button compact" :disabled="!fileFolderCount || allFileFoldersExpanded || !!search.trim()" @click="expandFileFolders"><ChevronsDown :size="14" />展开文件夹</button>
        <button class="button compact" :disabled="!fileFolderCount || !anyFileFolderExpanded || !!search.trim()" @click="collapseFileFolders"><ChevronsUp :size="14" />折叠文件夹</button>
      </template>
      <select v-if="sectionId === 'tasks'" v-model="taskStatusFilter" aria-label="任务状态" @change="changeFilter"><option value="all">全部任务</option><option value="0">进行中</option><option value="1">已完成</option></select>
      <select v-if="sectionId === 'issues'" v-model="statusFilter" aria-label="讨论状态" @change="changeFilter"><option value="all">全部讨论</option><option value="0">讨论中</option><option value="1">已关闭</option></select>
      <select v-if="sectionId === 'applications'" v-model="statusFilter" aria-label="申请状态" @change="changeFilter"><option value="all">全部申请</option><option value="0">待审核</option><option value="2">已通过</option><option value="1">已拒绝</option></select>
      <select v-if="sectionId === 'members'" v-model="memberRoleFilter" aria-label="成员权限" @change="changeFilter"><option value="all">全部权限</option><option value="1">翻译者</option><option value="2">校对者</option><option value="3">管理员</option><option value="10">所有者</option></select>
      <select v-if="sectionId === 'announcements'" v-model="categoryFilter" aria-label="公告分类" @change="changeFilter"><option value="">全部分类</option><option value="announcement">公告</option><option value="blog">项目动态</option></select>
      <label v-if="sectionId === 'announcements'" class="section-toolbar-check"><input v-model="announcementPinnedOnly" type="checkbox" @change="changeFilter" />仅看置顶</label>
      <template v-if="sectionId === 'history'">
        <select v-model="historyType" aria-label="历史记录类型" @change="changeFilter"><option value="">默认</option><option value="translate">翻译</option><option value="edit">编辑</option><option value="review">审核</option><option value="comment">注释</option><option value="term">术语</option><option value="import">导入</option></select>
        <label class="section-date-filter"><span>从</span><input v-model="historyBegin" type="date" aria-label="历史记录开始日期" /></label><label class="section-date-filter"><span>至</span><input v-model="historyEnd" type="date" aria-label="历史记录结束日期" /></label><button class="button compact" @click="changeFilter"><Search :size="13" />筛选</button>
      </template>
      <span class="section-count">{{ totalCount.toLocaleString() }} {{ sectionId === 'files' ? '个文件' : sectionId === 'members' ? '位成员' : sectionId === 'terms' ? '个术语' : sectionId === 'announcements' ? '条公告' : '条记录' }}</span>
    </div>
    <div v-if="notice" class="section-notice" role="status"><Check :size="14" />{{ notice }}<button class="icon-button small" aria-label="关闭提示" @click="notice = ''"><X :size="13" /></button></div>
    <div v-if="error" class="section-message error" role="alert"><span>{{ error }}</span><button class="button compact" @click="load()">重试</button></div>
    <div v-else-if="busy && !rowList.length" class="section-loading" role="status"><LoadingIndicator :size="20" label="正在载入项目内容" />正在载入{{ sectionTitle }}…</div>
    <section v-else-if="sectionId === 'settings'" class="section-workspace project-settings-workspace">
      <form class="project-settings-form" @submit.prevent="saveProjectSettings">
        <div class="workflow-section-heading"><div><h2>项目资料</h2><p>项目名称和介绍会显示在项目概览及成员的项目列表中。</p></div><span class="section-status">{{ projectPermission }}</span></div>
        <label class="section-field"><span>项目名称 <b>*</b></span><input v-model="projectSettingsName" maxlength="500" required /></label>
        <label class="section-field"><span>项目介绍</span><textarea v-model="projectSettingsDesc" rows="5" maxlength="50000" /></label>
        <div class="project-settings-readonly"><div><small>项目编号</small><strong>#{{ navigation.browse.id }}</strong></div><div><small>原文语言</small><strong>{{ navigation.browse.source || '—' }}</strong></div><div><small>目标语言</small><strong>{{ navigation.browse.dest || '—' }}</strong></div><div><small>当前版本</small><strong>{{ fieldValue(payload || {}, ['version', 'currentVersion']) || '—' }}</strong></div></div>
        <footer class="project-settings-footer"><span>保存时会检测项目资料是否已被其他成员更新。</span><button class="button compact primary" type="submit" :disabled="projectSettingsBusy || navigation.blocked || !projectSettingsName.trim() || (projectSettingsExpected?.name === projectSettingsName.trim() && projectSettingsExpected?.desc === projectSettingsDesc)"><Check :size="13" />{{ projectSettingsBusy ? '保存中…' : '保存资料' }}</button></footer>
      </form>
      <section class="project-settings-shortcuts"><div class="workflow-section-heading"><div><h2>项目管理</h2><p>打开对应栏目执行具体管理操作。</p></div></div><div class="project-management-links"><button @click="navigation.openProjectSection('files')"><Files :size="17" /><span><strong>文件与翻译</strong><small>浏览文件、查看进度并打开编辑器</small></span><ChevronRight :size="15" /></button><button @click="navigation.openProjectSection('members')"><UsersRound :size="17" /><span><strong>成员与权限</strong><small>查看贡献、邀请成员和调整角色</small></span><ChevronRight :size="15" /></button><button @click="navigation.openProjectSection('terms')"><BookOpen :size="17" /><span><strong>术语管理</strong><small>搜索、编辑并统一项目术语</small></span><ChevronRight :size="15" /></button><button @click="navigation.openProjectSection('artifact')"><Download :size="17" /><span><strong>构建与下载</strong><small>查看构建状态并生成导出文件</small></span><ChevronRight :size="15" /></button></div></section>
    </section>
    <section v-else-if="sectionId === 'history'" class="section-workspace history-workspace" :aria-busy="busy">
      <div v-if="visibleRows.length" class="history-timeline">
        <article v-for="(row, index) in visibleRows" :key="rowKey(row, index)" class="history-entry">
          <div class="history-entry-rail"><span><Check v-if="['review', 'check'].includes(String(rawField(row, ['operation'])))" :size="13" /><Activity v-else :size="13" /></span></div>
          <div class="history-entry-main">
            <header><strong>{{ fieldValue(row, ['user.nickname', 'user.username']) || `用户 ${fieldValue(row, ['uid'])}` }}</strong><span class="section-status">{{ statusText('history', rawField(row, ['operation'])) }}</span><time>{{ displayDate(rawField(row, ['createdAt'])) }}</time></header>
            <div class="history-entry-target"><span>修改词条</span><button v-if="numericField(row, ['tid'])" :disabled="navigation.blocked" @click="navigation.openString(navigation.browse.id, numericField(row, ['tid'])!)">{{ historyKey(row) }}<ArrowRight :size="12" /></button><strong v-else>{{ historyKey(row) }}</strong><small v-if="rawField(row, ['field'])">字段：{{ fieldValue(row, ['field']) }}</small></div>
            <div v-if="historyComparison(row)" class="history-entry-diff unified">
              <div class="history-diff-column"><p><template v-for="(part, partIndex) in historyComparison(row)!.changes" :key="partIndex"><del v-if="part.kind === 'removed'">{{ part.text }}</del><ins v-else-if="part.kind === 'added'">{{ part.text }}</ins><span v-else>{{ part.text }}</span></template></p></div>
            </div>
            <div v-else class="history-diff-empty">此记录没有文本变更</div>
          </div>
        </article>
      </div>
      <div v-else class="workflow-empty"><History :size="28" /><strong>{{ search ? '没有匹配的历史记录' : '还没有项目变更' }}</strong><span>调整筛选条件，或稍后刷新查看新动态。</span></div>
    </section>
    <section v-else-if="sectionId === 'announcements'" class="section-workspace announcement-workspace" :aria-busy="busy">
      <div v-if="visibleRows.length" class="announcement-feed"><article v-for="(row, index) in visibleRows" :key="rowKey(row, index)" class="announcement-entry"><div class="announcement-entry-mark"><Megaphone :size="17" /></div><div class="announcement-entry-main"><header><div class="announcement-tags"><span class="announcement-category">{{ announcementCategory(row) }}</span><span v-if="rawField(row, ['bumpedAt'])" class="announcement-pinned"><Pin :size="11" />置顶</span><span v-if="rawField(row, ['internal'])" class="announcement-internal">成员可见</span></div><time>{{ displayDate(rawField(row, ['createdAt'])) }}</time></header><button class="announcement-title" @click="openDetails(row)">{{ fieldValue(row, ['title']) || '未命名公告' }}</button><p>{{ excerpt(row) || '点击查看公告正文。' }}</p><footer><span>{{ announcementAuthor(row) }}</span><span>{{ numericField(row, ['commentsCount']) || 0 }} 条回复</span><div class="announcement-actions"><button class="button compact" @click="openDetails(row)">阅读公告</button><button v-if="canManage" class="button compact" @click="editRow(row)"><Settings2 :size="12" />编辑</button></div></footer></div></article></div><div v-else class="workflow-empty"><Megaphone :size="28" /><strong>{{ search ? '没有匹配的公告' : '暂无公告' }}</strong><span>{{ canManage ? '发布公告后，项目成员可以在这里阅读更新。' : '项目管理员发布的公告会显示在这里。' }}</span><button v-if="canManage" class="button compact primary" @click="startForm('create')"><Plus :size="13" />发布公告</button></div>
    </section>
    <section v-else-if="sectionId === 'tasks'" class="section-workspace task-workspace" :aria-busy="busy">
      <div class="task-board"><section class="task-lane"><header><span class="task-lane-dot active" /><h2>进行中</h2><small>{{ activeTasks.length }}</small><button v-if="canManage" class="icon-button small" aria-label="创建任务" title="创建任务" @click="startForm('create')"><Plus :size="15" /></button></header><div v-if="activeTasks.length" class="task-card-list"><article v-for="(row, index) in activeTasks" :key="rowKey(row, index)" class="task-entry"><div class="task-entry-top"><span class="section-status" :class="{ done: Number(rawField(row, ['status'])) === 1 }">{{ statusText('tasks', rawField(row, ['status'])) }}</span><span v-if="rawField(row, ['bumpedAt'])" class="task-pinned"><Pin :size="11" />置顶</span></div><button class="task-entry-title" @click="openDetails(row)">{{ fieldValue(row, ['title']) || '未命名任务' }}</button><p>{{ excerpt(row, 130) || '暂无任务说明。' }}</p><div class="task-progress-label"><span>翻译进度</span><strong>{{ taskProgress(row) }}%</strong></div><div class="task-progress"><span :style="{ width: `${taskProgress(row)}%` }" /></div><div class="task-entry-meta"><span><Files :size="12" />{{ rowsFrom(row.taskFiles).length }} 个文件</span><span><History :size="12" />{{ rawField(row, ['deadline']) ? `截止 ${displayDate(rawField(row, ['deadline']))}` : '无截止日期' }}</span></div><footer><button class="button compact" @click="openDetails(row)">查看任务</button><button v-if="canManage" class="button compact" @click="editRow(row)"><Settings2 :size="12" />编辑</button><button v-if="canManage" class="button compact" @click="activeRow = row; void toggleTask('finish')"><Check :size="12" />完成</button></footer></article></div><div v-else class="workflow-lane-empty"><ListChecks :size="23" /><span>{{ search ? '没有匹配的进行中任务' : '当前没有进行中的任务' }}</span></div></section><section class="task-lane finished"><header><span class="task-lane-dot done" /><h2>已完成</h2><small>{{ finishedTasks.length }}</small></header><div v-if="finishedTasks.length" class="task-card-list"><article v-for="(row, index) in finishedTasks" :key="rowKey(row, index)" class="task-entry"><div class="task-entry-top"><span class="section-status done">已完成</span><span v-if="rawField(row, ['bumpedAt'])" class="task-pinned"><Pin :size="11" />置顶</span></div><button class="task-entry-title" @click="openDetails(row)">{{ fieldValue(row, ['title']) || '未命名任务' }}</button><p>{{ excerpt(row, 130) || '暂无任务说明。' }}</p><div class="task-entry-meta"><span><Files :size="12" />{{ rowsFrom(row.taskFiles).length }} 个文件</span><span>{{ displayDate(rawField(row, ['updatedAt', 'createdAt'])) }}</span></div><footer><button class="button compact" @click="openDetails(row)">查看任务</button></footer></article></div><div v-else class="workflow-lane-empty"><Check :size="23" /><span>暂无已完成任务</span></div></section></div>
    </section>
    <section v-else-if="sectionId === 'files'" class="section-workspace file-workspace" :aria-busy="busy || navigation.busy || fileSaving">
      <div class="file-overview-bar"><span><strong>{{ matchedRows.length.toLocaleString() }}</strong> 个文件</span><span><strong>{{ matchedRows.reduce((sum, row) => sum + (numericField(row, ['total']) || 0), 0).toLocaleString() }}</strong> 条词条</span><span><strong>{{ matchedRows.reduce((sum, row) => sum + (numericField(row, ['translated']) || 0), 0).toLocaleString() }}</strong> 已翻译</span></div>
      <form v-if="fileEditTarget" class="file-edit-form" @submit.prevent="saveFileEdit"><strong>重命名 / 移动文件</strong><label for="section-file-edit-name">完整文件路径（使用 / 分隔）</label><input id="section-file-edit-name" v-model="fileEditName" :disabled="fileSaving" required maxlength="1000" /><div><button type="button" class="button compact" :disabled="fileSaving" @click="cancelFileEdit">取消</button><button class="button compact primary" :disabled="fileSaving || !fileEditName.trim()"><LoadingIndicator v-if="fileSaving" :size="13" label="正在保存文件修改" />{{ fileSaving ? '保存中…' : '保存修改' }}</button></div></form>
      <div v-if="groupedFiles.length" class="sidebar-file-groups file-page-groups"><MotionFolder v-for="[folder, entries] in groupedFiles" :key="folder" :open="fileFolderOpen(folder)" :class="{ 'root-file-group': folder === '' }" :title="search.trim() ? '搜索结果保持展开' : `${fileFolderOpen(folder) ? '收起' : '展开'} ${folder || '项目根目录'}`" @toggle="toggleFileFolder(folder)"><template #heading><ChevronRight class="folder-chevron" :class="{ expanded: fileFolderOpen(folder) }" :size="16" /><FolderOpen v-if="fileFolderOpen(folder)" :size="17" /><FolderClosed v-else :size="17" /><span>{{ folder || '项目根目录' }}<small v-if="folder === ''" class="root-directory-label">根目录</small></span><small>{{ entries.length }} 个文件</small><small class="folder-action-hint">{{ fileFolderOpen(folder) ? '收起' : '展开' }}</small></template><div v-for="(row, index) in entries" :key="rowKey(row, index)" class="sidebar-file" :class="{ active: props.editor.workspaceReady && navigation.browse.id === props.editor.project.id && fileFrom(row)?.id === props.editor.fileId }"><button class="sidebar-file-select" :disabled="navigation.blocked" :title="fieldValue(row, ['name'])" @click="fileFrom(row) && navigation.chooseFile(fileFrom(row)!)"><FileText :size="20" /><span><strong>{{ fieldValue(row, ['name']).split('/').at(-1) }} <span v-if="props.editor.workspaceReady && navigation.browse.id === props.editor.project.id && fileFrom(row)?.id === props.editor.fileId" class="manager-active-file">正在翻译</span></strong><small>{{ (numericField(row, ['translated']) || 0).toLocaleString() }} / {{ (numericField(row, ['total']) || 0).toLocaleString() }} 条已翻译 · {{ filePercent(row) }}%</small><span class="sidebar-progress"><span :style="{ width: `${filePercent(row)}%` }" /></span></span><span class="manager-enter-file">开始翻译 <ChevronRight :size="15" /></span></button><div class="sidebar-file-actions"><button class="icon-button" :aria-label="`重命名文件 ${fieldValue(row, ['name'])}`" :disabled="fileSaving || !canManage" :title="canManage ? '重命名 / 移动文件' : '需要项目管理员权限'" @click="beginFileEdit(row)"><Pencil :size="15" /></button><button class="icon-button" :aria-label="`在 ParaTranz 查看文件 ${fieldValue(row, ['name'])}`" title="在 ParaTranz 查看文件" :disabled="!props.editor.desktop" @click="openFileInParaTranz(row)"><ExternalLink :size="15" /></button></div></div></MotionFolder></div><div v-else class="workflow-empty"><Files :size="28" /><strong>{{ search ? '没有匹配的文件' : '项目中还没有文件' }}</strong><span>上传的项目文件会按目录显示在这里。</span></div>
    </section>
    <section v-else-if="sectionId === 'terms'" class="section-workspace term-workspace" :aria-busy="busy">
      <div class="term-workspace-heading"><div><strong>项目术语库</strong><span>搜索原文、译文、变体或备注；选择一项可查看上下文和编辑。</span></div><span>{{ matchedRows.length.toLocaleString() }} 条</span></div>
      <div v-if="visibleRows.length" class="term-table-wrap"><table class="term-table"><thead><tr><th>原文</th><th>译文</th><th>词性</th><th>变体与备注</th><th></th></tr></thead><tbody><tr v-for="(row, index) in visibleRows" :key="rowKey(row, index)"><td><button class="term-source" @click="openDetails(row)">{{ fieldValue(row, ['term']) }}</button></td><td>{{ fieldValue(row, ['translation']) }}</td><td><span class="term-pos">{{ statusText('terms', rawField(row, ['pos'])) }}</span></td><td><span class="term-extra">{{ fieldValue(row, ['variants']) || fieldValue(row, ['note']) || '—' }}</span></td><td><button class="icon-button small" :aria-label="`编辑术语 ${fieldValue(row, ['term'])}`" title="编辑术语" @click="editRow(row)"><Settings2 :size="13" /></button></td></tr></tbody></table></div><div v-else class="workflow-empty"><BookOpen :size="28" /><strong>{{ search ? '没有匹配的术语' : '术语库为空' }}</strong><span>新增项目术语，让翻译和校对使用统一译名。</span><button class="button compact primary" @click="startForm('create')"><Plus :size="13" />新建术语</button></div>
      <footer v-if="pageCount > 1" class="section-footer"><span>共 {{ totalCount.toLocaleString() }} 条 · 第 {{ page }} 页 / {{ pageCount }}</span><div><button class="button compact" :disabled="page <= 1" @click="page--"><ChevronLeft :size="14" />上一页</button><button class="button compact" :disabled="page >= pageCount" @click="page++">下一页<ChevronRight :size="14" /></button></div></footer>
    </section>
    <section v-else-if="sectionId === 'issues'" class="section-workspace discussion-workspace" :aria-busy="busy">
      <div v-if="visibleRows.length" class="discussion-list"><article v-for="(row, index) in visibleRows" :key="rowKey(row, index)" class="discussion-entry" @dblclick="openDetails(row)"><div class="discussion-entry-icon"><MessageSquare :size="16" /></div><div class="discussion-entry-main"><header><button class="discussion-entry-title" @click="openDetails(row)">{{ fieldValue(row, ['title']) || '未命名讨论' }}</button><span class="section-status" :class="{ done: Number(rawField(row, ['status'])) === 1 }">{{ statusText('issues', rawField(row, ['status'])) }}</span></header><p>{{ excerpt(row, 200) || '打开主题查看讨论详情并回复。' }}</p><footer><span>{{ fieldValue(row, ['user.nickname', 'user.username']) || `用户 ${fieldValue(row, ['uid'])}` }}</span><span><MessageSquare :size="12" />{{ numericField(row, ['commentsCount', 'replies.length', 'activities.length']) || 0 }} 条回复</span><time>{{ displayDate(rawField(row, ['updatedAt', 'createdAt'])) }}</time><button class="button compact" @click="openDetails(row)">打开讨论</button></footer></div></article></div><div v-else class="workflow-empty"><MessageSquare :size="28" /><strong>{{ search ? '没有匹配的讨论' : '暂无讨论' }}</strong><span>发起讨论，与项目成员协作解决翻译问题。</span><button class="button compact primary" @click="startForm('create')"><Plus :size="13" />发起讨论</button></div>
    </section>
    <section v-else-if="sectionId === 'members'" class="section-workspace member-workspace" :aria-busy="busy">
      <div class="member-summary-strip">
        <span>项目成员<strong>{{ totalCount }}</strong></span>
        <span>当前显示<strong>{{ matchedRows.length }}</strong></span>
        <span v-if="canManage">拥有者与管理员可以调整角色和成员备注</span>
      </div>
      <div v-if="memberGroups.length" class="member-directory">
        <section v-for="group in memberGroups" :key="group.id" class="member-role-group">
          <header><h2>{{ group.title }}</h2><span>{{ group.rows.length }}</span></header>
          <div class="member-role-group-list">
            <article v-for="(row, index) in group.rows" :key="`${group.id}-${rowKey(row, index)}`" class="member-entry">
              <UserAvatar :url="fieldValue(row, ['user.avatar', 'avatar'])" :label="memberName(row)" />
              <div class="member-main">
                <div class="member-name-line"><strong>{{ memberName(row) }}</strong><span class="member-role" :class="`role-${numericField(row, ['permission']) || 0}`">{{ permissionLabel(rawField(row, ['permission'])) }}</span></div>
                <small>@{{ fieldValue(row, ['user.username', 'username']) || '—' }} · 加入于 {{ displayDate(rawField(row, ['createdAt'])) }}</small>
                <div class="member-contributions"><span>翻译 <b>{{ numericField(row, ['translated']) || 0 }}</b></span><span>编辑 <b>{{ numericField(row, ['edited']) || 0 }}</b></span><span>审核 <b>{{ numericField(row, ['reviewed']) || 0 }}</b></span><span>贡献值 <b>{{ numericField(row, ['totalPoints']) || 0 }}</b></span></div>
                <div v-if="rawField(row, ['note'])" class="member-note">{{ fieldValue(row, ['note']) }}</div>
              </div>
              <div class="member-entry-actions"><button class="button compact" @click="openDetails(row)">成员详情</button><button v-if="canManage" class="button compact" @click="startForm('member-edit', row)"><Settings2 :size="12" />管理</button></div>
            </article>
          </div>
        </section>
      </div>
      <div v-else class="workflow-empty">
        <UsersRound :size="28" />
        <strong>{{ search || memberRoleFilter !== 'all' ? '没有匹配的成员' : '暂无项目成员' }}</strong>
        <span>{{ search || memberRoleFilter !== 'all' ? '试试调整搜索内容或角色筛选。' : '添加译者和校对者后，可以在这里查看贡献和权限。' }}</span>
        <button v-if="canManage && !search && memberRoleFilter === 'all'" class="button compact primary" @click="startForm('member-add')"><UserRoundPlus :size="13" />添加成员</button>
      </div>
    </section>
    <section v-else-if="sectionId === 'applications'" class="section-workspace application-workspace" :aria-busy="busy">
      <div class="application-queue-heading"><div><h2>{{ statusFilter === '0' ? '待审核申请' : statusFilter === '2' ? '已通过' : statusFilter === '1' ? '已拒绝' : '加入项目申请' }}</h2><p>阅读申请说明后，在详情中查看记录并处理待审核项目。</p></div><span class="application-queue-count">{{ totalCount }}</span></div><div v-if="visibleRows.length" class="application-queue"><article v-for="(row, index) in visibleRows" :key="rowKey(row, index)" class="application-entry"><UserAvatar :url="fieldValue(row, ['user.avatar', 'avatar'])" :label="memberName(row)" /><div class="application-entry-main"><header><strong>{{ memberName(row) }}</strong><span class="section-status" :class="{ done: Number(rawField(row, ['status'])) === 2 }">{{ statusText('applications', rawField(row, ['status'])) }}</span><time>{{ displayDate(rawField(row, ['createdAt'])) }}</time></header><p>{{ excerpt({ content: applicationMessage(row) }, 300) || '申请者没有填写说明。' }}</p><footer><button class="button compact" @click="openDetails(row)">查看申请</button><template v-if="canManage && Number(rawField(row, ['status'])) === 0"><button class="button compact primary" @click="startForm('application-approve', row)"><Check :size="12" />通过</button><button class="button compact danger" @click="startForm('application-reject', row)">拒绝</button></template><span v-if="rawField(row, ['reason'])" class="application-reason">处理说明：{{ fieldValue(row, ['reason']) }}</span></footer></div></article></div><div v-else class="workflow-empty"><UserRoundPlus :size="28" /><strong>{{ search ? '没有匹配的申请' : '当前没有申请' }}</strong><span>新的项目加入申请会显示在此队列中。</span></div>
    </section>
    <section v-else-if="sectionId === 'leaderboard'" class="section-workspace leaderboard-workspace" :aria-busy="busy">
      <div class="leaderboard-heading"><div><h2>项目贡献排行</h2><p>按贡献值排序 · 翻译、编辑及审核按 ParaTranz 规则加权统计</p></div><Trophy :size="22" /></div>
      <div v-if="visibleRows.length" class="leaderboard-list"><article v-for="(row, index) in visibleRows" :key="rowKey(row, index)" class="leaderboard-entry"><strong class="leaderboard-rank" :class="{ podium: (page - 1) * pageSize + index < 3 }">{{ (page - 1) * pageSize + index + 1 }}</strong><UserAvatar :url="fieldValue(row, ['user.avatar', 'avatar'])" :label="memberName(row)" :size="30" /><div class="leaderboard-member"><strong>{{ memberName(row) }}</strong><small>{{ leaderboardContribution(row).toLocaleString() }} 贡献值</small></div><div class="leaderboard-score"><div><span>综合贡献</span><strong>{{ leaderboardContribution(row).toLocaleString() }}</strong></div><div class="leaderboard-bar"><span :style="{ width: `${Math.min(100, leaderboardContribution(row) / topLeaderboardScore * 100)}%` }" /></div></div><div class="leaderboard-breakdown"><span>翻译 <b>{{ numericField(row, ['translated']) || 0 }}</b></span><span>编辑 <b>{{ numericField(row, ['edited']) || 0 }}</b></span><span>审核 <b>{{ numericField(row, ['reviewed']) || 0 }}</b></span></div></article></div><div v-else class="workflow-empty"><Trophy :size="28" /><strong>{{ search ? '没有匹配的排行榜成员' : '暂时没有贡献记录' }}</strong><span>项目成员的贡献统计会显示在这里。</span></div>
    </section>
    <section v-else-if="sectionId === 'artifact'" class="section-workspace artifact-workspace" :aria-busy="busy">
      <section v-if="latestArtifact" class="artifact-current"><header class="artifact-current-heading"><div><span class="artifact-eyebrow">CURRENT BUILD</span><h2>最新项目导出</h2><p>生成于 {{ displayDate(rawField(latestArtifact, ['createdAt'])) }}</p></div><span class="artifact-ready"><Check :size="12" />可下载</span></header><div class="artifact-stats"><div><small>词条总数</small><strong>{{ numericField(latestArtifact, ['total'])?.toLocaleString() || '—' }}</strong></div><div><small>已翻译条数</small><strong>{{ numericField(latestArtifact, ['translated'])?.toLocaleString() || '—' }}</strong><span>{{ filePercent({ total: numericField(latestArtifact, ['total']), translated: numericField(latestArtifact, ['translated']) }) }}%</span></div><div><small>有疑问条数</small><strong>{{ numericField(latestArtifact, ['disputed'])?.toLocaleString() || '0' }}</strong></div><div><small>已审核条数</small><strong>{{ numericField(latestArtifact, ['reviewed'])?.toLocaleString() || '0' }}</strong></div><div><small>生成用时</small><strong>{{ numericField(latestArtifact, ['duration']) ?? '—' }}<small v-if="numericField(latestArtifact, ['duration']) !== undefined"> 秒</small></strong></div><div><small>文件大小</small><strong>{{ fieldValue(latestArtifact, ['size', 'filesize']) || '由 ParaTranz 提供' }}</strong></div></div><label class="artifact-license-check"><input v-model="artifactAgreement" type="checkbox" /><span>我同意遵守项目采用的许可协议 <strong>CC BY-NC-SA 4.0</strong></span></label><div class="artifact-download-actions"><button class="button primary" :disabled="!artifactAgreement || !!actionBusy || navigation.blocked" @click="saveArtifact"><ArrowDownToLine :size="15" />{{ actionBusy === 'download-artifact' ? '正在保存压缩包…' : '下载压缩包到本机' }}</button><span>下载前请确认已阅读并接受此许可协议。</span></div></section><div v-else class="artifact-empty"><Download :size="30" /><strong>还没有可下载的构建</strong><span>生成项目压缩包后，当前构建信息会显示在这里。</span><button class="button compact primary" :disabled="!!actionBusy || navigation.blocked" @click="startHeaderAction"><RefreshCw :size="13" />生成压缩包</button></div><section v-if="visibleRows.length" class="artifact-history"><header class="workflow-section-heading"><div><h2>构建历史</h2><p>每次重新生成都会建立一个可下载的项目快照。</p></div><span>{{ totalCount }} 个构建</span></header><div class="artifact-history-list"><article v-for="(row, index) in visibleRows" :key="rowKey(row, index)" class="artifact-history-entry"><span class="artifact-history-icon"><History :size="15" /></span><div><strong>{{ index === 0 ? '最新构建' : `历史构建 ${visibleRows.length - index}` }}</strong><small>{{ displayDate(rawField(row, ['createdAt'])) }} · {{ numericField(row, ['total'])?.toLocaleString() || '—' }} 个词条 · {{ numericField(row, ['translated'])?.toLocaleString() || '—' }} 已翻译</small></div><button v-if="index === 0" class="button compact" :disabled="!artifactAgreement || !!actionBusy" @click="saveArtifact"><ArrowDownToLine :size="12" />下载</button><span v-else class="section-muted">历史版本</span></article></div></section>
      <footer v-if="pageCount > 1" class="section-footer artifact-pagination"><span>共 {{ totalCount.toLocaleString() }} 个构建 · 第 {{ page }} 页 / {{ pageCount }}</span><div><button class="button compact" :disabled="page <= 1 || busy" @click="page--"><ChevronLeft :size="14" />上一页</button><button class="button compact" :disabled="!canGoNext || busy" @click="page++">下一页<ChevronRight :size="14" /></button></div></footer>
    </section>
    <section v-else class="section-workspace">
      <div v-if="visibleRows.length" class="workflow-empty"><component :is="config?.icon || Files" :size="28" /><strong>{{ sectionTitle }}</strong><span>从侧栏打开对应的项目工作区。</span></div>
    </section>
    <footer v-if="config?.paged && !['terms', 'artifact'].includes(sectionId)" class="section-footer"><span>共 {{ totalCount.toLocaleString() }} 条 · 第 {{ page }} 页<span v-if="pageCount > 1"> / {{ pageCount }}</span></span><div><button class="button compact" :disabled="page <= 1 || busy" @click="page--"><ChevronLeft :size="14" />上一页</button><button class="button compact" :disabled="!canGoNext || busy" @click="page++">下一页<ChevronRight :size="14" /></button></div></footer>

    <Transition name="dialog">
      <div v-if="dialogMode" class="section-dialog-backdrop" @click.self="closeDialog">
        <section class="section-dialog" role="dialog" aria-modal="true" :aria-label="dialogMode === 'detail' ? detailTitle : formTitle()">
          <header class="section-dialog-header"><div><small>{{ navigation.browse.name }} · {{ sectionTitle }}</small><h2>{{ dialogMode === 'detail' ? (detailTitle || sectionTitle) : formTitle() }}</h2></div><button class="icon-button" aria-label="关闭" @click="closeDialog"><X :size="17" /></button></header>
          <div v-if="dialogMode === 'detail'" class="section-dialog-content" :aria-busy="detailBusy">
            <div v-if="detailBusy" class="section-detail-loading"><LoadingIndicator :size="18" label="正在读取详情" />正在读取详情…</div>
            <p v-if="detailError" class="section-form-error" role="alert">{{ detailError }}</p>
            <template v-if="sectionId === 'announcements'">
              <div class="section-detail-meta">{{ fieldValue(detail || {}, ['user.nickname', 'user.username']) || `用户 ${fieldValue(detail || {}, ['uid'])}` }} · {{ displayDate(rawField(detail || {}, ['createdAt'])) }}<span v-if="rawField(detail || {}, ['bumpedAt'])" class="section-status">置顶</span></div>
              <pre class="section-detail-text">{{ fieldValue(detail || {}, ['content']) || '（没有正文）' }}</pre>
            </template>
            <template v-else-if="sectionId === 'tasks'">
              <div class="section-detail-meta"><span class="section-status">{{ statusText('tasks', rawField(detail || {}, ['status'])) }}</span><span v-if="rawField(detail || {}, ['deadline'])">截止 {{ displayDate(rawField(detail || {}, ['deadline'])) }}</span><span v-else>长期有效</span><span>创建于 {{ displayDate(rawField(detail || {}, ['createdAt'])) }}</span></div>
              <pre class="section-detail-text">{{ fieldValue(detail || {}, ['content']) || '（没有任务说明）' }}</pre>
              <div class="section-subheading"><strong>关联文件</strong><span>{{ detailFiles.length }} 个</span></div>
              <div v-if="detailFiles.length" class="section-file-list"><div v-for="taskFile in detailFiles" :key="String(recordId(objectValue(taskFile.file) || taskFile))" class="section-file-row"><span>{{ fieldValue(taskFile, ['file.name', 'name']) || `文件 ${fieldValue(taskFile, ['file.id', 'fileId'])}` }}</span><small>{{ numericField(taskFile, ['translated']) || 0 }} / {{ numericField(taskFile, ['total']) || 0 }}</small><button class="button compact" :disabled="navigation.blocked" @click="navigation.chooseFile(fileFrom(taskFile)!)">打开翻译</button><button v-if="canManage" class="icon-button small danger" title="从任务移除" @click="manageTaskFile('removeFile', objectValue(taskFile))"><X :size="13" /></button></div></div><p v-else class="section-muted">尚未关联文件</p>
              <div v-if="canManage" class="section-inline-add"><select v-model="selectedTaskFile" aria-label="选择要关联的文件"><option value="">选择项目文件…</option><option v-for="file in navigation.files" :key="file.id" :value="String(file.id)">{{ file.name }}</option></select><select v-model.number="taskFileMode" aria-label="文件关联范围"><option :value="1">整个文件</option><option :value="0">仅关联词条</option></select><button class="button compact" :disabled="!selectedTaskFile || !!actionBusy" @click="manageTaskFile('addFile')"><Plus :size="13" />关联文件</button></div>
              <div v-if="rawField(detail || {}, ['words'])" class="section-task-stats"><span v-for="(value, key) in objectValue(detail?.words) || {}" :key="key">{{ ({ total: '总字数', translated: '已翻译', checked: '已校对', reviewed: '已审核' } as Record<string, string>)[String(key)] || key }} <strong>{{ value }}</strong></span></div>
            </template>
            <template v-else-if="sectionId === 'issues'">
              <div class="section-detail-meta">{{ fieldValue(detail || {}, ['user.nickname', 'user.username']) || `用户 ${fieldValue(detail || {}, ['uid'])}` }} · {{ displayDate(rawField(detail || {}, ['createdAt'])) }}<span class="section-status">{{ statusText('issues', rawField(detail || {}, ['status'])) }}</span></div>
              <pre class="section-detail-text">{{ fieldValue(detail || {}, ['content']) || '（没有讨论内容）' }}</pre>
              <div v-if="detailActivities.length" class="section-subheading"><strong>回复</strong><span>{{ detailActivities.length }} 条</span></div>
              <div v-for="(reply, index) in detailActivities" :key="String(recordId(reply) ?? index)" class="section-reply"><div><strong>{{ fieldValue(reply, ['user.nickname', 'user.username']) || `用户 ${fieldValue(reply, ['uid'])}` }}</strong><time>{{ displayDate(rawField(reply, ['createdAt'])) }}</time></div><pre>{{ fieldValue(reply, ['content', 'text']) }}</pre></div>
              <label class="section-field"><span>回复内容</span><textarea v-model="form.content" rows="3" placeholder="输入回复内容" /></label>
              <button class="button compact primary" :disabled="!form.content.trim() || !!actionBusy" @click="formMode = 'reply'; void submitForm()"><Send :size="13" />发送回复</button>
            </template>
            <template v-else-if="sectionId === 'terms'">
              <div class="section-detail-grid"><span>原文</span><strong>{{ fieldValue(detail || {}, ['term']) }}</strong><span>译文</span><strong>{{ fieldValue(detail || {}, ['translation']) }}</strong><span>词性</span><strong>{{ statusText('terms', rawField(detail || {}, ['pos'])) || '—' }}</strong><span>变体</span><strong>{{ fieldValue(detail || {}, ['variants']) || '—' }}</strong><span>备注</span><strong class="preserve-lines">{{ fieldValue(detail || {}, ['note']) || '—' }}</strong></div>
            </template>
            <template v-else-if="sectionId === 'members'">
              <div class="section-detail-grid"><span>账号</span><strong>{{ fieldValue(detail || {}, ['user.username', 'username']) || '—' }}</strong><span>权限</span><strong>{{ statusText('members', rawField(detail || {}, ['permission'])) }}</strong><span>加入时间</span><strong>{{ displayDate(rawField(detail || {}, ['createdAt'])) }}</strong><span>贡献值</span><strong>{{ fieldValue(detail || {}, ['totalPoints']) || '0' }}</strong><span>备注</span><strong>{{ fieldValue(detail || {}, ['note']) || '—' }}</strong></div>
            </template>
            <template v-else-if="sectionId === 'applications'">
              <div class="section-detail-meta"><span class="section-status">{{ statusText('applications', rawField(detail || {}, ['status'])) }}</span><span>{{ displayDate(rawField(detail || {}, ['createdAt'])) }}</span></div>
              <div class="section-detail-grid"><span>申请者</span><strong>{{ fieldValue(detail || {}, ['user.nickname', 'user.username', 'nickname', 'username']) || `用户 ${fieldValue(detail || {}, ['uid'])}` }}</strong><span>申请说明</span><strong class="preserve-lines">{{ fieldValue(detail || {}, ['message', 'content']) || '—' }}</strong><span>处理理由</span><strong class="preserve-lines">{{ fieldValue(detail || {}, ['reason']) || '—' }}</strong></div>
            </template>
            <div v-if="formError" class="section-form-error" role="alert">{{ formError }}</div>
          </div>
          <div v-else class="section-dialog-content section-form-content">
            <template v-if="['announcements', 'tasks', 'issues'].includes(sectionId)">
              <label class="section-field"><span>标题 <b>*</b></span><input v-model="form.title" maxlength="500" autofocus /></label>
              <label class="section-field"><span>{{ sectionId === 'announcements' ? '公告内容' : sectionId === 'tasks' ? '任务说明' : '讨论内容' }} <b>*</b></span><textarea v-model="form.content" rows="8" /></label>
            </template>
            <template v-if="sectionId === 'announcements'">
              <label class="section-field"><span>分类</span><select v-model="form.category"><option value="announcement">公告</option><option value="blog">项目动态</option></select></label>
              <label class="section-check"><input v-model="form.bumped" type="checkbox" />置顶公告</label><label class="section-check"><input v-model="form.internal" type="checkbox" />仅项目成员可见</label>
            </template>
            <template v-if="sectionId === 'tasks'">
              <div class="section-form-grid"><label class="section-field"><span>翻译目标（%） <b>*</b></span><input v-model="form.translate" type="number" min="0" max="100" placeholder="例如 80" /></label><label class="section-field"><span>校对目标（%）</span><input v-model="form.check" type="number" min="0" max="100" placeholder="可留空" /></label><label class="section-field"><span>审核目标（%）</span><input v-model="form.review" type="number" min="0" max="100" placeholder="可留空" /></label><label class="section-field"><span>截止时间</span><input v-model="form.deadline" type="datetime-local" /></label></div>
              <label class="section-check"><input v-model="form.bumped" type="checkbox" />置顶任务</label>
            </template>
            <template v-if="sectionId === 'terms'">
              <label class="section-field"><span>原文 <b>*</b></span><input v-model="form.term" maxlength="4000" autofocus /></label><label class="section-field"><span>译文 <b>*</b></span><input v-model="form.translation" maxlength="16000" /></label>
              <label class="section-field"><span>词性</span><select v-model="form.pos"><option value="">未指定</option><option value="noun">名词</option><option value="verb">动词</option><option value="adj">形容词</option><option value="adv">副词</option></select></label>
              <label class="section-field"><span>原文变体（每行一个）</span><textarea v-model="form.variants" rows="3" /></label><label class="section-field"><span>备注</span><textarea v-model="form.note" rows="3" /></label><label class="section-check"><input v-model="form.caseSensitive" type="checkbox" />匹配时区分大小写</label>
            </template>
            <template v-if="formMode === 'member-add'">
              <label class="section-field"><span>搜索用户</span><div class="section-user-search"><input v-model="memberSearch" placeholder="输入用户名或昵称" /><LoadingIndicator v-if="userSearchBusy" :size="16" label="正在搜索用户" /></div></label>
              <div v-if="selectedMemberUser" class="section-user-selected"><Check :size="14" />已选择 {{ fieldValue(selectedMemberUser, ['nickname', 'username']) }} <small>@{{ fieldValue(selectedMemberUser, ['username']) }}</small></div>
              <div v-else-if="userMatches.length" class="section-user-results"><button v-for="user in userMatches" :key="String(recordId(user) || user.id)" @click="selectMemberUser(user)"><strong>{{ fieldValue(user, ['nickname', 'username']) }}</strong><small>@{{ fieldValue(user, ['username']) }}</small></button></div>
              <label class="section-field"><span>项目权限</span><select v-model.number="form.permission"><option :value="1">翻译者</option><option :value="2">校对者</option><option v-if="currentPermission === 10" :value="3">管理员</option></select></label>
            </template>
            <template v-if="formMode === 'member-edit'"><label class="section-field"><span>项目权限</span><select v-model.number="form.permission"><option :value="1">翻译者</option><option :value="2">校对者</option><option v-if="currentPermission === 10" :value="3">管理员</option><option v-if="currentPermission === 10 && form.permission === 10" :value="10">所有者</option></select></label><label class="section-field"><span>备注</span><textarea v-model="form.memberNote" rows="3" maxlength="5000" /></label></template>
            <template v-if="formMode === 'application-approve' || formMode === 'application-reject'"><label class="section-field"><span>{{ formMode === 'application-reject' ? '拒绝理由' : '通过理由（可选）' }}<b v-if="formMode === 'application-reject'">*</b></span><textarea v-model="form.reason" rows="4" maxlength="5000" /></label></template>
            <p v-if="formError" class="section-form-error" role="alert">{{ formError }}</p>
          </div>
          <footer class="section-dialog-footer">
            <template v-if="dialogMode === 'detail'">
              <button v-if="sectionId === 'announcements' && canEdit(activeRow || {})" class="button compact" :disabled="!!actionBusy" @click="startForm('edit')"><Settings2 :size="13" />编辑</button>
              <button v-if="sectionId === 'tasks' && canManage" class="button compact" :disabled="!!actionBusy" @click="startForm('edit')"><Settings2 :size="13" />编辑任务</button>
              <button v-if="sectionId === 'tasks' && canManage" class="button compact" :disabled="!!actionBusy" @click="toggleTask(rawField(detail || {}, ['bumpedAt']) ? 'unpin' : 'pin')"><Pin :size="13" />{{ rawField(detail || {}, ['bumpedAt']) ? '取消置顶' : '置顶' }}</button>
              <button v-if="sectionId === 'tasks' && canManage && Number(rawField(detail || {}, ['status'])) === 0" class="button compact" :disabled="!!actionBusy" @click="toggleTask('finish')"><Check :size="13" />标记完成</button>
              <button v-if="sectionId === 'issues' && canEdit(activeRow || {})" class="button compact" :disabled="!!actionBusy" @click="startForm('edit')"><Settings2 :size="13" />编辑</button>
              <button v-if="sectionId === 'issues'" class="button compact" :disabled="!!actionBusy" @click="toggleSubscription">{{ subscribed ? '取消订阅' : '订阅讨论' }}</button>
              <button v-if="sectionId === 'issues' && canManage" class="button compact" :disabled="!!actionBusy" @click="toggleIssueStatus">{{ Number(rawField(detail || {}, ['status'])) === 1 ? '重新打开' : '关闭讨论' }}</button>
              <button v-if="sectionId === 'terms' && canEdit(activeRow || {})" class="button compact" :disabled="!!actionBusy" @click="startForm('edit')"><Settings2 :size="13" />编辑</button>
              <button v-if="sectionId === 'members' && canManage" class="button compact" :disabled="!!actionBusy" @click="startForm('member-edit')"><Settings2 :size="13" />编辑成员</button>
              <button v-if="sectionId === 'applications' && canManage && Number(rawField(detail || {}, ['status'])) === 0" class="button compact primary" :disabled="!!actionBusy" @click="startForm('application-approve')"><Check :size="13" />通过</button>
              <button v-if="sectionId === 'applications' && canManage && Number(rawField(detail || {}, ['status'])) === 0" class="button compact" :disabled="!!actionBusy" @click="startForm('application-reject')">拒绝</button>
              <button v-if="sectionId === 'applications' && Number(rawField(detail || {}, ['uid'])) === props.editor.sessionInfo.user?.id && Number(rawField(detail || {}, ['status'])) === 0" class="button compact" :disabled="!!actionBusy" @click="callSectionAction('withdraw', {}, activeRow).then(done => done && (dialogMode = ''))">撤回申请</button>
              <button v-if="['announcements', 'tasks', 'issues', 'terms'].includes(sectionId) && canEdit(activeRow || {})" class="button compact danger" :disabled="!!actionBusy" @click="deleteActive"><Trash2 :size="13" />删除</button>
              <button v-if="sectionId === 'members' && canManage" class="button compact danger" :disabled="!!actionBusy" @click="deleteActive"><Trash2 :size="13" />移除成员</button>
              <button class="button compact section-footer-close" @click="closeDialog">关闭</button>
            </template>
            <template v-else><span class="section-form-footer-error">{{ formError }}</span><button class="button compact" :disabled="formBusy || !!actionBusy" @click="closeDialog">取消</button><button class="button compact primary" :disabled="formBusy || !!actionBusy || (formMode === 'application-reject' && !form.reason.trim())" @click="submitForm"><Check :size="13" />{{ formBusy || actionBusy ? '提交中…' : '保存' }}</button></template>
          </footer>
        </section>
      </div>
    </Transition>
  </main>
</template>

<style scoped>
.project-section-page{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--soft)}
.section-header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:17px 22px 14px;border-bottom:1px solid var(--border);background:var(--bg);flex:0 0 auto}
.section-heading{min-width:0}.section-breadcrumb{margin-bottom:6px;color:var(--muted);font-size:10px}.section-breadcrumb span{padding:0 6px;color:var(--border)}
.section-title{display:flex;align-items:center;gap:9px;color:var(--accent)}.section-title h1{color:var(--text);font-size:18px;font-weight:600}.section-heading>p{margin-top:5px;color:var(--muted);font-size:11px;line-height:1.5}.section-saving{padding:3px 7px;border-radius:3px;background:var(--accent-soft);color:var(--accent);font-size:9px}
.section-header-actions{display:flex;flex:0 0 auto;align-items:center;gap:7px}
.section-toolbar{display:flex;align-items:center;gap:9px;min-height:49px;padding:7px 14px;border-bottom:1px solid var(--border);background:var(--bg);flex:0 0 auto}.section-search{display:flex;align-items:center;gap:8px;width:min(360px,45vw);height:31px;padding:0 9px;border:1px solid var(--border);border-radius:3px;background:var(--soft);color:var(--muted)}.section-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font-size:11px}.section-toolbar select,.section-field select,.section-inline-add select{max-width:170px;height:31px;padding:0 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--secondary);font-size:11px}.section-count{margin-left:auto;color:var(--muted);font-size:10px;white-space:nowrap}
.section-notice{display:flex;align-items:center;gap:7px;padding:8px 14px;border-bottom:1px solid var(--border);background:var(--accent-soft);color:var(--accent);font-size:11px}.section-notice .icon-button{margin-left:auto}
.section-toolbar-check,.section-date-filter{display:flex;align-items:center;gap:6px;color:var(--secondary);font-size:10px;white-space:nowrap}.section-toolbar-check input{accent-color:var(--accent)}.section-date-filter input{width:120px;height:31px;padding:0 7px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--secondary);font:inherit}
.section-message,.section-loading{display:flex;align-items:center;justify-content:center;gap:10px;flex:1;color:var(--muted);font-size:12px}.section-message.error{justify-content:space-between;margin:16px;padding:12px;border:1px solid color-mix(in srgb,var(--warning) 35%,var(--border));color:var(--warning)}
.section-workspace{flex:1;min-height:0;overflow:auto;padding:18px 22px 24px;scrollbar-width:thin;scrollbar-color:var(--border) transparent;background:var(--soft)}.workflow-empty{display:flex;min-height:220px;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:26px;border:1px dashed var(--border);background:var(--bg);color:var(--muted);text-align:center}.workflow-empty>svg{color:var(--accent)}.workflow-empty strong{color:var(--text);font-size:13px;font-weight:550}.workflow-empty>span{max-width:440px;font-size:10px;line-height:1.6}.workflow-empty>.button{margin-top:4px}.workflow-section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.workflow-section-heading h2{color:var(--text);font-size:13px;font-weight:600}.workflow-section-heading p{margin-top:4px;color:var(--muted);font-size:10px;line-height:1.5}.workflow-section-heading>span{color:var(--muted);font-size:10px}
.project-settings-workspace{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);align-content:start;gap:14px}.project-settings-form,.project-settings-shortcuts{padding:18px;border:1px solid var(--border);background:var(--bg)}.project-settings-form>.section-field{margin-top:16px}.project-settings-form .section-field input,.project-settings-form .section-field textarea{font-size:11px}.project-settings-readonly{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}.project-settings-readonly>div{display:grid;gap:4px;padding:10px;border:1px solid var(--border);background:var(--soft)}.project-settings-readonly small{color:var(--muted);font-size:9px}.project-settings-readonly strong{color:var(--text);font-size:11px;font-weight:550}.project-settings-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)}.project-settings-footer>span{color:var(--muted);font-size:9px;line-height:1.5}.project-management-links{display:grid;margin-top:12px}.project-management-links button{display:flex;align-items:center;gap:11px;padding:12px 2px;border-top:1px solid var(--border);color:var(--accent);text-align:left}.project-management-links button>span{display:grid;flex:1;gap:4px}.project-management-links strong{color:var(--text);font-size:11px;font-weight:550}.project-management-links small{color:var(--muted);font-size:9px;line-height:1.4}
.history-timeline{max-width:1100px;margin:0 auto}.history-entry{display:grid;grid-template-columns:36px minmax(0,1fr);gap:8px}.history-entry-rail{position:relative;display:flex;justify-content:center}.history-entry-rail:after{position:absolute;top:32px;bottom:0;width:1px;background:var(--border);content:""}.history-entry:last-child .history-entry-rail:after{display:none}.history-entry-rail>span{z-index:1;display:grid;place-items:center;width:27px;height:27px;border:1px solid var(--border);border-radius:50%;background:var(--bg);color:var(--accent)}.history-entry-main{margin-bottom:12px;padding:12px 14px;border:1px solid var(--border);background:var(--bg)}.history-entry-main>header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.history-entry-main>header>strong{color:var(--text);font-size:11px;font-weight:550}.history-entry-main>header time{margin-left:auto;color:var(--muted);font-size:9px}.history-entry-target{display:flex;align-items:center;gap:8px;margin-top:9px;color:var(--muted);font-size:9px}.history-entry-target button{display:flex;align-items:center;gap:4px;max-width:55%;overflow:hidden;color:var(--accent);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.history-entry-target>strong{color:var(--secondary);font-weight:500}.history-entry-target>small{margin-left:auto}.history-entry-diff{display:grid;grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr);align-items:center;gap:8px;margin-top:9px}.history-entry-diff>div{min-width:0;padding:8px 9px;border-radius:3px;background:var(--soft)}.history-entry-diff small{color:var(--muted);font-size:9px}.history-entry-diff p{margin-top:4px;max-height:74px;overflow:auto;color:var(--secondary);font-size:10px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.history-entry-diff>svg{color:var(--muted)}
.announcement-feed{display:grid;max-width:1080px;gap:11px;margin:0 auto}.announcement-entry{display:grid;grid-template-columns:38px minmax(0,1fr);gap:11px;padding:15px;border:1px solid var(--border);background:var(--bg)}.announcement-entry-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--accent-soft);color:var(--accent)}.announcement-entry-main{min-width:0}.announcement-entry-main>header{display:flex;align-items:center;justify-content:space-between;gap:10px}.announcement-tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.announcement-category,.announcement-pinned,.announcement-internal{display:inline-flex;align-items:center;gap:3px;padding:3px 6px;border-radius:3px;background:var(--accent-soft);color:var(--accent);font-size:9px}.announcement-pinned{background:color-mix(in srgb,#d99a25 14%,var(--bg));color:#b47b08}.announcement-internal{background:var(--soft);color:var(--muted)}.announcement-entry-main time{color:var(--muted);font-size:9px}.announcement-title{display:block;margin-top:8px;color:var(--text);font-size:14px;font-weight:600;text-align:left}.announcement-title:hover{color:var(--accent)}.announcement-entry-main>p{display:-webkit-box;margin-top:7px;overflow:hidden;color:var(--secondary);font-size:10px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-line-clamp:3;-webkit-box-orient:vertical}.announcement-entry-main>footer{display:flex;align-items:center;gap:13px;flex-wrap:wrap;margin-top:12px;padding-top:9px;border-top:1px solid var(--border);color:var(--muted);font-size:9px}.announcement-actions{display:flex;gap:6px;margin-left:auto}
.task-board{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:14px}.task-lane{min-width:0;border:1px solid var(--border);background:var(--bg)}.task-lane>header{display:flex;align-items:center;gap:8px;padding:12px 13px;border-bottom:1px solid var(--border)}.task-lane>header h2{color:var(--text);font-size:12px;font-weight:600}.task-lane>header small{min-width:20px;padding:2px 6px;border-radius:10px;background:var(--soft);color:var(--muted);font-size:9px;text-align:center}.task-lane>header .icon-button{margin-left:auto}.task-lane-dot{width:8px;height:8px;border-radius:50%;background:var(--accent)}.task-lane-dot.done{background:#339e75}.task-card-list{display:grid;gap:9px;padding:10px}.task-entry{padding:12px;border:1px solid var(--border);background:var(--bg)}.task-entry-top{display:flex;align-items:center;gap:7px}.task-pinned{display:inline-flex;align-items:center;gap:3px;color:#b47b08;font-size:9px}.task-entry-title{display:block;margin-top:8px;color:var(--text);font-size:12px;font-weight:600;text-align:left}.task-entry-title:hover{color:var(--accent)}.task-entry>p{margin-top:5px;color:var(--muted);font-size:10px;line-height:1.55}.task-progress-label{display:flex;justify-content:space-between;margin-top:12px;color:var(--muted);font-size:9px}.task-progress-label strong{color:var(--secondary);font-weight:550}.task-progress,.leaderboard-bar{height:5px;margin-top:5px;overflow:hidden;border-radius:5px;background:var(--border)}.task-progress>span,.leaderboard-bar>span{display:block;height:100%;border-radius:inherit;background:var(--accent)}.task-entry-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px;color:var(--muted);font-size:9px}.task-entry-meta>span{display:flex;align-items:center;gap:4px}.task-entry>footer{display:flex;gap:5px;flex-wrap:wrap;margin-top:11px;padding-top:9px;border-top:1px solid var(--border)}.workflow-lane-empty{display:flex;min-height:120px;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--muted);font-size:10px}.workflow-lane-empty svg{color:var(--muted)}
.file-overview-bar{display:flex;gap:1px;margin-bottom:14px;border:1px solid var(--border);background:var(--border)}.file-overview-bar>div{display:flex;align-items:baseline;gap:6px;flex:1;padding:11px 14px;background:var(--bg)}.file-overview-bar strong{color:var(--text);font-size:16px;font-variant-numeric:tabular-nums}.file-overview-bar span{color:var(--muted);font-size:9px}.file-directory-list{display:grid;gap:8px}.file-directory-group{border:1px solid var(--border);background:var(--bg)}.file-directory-group>summary{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;list-style:none;color:var(--accent)}.file-directory-group>summary::-webkit-details-marker{display:none}.file-directory-group>summary strong{color:var(--text);font-size:10px;font-weight:550}.file-directory-group>summary small{color:var(--muted);font-size:9px}.directory-chevron{margin-left:auto;color:var(--muted);transition:transform .15s}.file-directory-group[open] .directory-chevron{transform:rotate(90deg)}.project-file-entry{display:flex;align-items:center;gap:11px;padding:9px 12px 9px 35px;border-top:1px solid var(--border)}.project-file-entry>svg{flex:0 0 auto;color:var(--muted)}.project-file-copy{display:grid;flex:1;min-width:120px;gap:3px}.project-file-copy strong{overflow:hidden;color:var(--text);font-size:10px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.project-file-copy small{color:var(--muted);font-size:9px}.project-file-progress{width:min(150px,16vw);height:5px;overflow:hidden;border-radius:4px;background:var(--border)}.project-file-progress span{display:block;height:100%;background:var(--accent)}.project-file-percent{width:36px;color:var(--secondary);font-size:9px;text-align:right}.term-workspace{padding:0}.term-workspace-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 17px;border-bottom:1px solid var(--border);background:var(--bg)}.term-workspace-heading>div{display:grid;gap:4px}.term-workspace-heading strong{color:var(--text);font-size:11px}.term-workspace-heading span{color:var(--muted);font-size:9px}.term-table-wrap{overflow:auto}.term-table{width:100%;border-collapse:collapse;table-layout:fixed;background:var(--bg)}.term-table th{position:sticky;top:0;padding:9px 12px;border-bottom:1px solid var(--border);background:var(--soft);color:var(--secondary);font-size:9px;font-weight:550;text-align:left}.term-table th:nth-child(1){width:22%}.term-table th:nth-child(2){width:24%}.term-table th:nth-child(3){width:12%}.term-table th:nth-child(4){width:36%}.term-table th:last-child{width:42px}.term-table td{padding:8px 12px;border-bottom:1px solid var(--border);color:var(--secondary);font-size:10px;line-height:1.45;vertical-align:middle}.term-table tbody tr:hover{background:var(--accent-soft)}.term-source{max-width:100%;overflow:hidden;color:var(--text);font-size:10px;font-weight:550;text-overflow:ellipsis;white-space:nowrap;text-align:left}.term-pos{padding:2px 5px;border:1px solid var(--border);border-radius:3px;color:var(--muted);font-size:9px}.term-extra{display:-webkit-box;max-height:34px;overflow:hidden;color:var(--muted);font-size:9px;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.discussion-list{display:grid;gap:1px;border:1px solid var(--border);background:var(--border)}.discussion-entry{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;padding:13px;background:var(--bg)}.discussion-entry-icon{display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--border);border-radius:50%;color:var(--accent)}.discussion-entry-main{min-width:0}.discussion-entry-main>header{display:flex;align-items:center;gap:8px}.discussion-entry-title{overflow:hidden;color:var(--text);font-size:11px;font-weight:600;text-overflow:ellipsis;white-space:nowrap;text-align:left}.discussion-entry-title:hover{color:var(--accent)}.discussion-entry-main>p{display:-webkit-box;margin-top:6px;overflow:hidden;color:var(--muted);font-size:10px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-line-clamp:2;-webkit-box-orient:vertical}.discussion-entry-main>footer{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-top:8px;color:var(--muted);font-size:9px}.discussion-entry-main>footer>span:nth-child(2){display:flex;align-items:center;gap:4px}.discussion-entry-main>footer>time{margin-left:auto}
.member-summary-strip{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:12px;padding:10px 13px;border:1px solid var(--border);background:var(--bg);color:var(--muted);font-size:9px}.member-summary-strip>span{display:flex;align-items:center;gap:6px}.member-summary-strip strong{color:var(--text);font-size:13px}.member-summary-strip>span:last-child{margin-left:auto}.member-directory{display:grid;gap:1px;border:1px solid var(--border);background:var(--border)}.member-entry{display:flex;align-items:flex-start;gap:11px;padding:13px;background:var(--bg)}.member-avatar{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:13px;font-weight:600}.member-main{flex:1;min-width:0}.member-name-line{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.member-name-line>strong{color:var(--text);font-size:11px;font-weight:600}.member-role{padding:2px 6px;border-radius:9px;background:var(--soft);color:var(--secondary);font-size:9px}.member-role.role-3,.member-role.role-10{background:var(--accent-soft);color:var(--accent)}.member-main>small{display:block;margin-top:4px;color:var(--muted);font-size:9px}.member-contributions{display:flex;gap:13px;flex-wrap:wrap;margin-top:9px;color:var(--muted);font-size:9px}.member-contributions b{margin-left:3px;color:var(--secondary);font-weight:550}.member-note{margin-top:7px;color:var(--muted);font-size:9px;white-space:pre-wrap}.member-entry-actions{display:flex;gap:5px;flex:0 0 auto}
.application-queue-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;padding:13px 15px;border:1px solid var(--border);background:var(--bg)}.application-queue-heading h2{color:var(--text);font-size:12px;font-weight:600}.application-queue-heading p{margin-top:4px;color:var(--muted);font-size:9px}.application-queue-count{display:grid;place-items:center;min-width:30px;height:30px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:11px}.application-queue{display:grid;gap:8px}.application-entry{display:flex;align-items:flex-start;gap:11px;padding:13px;border:1px solid var(--border);background:var(--bg)}.application-entry-main{flex:1;min-width:0}.application-entry-main>header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.application-entry-main>header>strong{color:var(--text);font-size:11px}.application-entry-main>header time{margin-left:auto;color:var(--muted);font-size:9px}.application-entry-main>p{margin-top:7px;color:var(--secondary);font-size:10px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.application-entry-main>footer{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px}.application-reason{margin-left:auto;color:var(--muted);font-size:9px}
.leaderboard-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px;padding:13px 15px;border:1px solid var(--border);background:var(--bg)}.leaderboard-heading h2{color:var(--text);font-size:12px;font-weight:600}.leaderboard-heading p{margin-top:4px;color:var(--muted);font-size:9px}.leaderboard-heading>svg{color:var(--accent)}.leaderboard-list{display:grid;gap:1px;border:1px solid var(--border);background:var(--border)}.leaderboard-entry{display:grid;grid-template-columns:34px 34px minmax(140px,.8fr) minmax(180px,1.1fr) minmax(220px,1fr);align-items:center;gap:10px;padding:11px 13px;background:var(--bg)}.leaderboard-rank{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--soft);color:var(--muted);font-size:10px}.leaderboard-rank.podium{background:var(--accent-soft);color:var(--accent);font-weight:600}.leaderboard-member{display:grid;gap:4px;min-width:0}.leaderboard-member strong{overflow:hidden;color:var(--text);font-size:10px;font-weight:550;text-overflow:ellipsis;white-space:nowrap}.leaderboard-member small{color:var(--muted);font-size:9px}.leaderboard-score>div:first-child{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:9px}.leaderboard-score strong{color:var(--text);font-size:10px}.leaderboard-breakdown{display:flex;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:9px}.leaderboard-breakdown b{color:var(--secondary);font-weight:500}
.artifact-current{max-width:1050px;margin:0 auto;border:1px solid var(--border);background:var(--bg)}.artifact-current-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:17px 19px;border-bottom:1px solid var(--border)}.artifact-eyebrow{color:var(--accent);font-size:8px;letter-spacing:.12em}.artifact-current-heading h2{margin-top:5px;color:var(--text);font-size:15px;font-weight:600}.artifact-current-heading p{margin-top:4px;color:var(--muted);font-size:9px}.artifact-ready{display:flex;align-items:center;gap:4px;padding:4px 7px;border-radius:10px;background:color-mix(in srgb,#339e75 12%,var(--bg));color:#2e9b65;font-size:9px}.artifact-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:1px solid var(--border)}.artifact-stats>div{display:grid;gap:5px;padding:13px 16px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)}.artifact-stats>div:nth-child(3n){border-right:0}.artifact-stats>div:nth-last-child(-n+3){border-bottom:0}.artifact-stats small{color:var(--muted);font-size:9px}.artifact-stats strong{color:var(--text);font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}.artifact-stats strong>small{display:inline;color:var(--muted);font-size:9px;font-weight:400}.artifact-stats>div:nth-child(2)>span{color:var(--accent);font-size:9px}.artifact-license-check{display:flex;align-items:center;gap:8px;padding:14px 17px;color:var(--secondary);font-size:10px}.artifact-license-check input{accent-color:var(--accent)}.artifact-license-check strong{color:var(--accent);font-weight:550}.artifact-download-actions{display:flex;align-items:center;gap:11px;flex-wrap:wrap;padding:0 17px 15px}.artifact-download-actions>span{color:var(--muted);font-size:9px}.artifact-history{max-width:1050px;margin:16px auto 0;padding:14px;border:1px solid var(--border);background:var(--bg)}.artifact-history-list{margin-top:10px}.artifact-history-entry{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border)}.artifact-history-icon{display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;border-radius:50%;background:var(--accent-soft);color:var(--accent)}.artifact-history-entry>div{display:grid;flex:1;gap:4px}.artifact-history-entry strong{color:var(--text);font-size:10px;font-weight:550}.artifact-history-entry small{color:var(--muted);font-size:9px}.artifact-empty{display:flex;min-height:220px;flex-direction:column;align-items:center;justify-content:center;gap:9px;border:1px dashed var(--border);background:var(--bg);color:var(--muted);text-align:center}.artifact-empty>svg{color:var(--accent)}.artifact-empty strong{color:var(--text);font-size:13px}.artifact-empty span{font-size:10px}
.section-table-wrap{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.section-table{width:100%;min-width:850px;border-collapse:collapse;table-layout:auto}.section-table th{position:sticky;top:0;z-index:1;padding:9px 12px;border-bottom:1px solid var(--border);background:var(--soft);color:var(--secondary);font-size:10px;font-weight:500;text-align:left;white-space:nowrap}.section-table td{max-width:440px;padding:8px 12px;border-bottom:1px solid var(--border);color:var(--secondary);font-size:11px;line-height:1.55;vertical-align:middle}.section-table tbody tr:hover td{background:color-mix(in srgb,var(--accent-soft) 42%,var(--bg))}.section-table td>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.section-table .section-primary-cell{color:var(--text);font-weight:500}.section-action-col{width:106px;text-align:right!important}.section-row-actions{text-align:right;white-space:nowrap}.section-row-actions .button{min-width:70px}.section-diff{max-width:360px;white-space:pre-wrap!important}.section-status{display:inline-flex!important;align-items:center;max-width:max-content;padding:2px 6px;border-radius:3px;background:var(--accent-soft);color:var(--accent);font-size:10px;line-height:1.4}.section-status.done{background:color-mix(in srgb,#2e9b65 12%,var(--bg));color:#2e9b65}.section-empty{height:220px!important;text-align:center;vertical-align:middle!important;color:var(--muted)!important}.section-empty svg{display:block;margin:0 auto 10px;color:var(--muted)}.section-empty strong,.section-empty span{display:block}.section-empty strong{margin-bottom:5px;color:var(--secondary);font-size:12px}.section-empty span{font-size:10px}
.section-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:var(--footer-height);padding:0 13px;border-top:1px solid var(--border);background:var(--bg);color:var(--muted);font-size:10px;flex:0 0 auto}.section-footer>div{display:flex;gap:6px}
.section-dialog-backdrop{position:fixed;z-index:100;inset:var(--titlebar-height,32px) 0 0;display:flex;align-items:center;justify-content:center;padding:20px;background:#11182766}.section-dialog{display:flex;flex-direction:column;width:min(720px,100%);max-height:min(820px,calc(100vh - 72px));overflow:hidden;border:1px solid var(--border);border-radius:6px;background:var(--bg);box-shadow:0 12px 48px #0003}.section-dialog-header{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;padding:16px 19px 13px;border-bottom:1px solid var(--border)}.section-dialog-header small{color:var(--muted);font-size:9px}.section-dialog-header h2{margin-top:4px;color:var(--text);font-size:16px;font-weight:600;overflow-wrap:anywhere}.section-dialog-content{min-height:0;overflow:auto;padding:17px 19px;color:var(--secondary);font-size:11px;line-height:1.7}.section-dialog-footer{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--border);background:var(--soft)}.section-footer-close{margin-left:auto}.section-form-footer-error{flex:1;min-width:100px;color:var(--warning);font-size:10px}.section-detail-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:13px;color:var(--muted);font-size:10px}.section-detail-text{margin:0 0 15px;padding:12px;border:1px solid var(--border);border-radius:3px;background:var(--soft);color:var(--text);font-family:inherit;font-size:11px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.section-detail-loading{display:flex;align-items:center;gap:8px;margin-bottom:12px;color:var(--muted)}.section-muted{color:var(--muted)}.section-subheading{display:flex;justify-content:space-between;margin:15px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border);color:var(--text);font-size:11px}.section-subheading span{color:var(--muted);font-size:10px}.section-file-list{display:grid;gap:5px}.section-file-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-bottom:1px solid var(--border)}.section-file-row>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}.section-file-row small{color:var(--muted);white-space:nowrap}.section-file-row .button{white-space:nowrap}.section-inline-add{display:flex;gap:7px;margin-top:10px}.section-inline-add select{flex:1;max-width:none}.section-task-stats{display:flex;gap:15px;flex-wrap:wrap;margin-top:14px;padding-top:10px;border-top:1px solid var(--border);color:var(--muted);font-size:10px}.section-task-stats strong{margin-left:4px;color:var(--secondary)}.section-reply{margin:8px 0;padding:9px 10px;border-left:2px solid var(--border);background:var(--soft)}.section-reply>div{display:flex;justify-content:space-between;gap:10px;color:var(--text);font-size:10px}.section-reply time{color:var(--muted);font-size:9px}.section-reply pre{margin:6px 0 0;color:var(--secondary);font-family:inherit;font-size:11px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}.section-detail-grid{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px 14px}.section-detail-grid>span{color:var(--muted)}.section-detail-grid>strong{color:var(--text);font-weight:500;overflow-wrap:anywhere}.preserve-lines{white-space:pre-wrap}.section-form-content{display:grid;gap:12px}.section-field{display:grid;gap:5px;color:var(--secondary);font-size:10px}.section-field>span{color:var(--secondary)}.section-field b{color:var(--warning)}.section-field input,.section-field textarea,.section-field select,.section-user-search input{width:100%;min-width:0;padding:8px 9px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--text);font-family:inherit;font-size:11px;line-height:1.5;outline:0}.section-field input:focus,.section-field textarea:focus,.section-field select:focus,.section-user-search input:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}.section-field textarea{resize:vertical;min-height:70px}.section-field textarea::placeholder,.section-field input::placeholder{color:var(--muted)}.section-check{display:flex;align-items:center;gap:7px;color:var(--secondary);font-size:10px}.section-check input{accent-color:var(--accent)}.section-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.section-form-error{padding:8px 9px;border:1px solid color-mix(in srgb,var(--warning) 35%,var(--border));border-radius:3px;background:color-mix(in srgb,var(--warning) 7%,var(--bg));color:var(--warning);font-size:10px}.section-user-search{display:flex;align-items:center;gap:8px}.section-user-results{display:grid;max-height:190px;overflow:auto;border:1px solid var(--border)}.section-user-results button{display:flex;align-items:center;gap:8px;padding:8px 9px;text-align:left;border-bottom:1px solid var(--border)}.section-user-results button:hover{background:var(--accent-soft)}.section-user-results small,.section-user-selected small{color:var(--muted)}.section-user-selected{display:flex;align-items:center;gap:7px;padding:8px 9px;background:var(--accent-soft);color:var(--accent)}.section-user-selected small{margin-left:auto}.danger{color:var(--warning)}
@media(max-width:720px){.section-header{align-items:flex-start;padding:13px 14px}.section-header-actions{flex-direction:column;align-items:stretch}.section-title h1{font-size:16px}.section-heading>p{max-width:52vw}.section-toolbar{padding:7px 10px}.section-search{width:min(250px,42vw)}.section-dialog-backdrop{padding:10px}.section-dialog{max-height:calc(100vh - 52px)}.section-form-grid{grid-template-columns:1fr}}
.section-toolbar-check,.section-date-filter{display:flex;align-items:center;gap:6px;color:var(--secondary);font-size:10px;white-space:nowrap}.section-toolbar-check input{accent-color:var(--accent)}.section-date-filter input{width:120px;height:31px;padding:0 7px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--secondary);font:inherit}
.section-workspace{flex:1;min-height:0;overflow:auto;padding:18px 22px 24px;scrollbar-width:thin;scrollbar-color:var(--border) transparent;background:var(--soft)}.workflow-empty{display:flex;min-height:220px;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:26px;border:1px dashed var(--border);background:var(--bg);color:var(--muted);text-align:center}.workflow-empty>svg{color:var(--accent)}.workflow-empty strong{color:var(--text);font-size:13px;font-weight:550}.workflow-empty>span{max-width:440px;font-size:10px;line-height:1.6}.workflow-empty>.button{margin-top:4px}.workflow-section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.workflow-section-heading h2{color:var(--text);font-size:13px;font-weight:600}.workflow-section-heading p{margin-top:4px;color:var(--muted);font-size:10px;line-height:1.5}.workflow-section-heading>span{color:var(--muted);font-size:10px}
.project-settings-workspace{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);align-content:start;gap:14px}.project-settings-form,.project-settings-shortcuts{padding:18px;border:1px solid var(--border);background:var(--bg)}.project-settings-form>.section-field{margin-top:16px}.project-settings-readonly{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}.project-settings-readonly>div{display:grid;gap:4px;padding:10px;border:1px solid var(--border);background:var(--soft)}.project-settings-readonly small{color:var(--muted);font-size:9px}.project-settings-readonly strong{color:var(--text);font-size:11px;font-weight:550}.project-settings-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)}.project-settings-footer>span{color:var(--muted);font-size:9px;line-height:1.5}.project-management-links{display:grid;margin-top:12px}.project-management-links button{display:flex;align-items:center;gap:11px;padding:12px 2px;border-top:1px solid var(--border);color:var(--accent);text-align:left}.project-management-links button>span{display:grid;flex:1;gap:4px}.project-management-links strong{color:var(--text);font-size:11px;font-weight:550}.project-management-links small{color:var(--muted);font-size:9px;line-height:1.4}
.history-timeline{max-width:1100px;margin:0 auto}.history-entry{display:grid;grid-template-columns:36px minmax(0,1fr);gap:8px}.history-entry-rail{position:relative;display:flex;justify-content:center}.history-entry-rail:after{position:absolute;top:32px;bottom:0;width:1px;background:var(--border);content:""}.history-entry:last-child .history-entry-rail:after{display:none}.history-entry-rail>span{z-index:1;display:grid;place-items:center;width:27px;height:27px;border:1px solid var(--border);border-radius:50%;background:var(--bg);color:var(--accent)}.history-entry-main{margin-bottom:12px;padding:12px 14px;border:1px solid var(--border);background:var(--bg)}.history-entry-main>header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.history-entry-main>header>strong{color:var(--text);font-size:11px;font-weight:550}.history-entry-main>header time{margin-left:auto;color:var(--muted);font-size:9px}.history-entry-target{display:flex;align-items:center;gap:8px;margin-top:9px;color:var(--muted);font-size:9px}.history-entry-target button{display:flex;align-items:center;gap:4px;max-width:55%;overflow:hidden;color:var(--accent);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.history-entry-target>strong{color:var(--secondary);font-weight:500}.history-entry-target>small{margin-left:auto}.history-entry-diff{display:grid;grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr);align-items:center;gap:8px;margin-top:9px}.history-entry-diff>div{min-width:0;padding:8px 9px;border-radius:3px;background:var(--soft)}.history-entry-diff small{color:var(--muted);font-size:9px}.history-entry-diff p{margin-top:4px;max-height:74px;overflow:auto;color:var(--secondary);font-size:10px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.history-entry-diff>svg{color:var(--muted)}
.announcement-feed{display:grid;max-width:1080px;gap:11px;margin:0 auto}.announcement-entry{display:grid;grid-template-columns:38px minmax(0,1fr);gap:11px;padding:15px;border:1px solid var(--border);background:var(--bg)}.announcement-entry-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--accent-soft);color:var(--accent)}.announcement-entry-main{min-width:0}.announcement-entry-main>header{display:flex;align-items:center;justify-content:space-between;gap:10px}.announcement-tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.announcement-category,.announcement-pinned,.announcement-internal{display:inline-flex;align-items:center;gap:3px;padding:3px 6px;border-radius:3px;background:var(--accent-soft);color:var(--accent);font-size:9px}.announcement-pinned{background:color-mix(in srgb,#d99a25 14%,var(--bg));color:#b47b08}.announcement-internal{background:var(--soft);color:var(--muted)}.announcement-entry-main time{color:var(--muted);font-size:9px}.announcement-title{display:block;margin-top:8px;color:var(--text);font-size:14px;font-weight:600;text-align:left}.announcement-title:hover{color:var(--accent)}.announcement-entry-main>p{display:-webkit-box;margin-top:7px;overflow:hidden;color:var(--secondary);font-size:10px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-line-clamp:3;-webkit-box-orient:vertical}.announcement-entry-main>footer{display:flex;align-items:center;gap:13px;flex-wrap:wrap;margin-top:12px;padding-top:9px;border-top:1px solid var(--border);color:var(--muted);font-size:9px}.announcement-actions{display:flex;gap:6px;margin-left:auto}
.task-board{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:14px}.task-lane{min-width:0;border:1px solid var(--border);background:var(--bg)}.task-lane>header{display:flex;align-items:center;gap:8px;padding:12px 13px;border-bottom:1px solid var(--border)}.task-lane>header h2{color:var(--text);font-size:12px;font-weight:600}.task-lane>header small{min-width:20px;padding:2px 6px;border-radius:10px;background:var(--soft);color:var(--muted);font-size:9px;text-align:center}.task-lane>header .icon-button{margin-left:auto}.task-lane-dot{width:8px;height:8px;border-radius:50%;background:var(--accent)}.task-lane-dot.done{background:#339e75}.task-card-list{display:grid;gap:9px;padding:10px}.task-entry{padding:12px;border:1px solid var(--border);background:var(--bg)}.task-entry-top{display:flex;align-items:center;gap:7px}.task-pinned{display:inline-flex;align-items:center;gap:3px;color:#b47b08;font-size:9px}.task-entry-title{display:block;margin-top:8px;color:var(--text);font-size:12px;font-weight:600;text-align:left}.task-entry-title:hover{color:var(--accent)}.task-entry>p{margin-top:5px;color:var(--muted);font-size:10px;line-height:1.55}.task-progress-label{display:flex;justify-content:space-between;margin-top:12px;color:var(--muted);font-size:9px}.task-progress-label strong{color:var(--secondary);font-weight:550}.task-progress,.leaderboard-bar{height:5px;margin-top:5px;overflow:hidden;border-radius:5px;background:var(--border)}.task-progress>span,.leaderboard-bar>span{display:block;height:100%;border-radius:inherit;background:var(--accent)}.task-entry-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px;color:var(--muted);font-size:9px}.task-entry-meta>span{display:flex;align-items:center;gap:4px}.task-entry>footer{display:flex;gap:5px;flex-wrap:wrap;margin-top:11px;padding-top:9px;border-top:1px solid var(--border)}.workflow-lane-empty{display:flex;min-height:120px;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--muted);font-size:10px}.workflow-lane-empty svg{color:var(--muted)}
.file-overview-bar{display:flex;gap:1px;margin-bottom:14px;border:1px solid var(--border);background:var(--border)}.file-overview-bar>div{display:flex;align-items:baseline;gap:6px;flex:1;padding:11px 14px;background:var(--bg)}.file-overview-bar strong{color:var(--text);font-size:16px;font-variant-numeric:tabular-nums}.file-overview-bar span{color:var(--muted);font-size:9px}.file-directory-list{display:grid;gap:8px}.file-directory-group{border:1px solid var(--border);background:var(--bg)}.file-directory-group>summary{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;list-style:none;color:var(--accent)}.file-directory-group>summary::-webkit-details-marker{display:none}.file-directory-group>summary strong{color:var(--text);font-size:10px;font-weight:550}.file-directory-group>summary small{color:var(--muted);font-size:9px}.directory-chevron{margin-left:auto;color:var(--muted);transition:transform .15s}.file-directory-group[open] .directory-chevron{transform:rotate(90deg)}.project-file-entry{display:flex;align-items:center;gap:11px;padding:9px 12px 9px 35px;border-top:1px solid var(--border)}.project-file-entry>svg{flex:0 0 auto;color:var(--muted)}.project-file-copy{display:grid;flex:1;min-width:120px;gap:3px}.project-file-copy strong{overflow:hidden;color:var(--text);font-size:10px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.project-file-copy small{color:var(--muted);font-size:9px}.project-file-progress{width:min(150px,16vw);height:5px;overflow:hidden;border-radius:4px;background:var(--border)}.project-file-progress span{display:block;height:100%;background:var(--accent)}.project-file-percent{width:36px;color:var(--secondary);font-size:9px;text-align:right}
.term-workspace{padding:0}.term-workspace-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 17px;border-bottom:1px solid var(--border);background:var(--bg)}.term-workspace-heading>div{display:grid;gap:4px}.term-workspace-heading strong{color:var(--text);font-size:11px}.term-workspace-heading span{color:var(--muted);font-size:9px}.term-table-wrap{overflow:auto}.term-table{width:100%;border-collapse:collapse;table-layout:fixed;background:var(--bg)}.term-table th{position:sticky;top:0;padding:9px 12px;border-bottom:1px solid var(--border);background:var(--soft);color:var(--secondary);font-size:9px;font-weight:550;text-align:left}.term-table th:nth-child(1){width:22%}.term-table th:nth-child(2){width:24%}.term-table th:nth-child(3){width:12%}.term-table th:nth-child(4){width:36%}.term-table th:last-child{width:42px}.term-table td{padding:8px 12px;border-bottom:1px solid var(--border);color:var(--secondary);font-size:10px;line-height:1.45;vertical-align:middle}.term-table tbody tr:hover{background:var(--accent-soft)}.term-source{max-width:100%;overflow:hidden;color:var(--text);font-size:10px;font-weight:550;text-overflow:ellipsis;white-space:nowrap;text-align:left}.term-pos{padding:2px 5px;border:1px solid var(--border);border-radius:3px;color:var(--muted);font-size:9px}.term-extra{display:-webkit-box;max-height:34px;overflow:hidden;color:var(--muted);font-size:9px;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.discussion-list,.member-directory,.leaderboard-list{display:grid;gap:1px;border:1px solid var(--border);background:var(--border)}.discussion-entry{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;padding:13px;background:var(--bg)}.discussion-entry-icon{display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--border);border-radius:50%;color:var(--accent)}.discussion-entry-main{min-width:0}.discussion-entry-main>header{display:flex;align-items:center;gap:8px}.discussion-entry-title{overflow:hidden;color:var(--text);font-size:11px;font-weight:600;text-overflow:ellipsis;white-space:nowrap;text-align:left}.discussion-entry-title:hover{color:var(--accent)}.discussion-entry-main>p{display:-webkit-box;margin-top:6px;overflow:hidden;color:var(--muted);font-size:10px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-line-clamp:2;-webkit-box-orient:vertical}.discussion-entry-main>footer{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-top:8px;color:var(--muted);font-size:9px}.discussion-entry-main>footer>span:nth-child(2){display:flex;align-items:center;gap:4px}.discussion-entry-main>footer>time{margin-left:auto}
.member-summary-strip{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:12px;padding:10px 13px;border:1px solid var(--border);background:var(--bg);color:var(--muted);font-size:9px}.member-summary-strip>span{display:flex;align-items:center;gap:6px}.member-summary-strip strong{color:var(--text);font-size:13px}.member-summary-strip>span:last-child{margin-left:auto}.member-entry{display:flex;align-items:flex-start;gap:11px;padding:13px;background:var(--bg)}.member-avatar{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:13px;font-weight:600}.member-main{flex:1;min-width:0}.member-name-line{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.member-name-line>strong{color:var(--text);font-size:11px;font-weight:600}.member-role{padding:2px 6px;border-radius:9px;background:var(--soft);color:var(--secondary);font-size:9px}.member-role.role-3,.member-role.role-10{background:var(--accent-soft);color:var(--accent)}.member-main>small{display:block;margin-top:4px;color:var(--muted);font-size:9px}.member-contributions{display:flex;gap:13px;flex-wrap:wrap;margin-top:9px;color:var(--muted);font-size:9px}.member-contributions b{margin-left:3px;color:var(--secondary);font-weight:550}.member-note{margin-top:7px;color:var(--muted);font-size:9px;white-space:pre-wrap}.member-entry-actions{display:flex;gap:5px;flex:0 0 auto}
.application-queue-heading,.leaderboard-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;padding:13px 15px;border:1px solid var(--border);background:var(--bg)}.application-queue-heading h2,.leaderboard-heading h2{color:var(--text);font-size:12px;font-weight:600}.application-queue-heading p,.leaderboard-heading p{margin-top:4px;color:var(--muted);font-size:9px}.application-queue-count{display:grid;place-items:center;min-width:30px;height:30px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:11px}.application-queue{display:grid;gap:8px}.application-entry{display:flex;align-items:flex-start;gap:11px;padding:13px;border:1px solid var(--border);background:var(--bg)}.application-entry-main{flex:1;min-width:0}.application-entry-main>header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.application-entry-main>header>strong{color:var(--text);font-size:11px}.application-entry-main>header time{margin-left:auto;color:var(--muted);font-size:9px}.application-entry-main>p{margin-top:7px;color:var(--secondary);font-size:10px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.application-entry-main>footer{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px}.application-reason{margin-left:auto;color:var(--muted);font-size:9px}.leaderboard-heading>svg{color:var(--accent)}.leaderboard-entry{display:grid;grid-template-columns:34px 34px minmax(140px,.8fr) minmax(180px,1.1fr) minmax(220px,1fr);align-items:center;gap:10px;padding:11px 13px;background:var(--bg)}.leaderboard-rank{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--soft);color:var(--muted);font-size:10px}.leaderboard-rank.podium{background:var(--accent-soft);color:var(--accent);font-weight:600}.leaderboard-member{display:grid;gap:4px;min-width:0}.leaderboard-member strong{overflow:hidden;color:var(--text);font-size:10px;font-weight:550;text-overflow:ellipsis;white-space:nowrap}.leaderboard-member small{color:var(--muted);font-size:9px}.leaderboard-score>div:first-child{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:9px}.leaderboard-score strong{color:var(--text);font-size:10px}.leaderboard-breakdown{display:flex;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:9px}.leaderboard-breakdown b{color:var(--secondary);font-weight:500}
.artifact-current,.artifact-history{max-width:1050px;margin:0 auto;border:1px solid var(--border);background:var(--bg)}.artifact-current-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:17px 19px;border-bottom:1px solid var(--border)}.artifact-eyebrow{color:var(--accent);font-size:8px;letter-spacing:.12em}.artifact-current-heading h2{margin-top:5px;color:var(--text);font-size:15px;font-weight:600}.artifact-current-heading p{margin-top:4px;color:var(--muted);font-size:9px}.artifact-ready{display:flex;align-items:center;gap:4px;padding:4px 7px;border-radius:10px;background:color-mix(in srgb,#339e75 12%,var(--bg));color:#2e9b65;font-size:9px}.artifact-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-bottom:1px solid var(--border)}.artifact-stats>div{display:grid;gap:5px;padding:13px 16px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)}.artifact-stats>div:nth-child(3n){border-right:0}.artifact-stats>div:nth-last-child(-n+3){border-bottom:0}.artifact-stats small{color:var(--muted);font-size:9px}.artifact-stats strong{color:var(--text);font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}.artifact-stats strong>small{display:inline;color:var(--muted);font-size:9px;font-weight:400}.artifact-stats>div:nth-child(2)>span{color:var(--accent);font-size:9px}.artifact-license-check{display:flex;align-items:center;gap:8px;padding:14px 17px;color:var(--secondary);font-size:10px}.artifact-license-check input{accent-color:var(--accent)}.artifact-license-check strong{color:var(--accent);font-weight:550}.artifact-download-actions{display:flex;align-items:center;gap:11px;flex-wrap:wrap;padding:0 17px 15px}.artifact-download-actions>span{color:var(--muted);font-size:9px}.artifact-history{margin:16px auto 0;padding:14px}.artifact-history-list{margin-top:10px}.artifact-history-entry{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border)}.artifact-history-icon{display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;border-radius:50%;background:var(--accent-soft);color:var(--accent)}.artifact-history-entry>div{display:grid;flex:1;gap:4px}.artifact-history-entry strong{color:var(--text);font-size:10px;font-weight:550}.artifact-history-entry small{color:var(--muted);font-size:9px}.artifact-empty{display:flex;min-height:220px;flex-direction:column;align-items:center;justify-content:center;gap:9px;border:1px dashed var(--border);background:var(--bg);color:var(--muted);text-align:center}.artifact-empty>svg{color:var(--accent)}.artifact-empty strong{color:var(--text);font-size:13px}.artifact-empty span{font-size:10px}
@media(max-width:1050px){.project-settings-workspace{grid-template-columns:1fr}.leaderboard-entry{grid-template-columns:28px 34px minmax(120px,1fr) minmax(150px,1.1fr)}.leaderboard-breakdown{grid-column:3/5;padding-top:4px}}
@media(max-width:720px){.section-header{align-items:flex-start;padding:13px 14px}.section-header-actions{flex-direction:column;align-items:stretch}.section-title h1{font-size:16px}.section-heading>p{max-width:52vw}.section-toolbar{padding:7px 10px;flex-wrap:wrap}.section-search{width:min(250px,42vw)}.section-workspace{padding:12px}.section-dialog-backdrop{padding:10px}.section-dialog{max-height:calc(100vh - 52px)}.section-form-grid{grid-template-columns:1fr}.history-entry{grid-template-columns:24px minmax(0,1fr);gap:5px}.history-entry-diff{grid-template-columns:1fr}.history-entry-diff>svg{display:none}.announcement-entry{grid-template-columns:27px minmax(0,1fr);gap:7px;padding:10px}.announcement-entry-mark{width:25px;height:25px}.announcement-entry-main>footer{gap:8px}.announcement-actions{width:100%;margin-left:0}.task-board{grid-template-columns:1fr}.file-overview-bar>div{display:grid;gap:4px;padding:9px}.project-file-entry{flex-wrap:wrap;padding-left:12px}.project-file-copy{min-width:calc(100% - 70px)}.project-file-progress{flex:1;width:auto}.project-file-entry>.button{margin-left:auto}.term-table{min-width:680px}.member-entry{flex-wrap:wrap}.member-entry-actions{width:100%;margin-left:45px}.member-summary-strip>span:last-child{margin-left:0}.application-entry-main>header time{margin-left:0}.application-reason{width:100%;margin-left:0}.leaderboard-entry{grid-template-columns:26px 30px minmax(80px,1fr) minmax(95px,.8fr);gap:7px;padding:9px}.leaderboard-entry>.member-avatar{width:30px;height:30px}.leaderboard-score,.leaderboard-breakdown{grid-column:1/5}.artifact-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.artifact-stats>div:nth-child(3n){border-right:1px solid var(--border)}.artifact-stats>div:nth-child(2n){border-right:0}.artifact-stats>div:nth-last-child(-n+3){border-bottom:1px solid var(--border)}.artifact-stats>div:nth-last-child(-n+2){border-bottom:0}.project-settings-readonly{grid-template-columns:1fr 1fr}.project-settings-form,.project-settings-shortcuts{padding:13px}.project-settings-footer{align-items:flex-start;flex-direction:column}.project-management-links small{max-width:220px}}
.member-directory{display:grid;gap:14px;border:0;background:transparent}
.member-role-group{min-width:0;background:transparent}
.member-role-group>header{display:flex;align-items:center;gap:8px;padding:10px 13px;border-bottom:1px solid var(--border)}
.member-role-group>header h2{color:var(--text);font-size:11px;font-weight:600}
.member-role-group>header span{display:grid;place-items:center;min-width:21px;height:19px;padding:0 6px;border-radius:10px;background:var(--soft);color:var(--muted);font-size:9px;font-variant-numeric:tabular-nums}
.member-role-group-list{display:grid;gap:1px;border:1px solid var(--border);background:var(--border)}
.file-overview-bar{display:flex;align-items:baseline;gap:28px;flex-wrap:wrap;margin:0 0 22px;padding:0 2px 17px;border:0;border-bottom:1px solid var(--border);background:transparent}
.file-overview-bar>span{color:var(--muted);font-size:12px}
.file-overview-bar strong{margin-right:4px;color:var(--accent);font-size:18px;font-weight:500;font-variant-numeric:tabular-nums}
.file-edit-form{display:grid;max-width:650px;gap:8px;margin:0 0 20px;padding:18px;border:1px solid var(--border);border-radius:5px;background:var(--soft)}
.file-edit-form>strong{color:var(--text);font-size:14px;font-weight:600}
.file-edit-form>label{margin-top:3px;color:var(--secondary);font-size:11px}
.file-edit-form>input{width:100%;padding:9px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--text);font-size:12px}
.file-edit-form>div{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.file-page-groups :deep(.motion-folder){margin-bottom:14px;border:1px solid var(--border);border-radius:5px;background:var(--bg)}
.file-page-groups :deep(.folder-toggle){display:flex;align-items:center;gap:10px;width:100%;padding:12px;border:0;background:var(--soft);color:var(--secondary);font-size:11px;text-align:left;cursor:pointer}
.file-page-groups :deep(.folder-toggle>span){flex:1;min-width:0;overflow-wrap:anywhere}
.file-page-groups :deep(.folder-toggle small){color:var(--muted);font-size:10px}
.file-page-groups :deep(.folder-toggle:hover){background:var(--accent-soft)}
.file-page-groups :deep(.folder-chevron){flex:0 0 auto;transition:transform .15s}
.file-page-groups :deep(.folder-chevron.expanded){transform:rotate(90deg)}
.file-page-groups :deep(.folder-action-hint){padding-left:12px}
.file-page-groups :deep(.root-file-group){border-color:var(--accent-soft)}
.file-page-groups :deep(.root-file-group>.folder-toggle){color:var(--accent)}
.file-page-groups :deep(.folder-toggle:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.file-page-groups :deep(.sidebar-file){margin:0;padding:4px 12px;border-top:1px solid var(--border);border-radius:0}
.file-page-groups :deep(.sidebar-file-select){align-items:center;gap:12px;padding:13px 5px}
.file-page-groups :deep(.sidebar-file-select>svg){margin-top:0}
.file-page-groups :deep(.sidebar-file-select strong){font-size:14px}
.file-page-groups :deep(.sidebar-file-select small){margin-top:6px;font-size:11px}
.file-page-groups :deep(.sidebar-progress){max-width:240px;margin-top:9px}
.file-page-groups :deep(.sidebar-file-actions){flex-direction:row;margin-left:16px}
.file-page-groups :deep(.manager-enter-file){display:flex;flex:0 0 100px;align-items:center;justify-content:flex-end;color:var(--accent);font-size:11px}
.history-entry-diff.unified{grid-template-columns:minmax(0,1fr)}
.history-diff-column p del,.history-diff-column p ins{padding:0 1px;border-radius:2px;text-decoration:none}
.history-diff-column p del{background:color-mix(in srgb,#d9534f 17%,var(--bg));color:#a6322e}
.history-diff-column p ins{background:color-mix(in srgb,#339e75 17%,var(--bg));color:#176f49}
.history-diff-empty{margin-top:10px;padding:9px 11px;border-radius:3px;background:var(--soft);color:var(--muted);font-size:10px}
@media(max-width:1200px){.file-page-groups :deep(.manager-enter-file){display:none}}
@media(max-width:720px){.file-overview-bar{gap:10px 20px;margin-bottom:16px;padding-bottom:12px}.file-overview-bar strong{font-size:16px}.file-page-groups :deep(.sidebar-file){flex-wrap:wrap;padding:4px 9px}.file-page-groups :deep(.sidebar-file-select){min-width:0}.file-page-groups :deep(.sidebar-file-actions){margin-left:auto}.file-edit-form{padding:13px}}
</style>
