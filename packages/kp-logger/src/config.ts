import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { mergeLoggerOptions, validateLoggerOptions } from './options.ts'
import type { AppLoggerOptions, LoggerOptions } from './types.ts'

/** Reads and validates a YAML logger config. Unknown keys and bad values throw. */
export const loadLoggerConfig = async (path: string | URL): Promise<LoggerOptions> => {
  const source = String(path)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    throw new Error(`logger config (${source}): cannot read file: ${(e as Error).message}`)
  }
  let raw: unknown
  try {
    raw = parse(text)
  } catch (e) {
    throw new Error(`logger config (${source}): invalid YAML: ${(e as Error).message}`)
  }
  return validateLoggerOptions(raw, source)
}

/** `LOG_LEVEL` / `LOG_FORMAT` environment overrides. */
const envOptions = (): LoggerOptions => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  const raw: Record<string, string> = {}
  if (env.LOG_LEVEL) raw.level = env.LOG_LEVEL.toLowerCase()
  if (env.LOG_FORMAT) raw.format = env.LOG_FORMAT.toLowerCase()
  return validateLoggerOptions(raw, 'env')
}

/** `name` / `version` from the app's own package.json (`process.cwd()`). Missing file → `{}`. */
export const readAppInfo = async (cwd: string = process.cwd()): Promise<{ name?: string; version?: string }> => {
  try {
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>
    const out: { name?: string; version?: string } = {}
    if (typeof pkg.name === 'string' && pkg.name) out.name = pkg.name
    if (typeof pkg.version === 'string' && pkg.version) out.version = pkg.version
    return out
  } catch {
    return {}
  }
}

/**
 * Final options for `app.logger()`. Precedence (highest first):
 * options in code > `LOG_LEVEL` / `LOG_FORMAT` env > YAML file > package.json (service / version).
 */
export const resolveLoggerOptions = async (options: AppLoggerOptions = {}): Promise<LoggerOptions> => {
  const { path, ...code } = options
  const file = path === undefined ? {} : await loadLoggerConfig(path)
  const merged = mergeLoggerOptions(mergeLoggerOptions(file, envOptions()), validateLoggerOptions(code, 'app.logger()'))
  if (merged.service === undefined || merged.version === undefined) {
    const app = await readAppInfo()
    if (merged.service === undefined && app.name) merged.service = app.name
    if (merged.version === undefined && app.version) merged.version = app.version
  }
  return merged
}
