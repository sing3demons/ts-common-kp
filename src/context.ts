import { TypedRequest } from './request.ts'
import type { Input, NotFoundHandler } from './types.ts'

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

  notFound(): Response | Promise<Response> {
    return this.#notFound ? this.#notFound(this as Context) : this.text('404 Not Found', 404)
  }
}
