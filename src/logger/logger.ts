import { compileMatcher } from '../router.ts'
import { formatters, type Formatter } from './format.ts'
import { newSpanId, parseTraceparent, sanitizeId, uuidv4, uuidv7 } from './ids.ts'
import { applyMasks, compileMasks, serializeError, toPlain, type CompiledMask } from './mask.ts'
import { validateLoggerOptions } from './options.ts'
import type {
  DependencyInfo,
  FlushErrorOptions,
  FlushOptions,
  LoggerOptions,
  LogLevel,
  LogRecord,
  MaskRule,
  Sink,
} from './types.ts'

type Obj = Record<string, unknown>

const LEVEL_VALUE: Record<LogLevel | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
}

/** Keys `update()` / `addSummary()` may not use: they belong to the record format itself. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'time',
  'level',
  'type',
  'service',
  'version',
  'correlation_id',
  'request_id',
  'trace_id',
  'span_id',
  'action',
  'message',
  'data',
  'method',
  'path',
  'status',
  'duration_ms',
  'app_result',
  'app_result_code',
  'dependency',
  'desc',
  'result_code',
  'dependency_id',
  'dependencies',
  'additional_info',
  'error',
])

const defaultSink: Sink = (line) => {
  const out = (globalThis as { process?: { stdout?: { write?: (s: string) => unknown } } }).process?.stdout
  if (out?.write) out.write(line + '\n')
  else console.log(line)
}

// ---------------------------------------------------------------------------
// Shared config (one per logger created with options)
// ---------------------------------------------------------------------------

interface Core {
  min: number
  format: Formatter
  sink: Sink
  masks: CompiledMask[]
  base: Obj
  detailData: boolean
  generate: () => string
  requestHeader: string
  correlationHeader: string
  trace: boolean
  skip: ((path: string) => boolean)[]
}

const buildCore = (raw: LoggerOptions): Core => {
  const o = validateLoggerOptions(raw, 'options')
  const gen = o.ids?.generator ?? 'uuidv7'
  const base: Obj = {}
  if (o.service) base.service = o.service
  if (o.version) base.version = o.version
  return {
    min: LEVEL_VALUE[o.level ?? 'info'],
    format: formatters[o.format ?? 'json'],
    sink: o.sink ?? defaultSink,
    masks: compileMasks(o.masks ?? []),
    base,
    detailData: o.detail?.data ?? false,
    generate: typeof gen === 'function' ? gen : gen === 'uuidv4' ? uuidv4 : uuidv7,
    requestHeader: o.ids?.request?.header ?? 'x-request-id',
    correlationHeader: o.ids?.correlation?.header ?? 'x-correlation-id',
    trace: o.ids?.trace ?? true,
    skip: (o.skip ?? []).map(compileMatcher),
  }
}

// ---------------------------------------------------------------------------
// Per-request state (shared by every Logger handed out for one request)
// ---------------------------------------------------------------------------

interface DependencyEntry {
  dependency: string
  desc?: string
  result_code?: string
  dependency_id?: string
}

interface SummaryState {
  /** false for skipped paths: summary is never written. */
  enabled: boolean
  /** true inside a request: the line is written when the request ends (status known). */
  deferred: boolean
  method?: string
  path?: string
  start: number
  fields: Obj
  info: Obj
  dependencies: DependencyEntry[]
  /** dependency_id → index in `dependencies`. */
  byId: Map<string, number>
  flushed: boolean
  written: boolean
  hasError: boolean
  /** true when the app called flushError() itself (always level=error). */
  explicitError: boolean
  error?: unknown
  appResult?: 'success' | 'error'
  appResultCode?: string
}

interface State {
  ids: Obj
  trace?: { traceId: string; flags: string }
  fields: Obj
  detailInfo: Obj
  summary: SummaryState
}

const newSummary = (deferred: boolean, enabled = true, method?: string, path?: string): SummaryState => ({
  enabled,
  deferred,
  method,
  path,
  start: performance.now(),
  fields: {},
  info: {},
  dependencies: [],
  byId: new Map(),
  flushed: false,
  written: false,
  hasError: false,
  explicitError: false,
})

