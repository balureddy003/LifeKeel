/**
 * Words for the extraction review screen (PRD-143). Constants so the
 * advice-rule scan covers them. They say what the document states and what
 * the person still has to check; they never compare products or recommend.
 *
 * The real control is confirm-before-commit (amendment 3): an automatic read
 * can be wrong or can be steered by text inside the document, so nothing is
 * saved until a person confirms it. The copy says that plainly instead of
 * implying the read is safe.
 */
import type { DocumentCandidate } from './api'

export const REVIEW_TITLE = 'Check what Keel read'

export const REVIEW_INTRO =
  'Keel reads documents automatically, and a read can be wrong. It only saves what you confirm. Check each value against the original.'

export const FIELD_LABELS: Record<string, string> = {
  provider: 'Provider',
  policy_type: 'Type of cover',
  policy_number: 'Policy number',
  coverage_amount: 'Amount covered',
  premium: 'Premium',
  renewal_date: 'Renewal date',
  has_beneficiary: 'A beneficiary is named',
  claims_phone: 'Claims phone',
  claims_email: 'Claims email',
  balance: 'Balance',
  net_pay: 'Net pay',
  gross_pay: 'Gross pay',
  document_date: 'Document date',
}

export const GROUNDING_TEXT: Record<DocumentCandidate['grounding'], string> = {
  verbatim_unique: 'Found in the document.',
  verbatim_ambiguous: 'Appears more than once in the document. Check it is the right one.',
  keyword: 'The document mentions a beneficiary.',
  absence: 'Nothing about a beneficiary was found. Check the original.',
  not_found: 'Not found in the document text. Check it against the original.',
  image_only:
    'Read from an image, so it cannot be matched to the text. Check it against the original.',
}

export const TYPE_CARD_TITLE = 'What is this document?'
export const TYPE_CARD_TEXT =
  'The wording does not clearly match the type Keel chose. Tell Keel what it is before anything is saved.'

export const READ_FAILED_TITLE = 'Keel could not read this document'
export const READ_FAILED_TEXT =
  'Nothing was saved. You can enter the details yourself in your Financial Profile.'

export const SCAN_FAILED_TEXT =
  'This file could not be checked by the security scan, so it was kept but not read.'

export const NO_FIELDS_TEXT = 'Keel did not find any of the details it looks for in this document.'

export const SAVE_HINT = 'Confirm, edit or reject each value, then use it in your profile.'

export const FIRST_ADDED = (needCheck: number, total: number) =>
  needCheck === 0
    ? `${total} ${total === 1 ? 'value' : 'values'} found. Confirm each one you want to use.`
    : `${needCheck} of ${total} ${total === 1 ? 'value needs' : 'values need'} your check before it can be used.`

/** "Dated 12 March 2025, 19 months ago" or null when the date cannot be read. */
export function documentAgeText(
  raw: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!raw) return null
  const t = Date.parse(raw)
  if (Number.isNaN(t)) return null
  const months = Math.floor((now.getTime() - t) / (30.44 * 86_400_000))
  if (months < 0) return `Dated ${raw}.`
  if (months < 2) return `Dated ${raw}, recent.`
  const age = months >= 24 ? `${Math.floor(months / 12)} years ago` : `${months} months ago`
  return months >= 12
    ? `Dated ${raw}, ${age}. Figures this old may have changed.`
    : `Dated ${raw}, ${age}.`
}
