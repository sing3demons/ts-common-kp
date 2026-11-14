import { HTTPException, ValidationError, type ErrorHandler, type NotFoundHandler } from '../lib/kp.ts'

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ValidationError) {
    return c.json({ error: err.message, issues: err.issues }, err.status)
  }
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  c.error('unhandled_error', err)
  return c.json({ error: 'Internal Server Error' }, 500)
}

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json({ error: `${c.req.method} ${c.req.path} not found` }, 404)
