import type { Suggestion } from '../types/editor'
import type { SourceDiffPart } from './sourceDiff'

let worker: Worker | undefined, nextId = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
function calculate<T>(operation: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      worker = new Worker(new URL('../workers/text.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data }) => {
        const request = pending.get(data.id)
        if (!request) return
        pending.delete(data.id)
        if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result)
      }
      worker.onerror = () => {
        for (const request of pending.values()) request.reject(new Error('文本计算服务加载失败，请重新获取'))
        pending.clear(); worker?.terminate(); worker = undefined
      }
    }
    const id = ++nextId
    pending.set(id, { resolve, reject })
    try { worker.postMessage({ id, operation, payload }) }
    catch (error) { pending.delete(id); reject(error) }
  })
}
export function matchSuggestions(candidates: Suggestion[], current: string) {
  return calculate<Suggestion[]>('suggestions', { candidates, current })
}
const diffs = new Map<string, Promise<SourceDiffPart[]>>()
export function compareSources(original: string, current: string) {
  const key = JSON.stringify([original, current])
  let result = diffs.get(key)
  if (!result) {
    result = calculate<SourceDiffPart[]>('diff', { original, current })
    diffs.set(key, result)
    result.catch(() => diffs.delete(key))
    if (diffs.size > 64) diffs.delete(diffs.keys().next().value!)
  }
  return result
}
