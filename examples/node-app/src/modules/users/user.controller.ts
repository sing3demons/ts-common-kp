import type { Ctx } from '../../lib/kp.ts'
import type { CreateUser, UpdateUser, UserId } from './user.schema.ts'
import type { UserService } from './user.service.ts'

export class UserController {
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
