import { compose } from './compose.ts'
import { Context } from './context.ts'
import { HTTPException } from './http-exception.ts'
import { TypedRequest } from './request.ts'
import { compileMatcher, METHOD_ALL, TrieRouter } from './router.ts'
import type {
  ErrorHandler,
  HandlerInterface,
  Method,
  MiddlewareHandler,
  NotFoundHandler,
} from './types.ts'

type AnyHandler = MiddlewareHandler<any, any>

/** A function that adds routes / middleware to an app. */
export type Plugin = (app: App) => void

export interface StartOptions {
  port?: number
  hostname?: string
}

export interface ServerInfo {
  runtime: 'bun' | 'node'
  port: number
  hostname: string
  url: string
}

export interface RunningServer extends ServerInfo {
  stop(): Promise<void>
}

/** Minimal shape of the `Bun` global we rely on (avoids a hard dependency on bun types). */
interface BunLike {
  serve(options: {
    port?: number
    hostname?: string | undefined
    fetch: (req: Request) => Response | Promise<Response>
  }): { port: number; hostname: string; url: URL; stop(): void }
}

interface RouteDef {
  method: string
  path: string
  handlers: AnyHandler[]
}

interface MiddlewareDef {
  path: string
  match: (path: string) => boolean
  handler: AnyHandler
}

/** Shared between an app and the views created by `basePath()`. */
interface AppState {
  routes: RouteDef[]
  middlewares: MiddlewareDef[]
  router: TrieRouter<AnyHandler[]>
  errorHandler: ErrorHandler
  notFoundHandler: NotFoundHandler
}

export const joinPaths = (...parts: string[]): string => {
  const joined = parts
    .filter((p) => p !== '')
    .join('/')
    .replace(/\/{2,}/g, '/')
  const withLead = joined.startsWith('/') ? joined : '/' + joined
  return withLead.length > 1 && withLead.endsWith('/') ? withLead.slice(0, -1) : withLead
}

const defaultErrorHandler: ErrorHandler = (err) => {
  if (err instanceof HTTPException) return err.getResponse()
  console.error(err)
  return new Response('Internal Server Error', {
    status: 500,
    headers: { 'content-type': 'text/plain; charset=UTF-8' },
  })
}

const defaultNotFound: NotFoundHandler = (c) => c.text('404 Not Found', 404)

