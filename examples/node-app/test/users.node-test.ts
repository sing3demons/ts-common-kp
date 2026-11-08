import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import { App } from '../src/lib/kp.ts'
import { errorHandler, notFoundHandler } from '../src/middleware/error.ts'
import { createUserRoutes } from '../src/modules/users/index.ts'

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('node-app /api/users', () => {
  let app: App
  beforeEach(() => {
    app = new App().onError(errorHandler).notFound(notFoundHandler).register(createUserRoutes())
  })

  test('CRUD flow', async () => {
    let res = await app.request('/api/users', json('POST', { name: 'Ann', email: 'ann@x.io' }))
    assert.equal(res.status, 201)
    assert.deepEqual(await res.json(), { id: 1, name: 'Ann', email: 'ann@x.io' })

    res = await app.request('/api/users/1', json('PATCH', { name: 'Anna' }))
    assert.deepEqual(await res.json(), { id: 1, name: 'Anna', email: 'ann@x.io' })

    res = await app.request('/api/users?limit=5')
    assert.equal(((await res.json()) as unknown[]).length, 1)

    res = await app.request('/api/users/1', { method: 'DELETE' })
    assert.equal(res.status, 204)

    res = await app.request('/api/users/1')
    assert.equal(res.status, 404)
  })

  test('validation and business errors', async () => {
    assert.equal((await app.request('/api/users', json('POST', { name: '' }))).status, 400)
    assert.equal((await app.request('/api/users/abc')).status, 400)

    await app.request('/api/users', json('POST', { name: 'A', email: 'a@x.io' }))
    const dup = await app.request('/api/users', json('POST', { name: 'B', email: 'a@x.io' }))
    assert.equal(dup.status, 409)
  })

  test('not found', async () => {
    assert.equal((await app.request('/nope')).status, 404)
  })
})
