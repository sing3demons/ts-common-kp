import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { App, ValidationError, type StandardSchemaV1 } from '../src/index.ts'

const UserQuery = z.object({ limit: z.coerce.number().int().max(100).default(10), tag: z.array(z.string()).optional() })
const IdParam = z.object({ id: z.coerce.number().int() })
const CreateUser = z.object({ name: z.string().min(1), email: z.email() })

const app = new App()
  .get('/users', (c) => c.json(c.safeQuery(UserQuery)))
  .get('/users/:id', (c) => c.json(c.safeParam(IdParam)))
  .get('/h', (c) => c.text(c.safeHeader(z.object({ 'x-api-key': z.string() }))['x-api-key']))
  .post('/users', async (c) => c.json(await c.safeBody(CreateUser), 201))
  .post('/form', async (c) => c.json(await c.safeForm(z.object({ name: z.string() }))))

describe('c.safeXXX(schema)', () => {
  test('safeQuery: coercion, defaults, repeated keys', async () => {
    expect(await (await app.request('/users')).json()).toEqual({ limit: 10 })
    expect(await (await app.request('/users?limit=5&tag=a&tag=b')).json()).toEqual({ limit: 5, tag: ['a', 'b'] })
  })

  test('safeQuery: invalid → 400 with issues', async () => {
    const res = await app.request('/users?limit=500')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { success: boolean; error: { path: string[] }[] }
    expect(body.success).toBe(false)
    expect(body.error[0]?.path).toEqual(['limit'])
  })

  test('safeParam', async () => {
    expect(await (await app.request('/users/7')).json()).toEqual({ id: 7 })
    expect((await app.request('/users/abc')).status).toBe(400)
  })

  test('safeHeader', async () => {
    expect(await (await app.request('/h', { headers: { 'x-api-key': 'k' } })).text()).toBe('k')
    expect((await app.request('/h')).status).toBe(400)
  })

  test('safeBody', async () => {
    const ok = await app.request('/users', { method: 'POST', body: JSON.stringify({ name: 'a', email: 'a@x.io' }) })
    expect(ok.status).toBe(201)
    expect((await app.request('/users', { method: 'POST', body: '{"name":""}' })).status).toBe(400)
    expect((await app.request('/users', { method: 'POST', body: '{oops' })).status).toBe(400)
  })

  test('safeForm', async () => {
    const fd = new FormData()
    fd.set('name', 'bob')
    expect(await (await app.request('/form', { method: 'POST', body: fd })).json()).toEqual({ name: 'bob' })
  })

  test('ValidationError reaches onError with target and issues', async () => {
    const a = new App()
      .get('/', (c) => c.json(c.safeQuery(UserQuery)))
      .onError((err, c) => {
        if (err instanceof ValidationError) return c.json({ target: err.target, n: err.issues.length }, 422)
        return c.text('other', 500)
      })
    const res = await a.request('/?limit=x')
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ target: 'query', n: 1 })
  })

  test('sync safeXXX rejects async schemas with a clear error', async () => {
    const asyncSchema: StandardSchemaV1<unknown, unknown> = {
      '~standard': { version: 1, vendor: 'x', validate: async (v) => ({ value: v }) },
    }
    const a = new App()
      .get('/', (c) => c.json(c.safeQuery(asyncSchema)))
      .onError((err, c) => c.text(err.message, 500))
    expect(await (await a.request('/')).text()).toContain('is async')
  })
})
