/**
 * Health is special-category data (UK GDPR Art. 9). LifeKeel has no reviewed
 * Art. 9 condition for processing it, and the product keeps health out of
 * scope by design, so free text a family writes (life-event notes, the
 * household context note) has health terms removed before it is put into
 * a model prompt (R13). The family's own record is unchanged; only the
 * copy sent for processing is minimised.
 *
 * A term list is a minimisation control, not a guarantee: it will miss
 * phrasing it doesn't know. Document and email extraction are a separate
 * path, recorded as an open item in docs/reviews/SECURITY_AND_COMPLIANCE.md.
 */

const HEALTH_TERMS = [
  'a&e',
  'accident and emergency',
  'icu',
  'intensive care',
  'hospital(?:ised|ized|isation|ization)?',
  'hospice',
  'surgery',
  'operation',
  'diagnos(?:is|ed|es)',
  'cancer',
  'tumou?r',
  'chemo(?:therapy)?',
  'radiotherapy',
  'stroke',
  'heart attack',
  'dementia',
  "alzheimer'?s",
  "parkinson'?s",
  'diabet(?:es|ic)',
  'hiv',
  'pregnan(?:t|cy)',
  'miscarriage',
  'ivf',
  'depress(?:ion|ed)',
  'anxiety',
  'mental health',
  'bipolar',
  'schizophreni[ac]',
  'autis(?:m|tic)',
  'adhd',
  'disab(?:led|ility)',
  'medication',
  'prescription',
  'therapy',
  'rehab(?:ilitation)?',
  'illness',
  'terminal(?:ly)? ill',
  'sick(?:ness)?',
]

const HEALTH_RE = new RegExp(`\\b(?:${HEALTH_TERMS.join('|')})\\b`, 'gi')
export const HEALTH_PLACEHOLDER = '[health detail withheld]'

export function withoutHealthDetail(text: string): string {
  return text.replace(HEALTH_RE, HEALTH_PLACEHOLDER)
}
