import { compileMasks } from './mask.ts'
import type { IdOptions, LogFormat, LoggerOptions, LogLevelOption, MaskRule } from './types.ts'

export const LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const satisfies readonly LogLevelOption[]
export const FORMATS = ['json', 'logfmt', 'text'] as const satisfies readonly LogFormat[]

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const fail = (source: string, msg: string): never => {
  throw new Error(`logger config (${source}): ${msg}`)
}

const checkKeys = (obj: Obj, allowed: readonly string[], where: string, source: string): void => {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(source, `unknown key "${where}${k}" (allowed: ${allowed.join(', ')})`)
  }
}

const optString = (v: unknown, where: string, source: string): string | undefined => {
  if (v === undefined) return undefined
  if (typeof v !== 'string' || v === '') fail(source, `"${where}" must be a non-empty string`)
  return v as string
}

/** `service` / `version`: string, `false`, or a YAML number like `1.2` → string. */
const nameOrFalse = (v: unknown, where: string, source: string): string | false | undefined => {
  if (v === undefined || v === false) return v
  if (typeof v === 'number') return String(v)
  if (typeof v !== 'string' || v === '') fail(source, `"${where}" must be a string or false`)
  return v as string
}

const header = (v: unknown, where: string, source: string): { header?: string } | undefined => {
  if (v === undefined) return undefined
  if (!isObj(v)) return fail(source, `"${where}" must be an object`)
  checkKeys(v, ['header'], `${where}.`, source)
  const h = optString(v.header, `${where}.header`, source)
  return h === undefined ? {} : { header: h.toLowerCase() }
}

const ids = (v: unknown, source: string): IdOptions | undefined => {
  if (v === undefined) return undefined
  if (!isObj(v)) return fail(source, '"ids" must be an object')
  checkKeys(v, ['generator', 'request', 'correlation', 'trace'], 'ids.', source)
  const out: IdOptions = {}
  if (v.generator !== undefined) {
    if (v.generator !== 'uuidv7' && v.generator !== 'uuidv4' && typeof v.generator !== 'function') {
      fail(source, '"ids.generator" must be "uuidv7", "uuidv4" or a function')
    }
    out.generator = v.generator as IdOptions['generator']
  }
  const request = header(v.request, 'ids.request', source)
  if (request) out.request = request
  const correlation = header(v.correlation, 'ids.correlation', source)
  if (correlation) out.correlation = correlation
  if (v.trace !== undefined) {
    if (typeof v.trace !== 'boolean') fail(source, '"ids.trace" must be true or false')
    out.trace = v.trace as boolean
  }
  return out
}

const masks = (v: unknown, source: string): MaskRule[] | undefined => {
  if (v === undefined) return undefined
  if (!Array.isArray(v)) return fail(source, '"masks" must be a list')
  const rules = v.map((r, i) => {
    if (!isObj(r)) return fail(source, `"masks[${i}]" must be an object`)
    checkKeys(r, ['field', 'pattern', 'regex', 'replacement'], `masks[${i}].`, source)
    return r as unknown as MaskRule
  })
  try {
    compileMasks(rules)
  } catch (e) {
    fail(source, (e as Error).message)
  }
  return rules
}

const KEYS = ['level', 'format', 'service', 'version', 'skip', 'ids', 'detail', 'masks', 'sink'] as const

/** Validates a raw config object (from YAML or code) and returns a clean `LoggerOptions`. */
export const validateLoggerOptions = (raw: unknown, source: string): LoggerOptions => {
  if (raw === undefined || raw === null) return {}
  if (!isObj(raw)) return fail(source, 'must be an object')
  checkKeys(raw, KEYS, '', source)
  const out: LoggerOptions = {}

  if (raw.level !== undefined) {
    if (!LEVELS.includes(raw.level as never)) fail(source, `"level" must be one of ${LEVELS.join(', ')}`)
    out.level = raw.level as LogLevelOption
  }
  if (raw.format !== undefined) {
    if (!FORMATS.includes(raw.format as never)) fail(source, `"format" must be one of ${FORMATS.join(', ')}`)
    out.format = raw.format as LogFormat
  }
  const service = nameOrFalse(raw.service, 'service', source)
  if (service !== undefined) out.service = service
  const version = nameOrFalse(raw.version, 'version', source)
  if (version !== undefined) out.version = version

  if (raw.skip !== undefined) {
    if (!Array.isArray(raw.skip) || raw.skip.some((s) => typeof s !== 'string')) {
      fail(source, '"skip" must be a list of paths')
    }
    out.skip = raw.skip as string[]
  }
  const idOpts = ids(raw.ids, source)
  if (idOpts) out.ids = idOpts
  if (raw.detail !== undefined) {
    if (!isObj(raw.detail)) fail(source, '"detail" must be an object')
    const detail = raw.detail as Obj
    checkKeys(detail, ['data'], 'detail.', source)
    if (detail.data !== undefined && typeof detail.data !== 'boolean') fail(source, '"detail.data" must be true or false')
    out.detail = detail.data === undefined ? {} : { data: detail.data as boolean }
  }
  const maskRules = masks(raw.masks, source)
  if (maskRules) out.masks = maskRules
  if (raw.sink !== undefined) {
    if (typeof raw.sink !== 'function') fail(source, '"sink" must be a function')
    out.sink = raw.sink as LoggerOptions['sink']
  }
  return out
}

/** `b` wins over `a`; nested objects (`ids`, `detail`) are merged key by key. */
export const mergeLoggerOptions = (a: LoggerOptions, b: LoggerOptions): LoggerOptions => {
  const out: LoggerOptions = { ...a, ...b }
  if (a.ids || b.ids) {
    out.ids = {
      ...a.ids,
      ...b.ids,
      request: { ...a.ids?.request, ...b.ids?.request },
      correlation: { ...a.ids?.correlation, ...b.ids?.correlation },
    }
  }
  if (a.detail || b.detail) out.detail = { ...a.detail, ...b.detail }
  return out
}
