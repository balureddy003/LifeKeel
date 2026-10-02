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

  it('matches figures whose formatting differs (commas, spacing, plural units)', () => {
    const draft = 'We believe we would need £55,000 per year, i.e. £250000 in cover for 14 month.'
    const { facts } = extractDraftProvenance(source, draft)
    expect(facts).toEqual(['£250,000', '£55,000', '14 months'])
  })

  it('does not match a currency-swapped figure — that is a fabrication, not a retrieved fact', () => {
    const draft = 'I am writing about our cover of $250,000.'
    expect(extractDraftProvenance(source, draft).facts).toEqual([])
  })

  it('does not match a figure stripped of its currency symbol', () => {
    const draft = 'We believe we would need 55000 per year.'
    expect(extractDraftProvenance(source, draft).facts).toEqual([])
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