/** Same key order for every dependency entry, however it was assembled. */
const canonical = (d: DependencyEntry): DependencyEntry => {
  const out: DependencyEntry = { dependency: d.dependency }
  if (d.desc !== undefined) out.desc = d.desc
  if (d.result_code !== undefined) out.result_code = d.result_code
  if (d.dependency_id !== undefined) out.dependency_id = d.dependency_id
  return out
}

const newState = (summary: SummaryState, ids: Obj = {}): State => ({
  ids,
  fields: {},
  detailInfo: {},
  summary,
})

/** Set `key` (or delete it when `value` is undefined) on a plain bag. */
const put = (bag: Obj, key: string, value: unknown): void => {
  if (value === undefined) delete bag[key]
  else bag[key] = toPlain(value)
}

const reserved = (key: string, method: string): void => {
  if (RESERVED_KEYS.has(key)) throw new Error(`${method}: "${key}" is a reserved log field`)
}

const toMessage = (data: unknown): string => {
  if (data === undefined) return ''
  if (typeof data === 'string') return data
  if (data === null || typeof data !== 'object') return String(data)
  return JSON.stringify(data)
}

const round = (ms: number) => Math.round(ms * 10) / 10

interface Init {
  core: Core
  state: State
  parent?: Logger
  dep?: DependencyEntry
}
let pendingInit: Init | undefined

/**
 * Structured logger with two record types:
 * - **detail**: written on every `debug/info/warn/error` call.
 * - **summary**: one line per request, written by `flush()` / `flushError()` (or automatically).
 */
export class Logger {
  readonly #core: Core
  readonly #state: State
  /** Set on loggers returned by `setDependency()`: writing returns to the parent. */
  readonly #parent: Logger | undefined
  readonly #dep: DependencyEntry | undefined

  constructor(options: LoggerOptions = {}) {
    const init = pendingInit
    pendingInit = undefined
    if (init) {
      this.#core = init.core
      this.#state = init.state
      this.#parent = init.parent
      this.#dep = init.dep
    } else {
      this.#core = buildCore(options)
      this.#state = newState(newSummary(false))
    }
  }

