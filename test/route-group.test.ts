import { describe, expect, test } from 'bun:test'
import { App } from '../src/index.ts'

describe('route groups', () => {
  test('route() mounts a sub-app under a prefix', async () => {
    const users = new App()
      .get('/', (c) => c.text('list'))
      .get('/:id', (c) => c.text(`user ${c.req.param('id')}`))
      .post('/', (c) => c.text('created', 201))

    const app = new App().route('/users', users)

    expect(await (await app.request('/users')).text()).toBe('list')
    expect(await (await app.request('/users/3')).text()).toBe('user 3')
    expect((await app.request('/users', { method: 'POST' })).status).toBe(201)
    expect((await app.request('/3')).status).toBe(404)
  })

  test('sub-app middleware is scoped to its prefix', async () => {
    const admin = new App()
      .use(async (c, next) => {
        await next()
        c.header('x-admin', '1')
      })
      .get('/', (c) => c.text('admin'))

    const app = new App().get('/', (c) => c.text('home')).route('/admin', admin)

    expect((await app.request('/admin')).headers.get('x-admin')).toBe('1')
    expect((await app.request('/')).headers.get('x-admin')).toBeNull()
  })

  test('nested groups and basePath()', async () => {
    const posts = new App().get('/:postId', (c) => c.json(c.req.param()))
    const users = new App().route('/:userId/posts', posts)
    const app = new App()
    app.basePath('/api/v1').route('/users', users).get('/health', (c) => c.text('ok'))

    expect(await (await app.request('/api/v1/users/1/posts/2')).json()).toEqual({
      userId: '1',
      postId: '2',
    })
    expect(await (await app.request('/api/v1/health')).text()).toBe('ok')
    expect((await app.request('/health')).status).toBe(404)
  })

  test('basePath() middleware only applies under the base', async () => {
    const app = new App().get('/', (c) => c.text('root'))
    app
      .basePath('/api')
      .use((c) => c.text('blocked', 401))
      .get('/x', (c) => c.text('x'))

    expect((await app.request('/api/x')).status).toBe(401)
    expect((await app.request('/')).status).toBe(200)
  })

  test("sub-app onError stays in effect for its routes", async () => {
    const sub = new App()
      .get('/boom', () => {
        throw new Error('sub')
      })
      .onError((err, c) => c.text(`sub handled: ${err.message}`, 503))
    const app = new App().route('/s', sub)

    const res = await app.request('/s/boom')
    expect(res.status).toBe(503)
    expect(await res.text()).toBe('sub handled: sub')
  })
})
