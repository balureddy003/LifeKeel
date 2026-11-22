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
    'apps/web/src/components/TodayCard.tsx',
    // Pinned tiles state figures on file, or that there is none.
    'apps/web/src/lib/pinned-tiles.ts',
    'apps/web/src/components/PinnedTiles.tsx',
    'apps/web/src/lib/today-item.ts',
    // Emergency steps page leads with the policies on file and a call link.
    'apps/web/src/components/AtHand.tsx',
    'apps/web/src/lib/services.ts',
    'apps/web/src/lib/emergency-policies.ts',
    'apps/web/src/components/SendLinkCard.tsx',
    'apps/web/src/lib/share-invite.ts',
    'apps/web/src/components/EmergencyRow.tsx',
    'apps/web/src/components/SeenByCard.tsx',
    'apps/web/src/lib/seen-status.ts',
    'apps/web/src/lib/setup-steps.ts',
    'apps/web/src/components/FreshnessCard.tsx',
    'apps/web/src/lib/extraction-review-copy.ts',
    'apps/web/src/lib/trust-copy.ts',
    'apps/web/src/app/trust/page.tsx',
    'apps/web/src/app/security/page.tsx',
    'apps/web/src/lib/install-copy.ts',
    'apps/web/src/components/ExtractionReview.tsx',
    'apps/web/src/lib/deletion-receipt-copy.ts',
    'apps/web/src/components/DeletionReceiptCard.tsx',
    // PRD-235: the claim packet states what is on file and names no outcome.
    'apps/web/src/app/packet/page.tsx',
    // Intent 94: the income-stops estimate states a range and what it leaves out, and names no product.
    'apps/web/src/app/resilience/page.tsx',
    'apps/web/src/components/FigureRow.tsx',
    'apps/web/src/lib/figure-edit.ts',
    // A brief's figures offered to the family list: states what was typed and what is on file.
    'apps/web/src/app/b/[token]/BriefShareClient.tsx',
    'apps/web/src/components/LatestBriefCard.tsx',
    // Hands-on review: the income-stop door, What If checklists and the Keel Plus page.
    'apps/web/src/components/IncomeStopBrief.tsx',
    'apps/web/src/lib/event-actions.ts',
    'apps/web/src/app/upgrade/page.tsx',
    'apps/web/src/lib/home-score.ts',
    'apps/web/src/app/events/page.tsx',
    'apps/web/src/lib/life-data.ts',
    'apps/web/src/components/SaveFiguresCard.tsx',
    'apps/web/src/lib/brief-figures.ts',
    'apps/api/src/routes/family-figures.ts',
    // Quick policy add: the premium check states arithmetic and points at the policy document.
    'apps/web/src/app/policies/new/page.tsx',
    'apps/web/src/app/domains/PolicyDetails.tsx',
    'apps/web/src/app/domains/CoverageList.tsx',
    'apps/api/src/resilience/premium-check.ts',
    'apps/api/src/routes/family-policies.ts',
    'apps/api/src/resilience/policy-changes.ts',
    'apps/web/src/lib/policy-change-summary.ts',
    // PRD-231: the obligations map states who is named and what is due.
    'apps/web/src/app/map/page.tsx',
    // PRD-232: cover facts state what is on file and when it may end.
    'apps/web/src/app/cover/page.tsx',
    'apps/web/src/lib/ai-disclosure-copy.ts',
    'apps/web/src/app/ai-processing/page.tsx',
    'apps/web/src/components/ChannelsCard.tsx',
    'apps/web/src/lib/channel-explain.ts',
    'apps/api/src/delivery/push-payload.ts',
    // The notification catalogue: every kind's label, reason and lock-screen words.
    'apps/api/src/delivery/notification-catalogue.ts',
    // Intent 80: catalogue titles, field labels and the generated-sentence
    // template text all pass the same banned-pattern scan.
    'apps/api/src/briefs/catalogue.ts',
    // Domain packs: titles, summaries, field labels and trigger labels are copy.
    ...walk('apps/api/src/domains/packs'),
    'apps/api/src/domains/view.ts',
    'apps/api/src/domains/playbook.ts',
    // The monthly digest renderer, now carrying one factual line per domain.
    'apps/api/src/feed/render-quiet-care.ts',
    'apps/api/src/routes/family-domains.ts',
    // Domain pages state what is on file and who has seen it.
    'apps/web/src/app/domains/page.tsx',
    'apps/web/src/app/domains/SentenceCapture.tsx',
    // The three doors on the home page: what each gives you, never what to do with money.
    'apps/web/src/components/ThreeDoors.tsx',
    'apps/web/src/app/domains/domain-copy.ts',
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
