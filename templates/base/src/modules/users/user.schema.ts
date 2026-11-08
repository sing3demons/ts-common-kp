import { z } from 'zod'

export const CreateUserSchema = z.object({ name: z.string().min(1), email: z.email() })
export const UpdateUserSchema = CreateUserSchema.partial()
export const UserIdSchema = z.object({ id: z.coerce.number().int().positive() })
export const UserQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) })

export type CreateUser = z.infer<typeof CreateUserSchema>
export type UpdateUser = z.infer<typeof UpdateUserSchema>
export type UserId = z.infer<typeof UserIdSchema>
export type IUserQuery = z.infer<typeof UserQuerySchema>
export type User = CreateUser & { id: number }
