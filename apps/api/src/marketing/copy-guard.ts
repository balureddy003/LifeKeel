/**
 * Marketing copy guard (PRD-210, phase 0).
 *
 * One pure check that every producer of public text runs before the text is stored, approved or sent:
 * social drafts, campaigns, lifecycle emails, detector-driven blog posts. It enforces
 *   - the claims registry's blocked wording (generated into definitions/marketing-copy-rules.json from
 *     apps/web/src/components/landing/claims.ts; a web test fails if the file drifts),
 *   - CLAUDE.md's second rule (no personal recommendation, buy/switch instruction, best-product claim
 *     or named provider), the same patterns as packages/engine's advice-rule test,
 *   - landing-level wording from the trust review (shopping-around nudges, savings or optimising
 *     promises, unsupported claims), and
 *   - wording that belongs to the retired readiness quiz.
 * It is a tripwire for obvious failures, not a compliance review: a human still approves everything.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CopyViolation {
  rule: string
  match: string
}

export interface CopyCheck {
  ok: boolean
  violations: CopyViolation[]
}

export type CopyKind = 'social' | 'email' | 'blog'

interface RulesFile {
  blocked_phrases: { claim: string; phrase: string }[]
}

const PATTERNS: Array<{ rule: string; pattern: RegExp; kinds?: CopyKind[] }> = [
  { rule: 'personal recommendation', pattern: /\b(you should|we recommend|i recommend|we suggest you)\b/i },
  { rule: 'buy/switch instruction', pattern: /\b(buy|purchase|switch to|sign up (with|for)|take out)\b/i, kinds: ['social', 'email'] },
  { rule: 'best-product claim', pattern: /\bbest (policy|provider|insurer|fund|product|plan)\b/i },
  {
    rule: 'named provider',
    pattern:
      /\b(aviva|legal (&|and) general|vitality|prudential|zurich|axa|hargreaves lansdown|vanguard|fidelity|nutmeg|moneybox|allstate)\b/i,
  },
  { rule: 'shopping-around nudge', pattern: /\b(cheaper|better deal)\b/i },
  { rule: 'savings or optimising promise', pattern: /\b(saves? (you )?(money|£)|optimi[sz]e[sd]?|optimi[sz]ation)\b/i },
  {
    rule: 'unsupported claim',
    pattern:
      /\b(starts watching|safety net|autonomous|knows (you|your family)|always on|protect your family|guaranteed|risk-free|act now|digital twin|continuously monitor)\b/i,
  },
  {
    rule: 'retired readiness quiz wording',
    pattern: /\b(readiness (check|quiz|score)|take the (free )?(\d+-?(second|minute|min)\s)?(check|quiz)|60-second|in two minutes|2-min)\b/i,
  },
]

let cachedRules: RulesFile | null = null

function loadRules(): RulesFile {
  if (cachedRules) return cachedRules
  const here = path.dirname(fileURLToPath(import.meta.url))
  // apps/api/src/marketing -> repo root, as for the other runtime resource files (definitions/, detectors/).
  const file = path.resolve(here, '..', '..', '..', '..', 'definitions', 'marketing-copy-rules.json')
  cachedRules = JSON.parse(fs.readFileSync(file, 'utf8')) as RulesFile
  return cachedRules
}

/** Test hook: use a rules object instead of the file. */
export function setCopyRulesForTest(rules: RulesFile | null): void {
  cachedRules = rules
}

/** Check a piece of public text. Comment-free by design: pass the text as it would be published. */
export function checkCopy(text: string, kind: CopyKind = 'social'): CopyCheck {
  const violations: CopyViolation[] = []
  const lower = text.toLowerCase()
  for (const { claim, phrase } of loadRules().blocked_phrases) {
    if (lower.includes(phrase.toLowerCase())) violations.push({ rule: `blocked claim: ${claim}`, match: phrase })
  }
  for (const { rule, pattern, kinds } of PATTERNS) {
    if (kinds && !kinds.includes(kind)) continue
    const m = pattern.exec(text)
    if (m) violations.push({ rule, match: m[0] })
  }
  return { ok: violations.length === 0, violations }
}

export function describeViolations(c: CopyCheck): string {
  return c.violations.map((v) => `${v.rule} ("${v.match}")`).join('; ')
}
