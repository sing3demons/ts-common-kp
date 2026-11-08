import { Server } from './app.ts'
import { config } from './config.ts'
import { serve } from './lib/kp-node.ts'

const { app } = new Server()
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[node-app] listening on http://localhost:${info.port}`)
})

process.on('SIGINT', () => server.close(() => process.exit(0)))
