export interface HTTPExceptionOptions {
  message?: string
  /** A custom response returned as-is. */
  res?: Response
  cause?: unknown
}

/** Throw from any handler or middleware to short-circuit with an HTTP error. */
export class HTTPException extends Error {
  readonly status: number
  readonly res: Response | undefined

  constructor(status = 500, options: HTTPExceptionOptions = {}) {
    super(options.message, { cause: options.cause })
    this.name = 'HTTPException'
    this.status = status
    this.res = options.res
  }

  getResponse(): Response {
    if (this.res) return this.res
    return new Response(this.message, {
      status: this.status,
      headers: { 'content-type': 'text/plain; charset=UTF-8' },
    })
  }
}
