import type { LogFormat, LogRecord } from './types.ts'

export type Formatter = (record: LogRecord) => string

export const formatJson: Formatter = (record) => JSON.stringify(record)

// eslint-disable-next-line no-control-regex
const NEEDS_QUOTE = /[\s"=\\\u0000-\u001f\u007f]/

const logfmtValue = (v: unknown): string => {
  if (v === null) return 'null'
  if (typeof v === 'string') return v === '' || NEEDS_QUOTE.test(v) ? JSON.stringify(v) : v
  if (typeof v === 'object') return logfmtValue(JSON.stringify(v))
  return String(v)
}

const pairs = (record: Record<string, unknown>, skip: ReadonlySet<string>): string[] => {
  const out: string[] = []
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined || skip.has(k)) continue
    out.push(`${k}=${logfmtValue(v)}`)
  }
  return out
}

const NONE = new Set<string>()

export const formatLogfmt: Formatter = (record) => pairs(record, NONE).join(' ')

/** Identity fields go last in text output so the interesting part comes first. */
const CONTEXT_KEYS = ['service', 'version', 'correlation_id', 'request_id', 'trace_id', 'span_id'] as const
const TEXT_HEAD_DETAIL = new Set(['time', 'level', 'type', 'action', 'message', ...CONTEXT_KEYS])
const TEXT_HEAD_SUMMARY = new Set([
  'time',
  'level',
  'type',
  'method',
  'path',
  'status',
  'duration_ms',
  'app_result',
  'app_result_code',
  ...CONTEXT_KEYS,
])

const textPart = (v: unknown): string | undefined =>
  v === undefined || v === '' ? undefined : typeof v === 'string' ? v : JSON.stringify(v)

export const formatText: Formatter = (record) => {
  const head = [record.time, record.level.toUpperCase().padEnd(5), `[${record.type}]`.padEnd(9)]
  let main: (string | undefined)[]
  let skip: ReadonlySet<string>
  if (record.type === 'summary') {
    const ms = record.duration_ms === undefined ? undefined : `${record.duration_ms}ms`
    main = [record.method, record.path, record.status, ms, record.app_result, record.app_result_code].map(textPart)
    skip = TEXT_HEAD_SUMMARY
  } else {
    main = [textPart(record.action), textPart(record.message)]
    skip = TEXT_HEAD_DETAIL
  }
  const ctx: Record<string, unknown> = {}
  for (const k of CONTEXT_KEYS) ctx[k] = record[k]
  return [...head, ...main, ...pairs(record, skip), ...pairs(ctx, NONE)]
    .filter((p): p is string => p !== undefined)
    .join(' ')
}

export const formatters: Record<LogFormat, Formatter> = {
  json: formatJson,
  logfmt: formatLogfmt,
  text: formatText,
}
