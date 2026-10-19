/**
 * The landing board may only say what the claims registry backs. A live claim
 * needs a file that exists; planned items carry no Live tag; blocked wording
 * must not appear in any landing source file.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CLAIMS } from '../claims'
import { CAPABILITIES } from '../capabilities'
import { SCENARIOS, SAMPLE_FAMILY, runwayMonths, seaState } from '../scenarios'

const REPO = path.resolve(__dirname, '..', '..', '..', '..', '..', '..')
const LANDING = path.resolve(__dirname, '..')

const byId = new Map(CLAIMS.map((c) => [c.id, c]))

function landingSources(): { file: string; text: string }[] {
  return fs
    .readdirSync(LANDING)
    .filter((f) => /\.(ts|tsx)$/.test(f) && f !== 'claims.ts')
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(LANDING, f), 'utf8') }))
}

function forbiddenHits(text: string, phrases: string[]): string[] {
  const lower = text.toLowerCase()
  return phrases.filter((p) => lower.includes(p.toLowerCase()))
}

describe('landing claims registry', () => {
  it('claim ids are unique', () => {
    expect(new Set(CLAIMS.map((c) => c.id)).size).toBe(CLAIMS.length)
  })

  it('every live claim names an implementing file that exists', () => {
    const missing = CLAIMS.filter((c) => c.status === 'live')
      .filter((c) => !c.evidence || !fs.existsSync(path.join(REPO, c.evidence)))
      .map((c) => `${c.id}: ${c.evidence ?? 'no evidence'}`)
    expect(missing).toEqual([])
  })

  it('every board item maps to a claim, and its Live tag matches the claim status', () => {
    const problems = CAPABILITIES.flatMap((cap) => {
      const claim = byId.get(cap.claim)
      if (!claim) return [`${cap.text}: unknown claim ${cap.claim}`]
      if (claim.status === 'blocked') return [`${cap.text}: blocked claim on the board`]
      if (cap.live !== (claim.status === 'live')) return [`${cap.text}: tag does not match claim`]
      if (cap.live && !cap.qualifier) return [`${cap.text}: Live without a qualifier`]
      if (!cap.live && cap.qualifier) return [`${cap.text}: Planned item with a qualifier`]
      return []
    })
    expect(problems).toEqual([])
  })

  it('every non-blocked claim appears on the board once', () => {
    const used = CAPABILITIES.map((c) => c.claim)
    const unused = CLAIMS.filter((c) => c.status !== 'blocked' && !used.includes(c.id)).map(
      (c) => c.id,
    )
    expect(unused).toEqual([])
    expect(new Set(used).size).toBe(used.length)
  })

  it('blocked wording appears in no landing source file', () => {
    const phrases = CLAIMS.filter((c) => c.status === 'blocked').flatMap((c) => c.forbidden ?? [])
    expect(phrases.length).toBeGreaterThan(0)
    const hits = landingSources().flatMap(({ file, text }) =>
      forbiddenHits(text, phrases).map((p) => `${file}: "${p}"`),
    )
    expect(hits).toEqual([])
  })

  it('the forbidden-wording check catches a blocked phrase (test would fail without it)', () => {
    expect(forbiddenHits('Sign in with no password at all', ['no password'])).toEqual([
      'no password',
    ])
    expect(forbiddenHits('Sign in with Google', ['no password'])).toEqual([])
  })
})

describe('sample day maths', () => {
  const months = SCENARIOS.map((s) => runwayMonths(s.calc(SAMPLE_FAMILY)))

  it('gives the figures the concept showed', () => {
    expect(months[0]).toBeCloseTo(8.2, 1)
    expect(months[1]).toBeCloseTo(21320 / 1000, 1)
    expect(months[2]).toBeCloseTo(21320 / (2600 + 650 - 2240), 1)
    expect(months[3]).toBeCloseTo((21320 + 150000) / 2600, 1)
  })

  it('bands months into sea states and never divides by a zero gap', () => {
    expect(seaState(2.9)).toBe('rough')
    expect(seaState(3)).toBe('holding')
    expect(seaState(6)).toBe('steady')
    expect(runwayMonths({ income: 3000, spend: 2600, fund: 100 })).toBe(Infinity)
  })
})
