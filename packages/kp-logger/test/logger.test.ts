import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { App, HTTPException, ValidationError } from '@sing3demons/kp'
import { createLogger, loadLoggerConfig, maskData, type AppLoggerOptions, type LogRecord } from '../src/index.ts'
import { formatLogfmt, formatText } from '../src/format.ts'
import { parseTraceparent, sanitizeId, uuidv7 } from '../src/ids.ts'
import { readAppInfo, resolveLoggerOptions } from '../src/config.ts'

const fixture = new URL('./fixtures/logger.yaml', import.meta.url)

/** App with a capturing sink. service/version disabled so records stay small. */
const setup = (options: AppLoggerOptions = {}) => {
  const records: LogRecord[] = []
  const lines: string[] = []
  const app = new App().logger({
    service: false,
    version: false,
    ...options,
    sink: (line, record) => {
      lines.push(line)
      records.push(record)
    },
  })
  const detail = () => records.filter((r) => r.type === 'detail')
  const summary = () => records.filter((r) => r.type === 'summary')
  return { app, records, lines, detail, summary }
}

describe('ids', () => {
  test('uuidv7 format and time ordering', async () => {
    const a = uuidv7()
    await new Promise((r) => setTimeout(r, 2))
    const b = uuidv7()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a < b).toBe(true)
    const ts = parseInt(a.replace(/-/g, '').slice(0, 12), 16)
    expect(Math.abs(Date.now() - ts)).toBeLessThan(1000)
  })

  test('sanitizeId rejects unsafe values', () => {
    expect(sanitizeId('abc-1_2.3:4')).toBe('abc-1_2.3:4')
    expect(sanitizeId('a b')).toBeUndefined()
    expect(sanitizeId('a\nb')).toBeUndefined()
    expect(sanitizeId('x'.repeat(129))).toBeUndefined()
    expect(sanitizeId('')).toBeUndefined()
  })

  test('parseTraceparent', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentId: '00f067aa0ba902b7',
      flags: '01',
    })
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeUndefined()
    expect(parseTraceparent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeUndefined()
    expect(parseTraceparent('garbage')).toBeUndefined()
  })

  test('request / correlation ids from headers, generated otherwise, echoed on the response', async () => {
    const { app, records } = setup()
    app.get('/', (c) => c.info('hi').json({ rid: c.requestId, cid: c.correlationId }))

    let res = await app.request('/', { headers: { 'x-request-id': 'req-1', 'x-correlation-id': 'corr-1' } })
    expect(await res.json()).toEqual({ rid: 'req-1', cid: 'corr-1' })
    expect(res.headers.get('x-request-id')).toBe('req-1')
    expect(res.headers.get('x-correlation-id')).toBe('corr-1')
    for (const r of records) expect([r.correlation_id, r.request_id]).toEqual(['corr-1', 'req-1'])

    records.length = 0
    res = await app.request('/', { headers: { 'x-request-id': 'bad id\n', 'x-correlation-id': 'y'.repeat(200) } })
    const body = (await res.json()) as { rid: string; cid: string }
    expect(body.rid).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.cid).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.rid).not.toBe(body.cid)
    expect(records[0]!.request_id).toBe(body.rid)
  })

  test('traceparent → trace_id / span_id and propagationHeaders()', async () => {
    const { app, records } = setup()
    let headers: Record<string, string> = {}
    app.get('/', (c) => {
      headers = c.log().propagationHeaders()
      return c.text('ok')
    })
    await app.request('/', {
      headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', 'x-request-id': 'r1' },
    })
    const s = records[0]!
    expect(s.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(s.span_id).toMatch(/^[0-9a-f]{16}$/)
    expect(headers['x-correlation-id']).toBe(s.correlation_id as string)
    expect(headers.traceparent).toBe(`00-4bf92f3577b34da6a3ce929d0e0e4736-${s.span_id}-01`)
    expect(headers['x-request-id']).toBeUndefined()

    records.length = 0
    await app.request('/', { headers: { traceparent: 'nope' } })
    expect('trace_id' in records[0]!).toBe(false)
    expect(headers.traceparent).toBeUndefined()
  })

  test('generator option: uuidv4 and custom function; genId uses it', async () => {
    let n = 0
    const { app, records } = setup({ ids: { generator: () => `id-${++n}` } })
    app.get('/', (c) => c.json({ gen: c.genId() }))
    const res = await app.request('/')
    expect(await res.json()).toEqual({ gen: 'id-3' })
    expect([records[0]!.correlation_id, records[0]!.request_id]).toEqual(['id-1', 'id-2'])

    const v4 = setup({ ids: { generator: 'uuidv4' } })
    v4.app.get('/', (c) => c.text('ok'))
    await v4.app.request('/')
    expect(v4.records[0]!.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/)
  })

  test('custom header names', async () => {
    const { app } = setup({ ids: { request: { header: 'X-Trace-Req' } } })
    app.get('/', (c) => c.text(c.requestId ?? ''))
    const res = await app.request('/', { headers: { 'x-trace-req': 'abc' } })
    expect(await res.text()).toBe('abc')
    expect(res.headers.get('x-trace-req')).toBe('abc')
  })
})

