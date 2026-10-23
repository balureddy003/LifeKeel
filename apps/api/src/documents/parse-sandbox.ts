/**
 * Runs parser-child.ts in a credential-less child process (§7.11).
 *
 * - `env: {}`: the child inherits none of the worker's secrets.
 * - `--max-old-space-size` caps the V8 heap; image decoders allocate natively,
 *   so the real memory bound is the pixel cap the child enforces before
 *   decoding (100 MP), plus the worker's own container limit.
 * - Node's permission model: reads allowed (to load modules), no fs writes,
 *   no child processes, no workers; native addons allowed for sharp. Disable
 *   with PARSER_NODE_PERMISSION=off only where the runtime lacks the flags.
 * - Hard timeout: the child is SIGKILLed and the job fails as `error`
 *   (retried), never crashing the worker.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FormatKind } from './formats.js'
import type { ParseHeader } from './parser-child.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(here, '../../../..')

function childCommand(): { args: string[]; env: Record<string, string>; sandboxable: boolean } {
  const js = path.join(here, 'parser-child.js')
  if (existsSync(js)) return { args: [js], env: {}, sandboxable: true }
  // Running from source (tests, tsx dev): tsx compiles through an esbuild
  // subprocess and worker-thread hooks, which the permission model forbids,
  // so source mode runs without it. The compiled deployment always has it.
  return {
    args: ['--import', 'tsx', path.join(here, 'parser-child.ts')],
    env: { TSX_DISABLE_CACHE: '1' },
    sandboxable: false,
  }
}

export interface ParseResult {
  header: ParseHeader
  out: Buffer
}

export function runParser(
  kind: FormatKind,
  mime: string,
  bytes: Buffer,
  opts: { timeoutMs?: number; heapMb?: number } = {},
): Promise<ParseResult> {
  const timeoutMs = opts.timeoutMs ?? Number(process.env['PARSER_TIMEOUT_MS'] ?? 60_000)
  const heapMb = opts.heapMb ?? Number(process.env['PARSER_HEAP_MB'] ?? 1024)
  const { args, env, sandboxable } = childCommand()
  const permission =
    process.env['PARSER_NODE_PERMISSION'] === 'off' || !sandboxable
      ? []
      : ['--permission', `--allow-fs-read=${APP_ROOT}`, '--allow-addons', '--no-warnings']
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${heapMb}`, ...permission, ...args, kind, mime],
      { env, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const out: Buffer[] = []
    let settled = false
    const done = (r: ParseResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done({ header: { outcome: 'error', reason: 'parser_timeout' }, out: Buffer.alloc(0) })
    }, timeoutMs)
    child.stdout.on('data', (c: Buffer) => out.push(c))
    child.stderr.resume()
    child.on('error', () =>
      done({ header: { outcome: 'error', reason: 'parser_spawn_failed' }, out: Buffer.alloc(0) }),
    )
    child.on('close', (code, signal) => {
      const buf = Buffer.concat(out)
      if (buf.length >= 4) {
        const len = buf.readUInt32BE(0)
        if (buf.length >= 4 + len) {
          try {
            const header = JSON.parse(buf.subarray(4, 4 + len).toString()) as ParseHeader
            return done({ header, out: buf.subarray(4 + len) })
          } catch {
            /* fall through */
          }
        }
      }
      // A crash (OOM, decoder abort) is the file's fault until shown otherwise.
      const reason = signal ? `parser_killed_${signal}` : `parser_exit_${code}`
      done({
        header: { outcome: code === null ? 'error' : 'rejected', reason },
        out: Buffer.alloc(0),
      })
    })
    child.stdin.on('error', () => {
      /* child exited early; close handler reports */
    })
    child.stdin.end(bytes)
  })
}
