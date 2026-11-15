import type { Context } from './context.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'
import type { MiddlewareHandler, ValidationTarget } from './types.ts'
import { readAsync } from './validation.ts'

export type ValidationHook<T extends ValidationTarget, S extends StandardSchemaV1> = (
  result:
    | { success: true; target: T; data: StandardSchemaV1.InferOutput<S> }
    | { success: false; target: T; issues: ReadonlyArray<StandardSchemaV1.Issue> },
  c: Context,
) => Response | void | Promise<Response | void>

/**
 * Validate part of the request with any Standard Schema (Zod, Valibot, ArkType, ...).
 * The output type is exposed through `c.req.valid(target)` in later handlers.
 *
 * On failure responds `400` with `{ success: false, error: issues }`, unless `hook`
 * returns its own response.
 */
export function validator<T extends ValidationTarget, S extends StandardSchemaV1>(
  target: T,
  schema: S,
  hook?: ValidationHook<T, S>,
): MiddlewareHandler<any, { [K in T]: StandardSchemaV1.InferOutput<S> }> {
  return async (c, next) => {
    const value = await readAsync(c.req, target)
    const result = await schema['~standard'].validate(value)

    if (result.issues) {
      const hooked = await hook?.({ success: false, target, issues: result.issues }, c as Context)
      if (hooked instanceof Response) return hooked
      return c.json({ success: false, error: result.issues }, 400)
    }

    if (hook) {
      const hooked = await hook({ success: true, target, data: result.value }, c as Context)
      if (hooked instanceof Response) return hooked
    }

    c.req.addValidatedData(target, result.value)
    await next()
  }
}