describe('detail records', () => {
  test('action + message string; data only when enabled', async () => {
    const { app, detail } = setup({ level: 'debug' })
    app.get('/', (c) => {
      c.info('obj', { id: 1 }).info('str', 'hello').info('num', 42).info('none').debug('err', new Error('bad'))
      return c.text('ok')
    })
    await app.request('/')
    const d = detail()
    expect(d.map((r) => [r.action, r.message])).toEqual([
      ['obj', '{"id":1}'],
      ['str', 'hello'],
      ['num', '42'],
      ['none', ''],
      ['err', expect.stringContaining('"message":"bad"')],
    ])
    expect(d.every((r) => !('data' in r))).toBe(true)

    const on = setup({ detail: { data: true } })
    on.app.get('/', (c) => c.info('obj', { id: 1 }).text('ok'))
    await on.app.request('/')
    expect(on.detail()[0]!.data).toEqual({ id: 1 })
  })

  test('level filter applies to detail only', async () => {
    const { app, detail, summary } = setup({ level: 'warn' })
    app.get('/', (c) => c.debug('d').info('i').warn('w').error('e').text('ok'))
    await app.request('/')
    expect(detail().map((r) => r.level)).toEqual(['warn', 'error'])
    expect(summary()).toHaveLength(1)

    const silent = setup({ level: 'silent' })
    silent.app.get('/', (c) => c.error('e').text('ok'))
    await silent.app.request('/')
    expect(silent.records).toHaveLength(0)
  })

  test('c.log() chaining returns the logger, c.info returns the context', async () => {
    const { app, detail } = setup()
    app.get('/', (c) => {
      c.log().info('a').warn('b')
      return c.info('c').text('ok')
    })
    await app.request('/')
    expect(detail().map((r) => r.action)).toEqual(['a', 'b', 'c'])
  })

  test('field order', async () => {
    const { app, detail } = setup({ service: 'svc', version: '1.0.0', detail: { data: true } })
    app.get('/', (c) => {
      c.log().update('user_id', 1)
      c.addDetailAdditionalInfo('k', 'v')
      c.setDependency({ dependency: 'db', desc: 'q', resultCode: 0, dependencyId: 'd1' }).info('x', { a: 1 })
      return c.text('ok')
    })
    await app.request('/')
    expect(Object.keys(detail()[0]!)).toEqual([
      'time',
      'level',
      'type',
      'service',
      'version',
      'correlation_id',
      'request_id',
      'user_id',
      'dependency',
      'desc',
      'result_code',
      'dependency_id',
      'action',
      'message',
      'data',
      'additional_info',
    ])
  })
})

