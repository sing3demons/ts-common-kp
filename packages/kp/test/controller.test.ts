import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  All,
  App,
  Controller,
  Delete,
  Get,
  Options,
  Patch,
  Post,
  Put,
  validator,
  type Ctx,
} from '../src/index.ts'

const IdSchema = z.object({ id: z.coerce.number().int().positive() })
const NameSchema = z.object({ name: z.string().min(1) })

class Store {
  names = new Map<number, string>([[1, 'ann']])
}

@Controller('/users')
class UserController {
  store: Store
  constructor(store: Store) {
    this.store = store
  }

  @Get('/')
  list(c: Ctx) {
    return c.json([...this.store.names.values()])
  }

  @Get('/:id', validator('param', IdSchema))
  getById(c: Ctx<{ param: { id: number } }>) {
    const { id } = c.req.valid('param')
    const name = this.store.names.get(id)
    return name ? c.json({ id, name }) : c.json({ error: 'not found' }, 404)
  }

  @Post('/', validator('json', NameSchema))
  async create(c: Ctx<{ json: { name: string } }>) {
    const { name } = c.req.valid('json')
    const id = this.store.names.size + 1
    this.store.names.set(id, name)
    return c.json({ id, name }, 201)
  }

  @Put('/:id')
  put(c: Ctx<'/:id'>) {
    return c.text(`put ${c.req.param('id')}`)
  }

  @Patch('/:id')
  patch(c: Ctx) {
    return c.text('patch')
  }

  @Delete('/:id')
  remove(c: Ctx) {
    return c.body(null, 204)
  }

  @Options('/')
  opts(c: Ctx) {
    return c.text('options')
  }

  @All('/any')
  any(c: Ctx) {
    return c.text(`any ${c.req.method}`)
  }

  // not a route: must not be registered
  helper() {
    return 'x'
  }
}

const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('controller decorators', () => {
  test('registers every decorated method with controller + register prefix', async () => {
    const app = new App().register(new UserController(new Store()), { prefix: '/api' })

    expect(await (await app.request('/api/users')).json()).toEqual(['ann'])
    expect(await (await app.request('/api/users/1')).json()).toEqual({ id: 1, name: 'ann' })
    expect(await (await app.request('/api/users/1', { method: 'PUT' })).text()).toBe('put 1')
    expect(await (await app.request('/api/users/1', { method: 'PATCH' })).text()).toBe('patch')
    expect((await app.request('/api/users/1', { method: 'DELETE' })).status).toBe(204)
    expect(await (await app.request('/api/users', { method: 'OPTIONS' })).text()).toBe('options')
    expect(await (await app.request('/api/users/any', { method: 'POST' })).text()).toBe('any POST')
    expect((await app.request('/users')).status).toBe(404)
  })

  test('runs validators and binds `this` to the instance', async () => {
    const store = new Store()
    const app = new App().register(new UserController(store))

    const created = await app.request('/users', json({ name: 'bob' }))
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({ id: 2, name: 'bob' })
    expect(store.names.get(2)).toBe('bob')

    expect((await app.request('/users', json({ name: '' }))).status).toBe(400)
    expect((await app.request('/users/abc')).status).toBe(400)
    expect((await app.request('/users/9')).status).toBe(404)
  })

  test('each instance keeps its own state', async () => {
    const a = new App().register(new UserController(new Store()))
    const b = new App().register(new UserController(new Store()))
    await a.request('/users', json({ name: 'only-in-a' }))

    expect(await (await a.request('/users')).json()).toEqual(['ann', 'only-in-a'])
    expect(await (await b.request('/users')).json()).toEqual(['ann'])
  })

  test('controller without @Controller mounts at the register prefix', async () => {
    class Health {
      @Get('/health')
      check(c: Ctx) {
        return c.text('ok')
      }
    }
    const app = new App().register(new Health(), { prefix: '/v1' })
    expect(await (await app.request('/v1/health')).text()).toBe('ok')
  })

  test('subclass inherits routes and uses its own prefix', async () => {
    @Controller('/admin')
    class AdminController extends UserController {
      @Get('/stats')
      stats(c: Ctx) {
        return c.json({ count: this.store.names.size })
      }
    }
    const app = new App().register(new AdminController(new Store()))
    expect(await (await app.request('/admin/stats')).json()).toEqual({ count: 1 })
    // inherited routes are mounted under the subclass prefix
    expect(await (await app.request('/admin/1')).json()).toEqual({ id: 1, name: 'ann' })
    expect((await app.request('/users/1')).status).toBe(404)
  })

  test('app middleware still runs before controller routes', async () => {
    const app = new App()
      .use(async (c, next) => {
        await next()
        c.header('x-mw', '1')
      })
      .register(new UserController(new Store()))
    expect((await app.request('/users')).headers.get('x-mw')).toBe('1')
  })

  test('register() rejects objects without routes', () => {
    expect(() => new App().register({})).toThrow(TypeError)
    expect(() => new App().register(new Store())).toThrow(/controller/)
  })

  test('decorating a static method throws', () => {
    expect(() => {
      class Bad {
        @Get('/')
        static list(c: Ctx) {
          return c.text('x')
        }
      }
      return Bad
    }).toThrow(/instance methods/)
  })
})
