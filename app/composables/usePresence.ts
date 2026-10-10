import type { PresenceState, OccupyingUser } from '~/types/editor'

export function usePresence(project: Ref<number>, selected: Ref<number | null>, enabled: Ref<boolean>, canClaim: Ref<boolean>) {
  const route = useRoute()
  const state = ref<PresenceState>({ projectId: 0, status: 'idle', editors: [], userId: null, sessionId: null, message: '' })
  let unsubscribe: (() => void) | undefined, sequence = 0
  const active = computed(() => enabled.value && project.value > 0)
  const byString = computed(() => {
    const result = new Map<number, OccupyingUser[]>()
    if (!active.value || state.value.projectId !== project.value || state.value.status !== 'connected') return result
    for (const user of state.value.editors) {
      const users = result.get(user.editing) || []
      if (!users.some(existing => existing.id === user.id)) users.push(user)
      result.set(user.editing, users)
    }
    return result
  })
  const current = computed(() => selected.value ? byString.value.get(selected.value) || [] : [])
  const occupied = computed(() => current.value.some(user => user.id !== state.value.userId))
  const onlineCount = computed(() => new Set(state.value.editors.map(user => user.id)).size)
  function accept(value: PresenceState) { if (active.value && value.projectId === project.value) state.value = value }
  async function sync() {
    const revision = ++sequence
    const target = { projectId: active.value ? project.value : 0, stringId: active.value && canClaim.value && route.path === '/editor' ? selected.value : null }
    state.value = { ...state.value, projectId: target.projectId, status: target.projectId ? 'connecting' : 'idle', editors: [], message: '' }
    if (!window.scKit?.presence) return
    try {
      const result = await window.scKit.presence(target)
      if (revision !== sequence) return
      if (result.ok && result.data) state.value = result.data
      else state.value = { ...state.value, status: 'unavailable', message: result.message || '无法同步占用' }
    } catch { if (revision === sequence) state.value = { ...state.value, status: 'unavailable', message: '无法同步占用，请重新连接 ParaTranz' } }
  }
  async function retry() { await window.scKit?.presence({ projectId: 0, stringId: null }); await sync() }
  watch([active, project, selected, canClaim, () => route.path], sync)
  onMounted(() => { unsubscribe = window.scKit?.onPresence(accept); sync() })
  onBeforeUnmount(() => { ++sequence; unsubscribe?.(); window.scKit?.presence({ projectId: 0, stringId: null }) })
  return { state, byString, current, occupied, onlineCount, retry }
}