describe('summary', () => {
  test('auto-flush once per request with standard fields', async () => {
    const { app, summary } = setup()
    app.get('/users/:id', (c) => c.json({}, 201))
    await app.request('/users/1')
    const [s] = summary()
    expect(summary()).toHaveLength(1)
    expect(s).toMatchObject({
      level: 'info',
      method: 'GET',
      path: '/users/1',
      status: 201,
      app_result: 'success',
      app_result_code: '201',
    })
    expect(typeof s!.duration_ms).toBe('number')
  })

  test('flush() twice writes once; addSummary after flush is ignored; options override app_result', async () => {
    const { app, summary } = setup()
    app.get('/', (c) => {
      c.addSummary('a', 1)
      c.flush({ appResult: 'error', appResultCode: 40001 })
      c.addSummary('b', 2).flush()
      return c.text('ok')
    })
    await app.request('/')
    expect(summary()).toHaveLength(1)
    expect(summary()[0]).toMatchObject({ status: 200, a: 1, app_result: 'error', app_result_code: '40001' })
    expect('b' in summary()[0]!).toBe(false)
  })

  test('flushError() → error level, error field, forced app_result=error', async () => {
    const { app, summary } = setup()
    app.get('/', (c) => {
      c.flushError(new Error('db down'), { appResultCode: '50001' })
      return c.json({ ok: false }, 200)
    })
    await app.request('/')
    expect(summary()[0]).toMatchObject({
      level: 'error',
      status: 200,
      app_result: 'error',
      app_result_code: '50001',
      error: { name: 'Error', message: 'db down' },
    })
  })

  test('thrown errors: status from onError, level from status', async () => {
    const { app, summary } = setup()
    app.onError((err, c) =>
      err instanceof ValidationError ? c.json({}, 400) : err instanceof HTTPException ? err.getResponse() : c.text('x', 500),
    )
    app.get('/403', () => {
      throw new HTTPException(403, { message: 'nope' })
    })
    app.get('/400', () => {
      throw new ValidationError('query', [])
    })
    app.get('/500', () => {
      throw new Error('boom')
    })
    for (const p of ['/403', '/400', '/500']) {
      const res = await app.request(p)
      expect(res.headers.get('x-request-id')).toBeTruthy()
    }
    expect(summary().map((s) => [s.status, s.level, s.app_result, (s.error as { message: string }).message])).toEqual([
      [403, 'warn', 'error', 'nope'],
      [400, 'warn', 'error', expect.any(String)],
      [500, 'error', 'error', 'boom'],
    ])
  })

  test('404 is an error result at warn level', async () => {
    const { app, summary } = setup()
    await app.request('/missing')
    expect(summary()[0]).toMatchObject({ status: 404, level: 'warn', app_result: 'error', app_result_code: '404' })
  })

  test('skip paths: ids and detail, no summary', async () => {
    const { app, detail, summary } = setup({ skip: ['/health', '/metrics/*'] })
    app.get('/health', (c) => c.info('h').text('ok'))
    app.get('/metrics/cpu', (c) => c.text('ok'))
    const res = await app.request('/health')
    await app.request('/metrics/cpu')
    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(detail()).toHaveLength(1)
    expect(summary()).toHaveLength(0)
  })

  test('logger wraps middleware registered before app.logger()', async () => {
    const records: LogRecord[] = []
    const app = new App()
      .use((c) => c.text('blocked', 401))
      .logger({ service: false, version: false, sink: (_, r) => records.push(r) })
    const res = await app.request('/')
    expect(records.map((r) => [r.type, r.status])).toEqual([['summary', 401]])
    expect(res.headers.get('x-request-id')).toBe(records[0]!.request_id as string)
  })

  test('response with immutable headers still gets id headers', async () => {
    const { app } = setup()
    // Response.redirect() has immutable headers per the Fetch spec.
    app.get('/', () => Response.redirect('http://example.com/', 302))
    const res = await app.request('/')
    expect(res.status).toBe(302)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })
})

