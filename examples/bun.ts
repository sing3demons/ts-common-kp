import { app } from './app.ts'

const server = Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: app.fetch })
console.log(`Bun listening on ${server.url}`)
