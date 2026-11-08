import { App, validator } from '../../lib/kp.ts'
import type { UserController } from './user.controller.ts'
import { CreateUserSchema, UpdateUserSchema, UserIdSchema } from './user.schema.ts'

const param = validator('param', UserIdSchema)

export const userRoutes = (user: UserController) =>
  new App()
    .get('/', (c) => user.list(c))
    .get('/:id', param, (c) => user.getById(c))
    .post('/', validator('json', CreateUserSchema), (c) => user.create(c))
    .patch('/:id', param, validator('json', UpdateUserSchema), (c) => user.update(c))
    .delete('/:id', param, (c) => user.remove(c))
