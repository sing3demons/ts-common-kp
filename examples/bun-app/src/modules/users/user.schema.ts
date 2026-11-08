import { z } from 'zod'

export const CreateUserSchema = z.object({ name: z.string().min(1), email: z.email() })
export const UpdateUserSchema = CreateUserSchema.partial()
export const UserIdSchema = z.object({ id: z.coerce.number().int().positive() })

export type CreateUser = z.infer<typeof CreateUserSchema>
export type UpdateUser = z.infer<typeof UpdateUserSchema>
export type UserId = z.infer<typeof UserIdSchema>
export type User = CreateUser & { id: number }
