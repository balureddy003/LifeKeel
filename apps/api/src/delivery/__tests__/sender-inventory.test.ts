/**
 * A tripwire so nothing reaches a person without a decision about the
 * notification catalogue. It finds every file that sends email, push, SMS,
 * WhatsApp, chat or a Twilio message, and requires each to be listed here with
 * either the catalogue kinds it sends or the reason it is outside the
 * catalogue. A new sender fails this test until someone makes that decision,
 * the same way trust-tier-gate.test.ts stops a new ActionExecutor caller.
 * It is a tripwire, not proof: it finds the send primitives below, not every
 * way code could reach a person.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { kindById, NOTIFICATION_KINDS } from '../notification-catalogue.js'

const SRC = path.resolve(__dirname, '..', '..')

/** Fixed strings that mean "this file sends something to a person". */
const SEND_PRIMITIVES = [
  'sgMail.send(',
  'api.resend.com',
  'sendNotification(',
  'fcm.googleapis.com',
  'api.twilio.com',
  'messages.create(',
  'sendWebhook(',
]

interface Entry {
  /** Catalogue kinds this file can send. */
  kinds?: string[]
  /** Why it is outside the catalogue, when it is. */
  outside?: string
  /** A transport used by catalogue kinds elsewhere; it chooses nothing itself. */
  transport?: true
}

const ALLOWED: Record<string, Entry> = {
  'auth-email.ts': {
    kinds: ['join_approved', 'quiet_care_digest', 'weekly_heartbeat'],
    outside:
      'Account emails the person asked for (verification, OTP, password reset, family invite) are transactional. Continuity check-in and alert emails (PRD-130) are not yet catalogued.',
  },
  'delivery/channels.ts': { kinds: ['insight_alert'] },
  'delivery/web-push-sender.ts': { transport: true },
  'delivery/fcm-sender.ts': { transport: true },
  'email/transport.ts': { transport: true },
  'life-events/vault-reminder.ts': { kinds: ['life_event_vault_reminder'] },
  'life-events/checklist-reminder.ts': { kinds: ['life_event_checklist_reminder'] },
  'marketing/lifecycle-emails.ts': {
    outside: 'Marketing lifecycle email, sent on consent under PECR. Not a family notification.',
  },
  'billing/low-credit-alerts.ts': {
    outside: 'Operator billing alert about the account, not a family notification.',
  },
  'actions/action-executor.ts': {
    outside:
      'Tier-gated actions: a send happens only through ActionExecutor with approvedBy (trust-tier-gate.test.ts).',
  },
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'dev' ? [] : walk(rel)
    return /\.ts$/.test(e.name) && !/\.test\./.test(e.name) ? [rel] : []
  })
}

function sendingFiles(): string[] {
  return walk(SRC)
    .filter((f) => {
      const src = fs.readFileSync(f, 'utf8')
      return SEND_PRIMITIVES.some((p) => src.includes(p))
    })
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    .sort()
}

describe('every sender is accounted for', () => {
  it('lists each file that sends to a person, and nothing else', () => {
    expect(sendingFiles()).toEqual(Object.keys(ALLOWED).sort())
  })

  it('names real catalogue kinds, and a reason for anything outside it', () => {
    for (const [file, e] of Object.entries(ALLOWED)) {
      expect(e.kinds || e.outside || e.transport, file).toBeTruthy()
      for (const k of e.kinds ?? []) expect(kindById(k), `${file}: ${k}`).toBeDefined()
      if (e.outside) expect(e.outside.length, file).toBeGreaterThan(30)
    }
  })

  it('every live email or push kind has a sender listed for it', () => {
    const covered = new Set(Object.values(ALLOWED).flatMap((e) => e.kinds ?? []))
    // policy_renewal_reminder sends through delivery/channels.ts under insight_alert's
    // channels; join_approved lives in auth-email.ts.
    const sentThroughRouter = new Set(['policy_renewal_reminder'])
    for (const k of NOTIFICATION_KINDS.filter((x) => x.status === 'live'))
      expect(covered.has(k.id) || sentThroughRouter.has(k.id), k.id).toBe(true)
  })
})

describe('the budget ledger speaks the catalogue vocabulary', () => {
  const ledgerKinds = new Set(NOTIFICATION_KINDS.flatMap((k) => k.ledger_kinds ?? []))
  const FILES = ['delivery/delivery-router.ts', 'jobs/family-heartbeat.ts']

  it('maps the budget ledger kinds to catalogue kinds', () => {
    expect(kindById('policy_renewal_reminder')?.ledger_kinds).toContain('renewal_reminder')
    expect(kindById('insight_alert')?.ledger_kinds).toContain('insight_alert')
  })

  it('every kind written to the ledger by the router and the digest job is in the catalogue', () => {
    for (const f of FILES) {
      const src = fs.readFileSync(path.join(SRC, f), 'utf8')
      const found = [
        ...src.matchAll(
          /\bkind:\s*(?:opts\.[\w.]+ === '\w+' \? )?'([a-z0-9_]+)'(?: : '([a-z0-9_]+)')?/g,
        ),
      ]
        .flatMap((m) => [m[1], m[2]])
        .filter((x): x is string => !!x)
      expect(found.length, f).toBeGreaterThan(0)
      for (const k of found) expect(ledgerKinds.has(k), `${f}: ledger kind ${k}`).toBe(true)
    }
  })
})
