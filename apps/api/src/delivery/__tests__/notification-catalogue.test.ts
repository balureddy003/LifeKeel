/**
 * The notification catalogue is the closed set of what LifeKeel may send: the
 * only lock-screen words, a reason for every kind, no pressure wording, and
 * safeguarding kinds that never push by default.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MUTABLE_KIND_IDS,
  NOTIFICATION_KINDS,
  PUSH_BODIES,
  isKindMuted,
  kindById,
  liveKinds,
  lockScreenProblems,
  pushBodyFor,
} from '../notification-catalogue.js'
import { buildAlertPushPayload, buildDigestPushPayload } from '../push-payload.js'

describe('lock-screen safety', () => {
  it('every push body passes: no digit, currency symbol or name', () => {
    for (const body of PUSH_BODIES) expect(lockScreenProblems(body), body).toEqual([])
  })

  it('the checker catches what it should', () => {
    expect(lockScreenProblems('Alex updated 3 records')).toEqual(
      expect.arrayContaining(['contains a digit', 'opening word "Alex"']),
    )
    expect(lockScreenProblems('Updated by Alex')).toContain('capitalised word "Alex"')
    expect(lockScreenProblems('Renewal of £120 is due')).toContain('contains a currency symbol')
    expect(lockScreenProblems('Your Aviva cover is due')).toContain('capitalised word "Aviva"')
    expect(lockScreenProblems('You have a new update in LifeKeel.')).toEqual([])
  })

  it('the payload builders only ever produce words from the catalogue', () => {
    for (const urgency of ['critical', 'high', 'medium', 'low'] as const) {
      const p = buildAlertPushPayload({ urgency, action_url: '/x' })
      expect(PUSH_BODIES.has(p.body)).toBe(true)
      expect(p.title).toBe('LifeKeel')
    }
    for (const kind of [
      'quiet_care_digest',
      'quiet_care_digest_missed',
      'weekly_heartbeat',
    ] as const)
      expect(PUSH_BODIES.has(buildDigestPushPayload(kind, '/x').body)).toBe(true)
  })

  it('push-payload.ts holds no sentence of its own, so nothing can bypass the set', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'push-payload.ts'), 'utf8')
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    expect(code).not.toMatch(/['"`][A-Z][^'"`\n]{12,}['"`]/)
  })

  it('refuses a body or variant that is not in the catalogue', () => {
    expect(() => pushBodyFor('insight_alert', 'nope')).toThrow()
    expect(() => pushBodyFor('nope', 'ready')).toThrow()
  })
})

describe('what each kind promises', () => {
  it('states a reason for every kind, with no pressure wording', () => {
    const PRESSURE =
      /streak|days since|your family is waiting|don'?t miss|last visit|haven'?t (opened|visited)|running out/i
    for (const k of NOTIFICATION_KINDS) {
      expect(k.reason.length, k.id).toBeGreaterThan(10)
      for (const text of [k.label, k.reason, ...Object.values(k.push_bodies)])
        expect(text, `${k.id}: ${text}`).not.toMatch(PRESSURE)
    }
  })

  it('has unique ids and gives every non-mutable kind a reason it is fixed', () => {
    const ids = NOTIFICATION_KINDS.map((k) => k.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const k of NOTIFICATION_KINDS.filter((x) => !x.mutable))
      expect(k.fixed_because, k.id).toBeTruthy()
  })

  it('never pushes for a safeguarding kind by default', () => {
    for (const k of NOTIFICATION_KINDS.filter((x) => x.safeguarding))
      expect(k.channels, k.id).not.toContain('push')
  })

  it('a family can only mute live kinds that are mutable', () => {
    expect([...MUTABLE_KIND_IDS].sort()).toEqual(
      liveKinds()
        .filter((k) => k.mutable)
        .map((k) => k.id)
        .sort(),
    )
    expect(MUTABLE_KIND_IDS).not.toContain('policy_renewal_reminder')
    expect(MUTABLE_KIND_IDS).not.toContain('date_upcoming')
  })

  it('isKindMuted honours only mutable kinds', () => {
    expect(isKindMuted({ kinds_muted: ['quiet_care_digest'] }, 'quiet_care_digest')).toBe(true)
    expect(
      isKindMuted({ kinds_muted: ['policy_renewal_reminder'] }, 'policy_renewal_reminder'),
    ).toBe(false)
    expect(isKindMuted(null, 'quiet_care_digest')).toBe(false)
    expect(kindById('join_approved')?.audience).toBe('requester')
  })
})

describe('the catalogue is honest about reach', () => {
  it('lists every channel an alert reaches, not only the lock-screen-safe ones', () => {
    // channels.ts sends the finding, a confidence figure and an approve link by
    // SMS, WhatsApp and chat; the push closed set does not cover them.
    expect(kindById('insight_alert')?.channels).toEqual(
      expect.arrayContaining(['push', 'email', 'sms', 'whatsapp', 'chat']),
    )
  })

  it('separates the reporter-only checklist reminder from the vault reminder that reaches other adults', () => {
    expect(kindById('life_event_checklist_reminder')?.fixed_because).toMatch(
      /only to the person who reported/,
    )
    const vault = kindById('life_event_vault_reminder')!
    expect(vault.fixed_because).toMatch(/other adults/)
    expect(vault.fixed_because).toMatch(/names who reported/)
    expect(vault.safeguarding).toBe(true)
    expect(vault.channels).not.toContain('push')
    expect(kindById('life_event_reminder')).toBeUndefined()
  })
})
