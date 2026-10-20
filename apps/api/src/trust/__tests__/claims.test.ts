/** PRD-208: a claim is public only while it is evidenced, owned and in date. */
import { describe, expect, it } from 'vitest'
import { evaluateClaims, loadClaims, parseClaims, type EvidenceRecord } from '../claims.js'

const NOW = new Date('2026-10-20T00:00:00Z')
const rec = (id: string, renew: string): EvidenceRecord => ({
  claim_id: id,
  owner: 'Sam',
  verified_at: new Date('2026-09-01'),
  renew_by: new Date(renew),
})

describe('evaluateClaims', () => {
  const claims = loadClaims()
  const publishable = claims.find((c) => c.publishable)!
  const unpublishable = claims.find((c) => !c.publishable)!

  it('publishes nothing until an owner has recorded evidence', () => {
    const out = evaluateClaims(claims, [], NOW)
    expect(out.filter((c) => c.state === 'published')).toEqual([])
    expect(out.find((c) => c.id === publishable.id)!.state).toBe('needs_owner')
  })
  it('publishes an owned claim that is in date, and drops it once the renewal date passes', () => {
    expect(
      evaluateClaims(claims, [rec(publishable.id, '2027-01-01')], NOW).find(
        (c) => c.id === publishable.id,
      )!.state,
    ).toBe('published')
    expect(
      evaluateClaims(claims, [rec(publishable.id, '2026-10-01')], NOW).find(
        (c) => c.id === publishable.id,
      )!.state,
    ).toBe('stale')
  })
  it('never publishes a claim without evidence, even with a record', () => {
    expect(
      evaluateClaims(claims, [rec(unpublishable.id, '2027-01-01')], NOW).find(
        (c) => c.id === unpublishable.id,
      )!.state,
    ).toBe('not_evidenced')
  })
})

describe('register file', () => {
  it('states facts only: no recommendation verbs and no provider names', () => {
    const text = loadClaims()
      .map((c) => `${c.statement} ${c.evidence?.how ?? ''}`)
      .join('\n')
    expect(text).not.toMatch(/\b(should|buy|switch|recommend|best|cheapest)\b/i)
    expect(text).not.toMatch(/anthropic|openai|google|azure|aws|mistral|ollama/i)
  })
  it('keeps the unevidenced claims out of the public set', () => {
    const ids = loadClaims()
      .filter((c) => !c.publishable)
      .map((c) => c.id)
    for (const id of ['no_training', 'pen_test', 'dpia_summary', 'cyber_essentials_plus'])
      expect(ids).toContain(id)
  })
  it('rejects a publishable claim with no evidence and an unpublished claim with no reason', () => {
    expect(() => parseClaims({ claims: [{ id: 'a', statement: 'x', publishable: true }] })).toThrow(
      /no evidence/,
    )
    expect(() =>
      parseClaims({ claims: [{ id: 'a', statement: 'x', publishable: false }] }),
    ).toThrow(/no reason/)
  })
})
