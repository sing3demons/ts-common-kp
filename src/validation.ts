import { HTTPException } from './http-exception.ts'
import type { TypedRequest } from './request.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'
import type { ValidationTarget, ValidationTargets } from './types.ts'

type Issues = ReadonlyArray<StandardSchemaV1.Issue>

/** Thrown by `c.safeXXX(schema)` when validation fails. Responds 400 `{ success: false, error: issues }`. */
export class ValidationError extends HTTPException {
  readonly target: ValidationTarget
  readonly issues: Issues

  constructor(target: ValidationTarget, issues: Issues) {
    super(400, {
      message: `Invalid ${target}`,
      res: Response.json({ success: false, error: issues }, { status: 400 }),
    })
    this.name = 'ValidationError'
    this.target = target
    this.issues = issues
  }
}

const collect = <V>(entries: Iterable<[string, V]>): Record<string, V | V[]> => {
  const out: Record<string, V | V[]> = {}
  for (const [k, v] of entries) {
    const prev = out[k]
    if (prev === undefined) out[k] = v
    else out[k] = Array.isArray(prev) ? [...prev, v] : [prev as V, v]
  }
  return out
}

/** Raw value of a target that doesn't need the body. */
export const readSync = (req: TypedRequest, target: 'query' | 'param' | 'header'): unknown => {
  switch (target) {
    case 'query':
      return collect(new URL(req.url).searchParams) satisfies ValidationTargets['query']
    case 'param':
      return req.param()
    case 'header':
      return req.header()
  }
}

/** Raw value of any target (reads the cached body for json / form). */
export const readAsync = async (req: TypedRequest, target: ValidationTarget): Promise<unknown> => {
  if (target === 'json') {
    const text = await req.text()
    if (text === '') return undefined
    try {
      return JSON.parse(text)
    } catch {
      throw new HTTPException(400, { message: 'Malformed JSON in request body' })
    }
  }
  if (target === 'form') {
    try {
      const fd = await req.formData()
      return collect(fd.entries()) satisfies ValidationTargets['form']
    } catch {
      throw new HTTPException(400, { message: 'Malformed form data in request body' })
    }
  }
  return readSync(req, target)
}

// ---------------------------------------------------------------------------
// Non-throwing validation → Result
// ---------------------------------------------------------------------------

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export type ValidationIssues = ReadonlyArray<StandardSchemaV1.Issue>

const toResult = <T>(r: StandardSchemaV1.Result<T>): Result<T, ValidationIssues> =>
  r.issues ? { ok: false, error: r.issues } : { ok: true, value: r.value }

/**
 * Validate any value without throwing.
 *
 * ```ts
 * const result = validate(CreateUserSchema, body)
 * if (!result.ok) return c.json({ issues: result.error }, 400)
 * result.value // CreateUser
 * ```
 * Sync only. For async schemas use `validateAsync`.
 */
export const validate = <S extends StandardSchemaV1>(
  schema: S,
  data: unknown,
): Result<StandardSchemaV1.InferOutput<S>, ValidationIssues> => {
  const r = schema['~standard'].validate(data)
  if (r instanceof Promise) throw new TypeError('Schema is async. Use validateAsync(schema, data) instead.')
  return toResult(r)
}

/** Like `validate`, but supports async schemas. */
export const validateAsync = async <S extends StandardSchemaV1>(
  schema: S,
  data: unknown,
): Promise<Result<StandardSchemaV1.InferOutput<S>, ValidationIssues>> =>
  toResult(await schema['~standard'].validate(data))

/** Validate synchronously, throwing `ValidationError` on failure. */
export const parseSync = <S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  target: ValidationTarget,
): StandardSchemaV1.InferOutput<S> => {
  const result = schema['~standard'].validate(value)
  if (result instanceof Promise) {
    throw new TypeError(
      `Schema for "${target}" is async. Use validator('${target}', schema) middleware instead.`,
    )
  }
  if (result.issues) throw new ValidationError(target, result.issues)
  return result.value
}

/** Validate (sync or async schema), throwing `ValidationError` on failure. */
export const parseAsync = async <S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  target: ValidationTarget,
): Promise<StandardSchemaV1.InferOutput<S>> => {
  const result = await schema['~standard'].validate(value)
  if (result.issues) throw new ValidationError(target, result.issues)
  return result.value
}
