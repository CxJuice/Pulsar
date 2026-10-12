import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TranslationContextCache } from '../app/utils/translationContextCache.ts'
import { TranslationResultCache, providerCachedInputTokens } from '../electron/translation-result-cache.cjs'

const item = (original, id = 1) => ({ original, id, project: 1, fileId: 2 })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('single references reuse the exact suggestion score, strictly above 40 percent, and prefer the closest group', async () => {
  const cache = new TranslationContextCache()
  const loaded = []
  const fetch = async representative => { loaded.push(representative.original); return { exemplar: representative.original } }
  const first = await cache.load('account:file', item('abcde'), fetch)
  const boundary = await cache.load('account:file', item('abXYZ'), fetch)
  assert.notStrictEqual(first, boundary)
  assert.strictEqual(await cache.load('account:file', item('abXYe'), fetch), boundary)
  assert.strictEqual(await cache.load('account:file', item('abcde', 9), fetch), first)
  await cache.load('account:file', item('ABCDE'), fetch)
  assert.deepEqual(loaded, ['abcde', 'abXYZ', 'ABCDE'])
})

test('scope changes and explicit clears invalidate even late in-flight reference results', async () => {
  const cache = new TranslationContextCache(), gate = deferred()
  const old = cache.load('account-one:file', item('Avenger Combat Helmet Red'), async () => { await gate.promise; return { version: 'old' } })
  const fresh = await cache.load('account-two:file', item('Avenger Combat Helmet Blue'), async () => ({ version: 'new' }))
  gate.resolve()
  assert.equal((await old).version, 'old')
  assert.strictEqual(await cache.load('account-two:file', item('Avenger Combat Helmet Blue'), async () => { throw new Error('late result replaced the new scope') }), fresh)
  cache.clear()
  assert.equal((await cache.load('account-two:file', item('Avenger Combat Helmet Blue'), async () => ({ version: 'refreshed' }))).version, 'refreshed')
})

test('references deduplicate only loading reference data, without any translation completion dependency', async () => {
  const cache = new TranslationContextCache(), gate = deferred()
  let fetched = 0
  const fetch = async representative => { fetched++; await gate.promise; return { exemplar: representative.original } }
  const a = cache.load('scope', item('Avenger Combat Helmet Red'), fetch)
  const b = cache.load('scope', item('Avenger Combat Helmet Blue'), fetch)
  assert.strictEqual(a, b)
  gate.resolve()
  assert.strictEqual(await a, await b)
  assert.equal(fetched, 1)
})

test('reference TTL, LRU capacity, memory budget and failure recovery are bounded', async () => {
  let now = 0, fetched = 0
  const cache = new TranslationContextCache({ ttl: 10, limit: 2, now: () => now })
  const fetch = async representative => ({ number: ++fetched, exemplar: representative.original })
  const a = await cache.load('scope', item('aaaaa'), fetch)
  await cache.load('scope', item('bbbbb'), fetch)
  assert.strictEqual(await cache.load('scope', item('aaaaa'), fetch), a)
  await cache.load('scope', item('ccccc'), fetch)
  assert.equal((await cache.load('scope', item('bbbbb'), fetch)).number, 4)
  now = 10
  assert.equal((await cache.load('scope', item('bbbbb'), fetch)).number, 5)
  const small = new TranslationContextCache({ maximumCharacters: 20 })
  await small.load('scope', item('aaaaa'), async () => ({ large: 'x'.repeat(100) }))
  assert.equal((await small.load('scope', item('aaaaa'), async () => ({ fresh: true }))).fresh, true)
  cache.clear()
  await assert.rejects(cache.load('scope', item('aaaaa'), async () => { throw new Error('auxiliary request failed') }), /auxiliary request failed/)
  assert.equal((await cache.load('scope', item('aaaaa'), fetch)).number, 6)
})

test('successful results expire and evict by LRU and bytes, with copies preventing mutation', () => {
  let now = 0
  const cache = new TranslationResultCache({ ttl: 10, limit: 2, maximumBytes: 150, now: () => now })
  cache.write('a', { text: 'first', provider: 'llm' })
  cache.write('b', { text: 'second', provider: 'llm' })
  const copy = cache.read('a'); copy.text = 'mutated'
  assert.equal(cache.read('a').text, 'first')
  cache.write('c', { text: 'third', provider: 'llm' })
  assert.equal(cache.read('b'), undefined)
  now = 10
  assert.equal(cache.read('a'), undefined)
  cache.write('large', { text: 'x'.repeat(200), provider: 'llm' })
  assert.equal(cache.read('large'), undefined)
  cache.write('blank', { text: '  ', provider: 'llm' })
  assert.equal(cache.read('blank'), undefined)
  const generation = cache.generation
  cache.clear()
  cache.write('late', { text: 'old reply', provider: 'llm' }, generation)
  assert.equal(cache.read('late'), undefined)
})

test('provider cache accounting supports compatible usage fields and keeps missing data unknown', () => {
  for (const usage of [{ prompt_cache_hit_tokens: 123 }, { prompt_tokens_details: { cached_tokens: 123 } },
    { input_tokens_details: { cached_tokens: 123 } }, { cache_read_input_tokens: 123 }]) {
    assert.equal(providerCachedInputTokens({ usage }), 123)
  }
  assert.equal(providerCachedInputTokens({ usage: { prompt_cache_hit_tokens: 0 } }), 0)
  for (const data of [undefined, {}, { usage: {} }, { usage: { prompt_cache_hit_tokens: -1 } }, { usage: { input_tokens_details: { cached_tokens: '123' } } }]) {
    assert.equal(providerCachedInputTokens(data), undefined)
  }
})
