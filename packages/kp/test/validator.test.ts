import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { App, validator, type StandardSchemaV1 } from '../src/index.ts'

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('validator', () => {
  const app = new App()
    .post('/users', validator('json', z.object({ name: z.string(), age: z.number() })), (c) =>
      c.json(c.req.valid('json'), 201),
    )
    .get('/list', validator('query', z.object({ page: z.coerce.number().default(1), tag: z.array(z.string()).optional() })), (c) =>
      c.json(c.req.valid('query')),
    )
    .get('/users/:id', validator('param', z.object({ id: z.coerce.number().int() })), (c) =>
      c.json({ id: c.req.valid('param').id, type: typeof c.req.valid('param').id }),
    )
    .get('/h', validator('header', z.object({ 'x-api-key': z.string() })), (c) =>
      c.text(c.req.valid('header')['x-api-key']),
    )
    .post('/form', validator('form', z.object({ name: z.string() })), (c) =>
      c.json(c.req.valid('form')),
    )

  test('json ok', async () => {
    const res = await app.request('/users', json({ name: 'a', age: 1 }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ name: 'a', age: 1 })
  })

  test('json invalid → 400 with issues', async () => {
    const res = await app.request('/users', json({ name: 'a', age: 'x' }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { success: boolean; error: { path: string[] }[] }
    expect(body.success).toBe(false)
    expect(body.error[0]?.path).toEqual(['age'])
  })

  test('malformed json → 400', async () => {
    const res = await app.request('/users', { method: 'POST', body: '{oops' })
    expect(res.status).toBe(400)
  })

  test('query with coercion, defaults and repeated keys', async () => {
    expect(await (await app.request('/list')).json()).toEqual({ page: 1 })
    expect(await (await app.request('/list?page=3&tag=a&tag=b')).json()).toEqual({
      page: 3,
      tag: ['a', 'b'],
    })
  })

  test('param coercion', async () => {
    expect(await (await app.request('/users/12')).json()).toEqual({ id: 12, type: 'number' })
    expect((await app.request('/users/abc')).status).toBe(400)
  })

  test('header', async () => {
    expect((await app.request('/h')).status).toBe(400)
    const res = await app.request('/h', { headers: { 'x-api-key': 'k' } })
    expect(await res.text()).toBe('k')
  })

  test('form', async () => {
    const fd = new FormData()
    fd.set('name', 'bob')
    const res = await app.request('/form', { method: 'POST', body: fd })
    expect(await res.json()).toEqual({ name: 'bob' })
  })

  test('hook can customise the error response', async () => {
    const a = new App().post(
      '/x',
      validator('json', z.object({ n: z.number() }), (result, c) => {
        if (!result.success) return c.json({ msg: 'bad input', count: result.issues.length }, 422)
      }),
      (c) => c.json(c.req.valid('json')),
    )
    const res = await a.request('/x', json({ n: 'no' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ msg: 'bad input', count: 1 })
  })

  test('works with any Standard Schema implementation', async () => {
    // Minimal hand-written schema, no library.
    const upper: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'custom',
        validate: (v) =>
          typeof v === 'string' ? { value: v.toUpperCase() } : { issues: [{ message: 'not a string' }] },
      },
    }
    const a = new App().post('/u', validator('json', upper), (c) => c.text(c.req.valid('json')))
    expect(await (await a.request('/u', json('hi'))).text()).toBe('HI')
    expect((await a.request('/u', json(1))).status).toBe(400)
  })
})
