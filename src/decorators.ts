import type { Context } from './context.ts'
import type { Input, MiddlewareHandler } from './types.ts'

/**
 * Controller decorators (TC39 standard decorators, TypeScript >= 5.0).
 *
 * ```ts
 * @Controller('/users')
 * class UserController {
 *   @Get('/:id', validator('param', UserIdSchema))
 *   getById(c: Ctx<{ param: UserId }>) { ... }
 * }
 * app.register(new UserController(service), { prefix: '/api' })
 * ```
 *
 * Routes are collected per instance through `context.addInitializer`, so no
 * `Symbol.metadata` / `reflect-metadata` is needed and `this` is bound to the instance.
 */

type AnyFn = (...args: any[]) => any

/** Method shape a route decorator accepts: it must handle the context the route provides. */
type RouteMethod<This, P extends string, I extends Input> = (
  this: This,
  c: Context<P, I>,
) => Response | Promise<Response>

/** Decorator returned by `@Get(...)` etc. Checks the method's `c` type against the route. */
export type RouteDecorator<P extends string, I extends Input> = <This>(
  target: RouteMethod<This, P, I>,
  context: ClassMethodDecoratorContext<This, any>,
) => void

/** `@Get(path, ...middlewares)`: each middleware / validator may contribute an `Input`. */
export interface RouteDecoratorFactory {
  <P extends string>(path: P): RouteDecorator<P, {}>
  <P extends string, I1 extends Input = {}>(path: P, m1: MiddlewareHandler<P, I1>): RouteDecorator<P, I1>
  <P extends string, I1 extends Input = {}, I2 extends Input = {}>(
    path: P,
    m1: MiddlewareHandler<P, I1>,
    m2: MiddlewareHandler<P, I2>,
  ): RouteDecorator<P, I1 & I2>
  <P extends string, I1 extends Input = {}, I2 extends Input = {}, I3 extends Input = {}>(
    path: P,
    m1: MiddlewareHandler<P, I1>,
    m2: MiddlewareHandler<P, I2>,
    m3: MiddlewareHandler<P, I3>,
  ): RouteDecorator<P, I1 & I2 & I3>
  <
    P extends string,
    I1 extends Input = {},
    I2 extends Input = {},
    I3 extends Input = {},
    I4 extends Input = {},
  >(
    path: P,
    m1: MiddlewareHandler<P, I1>,
    m2: MiddlewareHandler<P, I2>,
    m3: MiddlewareHandler<P, I3>,
    m4: MiddlewareHandler<P, I4>,
  ): RouteDecorator<P, I1 & I2 & I3 & I4>
  <
    P extends string,
    I1 extends Input = {},
    I2 extends Input = {},
    I3 extends Input = {},
    I4 extends Input = {},
    I5 extends Input = {},
  >(
    path: P,
    m1: MiddlewareHandler<P, I1>,
    m2: MiddlewareHandler<P, I2>,
    m3: MiddlewareHandler<P, I3>,
    m4: MiddlewareHandler<P, I4>,
    m5: MiddlewareHandler<P, I5>,
  ): RouteDecorator<P, I1 & I2 & I3 & I4 & I5>
}

export interface ControllerRoute {
  method: string
  path: string
  handlers: AnyFn[]
}

const ROUTES = Symbol('kp.controller.routes')
const PREFIXES = new WeakMap<Function, string>()

const LEGACY_HINT =
  'kp decorators use TC39 standard decorators: remove "experimentalDecorators" from tsconfig'

const isStandardContext = (context: unknown): context is { kind: string } =>
  typeof context === 'object' && context !== null && 'kind' in context

/** Class decorator: optional path prefix for every route in the controller. */
export function Controller(prefix = '/') {
  return <C extends abstract new (...args: any) => object>(target: C, context: ClassDecoratorContext<C>): void => {
    if (!isStandardContext(context)) throw new TypeError(`@Controller: ${LEGACY_HINT}`)
    PREFIXES.set(target, prefix)
  }
}

const routeDecorator = (name: string, method: string): RouteDecoratorFactory =>
  ((path: string, ...middlewares: AnyFn[]) =>
    (target: AnyFn, context: unknown): void => {
      if (!isStandardContext(context)) throw new TypeError(`@${name}: ${LEGACY_HINT}`)
      const ctx = context as ClassMethodDecoratorContext
      if (ctx.kind !== 'method' || ctx.static) {
        throw new TypeError(`@${name}('${path}') can only decorate instance methods`)
      }
      ctx.addInitializer(function (this: unknown) {
        const self = this as { [ROUTES]?: ControllerRoute[] }
        if (!Object.hasOwn(self, ROUTES)) {
          Object.defineProperty(self, ROUTES, { value: [], enumerable: false })
        }
        self[ROUTES]!.push({
          method,
          path,
          handlers: [...middlewares, (c: unknown) => target.call(self, c)],
        })
      })
    }) as RouteDecoratorFactory

export const Get = routeDecorator('Get', 'GET')
export const Post = routeDecorator('Post', 'POST')
export const Put = routeDecorator('Put', 'PUT')
export const Patch = routeDecorator('Patch', 'PATCH')
export const Delete = routeDecorator('Delete', 'DELETE')
export const Options = routeDecorator('Options', 'OPTIONS')
/** Matches every method. */
export const All = routeDecorator('All', 'ALL')

/** Routes declared with decorators on `instance`, or `undefined` if it has none. */
export function getControllerRoutes(instance: object): { prefix: string; routes: ControllerRoute[] } | undefined {
  const routes = (instance as { [ROUTES]?: ControllerRoute[] })[ROUTES]
  if (!routes?.length) return undefined

  let prefix = '/'
  for (let c: unknown = instance.constructor; typeof c === 'function'; c = Object.getPrototypeOf(c)) {
    const p = PREFIXES.get(c)
    if (p !== undefined) {
      prefix = p
      break
    }
  }
  return { prefix, routes }
}
