import { Server } from './app.ts'
import { config } from './config.ts'

const { app } = new Server()
const server = Bun.serve({ port: config.port, fetch: app.fetch })
console.log(`[bun-app] listening on ${server.url}`)

process.on('SIGINT', () => {
  server.stop()
  process.exit(0)
})
