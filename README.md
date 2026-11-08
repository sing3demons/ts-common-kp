# @sing3demons/kp

Web framework ขนาดเล็กสไตล์ [Hono](https://hono.dev) ที่เน้น **type-safe** รันได้ทั้ง **Bun** และ **Node**

- **Type-safe path params:** `'/users/:id'` จะได้ `c.req.param('id')` เป็น `string` ถ้าพิมพ์ชื่อ param ผิดจะ compile ไม่ผ่าน
- **Validation ด้วย Standard Schema:** ใช้ได้กับ Zod, Valibot, ArkType หรือ schema ที่เขียนเอง type ของข้อมูลจะ infer มาจาก schema
- **Validate ได้ 3 แบบ:** middleware `validator()`, `c.safeXXX(schema)` ที่ throw เมื่อไม่ผ่าน และ `c.validate()` ที่ return `Result`
- **จัดกลุ่ม route:** `register()`, `route()`, `basePath()`
- **`app.start()` เลือก runtime เอง:** ใช้ `Bun.serve` บน Bun และ `node:http` บน Node
- **Web standard:** `app.fetch(Request) → Response` ใช้กับ runtime ใดก็ได้ที่รองรับ Fetch API
- **ไม่มี runtime dependency**

---

## สารบัญ

- [ติดตั้ง](#ติดตั้ง)
- [เริ่มต้นใช้งาน](#เริ่มต้นใช้งาน)
- [App](#app)
  - [ประกาศ route](#ประกาศ-route-get-post-put-patch-delete-options-all-on)
  - [รูปแบบ path](#รูปแบบ-path)
  - [middleware: `use()`](#middleware-use)
  - [จัดกลุ่ม route: `register()` / `route()` / `basePath()`](#จัดกลุ่ม-route)
  - [จัดการ error: `onError()` / `notFound()`](#จัดการ-error-onerror--notfound)
  - [รัน server: `start()` / `fetch` / `request()`](#รัน-server)
- [Context (`c`)](#context-c)
  - [สร้าง response](#สร้าง-response)
  - [`c.req`: อ่าน request](#creq-อ่าน-request)
- [Validation](#validation)
  - [แบบที่ 1: `validator()` middleware](#แบบที่-1-validator-middleware)
  - [แบบที่ 2: `c.safeXXX(schema)`](#แบบที่-2-csafexxxschema)
  - [แบบที่ 3: `c.validate(schema, data)` → `Result`](#แบบที่-3-cvalidateschema-data--result)
  - [ควรใช้แบบไหน](#ควรใช้แบบไหน)
- [Handler ในรูปแบบ class: `Ctx`](#handler-ในรูปแบบ-class-ctx)
- [Error: `HTTPException` / `ValidationError`](#error)
- [Node adapter](#node-adapter)
- [Types ที่ export](#types-ที่-export)
- [พฤติกรรมที่ควรรู้](#พฤติกรรมที่ควรรู้)
- [ตัวอย่างโปรเจกต์](#ตัวอย่างโปรเจกต์)
- [พัฒนา lib นี้](#พัฒนา-lib-นี้)

---

## ติดตั้ง

lib นี้ publish ไว้บน **GitHub Packages** ไม่ได้อยู่บน npmjs.com ก่อนติดตั้งต้องบอก npm/bun ว่า scope `@sing3demons` อยู่ที่ registry ไหน และต้องมี token สำหรับอ่านแพ็กเกจ

### 1. สร้าง GitHub token

GitHub Packages บังคับให้ใช้ token ทุกครั้ง แม้แพ็กเกจจะเป็น public ก็ตาม

1. ไปที่ GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. กด **Generate new token (classic)** แล้วเลือก scope **`read:packages`**
3. เก็บ token ไว้ใน environment variable

```sh
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx   # ใส่ใน ~/.zshrc หรือ ~/.bashrc
```

> GitHub Packages ยังไม่รองรับ fine-grained token สำหรับ npm registry ต้องใช้ token แบบ classic

### 2. ตั้งค่า `.npmrc`

สร้างไฟล์ `.npmrc` ที่ root ของโปรเจกต์ที่จะใช้ (ข้างๆ `package.json`)

```ini
@sing3demons:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

- บรรทัดแรก: ให้แพ็กเกจที่ขึ้นต้นด้วย `@sing3demons/` ไปโหลดจาก GitHub ส่วนแพ็กเกจอื่น (เช่น `zod`) ยังโหลดจาก npmjs ตามปกติ
- บรรทัดที่สอง: อ่าน token จาก env ไม่ได้เขียน token ลงไฟล์ตรงๆ จึง commit ไฟล์นี้ได้
- Bun ≥ 1.1.18 อ่าน `.npmrc` ได้เหมือน npm จึงใช้ไฟล์เดียวกันได้

### 3. ติดตั้ง

```sh
npm install @sing3demons/kp@1.0.0     # หรือ bun add @sing3demons/kp@1.0.0
npm install zod                       # หรือ validation lib อื่นที่รองรับ Standard Schema
```

ถ้าขึ้น error `401 Unauthorized` แปลว่าไม่มี token หรือ token ไม่มี scope `read:packages` ถ้าขึ้น `404 Not Found` ให้ตรวจบรรทัด `@sing3demons:registry=` ใน `.npmrc` และตรวจว่าบัญชีของ token มีสิทธิ์เห็นแพ็กเกจนี้ (กรณีแพ็กเกจเป็น private)

### ใช้ใน CI (GitHub Actions)

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    registry-url: https://npm.pkg.github.com/
    scope: '@sing3demons'
- run: npm ci
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

ถ้า workflow อยู่คนละ repo กับแพ็กเกจ ต้องเพิ่ม repo นั้นใน **หน้าแพ็กเกจ → Package settings → Manage Actions access** ก่อน ไม่งั้น `GITHUB_TOKEN` จะอ่านแพ็กเกจไม่ได้ อีกทางคือเก็บ classic token (`read:packages`) ไว้ใน secret แล้วใช้แทน

### ข้อกำหนด

- **Bun ≥ 1.1** หรือ **Node ≥ 20**
- **TypeScript ≥ 5.4** ควรเปิด `"strict": true` ด้วย ใช้ได้ทั้ง `"moduleResolution": "nodenext"` และ `"bundler"`
- เป็น **ESM อย่างเดียว** โปรเจกต์ที่ใช้ต้องตั้ง `"type": "module"` หรือใช้ไฟล์ `.mts` ถ้าเป็น CommonJS ต้องโหลดผ่าน `await import('@sing3demons/kp')`

---

## เริ่มต้นใช้งาน

```ts
import { App } from '@sing3demons/kp'
import { z } from 'zod'

const app = new App()

app.get('/', (c) => c.text('Hello!'))

app.get('/users/:id', (c) => {
  const id = c.req.param('id')         // string
  return c.json({ id })
})

app.post('/users', async (c) => {
  const body = await c.safeBody(z.object({ name: z.string(), email: z.email() }))
  return c.json(body, 201)              // body: { name: string; email: string }
})

app.start({ port: 3000 }, (info) => {
  console.log(`[${info.runtime}] listening on ${info.url}`)
})
```

```sh
bun main.ts         # Bun
tsx main.ts         # Node (หรือ build เป็น JS ก่อนแล้วใช้ node)
```

> ถ้าต้องการ alias ชื่อ `Kp` ก็มีให้ใช้: `import { Kp } from '@sing3demons/kp'` เป็น class เดียวกับ `App`

---

## App

`new App()` คือตัว app หลัก ทุก method ที่ใช้ตั้งค่าจะ return `this` จึงต่อ chain ได้

### ประกาศ route: `get`, `post`, `put`, `patch`, `delete`, `options`, `all`, `on`

```ts
app.get(path, handler)
app.get(path, middleware1, ..., handler)   // ใส่ middleware หรือ validator ได้สูงสุด 5 ตัวก่อน handler
```

| Method | ใช้ทำอะไร |
|---|---|
| `get` / `post` / `put` / `patch` / `delete` / `options` | ลงทะเบียน route ตาม HTTP method |
| `all(path, ...)` | รับทุก method |
| `on(method \| method[], path, ...handlers)` | ระบุ method เอง หรือหลาย method พร้อมกัน |

```ts
app
  .get('/posts', (c) => c.json([]))
  .post('/posts', (c) => c.text('created', 201))
  .all('/ping', (c) => c.text('pong'))                  // GET, POST, PUT, ... ได้หมด
  .on(['PUT', 'PATCH'], '/posts/:id', (c) => c.text('updated'))
```

**handler ต้อง return `Response` เสมอ** (หรือ `Promise<Response>`) ถ้าลืม return จะ compile ไม่ผ่าน

```ts
app.get('/bad', () => 'hello')   // ❌ type error
app.get('/ok', (c) => c.text('hello'))  // ✅
```

**middleware ระดับ route** รันก่อน handler ตามลำดับที่ใส่ไว้:

```ts
const auth: MiddlewareHandler = async (c, next) => {
  if (!c.req.header('authorization')) return c.text('Unauthorized', 401)
  await next()
}

app.get('/me', auth, (c) => c.json({ me: true }))
```

### รูปแบบ path

| รูปแบบ | ตัวอย่าง | match | type ของ `c.req.param()` |
|---|---|---|---|
| static | `/users/me` | `/users/me` | `{}` |
| param | `/users/:id` | `/users/42` | `{ id: string }` |
| หลาย param | `/users/:userId/posts/:postId` | `/users/1/posts/2` | `{ userId: string; postId: string }` |
| optional param (ต้องเป็น segment สุดท้าย) | `/docs/:page?` | `/docs`, `/docs/intro` | `{ page?: string }` |
| wildcard (ต้องเป็น segment สุดท้าย) | `/static/*` | `/static`, `/static/a/b.css` | `{}` |

**ลำดับการ match:** ทุก segment จะเลือก **static ก่อน param ก่อน wildcard** และถ้าทางแรกไปต่อไม่ได้จะย้อนกลับไปลองทางอื่น (backtrack) ดังนั้นลำดับที่ลงทะเบียนไม่มีผล

```ts
app.get('/users/me', ...)   // /users/me จะมาที่นี่เสมอ
app.get('/users/:id', ...)  // /users/42 มาที่นี่
```

ค่า param จะถูก decode ให้แล้ว เช่น `/users/a%20b` จะได้ `id = 'a b'`

### middleware: `use()`

```ts
app.use(handler, ...)              // ทุก request
app.use('/admin/*', handler, ...)  // เฉพาะ path ที่ match
```

middleware มีรูปแบบ `(c, next) => ...` ใช้ทำได้ 3 อย่าง:

```ts
// 1) ทำงานก่อน/หลัง handler (เช่น logger, จับเวลา)
app.use(async (c, next) => {
  const start = performance.now()
  await next()                                        // เรียก middleware/handler ถัดไป
  console.log(c.req.method, c.req.path, c.res?.status, performance.now() - start)
})

// 2) หยุดการทำงานกลางทาง (short-circuit) ด้วยการ return Response โดยไม่เรียก next()
app.use('/admin/*', (c) => c.text('Forbidden', 403))

// 3) แก้ response หลัง handler ทำงานเสร็จ
app.use(async (c, next) => {
  await next()
  c.header('x-powered-by', 'kp')                      // แก้ c.res ได้โดยตรง
})
```

- `c.res` คือ response ที่ handler สร้างไว้ อ่านค่าหรือเปลี่ยนเป็น response ใหม่ได้หลัง `await next()`
- ถ้าเรียก `next()` ซ้ำในฟังก์ชันเดียวกันจะ throw error
- pattern ของ path ที่ใช้ได้: `*`, `/api/*` (match `/api` และทุก path ข้างใต้), `/users/:id`

### จัดกลุ่ม route

#### `register(plugin, { prefix? })`

ใช้รวม route จากไฟล์หรือ module อื่นเข้ามาใน app รับได้ 2 แบบ:

**แบบ App:** สร้าง route ไว้ใน `App` แยก แล้ว register เข้ามา

```ts
// modules/users/user.routes.ts
export const userRoutes = new App()
  .basePath('/api/users')
  .get('/', (c) => c.json([]))
  .get('/:id', (c) => c.json({ id: c.req.param('id') }))

// main.ts
const app = new App()
app.register(userRoutes)                      // ได้ /api/users และ /api/users/:id
app.register(postRoutes, { prefix: '/api' })  // ใส่ prefix เพิ่มได้
```

**แบบ plugin function:** ฟังก์ชันจะได้ app ที่อยู่ใต้ `prefix` ไปเพิ่ม route และ middleware เอง

```ts
const healthPlugin = (app: App) => {
  app.use(async (c, next) => { await next(); c.header('cache-control', 'no-store') })
  app.get('/health', (c) => c.json({ ok: true }))
}

app.register(healthPlugin, { prefix: '/internal' })  // ได้ /internal/health
```

middleware ที่ plugin หรือ sub-app ประกาศไว้จะมีผล**เฉพาะ path ใต้ prefix นั้น**

#### `route(prefix, subApp)`

mount sub-app ไว้ใต้ `prefix` ซึ่งเหมือนกับ `register(subApp, { prefix })`

```ts
const users = new App()
  .get('/', (c) => c.text('list'))
  .get('/:id', (c) => c.text(c.req.param('id')))

app.route('/users', users)          // /users, /users/:id
```

ซ้อนกันได้หลายชั้น และ param จาก prefix จะถูกส่งต่อให้ route ข้างใน:

```ts
const posts = new App().get('/:postId', (c) => c.json(c.req.param()))
const users = new App().route('/:userId/posts', posts)
app.route('/users', users)
// GET /users/1/posts/2  →  { "userId": "1", "postId": "2" }
```

> ⚠️ `route()` และ `register()` **คัดลอก** route ณ ตอนที่เรียกเท่านั้น route ที่เพิ่มเข้า sub-app ทีหลังจะไม่ถูกรวมเข้ามา

ถ้า sub-app มี `onError` ของตัวเอง ตัวนั้นจะยังจัดการ error ของ route ใน sub-app ได้หลัง mount แล้ว แต่ error ที่เกิดใน **middleware** ของ sub-app จะไปที่ `onError` ของ app หลักแทน

#### `basePath(path)`

return app ตัวใหม่ที่ทุก route และ middleware อยู่ใต้ `path` โดย**ใช้ข้อมูลร่วมกับ app เดิม** (ลงทะเบียนผ่านตัวไหนก็เข้า app เดิม)

```ts
const app = new App()
const v1 = app.basePath('/api/v1')

v1.get('/health', (c) => c.text('ok'))       // GET /api/v1/health
v1.use((c, next) => next())                  // middleware นี้ใช้เฉพาะ /api/v1/*

app.fetch(...)                               // มี /api/v1/health ด้วย
```

### จัดการ error: `onError()` / `notFound()`

```ts
app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message, issues: err.issues }, 400)
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

app.notFound((c) => c.json({ error: `${c.req.method} ${c.req.path} not found` }, 404))
```

| | ค่าเริ่มต้น |
|---|---|
| `onError` | ถ้าเป็น `HTTPException` จะตอบด้วย `err.getResponse()` ถ้าเป็น error อื่นจะ `console.error` แล้วตอบ `500 Internal Server Error` |
| `notFound` | `404 Not Found` (text) |

`onError` จับ error ได้ทั้งจาก handler, middleware และ validator ถ้า handler ไม่ return response จะนับเป็น error ด้วย

### รัน server

#### `start(options?, onListen?)`: เลือก runtime ให้อัตโนมัติ

```ts
const server = await app.start({ port: 3000, hostname: '0.0.0.0' }, (info) => {
  console.log(`[${info.runtime}] listening on ${info.url}`)
})

// ปิด server (เช่นใน test หรือ graceful shutdown)
process.on('SIGINT', async () => {
  await server.stop()
  process.exit(0)
})
```

| option | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|
| `port` | `3000` | ใส่ `0` เพื่อให้ระบบสุ่ม port ว่าง (สะดวกตอนเขียน test) |
| `hostname` | ค่าเริ่มต้นของ runtime | |

**ค่าที่ return** (`RunningServer`) และค่าที่ส่งให้ `onListen` (`ServerInfo`):

```ts
{ runtime: 'bun' | 'node', port: number, hostname: string, url: string, stop(): Promise<void> }
```

- ถ้ามี `Bun` อยู่ จะใช้ `Bun.serve`
- ถ้าไม่มี จะ `import()` node adapter ตอนรัน แล้วใช้ `node:http` (core ของ framework ไม่ได้ import `node:http` ตรง ๆ)

#### `fetch`: entry point แบบ web standard

`app.fetch` เป็น `(request: Request) => Promise<Response>` ใช้ตรง ๆ ได้ (ผูก `this` ไว้แล้ว):

```ts
Bun.serve({ port: 3000, fetch: app.fetch })   // Bun
export default { fetch: app.fetch }           // Cloudflare Workers / Bun / Deno
```

#### `request(input, init?)`: ยิง request ทดสอบโดยไม่ต้องเปิด server

```ts
const res = await app.request('/users/1')
const res2 = await app.request('/users', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Ann' }),
})
expect(res.status).toBe(200)
```

รับ path (จะเติม `http://localhost` ให้), URL เต็ม หรือ `Request` ก็ได้

---

## Context (`c`)

ทุก handler และ middleware ได้ `c` (`Context`) ไว้อ่าน request และสร้าง response

### สร้าง response

| Method | ใช้ทำอะไร | Content-Type |
|---|---|---|
| `c.text(text, status?, headers?)` | ตอบเป็นข้อความ | `text/plain; charset=UTF-8` |
| `c.json(data, status?, headers?)` | ตอบเป็น JSON (`JSON.stringify` ให้) | `application/json; charset=UTF-8` |
| `c.html(html, status?, headers?)` | ตอบเป็น HTML | `text/html; charset=UTF-8` |
| `c.body(data, status?, headers?)` | ตอบด้วย body ใดก็ได้ (string, `null`, `Uint8Array`, `ReadableStream`, `Blob`, ...) | ไม่ตั้งให้ |
| `c.redirect(location, status = 302)` | redirect (status 300–308) | |
| `c.notFound()` | ตอบด้วย handler ของ `app.notFound()` | |
| `c.status(code)` | ตั้ง status เริ่มต้นให้ response ที่จะสร้างต่อจากนี้ | |
| `c.header(name, value, { append? })` | ตั้ง header ให้ response | |

```ts
app.get('/a', (c) => c.json({ ok: true }))                         // 200
app.post('/b', (c) => c.json({ id: 1 }, 201))                      // 201
app.get('/c', (c) => c.text('hi', 200, { 'x-custom': '1' }))       // ใส่ header เพิ่ม
app.delete('/d', (c) => c.body(null, 204))                         // 204 No Content
app.get('/old', (c) => c.redirect('/new', 301))
app.get('/e', (c) => c.status(202).header('x-id', 'abc').json({ queued: true }))
app.get('/stream', (c) => c.body(someReadableStream, 200, { 'content-type': 'text/event-stream' }))
```

**`c.header()` ทำงานต่างกันตามจังหวะที่เรียก:**
- **ก่อนสร้าง response:** header จะถูกเก็บไว้ แล้วรวมเข้ากับ response ที่สร้างด้วย `c.text/json/...`
- **หลัง `await next()` ใน middleware:** แก้ header ของ `c.res` โดยตรง
- **`{ append: true }`:** เพิ่มค่าแทนการเขียนทับ ใช้กับ `set-cookie` หลายค่าได้

### `c.req`: อ่าน request

`c.req` คือ `TypedRequest` ที่ห่อ `Request` ของ web standard ไว้

| Method / Property | return | ใช้ทำอะไร |
|---|---|---|
| `c.req.param(name)` | `string` (หรือ `string \| undefined` ถ้าเป็น optional) | อ่าน path param **ชื่อต้องตรงกับใน path** |
| `c.req.param()` | `{ ...ทุก param }` | อ่าน param ทั้งหมดเป็น object |
| `c.req.query(name)` | `string \| undefined` | อ่าน query string (ถ้ามีหลายค่าจะได้ค่าแรก) |
| `c.req.query()` | `Record<string, string>` | อ่าน query ทั้งหมด (ค่าแรกของแต่ละ key) |
| `c.req.queries(name)` | `string[]` | อ่านทุกค่าของ key ที่ซ้ำ เช่น `?tag=a&tag=b` |
| `c.req.header(name)` | `string \| undefined` | อ่าน header (ชื่อไม่สนตัวพิมพ์เล็กใหญ่) |
| `c.req.header()` | `Record<string, string>` | อ่าน header ทั้งหมด (key เป็นตัวพิมพ์เล็ก) |
| `await c.req.json<T>()` | `T` | parse body เป็น JSON |
| `await c.req.text()` | `string` | อ่าน body เป็นข้อความ |
| `await c.req.formData()` | `FormData` | อ่าน multipart / urlencoded |
| `await c.req.arrayBuffer()` | `ArrayBuffer` | อ่าน body แบบ binary |
| `c.req.valid(target)` | type จาก schema | อ่านข้อมูลที่ `validator()` ตรวจแล้ว (ดู [Validation](#validation)) |
| `c.req.method` | `string` | `'GET'`, `'POST'`, ... |
| `c.req.path` | `string` | pathname เช่น `/users/1` |
| `c.req.url` | `string` | URL เต็ม |
| `c.req.raw` | `Request` | `Request` ตัวจริง ไว้ใช้ส่วนที่ wrapper ไม่ได้ครอบไว้ เช่น `signal` |

```ts
app.get('/users/:id', (c) => {
  c.req.param('id')       // ✅ string
  c.req.param('name')     // ❌ type error: route นี้ไม่มี param ชื่อ 'name'
  c.req.query('sort')     // string | undefined
  c.req.queries('tag')    // string[]
  c.req.header('x-api-key')
  return c.text('ok')
})
```

**อ่าน body ได้หลายครั้ง:** body จะถูกอ่านครั้งเดียวแล้ว cache ไว้ จึงเรียก `json()`, `text()`, `formData()` ซ้ำได้ ทั้งใน middleware และ handler

---

## Validation

ทุกแบบรับ schema ที่รองรับ [Standard Schema](https://standardschema.dev) เช่น **Zod ≥ 3.24**, **Valibot ≥ 1.0**, **ArkType ≥ 2.0** หรือ object ที่มี `'~standard'` ตาม spec type ที่ได้คือ **output type** ของ schema ดังนั้นถ้าใช้ `z.coerce.number()` จะได้ `number` ไม่ใช่ `string`

**target ที่ validate ได้:**

| target | ข้อมูลที่ส่งเข้า schema |
|---|---|
| `json` | body ที่ parse เป็น JSON แล้ว (ถ้า body ว่างจะเป็น `undefined` ถ้า JSON พังจะตอบ 400) |
| `form` | `multipart/form-data` / `x-www-form-urlencoded` เป็น object โดย key ที่ซ้ำจะได้เป็น array |
| `query` | query string เป็น object โดย key ที่ซ้ำจะได้เป็น array เช่น `{ tag: ['a','b'] }` |
| `param` | path params เช่น `{ id: '42' }` |
| `header` | headers ทั้งหมด (key เป็นตัวพิมพ์เล็ก) |

### แบบที่ 1: `validator()` middleware

ตรวจข้อมูล**ก่อน**เข้า handler แล้วอ่านผลด้วย `c.req.valid(target)`

```ts
import { validator } from '@sing3demons/kp'

const CreateUser = z.object({ name: z.string().min(1), email: z.email() })
const UserId = z.object({ id: z.coerce.number().int() })

app.post('/users', validator('json', CreateUser), (c) => {
  const body = c.req.valid('json')    // { name: string; email: string }
  return c.json(body, 201)
})

// ใส่หลายตัวได้ type จะรวมกันให้
app.patch(
  '/users/:id',
  validator('param', UserId),
  validator('json', CreateUser.partial()),
  (c) => {
    const { id } = c.req.valid('param')   // number
    const patch = c.req.valid('json')     // { name?: string; email?: string }
    c.req.valid('query')                  // ❌ type error: ไม่ได้ validate query
    return c.json({ id, ...patch })
  },
)
```

**ถ้าไม่ผ่าน** จะตอบ `400` ทันทีโดยไม่เข้า handler:

```json
{ "success": false, "error": [{ "message": "Invalid input", "path": ["email"], "...": "..." }] }
```

**กำหนด response เองด้วย hook** (argument ที่ 3):

```ts
validator('json', CreateUser, (result, c) => {
  if (!result.success) {
    return c.json({ message: 'ข้อมูลไม่ถูกต้อง', fields: result.issues.map((i) => i.path) }, 422)
  }
  // result.success === true → result.data ใช้ได้ ถ้าไม่ return อะไรจะไปต่อตามปกติ
})
```

hook ได้ `{ success: true, target, data }` หรือ `{ success: false, target, issues }` และ context `c` ถ้า hook return `Response` จะใช้ response นั้นแทน

**ข้อดี:** schema อยู่ที่ route จึงเห็นได้ชัดว่า route รับข้อมูลอะไร และ TypeScript เช็กให้ว่าทุก `valid()` ที่เรียกมี validator รองรับ (ใช้คู่กับ [`Ctx`](#handler-ในรูปแบบ-class-ctx) ได้ดี)

### แบบที่ 2: `c.safeXXX(schema)`

validate **ใน handler** แล้วได้ค่าที่มี type กลับมา ถ้าไม่ผ่านจะ **throw `ValidationError`** ซึ่งตอบเป็น 400

| Method | ข้อมูล | return |
|---|---|---|
| `c.safeQuery(schema)` | query string | `T` |
| `c.safeParam(schema)` | path params | `T` |
| `c.safeHeader(schema)` | headers (key ตัวพิมพ์เล็ก) | `T` |
| `c.safeBody(schema)` | JSON body | `Promise<T>` ต้อง `await` |
| `c.safeForm(schema)` | form body | `Promise<T>` ต้อง `await` |

```ts
const UserQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().default(''),
})
type IUserQuery = z.infer<typeof UserQuerySchema>

app.get('/users', (c) => {
  const query: IUserQuery = c.safeQuery(UserQuerySchema)   // { limit: number; search: string }
  return c.json(service.search(query.search, query.limit))
})

app.post('/users', async (c) => {
  const body = await c.safeBody(CreateUser)               // { name: string; email: string }
  return c.json(service.create(body), 201)
})

app.get('/secure', (c) => {
  const h = c.safeHeader(z.object({ 'x-api-key': z.string().min(10) }))
  return c.text(`key: ${h['x-api-key']}`)
})
```

- **ถ้าไม่มี `onError`:** ตอบ `400 { "success": false, "error": [...issues] }` (รูปแบบเดียวกับ `validator()`)
- **ถ้ามี `onError`:** จับ error ได้ด้วย `err instanceof ValidationError` แล้วอ่าน `err.target` (`'query'`, `'json'`, ...) และ `err.issues`
- **schema ที่เป็น async:** `safeQuery` / `safeParam` / `safeHeader` เป็น sync จึงใช้กับ async schema (เช่น `.refine(async ...)`) ไม่ได้ ถ้าส่งเข้าไปจะ throw `TypeError` บอกให้ใช้ `validator()` แทน ส่วน `safeBody` / `safeForm` รองรับ async schema

### แบบที่ 3: `c.validate(schema, data)` → `Result`

validate ข้อมูล**อะไรก็ได้**โดย**ไม่ throw** แต่ return เป็น `Result`:

```ts
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }        // E = ValidationIssues = ReadonlyArray<StandardSchemaV1.Issue>
```

```ts
app.post('/import', async (c) => {
  const result = c.validate(CreateUser, await c.req.json())

  if (!result.ok) {
    // result.error: issues  (result.value ใช้ไม่ได้ในกิ่งนี้)
    return c.json({ message: 'invalid', issues: result.error }, 422)
  }

  // หลังเช็ก ok แล้ว TypeScript รู้ว่า result.value เป็น CreateUser
  return c.json(service.create(result.value), 201)
})
```

| Function | ใช้ทำอะไร |
|---|---|
| `c.validate(schema, data)` | validate แบบ sync ถ้าส่ง async schema เข้ามาจะ throw `TypeError` |
| `c.validateAsync(schema, data)` | รองรับ async schema และ return `Promise<Result>` |
| `validate(schema, data)` / `validateAsync(schema, data)` | ฟังก์ชันเดียวกันที่ import ไปใช้นอก handler ได้ เช่นใน service หรือ worker |

```ts
import { validate, validateAsync } from '@sing3demons/kp'

// ใช้ใน service ได้ ไม่ต้องมี context
const r = validate(ConfigSchema, JSON.parse(rawConfig))
if (!r.ok) throw new Error('bad config')

// async refine เช่น เช็กกับ DB
const Unique = CreateUser.refine(async (u) => !(await db.emailExists(u.email)), 'email taken')
const r2 = await validateAsync(Unique, body)
```

### ควรใช้แบบไหน

| แบบ | ถ้าไม่ผ่าน | เหมาะกับ |
|---|---|---|
| `validator()` + `c.req.valid()` | ตอบ 400 จาก middleware ไม่เข้า handler | ประกาศ schema ไว้ที่ route ให้เห็นชัด และให้ TypeScript เช็กว่า route กับ handler ตรงกัน |
| `c.safeXXX(schema)` | throw `ValidationError` ซึ่งตอบเป็น 400 | เขียนสั้นใน handler แล้วให้ `onError` จัดการ error ที่จุดเดียว |
| `c.validate(schema, data)` | return `{ ok: false, error }` | จัดการ error เองในแต่ละจุด หรือ validate ข้อมูลที่ไม่ได้มาจาก request ตรง ๆ |

---

## Handler ในรูปแบบ class: `Ctx`

ถ้าแยก handler ไปเป็น method ของ class (controller) ให้ใช้ `Ctx` เป็น type ของ `c`:

| เขียนแบบ | ได้อะไร |
|---|---|
| `Ctx` | context ทั่วไป ไม่มี param หรือข้อมูลที่ validate แล้ว |
| `Ctx<'/:id'>` | `c.req.param('id')` มี type |
| `Ctx<{ json: CreateUser }>` | `c.req.valid('json')` เป็น `CreateUser` |
| `Ctx<'/:id', { param: { id: number } }>` | ได้ทั้งสองอย่าง |

```ts
// user.controller.ts
export class UserController {
  constructor(private readonly service: UserService) {}

  list(c: Ctx) {
    const query: IUserQuery = c.safeQuery(UserQuerySchema)
    return c.json(this.service.list(query.limit))
  }

  getById(c: Ctx<{ param: UserId }>) {
    const { id } = c.req.valid('param')
    return c.json(this.service.get(id))
  }

  create(c: Ctx<{ json: CreateUser }>) {
    return c.json(this.service.create(c.req.valid('json')), 201)
  }
}

// user.routes.ts
const user = new UserController(new UserService(new UserRepository()))

export const userRoutes = new App()
  .basePath('/api/users')
  .get('/', (c) => user.list(c))
  .get('/:id', validator('param', UserIdSchema), (c) => user.getById(c))
  .post('/', validator('json', CreateUserSchema), (c) => user.create(c))
```

**TypeScript เช็กให้ว่า route ส่งข้อมูลที่ method ต้องการมาครบ:**

```ts
.post('/', (c) => user.create(c))                                   // ❌ ลืมใส่ validator('json', ...)
.post('/', validator('json', UpdateUserSchema), (c) => user.create(c)) // ❌ ใส่ schema ผิดตัว
```

> ต้องเขียน `(c) => user.list(c)` **ไม่ใช่** `user.list` เฉย ๆ เพราะถ้าส่ง method ไปตรง ๆ `this` จะหลุด

---

## Error

### `HTTPException`

throw จากที่ไหนก็ได้ (handler, middleware, service) เพื่อหยุดการทำงานแล้วตอบด้วย HTTP status ที่ต้องการ

```ts
import { HTTPException } from '@sing3demons/kp'

throw new HTTPException(404, { message: 'user not found' })
throw new HTTPException(401, { res: new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } }) })
throw new HTTPException(500, { message: 'db failed', cause: originalError })
```

| | |
|---|---|
| `new HTTPException(status = 500, { message?, res?, cause? })` | `res` คือ response ที่จะตอบตามนั้นเลย |
| `err.status` | HTTP status |
| `err.message` | ข้อความ |
| `err.getResponse()` | ได้ `res` ถ้ามี ถ้าไม่มีจะสร้าง `Response(message, { status })` ให้ |

ถ้าไม่ได้ตั้ง `onError` จะตอบด้วย `err.getResponse()`

### `ValidationError`

เป็น subclass ของ `HTTPException` (status 400) ที่ `c.safeXXX()` throw ออกมา

| | |
|---|---|
| `err.target` | `'json' \| 'form' \| 'query' \| 'param' \| 'header'` |
| `err.issues` | `ReadonlyArray<StandardSchemaV1.Issue>` (มี `message`, `path`) |
| `err.message` | เช่น `"Invalid query"` |
| `err.getResponse()` | `400 { success: false, error: issues }` |

```ts
app.onError((err, c) => {
  if (err instanceof ValidationError) {
    return c.json({ error: err.message, field: err.target, issues: err.issues }, 400)
  }
  // ...
})
```

> ต้องเช็ก `ValidationError` **ก่อน** `HTTPException` เพราะ `ValidationError` เป็น `HTTPException` ด้วย

---

## Node adapter

ปกติใช้ `app.start()` ก็พอ แต่ถ้าต้องการควบคุม server ของ Node เอง ใช้ `@sing3demons/kp/node` ได้:

```ts
import { serve, getRequestListener } from '@sing3demons/kp/node'

// 1) เปิด server แล้วได้ http.Server กลับมา
const server = serve({ fetch: app.fetch, port: 3000, hostname: '0.0.0.0' }, (info) => {
  console.log(`listening on ${info.port}`)
})

// 2) ใช้กับ http.createServer / https / framework อื่นที่รับ (req, res)
import { createServer } from 'node:https'
createServer(tlsOptions, getRequestListener(app.fetch)).listen(443)
```

adapter แปลง `IncomingMessage` เป็น `Request` และ `Response` กลับเป็น `ServerResponse` ให้:
- **response body:** ส่งแบบ stream และรอ `drain` เมื่อ buffer เต็ม (backpressure)
- **`set-cookie`:** ส่งได้หลายค่า
- **client ปิดการเชื่อมต่อ:** abort `c.req.raw.signal` ให้
- **handler throw error ที่ไม่ได้จับ:** ตอบ 500

---

## Types ที่ export

| Type | ใช้ทำอะไร |
|---|---|
| `Ctx<A?, B?>` | type ของ context สำหรับ handler ที่แยกออกไป (ดู [Ctx](#handler-ในรูปแบบ-class-ctx)) |
| `Context<P, I>` | class ของ context ตัวเต็ม (`P` = path, `I` = ข้อมูลที่ validate แล้ว) |
| `Handler<P, I>` | `(c) => Response \| Promise<Response>` |
| `MiddlewareHandler<P, I>` | `(c, next) => Response \| void \| Promise<...>` |
| `Next` | `() => Promise<void>` |
| `ErrorHandler` / `NotFoundHandler` | type ของ handler ใน `onError` / `notFound` |
| `Plugin` | `(app: App) => void` สำหรับ `register()` |
| `StartOptions`, `ServerInfo`, `RunningServer` | type ของ `start()` |
| `ParamKeys<'/a/:x/:y'>` | `'x' \| 'y'` |
| `Params<'/a/:x/:y?'>` | `{ x: string; y?: string }` |
| `Result<T, E>`, `ValidationIssues` | ผลของ `validate()` |
| `ValidationTarget`, `ValidationTargets` | `'json' \| 'form' \| 'query' \| 'param' \| 'header'` และรูปแบบข้อมูลดิบของแต่ละ target |
| `StandardSchemaV1` | interface ของ Standard Schema |
| `Method` | `'GET' \| 'POST' \| ...` |

ตัวอย่าง middleware ที่นำไปใช้ซ้ำได้:

```ts
import type { MiddlewareHandler } from '@sing3demons/kp'

export const requireApiKey = (key: string): MiddlewareHandler => async (c, next) => {
  if (c.req.header('x-api-key') !== key) return c.json({ error: 'forbidden' }, 403)
  await next()
}
```

---

## พฤติกรรมที่ควรรู้

- **ลำดับ middleware:** ทุก middleware ที่ประกาศด้วย `use()` และ path ตรงจะรัน**ก่อน** route handler เสมอ (เรียงตามลำดับที่ลงทะเบียน) ไม่ว่าจะลงทะเบียนก่อนหรือหลัง route ก็ตาม
- **middleware รันกับ 404 ด้วย:** เช่น logger จะเห็น request ที่หา route ไม่เจอด้วย
- **path ตรงแต่ method ไม่ตรง:** ตอบ `404` ไม่ใช่ `405`
- **`HEAD`:** ใช้ handler ของ `GET` แล้วตัด body ทิ้งให้อัตโนมัติ
- **trailing slash ไม่มีผล:** `/users/` กับ `/users` match route เดียวกัน
- **type inference ของ middleware:** inference รองรับ validator หรือ middleware ได้สูงสุด **5 ตัว** ต่อ route ถ้าเกินนั้นให้รวม middleware เป็นตัวเดียวก่อน
- **`content-type` ของ FormData บน Bun:** Bun ทำค่านี้หายหลังอ่าน body แล้ว lib แก้ไว้แล้วด้วยการเก็บค่าตั้งแต่ตอนสร้าง request
- **ใช้กับ Node โดยตรง:** source ของ lib เขียนด้วย syntax ที่ลบ type ทิ้งได้ (`erasableSyntaxOnly`) Node ≥ 22.18 (หรือ ≥ 23.6) จึงรันไฟล์ `.ts` ของ lib ได้โดยไม่ต้อง build ส่วนโค้ดของโปรเจกต์คุณ ถ้าใช้ syntax อย่าง `constructor(private x)` หรือ `enum` ต้องรันด้วย Bun, `tsx` หรือ build ก่อน

---

## ตัวอย่างโปรเจกต์

ดูตัวอย่างเต็มได้ที่ [`examples/`](examples/) มี 2 app ที่โครงสร้างเหมือนกัน:

| | runtime | รัน | test |
|---|---|---|---|
| [`examples/bun-app`](examples/bun-app) | Bun | `bun run dev` | `bun test` |
| [`examples/node-app`](examples/node-app) | Node + tsx | `npm run dev` | `npm test` (`node:test`) |

```
src/
├── main.ts                    # new App() → use / onError / register(userRoutes) → start()
├── config.ts
├── lib/kp.ts                  # จุด import framework จุดเดียว
├── middleware/
│   ├── logger.ts
│   └── error.ts               # errorHandler (HTTPException / ValidationError) + notFoundHandler
└── modules/users/
    ├── user.schema.ts         # zod schemas + types
    ├── user.repository.ts     # data access
    ├── user.service.ts        # business logic + throw HTTPException
    ├── user.controller.ts     # method ละ endpoint ใช้ Ctx<...> และ safeQuery
    ├── user.routes.ts         # route + validator + controller → userRoutes
    └── index.ts
```

จาก root ของ repo:

```sh
bun run example:bun      # examples/bun-app
bun run example:node     # examples/node-app (tsx)
```

---

## พัฒนา lib นี้

```sh
bun install
bun test               # runtime tests (router, app, validator, route groups, safe/validate, start)
bun run typecheck      # tsc: src + test (รวม type tests ใน test/types.test-d.ts) + examples
bun run build          # สร้าง dist/ (.js + .d.ts)
bun run test:node-app  # test ของ node-app ด้วย node:test
```

```
src/
├── index.ts            # public exports
├── app.ts              # App: routing, middleware, register/route/basePath, start, fetch
├── context.ts          # Context: response helpers, safeXXX, validate
├── request.ts          # TypedRequest: param/query/header/body (cached)/valid
├── router.ts           # trie router (static > param > wildcard, backtracking)
├── compose.ts          # middleware chain (Koa-style)
├── validator.ts        # validator() middleware
├── validation.ts       # อ่าน target, ValidationError, validate/validateAsync, Result
├── http-exception.ts   # HTTPException
├── standard-schema.ts  # Standard Schema V1 interface (vendored)
├── types.ts            # Params/ParamKeys/Ctx/Handler/... types
└── adapter/node.ts     # serve() / getRequestListener() สำหรับ node:http
```

### Publish เวอร์ชันใหม่ขึ้น GitHub Packages

ต้องมี classic token ที่มี scope **`write:packages`** (และ `repo` ถ้า repo เป็น private) ตั้งไว้ใน `~/.npmrc`:

```ini
@sing3demons:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=ghp_xxxxxxxxxxxxxxxxxxxx
```

จากนั้น:

```sh
npm version patch        # หรือ minor / major: แก้ version ใน package.json และสร้าง git tag
npm publish              # prepublishOnly จะรัน test + typecheck + build ก่อน
git push --follow-tags
```

`publishConfig.registry` ใน `package.json` ชี้ไป `https://npm.pkg.github.com/` อยู่แล้ว จึงไม่มีทางหลุดไป publish บน npmjs.com และ `repository` จะผูกแพ็กเกจเข้ากับ repo `sing3demons/ts-common-kp` บน GitHub ระดับการมองเห็น (public/private) ของแพ็กเกจจะตาม repo

ถ้าจะลองแพ็กเกจก่อน publish ให้ใช้ `npm pack` แล้วติดตั้งไฟล์ `.tgz` ที่ได้ในโปรเจกต์ทดสอบ
