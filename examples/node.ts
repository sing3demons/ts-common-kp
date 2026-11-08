import { serve } from '../src/adapter/node.ts'
import { app } from './app.ts'

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) }, (info) => {
  console.log(`Node listening on http://localhost:${info.port}`)
})
