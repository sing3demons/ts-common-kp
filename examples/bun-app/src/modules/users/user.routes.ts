import { App, validator } from '../../lib/kp.ts'
import { UserController } from './user.controller.ts'
import { UserRepository } from './user.repository.ts'
import { CreateUserSchema, UpdateUserSchema, UserIdSchema } from './user.schema.ts'
import { UserService } from './user.service.ts'

const param = validator('param', UserIdSchema)

/** Builds the users routes with their dependencies (pass a repo to isolate tests). */
export const createUserRoutes = (repo = new UserRepository()) => {
  const user = new UserController(new UserService(repo))

  return new App()
    .basePath('/api/users')
    .get('/', (c) => user.list(c))
    .get('/:id', param, (c) => user.getById(c))
    .post('/', validator('json', CreateUserSchema), (c) => user.create(c))
    .patch('/:id', param, validator('json', UpdateUserSchema), (c) => user.update(c))
    .delete('/:id', param, (c) => user.remove(c))
}

export const userRoutes = createUserRoutes()
