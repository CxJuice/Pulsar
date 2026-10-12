import type { Term } from '~/types/editor'

interface StoredTermRow { key: string; scope: string; term: Term }
interface StoredCatalogMetadata { key: string; syncedAt: string; rowCount: number; complete: true }
export interface ProjectTermCatalogSnapshot { terms: Term[]; syncedAt: string }
export interface ProjectTermCatalogDelta { added: number; updated: number; removed: number; syncedAt: string }

const databaseName = 'sckit-project-term-catalog'
const databaseVersion = 1
let databaseRequest: Promise<IDBDatabase> | undefined

export function projectTermCatalogScope(projectId: number | string, userId: number | string | undefined, mode: string) {
  return `${mode || 'unknown'}:${userId ?? 'anonymous'}:${projectId}`
}

function openDatabase() {
  if (databaseRequest) return databaseRequest
  databaseRequest = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前环境不支持术语缓存')); return }
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('terms')) {
        const terms = database.createObjectStore('terms', { keyPath: 'key' })
        terms.createIndex('byScope', 'scope', { unique: false })
      }
      if (!database.objectStoreNames.contains('catalogs')) database.createObjectStore('catalogs', { keyPath: 'key' })
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () => reject(request.error || new Error('无法打开术语缓存'))
    request.onblocked = () => reject(new Error('术语缓存正在被其他窗口使用'))
  }).catch(error => {
    databaseRequest = undefined
    throw error
  })
  return databaseRequest
}

function termKey(scope: string, id: number) { return `${scope}/${id}` }
function termSignature(term: Term) {
  return JSON.stringify({
    id: term.id,
    term: term.term,
    translation: term.translation,
    note: term.note ?? null,
    pos: term.pos ?? null,
    match: term.match || [],
    variants: term.variants || [],
    caseSensitive: !!term.caseSensitive,
    uid: term.uid ?? null,
    project: term.project ?? null,
    updatedAt: term.updatedAt ?? null,
  })
}
function sortTerms(terms: Term[]) {
  return [...terms].sort((a, b) => a.term.localeCompare(b.term) || a.id - b.id)
}

export async function readProjectTermCatalog(scope: string): Promise<ProjectTermCatalogSnapshot | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['terms', 'catalogs'], 'readonly')
    const termRequest = transaction.objectStore('terms').index('byScope').getAll(scope)
    const metadataRequest = transaction.objectStore('catalogs').get(scope)
    let rows: StoredTermRow[] = []
    let metadata: StoredCatalogMetadata | undefined
    let failed = false
    const fail = (error: unknown) => {
      if (failed) return
      failed = true
      reject(error instanceof Error ? error : new Error('读取术语缓存失败'))
    }
    termRequest.onsuccess = () => { rows = termRequest.result as StoredTermRow[] }
    metadataRequest.onsuccess = () => { metadata = metadataRequest.result as StoredCatalogMetadata | undefined }
    termRequest.onerror = () => fail(termRequest.error)
    metadataRequest.onerror = () => fail(metadataRequest.error)
    transaction.oncomplete = () => {
      if (failed) return
      if (!metadata?.complete) { resolve(null); return }
      resolve({ terms: sortTerms(rows.map(row => row.term)), syncedAt: metadata.syncedAt })
    }
    transaction.onerror = () => fail(transaction.error)
    transaction.onabort = () => fail(transaction.error)
  })
}

export async function syncProjectTermCatalog(scope: string, incoming: Term[]): Promise<ProjectTermCatalogDelta> {
  const byId = new Map<number, Term>()
  for (const term of incoming) {
    if (!Number.isInteger(term.id) || term.id <= 0 || typeof term.term !== 'string' || typeof term.translation !== 'string') {
      throw new Error('术语列表包含无效记录，缓存未更新')
    }
    if (byId.has(term.id)) throw new Error('术语列表分页出现重复记录，缓存未更新，请重试')
    byId.set(term.id, term)
  }

  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['terms', 'catalogs'], 'readwrite')
    const termsStore = transaction.objectStore('terms')
    const request = termsStore.index('byScope').getAll(scope)
    const syncedAt = new Date().toISOString()
    let delta: ProjectTermCatalogDelta | undefined
    let failed = false
    const fail = (error: unknown) => {
      if (failed) return
      failed = true
      try { transaction.abort() } catch { /* The transaction may already be closed. */ }
      reject(error instanceof Error ? error : new Error('写入术语缓存失败'))
    }

    request.onsuccess = () => {
      try {
        const existingRows = request.result as StoredTermRow[]
        const existing = new Map(existingRows.map(row => [row.term.id, row.term]))
        let added = 0, updated = 0, removed = 0
        for (const term of byId.values()) {
          const previous = existing.get(term.id)
          if (!previous) added++
          else if (termSignature(previous) !== termSignature(term)) updated++
          if (!previous || termSignature(previous) !== termSignature(term)) {
            termsStore.put({ key: termKey(scope, term.id), scope, term } satisfies StoredTermRow)
          }
        }
        for (const row of existingRows) {
          if (!byId.has(row.term.id)) { termsStore.delete(row.key); removed++ }
        }
        transaction.objectStore('catalogs').put({ key: scope, syncedAt, rowCount: byId.size, complete: true } satisfies StoredCatalogMetadata)
        delta = { added, updated, removed, syncedAt }
      } catch (error) { fail(error) }
    }
    request.onerror = () => fail(request.error)
    transaction.oncomplete = () => { if (!failed && delta) resolve(delta) }
    transaction.onerror = () => fail(transaction.error)
    transaction.onabort = () => fail(transaction.error)
  })
}

export async function upsertProjectTerm(scope: string, term: Term) {
  const database = await openDatabase()
  const transaction = database.transaction('terms', 'readwrite')
  transaction.objectStore('terms').put({ key: termKey(scope, term.id), scope, term } satisfies StoredTermRow)
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('更新术语缓存失败'))
    transaction.onabort = () => reject(transaction.error || new Error('更新术语缓存失败'))
  })
}

export async function deleteProjectTerm(scope: string, termId: number) {
  const database = await openDatabase()
  const transaction = database.transaction('terms', 'readwrite')
  transaction.objectStore('terms').delete(termKey(scope, termId))
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('更新术语缓存失败'))
    transaction.onabort = () => reject(transaction.error || new Error('更新术语缓存失败'))
  })
}
