import { UserController } from './user.controller.ts'
import { UserRepository } from './user.repository.ts'
import { userRoutes } from './user.routes.ts'
import { UserService } from './user.service.ts'

/** Wires the users module and returns its router. */
export const createUserModule = (repo = new UserRepository()) =>
  userRoutes(new UserController(new UserService(repo)))
