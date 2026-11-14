import { app } from './app.ts'
import { config } from './config.ts'
import { errorHandler, notFoundHandler } from './middleware/error.ts'
import { userRoutes } from './modules/users/index.ts'

app.onError(errorHandler)
app.notFound(notFoundHandler)
app.get('/health', (c) => c.json({ status: 'ok' }))
app.register(userRoutes)

app.start({ port: config.port }, (info) => {
  console.log(`[${info.runtime}] listening on ${info.url}`)
})
