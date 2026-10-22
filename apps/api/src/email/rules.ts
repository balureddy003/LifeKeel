import type { EmailClassification } from './classify.js'
import type { FetchedEmail } from './imap-client.js'

/**
 * Deterministic rules that run before any model or encoder.
 *
 * A reminder to review an existing will or lasting power of attorney is the
 * kind of mail the product exists to surface, and measured on qwen2.5:7b the
 * model drops it every time (it reads the sender as a sales pitch). A rule is
 * the cheapest and most predictable fix: no model call, no latency, and the
 * same answer every run.
 *
 * Deliberately narrow, so it cannot become a keyword catch-all:
 *  - the email must ask the reader to review/update/check a will or power of
 *    attorney they already have ("your", "the", "existing"), so "write your
 *    will today" or "make a will" does not match;
 *  - sales language anywhere in the subject or opening text (offer, discount,
 *    % off, get a quote, ...) vetoes the match.
 *
 * The result is a fixed template. No text from the email reaches the summary,
 * so an attacker cannot use this path to put their own words in front of a
 * family; the worst a spoofed match does is show a review nudge.
 */

const REVIEW_VERB = '(?:review|update|revisit|refresh|check|renew)'
const OWNED = '(?:your|the|an?\\s+existing|existing)'

const WILL = new RegExp(
  `\\b${REVIEW_VERB}\\b[^.!?\\n]{0,40}\\b${OWNED}\\s+(?:last\\s+)?wills?\\b(?!\\s+(?:be|not|have|need|also|receive|arrive))`,
  'i',
)
const POWER_OF_ATTORNEY = new RegExp(
  `\\b${REVIEW_VERB}\\b[^.!?\\n]{0,40}\\b${OWNED}\\s+(?:lasting\\s+power(?:s)?\\s+of\\s+attorney|power(?:s)?\\s+of\\s+attorney|lpa)\\b`,
  'i',
)

const SALES_LANGUAGE =
  /\b(offers?|discount|% off|\d+\s?% off|promo(?:tion)?|sale|limited time|get a quote|free will|special price|deal|bonus|voucher|coupon|save \d)/i

function kindOf(text: string): 'will' | 'lpa' | null {
  if (POWER_OF_ATTORNEY.test(text)) return 'lpa'
  if (WILL.test(text)) return 'will'
  return null
}

/**
 * A fixed classification for a will / lasting power of attorney review
 * reminder, or null when the email is not one. Never throws.
 */
export function willOrPowerOfAttorneyReminder(
  email: Pick<FetchedEmail, 'subject' | 'textSnippet'>,
): EmailClassification | null {
  // Opening text only, as in the prefilter: a long marketing footer must not re-admit a newsletter.
  const text = `${email.subject}\n${email.textSnippet.slice(0, 1200)}`
  if (SALES_LANGUAGE.test(text)) return null
  const kind = kindOf(text)
  if (!kind) return null
  return kind === 'will'
    ? {
        isFinancial: true,
        summary: 'This email reminds you to review your will.',
        actionLabel: 'Review your will',
        actionType: 'review',
        priority: 'medium',
      }
    : {
        isFinancial: true,
        summary: 'This email reminds you to review your lasting power of attorney.',
        actionLabel: 'Review your LPA',
        actionType: 'review',
        priority: 'medium',
      }
}
