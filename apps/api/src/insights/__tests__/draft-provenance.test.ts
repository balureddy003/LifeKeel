import { describe, expect, it } from 'vitest'
import { extractDraftProvenance } from '../draft-provenance.js'

describe('extractDraftProvenance', () => {
  const source = 'Your life cover of £250,000 leaves a gap: your family would need about £55,000 per year for 14 months of cover.'

  it('marks figures that survived verbatim into the draft as from-your-data', () => {
    const draft = 'I am writing to ask about our life cover of £250,000, which we understand covers 14 months.'
    const { facts } = extractDraftProvenance(source, draft)
    expect(facts).toContain('£250,000')
    expect(facts).toContain('14 months')
  })

  it('excludes source figures the draft did not carry over', () => {
    const draft = 'I am writing to ask about our life cover of £250,000.'
    const { facts } = extractDraftProvenance(source, draft)
    expect(facts).toEqual(['£250,000'])
  })

  it('matches figures whose formatting differs (commas, currency glyph, spacing)', () => {
    const draft = 'We believe we would need 55000 per year.'
    const { facts } = extractDraftProvenance(source, draft)
    expect(facts).toContain('£55,000')
  })

  it('returns no facts when the draft is pure generated wording', () => {
    const draft = 'Thank you for your time. I look forward to hearing from you.'
    expect(extractDraftProvenance(source, draft).facts).toEqual([])
  })

  it('does not treat bare digits as attributable facts', () => {
    const { facts } = extractDraftProvenance('There are 4 people in your household.', 'I have a question.')
    expect(facts).toEqual([])
  })

  it('dedupes repeated figures', () => {
    const { facts } = extractDraftProvenance('£100 saved and £100 more', '£100')
    expect(facts).toEqual(['£100'])
  })
})
