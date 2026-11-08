import { config } from './config.ts'
import { App } from './lib/kp.ts'
import { errorHandler, notFoundHandler } from './middleware/error.ts'
import { logger } from './middleware/logger.ts'
import { createUserModule } from './modules/users/index.ts'

/** HTTP app: routes, middleware and error handling. */
export class Server {
  readonly app = new App()

  constructor(opts: { logger?: boolean } = {}) {
    if (opts.logger !== false) this.app.use(logger())

    this.app
      .get('/', (c) => c.text('Hello from kp bun-app!'))
      .get('/health', (c) => c.json({ status: 'ok' }))
      .onError(errorHandler)
      .notFound(notFoundHandler)

    this.app.basePath(config.apiPrefix).route('/users', createUserModule())
  }
}
