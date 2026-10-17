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

/**
 * Public posting is the other outward-facing door: DbSocialPublisher.createPost
 * publishes to X/LinkedIn/etc. directly, bypassing ActionExecutor. Today every
 * path to it goes through publishPost() in routes/marketing-posts.ts, and every
 * post must reach state 'approved' (with approved_by) first: a human via
 * the approve route, or the explicit opt-in 'auto-trust' scope.
 */
describe('trust-tier gate on social publishing', () => {
  const posts = files.find((f) => f.rel === 'routes/marketing-posts.ts')!.text

  it('only routes/marketing-posts.ts calls createPost()', () => {
    const callers = files.filter((f) => f.rel !== 'marketing/social-publisher.ts' && /\.createPost\(/.test(f.text)).map((f) => f.rel)
    expect(callers).toEqual(['routes/marketing-posts.ts'])
  })

  it('publishPost has exactly the three reviewed call sites (sweep, auto-trust, human approve)', () => {
    const sites = [...posts.matchAll(/\bpublishPost\(/g)].length - 1 // minus the definition
    expect(sites).toBe(3)
  })

  it('every new approval (state approved + approved_at) records who approved', () => {
    // The pause-restore `$set: { state: 'approved' }` re-queues an already-approved post; not matched.
    const sets = [...posts.matchAll(/\$set:\s*\{\s*state:\s*'approved',\s*approved_at[^}]*\}/g)]
    expect(sets.length).toBeGreaterThanOrEqual(2)
    for (const s of sets) expect(s[0]).toMatch(/approved_by/)
  })
})
