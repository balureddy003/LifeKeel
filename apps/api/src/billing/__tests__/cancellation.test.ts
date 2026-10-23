import { describe, expect, it } from 'vitest'
import { churnFields, willCancel } from '../cancellation.js'

describe('willCancel', () => {
  it('is true for the legacy boolean', () => {
    expect(willCancel({ cancel_at_period_end: true })).toBe(true)
  })

  it('is true when a portal cancellation set cancel_at but left the boolean false (current Stripe API)', () => {
    expect(willCancel({ cancel_at_period_end: false, cancel_at: 1795459081 })).toBe(true)
  })

  it('is false for an active, renewing subscription', () => {
    expect(willCancel({ cancel_at_period_end: false, cancel_at: null })).toBe(false)
    expect(willCancel({})).toBe(false)
  })
})

describe('churnFields', () => {
  it("uses the survey answer, not Stripe's generic reason, as the churn reason", () => {
    // Captured from a real sandbox portal cancellation.
    expect(
      churnFields({ reason: 'cancellation_requested', feedback: 'too_expensive', comment: null }),
    ).toEqual({
      reason: 'too_expensive',
      feedback: null,
    })
  })

  it('keeps the free-text comment as feedback', () => {
    expect(
      churnFields({
        reason: 'cancellation_requested',
        feedback: 'other',
        comment: 'Moving abroad',
      }),
    ).toEqual({
      reason: 'other',
      feedback: 'Moving abroad',
    })
  })

  it("falls back to Stripe's reason when there was no survey (payment_failed)", () => {
    expect(churnFields({ reason: 'payment_failed', feedback: null })).toEqual({
      reason: 'payment_failed',
      feedback: null,
    })
  })

  it('treats a non-enum feedback string (older events, fixtures) as free text', () => {
    expect(churnFields({ reason: 'too_expensive', feedback: 'Not using it enough' })).toEqual({
      reason: 'too_expensive',
      feedback: 'Not using it enough',
    })
  })

  it('handles missing details and caps free text at 500 characters', () => {
    expect(churnFields(undefined)).toEqual({ reason: null, feedback: null })
    expect(churnFields({ comment: 'x'.repeat(900) }).feedback).toHaveLength(500)
  })
})
