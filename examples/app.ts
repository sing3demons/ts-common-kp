import { z } from 'zod'
import { App, HTTPException, validator } from '../src/index.ts'

const CreateUser = z.object({ name: z.string().min(1), email: z.email() })

const db = new Map<number, z.infer<typeof CreateUser> & { id: number }>()
let nextId = 1

// A sub-app: mounted under /api/users below.
const users = new App()
  .get('/', validator('query', z.object({ limit: z.coerce.number().max(100).default(10) })), (c) => {
    const { limit } = c.req.valid('query') // number
    return c.json([...db.values()].slice(0, limit))
  })
  .get('/:id', validator('param', z.object({ id: z.coerce.number().int() })), (c) => {
    const { id } = c.req.valid('param') // number
    const user = db.get(id)
    if (!user) throw new HTTPException(404, { message: 'user not found' })
    return c.json(user)
  })
  .post('/', validator('json', CreateUser), (c) => {
    const body = c.req.valid('json') // { name: string; email: string }
    const user = { id: nextId++, ...body }
    db.set(user.id, user)
    return c.json(user, 201)
  })

export const app = new App()
  .use(async (c, next) => {
    const start = performance.now()
    await next()
    console.log(`${c.req.method} ${c.req.path} → ${c.res?.status} (${(performance.now() - start).toFixed(1)}ms)`)
  })
  .get('/', (c) => c.text('Hello from kp!'))
  .get('/hello/:name', (c) => c.json({ hello: c.req.param('name') }))

app.basePath('/api').route('/users', users)
