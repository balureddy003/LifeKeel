/**
 * Copy for "Keep this result" (PRD-203/204). Kept as constants so the
 * advice-rule test can scan them and so a line that stops being true is
 * changed in one place. Every line must be literally true of the product
 * today; do not add a promise whose code has not shipped.
 */

/** Bump together with MARKETING_CONSENT_VERSION in apps/api/src/routes/magic-link.ts. */
export const MARKETING_CONSENT_VERSION = 'marketing-2026-10-v1'

export const MARKETING_CONSENT_TEXT =
  'Also send me occasional LifeKeel product updates and family-readiness tips.'

/** What happens to the address at the moment of the click (PRD-203 amendment 2). */
export const SAVE_EXPLAINER =
  'When you press the button we store your six answers and this address for 24 hours so we can send you a link. If you never open it, they are deleted.'

export const TRUST_TITLE = 'What we do and don’t do'

export const TRUST_LINES: readonly string[] = [
  'No commissions or referral fees: Keel earns from subscriptions only.',
  'No insurer or provider is named in your result.',
  'We don’t sell your contact details.',
  'No password to set: the email carries a link and a code.',
]

export const UNMEASURED_NOTE =
  'This is an estimate from six answers. It covers the areas below and leaves the others unmeasured.'
