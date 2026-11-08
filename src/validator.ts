import type { Context } from './context.ts'
import { HTTPException } from './http-exception.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'
import type { MiddlewareHandler, ValidationTarget, ValidationTargets } from './types.ts'

export type ValidationHook<T extends ValidationTarget, S extends StandardSchemaV1> = (
  result:
    | { success: true; target: T; data: StandardSchemaV1.InferOutput<S> }
    | { success: false; target: T; issues: ReadonlyArray<StandardSchemaV1.Issue> },
  c: Context,
) => Response | void | Promise<Response | void>

const getValue = async (c: Context, target: ValidationTarget): Promise<unknown> => {
  switch (target) {
    case 'json': {
      const text = await c.req.text()
      if (text === '') return undefined
      try {
        return JSON.parse(text)
      } catch {
        throw new HTTPException(400, { message: 'Malformed JSON in request body' })
      }
    }
    case 'form': {
      let fd: FormData
      try {
        fd = await c.req.formData()
      } catch {
        throw new HTTPException(400, { message: 'Malformed form data in request body' })
      }
      const out: ValidationTargets['form'] = {}
      fd.forEach((value, key) => {
        const prev = out[key]
        if (prev === undefined) out[key] = value
        else out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value]
      })
      return out
    }
    case 'query': {
      const out: ValidationTargets['query'] = {}
      for (const [k, v] of new URL(c.req.url).searchParams) {
        const prev = out[k]
        if (prev === undefined) out[k] = v
        else out[k] = Array.isArray(prev) ? [...prev, v] : [prev, v]
      }
      return out
    }
    case 'param':
      return c.req.param()
    case 'header':
      return c.req.header()
  }
}

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
    const value = await getValue(c as Context, target)
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
