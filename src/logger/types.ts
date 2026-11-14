/** Env of an app / context that has a logger (`new App().logger(...)`). */
export type WithLogger = { logger: true }

/** Type-level features of an app / context. */
export type Env = { logger?: true }

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogLevelOption = LogLevel | 'silent'
export type LogFormat = 'json' | 'logfmt' | 'text'
export type LogType = 'detail' | 'summary'

/** Built-in mask presets. */
export type MaskPreset = 'full' | 'last4' | 'first4' | 'email' | 'card'

/**
 * Masks the value(s) at `field` before a record is written.
 *
 * - `field`: dot path from the logged data. `*` = every array element / object key,
 *   `[0]` (or `a[0]`) = that index only. e.g. `body.*.password`, `body.[0].phone`.
 * - `pattern`: a preset, `'custom'` (with `regex` / `replacement`), or any other string
 *   which is used as the replacement value as-is.
 */
export interface MaskRule {
  field: string
  pattern: MaskPreset | 'custom' | (string & {})
  /** Required when `pattern` is `'custom'`. Every match is replaced (the `g` flag is added). */
  regex?: string | RegExp
  /** Replacement for each `regex` match. Default `*`. */
  replacement?: string
}

export type IdGenerator = 'uuidv7' | 'uuidv4' | (() => string)

export interface IdOptions {
  /** How new ids are created. Default `uuidv7` (time ordered). */
  generator?: IdGenerator
  request?: { header?: string }
  correlation?: { header?: string }
  /** Read W3C `traceparent` into `trace_id` / `span_id`. Default `true`. */
  trace?: boolean
}

/** A written log record. Field order is the output order. */
export type LogRecord = {
  time: string
  level: LogLevel
  type: LogType
} & Record<string, unknown>

/** Receives each formatted line (without trailing newline) and the record it came from. */
export type Sink = (line: string, record: LogRecord) => void

export interface LoggerOptions {
  /** Minimum level for detail records. Summary records are always written unless `silent`. Default `info`. */
  level?: LogLevelOption
  /** Default `json`. */
  format?: LogFormat
  /** `service` field on every record. `false` = omit. */
  service?: string | false
  /** `version` field on every record. `false` = omit. */
  version?: string | false
  /** Paths (same patterns as `app.use`) that get ids and detail logs but no summary. */
  skip?: string[]
  ids?: IdOptions
  detail?: {
    /** Also write the logged data as a `data` object (besides the `message` string). Default `false`. */
    data?: boolean
  }
  /** Applied to every record's data, `additional_info` and custom fields. */
  masks?: MaskRule[]
  /** Where lines go. Default: stdout. */
  sink?: Sink
}

export interface AppLoggerOptions extends LoggerOptions {
  /** YAML config file. Options passed here override the file's values. */
  path?: string | URL
}

export interface DependencyInfo {
  /** Name of the called system, e.g. `mysql`, `payment-api`. */
  dependency: string
  desc?: string
  resultCode?: string | number
  /** Ties several log lines (e.g. request / response) of one call together. See `genId()`. */
  dependencyId?: string
}

export interface FlushOptions {
  appResult?: 'success' | 'error'
  appResultCode?: string | number
}

export interface FlushErrorOptions {
  appResultCode?: string | number
}
