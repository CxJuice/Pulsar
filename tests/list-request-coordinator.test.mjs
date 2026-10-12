import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ListRequestCoordinator } from '../app/utils/listRequestCoordinator.ts'

test('obsolete page requests are canceled without canceling a later request', async () => {
  const canceled = []
  let finishFirst, finishSecond
  let sequence = 0
  const requests = new ListRequestCoordinator(id => canceled.push(id), () => `page-${++sequence}`)
  const first = requests.run(() => new Promise(resolve => { finishFirst = resolve }))
  requests.cancelAll()
  const second = requests.run(() => new Promise(resolve => { finishSecond = resolve }))
  assert.deepEqual(canceled, ['page-1'])
  finishFirst('stale')
  assert.equal(await first, 'stale')
  requests.cancelAll()
  assert.deepEqual(canceled, ['page-1', 'page-2'])
  finishSecond('current')
  assert.equal(await second, 'current')
  requests.cancelAll()
  assert.equal(canceled.length, 2)
})
