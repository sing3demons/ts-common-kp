/**
 * Compile-time tests. Checked by `tsc --noEmit` (never executed).
 */
import { z } from 'zod'
import {
  App,
  Controller,
  Get,
  Post,
  validator,
  type Ctx,
  type ParamKeys,
  type Params,
  type CtxOf,
  type EnvOf,
  type ErrorHandler,
  type Input,
  type MiddlewareHandler,
  type WithLogger,
} from '../src/index.ts'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

// -- path param parsing --------------------------------------------------------
type _p1 = Expect<Equal<ParamKeys<'/users/:id/posts/:postId'>, 'id' | 'postId'>>
type _p2 = Expect<Equal<ParamKeys<'/static/path'>, never>>
type _p3 = Expect<Equal<Params<'/a/:id/:slug?'>, { id: string; slug?: string }>>
type _p4 = Expect<Equal<Params<string>, Record<string, string>>>

const app = new App()

// -- params in handlers --------------------------------------------------------
app.get('/users/:id/posts/:postId', (c) => {
  const id = c.req.param('id')
  type _ = Expect<Equal<typeof id, string>>
  const all = c.req.param()
  type _all = Expect<Equal<typeof all, { id: string; postId: string }>>
  // @ts-expect-error — not a param of this route
  c.req.param('nope')
  return c.json({ id })
})

app.get('/files/:name?', (c) => {
  const name = c.req.param('name')
  type _ = Expect<Equal<typeof name, string | undefined>>
  return c.text(name ?? 'index')
})

// -- validators ----------------------------------------------------------------
const createUser = z.object({ name: z.string(), age: z.number().int() })
const listQuery = z.object({ page: z.coerce.number().default(1) })
const idParam = z.object({ id: z.coerce.number() })

app.post('/users', validator('json', createUser), (c) => {
  const body = c.req.valid('json')
  type _ = Expect<Equal<typeof body, { name: string; age: number }>>
  // @ts-expect-error — query was not validated on this route
  c.req.valid('query')
  return c.json(body, 201)
})

app.put(
  '/users/:id',
  validator('param', idParam),
  validator('query', listQuery),
  validator('json', createUser.partial()),
  (c) => {
    const { id } = c.req.valid('param')
    type _id = Expect<Equal<typeof id, number>>
    const { page } = c.req.valid('query')
    type _page = Expect<Equal<typeof page, number>>
    const patch = c.req.valid('json')
    type _patch = Expect<Equal<typeof patch, { name?: string | undefined; age?: number | undefined }>>
    // raw params are still typed from the path
    const raw = c.req.param('id')
    type _raw = Expect<Equal<typeof raw, string>>
    return c.json({ id, page, patch })
  },
)

// plain middleware mixed with validators
app.post(
  '/items',
  async (_c, next) => {
    await next()
  },
  validator('json', z.object({ sku: z.string() })),
  (c) => c.json(c.req.valid('json').sku),
)

// @ts-expect-error — handlers must return a Response
app.get('/bad', () => 'not a response')

// no validator → valid() takes nothing
app.get('/plain', (c) => {
  // @ts-expect-error
  c.req.valid('json')
  return c.text('ok')
})

// -- route groups --------------------------------------------------------------
const users = new App().get('/:id', (c) => c.json({ id: c.req.param('id') }))
const api: App = new App().basePath('/api').route('/users', users)
void api

// -- Ctx for class-method / standalone handlers -------------------------------
class Ctrl {
  any(c: Ctx) {
    return c.text(c.req.query('q') ?? '')
  }
  byId(c: Ctx<'/:id'>) {
    return c.text(c.req.param('id'))
  }
  create(c: Ctx<{ json: { name: string; age: number } }>) {
    return c.json(c.req.valid('json').name)
  }
  both(c: Ctx<'/:id', { param: { id: number } }>) {
    const n: number = c.req.valid('param').id
    const s: string = c.req.param('id')
    return c.json({ n, s })
  }
}
const ctrl = new Ctrl()
new App()
  .get('/', (c) => ctrl.any(c))
  .get('/:id', (c) => ctrl.byId(c))
  .post('/', validator('json', createUser), (c) => ctrl.create(c))
  .get('/:id', validator('param', idParam), (c) => ctrl.both(c))
  // @ts-expect-error — route lacks the json validator the method requires
  .post('/x', (c) => ctrl.create(c))
  // @ts-expect-error — validator output doesn't match the method's input
  .post('/y', validator('json', createUser.partial()), (c) => ctrl.create(c))

// -- c.safeXXX(schema) ---------------------------------------------------------
new App().get('/s/:id', async (c) => {
  const q = c.safeQuery(listQuery)
  type _q = Expect<Equal<typeof q, { page: number }>>
  const { id } = c.safeParam(idParam)
  type _id = Expect<Equal<typeof id, number>>
  const body = await c.safeBody(createUser)
  type _b = Expect<Equal<typeof body, { name: string; age: number }>>
  // @ts-expect-error — safeBody is async, must be awaited
  const notAwaited: { name: string } = c.safeBody(createUser)
  void notAwaited
  return c.json({ q, id, body })
})

// -- c.validate(schema, data) → Result ------------------------------------------
new App().post('/v', async (c) => {
  const result = c.validate(createUser, await c.req.json())
  if (!result.ok) {
    type _e = Expect<Equal<typeof result.error, ReadonlyArray<import('../src/index.ts').StandardSchemaV1.Issue>>>
    // @ts-expect-error — no value on the error branch
    result.value
    return c.json({ issues: result.error }, 400)
  }
  type _v = Expect<Equal<typeof result.value, { name: string; age: number }>>
  return c.json(result.value)
})

