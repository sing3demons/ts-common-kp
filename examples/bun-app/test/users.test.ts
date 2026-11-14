import { beforeEach, describe, expect, test } from 'bun:test'
import { App } from '../src/lib/kp.ts'
import { errorHandler, notFoundHandler } from '../src/middleware/error.ts'
import { createUserRoutes } from '../src/modules/users/index.ts'

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('bun-app /api/users', () => {
  let app: App
  beforeEach(() => {
    app = new App().logger({ level: 'silent' }).onError(errorHandler).notFound(notFoundHandler).register(createUserRoutes())
  })

  test('CRUD flow', async () => {
    let res = await app.request('/api/users', json('POST', { name: 'Ann', email: 'ann@x.io' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 1, name: 'Ann', email: 'ann@x.io' })

    res = await app.request('/api/users/1', json('PATCH', { name: 'Anna' }))
    expect(await res.json()).toEqual({ id: 1, name: 'Anna', email: 'ann@x.io' })

    res = await app.request('/api/users?limit=5')
    expect(await res.json()).toHaveLength(1)

    res = await app.request('/api/users/1', { method: 'DELETE' })
    expect(res.status).toBe(204)

    res = await app.request('/api/users/1')
    expect(res.status).toBe(404)
  })

  test('validation and business errors', async () => {
    expect((await app.request('/api/users', json('POST', { name: '' }))).status).toBe(400)
    expect((await app.request('/api/users/abc')).status).toBe(400)

    await app.request('/api/users', json('POST', { name: 'A', email: 'a@x.io' }))
    const dup = await app.request('/api/users', json('POST', { name: 'B', email: 'a@x.io' }))
    expect(dup.status).toBe(409)
  })

  test('not found', async () => {
    expect((await app.request('/nope')).status).toBe(404)
  })
})
