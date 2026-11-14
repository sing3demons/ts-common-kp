/**
 * Compile-time tests without `import '@sing3demons/kp/logger'`: the logger API doesn't exist.
 * Checked by `tsc --noEmit -p test/no-logger` (never executed).
 */
import { App, type Ctx, type ErrorHandler } from '../../src/index.ts'

const app = new App()
// @ts-expect-error — app.logger() needs `import '@sing3demons/kp/logger'`
app.logger({ format: 'json' })

app.get('/', (c) => {
  // @ts-expect-error — not installed
  c.info('x')
  // @ts-expect-error — not installed
  c.log()
  // @ts-expect-error — not installed
  c.addSummary('k', 1)
  // @ts-expect-error — not installed
  c.setDependency({ dependency: 'db' })
  // @ts-expect-error — not installed
  c.requestId
  return c.text('ok')
})

export const controller = (c: Ctx) => {
  // @ts-expect-error — not installed
  c.flush()
  return c.text('ok')
}

export const onError: ErrorHandler = (err, c) => {
  // @ts-expect-error — not installed
  c.error('boom', err)
  return c.text('x', 500)
}
