// `import '@sing3demons/kp-logger'` installs `app.logger(...)` and the log methods on `c`.
import './install.ts'

export { createLogger, Logger } from './logger.ts'
export { loadLoggerConfig } from './config.ts'
export { maskData } from './mask.ts'
export type {
  AppLoggerOptions,
  DependencyInfo,
  FlushErrorOptions,
  FlushOptions,
  IdGenerator,
  IdOptions,
  LogFormat,
  LoggerOptions,
  LogLevel,
  LogLevelOption,
  LogRecord,
  LogType,
  MaskPreset,
  MaskRule,
  Sink,
} from './types.ts'
