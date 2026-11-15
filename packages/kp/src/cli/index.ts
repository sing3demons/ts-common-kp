#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { readOwnVersion, scaffold, type Runtime, type Style } from './scaffold.ts'

const HELP = `kp: scaffold a new @sing3demons/kp project

Usage
  kp create [dir] [options]

Options
  -r, --runtime <bun|node>        runtime ของโปรเจกต์ (default: runtime ที่ใช้รัน cli)
  -s, --style <decorator|routes>  รูปแบบ controller (default: decorator)
  -y, --yes                       ไม่ถาม ใช้ค่า default ทั้งหมด
      --skip-install              ไม่ติดตั้ง dependency
      --skip-git                  ไม่ git init
  -f, --force                     เขียนทับใน directory ที่มีไฟล์อยู่แล้ว
  -v, --version                   แสดงเวอร์ชัน
  -h, --help                      แสดงวิธีใช้

Examples
  bunx @sing3demons/kp create my-api
  npx @sing3demons/kp create my-api --runtime node --style routes
`

const RUNTIMES = ['bun', 'node'] as const
const STYLES = ['decorator', 'routes'] as const

const color = (code: number) => (s: string) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = color(1)
const dim = color(2)
const green = color(32)
const yellow = color(33)
const red = color(31)

const fail = (msg: string): never => {
  console.error(red(`error: ${msg}`))
  process.exit(1)
}

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined => {
  if (value === undefined) return undefined
  if (!(allowed as readonly string[]).includes(value)) fail(`--${flag} must be one of: ${allowed.join(', ')}`)
  return value as T
}

const detectRuntime = (): Runtime =>
  'bun' in process.versions || process.env.npm_config_user_agent?.startsWith('bun') ? 'bun' : 'node'

const run = (cmd: string, args: string[], cwd: string): boolean =>
  spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0

async function create(positionals: string[], values: Record<string, string | boolean | undefined>) {
  const interactive = process.stdin.isTTY && !values.yes
  let dir = positionals[0]
  let runtime = oneOf(values.runtime as string | undefined, RUNTIMES, 'runtime')
  let style = oneOf(values.style as string | undefined, STYLES, 'style')

  if (interactive && (!dir || !runtime || !style)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ask = async <T extends string>(q: string, choices: readonly T[], def: T): Promise<T> => {
      const hint = choices.map((c) => (c === def ? bold(c) : c)).join(' / ')
      for (;;) {
        const a = (await rl.question(`${q} ${dim(`(${hint})`)} `)).trim() || def
        if ((choices as readonly string[]).includes(a)) return a as T
        console.log(yellow(`  เลือกได้: ${choices.join(', ')}`))
      }
    }
    try {
      dir ||= (await rl.question(`Project directory ${dim('(kp-app)')} `)).trim() || 'kp-app'
      runtime ??= await ask('Runtime', RUNTIMES, detectRuntime())
      style ??= await ask('Controller style', STYLES, 'decorator')
    } finally {
      rl.close()
    }
  }

  dir ||= 'kp-app'
  runtime ??= detectRuntime()
  style ??= 'decorator'
  const target = resolve(dir)
  const shown = relative(process.cwd(), target) || '.'

  let files: string[]
  try {
    files = scaffold({ dir, runtime, style, kpVersion: `^${readOwnVersion()}`, force: !!values.force })
  } catch (e) {
    return fail((e as Error).message)
  }

  console.log(`\n${green('✔')} created ${bold(shown)} ${dim(`(${runtime}, ${style}, ${files.length} files)`)}`)
  for (const f of files) console.log(dim(`  ${f}`))

  if (!values['skip-git'] && !values.force) {
    if (run('git', ['init', '-q'], target)) console.log(`${green('✔')} git init`)
  }

  const pm = runtime === 'bun' ? 'bun' : 'npm'
  let installed = false
  if (!values['skip-install']) {
    if (!process.env.GITHUB_TOKEN) {
      console.log(yellow('\n! GITHUB_TOKEN is not set: installing @sing3demons/kp from GitHub Packages may fail (401).'))
    }
    console.log(dim(`\n$ ${pm} install`))
    installed = run(pm, ['install'], target)
    if (!installed) console.log(yellow(`! ${pm} install failed. Set GITHUB_TOKEN (read:packages) and run it again.`))
  }

  const steps = [
    shown !== '.' && `cd ${shown}`,
    !process.env.GITHUB_TOKEN && 'export GITHUB_TOKEN=ghp_xxx   # classic token, scope read:packages',
    !installed && `${pm} install`,
    `${pm} run dev`,
  ].filter(Boolean)
  console.log(`\n${bold('Next steps')}\n${steps.map((s) => `  ${s}`).join('\n')}\n`)
}

async function main() {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        runtime: { type: 'string', short: 'r' },
        style: { type: 'string', short: 's' },
        yes: { type: 'boolean', short: 'y' },
        'skip-install': { type: 'boolean' },
        'skip-git': { type: 'boolean' },
        force: { type: 'boolean', short: 'f' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    return fail(`${(e as Error).message}\n\n${HELP}`)
  }
  const { values, positionals } = parsed
  if (values.version) return console.log(readOwnVersion())

  const [command, ...rest] = positionals
  if (values.help || !command) return console.log(HELP)
  if (command === 'create' || command === 'new' || command === 'init') return create(rest, values)
  fail(`unknown command "${command}"\n\n${HELP}`)
}

await main()
