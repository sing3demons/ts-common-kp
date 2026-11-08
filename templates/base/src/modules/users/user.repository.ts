import type { CreateUser, UpdateUser, User } from './user.schema.ts'

export class UserRepository {
  #db = new Map<number, User>()
  #nextId = 1

  findAll(limit = Infinity): User[] {
    return [...this.#db.values()].slice(0, limit)
  }

  findById(id: number): User | undefined {
    return this.#db.get(id)
  }

  findByEmail(email: string): User | undefined {
    return this.findAll().find((u) => u.email === email)
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
