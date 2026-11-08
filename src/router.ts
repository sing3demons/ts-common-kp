export const METHOD_ALL = 'ALL'

interface Route<T> {
  handler: T
  /** Param names in the order they appear in the path (per route, so sibling routes may name them differently). */
  names: string[]
}

interface Node<T> {
  static: Map<string, Node<T>>
  param: Node<T> | undefined
  wildcard: Node<T> | undefined
  routes: Map<string, Route<T>>
}

const createNode = <T>(): Node<T> => ({
  static: new Map(),
  param: undefined,
  wildcard: undefined,
  routes: new Map(),
})

export const splitPath = (path: string): string[] => path.split('/').filter((s) => s !== '')

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export interface RouteMatch<T> {
  handler: T
  params: Record<string, string>
}

/**
 * Segment trie router. Priority on every level: static > :param > * (wildcard),
 * with backtracking. Supports a trailing optional param (`/posts/:id?`).
 */
export class TrieRouter<T> {
  #root: Node<T> = createNode()

  add(method: string, path: string, handler: T): void {
    const segments = splitPath(path)
    const last = segments[segments.length - 1]
    if (last?.startsWith(':') && last.endsWith('?')) {
      // Optional trailing param → register both variants.
      segments[segments.length - 1] = last.slice(0, -1)
      this.#insert(method, segments, handler)
      this.#insert(method, segments.slice(0, -1), handler)
      return
    }
    this.#insert(method, segments, handler)
  }

  #insert(method: string, segments: string[], handler: T): void {
    let node = this.#root
    const names: string[] = []
    segments.forEach((seg, i) => {
      if (seg === '*') {
        if (i !== segments.length - 1) throw new Error(`Wildcard "*" must be the last segment`)
        node = node.wildcard ??= createNode()
      } else if (seg.startsWith(':')) {
        names.push(seg.slice(1))
        node = node.param ??= createNode()
      } else {
        let next = node.static.get(seg)
        if (!next) node.static.set(seg, (next = createNode()))
        node = next
      }
    })
    node.routes.set(method, { handler, names })
  }

  match(method: string, path: string): RouteMatch<T> | null {
    const segments = splitPath(path)
    const values: string[] = []

    const pick = (node: Node<T>): Route<T> | undefined =>
      node.routes.get(method) ??
      node.routes.get(METHOD_ALL) ??
      (method === 'HEAD' ? node.routes.get('GET') : undefined)

    const walk = (node: Node<T>, i: number): Route<T> | undefined => {
      if (i === segments.length) {
        return pick(node) ?? (node.wildcard && pick(node.wildcard))
      }
      const seg = segments[i]!
      const s = node.static.get(seg)
      if (s) {
        const r = walk(s, i + 1)
        if (r) return r
      }
      if (node.param) {
        values.push(seg)
        const r = walk(node.param, i + 1)
        if (r) return r
        values.pop()
      }
      if (node.wildcard) return pick(node.wildcard)
      return undefined
    }

    const route = walk(this.#root, 0)
    if (!route) return null
    const params: Record<string, string> = {}
    route.names.forEach((name, i) => {
      params[name] = safeDecode(values[i]!)
    })
    return { handler: route.handler, params }
  }
}

/** Compile a middleware path pattern (`*`, `/api/*`, `/users/:id`) to a predicate. */
export const compileMatcher = (pattern: string): ((path: string) => boolean) => {
  if (pattern === '*' || pattern === '/*') return () => true
  const segments = splitPath(pattern)
  let re = ''
  for (const seg of segments) {
    if (seg === '*') re += '(?:/.*)?'
    else if (seg.startsWith(':')) re += seg.endsWith('?') ? '(?:/[^/]+)?' : '/[^/]+'
    else re += '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  const regex = new RegExp(`^${re || '/'}/?$`)
  return (path) => regex.test(path)
}
