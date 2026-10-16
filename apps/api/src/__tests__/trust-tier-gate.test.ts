/**
 * Structural guard for CLAUDE.md's first rule: no autonomous execution of an
 * external action without an approval gate.
 *
 * ActionExecutor is the one door through which approved insights reach
 * SendGrid/Twilio/CRM. This test pins two things statically:
 *   1. Only the known callers import it. A new caller must be added to
 *      ALLOWED_CALLERS in the same PR, which puts the tier/approval question in
 *      front of a human reviewer.
 *   2. Every production `.execute(` on it names an `approvedBy` — the human (or
 *      the explicit 'auto-trust' Tier 3 opt-in) accountable for the dispatch.
 *
 * It is a tripwire, not a proof: it cannot show the caller really verified a
 * human decision. That stays a review item (see the PR template).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..')

/** Files allowed to construct/use ActionExecutor, with the tier each represents. */
const ALLOWED_CALLERS: Record<string, string> = {
  'routes/insights.ts': 'Tier 2 — POST /insights/:id/approve, human user_id',
  'jobs/auto-execute-trusted.ts': 'Tier 3 — opt-in, off by default, log_only scopes that earned trust',
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(p)
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })
}

const files = walk(SRC).map((p) => ({ rel: path.relative(SRC, p), text: fs.readFileSync(p, 'utf8') }))

describe('trust-tier gate on ActionExecutor', () => {
  it('only allow-listed files import ActionExecutor', () => {
    const importers = files
      .filter((f) => /import\s*\{[^}]*\bActionExecutor\b[^}]*\}\s*from\s*'[^']*action-executor/.test(f.text))
      .map((f) => f.rel)
      .sort()
    expect(importers).toEqual(Object.keys(ALLOWED_CALLERS).sort())
  })

  it('every execute() call in an allow-listed file names approvedBy', () => {
    for (const rel of Object.keys(ALLOWED_CALLERS)) {
      const text = files.find((f) => f.rel === rel)!.text
      const calls = [...text.matchAll(/\.execute\(([\s\S]*?)\)\s*(?:\.catch|\n\s*:|\n\s*\)|;|$)/g)]
      expect(calls.length, `${rel} should call execute()`).toBeGreaterThan(0)
      for (const c of calls) expect(c[1], `${rel}: execute() without approvedBy`).toMatch(/approvedBy/)
    }
  })

  it('the matcher flags a call that omits approvedBy (test would fail without it)', () => {
    const bad = `await executor.execute(insight, tenantId, { dryRun })\n`
    const m = [...bad.matchAll(/\.execute\(([\s\S]*?)\)\s*(?:\.catch|\n\s*:|\n\s*\)|;|$)/g)]
    expect(m).toHaveLength(1)
    expect(m[0][1]).not.toMatch(/approvedBy/)
  })
})
