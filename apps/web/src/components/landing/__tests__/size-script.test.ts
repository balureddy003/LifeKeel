/**
 * The landing size gate (scripts/check-landing-size.mjs) runs in CI. This proves it
 * fails an over-budget page, passes a small one, skips nomodule polyfills, and does
 * not silently pass when index.html points at a file that is missing.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'check-landing-size.mjs',
)
const made: string[] = []

function site(
  scripts: { name: string; bytes: number; attrs?: string }[],
  missing?: string,
): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lk-size-'))
  made.push(dir)
  mkdirSync(path.join(dir, '_next/static'), { recursive: true })
  const tags = scripts.map((s) => {
    // random bytes do not compress, so the gzipped size is about the raw size
    writeFileSync(path.join(dir, '_next/static', s.name), randomBytes(s.bytes))
    return `<script src="/_next/static/${s.name}" ${s.attrs ?? ''}></script>`
  })
  if (missing) tags.push(`<script src="/_next/static/${missing}"></script>`)
  writeFileSync(path.join(dir, 'index.html'), `<html><body>${tags.join('')}</body></html>`)
  return dir
}

function run(dir: string, budgetKb: number): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, dir, String(budgetKb)], {
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string }
    return { code: err.status, out: err.stdout + err.stderr }
  }
}

afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('check-landing-size', () => {
  it('passes a page under budget', () => {
    expect(run(site([{ name: 'a.js', bytes: 20_000 }]), 30).code).toBe(0)
  })

  it('fails a page over budget (test would fail without the gate)', () => {
    const r = run(
      site([
        { name: 'a.js', bytes: 20_000 },
        { name: 'b.js', bytes: 20_000 },
      ]),
      30,
    )
    expect(r.code).toBe(1)
    expect(r.out).toContain('over budget')
  })

  it('does not count nomodule polyfills', () => {
    const dir = site([
      { name: 'a.js', bytes: 10_000 },
      { name: 'poly.js', bytes: 50_000, attrs: 'noModule=""' },
    ])
    expect(run(dir, 30).code).toBe(0)
  })

  it('fails loudly when index.html references a missing file', () => {
    const r = run(site([{ name: 'a.js', bytes: 1000 }], 'gone.js'), 30)
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('does not exist')
  })
})