// -- controller decorators -----------------------------------------------------
@Controller('/d')
class DecoratedCtrl {
  // ok: nothing required
  @Get('/')
  list(c: Ctx) {
    return c.json([])
  }

  // ok: path param inferred from the decorator path
  @Get('/:id')
  byId(c: Ctx<'/:id'>) {
    return c.text(c.req.param('id'))
  }

  // ok: validator provides exactly what the method needs (sync or async)
  @Post('/', validator('json', createUser))
  async create(c: Ctx<{ json: { name: string; age: number } }>) {
    return c.json(c.req.valid('json'))
  }

  // ok: several validators are intersected
  @Post('/:id', validator('param', idParam), validator('json', createUser))
  both(c: Ctx<{ param: { id: number }; json: { name: string; age: number } }>) {
    return c.json({ ...c.req.valid('param'), ...c.req.valid('json') })
  }

  // @ts-expect-error — route lacks the json validator the method requires
  @Post('/x')
  missing(c: Ctx<{ json: { name: string; age: number } }>) {
    return c.json(c.req.valid('json'))
  }

  // @ts-expect-error — validator output doesn't match the method's input
  @Post('/y', validator('json', createUser.partial()))
  wrong(c: Ctx<{ json: { name: string; age: number } }>) {
    return c.json(c.req.valid('json'))
  }

  // @ts-expect-error — method must return a Response
  @Get('/z')
  notResponse(_c: Ctx) {
    return 'nope'
  }
}
new App().register(new DecoratedCtrl(), { prefix: '/api' })

// -- logger gating ---------------------------------------------------------------
// Inline handlers of `new App()` (no logger) can't call log methods; `new App().logger(...)` can.
// Types written elsewhere (`Ctx`, `ErrorHandler`, `App` annotations) assume a logger.
{
  const plain = new App()
  plain.get('/', (c) => {
    // @ts-expect-error — no logger on this app
    c.info('x')
    // @ts-expect-error — no logger on this app
    c.log()
    // @ts-expect-error — no logger on this app
    c.addSummary('k', 1)
    // @ts-expect-error — no logger on this app
    c.setDependency({ dependency: 'db' })
    c.requestId // getters stay available (undefined without a logger)
    return c.text('ok')
  })
  plain.onError((err, c) => {
    // @ts-expect-error — no logger on this app
    c.error('boom', err)
    return c.text('x', 500)
  })
  plain.use(async (c, next) => {
    // @ts-expect-error — no logger on this app
    c.warn('mw')
    await next()
  })

  // framework types have no logger by default
  const plainCtx = (c: Ctx) => {
    // @ts-expect-error — Ctx from the framework has no logger
    c.log()
    return c.text('ok')
  }
  plain.get('/pc', (c) => plainCtx(c))
  const logged = new App().logger({ level: 'silent' })
  type _l = Expect<Equal<typeof logged, App<WithLogger>>>
  logged.use(async (c, next) => {
    c.info('mw')
    await next()
  })
  logged.post('/users', validator('json', createUser), (c) => {
    const body = c.req.valid('json')
    const r = c.info('validated', body).addSummary('name', body.name)
    type _r = Expect<Equal<typeof r, typeof c>>
    c.log().info('a').warn('b')
    c.setDependency({ dependency: 'db', dependencyId: c.genId() }).info('db_request')
    return c.flush({ appResultCode: '20000' }).json(body, 201)
  })
  logged.onError((err, c) => c.error('unhandled', err).text('x', 500))
  logged.notFound((c) => c.warn('not found').text('404', 404))
  logged.basePath('/v1').get('/', (c) => c.info('nested').text('ok'))
  logged.route('/plain', plain)

  // types derived from the app: log methods follow the app's `.logger(...)`
  type LCtx<A extends string | Input = {}, B extends Input = {}> = CtxOf<typeof logged, A, B>
  type PCtx<A extends string | Input = {}, B extends Input = {}> = CtxOf<typeof plain, A, B>
  type _e1 = Expect<Equal<EnvOf<typeof logged>, WithLogger>>
  type _e2 = Expect<Equal<EnvOf<typeof plain>, {}>>
  class UserCtrl {
    create(c: LCtx<{ json: { name: string; age: number } }>) {
      return c.addSummary('name', c.req.valid('json').name).info('created').json({}, 201)
    }
    list(c: PCtx) {
      // @ts-expect-error — the plain app has no logger, so its Ctx has no log()
      c.log()
      return c.json([])
    }
  }
  const uc = new UserCtrl()
  logged.post('/c', validator('json', createUser), (c) => uc.create(c))
  plain.get('/l', (c) => uc.list(c))
  // sub-app built with `new App()` in another file can hand its context to the app's Ctx
  new App().basePath('/users').post('/', validator('json', createUser), (c) => uc.create(c))
  const onErr: ErrorHandler<EnvOf<typeof logged>> = (err, c) => c.error('unhandled', err).text('x', 500)
  logged.onError(onErr)
  const mw: MiddlewareHandler<any, {}, EnvOf<typeof logged>> = async (c, next) => {
    c.info('mw')
    await next()
  }
  logged.use(mw)
}
