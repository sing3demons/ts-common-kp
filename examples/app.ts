import { z } from 'zod'
import { App, HTTPException, validator, type Ctx } from '../src/index.ts'

// ---------------------------------------------------------------------------
// Schemas / types
// ---------------------------------------------------------------------------

const CreateUserSchema = z.object({ name: z.string().min(1), email: z.email() })
const UpdateUserSchema = CreateUserSchema.partial()
const UserIdSchema = z.object({ id: z.coerce.number().int().positive() })

type CreateUser = z.infer<typeof CreateUserSchema>
type UpdateUser = z.infer<typeof UpdateUserSchema>
type UserId = z.infer<typeof UserIdSchema>
type User = CreateUser & { id: number }

// ---------------------------------------------------------------------------
// Repository: data access only
// ---------------------------------------------------------------------------

class UserRepository {
  #db = new Map<number, User>()
  #nextId = 1

  findAll(limit: number): User[] {
    return [...this.#db.values()].slice(0, limit)
  }

  findById(id: number): User | undefined {
    return this.#db.get(id)
  }

  create(data: CreateUser): User {
    const user = { id: this.#nextId++, ...data }
    this.#db.set(user.id, user)
    return user
  }

  update(id: number, data: UpdateUser): User | undefined {
    const user = this.#db.get(id)
    if (!user) return undefined
    const updated = { ...user, ...data }
    this.#db.set(id, updated)
    return updated
  }

  delete(id: number): boolean {
    return this.#db.delete(id)
  }
}

// ---------------------------------------------------------------------------
// Service: business rules, throws HTTP errors
// ---------------------------------------------------------------------------

class UserService {
  readonly #repo: UserRepository

  constructor(repo: UserRepository) {
    this.#repo = repo
  }

  list(limit: number): User[] {
    return this.#repo.findAll(limit)
  }

  get(id: number): User {
    const user = this.#repo.findById(id)
    if (!user) throw new HTTPException(404, { message: `user ${id} not found` })
    return user
  }

  create(data: CreateUser): User {
    const taken = this.#repo.findAll(Infinity).some((u) => u.email === data.email)
    if (taken) throw new HTTPException(409, { message: `email ${data.email} already used` })
    return this.#repo.create(data)
  }

  update(id: number, data: UpdateUser): User {
    const user = this.#repo.update(id, data)
    if (!user) throw new HTTPException(404, { message: `user ${id} not found` })
    return user
  }

  remove(id: number): void {
    if (!this.#repo.delete(id)) throw new HTTPException(404, { message: `user ${id} not found` })
  }
}

// ---------------------------------------------------------------------------
// Controller: one plain method per endpoint. `Ctx<...>` declares what the
// method needs; the router checks at compile time that the route provides it.
// ---------------------------------------------------------------------------

class UserController {
  private readonly service: UserService

  constructor(service: UserService) {
    this.service = service
  }

  list(c: Ctx) {
    const limit = Number(c.req.query('limit') ?? 10)
    const result = this.service.list(limit)
    return c.json(result)
  }

  getById(c: Ctx<{ param: UserId }>) {
    const { id } = c.req.valid('param')
    const result = this.service.get(id)
    return c.json(result)
  }

  create(c: Ctx<{ json: CreateUser }>) {
    const body = c.req.valid('json')
    const result = this.service.create(body)
    return c.json(result, 201)
  }

  update(c: Ctx<{ param: UserId; json: UpdateUser }>) {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = this.service.update(id, body)
    return c.json(result)
  }

  remove(c: Ctx<{ param: UserId }>) {
    const { id } = c.req.valid('param')
    this.service.remove(id)
    return c.body(null, 204)
  }
}

// ---------------------------------------------------------------------------
// Server: wires dependencies, global middleware and error handling
// ---------------------------------------------------------------------------

export class Server {
  readonly app = new App()

  constructor() {
    const user = new UserController(new UserService(new UserRepository()))

    const userRoutes = new App()
      .get('/', (c) => user.list(c))
      .get('/:id', validator('param', UserIdSchema), (c) => user.getById(c))
      .post('/', validator('json', CreateUserSchema), (c) => user.create(c))
      .patch('/:id', validator('param', UserIdSchema), validator('json', UpdateUserSchema), (c) => user.update(c))
      .delete('/:id', validator('param', UserIdSchema), (c) => user.remove(c))

    this.app
      .use(async (c, next) => {
        const start = performance.now()
        await next()
        const ms = (performance.now() - start).toFixed(1)
        console.log(`${c.req.method} ${c.req.path} → ${c.res?.status} (${ms}ms)`)
      })
      .get('/', (c) => c.text('Hello from kp!'))
      .get('/hello/:name', (c) => c.json({ hello: c.req.param('name') }))
      .onError((err, c) => {
        if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
        console.error(err)
        return c.json({ error: 'Internal Server Error' }, 500)
      })
      .notFound((c) => c.json({ error: `${c.req.method} ${c.req.path} not found` }, 404))

    this.app.basePath('/api').route('/users', userRoutes)
  }
}

export const app = new Server().app
