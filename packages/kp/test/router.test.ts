import { describe, expect, test } from 'bun:test'
import { compileMatcher, TrieRouter } from '../src/router.ts'

describe('TrieRouter', () => {
  const r = new TrieRouter<string>()
  r.add('GET', '/', 'root')
  r.add('GET', '/users', 'list')
  r.add('GET', '/users/me', 'me')
  r.add('GET', '/users/:id', 'show')
  r.add('GET', '/users/:userId/posts/:postId', 'post')
  r.add('POST', '/users', 'create')
  r.add('ALL', '/any', 'any')
  r.add('GET', '/static/*', 'static')
  r.add('GET', '/docs/:page?', 'docs')

  test('static and root', () => {
    expect(r.match('GET', '/')?.handler).toBe('root')
    expect(r.match('GET', '/users')?.handler).toBe('list')
    expect(r.match('GET', '/users/')?.handler).toBe('list')
  })

  test('static beats param', () => {
    expect(r.match('GET', '/users/me')?.handler).toBe('me')
    expect(r.match('GET', '/users/42')).toEqual({ handler: 'show', params: { id: '42' } })
  })

  test('per-route param names', () => {
    expect(r.match('GET', '/users/7/posts/9')).toEqual({
      handler: 'post',
      params: { userId: '7', postId: '9' },
    })
  })

  test('decodes params', () => {
    expect(r.match('GET', '/users/a%20b')?.params).toEqual({ id: 'a b' })
  })

  test('methods, ALL and HEAD fallback', () => {
    expect(r.match('POST', '/users')?.handler).toBe('create')
    expect(r.match('DELETE', '/users')).toBeNull()
    expect(r.match('PATCH', '/any')?.handler).toBe('any')
    expect(r.match('HEAD', '/users')?.handler).toBe('list')
  })

  test('wildcard', () => {
    expect(r.match('GET', '/static/a/b/c.css')?.handler).toBe('static')
    expect(r.match('GET', '/static')?.handler).toBe('static')
  })

  test('optional trailing param', () => {
    expect(r.match('GET', '/docs')).toEqual({ handler: 'docs', params: {} })
    expect(r.match('GET', '/docs/intro')).toEqual({ handler: 'docs', params: { page: 'intro' } })
  })

  test('backtracks from a dead-end static branch', () => {
    const rr = new TrieRouter<string>()
    rr.add('GET', '/a/b/c', 'abc')
    rr.add('GET', '/a/:x/d', 'axd')
    expect(rr.match('GET', '/a/b/d')).toEqual({ handler: 'axd', params: { x: 'b' } })
  })

  test('no match', () => {
    expect(r.match('GET', '/nope')).toBeNull()
  })
})

describe('compileMatcher', () => {
  test('patterns', () => {
    expect(compileMatcher('*')('/anything')).toBe(true)
    const api = compileMatcher('/api/*')
    expect(api('/api')).toBe(true)
    expect(api('/api/users/1')).toBe(true)
    expect(api('/apix')).toBe(false)
    const user = compileMatcher('/users/:id')
    expect(user('/users/1')).toBe(true)
    expect(user('/users/1/x')).toBe(false)
  })
})
