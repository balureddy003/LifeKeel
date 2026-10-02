import type { FetchedEmail } from './imap-client.js'

/**
 * Free first pass before any model sees an email.
 *
 * The classifier only surfaces mail that is ABOUT a policy or long-term
 * protection commitment (see classify.ts SYSTEM_PROMPT). Any such email names
 * its subject somewhere in the sender, subject or opening text, so mail with
 * none of these terms cannot qualify and needs no model call. The list is
 * deliberately broad: it is a recall filter, so a false "maybe" only costs a
 * model call, while a false "no" would silently drop a real policy email.
 */
const POLICY_TERMS = new RegExp(
  [
    'insur', 'assur', 'polic(y|ies)', 'cover(age)?\\b', 'premium', 'renew', 'claim',
    'beneficiar', 'underwrit', 'indemnity', 'annuit', 'pension', 'sipp', 'isa\\b',
    'mortgage', 'remortgage', 'loan', 'your will\\b', 'a will\\b', 'last will', 'wills\\b', 'testament', 'estate', 'probate',
    'power of attorney', 'lasting power', 'trust\\b', 'tax', 'hmrc', 'irs',
    'critical illness', 'income protection', 'life cover', 'health plan',
    'assistance', 'roadside', 'breakdown', 'warranty', 'schedule of', 'endorsement',
    'bupa', 'aviva', 'axa', 'allianz', 'zurich', 'prudential', 'legal & general',
  ].join('|'),
  'i',
)

export function mightBePolicyRelated(email: Pick<FetchedEmail, 'from' | 'subject' | 'textSnippet'>): boolean {
  // Opening text only: policy mail states its subject up front, and scanning
  // the full 4k snippet would let a long marketing footer re-admit newsletters.
  const haystack = `${email.from}\n${email.subject}\n${email.textSnippet.slice(0, 1200)}`
  return POLICY_TERMS.test(haystack)
}
