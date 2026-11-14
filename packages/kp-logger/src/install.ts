/**
 * Installs the logger into the framework: `import '@sing3demons/kp-logger'` once anywhere in the
 * project adds `app.logger(...)` and the log methods on `c` (types and runtime). Without that
 * import they don't exist, so using them is a type error.
 */
import { App, Context, type Input, type RequestHook } from '@sing3demons/kp'
import { resolveLoggerOptions } from './config.ts'
import { Logger } from './logger.ts'
import type { AppLoggerOptions, DependencyInfo, FlushErrorOptions, FlushOptions, MaskRule } from './types.ts'

declare module '@sing3demons/kp' {
  interface App {
    /**
     * Request logging: ids (correlation / request / trace), detail lines via `c.info(...)`
     * and one summary line per request. Runs around every middleware, whatever the `use` order.
     *
     * ```ts
     * app.logger({ path: 'logger.yaml' })                 // YAML config
     * app.logger({ path: 'logger.yaml', format: 'text' }) // options override the file
     * app.logger({ format: 'logfmt', level: 'debug' })
     * ```
     */
    logger(options?: AppLoggerOptions): this
  }

  interface Context<P extends string = any, I extends Input = {}> {
    /** The request logger (ids, detail lines, summary). Throws if the app has no `app.logger(...)`. */
    log(): Logger
    readonly requestId: string | undefined
    readonly correlationId: string | undefined
    /** A new id from the configured generator, e.g. for `setDependency({ dependencyId })`. */
    genId(): string

    debug(action: string, data?: unknown): this
    info(action: string, data?: unknown): this
    warn(action: string, data?: unknown): this
    error(action: string, data?: unknown): this

    maskDebug(rules: MaskRule[], action: string, data?: unknown): this
    maskInfo(rules: MaskRule[], action: string, data?: unknown): this
    maskWarn(rules: MaskRule[], action: string, data?: unknown): this
    maskError(rules: MaskRule[], action: string, data?: unknown): this

    /** Dependency fields for the next detail line only: `c.setDependency({ dependency: 'mysql' }).info('db_request')`. */
    setDependency(info: DependencyInfo): Logger

    addDetailAdditionalInfo(key: string, value: unknown): this
    clearDetailAdditionalInfo(): this

    addSummary(key: string, value: unknown): this
    addSummaryAdditionalInfo(key: string, value: unknown): this
    clearSummaryAdditionalInfo(): this

    flush(options?: FlushOptions): this
    flushError(error: unknown, options?: FlushErrorOptions): this
  }
}

/** The request logger of each context (set by the hook below). */
const loggers = new WeakMap<Context, Logger>()

const logOf = (c: Context): Logger => {
  const log = loggers.get(c)
  if (!log) throw new Error('logger is not enabled: call app.logger(...) on the app')
  return log
}

/** Sets headers on a response, copying it first when its headers are immutable (e.g. from `fetch()`). */
const withHeaders = (res: Response, headers: Record<string, string>): Response => {
  try {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
    return res
  } catch {
    const copy = new Response(res.body, res)
    for (const [k, v] of Object.entries(headers)) copy.headers.set(k, v)
    return copy
  }
}

const define = (target: object, name: string, value: unknown) =>
  Object.defineProperty(target, name, { value, writable: true, configurable: true })

// -- App.prototype.logger -------------------------------------------------------

define(App.prototype, 'logger', function (this: App, options: AppLoggerOptions = {}) {
  const ready = resolveLoggerOptions(options).then((o) => new Logger(o))
  let base: Logger | undefined
  ready.then(
    (l) => {
      base = l
    },
    () => {}, // surfaced by start() / the first request
  )
  const attach = (b: Logger, c: Context, request: Request, path: string) => {
    loggers.set(c, b.forRequest(request.headers, request.method, path))
  }
  const hook: RequestHook = {
    ready,
    begin(c, request, path) {
      if (base) return attach(base, c, request, path)
      return ready.then((b) => attach(b, c, request, path))
    },
    end(c, res, error) {
      const log = loggers.get(c)
      if (!log) return res
      log.finishRequest(res.status, error)
      return withHeaders(res, log.responseHeaders())
    },
  }
  return this.setRequestHook(hook)
})

// -- Context.prototype log methods ----------------------------------------------

const proto = Context.prototype

Object.defineProperty(proto, 'requestId', {
  get(this: Context) {
    return loggers.get(this)?.requestId
  },
  configurable: true,
})
Object.defineProperty(proto, 'correlationId', {
  get(this: Context) {
    return loggers.get(this)?.correlationId
  },
  configurable: true,
})

define(proto, 'log', function (this: Context) {
  return logOf(this)
})
define(proto, 'genId', function (this: Context) {
  return logOf(this).genId()
})
define(proto, 'setDependency', function (this: Context, info: DependencyInfo) {
  return logOf(this).setDependency(info)
})

/** Forward to the logger and return the context so calls chain. */
for (const name of [
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
] as const) {
  define(proto, name, function (this: Context, ...args: unknown[]) {
    ;(logOf(this)[name] as (...a: unknown[]) => unknown)(...args)
    return this
  })
}
