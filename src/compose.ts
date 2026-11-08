import type { Context } from './context.ts'
import type { MiddlewareHandler } from './types.ts'

/**
 * Koa-style composition. Any handler may return a `Response` (stored in `c.res`
 * and ends the chain unless it called `next()`); middleware can post-process
 * `c.res` after `await next()`.
 */
export const compose = (handlers: MiddlewareHandler[]) => {
  return async (c: Context): Promise<void> => {
    let index = -1
    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) throw new Error('next() called multiple times')
      index = i
      const handler = handlers[i]
      if (!handler) return
      const res = await handler(c, () => dispatch(i + 1))
      if (res instanceof Response) c.res = res
    }
    await dispatch(0)
  }
}