describe('additional_info and update()', () => {
  test('detail additional_info sticks to later lines; undefined removes; clear empties', async () => {
    const { app, detail } = setup()
    app.get('/', (c) => {
      c.info('0')
      c.addDetailAdditionalInfo('a', 1).addDetailAdditionalInfo('b', 2).info('1')
      c.addDetailAdditionalInfo('a', undefined).info('2')
      c.clearDetailAdditionalInfo().info('3')
      return c.text('ok')
    })
    await app.request('/')
    expect(detail().map((r) => r.additional_info)).toEqual([undefined, { a: 1, b: 2 }, { b: 2 }, undefined])
  })

  test('summary additional_info is separate from detail and from addSummary', async () => {
    const { app, summary } = setup()
    app.get('/', (c) => {
      c.addDetailAdditionalInfo('d', 1)
      c.addSummary('top', 1)
      c.addSummaryAdditionalInfo('x', 1).addSummaryAdditionalInfo('y', 2).addSummaryAdditionalInfo('x', undefined)
      return c.text('ok')
    })
    await app.request('/')
    expect(summary()[0]).toMatchObject({ top: 1, additional_info: { y: 2 } })

    const cleared = setup()
    cleared.app.get('/', (c) => c.addSummaryAdditionalInfo('x', 1).clearSummaryAdditionalInfo().text('ok'))
    await cleared.app.request('/')
    expect('additional_info' in cleared.summary()[0]!).toBe(false)
  })

  test('update(): later detail + summary, removable, reserved keys throw, addSummary wins', async () => {
    const { app, detail, summary } = setup()
    app.get('/', (c) => {
      c.info('before')
      c.log().update('user_id', 7).update('tmp', 1)
      c.info('after')
      c.log().update('tmp', undefined)
      c.addSummary('user_id', 8)
      expect(() => c.log().update('status', 1)).toThrow(/reserved/)
      expect(() => c.addSummary('request_id', 1)).toThrow(/reserved/)
      return c.text('ok')
    })
    await app.request('/')
    expect(detail().map((r) => [r.user_id, r.tmp])).toEqual([
      [undefined, undefined],
      [7, 1],
    ])
    expect(summary()[0]!.user_id).toBe(8)
    expect('tmp' in summary()[0]!).toBe(false)
  })
})

describe('setDependency', () => {
  test('fields on the next line only; summary merges entries by dependencyId', async () => {
    const { app, detail, summary } = setup()
    app.get('/', (c) => {
      const id = c.genId()
      c.setDependency({ dependency: 'mysql', dependencyId: id }).info('db_request').info('plain')
      c.setDependency({ dependency: 'mysql', desc: 'select user', resultCode: 20000, dependencyId: id }).info('db_response')
      c.setDependency({ dependency: 'otp' }).info('a')
      c.setDependency({ dependency: 'otp' }).info('b')
      return c.text('ok')
    })
    await app.request('/')
    const d = detail()
    expect(d[0]).toMatchObject({ dependency: 'mysql', action: 'db_request' })
    expect('desc' in d[0]!).toBe(false)
    expect('dependency' in d[1]!).toBe(false)
    expect(d[2]).toMatchObject({ dependency: 'mysql', desc: 'select user', result_code: '20000', action: 'db_response' })
    expect(d[0]!.dependency_id).toBe(d[2]!.dependency_id as string)

    const deps = summary()[0]!.dependencies as Record<string, unknown>[]
    expect(deps).toEqual([
      { dependency: 'mysql', desc: 'select user', result_code: '20000', dependency_id: d[0]!.dependency_id },
      { dependency: 'otp' },
      { dependency: 'otp' },
    ])
    expect(Object.keys(deps[0]!)).toEqual(['dependency', 'desc', 'result_code', 'dependency_id'])
  })

  test('recorded in summary even when the detail level is filtered; not after flush', async () => {
    const { app, detail, summary } = setup({ level: 'error' })
    app.get('/', (c) => {
      c.setDependency({ dependency: 'a' }).info('x')
      c.flush()
      c.setDependency({ dependency: 'b' }).error('y')
      return c.text('ok')
    })
    await app.request('/')
    expect(detail().map((r) => r.dependency)).toEqual(['b'])
    expect(summary()[0]!.dependencies).toEqual([{ dependency: 'a' }])
  })

  test('validation', () => {
    const log = createLogger({ sink: () => {} })
    expect(() => log.setDependency({ dependency: '' })).toThrow(/dependency/)
    expect(() => log.setDependency({ dependency: 'x', dependencyId: 'has space' })).toThrow(/dependencyId/)
  })
})

