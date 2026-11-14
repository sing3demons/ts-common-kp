import type { Logger } from './logger/logger.ts'
import type { DependencyInfo, Env, FlushErrorOptions, FlushOptions, MaskRule, WithLogger } from './logger/types.ts'
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

export class Context<P extends string = any, I extends Input = {}, E extends Env = {}> {
  readonly req: TypedRequest<P, I>
  /** The final response. Middleware may read / replace it after `await next()`. */
  res: Response | undefined
  #status = 200
  #headers: Headers | undefined
  #notFound: NotFoundHandler | undefined
  #logger: Logger | undefined

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

  // -- logging ------------------------------------------------------------------
  // The log methods (`c.info`, `c.addSummary`, ...) are typed in the `Context` interface below
  // and installed on the prototype here, inside the class body so they can read `#logger`.

  /** @internal Set by the app when it was created with `.logger(...)`. */
  setLogger(logger: Logger): void {
    this.#logger = logger
  }

  get requestId(): string | undefined {
    return this.#logger?.requestId
  }

  get correlationId(): string | undefined {
    return this.#logger?.correlationId
  }

  static {
    const log = (c: Context): Logger => {
      if (!c.#logger) throw new Error('logger is not enabled: create the app with `new App().logger(...)`')
      return c.#logger
    }
    /** Methods that forward to the logger and return the context for chaining. */
    const chained = [
      'debug',
      'info',
      'warn',
      'error',
      'maskDebug',
      'maskInfo',
      'maskWarn',
      'maskError',
      'addDetailAdditionalInfo',
      'clearDetailAdditionalInfo',
      'addSummary',
      'addSummaryAdditionalInfo',
      'clearSummaryAdditionalInfo',
      'flush',
      'flushError',
    ] as const
    const methods: Record<string, (this: Context, ...args: any[]) => unknown> = {
      log() {
        return log(this)
      },
      genId() {
        return log(this).genId()
      },
      setDependency(info: DependencyInfo) {
        return log(this).setDependency(info)
      },
    }
    for (const name of chained) {
      methods[name] = function (this: Context, ...args: any[]) {
        ;(log(this)[name] as (...a: any[]) => unknown)(...args)
        return this
      }
    }
    for (const [name, fn] of Object.entries(methods)) {
      Object.defineProperty(this.prototype, name, { value: fn, writable: true, configurable: true })
    }
  }

  notFound(): Response | Promise<Response> {
    return this.#notFound ? this.#notFound(this as Context) : this.text('404 Not Found', 404)
  }
}

/**
 * Log methods exist only when `E` has a logger (`new App().logger(...)`). Otherwise they are typed
 * `never`: calling one is a type error ("not callable"). Handlers in other files get the right
 * type from the app itself: `type Ctx<A, B> = CtxOf<typeof app, A, B>`.
 */
type Gate<E extends Env, F> = E extends WithLogger ? F : never

export interface Context<P extends string = any, I extends Input = {}, E extends Env = {}> {
  /** The request logger (ids, detail lines, summary). Throws if the app has no logger. */
  log: Gate<E, () => Logger>
  /** A new id from the configured generator, e.g. for `setDependency({ dependencyId })`. */
  genId: Gate<E, () => string>

  debug: Gate<E, (action: string, data?: unknown) => this>
  info: Gate<E, (action: string, data?: unknown) => this>
  warn: Gate<E, (action: string, data?: unknown) => this>
  error: Gate<E, (action: string, data?: unknown) => this>

  maskDebug: Gate<E, (rules: MaskRule[], action: string, data?: unknown) => this>
  maskInfo: Gate<E, (rules: MaskRule[], action: string, data?: unknown) => this>
  maskWarn: Gate<E, (rules: MaskRule[], action: string, data?: unknown) => this>
  maskError: Gate<E, (rules: MaskRule[], action: string, data?: unknown) => this>

  /** Dependency fields for the next detail line only: `c.setDependency({ dependency: 'mysql' }).info('db_request')`. */
  setDependency: Gate<E, (info: DependencyInfo) => Logger>

  addDetailAdditionalInfo: Gate<E, (key: string, value: unknown) => this>
  clearDetailAdditionalInfo: Gate<E, () => this>

  addSummary: Gate<E, (key: string, value: unknown) => this>
  addSummaryAdditionalInfo: Gate<E, (key: string, value: unknown) => this>
  clearSummaryAdditionalInfo: Gate<E, () => this>

  flush: Gate<E, (options?: FlushOptions) => this>
  flushError: Gate<E, (error: unknown, options?: FlushErrorOptions) => this>
}
