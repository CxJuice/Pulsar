import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BatchTranslationRequests, normalizePrefillConcurrency, runConcurrentPrefill } from '../app/utils/batchPrefill.ts'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('concurrency is bounded and invalid persisted settings fall back to serial execution', () => {
  for (const value of [null, undefined, '', 'invalid', 0, -1, Infinity, NaN]) assert.equal(normalizePrefillConcurrency(value), 1)
  assert.equal(normalizePrefillConcurrency('4'), 4)
  assert.equal(normalizePrefillConcurrency(3.9), 3)
  assert.equal(normalizePrefillConcurrency(100), 16)
})

test('workers refill available slots without exceeding the configured concurrency', async () => {
  const gates = Array.from({ length: 6 }, deferred)
  const started = [], completed = []
  let active = 0, maximum = 0
  const pending = runConcurrentPrefill([0, 1, 2, 3, 4, 5], 3, async index => {
    started.push(index)
    maximum = Math.max(maximum, ++active)
    await gates[index].promise
    active--
    completed.push(index)
  }, () => false)
  assert.deepEqual(started, [0, 1, 2])
  gates[1].resolve()
  await tick()
  assert.deepEqual(started, [0, 1, 2, 3])
  gates[0].resolve(); gates[2].resolve(); gates[3].resolve()
  await tick()
  gates[4].resolve(); gates[5].resolve()
  await pending
  assert.equal(maximum, 3)
  assert.deepEqual([...completed].sort(), [0, 1, 2, 3, 4, 5])
})

test('stop prevents queued entries from starting and waits for active work to finish', async () => {
  const gate = deferred(), started = []
  let stopped = false, finished = false
  const pending = runConcurrentPrefill([1, 2, 3, 4], 2, async item => {
    started.push(item)
    await gate.promise
  }, () => stopped).then(() => { finished = true })
  stopped = true
  await tick()
  assert.equal(finished, false)
  gate.resolve()
  await pending
  assert.deepEqual(started, [1, 2])
})

test('a worker failure does not report completion while another save is still running', async () => {
  const gate = deferred()
  let settled = false
  const pending = runConcurrentPrefill([1, 2], 2, async item => {
    if (item === 1) throw new Error('save failed')
    await gate.promise
  }, () => false)
  const rejected = assert.rejects(pending, /save failed/).then(() => { settled = true })
  await tick()
  assert.equal(settled, false)
  gate.resolve()
  await rejected
})

test('parallel translation results remain independent when completed out of order', async () => {
  let sequence = 0
  const group = new BatchTranslationRequests(() => {}, () => `translate-${++sequence}`)
  const first = deferred(), second = deferred()
  const a = group.run(async () => { await first.promise; return 'first entry' })
  const b = group.run(async () => { await second.promise; return 'second entry' })
  assert.equal(group.size, 2)
  second.resolve()
  assert.equal(await b, 'second entry')
  assert.equal(group.size, 1)
  first.resolve()
  assert.equal(await a, 'first entry')
  assert.equal(group.size, 0)
})

test('cancel settles all translations, suppresses late context work, and permits a fresh batch', async () => {
  const canceled = [], contexts = [deferred(), deferred()], sent = []
  let sequence = 0
  const group = new BatchTranslationRequests(id => canceled.push(id), () => `translate-${++sequence}`)
  const jobs = contexts.map(context => group.run(async (id, isCurrent) => {
    await context.promise
    if (isCurrent()) sent.push(id)
    return id
  }))
  const rejected = jobs.map(job => assert.rejects(job, /翻译已停止/))
  await tick()
  group.cancelAll()
  await Promise.all(rejected)
  assert.deepEqual(canceled, ['translate-1', 'translate-2'])
  const fresh = group.run(async id => id)
  contexts.forEach(context => context.resolve())
  assert.equal(await fresh, 'translate-3')
  await tick()
  assert.deepEqual(sent, [])
  assert.equal(group.size, 0)
})