describe('masking', () => {
  test('paths: wildcard, index, nested; input untouched', () => {
    const input = {
      body: [
        { password: 'p1', phone: '0812345678' },
        { password: 'p2', phone: '0899999999' },
      ],
      user: { profile: { email: 'john@x.com' } },
    }
    const out = maskData(input, [
      { field: 'body.*.password', pattern: 'full' },
      { field: 'body.[0].phone', pattern: 'custom', regex: '\\d(?=\\d{4})', replacement: '*' },
      { field: 'user.profile.email', pattern: 'email' },
    ])
    expect(out).toEqual({
      body: [
        { password: '****', phone: '******5678' },
        { password: '****', phone: '0899999999' },
      ],
      user: { profile: { email: 'j***@x.com' } },
    })
    expect(input.body[0]!.password).toBe('p1')
    expect(maskData<unknown>({ a: [{ k: 1 }, { k: 2 }] }, [{ field: 'a[1].k', pattern: 'X' }])).toEqual({
      a: [{ k: 1 }, { k: 'X' }],
    })
  })

  test('presets and literal replacement', () => {
    const m = (pattern: string, v: unknown) => maskData({ v }, [{ field: 'v', pattern }]).v
    expect(m('full', 'secret')).toBe('****')
    expect(m('last4', '4111111111111111')).toBe('************1111')
    expect(m('first4', '0812345678')).toBe('0812******')
    expect(m('card', '4111111111111111')).toBe('411111******1111')
    expect(m('email', 'john@x.com')).toBe('j***@x.com')
    expect(m('email', 'nope')).toBe('****')
    expect(m('last4', '123')).toBe('***')
    expect(m('full', { deep: 1 })).toBe('****')
    expect(m('[hidden]', 'x')).toBe('[hidden]')
    expect(() => maskData({}, [{ field: 'v', pattern: 'custom' }])).toThrow(/regex/)
  })

  test('config masks + per-call masks apply to message, data, additional_info and summary', async () => {
    const { app, detail, summary } = setup({
      detail: { data: true },
      masks: [{ field: 'password', pattern: 'full' }],
    })
    app.post('/', (c) => {
      c.addDetailAdditionalInfo('password', 'x')
      c.maskInfo([{ field: 'card', pattern: 'last4' }], 'login', { password: 'p', card: '4111111111111111' })
      c.addSummary('password', 'y').addSummaryAdditionalInfo('password', 'z')
      return c.text('ok')
    })
    await app.request('/', { method: 'POST' })
    const d = detail()[0]!
    expect(d.data).toEqual({ password: '****', card: '************1111' })
    expect(d.message).toBe('{"password":"****","card":"************1111"}')
    expect(d.additional_info).toEqual({ password: '****' })
    expect(summary()[0]).toMatchObject({ password: '****', additional_info: { password: '****' } })
  })
})

describe('formats', () => {
  const record: LogRecord = {
    time: '2026-01-01T00:00:00.000Z',
    level: 'info',
    type: 'detail',
    request_id: 'r1',
    action: 'validate ok',
    message: '{"id":1}',
    n: 1,
    empty: '',
    nested: { a: 'b c' },
  }

  test('logfmt quoting', () => {
    expect(formatLogfmt(record)).toBe(
      'time=2026-01-01T00:00:00.000Z level=info type=detail request_id=r1 action="validate ok" message="{\\"id\\":1}" n=1 empty="" nested="{\\"a\\":\\"b c\\"}"',
    )
    expect(formatLogfmt({ ...record, action: 'line\nbreak' })).toContain('action="line\\nbreak"')
  })

  test('text', () => {
    expect(formatText(record)).toBe(
      '2026-01-01T00:00:00.000Z INFO  [detail]  validate ok {"id":1} n=1 empty="" nested="{\\"a\\":\\"b c\\"}" request_id=r1',
    )
    expect(
      formatText({
        time: 't',
        level: 'warn',
        type: 'summary',
        request_id: 'r1',
        method: 'GET',
        path: '/x',
        status: 404,
        duration_ms: 1.5,
        app_result: 'error',
        app_result_code: '404',
        user_id: 1,
      }),
    ).toBe('t WARN  [summary] GET /x 404 1.5ms error 404 user_id=1 request_id=r1')
  })

  test('format option selects the formatter', async () => {
    for (const [format, check] of [
      ['json', (l: string) => JSON.parse(l).type === 'summary'],
      ['logfmt', (l: string) => l.includes('type=summary')],
      ['text', (l: string) => l.includes('[summary]')],
    ] as const) {
      const { app, lines } = setup({ format })
      app.get('/', (c) => c.text('ok'))
      await app.request('/')
      expect(check(lines[0]!)).toBe(true)
    }
  })
})

