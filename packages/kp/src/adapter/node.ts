import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'

type FetchHandler = (request: Request) => Response | Promise<Response>

export interface ServeOptions {
  fetch: FetchHandler
  port?: number
  hostname?: string
}

const toRequest = (req: IncomingMessage): Request => {
  const host = req.headers.host ?? 'localhost'
  const proto = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
  const url = new URL(req.url ?? '/', `${proto}://${host}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const v of value) headers.append(key, v)
    else headers.set(key, value)
  }

  const controller = new AbortController()
  req.once('close', () => {
    if (!req.complete) controller.abort()
  })

  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(url.href, {
    method,
    headers,
    signal: controller.signal,
    ...(hasBody
      ? { body: Readable.toWeb(req) as unknown as ReadableStream, duplex: 'half' }
      : {}),
  } as RequestInit)
}

const writeResponse = async (res: Response, out: ServerResponse): Promise<void> => {
  const headers: Record<string, string | string[]> = {}
  res.headers.forEach((value, key) => {
    if (key !== 'set-cookie') headers[key] = value
  })
  const cookies = res.headers.getSetCookie()
  if (cookies.length) headers['set-cookie'] = cookies
  out.writeHead(res.status, res.statusText, headers)

  if (!res.body) {
    out.end()
    return
  }
  const reader = res.body.getReader()
  out.once('close', () => void reader.cancel().catch(() => {}))
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
    }
  } finally {
    out.end()
  }
}

/** Turn a web-standard fetch handler into a `node:http` request listener. */
export const getRequestListener =
  (fetch: FetchHandler) =>
  async (req: IncomingMessage, out: ServerResponse): Promise<void> => {
    try {
      await writeResponse(await fetch(toRequest(req)), out)
    } catch (err) {
      console.error(err)
      if (!out.headersSent) out.writeHead(500, { 'content-type': 'text/plain; charset=UTF-8' })
      out.end('Internal Server Error')
    }
  }

/** Start a Node HTTP server: `serve({ fetch: app.fetch, port: 3000 })`. */
export const serve = (
  options: ServeOptions,
  onListen?: (info: AddressInfo) => void,
): Server => {
  const server = createServer(getRequestListener(options.fetch))
  server.listen(options.port ?? 3000, options.hostname, () => {
    onListen?.(server.address() as AddressInfo)
  })
  return server
}
