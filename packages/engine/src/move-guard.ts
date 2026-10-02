import type { Insight } from './schemas.js'

/**
 * Deterministic pre-check that runs before any LLM judge call.
 *
 * Family-detector copy is rendered from fixed YAML templates, so the safety
 * properties the judge checks (no regulated advice, no provider steering, no
 * PII/credentials) are decidable with rules at zero token cost. The LLM only
 * sees what the guard cannot settle.
 *
 * Enforces CLAUDE.md's "second rule": describe what is on file and estimate a
 * gap; never tell the family to buy, switch to, or pick a specific product.
 */

export type GuardReason =
  | 'regulated_advice'
  | 'provider_steering'
  | 'pii'
  | 'credential'
  | 'impact_range_invalid'
  | 'reasoning_too_short'
  | 'no_actions'

export type GuardOutcome = 'clean' | 'block' | 'review'

export interface GuardResult {
  outcome: GuardOutcome
  reasons: GuardReason[]
}

/** Reasons that are never acceptable in delivered copy. */
const BLOCKING: ReadonlySet<GuardReason> = new Set([
  'regulated_advice',
  'provider_steering',
  'pii',
  'credential',
])

const MIN_REASONING_CHARS = 40

const ADVICE_PATTERNS: RegExp[] = [
  /\b(you should|we recommend|i recommend|we suggest|you must|you need to)\s+(buy(ing)?|purchas(e|ing)|switch(ing)?|invest(ing)?|sell(ing)?|tak(e|ing) out|mov(e|ing) your|transfer(ring)?)\b/i,
  /\bguaranteed\s+(returns?|payouts?|cover)\b/i,
  /\b(invest|put your money)\s+in\b/i,
]

const STEERING_PATTERNS: RegExp[] = [
  /\bswitch\s+(to|from)\b/i,
  /\bbest\s+(policy|policies|insurer|provider|fund|plan|deal)\b/i,
  /\b(cheapest|top-rated|recommended)\s+(policy|insurer|provider|fund|plan)\b/i,
]

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const UK_NI = /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/i
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/
const CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g

const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bbearer\s+[A-Za-z0-9._-]{16,}/i,
  /\b(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*\S+/i,
]

function luhnValid(digits: string): boolean {
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

function hasCardNumber(text: string): boolean {
  for (const match of text.matchAll(CARD_CANDIDATE)) {
    const digits = match[0].replace(/[ -]/g, '')
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true
  }
  return false
}

/** Scan one string for blocking content. Exported for template-level tests. */
export function scanText(text: string): GuardReason[] {
  const reasons = new Set<GuardReason>()
  if (ADVICE_PATTERNS.some(p => p.test(text))) reasons.add('regulated_advice')
  if (STEERING_PATTERNS.some(p => p.test(text))) reasons.add('provider_steering')
  if (EMAIL.test(text) || UK_NI.test(text) || IBAN.test(text) || hasCardNumber(text)) reasons.add('pii')
  if (CREDENTIAL_PATTERNS.some(p => p.test(text))) reasons.add('credential')
  return [...reasons]
}

export function runMoveGuard(insight: Insight): GuardResult {
  const reasons = new Set<GuardReason>()

  for (const text of [insight.reasoning ?? '', ...(insight.actions ?? [])]) {
    for (const r of scanText(text)) reasons.add(r)
  }

  if (insight.estimated_impact_low < 0 || insight.estimated_impact_low > insight.estimated_impact_high) {
    reasons.add('impact_range_invalid')
  }
  if ((insight.reasoning ?? '').trim().length < MIN_REASONING_CHARS) reasons.add('reasoning_too_short')
  if ((insight.actions ?? []).length === 0) reasons.add('no_actions')

  const list = [...reasons]
  if (list.some(r => BLOCKING.has(r))) return { outcome: 'block', reasons: list }
  if (list.length > 0) return { outcome: 'review', reasons: list }
  return { outcome: 'clean', reasons: [] }
}
