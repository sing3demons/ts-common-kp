import { config } from './config.ts'
import { App } from './lib/kp.ts'
import { errorHandler, notFoundHandler } from './middleware/error.ts'
import { userRoutes } from './modules/users/index.ts'

const app = new App().logger({ path: new URL('../logger.yaml', import.meta.url) })
app.onError(errorHandler)
app.notFound(notFoundHandler)
app.get('/health', (c) => c.json({ status: 'ok' }))
app.register(userRoutes)

app.start({ port: config.port }, (info) => {
  console.log(`[${info.runtime}] listening on ${info.url}`)
})
