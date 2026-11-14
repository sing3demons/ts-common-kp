import { Controller, Delete, Get, Patch, Post, validator } from '@sing3demons/kp'
import type { Ctx } from '../../app.ts'
import {
  CreateUserSchema,
  UpdateUserSchema,
  UserIdSchema,
  UserQuerySchema,
  type CreateUser,
  type IUserQuery,
  type UpdateUser,
  type UserId,
} from './user.schema.ts'
import type { UserService } from './user.service.ts'

const param = validator('param', UserIdSchema)

@Controller('/users')
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get('/')
  list(c: Ctx) {
    const query: IUserQuery = c.safeQuery(UserQuerySchema)
    const result = this.service.list(query.limit)
    return c.json(result)
  }

  @Get('/:id', param)
  getById(c: Ctx<{ param: UserId }>) {
    const { id } = c.req.valid('param')
    const result = this.service.get(id)
    return c.json(result)
  }

  @Post('/', validator('json', CreateUserSchema))
  create(c: Ctx<{ json: CreateUser }>) {
    const body = c.req.valid('json')
    const result = this.service.create(body)
    c.addSummary('user_id', result.id)
    return c.json(result, 201)
  }

  @Patch('/:id', param, validator('json', UpdateUserSchema))
  update(c: Ctx<{ param: UserId; json: UpdateUser }>) {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const result = this.service.update(id, body)
    return c.json(result)
  }

  @Delete('/:id', param)
  remove(c: Ctx<{ param: UserId }>) {
    const { id } = c.req.valid('param')
    this.service.remove(id)
    return c.body(null, 204)
  }
}
