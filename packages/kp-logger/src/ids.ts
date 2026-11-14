const hex = (bytes: Uint8Array): string => {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))

/** RFC 9562 UUID version 7: 48-bit unix ms timestamp + random, so ids sort by creation time. */
export const uuidv7 = (): string => {
  const b = random(16)
  const ts = Date.now()
  b[0] = Math.floor(ts / 2 ** 40) & 0xff
  b[1] = Math.floor(ts / 2 ** 32) & 0xff
  b[2] = (ts >>> 24) & 0xff
  b[3] = (ts >>> 16) & 0xff
  b[4] = (ts >>> 8) & 0xff
  b[5] = ts & 0xff
  b[6] = (b[6]! & 0x0f) | 0x70
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = hex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const uuidv4 = (): string => crypto.randomUUID()

/** 16 hex chars, never all zero (W3C span id). */
export const newSpanId = (): string => {
  for (;;) {
    const id = hex(random(8))
    if (id !== '0000000000000000') return id
  }
}

const ID_RE = /^[A-Za-z0-9\-_.:]{1,128}$/

/** Returns the id if it is safe to log (≤128 chars of `A-Z a-z 0-9 - _ . :`), else `undefined`. */
export const sanitizeId = (value: string | null | undefined): string | undefined =>
  value != null && ID_RE.test(value) ? value : undefined

export interface TraceParent {
  traceId: string
  parentId: string
  flags: string
}

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

export const parseTraceparent = (value: string | null | undefined): TraceParent | undefined => {
  const m = value ? TRACEPARENT_RE.exec(value.trim()) : null
  if (!m) return undefined
  const [, traceId, parentId, flags] = m as unknown as [string, string, string, string]
  if (/^0+$/.test(traceId) || /^0+$/.test(parentId)) return undefined
  return { traceId, parentId, flags }
}
