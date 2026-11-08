import type { Input, Params } from './types.ts'

/**
 * Wrapper around the native `Request` with typed path params, cached body
 * readers (body may be read multiple times) and access to validated data.
 */
export class TypedRequest<P extends string = any, I extends Input = {}> {
  readonly raw: Request
  readonly method: string
  readonly url: string
  readonly path: string
  #url: URL
  #params: Record<string, string>
  #validated: Partial<Record<string, unknown>> = {}
  /**
   * Type-only marker (no runtime value). Makes `TypedRequest<P, {}>` NOT assignable to
   * `TypedRequest<P, { json: X }>`, so passing a context that lacks a validator to a
   * handler typed `Ctx<{ json: X }>` is a compile error.
   */
  declare readonly '~input'?: I
  #body: Promise<ArrayBuffer> | undefined
  /** Captured eagerly: Bun drops a lazily-generated multipart content-type once the body is consumed. */
  #contentType: string | null

  constructor(raw: Request, params: Record<string, string> = {}, url: URL = new URL(raw.url)) {
    this.raw = raw
    this.method = raw.method
    this.url = raw.url
    this.#url = url
    this.path = url.pathname
    this.#params = params
    this.#contentType = raw.headers.get('content-type')
  }

  /** @internal */
  setParams(params: Record<string, string>): void {
    this.#params = params
  }

  /** @internal Called by the validator middleware. */
  addValidatedData(target: string, data: unknown): void {
    this.#validated[target] = data
  }

  // -- params ---------------------------------------------------------------

  param(): Params<P>
  param<K extends keyof Params<P> & string>(key: K): Params<P>[K]
  param(key?: string): unknown {
    if (key === undefined) return { ...this.#params }
    return this.#params[key]
  }

  // -- query ----------------------------------------------------------------

  query(): Record<string, string>
  query(key: string): string | undefined
  query(key?: string): unknown {
    const sp = this.#url.searchParams
    if (key !== undefined) return sp.get(key) ?? undefined
    const out: Record<string, string> = {}
    for (const [k, v] of sp) if (!(k in out)) out[k] = v
    return out
  }

  queries(key: string): string[] {
    return this.#url.searchParams.getAll(key)
  }

  // -- headers --------------------------------------------------------------

  header(): Record<string, string>
  header(name: string): string | undefined
  header(name?: string): unknown {
    if (name !== undefined) {
      if (name.toLowerCase() === 'content-type') return this.#contentType ?? undefined
      return this.raw.headers.get(name) ?? undefined
    }
    const out: Record<string, string> = {}
    this.raw.headers.forEach((v, k) => {
      out[k] = v
    })
    if (this.#contentType) out['content-type'] = this.#contentType
    return out
  }

  // -- body (read once, cached) ---------------------------------------------

  arrayBuffer(): Promise<ArrayBuffer> {
    this.#body ??= this.raw.arrayBuffer()
    return this.#body
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer())
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T
  }

  async formData(): Promise<FormData> {
    const buf = await this.arrayBuffer()
    const headers = new Headers()
    if (this.#contentType) headers.set('content-type', this.#contentType)
    return (await new Response(buf, { headers }).formData()) as FormData
  }

  // -- validated data -------------------------------------------------------

  /** Data produced by `validator(target, schema)`. Only targets that were validated are allowed. */
  valid<K extends keyof I & string>(target: K): I[K] {
    return this.#validated[target] as I[K]
  }
}
