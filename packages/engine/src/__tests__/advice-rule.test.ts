/**
 * Enforces CLAUDE.md's "second rule": LifeKeel never crosses into regulated
 * advice or arranging. Detector and playbook copy describe what is on file and
 * point to "a licensed professional" — never "buy X", never a named provider.
 *
 * This is a tripwire for the obvious failures, not a compliance review: it
 * catches recommendation verbs and named providers in declarative copy. A
 * human reviewer still owns the judgement call on subtler phrasing.
 *
 * Only non-comment lines are scanned, so YAML comments that explain *why* a
 * rule exists can quote banned phrases freely.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')

const BANNED: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'personal recommendation',
    pattern: /\b(you should|we recommend|i recommend|we suggest you)\b/i,
  },
  {
    name: 'buy/switch instruction',
    pattern: /\b(buy|purchase|switch to|sign up (with|for)|take out)\b/i,
  },
  { name: 'best-product claim', pattern: /\bbest (policy|provider|insurer|fund|product|plan)\b/i },
  {
    name: 'named provider',
    pattern:
      /\b(aviva|legal (&|and) general|vitality|prudential|zurich|axa|hargreaves lansdown|vanguard|fidelity|nutmeg|moneybox)\b/i,
  },
]

function copyFiles(): string[] {
  const dirs = ['detectors/family', 'playbooks/family']
  const yaml = dirs.flatMap((d) =>
    fs
      .readdirSync(path.join(ROOT, d))
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => path.join(d, f)),
  )
  return [...yaml, 'verticals/family/vertical.yaml']
}

/**
 * Public web copy is TypeScript/TSX where "buy" and "purchase" are ordinary code
 * and UI words (a pricing page, a button), so the buy/switch pattern is skipped
 * there. Recommendation phrasing, best-product claims and named providers still apply.
 */
const WEB_BANNED = BANNED.filter((b) => b.name !== 'buy/switch instruction')

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) return walk(rel)
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [rel] : []
  })
}

function webCopyFiles(): string[] {
  return [
    'apps/web/src/components/MarketingLanding.tsx',
    // PRD-141/145/203: new user-facing copy outside the landing page.
    'apps/web/src/components/PerceivedProtectionCard.tsx',
    'apps/web/src/components/FreshnessCard.tsx',
    'apps/web/src/lib/extraction-review-copy.ts',
    'apps/web/src/lib/trust-copy.ts',
    'apps/web/src/app/trust/page.tsx',
    'apps/web/src/app/security/page.tsx',
    'apps/web/src/lib/install-copy.ts',
    'apps/web/src/components/ExtractionReview.tsx',
    'apps/web/src/lib/deletion-receipt-copy.ts',
    'apps/web/src/components/DeletionReceiptCard.tsx',
    // PRD-231: the obligations map states who is named and what is due.
    'apps/web/src/app/map/page.tsx',
    'apps/web/src/lib/ai-disclosure-copy.ts',
    'apps/web/src/app/ai-processing/page.tsx',
    'apps/web/src/components/ChannelsCard.tsx',
    'apps/web/src/lib/channel-explain.ts',
    'apps/api/src/delivery/push-payload.ts',
    // Intent 80: catalogue titles, field labels and the generated-sentence
    // template text all pass the same banned-pattern scan.
    'apps/api/src/briefs/catalogue.ts',
    // Keel inline agent panel: help text, presets, setup step titles and fixed replies.
    'apps/api/src/keel-agent/help.ts',
    'apps/api/src/keel-agent/presets.ts',
    'apps/api/src/keel-agent/orchestrator.ts',
    'apps/api/src/keel-agent/setup-state.ts',
    ...walk('apps/web/src/components/keel'),
    'apps/web/src/app/guides/guides-data.ts',
    ...walk('apps/web/src/app/blog'),
    ...landingFiles(),
  ]
}

/** The new landing page (PRD-209). claims.ts is excluded: it quotes blocked wording on purpose. */
function landingFiles(): string[] {
  return [
    ...walk('apps/web/src/components/landing').filter((f) => !f.endsWith('claims.ts')),
    'apps/web/src/components/MarketingLanding.tsx',
  ]
}

/**
 * Extra wording banned only in landing copy, from the trust review: shopping-around
 * nudges, savings promises, and the claims LifeKeel cannot stand behind.
 */
const LANDING_BANNED: Array<{ name: string; pattern: RegExp }> = [
  { name: 'shopping-around nudge', pattern: /\b(compare|cheaper|better deal)\b/i },
  {
    name: 'savings or optimising promise',
    pattern: /\b(saves? (you )?(money|£)|optimi[sz]e[sd]?|optimi[sz]ation)\b/i,
  },
  {
    name: 'unsupported claim',
    pattern:
      /\b(starts watching|safety net|autonomous|knows (you|your family)|always on|protect your family|guaranteed|risk-free|act now)\b/i,
  },
]

export function findViolations(file: string, text: string, rules = BANNED): string[] {
  const out: string[] = []
  text.split('\n').forEach((line, i) => {
    if (/^\s*(#|\/\/|\*|\/\*)/.test(line)) return
    for (const { name, pattern } of rules) {
      if (pattern.test(line)) out.push(`${file}:${i + 1} [${name}] ${line.trim()}`)
    }
  })
  return out
}

describe('advice rule (CLAUDE.md second rule)', () => {
  it('scans at least the detector and playbook copy', () => {
    expect(copyFiles().length).toBeGreaterThan(10)
  })

  it('no detector or playbook copy reads as a personal recommendation', () => {
    const violations = copyFiles().flatMap((f) =>
      findViolations(f, fs.readFileSync(path.join(ROOT, f), 'utf8')),
    )
    expect(violations).toEqual([])
  })

  it('public web copy never reads as a personal recommendation or names a provider', () => {
    const files = webCopyFiles()
    expect(files.length).toBeGreaterThan(3)
    const violations = files.flatMap((f) =>
      findViolations(f, fs.readFileSync(path.join(ROOT, f), 'utf8'), WEB_BANNED),
    )
    expect(violations).toEqual([])
  })

  it('the Quiet Care digest copy reads as information, never a recommendation or promotion (PRD-138)', () => {
    const file = 'apps/api/src/feed/render-quiet-care.ts'
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    expect(findViolations(file, text)).toEqual([])
    expect(text).not.toMatch(/\b(upgrade|keel plus|discount|subscribe|free trial)\b/i)
  })

  it('landing copy avoids shopping-around, savings and unsupported-claim wording', () => {
    const files = landingFiles()
    expect(files.length).toBeGreaterThan(1)
    const violations = files.flatMap((f) =>
      findViolations(f, fs.readFileSync(path.join(ROOT, f), 'utf8'), LANDING_BANNED),
    )
    expect(violations).toEqual([])
    expect(
      findViolations('x.ts', 'We help you compare and save money', LANDING_BANNED),
    ).toHaveLength(2)
  })

  it('the checker itself catches advice-like copy (test would fail without it)', () => {
    expect(
      findViolations('x.yaml', 'reasoning_template: You should buy Aviva term cover'),
    ).toHaveLength(3)
    expect(findViolations('x.yaml', '# you should buy this — comment only')).toEqual([])
    expect(findViolations('x.yaml', 'Compare quotes from multiple insurers')).toEqual([])
  })
})
