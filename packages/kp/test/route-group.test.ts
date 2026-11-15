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

  test('register() an App, with and without prefix', async () => {
    const users = new App().basePath('/users').get('/:id', (c) => c.text(c.req.param('id')))
    const posts = new App().get('/', (c) => c.text('posts'))
    const app = new App().register(users).register(posts, { prefix: '/posts' })

    expect(await (await app.request('/users/7')).text()).toBe('7')
    expect(await (await app.request('/posts')).text()).toBe('posts')
  })

  test('register() a plugin function', async () => {
    const plugin = (app: App) => {
      app.use(async (c, next) => {
        await next()
        c.header('x-plugin', '1')
      })
      app.get('/ping', (c) => c.text('pong'))
    }
    const app = new App().get('/', (c) => c.text('root')).register(plugin, { prefix: '/p' })

    const res = await app.request('/p/ping')
    expect(await res.text()).toBe('pong')
    expect(res.headers.get('x-plugin')).toBe('1')
    expect((await app.request('/')).headers.get('x-plugin')).toBeNull()
  })
})

describe('start()', () => {
  test('serves on the current runtime and stops', async () => {
    const app = new App().get('/', (c) => c.text('live'))
    let called = false
    const server = await app.start({ port: 0 }, () => {
      called = true
    })
    expect(called).toBe(true)
    expect(server.runtime).toBe('bun')
    expect(await (await fetch(server.url)).text()).toBe('live')
    await server.stop()
  })
})
