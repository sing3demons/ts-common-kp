import { TypedRequest } from './request.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'
import type { Input, NotFoundHandler } from './types.ts'
import {
  parseAsync,
  parseSync,
  readAsync,
  readSync,
  validate,
  validateAsync,
  type Result,
  type ValidationIssues,
} from './validation.ts'

type HeaderRecord = Record<string, string>
type RedirectStatus = 300 | 301 | 302 | 303 | 304 | 307 | 308

export class Context<P extends string = any, I extends Input = {}> {
  readonly req: TypedRequest<P, I>
  /** The final response. Middleware may read / replace it after `await next()`. */
  res: Response | undefined
  #status = 200
  #headers: Headers | undefined
  #notFound: NotFoundHandler | undefined

  constructor(req: TypedRequest<P, I>, notFound?: NotFoundHandler) {
    this.req = req
    this.#notFound = notFound
  }

  /** Set the default status for the next response helper call. */
  status(code: number): this {
    this.#status = code
    return this
  }

  /** Set (or with `append`, add) a header that is merged into the response. */
  header(name: string, value: string, opts?: { append?: boolean }): this {
    // After the response exists (post-`next()` middleware), mutate it directly.
    if (this.res) {
      if (opts?.append) this.res.headers.append(name, value)
      else this.res.headers.set(name, value)
      return this
    }
    this.#headers ??= new Headers()
    if (opts?.append) this.#headers.append(name, value)
    else this.#headers.set(name, value)
    return this
  }

  body(data: ConstructorParameters<typeof Response>[0], status?: number, headers?: HeaderRecord): Response {
    const h = new Headers(this.#headers)
    if (headers) for (const [k, v] of Object.entries(headers)) h.set(k, v)
    return new Response(data, { status: status ?? this.#status, headers: h })
  }

  text(text: string, status?: number, headers?: HeaderRecord): Response {
    return this.body(text, status, { 'content-type': 'text/plain; charset=UTF-8', ...headers })
  }

  json<T>(data: T, status?: number, headers?: HeaderRecord): Response {
    return this.body(JSON.stringify(data), status, {
      'content-type': 'application/json; charset=UTF-8',
      ...headers,
    })
  }

  html(html: string, status?: number, headers?: HeaderRecord): Response {
    return this.body(html, status, { 'content-type': 'text/html; charset=UTF-8', ...headers })
  }

  redirect(location: string, status: RedirectStatus = 302): Response {
    return this.body(null, status, { location })
  }

  // -- inline validation ------------------------------------------------------
  // Validate inside the handler and get the schema's output type back.
  // On failure they throw `ValidationError` → 400 `{ success: false, error: issues }`.

  /** `const q: UserQuery = c.safeQuery(UserQuerySchema)` */
  safeQuery<S extends StandardSchemaV1>(schema: S): StandardSchemaV1.InferOutput<S> {
    return parseSync(schema, readSync(this.req, 'query'), 'query')
  }

  /** `const { id } = c.safeParam(z.object({ id: z.coerce.number() }))` */
  safeParam<S extends StandardSchemaV1>(schema: S): StandardSchemaV1.InferOutput<S> {
    return parseSync(schema, readSync(this.req, 'param'), 'param')
  }

  /** Header names are lower-cased: `z.object({ 'x-api-key': z.string() })` */
  safeHeader<S extends StandardSchemaV1>(schema: S): StandardSchemaV1.InferOutput<S> {
    return parseSync(schema, readSync(this.req, 'header'), 'header')
  }

  /** `const body: CreateUser = await c.safeBody(CreateUserSchema)` (JSON body) */
  safeBody<S extends StandardSchemaV1>(schema: S): Promise<StandardSchemaV1.InferOutput<S>> {
    return this.#parseBody(schema, 'json')
  }

  /** multipart/form-data or urlencoded body. */
  safeForm<S extends StandardSchemaV1>(schema: S): Promise<StandardSchemaV1.InferOutput<S>> {
    return this.#parseBody(schema, 'form')
  }

  /**
   * Validate any data without throwing: `{ ok: true, value } | { ok: false, error: issues }`.
   *
   * ```ts
   * const result = c.validate(CreateUserSchema, await c.req.json())
   * if (!result.ok) return c.json({ issues: result.error }, 422)
   * result.value // CreateUser
   * ```
   */
  validate<S extends StandardSchemaV1>(
    schema: S,
    data: unknown,
  ): Result<StandardSchemaV1.InferOutput<S>, ValidationIssues> {
    return validate(schema, data)
  }

  /** Like `c.validate`, but supports async schemas. */
  validateAsync<S extends StandardSchemaV1>(
    schema: S,
    data: unknown,
  ): Promise<Result<StandardSchemaV1.InferOutput<S>, ValidationIssues>> {
    return validateAsync(schema, data)
  }

  async #parseBody<S extends StandardSchemaV1>(
    schema: S,
    target: 'json' | 'form',
  ): Promise<StandardSchemaV1.InferOutput<S>> {
    return parseAsync(schema, await readAsync(this.req, target), target)
  }

  notFound(): Response | Promise<Response> {
    return this.#notFound ? this.#notFound(this as Context) : this.text('404 Not Found', 404)
  }
}
