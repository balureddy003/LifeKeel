/**
 * PRD-143 pure pieces: the field set cannot carry medical text or names,
 * values are grounded in the document's own text with a real span, confidence
 * comes from that grounding and not from the model, and a review is all or
 * nothing.
 */
import { describe, expect, it } from 'vitest'
import { FIELD_KEYS, FIELD_SPECS, SPEC_BY_KEY, normaliseValue } from '../schema.js'
import {
  CLASSIFICATION_THRESHOLD,
  REVIEW_THRESHOLD,
  classificationConfidence,
  groundField,
  needsTypeConfirmation,
} from '../grounding.js'
import {
  applyReview,
  buildCandidates,
  confirmedFields,
  unreviewedLowConfidence,
} from '../pipeline.js'

describe('the v1 field set', () => {
  it('is exactly the detector and playbook inputs: no summary, no names, no free text, nothing medical', () => {
    expect([...FIELD_KEYS].sort()).toEqual(
      [
        'balance',
        'claims_email',
        'claims_phone',
        'coverage_amount',
        'document_date',
        'gross_pay',
        'has_beneficiary',
        'net_pay',
        'policy_number',
        'policy_type',
        'premium',
        'provider',
        'renewal_date',
      ].sort(),
    )
    const forbidden =
      /summary|medical|health_|diagnos|condition|name|address|beneficiary$|note|text|description/i
    for (const k of FIELD_KEYS) {
      // has_beneficiary is a yes/no, not the beneficiary's name.
      expect(
        k === 'has_beneficiary' || !forbidden.test(k),
        `field '${k}' looks like free text`,
      ).toBe(true)
    }
    expect(SPEC_BY_KEY['has_beneficiary']!.kind).toBe('bool')
  })

  it('every field has a length cap and says which detector or playbook reads it', () => {
    for (const f of FIELD_SPECS) {
      expect(Number.isFinite(f.max) && f.max > 0 && f.max <= 80).toBe(true)
      expect(f.used_by.length).toBeGreaterThan(8)
    }
  })

  it('drops invalid values instead of repairing them', () => {
    const n = (key: string, v: unknown) => normaliseValue(SPEC_BY_KEY[key]!, v)
    expect(n('has_beneficiary', 'Yes')).toBe('yes')
    expect(n('has_beneficiary', 'Mrs Jane Doe')).toBeNull()
    expect(n('policy_type', 'Critical Illness')).toBe('critical_illness')
    expect(n('policy_type', 'pet')).toBeNull()
    expect(n('coverage_amount', 'a lot')).toBeNull()
    expect(n('coverage_amount', '£250,000')).toBe('£250,000')
    expect(n('claims_email', 'not an email')).toBeNull()
    expect(n('claims_phone', '0800 123 456')).toBe('0800 123 456')
    expect(n('claims_phone', '12')).toBeNull()
    expect(n('provider', 'x'.repeat(81))).toBeNull()
    expect(n('provider', 42)).toBeNull()
    expect(n('provider', '   ')).toBeNull()
  })
})

describe('grounding', () => {
  const text =
    'Life Policy POL-77\nSum assured:  £250,000\nPremium £32.50 a month. Renews 1 March 2027.\nBeneficiary: named on page 2.'

  it('a value found once is grounded with a span that really points at it, and a bounded snippet', () => {
    const g = groundField('coverage_amount', '£250,000', text)
    expect(g).toMatchObject({ grounding: 'verbatim_unique', confidence: 0.95 })
    expect(text.slice(g.span!.start, g.span!.end)).toBe('£250,000')
    expect(g.snippet).toContain('Sum assured')
    expect(g.snippet!.length).toBeLessThanOrEqual(220)
  })

  it('ignores case and spacing differences, and finds money written with other separators', () => {
    expect(groundField('provider', 'life policy', text).grounding).toBe('verbatim_unique')
    const g = groundField('coverage_amount', '250 000', 'Sum assured 250,000 GBP')
    expect(g.grounding).toBe('verbatim_unique')
    expect('Sum assured 250,000 GBP'.slice(g.span!.start, g.span!.end)).toBe('250,000')
  })

  it('a value that appears several times is ambiguous, and one that does not appear is flagged low', () => {
    expect(groundField('premium', '£1', 'Premium £1 then £1 again')).toMatchObject({
      grounding: 'verbatim_ambiguous',
      confidence: 0.75,
    })
    const missing = groundField('provider', 'Acme Assurance', text)
    expect(missing).toMatchObject({
      grounding: 'not_found',
      confidence: 0.2,
      span: null,
      snippet: null,
    })
  })

  it('with no text (a photo read by hosted vision) nothing is verifiable, so everything is held for review', () => {
    const g = groundField('provider', 'Acme', null)
    expect(g).toMatchObject({ grounding: 'image_only', span: null, snippet: null })
    expect(g.confidence).toBeLessThan(REVIEW_THRESHOLD)
  })

  it('has_beneficiary: yes needs the word in the text; no is an absence and cannot be proven', () => {
    expect(groundField('has_beneficiary', 'yes', text)).toMatchObject({ grounding: 'keyword' })
    expect(groundField('has_beneficiary', 'yes', 'No such section')).toMatchObject({
      grounding: 'not_found',
      confidence: 0.2,
    })
    expect(groundField('has_beneficiary', 'no', 'No such section')).toMatchObject({
      grounding: 'absence',
      span: null,
    })
    expect(groundField('has_beneficiary', 'no', text).confidence).toBeLessThan(REVIEW_THRESHOLD)
  })

  it('confidence never depends on anything the model said', () => {
    // Same value, same text: same answer. There is no model input to the function.
    expect(groundField('premium', '£32.50', text)).toEqual(groundField('premium', '£32.50', text))
  })
})

