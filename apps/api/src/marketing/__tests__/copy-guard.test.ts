import { describe, it, expect } from 'vitest'
import { checkCopy } from '../copy-guard.js'
import { DETECTOR_CONTENT_POSTS } from '../../detector-content-posts.js'
import {
  leadWelcomeBody,
  leadEducationBody,
  leadLastCallBody,
  activationBody,
  upgradeBody,
  trialEndingBody,
  trialExpiredBody,
  winbackBody,
} from '../lifecycle-emails.js'

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('copy guard', () => {
  it.each([
    ['You should switch to a cheaper insurer', ['personal recommendation', 'buy/switch instruction', 'shopping-around nudge']],
    ['We recommend Aviva', ['personal recommendation', 'named provider']],
    ['Take the free 60-second readiness check', ['retired readiness quiz wording']],
    ['Keel is always on and your data is not used for training', ['blocked claim: always-on', 'blocked claim: no-training']],
    ['Your digital twin will optimise your savings', ['unsupported claim', 'savings or optimising promise']],
  ])('flags %s', (text, rules) => {
    const got = checkCopy(text, 'social').violations.map((v) => v.rule)
    for (const r of rules) expect(got, r).toContain(r)
  })

  it('passes plain information that points to a professional', () => {
    const t =
      "LifeKeel keeps your family's chart: what you hold on file, what looks missing and the steps if something happens. A licensed professional can advise on decisions. Free to start."
    expect(checkCopy(t, 'social')).toEqual({ ok: true, violations: [] })
  })

  it('allows the word "buy" in long-form blog text but not in social or email', () => {
    expect(checkCopy('The policy you buy depends on your situation.', 'blog').ok).toBe(true)
    expect(checkCopy('The policy you buy depends on your situation.', 'social').ok).toBe(false)
  })
})

describe('static marketing copy passes the guard', () => {
  it('every seeded blog post', () => {
    const bad = DETECTOR_CONTENT_POSTS.flatMap((p) =>
      checkCopy(`${p.title}\n${p.excerpt}\n${p.content}`, 'blog').violations.map((v) => `${p.slug}: ${v.rule} (${v.match})`),
    )
    expect(bad).toEqual([])
  })

  it('every lifecycle email body', () => {
    const u = 'https://app.example/unsub'
    const a = 'https://app.example'
    const bodies: Record<string, string> = {
      leadWelcome: leadWelcomeBody('Sam', a, u),
      leadEducation: leadEducationBody('Sam', a, u),
      leadLastCall: leadLastCallBody('Sam', a, u),
      activation: activationBody('Sam', a),
      upgrade: upgradeBody('Sam', a),
      trialEnding: trialEndingBody('Sam', new Date('2026-11-01'), a),
      trialExpired: trialExpiredBody('Sam', a),
      winback: winbackBody('Sam', a),
    }
    const bad = Object.entries(bodies).flatMap(([name, html]) =>
      checkCopy(strip(html), 'email').violations.map((v) => `${name}: ${v.rule} (${v.match})`),
    )
    expect(bad).toEqual([])
  })
})
