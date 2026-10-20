/**
 * Words for the "who processes your documents" screen (PRD-142 amendment 3).
 * Constants so the advice-rule scan covers them, and so each claim is tied to
 * a status the registry actually reports: nothing here says a hosted provider
 * is approved, because none is until the owner supplies reviewed terms.
 */
import type { AiDisclosureProcessor, AiDisclosureTask } from './api'

export const RULE_TEXT =
  'LifeKeel’s rule: your family’s content is never used to train or fine-tune a shared or third-party AI model. A hosted provider only processes a request to answer it.'

export const STATUS_TEXT: Record<AiDisclosureProcessor['status'], string> = {
  run_by_lifekeel: 'Run by LifeKeel. No third party sees the content.',
  terms_under_review: 'Run by a third party. Its terms have not been reviewed yet.',
  approved: 'Run by a third party. Its terms have been reviewed.',
  review_overdue: 'Run by a third party. Its review is overdue.',
}

export const WHERE_TEXT: Record<AiDisclosureTask['where'], string> = {
  device: 'Only on your device.',
  lifekeel: 'Only on LifeKeel’s own servers.',
  lifekeel_or_hosted:
    'On LifeKeel’s own model when it is switched on. Otherwise on a hosted provider.',
  hosted: 'On a hosted provider.',
}

export const RETENTION_TEXT: Record<string, string> = {
  none: 'Nothing is kept by the provider.',
  zero_data_retention: 'The provider keeps no copy, by contract.',
  service_transient: 'Kept only while the request is processed.',
  limited_abuse_log: 'May be kept briefly for abuse monitoring.',
  unknown: 'Not recorded.',
}

export const UNREVIEWED_NOTE =
  'For a provider whose terms are not yet reviewed, how long it keeps content is not confirmed.'
