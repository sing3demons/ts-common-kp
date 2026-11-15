import { App } from '@sing3demons/kp'
import { UserController } from './user.controller.ts'
import { UserRepository } from './user.repository.ts'
import { UserService } from './user.service.ts'

/** Builds the users routes with their dependencies (pass a repo to isolate tests). */
export const createUserRoutes = (repo = new UserRepository()) =>
  new App().register(new UserController(new UserService(repo)), { prefix: '/api' })

export const userRoutes = createUserRoutes()
