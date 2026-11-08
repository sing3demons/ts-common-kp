import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffold, toPackageName } from '../src/cli/scaffold.ts'

const root = mkdtempSync(join(tmpdir(), 'kp-cli-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('cli scaffold', () => {
  test('bun + routes', () => {
    const dir = join(root, 'My App')
    const files = scaffold({ dir, runtime: 'bun', style: 'routes', kpVersion: '^9.9.9' })

    expect(files).toContain('.gitignore')
    expect(files).toContain('.npmrc')
    expect(files).toContain('src/main.ts')
    expect(files).toContain('test/users.test.ts')
    expect(files.some((f) => f.startsWith('_'))).toBe(false)

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('my-app')
    expect(pkg.dependencies['@sing3demons/kp']).toBe('^9.9.9')
    expect(pkg.scripts.test).toBe('bun test')
    expect(readFileSync(join(dir, 'src/modules/users/user.routes.ts'), 'utf8')).toContain('.basePath(')
    expect(readFileSync(join(dir, 'test/users.test.ts'), 'utf8')).toContain('bun:test')
  })

  test('node + decorator', () => {
    const dir = join(root, 'node-dec')
    scaffold({ dir, runtime: 'node', style: 'decorator', kpVersion: '^1.0.0' })

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(pkg.devDependencies.tsx).toBeDefined()
    expect(JSON.parse(readFileSync(join(dir, 'tsconfig.json'), 'utf8')).compilerOptions.module).toBe('NodeNext')
    expect(readFileSync(join(dir, 'src/modules/users/user.controller.ts'), 'utf8')).toContain("@Controller('/users')")
    expect(readFileSync(join(dir, 'test/users.test.ts'), 'utf8')).toContain('node:test')
  })

  test('refuses a non-empty directory unless forced', () => {
    const dir = join(root, 'taken')
    scaffold({ dir, runtime: 'bun', style: 'routes', kpVersion: '^1.0.0' })
    writeFileSync(join(dir, 'keep.txt'), 'x')
    expect(() => scaffold({ dir, runtime: 'bun', style: 'routes', kpVersion: '^1.0.0' })).toThrow(/not empty/)
    scaffold({ dir, runtime: 'bun', style: 'routes', kpVersion: '^1.0.0', force: true })
    expect(existsSync(join(dir, 'keep.txt'))).toBe(true)
  })

  test('toPackageName', () => {
    expect(toPackageName('/tmp/Hello World!')).toBe('hello-world')
    expect(toPackageName('/tmp/_x')).toBe('x')
  })
})