describe('config', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env.LOG_LEVEL = env.LOG_LEVEL
    process.env.LOG_FORMAT = env.LOG_FORMAT
    if (env.LOG_LEVEL === undefined) delete process.env.LOG_LEVEL
    if (env.LOG_FORMAT === undefined) delete process.env.LOG_FORMAT
  })

  test('loadLoggerConfig reads and normalizes YAML', async () => {
    const o = await loadLoggerConfig(fixture)
    expect(o).toMatchObject({
      service: 'fixture-service',
      version: '2',
      level: 'debug',
      format: 'logfmt',
      skip: ['/health'],
      ids: { generator: 'uuidv4', request: { header: 'x-req-id' } },
      detail: { data: true },
    })
    expect(o.masks).toHaveLength(2)
  })

  test('app.logger({ path }) uses the file; code options override; env overrides the file', async () => {
    const lines: string[] = []
    const sink = (l: string) => lines.push(l)
    const app = new App().logger({ path: fixture, format: 'json', sink })
    app.get('/', (c) => c.info('x', { password: 'p', phone: '0812345678' }).text('ok'))
    const res = await app.request('/', { headers: { 'x-req-id': 'from-header' } })
    expect(res.headers.get('x-req-id')).toBe('from-header')
    const d = JSON.parse(lines[0]!)
    expect(d).toMatchObject({ service: 'fixture-service', version: '2', request_id: 'from-header' })
    expect(d.data).toEqual({ password: '****', phone: '######5678' })

    process.env.LOG_LEVEL = 'error'
    const opts = await resolveLoggerOptions({ path: fixture })
    expect(opts.level).toBe('error')
    expect((await resolveLoggerOptions({ path: fixture, level: 'warn' })).level).toBe('warn')
  })

  test('invalid config rejects start() with a clear message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kp-logger-'))
    try {
      const file = join(dir, 'bad.yaml')
      writeFileSync(file, 'level: loud\n')
      await expect(new App().logger({ path: file }).start({ port: 0 })).rejects.toThrow(/"level" must be one of/)
      writeFileSync(file, 'levle: info\n')
      await expect(loadLoggerConfig(file)).rejects.toThrow(/unknown key "levle"/)
      writeFileSync(file, 'masks:\n  - field: a\n    pattern: custom\n')
      await expect(loadLoggerConfig(file)).rejects.toThrow(/requires "regex"/)
      await expect(loadLoggerConfig(join(dir, 'missing.yaml'))).rejects.toThrow(/cannot read file/)
      process.env.LOG_FORMAT = 'xml'
      await expect(resolveLoggerOptions({})).rejects.toThrow(/env/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('service / version: option > yaml > package.json; false omits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kp-logger-'))
    const cwd = process.cwd()
    try {
      expect(await readAppInfo(dir)).toEqual({})
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-app', version: '3.1.4' }))
      expect(await readAppInfo(dir)).toEqual({ name: 'my-app', version: '3.1.4' })
      process.chdir(dir)
      expect(await resolveLoggerOptions({})).toMatchObject({ service: 'my-app', version: '3.1.4' })
      expect(await resolveLoggerOptions({ path: fixture })).toMatchObject({ service: 'fixture-service', version: '2' })
      expect(await resolveLoggerOptions({ path: fixture, version: '9' })).toMatchObject({ version: '9' })
      const off = await resolveLoggerOptions({ service: false, version: false })
      expect([off.service, off.version]).toEqual([false, false])
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('without app.logger()', () => {
  test('createLogger() works outside a request', () => {
    const records: LogRecord[] = []
    const log = createLogger({ sink: (_, r) => records.push(r) })
    log.info('a').addSummary('k', 1).flush().flush()
    expect(records.map((r) => r.type)).toEqual(['detail', 'summary'])
    expect(records[1]).toMatchObject({ k: 1, app_result: 'success' })
  })

  test('installed but app.logger() not called: log methods throw (type errors when not installed, see test/no-logger in the core package)', async () => {
    const app = new App().onError((err, c) => c.text(err.message, 500))
    app.get('/', (c) => {
      c.info('x')
      return c.text('ok')
    })
    app.get('/id', (c) => c.json({ id: c.requestId ?? null }))
    const res = await app.request('/')
    expect(res.status).toBe(500)
    expect(await res.text()).toContain('logger is not enabled')
    expect(await (await app.request('/id')).json()).toEqual({ id: null })
  })
})