export class App {
  #state: AppState = {
    routes: [],
    middlewares: [],
    router: new TrieRouter(),
    errorHandler: defaultErrorHandler,
    notFoundHandler: defaultNotFound,
  }
  #base = '/'

  get: HandlerInterface<this> = this.#method('GET')
  post: HandlerInterface<this> = this.#method('POST')
  put: HandlerInterface<this> = this.#method('PUT')
  patch: HandlerInterface<this> = this.#method('PATCH')
  delete: HandlerInterface<this> = this.#method('DELETE')
  options: HandlerInterface<this> = this.#method('OPTIONS')
  all: HandlerInterface<this> = this.#method(METHOD_ALL)

  #method(method: string): any {
    return (path: string, ...handlers: AnyHandler[]) => {
      this.#addRoute(method, joinPaths(this.#base, path), handlers)
      return this
    }
  }

  #addRoute(method: string, path: string, handlers: AnyHandler[]): void {
    if (handlers.length === 0) throw new Error(`No handler for ${method} ${path}`)
    this.#state.routes.push({ method, path, handlers })
    this.#state.router.add(method, path, handlers)
  }

  #addMiddleware(path: string, handler: AnyHandler): void {
    this.#state.middlewares.push({ path, match: compileMatcher(path), handler })
  }

  /** Register a route for one or several methods. */
  on(method: Method | Method[] | (string & {}), path: string, ...handlers: AnyHandler[]): this {
    const methods = Array.isArray(method) ? method : [method]
    for (const m of methods) this.#addRoute(m.toUpperCase(), joinPaths(this.#base, path), handlers)
    return this
  }

  /**
   * Register middleware. Without a path it applies to every request under this
   * app's base path. Middleware runs (in registration order) before the route handler.
   */
  use(...handlers: AnyHandler[]): this
  use(path: string, ...handlers: AnyHandler[]): this
  use(arg: string | AnyHandler, ...rest: AnyHandler[]): this {
    const [path, handlers] =
      typeof arg === 'string' ? [arg, rest] : ['*', [arg, ...rest]]
    const full = this.#base === '/' && path === '*' ? '*' : joinPaths(this.#base, path)
    for (const h of handlers) this.#addMiddleware(full, h)
    return this
  }

  /** Mount a sub-app's routes and middleware under `prefix`. */
  route(prefix: string, app: App): this {
    const sub = app.#state
    const base = joinPaths(this.#base, prefix)
    for (const mw of sub.middlewares) {
      this.#addMiddleware(mw.path === '*' ? joinPaths(base, '*') : joinPaths(base, mw.path), mw.handler)
    }
    for (const r of sub.routes) {
      const handlers =
        sub.errorHandler === defaultErrorHandler
          ? r.handlers
          : [scopedErrorHandler(sub.errorHandler), ...r.handlers]
      this.#addRoute(r.method, joinPaths(base, r.path), handlers)
    }
    return this
  }

  /**
   * Register a group of routes:
   * - an `App` (e.g. `new App().basePath('/users').get(...)`) is mounted as-is, or under `prefix`;
   * - a plugin function receives this app (scoped to `prefix`) and adds routes/middleware itself.
   */
  register(plugin: App | Plugin, options: { prefix?: string } = {}): this {
    const prefix = options.prefix ?? '/'
    if (plugin instanceof App) return this.route(prefix, plugin)
    plugin(prefix === '/' ? this : this.basePath(prefix))
    return this
  }

  /**
   * Start an HTTP server on the current runtime: `Bun.serve` on Bun, `node:http` on Node.
   * Resolves once the server is listening.
   */
  async start(options: StartOptions = {}, onListen?: (info: ServerInfo) => void): Promise<RunningServer> {
    const port = options.port ?? 3000
    const hostname = options.hostname
    const bun = (globalThis as { Bun?: BunLike }).Bun

    let running: RunningServer
    if (bun) {
      const server = bun.serve({ port, hostname, fetch: this.fetch })
      running = {
        runtime: 'bun',
        port: server.port,
        hostname: server.hostname,
        url: server.url.href,
        stop: async () => server.stop(),
      }
    } else {
      const { serve } = await import('./adapter/node.ts')
      const { server, info } = await new Promise<{
        server: ReturnType<typeof serve>
        info: { port: number; address: string }
      }>((resolve, reject) => {
        const server = serve({ fetch: this.fetch, port, hostname }, (info) => resolve({ server, info }))
        server.once('error', reject)
      })
      const host = hostname ?? 'localhost'
      running = {
        runtime: 'node',
        port: info.port,
        hostname: host,
        url: `http://${host}:${info.port}/`,
        stop: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
      }
    }

    onListen?.(running)
    return running
  }

  /** A view of this app whose routes are registered under `path`. Shares routes, middleware and handlers. */
  basePath(path: string): App {
    const view = new App()
    view.#state = this.#state
    view.#base = joinPaths(this.#base, path)
    return view
  }

  onError(handler: ErrorHandler): this {
    this.#state.errorHandler = handler
    return this
  }

  notFound(handler: NotFoundHandler): this {
    this.#state.notFoundHandler = handler
    return this
  }

  /** Web-standard entry point: `Bun.serve({ fetch: app.fetch })`. */
  fetch = async (request: Request): Promise<Response> => {
    const state = this.#state
    const url = new URL(request.url)
    const path = url.pathname
    const match = state.router.match(request.method, path)

    const c = new Context(new TypedRequest(request, match?.params ?? {}, url), state.notFoundHandler)
    const handlers: AnyHandler[] = []
    for (const mw of state.middlewares) if (mw.match(path)) handlers.push(mw.handler)
    if (match) handlers.push(...match.handler)
    else handlers.push((ctx) => ctx.notFound())

    try {
      await compose(handlers)(c)
      if (!c.res) throw new Error(`No response returned for ${request.method} ${path}`)
    } catch (err) {
      c.res = await state.errorHandler(err instanceof Error ? err : new Error(String(err)), c)
    }

    const res = c.res
    return request.method === 'HEAD'
      ? new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers })
      : res
  }

  /** Convenience for tests: `await app.request('/users/1')`. */
  request = (input: string | Request, init?: RequestInit): Promise<Response> => {
    if (input instanceof Request) return this.fetch(input)
    const url = /^https?:\/\//.test(input) ? input : `http://localhost${input}`
    return this.fetch(new Request(url, init))
  }
}

/** Keeps a mounted sub-app's `onError` in effect for its own routes. */
const scopedErrorHandler =
  (handler: ErrorHandler): AnyHandler =>
  async (c, next) => {
    try {
      await next()
    } catch (err) {
      c.res = await handler(err instanceof Error ? err : new Error(String(err)), c)
    }
  }