describe('classification confidence', () => {
  it('two telling words is firm, one is weak, none is doubtful, and a photo cannot be checked', () => {
    const policy = 'This policy has a monthly premium and sum assured. Claims line below.'
    expect(classificationConfidence('insurance', policy)).toBeGreaterThanOrEqual(
      CLASSIFICATION_THRESHOLD,
    )
    expect(classificationConfidence('insurance', 'Policy TR-1')).toBe(0.7)
    expect(classificationConfidence('insurance', 'A letter about your garden')).toBe(0.3)
    expect(classificationConfidence('pension', null)).toBeLessThan(CLASSIFICATION_THRESHOLD)
    expect(needsTypeConfirmation('insurance', 0.7)).toBe(true)
    expect(needsTypeConfirmation('insurance', 0.9)).toBe(false)
    expect(needsTypeConfirmation('other', 0.6)).toBe(false)
  })
})

describe('candidates and review', () => {
  const doc =
    'Life policy. Sum assured £250,000. Premium £32.50. Beneficiary named. Policy number TR-123.'
  const build = () =>
    buildCandidates({
      tenantId: 't1',
      documentId: 'd1',
      category: 'insurance',
      rawFields: {
        provider: 'Acme', // not in the text
        coverage_amount: '£250,000',
        premium: '£32.50',
        policy_number: 'TR-123',
        has_beneficiary: 'yes',
        net_pay: '£2,000', // income field on an insurance document
        policy_type: 'pet', // invalid
        summary: 'A free-text summary the model volunteered',
        beneficiary: 'Mrs Jane Doe',
      },
      text: doc,
      extractor: { kind: 'local', model: 'm' },
    })

  it('keeps only valid, in-category fields, drops the rest, and never carries a summary or a name', () => {
    const c = build()
    expect(c.fields.map((f) => f.key).sort()).toEqual([
      'coverage_amount',
      'has_beneficiary',
      'policy_number',
      'premium',
      'provider',
    ])
    expect(c.dropped).toBe(2) // net_pay (wrong category) and policy_type (invalid)
    expect(JSON.stringify(c)).not.toMatch(/free-text summary|Jane Doe/)
  })

  it('flags the ungrounded field for review and leaves the grounded ones alone', () => {
    const c = build()
    expect(c.fields.find((f) => f.key === 'provider')).toMatchObject({
      needs_review: true,
      grounding: 'not_found',
    })
    expect(c.fields.find((f) => f.key === 'coverage_amount')).toMatchObject({
      needs_review: false,
      status: 'proposed',
    })
    expect(unreviewedLowConfidence(c)).toEqual(['provider'])
    expect(c.classification.needs_confirmation).toBe(false)
  })

  it('a review is all or nothing: one invalid decision changes nothing', () => {
    const c = build()
    const bad = applyReview(
      c,
      [
        { key: 'premium', action: 'confirm' },
        { key: 'provider', action: 'edit', value: '' },
      ],
      'u1',
    )
    expect(bad).toEqual({ ok: false, errors: [{ key: 'provider', reason: 'invalid_value' }] })
    expect(c.fields.every((f) => f.status === 'proposed')).toBe(true)
    for (const decisions of [
      [{ key: 'nope', action: 'confirm' as const }],
      [
        { key: 'premium', action: 'confirm' as const },
        { key: 'premium', action: 'reject' as const },
      ],
    ]) {
      expect(applyReview(c, decisions, 'u1').ok).toBe(false)
    }
  })

  it('confirm, edit and reject are recorded with who and when, and only confirmed or edited values are usable', () => {
    const r = applyReview(
      build(),
      [
        { key: 'coverage_amount', action: 'confirm' },
        { key: 'provider', action: 'edit', value: 'Acme Assurance' },
        { key: 'premium', action: 'reject' },
      ],
      'user-9',
      new Date('2026-10-20T10:00:00Z'),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const by = Object.fromEntries(r.candidates.fields.map((f) => [f.key, f]))
    expect(by['coverage_amount']).toMatchObject({ status: 'confirmed', decided_by: 'user-9' })
    expect(by['provider']).toMatchObject({ status: 'edited', edited_value: 'Acme Assurance' })
    expect(by['premium']!.status).toBe('rejected')
    expect(by['policy_number']!.status).toBe('proposed') // untouched
    expect(confirmedFields(r.candidates)).toEqual({
      coverage_amount: '£250,000',
      provider: 'Acme Assurance',
    })
    expect(unreviewedLowConfidence(r.candidates)).toEqual([])
  })
})
