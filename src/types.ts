import type { Context } from './context.ts'

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

export type Handler<P extends string = any, I extends Input = {}> = (
  c: Context<P, I>,
) => Response | Promise<Response>

export type MiddlewareHandler<P extends string = any, I extends Input = {}> = (
  c: Context<P, I>,
  next: Next,
) => Response | void | Promise<Response | void>

export type ErrorHandler = (err: Error, c: Context) => Response | Promise<Response>
export type NotFoundHandler = (c: Context) => Response | Promise<Response>

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

/**
 * Overloaded route registration signature. Each middleware / validator may
 * contribute an `Input`; they are intersected and handed to the final handler.
 */
export interface HandlerInterface<Self> {
  <P extends string>(path: P, handler: Handler<P, {}>): Self

  <P extends string, I1 extends Input = {}>(
    path: P,
    m1: MiddlewareHandler<P, I1>,
    handler: Handler<P, I1>,
  ): Self

  <P extends string, I1 extends Input = {}, I2 extends Input = {}>(
    path: P,
    m1: MiddlewareHandler<P, I1>,
    m2: MiddlewareHandler<P, I2>,
    handler: Handler<P, I1 & I2>,
  ): Self

  <P extends string, I1 extends Input = {}, I2 extends Input = {}, I3 extends Input = {}>(
    path: P,
    m1: MiddlewareHandler<P, I1>,
    m2: MiddlewareHandler<P, I2>,
    m3: MiddlewareHandler<P, I3>,
    handler: Handler<P, I1 & I2 & I3>,
  ): Self

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
    handler: Handler<P, I1 & I2 & I3 & I4>,
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
    m1: MiddlewareHandler<P, I1>,
    m2: MiddlewareHandler<P, I2>,
    m3: MiddlewareHandler<P, I3>,
    m4: MiddlewareHandler<P, I4>,
    m5: MiddlewareHandler<P, I5>,
    handler: Handler<P, I1 & I2 & I3 & I4 & I5>,
  ): Self
}
