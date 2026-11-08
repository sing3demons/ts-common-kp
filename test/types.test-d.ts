/**
 * Compile-time tests. Checked by `tsc --noEmit` (never executed).
 */
import { z } from 'zod'
import { App, validator, type Ctx, type ParamKeys, type Params } from '../src/index.ts'

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
