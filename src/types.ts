import type { Context } from './context.ts'
import type { Env } from './logger/types.ts'

/** Flattens intersections so hover types stay readable. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {}

// ---------------------------------------------------------------------------
// Path params
// ---------------------------------------------------------------------------

type ParamSegment<S extends string> = S extends `:${infer Name}` ? Name : never

/** Raw param names in a path, optional ones keep their trailing `?`. */
type RawParamKeys<P extends string> = P extends `${infer Head}/${infer Tail}`
  ? ParamSegment<Head> | RawParamKeys<Tail>
  : ParamSegment<P>

type StripOptional<K extends string> = K extends `${infer N}?` ? N : K

/** Union of param names in a path: `'/u/:id/p/:pid?'` → `'id' | 'pid'`. */
export type ParamKeys<P extends string> = StripOptional<RawParamKeys<P>>

/** Param object for a path. Falls back to a string record for non-literal paths. */
export type Params<P extends string> = string extends P
  ? Record<string, string>
  : Simplify<
      { [K in RawParamKeys<P> as K extends `${string}?` ? never : K]: string } & {
        [K in RawParamKeys<P> as K extends `${infer N}?` ? N : never]?: string
      }
    >

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Raw (pre-validation) shape of each validation target. */
export type ValidationTargets = {
  json: unknown
  form: Record<string, string | File | (string | File)[]>
  query: Record<string, string | string[]>
  param: Record<string, string>
  header: Record<string, string>
}

export type ValidationTarget = keyof ValidationTargets

/** Validated inputs accumulated by validator middleware, keyed by target. */
export type Input = { [K in ValidationTarget]?: unknown }

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export type Next = () => Promise<void>

// Handler types are declared through a method (`{ fn(...): R }['fn']`) so their parameter is
// checked bivariantly: e.g. `validator()` (typed without a logger) plugs into an app with one.

export type Handler<P extends string = any, I extends Input = {}, E extends Env = {}> = {
  fn(c: Context<P, I, E>): Response | Promise<Response>
}['fn']

export type MiddlewareHandler<P extends string = any, I extends Input = {}, E extends Env = {}> = {
  fn(c: Context<P, I, E>, next: Next): Response | void | Promise<Response | void>
}['fn']

export type ErrorHandler<E extends Env = {}> = {
  fn(err: Error, c: Context<any, {}, E>): Response | Promise<Response>
}['fn']

export type NotFoundHandler<E extends Env = {}> = {
  fn(c: Context<any, {}, E>): Response | Promise<Response>
}['fn']

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

/**
 * Overloaded route registration signature. Each middleware / validator may
 * contribute an `Input`; they are intersected and handed to the final handler.
 */
export interface HandlerInterface<Self, E extends Env = {}> {
  <P extends string>(path: P, handler: Handler<P, {}, E>): Self

  <P extends string, I1 extends Input = {}>(
    path: P,
    m1: MiddlewareHandler<P, I1, E>,
    handler: Handler<P, I1, E>,
  ): Self

  <P extends string, I1 extends Input = {}, I2 extends Input = {}>(
    path: P,
    m1: MiddlewareHandler<P, I1, E>,
    m2: MiddlewareHandler<P, I2, E>,
    handler: Handler<P, I1 & I2, E>,
  ): Self

  <P extends string, I1 extends Input = {}, I2 extends Input = {}, I3 extends Input = {}>(
    path: P,
    m1: MiddlewareHandler<P, I1, E>,
    m2: MiddlewareHandler<P, I2, E>,
    m3: MiddlewareHandler<P, I3, E>,
    handler: Handler<P, I1 & I2 & I3, E>,
  ): Self

  <
    P extends string,
    I1 extends Input = {},
    I2 extends Input = {},
    I3 extends Input = {},
    I4 extends Input = {},
  >(
    path: P,
    m1: MiddlewareHandler<P, I1, E>,
    m2: MiddlewareHandler<P, I2, E>,
    m3: MiddlewareHandler<P, I3, E>,
    m4: MiddlewareHandler<P, I4, E>,
    handler: Handler<P, I1 & I2 & I3 & I4, E>,
  ): Self

  <
    P extends string,
    I1 extends Input = {},
    I2 extends Input = {},
    I3 extends Input = {},
    I4 extends Input = {},
    I5 extends Input = {},
  >(
    path: P,
    m1: MiddlewareHandler<P, I1, E>,
    m2: MiddlewareHandler<P, I2, E>,
    m3: MiddlewareHandler<P, I3, E>,
    m4: MiddlewareHandler<P, I4, E>,
    m5: MiddlewareHandler<P, I5, E>,
    handler: Handler<P, I1 & I2 & I3 & I4 & I5, E>,
  ): Self
}

/**
 * Handy context type for handlers written as standalone functions / class methods.
 *
 * - `Ctx`                                  → any route, nothing validated
 * - `Ctx<'/:id'>`                          → typed `c.req.param('id')`
 * - `Ctx<{ json: CreateUser }>`            → typed `c.req.valid('json')`
 * - `Ctx<'/:id', { param: { id: number } }>` → both
 */
export type Ctx<A extends string | Input = {}, B extends Input = {}, E extends Env = {}> = A extends string
  ? Context<A, B, E>
  : Context<any, A & Input, E>
