import { config } from './config.ts'
import { App } from '@sing3demons/kp'
import { errorHandler, notFoundHandler } from './middleware/error.ts'
import { logger } from './middleware/logger.ts'
import { userRoutes } from './modules/users/index.ts'

const app = new App()
app.use(logger())
app.onError(errorHandler)
app.notFound(notFoundHandler)
app.get('/health', (c) => c.json({ status: 'ok' }))
app.register(userRoutes)

app.start({ port: config.port }, (info) => {
  console.log(`[${info.runtime}] listening on ${info.url}`)
})
