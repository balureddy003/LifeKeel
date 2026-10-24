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
  'jobs/auto-execute-trusted.ts':
    'Tier 3 — opt-in, off by default, log_only scopes that earned trust',
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(p)
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })
}

const files = walk(SRC).map((p) => ({
  rel: path.relative(SRC, p),
  text: fs.readFileSync(p, 'utf8'),
}))

describe('trust-tier gate on ActionExecutor', () => {
  it('only allow-listed files import ActionExecutor', () => {
    const importers = files
      .filter((f) =>
        /import\s*\{[^}]*\bActionExecutor\b[^}]*\}\s*from\s*'[^']*action-executor/.test(f.text),
      )
      .map((f) => f.rel)
      .sort()
    expect(importers).toEqual(Object.keys(ALLOWED_CALLERS).sort())
  })

  it('every execute() call in an allow-listed file names approvedBy', () => {
    for (const rel of Object.keys(ALLOWED_CALLERS)) {
      const text = files.find((f) => f.rel === rel)!.text
      const calls = [...text.matchAll(/\.execute\(([\s\S]*?)\)\s*(?:\.catch|\n\s*:|\n\s*\)|;|$)/g)]
      expect(calls.length, `${rel} should call execute()`).toBeGreaterThan(0)
      for (const c of calls)
        expect(c[1], `${rel}: execute() without approvedBy`).toMatch(/approvedBy/)
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
 * post must reach state 'approved' (with approved_by) first — set only by the
 * human approve route (intent 03 removed the 'auto-trust' path: earned trust
 * never buys an external effect, matching autopilot's NEVER_AUTONOMOUS).
 */
describe('trust-tier gate on social publishing', () => {
  const posts = files.find((f) => f.rel === 'routes/marketing-posts.ts')!.text

  it('only routes/marketing-posts.ts calls createPost()', () => {
    const callers = files
      .filter((f) => f.rel !== 'marketing/social-publisher.ts' && /\.createPost\(/.test(f.text))
      .map((f) => f.rel)
    expect(callers).toEqual(['routes/marketing-posts.ts'])
  })

  it('publishPost has exactly the two reviewed call sites (cron sweep, human approve)', () => {
    const sites = [...posts.matchAll(/\bpublishPost\(/g)].length - 1 // minus the definition
    expect(sites).toBe(2)
  })

  it('every new approval (state approved + approved_at) records who approved', () => {
    // The pause-restore `$set: { state: 'approved' }` re-queues an already-approved post; not matched.
    const sets = [...posts.matchAll(/\$set:\s*\{\s*state:\s*'approved',\s*approved_at[^}]*\}/g)]
    expect(sets.length).toBeGreaterThanOrEqual(1)
    for (const s of sets) expect(s[0]).toMatch(/approved_by/)
  })

  it('the two publish-policy systems cannot disagree (intent 03)', () => {
    // The removed auto-trust path must not come back under another name —
    // no approval recorded by anyone other than a real user id.
    expect(posts).not.toMatch(/autoPublishEligible|'auto-trust'/)
    // And autopilot must still name publishing as never-autonomous.
    const autopilot = files.find((f) => f.rel === 'operator/autopilot.ts')!.text
    const never = autopilot.match(/NEVER_AUTONOMOUS\s*=\s*\[([^\]]+)\]/)?.[1] ?? ''
    expect(never).toContain("'marketing.publish'")
    expect(never).toContain("'social.post'")
  })
})

/**
 * ConnectorActionExecutor is the generic runtime for connector write actions
 * (Slack, LinkedIn, broker orders). It sits outside ActionExecutor, so it needs its
 * own allow-list: a new caller is a new way to act on a family's or tenant's behalf.
 */
describe('trust-tier gate on ConnectorActionExecutor', () => {
  const ALLOWED_CONNECTOR_CALLERS: Record<string, string> = {
    'actions/action-executor.ts':
      'comments only; the real dispatch uses SendGrid/Twilio/CRM clients',
    'marketing/social-publisher.ts':
      'X/Facebook publishing; gated by approved state, see social publishing tests',
    'routes/marketing-posts.ts': 'publishPost after approval, plus read-only engagement lookups',
    'marketing/profile-reader.ts':
      'read-only profile lookups for the profile check; refuses any action not on a fixed GET-only list (profile-reader tests)',
    'routes/connector-credentials.ts':
      'POST /connectors/:id/actions/:action; read-only, any non-GET registry action is refused via connectors/action-gate.ts (playbook G11)',
  }

  it('only allow-listed files reference ConnectorActionExecutor', () => {
    const users = files
      .filter((f) => /\bConnectorActionExecutor\b/.test(f.text))
      .map((f) => f.rel)
      .sort()
    expect(users).toEqual(Object.keys(ALLOWED_CONNECTOR_CALLERS).sort())
  })
})
