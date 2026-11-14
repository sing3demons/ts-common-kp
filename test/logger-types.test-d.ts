/**
 * Compile-time tests with the logger installed (`import '@sing3demons/kp/logger'`).
 * Checked by `tsc --noEmit` (never executed).
 */
import { z } from 'zod'
import { App, validator, type Ctx, type ErrorHandler, type MiddlewareHandler } from '../src/index.ts'
import '../src/logger/index.ts'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

const app = new App()
app.logger({ path: 'logger.yaml' }) // statement style works (returns the same app)
const body = z.object({ name: z.string() })

app.post('/users', validator('json', body), (c) => {
  const b = c.req.valid('json')
  const r = c.info('validated', b).addSummary('name', b.name)
  type _r = Expect<Equal<typeof r, typeof c>>
  c.log().info('a').warn('b')
  c.setDependency({ dependency: 'db', dependencyId: c.genId() }).info('db_request')
  const id: string | undefined = c.requestId
  void id
  return c.flush({ appResultCode: '20000' }).json(b, 201)
})

// types written in other files get the log API too
class UserController {
  create(c: Ctx<{ json: { name: string } }>) {
    return c.addSummary('name', c.req.valid('json').name).json({}, 201)
  }
}
const ctl = new UserController()
app.post('/c', validator('json', body), (c) => ctl.create(c))
const onErr: ErrorHandler = (err, c) => c.error('unhandled', err).text('x', 500)
const mw: MiddlewareHandler = async (c, next) => {
  c.info('mw')
  await next()
}
app.use(mw).onError(onErr)
