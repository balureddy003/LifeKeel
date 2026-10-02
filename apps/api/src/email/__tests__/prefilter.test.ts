import { describe, expect, it } from 'vitest'
import { mightBePolicyRelated } from '../prefilter.js'
import { LABELLED_EMAILS } from '../__fixtures__/labelled-emails.js'

describe('mightBePolicyRelated', () => {
  const positives = LABELLED_EMAILS.filter(e => e.isFinancial)
  const negatives = LABELLED_EMAILS.filter(e => !e.isFinancial)

  // Recall is the property that matters: a false "no" silently drops a real
  // policy email. A false "maybe" only costs one model call.
  it.each(positives.map(e => [e.name, e] as const))('never drops the policy email %s', (_name, e) => {
    expect(mightBePolicyRelated(e)).toBe(true)
  })

  it('skips the model for clearly unrelated mail', () => {
    const skipped = negatives.filter(e => !mightBePolicyRelated(e)).map(e => e.name)
    expect(skipped).toEqual(expect.arrayContaining(['card-alert', 'food-order', 'subscription-receipt', 'api-limit', 'statement-available', 'social-notification']))
  })

  it('is only a recall filter: marketing that mentions a SIPP still reaches the classifier', () => {
    const promo = negatives.find(e => e.name === 'newsletter-sipp-promo')!
    expect(mightBePolicyRelated(promo)).toBe(true)
  })

  it('only looks at the opening text so a long footer cannot re-admit a newsletter', () => {
    const email = { from: 'a@b.example', subject: 'Big sale', textSnippet: 'x'.repeat(2000) + ' insurance pension mortgage' }
    expect(mightBePolicyRelated(email)).toBe(false)
  })
})
