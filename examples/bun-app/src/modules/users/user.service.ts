import { HTTPException } from '../../lib/kp.ts'
import type { UserRepository } from './user.repository.ts'
import type { CreateUser, UpdateUser, User } from './user.schema.ts'

export class UserService {
  constructor(private readonly repo: UserRepository) {}

  list(limit: number): User[] {
    return this.repo.findAll(limit)
  }

  get(id: number): User {
    const user = this.repo.findById(id)
    if (!user) throw new HTTPException(404, { message: `user ${id} not found` })
    return user
  }

  create(data: CreateUser): User {
    if (this.repo.findByEmail(data.email)) {
      throw new HTTPException(409, { message: `email ${data.email} already used` })
    }
    return this.repo.create(data)
  }

  update(id: number, data: UpdateUser): User {
    const user = this.repo.update(id, data)
    if (!user) throw new HTTPException(404, { message: `user ${id} not found` })
    return user
  }

  remove(id: number): void {
    if (!this.repo.delete(id)) throw new HTTPException(404, { message: `user ${id} not found` })
  }
}
