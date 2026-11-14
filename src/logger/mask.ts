import type { MaskRule } from './types.ts'

// ---------------------------------------------------------------------------
// toPlain: deep copy into JSON-safe data (Errors → objects, cycles cut).
// Everything that is logged goes through this, so masking can mutate freely.
// ---------------------------------------------------------------------------

export const serializeError = (err: Error, seen: WeakSet<object> = new WeakSet()): Record<string, unknown> => {
  seen.add(err)
  const out: Record<string, unknown> = { name: err.name, message: err.message }
  for (const [k, v] of Object.entries(err)) out[k] = toPlain(v, seen)
  if (err.stack) out.stack = err.stack
  if (err.cause !== undefined) out.cause = toPlain(err.cause, seen)
  return out
}

export const toPlain = (value: unknown, seen: WeakSet<object> = new WeakSet()): unknown => {
  switch (typeof value) {
    case 'bigint':
      return value.toString()
    case 'function':
    case 'symbol':
      return undefined
    case 'object':
      break
    default:
      return value
  }
  if (value === null) return null
  if (seen.has(value)) return '[Circular]'
  if (value instanceof Error) return serializeError(value, seen)
  const toJSON = (value as { toJSON?: unknown }).toJSON
  if (typeof toJSON === 'function') return toPlain(toJSON.call(value), seen)
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((v) => toPlain(v, seen) ?? null)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const p = toPlain(v, seen)
      if (p !== undefined) out[k] = p
    }
    return out
  } finally {
    seen.delete(value)
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

type Segment = string | number
type MaskFn = (value: unknown) => unknown

export interface CompiledMask {
  segments: Segment[]
  fn: MaskFn
}

export const MASK_PRESETS = ['full', 'last4', 'first4', 'email', 'card'] as const

const stars = (n: number) => '*'.repeat(Math.max(0, n))

const keepEnds = (s: string, head: number, tail: number): string =>
  s.length <= head + tail ? stars(s.length) : s.slice(0, head) + stars(s.length - head - tail) + s.slice(s.length - tail)

const presets: Record<(typeof MASK_PRESETS)[number], (s: string) => string> = {
  full: () => '****',
  last4: (s) => keepEnds(s, 0, 4),
  first4: (s) => keepEnds(s, 4, 0),
  email: (s) => {
    const at = s.lastIndexOf('@')
    if (at <= 0) return '****'
    return `${s[0]}***${s.slice(at)}`
  },
  card: (s) => keepEnds(s, 6, 4),
}

/** `body.*.key` → ['body', '*', 'key'], `body.[0].key` / `body[0].key` → ['body', 0, 'key']. */
export const parseMaskPath = (path: string): Segment[] =>
  path
    .replace(/\[(\d+|\*)\]/g, '.[$1]')
    .split('.')
    .filter((s) => s !== '')
    .map((s) => {
      const m = /^\[(\d+|\*)\]$/.exec(s)
      if (!m) return s
      return m[1] === '*' ? '*' : Number(m[1])
    })

const toRegExp = (regex: string | RegExp): RegExp => {
  const source = typeof regex === 'string' ? regex : regex.source
  const flags = typeof regex === 'string' ? '' : regex.flags
  return new RegExp(source, flags.includes('g') ? flags : flags + 'g')
}

const compileFn = (rule: MaskRule): MaskFn => {
  if (rule.pattern === 'custom') {
    if (rule.regex === undefined || rule.regex === '') {
      throw new Error(`mask rule "${rule.field}": pattern "custom" requires "regex"`)
    }
    const re = toRegExp(rule.regex)
    const replacement = rule.replacement ?? '*'
    return (v) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return s.replace(re, replacement)
    }
  }
  const preset = presets[rule.pattern as keyof typeof presets]
  if (preset) {
    return (v) => {
      if (typeof v === 'object') return '****'
      return preset(String(v))
    }
  }
  const literal = rule.pattern
  return () => literal
}

export const compileMasks = (rules: readonly MaskRule[]): CompiledMask[] =>
  rules.map((rule) => {
    if (!rule || typeof rule.field !== 'string' || rule.field === '') {
      throw new Error('mask rule: "field" must be a non-empty string')
    }
    if (typeof rule.pattern !== 'string') throw new Error(`mask rule "${rule.field}": "pattern" must be a string`)
    return { segments: parseMaskPath(rule.field), fn: compileFn(rule) }
  })

const applyAt = (node: unknown, segs: Segment[], i: number, fn: MaskFn): void => {
  if (node === null || typeof node !== 'object') return
  const obj = node as Record<string | number, unknown>
  const seg = segs[i]!
  const keys: (string | number)[] =
    seg === '*' ? (Array.isArray(node) ? [...node.keys()] : Object.keys(node)) : [seg]
  const last = i === segs.length - 1
  for (const k of keys) {
    if (!Object.hasOwn(obj, k)) continue
    if (last) {
      if (obj[k] != null) obj[k] = fn(obj[k])
    } else applyAt(obj[k], segs, i + 1, fn)
  }
}

/** Masks in place. Only call on data that came from `toPlain`. */
export const applyMasks = <T>(data: T, masks: readonly CompiledMask[]): T => {
  for (const m of masks) if (m.segments.length) applyAt(data, m.segments, 0, m.fn)
  return data
}

/** Returns a masked deep copy of `data`; the input is never modified. */
export const maskData = <T>(data: T, rules: readonly MaskRule[]): T =>
  applyMasks(toPlain(data), compileMasks(rules)) as T