  static #spawn(init: Init): Logger {
    pendingInit = init
    return new Logger()
  }

  // -- ids --------------------------------------------------------------------

  get requestId(): string | undefined {
    return this.#state.ids.request_id as string | undefined
  }

  get correlationId(): string | undefined {
    return this.#state.ids.correlation_id as string | undefined
  }

  /** A new id from the configured generator (`uuidv7` by default), e.g. for `setDependency({ dependencyId })`. */
  genId(): string {
    return this.#core.generate()
  }

  /** Headers to forward when calling another service: correlation id and W3C `traceparent`. */
  propagationHeaders(): Record<string, string> {
    const out: Record<string, string> = {}
    const { ids, trace } = this.#state
    if (ids.correlation_id) out[this.#core.correlationHeader] = ids.correlation_id as string
    if (trace && ids.span_id) out.traceparent = `00-${trace.traceId}-${ids.span_id as string}-${trace.flags}`
    return out
  }

  // -- detail -----------------------------------------------------------------

  debug(action: string, data?: unknown): Logger {
    return this.#detail('debug', action, data)
  }
  info(action: string, data?: unknown): Logger {
    return this.#detail('info', action, data)
  }
  warn(action: string, data?: unknown): Logger {
    return this.#detail('warn', action, data)
  }
  error(action: string, data?: unknown): Logger {
    return this.#detail('error', action, data)
  }

  maskDebug(rules: MaskRule[], action: string, data?: unknown): Logger {
    return this.#detail('debug', action, data, rules)
  }
  maskInfo(rules: MaskRule[], action: string, data?: unknown): Logger {
    return this.#detail('info', action, data, rules)
  }
  maskWarn(rules: MaskRule[], action: string, data?: unknown): Logger {
    return this.#detail('warn', action, data, rules)
  }
  maskError(rules: MaskRule[], action: string, data?: unknown): Logger {
    return this.#detail('error', action, data, rules)
  }

  /**
   * Attach dependency fields to the **next** detail line only. The returned logger's
   * write methods hand back the regular logger, so chained calls don't repeat them.
   */
  setDependency(info: DependencyInfo): Logger {
    if (!info || typeof info.dependency !== 'string' || info.dependency === '') {
      throw new Error('setDependency: "dependency" must be a non-empty string')
    }
    const dep: DependencyEntry = { dependency: info.dependency }
    if (info.desc !== undefined) dep.desc = String(info.desc)
    if (info.resultCode !== undefined) dep.result_code = String(info.resultCode)
    if (info.dependencyId !== undefined) {
      const id = sanitizeId(info.dependencyId)
      if (!id) throw new Error('setDependency: invalid "dependencyId" (max 128 chars of A-Z a-z 0-9 - _ . :)')
      dep.dependency_id = id
    }
    return Logger.#spawn({ core: this.#core, state: this.#state, parent: this.#root(), dep })
  }

  /** A top-level field on every record written after this (detail and summary). `undefined` removes it. */
  update(key: string, value: unknown): Logger {
    reserved(key, 'update')
    put(this.#state.fields, key, value)
    return this
  }

  /** A key in `additional_info` of every detail line written after this. `undefined` removes it. */
  addDetailAdditionalInfo(key: string, value: unknown): Logger {
    put(this.#state.detailInfo, key, value)
    return this
  }

  clearDetailAdditionalInfo(): Logger {
    this.#state.detailInfo = {}
    return this
  }

  // -- summary ----------------------------------------------------------------

  /** A top-level field on the summary record. Ignored after flush. */
  addSummary(key: string, value: unknown): Logger {
    reserved(key, 'addSummary')
    const s = this.#state.summary
    if (!s.flushed) put(s.fields, key, value)
    return this
  }

  /** A key in the summary's `additional_info`. `undefined` removes it. Ignored after flush. */
  addSummaryAdditionalInfo(key: string, value: unknown): Logger {
    const s = this.#state.summary
    if (!s.flushed) put(s.info, key, value)
    return this
  }

  clearSummaryAdditionalInfo(): Logger {
    const s = this.#state.summary
    if (!s.flushed) s.info = {}
    return this
  }

  get flushed(): boolean {
    return this.#state.summary.flushed
  }

  /** Write the summary (once). Inside a request it is emitted when the response is ready. */
  flush(options: FlushOptions = {}): Logger {
    const s = this.#state.summary
    if (s.flushed) return this
    s.flushed = true
    if (options.appResult) s.appResult = options.appResult
    if (options.appResultCode !== undefined) s.appResultCode = String(options.appResultCode)
    if (!s.deferred) this.#writeSummary(undefined)
    return this
  }

  /** Write the summary (once) with `error` and `app_result=error`. */
  flushError(error: unknown, options: FlushErrorOptions = {}): Logger {
    const s = this.#state.summary
    if (s.flushed) return this
    s.explicitError = true
    return this.#flushError(error, options)
  }

  #flushError(error: unknown, options: FlushErrorOptions = {}): Logger {
    const s = this.#state.summary
    if (s.flushed) return this
    s.hasError = true
    s.error = error
    return this.flush({ appResult: 'error', ...options })
  }

  // -- request lifecycle (used by App) -----------------------------------------

  /** @internal Creates the per-request logger: ids from headers, deferred summary. */
  forRequest(headers: Headers, method: string, path: string): Logger {
    const core = this.#core
    const ids: Obj = {
      correlation_id: sanitizeId(headers.get(core.correlationHeader)) ?? core.generate(),
      request_id: sanitizeId(headers.get(core.requestHeader)) ?? core.generate(),
    }
    let trace: State['trace']
    if (core.trace) {
      const tp = parseTraceparent(headers.get('traceparent'))
      if (tp) {
        trace = { traceId: tp.traceId, flags: tp.flags }
        ids.trace_id = tp.traceId
        ids.span_id = newSpanId()
      }
    }
    const enabled = !core.skip.some((m) => m(path))
    const state = newState(newSummary(true, enabled, method, path), ids)
    if (trace) state.trace = trace
    return Logger.#spawn({ core, state })
  }

  /** @internal Called once the final response exists. */
  finishRequest(status: number, error?: unknown): void {
    const s = this.#state.summary
    if (!s.flushed) {
      if (error !== undefined) this.#flushError(error)
      else this.flush()
    }
    this.#writeSummary(status)
  }

  /** @internal Id headers to put on the response. */
  responseHeaders(): Record<string, string> {
    const { ids } = this.#state
    const out: Record<string, string> = {}
    if (ids.request_id) out[this.#core.requestHeader] = ids.request_id as string
    if (ids.correlation_id) out[this.#core.correlationHeader] = ids.correlation_id as string
    return out
  }

  // -- internals --------------------------------------------------------------

  #root(): Logger {
    return this.#parent ?? this
  }

  #masked<T>(value: T, extra?: CompiledMask[]): T {
    applyMasks(value, this.#core.masks)
    if (extra) applyMasks(value, extra)
    return value
  }

  /** Fields every record starts with, in output order. */
  #head(level: LogLevel, type: LogRecord['type']): LogRecord {
    const { base } = this.#core
    const { ids, fields } = this.#state
    return {
      time: new Date().toISOString(),
      level,
      type,
      ...base,
      ...ids,
      ...this.#masked(structuredClone(fields)),
    }
  }

  #emit(record: LogRecord): void {
    this.#core.sink(this.#core.format(record), record)
  }

  #detail(level: LogLevel, action: string, data: unknown, rules?: MaskRule[]): Logger {
    const dep = this.#dep
    if (dep) this.#recordDependency(dep)
    if (LEVEL_VALUE[level] >= this.#core.min) {
      const record = this.#head(level, 'detail')
      if (dep) Object.assign(record, dep)
      const plain = this.#masked(toPlain(data), rules && compileMasks(rules))
      record.action = String(action)
      record.message = toMessage(plain)
      if (this.#core.detailData && plain !== undefined) record.data = plain
      const info = this.#state.detailInfo
      if (Object.keys(info).length) record.additional_info = this.#masked(structuredClone(info))
      this.#emit(record)
    }
    return this.#root()
  }

  #recordDependency(dep: DependencyEntry): void {
    const s = this.#state.summary
    if (s.flushed) return
    const id = dep.dependency_id
    const index = id === undefined ? undefined : s.byId.get(id)
    if (index !== undefined) {
      s.dependencies[index] = canonical({ ...s.dependencies[index]!, ...dep })
      return
    }
    if (id !== undefined) s.byId.set(id, s.dependencies.length)
    s.dependencies.push(canonical(dep))
  }

  #writeSummary(status: number | undefined): void {
    const s = this.#state.summary
    if (s.written || !s.enabled) return
    s.written = true
    if (this.#core.min === Number.POSITIVE_INFINITY) return

    const failed = s.hasError || (status !== undefined && status >= 400)
    // An error thrown out of a handler is classified by the final status (403 → warn);
    // flushError() called by the app is always an error.
    const level: LogLevel =
      s.explicitError || (status ?? 0) >= 500 || (s.hasError && status === undefined)
        ? 'error'
        : (status ?? 0) >= 400
          ? 'warn'
          : 'info'
    const record = this.#head(level, 'summary')
    if (s.method !== undefined) record.method = s.method
    if (s.path !== undefined) record.path = s.path
    if (status !== undefined) record.status = status
    if (s.deferred) record.duration_ms = round(performance.now() - s.start)
    record.app_result = s.appResult ?? (failed ? 'error' : 'success')
    const code = s.appResultCode ?? (status === undefined ? undefined : String(status))
    if (code !== undefined) record.app_result_code = code
    Object.assign(record, this.#masked(s.fields))
    if (s.dependencies.length) record.dependencies = s.dependencies
    if (s.hasError) {
      record.error = s.error instanceof Error ? serializeError(s.error) : { message: toMessage(toPlain(s.error)) }
    }
    if (Object.keys(s.info).length) record.additional_info = this.#masked(s.info)
    this.#emit(record)
  }
}

export const createLogger = (options: LoggerOptions = {}): Logger => new Logger(options)
