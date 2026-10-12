import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BatchTranslationRequests, normalizePrefillConcurrency, PrefillSaveQueue, runConcurrentPrefill } from '../app/utils/batchPrefill.ts'
import { BatchTranslationContextPool, groupTranslationContexts, SHARED_CONTEXT_SIMILARITY } from '../app/utils/batchTranslationContext.ts'
import { sourceSimilarity } from '../app/utils/suggestionMatch.ts'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const entry = (id, original, fields = {}) => ({ id, original, project: 1, fileId: 2, key: `ENTRY_${id}`, ...fields })

test('matching shares equipment variants across attributes, without a color dictionary', () => {
  for (const variants of [
    ['Avenger Combat Helmet Red', 'Avenger Combat Helmet Blue', 'Avenger Combat Helmet Violet'],
    ['Avenger Combat Helmet Titanium', 'Avenger Combat Helmet Polymer', 'Avenger Combat Helmet Steel'],
    ['Avenger Combat Helmet Mk3', 'Avenger Combat Helmet Mk4'],
    ['Collect 10 Avenger combat helmets.', 'Collect 25 Avenger combat helmets.'],
    ['Arden assault vest premium edition', 'Arden assault vest standard edition'],
    ['Avenger Combat Helmet Carbon Fiber', 'Avenger Combat Helmet Steel'],
  ]) {
    const items = variants.map((source, index) => entry(index, source))
    const groups = groupTranslationContexts(items)
    assert.equal(groups.length, 1, variants.join(' / '))
    assert.equal(groups[0].items.length, variants.length)
    assert.match(groups[0].variantTemplate, /\[variant\]/)
    assert.deepEqual(items.map(item => item.original), variants)
  }
})

test('matching uses the existing full-string percentage and strictly greater than 40 percent within one file', () => {
  const items = [entry(1, 'Avenger Combat Helmet Red'), entry(2, 'Avenger Combat Helmet Blue', { project: 9 }),
    entry(3, 'Avenger Combat Helmet Gold', { fileId: 8 })]
  assert.equal(groupTranslationContexts(items).length, items.length)
  assert.equal(SHARED_CONTEXT_SIMILARITY, 0.4)
  assert.equal(sourceSimilarity('abcde', 'abXYZ'), 0.4)
  assert.equal(groupTranslationContexts([entry(1, 'abcde'), entry(2, 'abXYZ')]).length, 2)
  assert.equal(groupTranslationContexts([entry(1, 'abcde'), entry(2, 'abXYe')]).length, 1)
  assert.equal(groupTranslationContexts([entry(1, 'ABCDE'), entry(2, 'abcde')]).length, 2)
  assert.equal(groupTranslationContexts([entry(1, 'A  B'), entry(2, 'A\tB')]).length, sourceSimilarity('A  B', 'A\tB') > 0.4 ? 1 : 2)
  assert.equal(groupTranslationContexts([entry(1, 'Go to ship'), entry(2, 'Go to shop')]).length, 1)
  const long = 'A very long localization entry. '.repeat(40)
  assert.equal(groupTranslationContexts([entry(10, long), entry(11, long), entry(12, long + 'Different')]).length, 1)
  for (const group of groupTranslationContexts([entry(1, 'Avenger Combat Helmet Red'), entry(2, 'Avenger Combat Helmet Blue'), entry(3, 'Delete all saved profiles.')])) {
    for (const item of group.items) assert.ok(sourceSimilarity(group.representative.original, item.original) > 0.4)
  }
})

test('similar requests share one reference fetch and fill all slots before any translation completes', async () => {
  const contextGate = deferred(), translations = Array.from({ length: 6 }, deferred), started = []
  const items = translations.map((_, index) => entry(index, `Avenger Combat Helmet Mk${index}`))
  let loads = 0
  const pool = new BatchTranslationContextPool(items, async () => { loads++; await contextGate.promise; return Object.freeze({ terms: ['Avenger'] }) })
  const references = []
  const pending = runConcurrentPrefill(items, 3, async item => {
    references.push(await pool.load(item))
    started.push(item.id)
    await translations[item.id].promise
  }, () => false)
  await tick()
  assert.equal(loads, 1)
  contextGate.resolve()
  await tick()
  assert.deepEqual(started, [0, 1, 2])
  assert.strictEqual(references[0], references[1])
  translations[1].resolve()
  await tick()
  assert.deepEqual(started, [0, 1, 2, 3])
  translations.forEach(gate => gate.resolve())
  await pending
  assert.equal(loads, 1)
})

test('groups prepare independently, and auxiliary failures do not poison later entries or batches', async () => {
  const items = [entry(1, 'Avenger Combat Helmet Mk1'), entry(2, 'Avenger Combat Helmet Mk2'), entry(3, 'Delete the selected profile.')]
  const slow = deferred()
  let attempts = 0
  const pool = new BatchTranslationContextPool(items, async group => {
    if (group.representative.id === 3) return 'other group'
    if (++attempts === 1) throw new Error('context unavailable')
    await slow.promise
    return 'equipment group'
  })
  await assert.rejects(pool.load(items[0]), /context unavailable/)
  const pending = pool.load(items[1])
  assert.equal(await pool.load(items[2]), 'other group')
  slow.resolve()
  assert.equal(await pending, 'equipment group')
  assert.equal(attempts, 2)
  const fresh = new BatchTranslationContextPool(items, async () => 'new references')
  assert.equal(await fresh.load(items[0]), 'new references')
})

test('slow serial saves do not occupy translation slots; buffering is bounded and completion drains writes', async () => {
  const gate = deferred(), saves = new PrefillSaveQueue(4), started = [], saved = []
  const pending = runConcurrentPrefill([0, 1, 2, 3, 4, 5, 6, 7], 2, async item => {
    started.push(item)
    await saves.enqueue(async () => { await gate.promise; saved.push(item) })
  }, () => false)
  await tick()
  assert.ok(started.length >= 4, 'translations were serialized behind the first save')
  assert.ok(started.length <= 5, 'translation backlog is unbounded')
  assert.deepEqual(saved, [])
  gate.resolve()
  await pending
  await saves.drain()
  assert.deepEqual(saved, [0, 1, 2, 3, 4, 5, 6, 7])
})

test('canceling while grouped references prepare suppresses late sends from every subscriber', async () => {
  const items = [entry(1, 'Avenger Combat Helmet Red'), entry(2, 'Avenger Combat Helmet Blue')]
  const gate = deferred(), sent = [], requests = new BatchTranslationRequests(() => {})
  const pool = new BatchTranslationContextPool(items, async () => { await gate.promise; return 'shared' })
  const jobs = items.map(item => requests.run(async (_id, isCurrent) => {
    await pool.load(item)
    if (isCurrent()) sent.push(item.id)
  }))
  const rejected = jobs.map(job => assert.rejects(job, /翻译已停止/))
  await tick()
  requests.cancelAll()
  await Promise.all(rejected)
  gate.resolve()
  await tick()
  assert.deepEqual(sent, [])
})

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
