import {
  App,
  type CtxOf,
  type EnvOf,
  type Input,
  type ErrorHandler as KpErrorHandler,
  type MiddlewareHandler as KpMiddlewareHandler,
  type NotFoundHandler as KpNotFoundHandler,
} from './lib/kp.ts'

/**
 * The app. Its type decides what `c` can do in every handler: with `.logger(...)` the log
 * methods (`c.info()`, `c.addSummary()`, ...) exist, without it they are type errors.
 */
export const app = new App().logger({ path: new URL('../logger.yaml', import.meta.url) })

// Handler types derived from `app`: import these (not the ones from the framework).
type Env = EnvOf<typeof app>
export type Ctx<A extends string | Input = {}, B extends Input = {}> = CtxOf<typeof app, A, B>
export type MiddlewareHandler = KpMiddlewareHandler<any, {}, Env>
export type ErrorHandler = KpErrorHandler<Env>
export type NotFoundHandler = KpNotFoundHandler<Env>
