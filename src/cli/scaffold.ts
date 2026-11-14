import { cpSync, type Dirent, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Runtime = 'bun' | 'node'
export type Style = 'routes' | 'decorator'

export interface ScaffoldOptions {
  /** Target directory (absolute or relative to cwd). */
  dir: string
  runtime: Runtime
  style: Style
  /** Version range of `@sing3demons/kp` written into the new package.json. */
  kpVersion: string
  /** Overwrite into a non-empty directory. */
  force?: boolean
}

/** Root of this package (works from both `src/cli` and `dist/cli`). */
export const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
export const templatesDir = join(packageRoot, 'templates')

interface OwnPackage {
  version: string
  devDependencies?: Record<string, string>
}

const readOwnPackage = (): OwnPackage => JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

export const readOwnVersion = (): string => readOwnPackage().version

/** Fallbacks, used only if this package's own devDependencies don't list the package. */
const FALLBACK: Record<string, string> = {
  typescript: '^7.0.2',
  tsx: '^4.23.15',
  zod: '^4.1.0',
  '@types/node': '^24.0.0',
  '@types/bun': '^1.3.0',
}

/**
 * Picks version ranges from this package's devDependencies, so a new project always
 * gets the same typescript / zod / tsx / @types the lib itself is built and tested with.
 */
const versions = (names: string[]): Record<string, string> => {
  const own = readOwnPackage().devDependencies ?? {}
  return Object.fromEntries(names.map((n) => [n, own[n] ?? FALLBACK[n] ?? 'latest']))
}

/** npm package names: lowercase, no spaces, url-safe. */
export const toPackageName = (dir: string): string =>
  basename(resolve(dir))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, '-')
    .replace(/^[._-]+|-+$/g, '') || 'kp-app'

export const isEmptyDir = (dir: string): boolean =>
  !existsSync(dir) || readdirSync(dir).filter((f) => f !== '.git' && f !== '.DS_Store').length === 0

const packageJson = (name: string, o: ScaffoldOptions) => {
  const bun = o.runtime === 'bun'
  return {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: bun
      ? { dev: 'bun --watch src/main.ts', start: 'bun src/main.ts', test: 'bun test', typecheck: 'tsc --noEmit' }
      : {
          dev: 'tsx watch src/main.ts',
          start: 'tsx src/main.ts',
          test: 'tsx --test test/*.test.ts',
          typecheck: 'tsc --noEmit',
        },
    dependencies: { '@sing3demons/kp': o.kpVersion, ...versions(['zod']) },
    devDependencies: versions(bun ? ['@types/bun', 'typescript'] : ['@types/node', 'tsx', 'typescript']),
  }
}

const tsconfig = (o: ScaffoldOptions) => ({
  compilerOptions: {
    target: 'ES2022',
    module: o.runtime === 'bun' ? 'Preserve' : 'NodeNext',
    moduleResolution: o.runtime === 'bun' ? 'bundler' : 'NodeNext',
    lib: ['ES2022'],
    types: [o.runtime],
    strict: true,
    noUncheckedIndexedAccess: true,
    verbatimModuleSyntax: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['src', 'test'],
})

const readme = (name: string, o: ScaffoldOptions) => {
  const run = o.runtime === 'bun' ? 'bun' : 'npm'
  const install = o.runtime === 'bun' ? 'bun install' : 'npm install'
  return `# ${name}

สร้างด้วย \`@sing3demons/kp\` (runtime: **${o.runtime}**, style: **${o.style}**)

## เริ่มต้น

\`\`\`sh
export GITHUB_TOKEN=ghp_xxx   # classic token ที่มี scope read:packages (ดู .npmrc)
${install}
${run} run dev
\`\`\`

| คำสั่ง | ทำอะไร |
| --- | --- |
| \`${run} run dev\` | รันแบบ watch |
| \`${run} run start\` | รัน server |
| \`${run} test\` | รัน test |
| \`${run} run typecheck\` | ตรวจ type |

## โครงสร้าง

\`\`\`
src/
  main.ts                 จุดเริ่ม: import logger, error handler, register module
  config.ts               อ่านค่าจาก env (PORT)
  middleware/             error handler
  modules/users/          ตัวอย่าง module: schema → repository → service → controller → routes
test/                     test ผ่าน app.request() ไม่ต้องเปิด port
logger.yaml               config ของ logger (format, level, mask, id) — ดู app.logger() ใน main.ts
\`\`\`

API ตัวอย่าง: \`GET /health\`, \`GET|POST /api/users\`, \`GET|PATCH|DELETE /api/users/:id\`
`
}

/** Writes the project to disk. Returns the list of created files (relative). */
export const scaffold = (o: ScaffoldOptions): string[] => {
  const dir = resolve(o.dir)
  if (!o.force && !isEmptyDir(dir)) {
    throw new Error(`directory "${o.dir}" is not empty (use --force to write into it anyway)`)
  }
  mkdirSync(dir, { recursive: true })

  for (const layer of ['base', o.style, o.runtime]) {
    cpSync(join(templatesDir, layer), dir, { recursive: true, force: true })
  }
  // npm strips .gitignore / .npmrc from published tarballs, so they ship with a `_` prefix.
  for (const f of ['gitignore', 'npmrc']) {
    if (existsSync(join(dir, `_${f}`))) renameSync(join(dir, `_${f}`), join(dir, `.${f}`))
  }

  const name = toPackageName(dir)
  const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n'
  writeFileSync(join(dir, 'package.json'), json(packageJson(name, o)))
  writeFileSync(join(dir, 'tsconfig.json'), json(tsconfig(o)))
  writeFileSync(join(dir, 'README.md'), readme(name, o))

  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e: Dirent) => join(e.parentPath ?? (e as { path?: string }).path, e.name).slice(dir.length + 1))
    .sort()
}
