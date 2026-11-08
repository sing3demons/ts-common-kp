import { describe, expect, test } from 'bun:test'
import { App, HTTPException } from '../src/index.ts'

describe('App', () => {
  test('basic routes and response helpers', async () => {
    const app = new App()
      .get('/', (c) => c.text('hello'))
      .get('/json', (c) => c.json({ ok: true }, 201))
      .get('/html', (c) => c.html('<h1>hi</h1>'))
      .get('/go', (c) => c.redirect('/'))
      .get('/users/:id', (c) => c.json({ id: c.req.param('id'), q: c.req.query('q') }))

    let res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')

    res = await app.request('/json')
    expect(res.status).toBe(201)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ ok: true })

    res = await app.request('/html')
    expect(res.headers.get('content-type')).toContain('text/html')

    res = await app.request('/go')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')

    res = await app.request('/users/5?q=x')
    expect(await res.json()).toEqual({ id: '5', q: 'x' })
  })

  test('status() and header() merge into the response', async () => {
    const app = new App().get('/', (c) => c.status(202).header('x-a', '1').text('ok'))
    const res = await app.request('/')
    expect(res.status).toBe(202)
    expect(res.headers.get('x-a')).toBe('1')
  })

  test('middleware order, short-circuit and post-processing', async () => {
    const log: string[] = []
    const app = new App()
      .use(async (c, next) => {
        log.push('a:before')
        await next()
        log.push('a:after')
        c.header('x-powered-by', 'kp')
      })
      .use('/admin/*', (c) => c.text('forbidden', 403))
      .get('/', (c) => {
        log.push('handler')
        return c.text('ok')
      })
      .get('/admin/panel', (c) => c.text('secret'))

    let res = await app.request('/')
    expect(log).toEqual(['a:before', 'handler', 'a:after'])
    expect(res.headers.get('x-powered-by')).toBe('kp')

    res = await app.request('/admin/panel')
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('forbidden')
  })

  test('route-level middleware', async () => {
    const app = new App().get(
      '/x',
      async (c, next) => {
        c.header('x-mw', 'yes')
        await next()
      },
      (c) => c.text('x'),
    )
    const res = await app.request('/x')
    expect(res.headers.get('x-mw')).toBe('yes')
  })

  test('on() with multiple methods, HEAD strips body', async () => {
    const app = new App().on(['GET', 'POST'], '/m', (c) => c.text(c.req.method))
    expect(await (await app.request('/m', { method: 'POST' })).text()).toBe('POST')
    const head = await app.request('/m', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  test('404 and custom notFound', async () => {
    const app = new App().get('/', (c) => c.text('ok'))
    expect((await app.request('/missing')).status).toBe(404)
    expect((await app.request('/', { method: 'POST' })).status).toBe(404)

    app.notFound((c) => c.json({ error: 'not found' }, 404))
    const res = await app.request('/missing')
    expect(await res.json()).toEqual({ error: 'not found' })
  })

  test('middleware still runs for 404s', async () => {
    const app = new App().use(async (c, next) => {
      await next()
      c.header('x-mw', '1')
    })
    const res = await app.request('/none')
    expect(res.status).toBe(404)
    expect(res.headers.get('x-mw')).toBe('1')
  })

  test('errors: HTTPException, default 500, custom onError', async () => {
    const app = new App()
      .get('/http', () => {
        throw new HTTPException(401, { message: 'nope' })
      })
      .get('/boom', () => {
        throw new Error('boom')
      })

    let res = await app.request('/http')
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('nope')

    const origError = console.error
    console.error = () => {}
    res = await app.request('/boom')
    console.error = origError
    expect(res.status).toBe(500)

    app.onError((err, c) => c.json({ message: err.message }, 418))
    res = await app.request('/boom')
    expect(res.status).toBe(418)
    expect(await res.json()).toEqual({ message: 'boom' })
  })

  test('body can be read more than once', async () => {
    const app = new App().post(
      '/echo',
      async (c, next) => {
        await c.req.json()
        await next()
      },
      async (c) => c.json({ text: await c.req.text(), json: await c.req.json() }),
    )
    const res = await app.request('/echo', { method: 'POST', body: '{"a":1}' })
    expect(await res.json()).toEqual({ text: '{"a":1}', json: { a: 1 } })
  })
})
