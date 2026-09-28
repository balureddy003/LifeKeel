/**
 * OAK-002: the action executor must never trigger a real Stripe refund/
 * subscription cancellation or a public LinkedIn/Twitter post — those
 * action types were deleted outright (see the file's own header comment).
 * Guardrail (source-level) + behavioral (the classifier/dispatcher no
 * longer recognizes refund/publish keywords, and never calls fetch for
 * them) coverage, mirroring insights-prepare.test.ts's SendGrid guardrail
 * pattern for PRD-103.
 *
 * The receipts fake below enforces the real unique-index semantics on
 * (tenant_id, insight_id, payload_hash) so claim-before-dispatch behavior —
 * duplicate suppression, stale-claim ambiguity, dry-run supersession — is
 * tested against the same contract MongoDB provides, not a stub of it.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { Insight } from '@agentoak/engine'
import { ActionExecutor } from '../action-executor.js'

function makeInsight(
  actions: string[],
  action_intents?: { type: 'send_email' | 'send_whatsapp' | 'crm_tag' | 'log_only'; label: string; params?: Record<string, unknown> }[],
): Insight {
  return {
    id: 'insight-1',
    tenant_id: 'tenant-1',
    hypothesis: 'test_hypothesis',
    category: 'risk',
    urgency: 'medium',
    estimated_impact_low: 100,
    estimated_impact_high: 200,
    reasoning: 'A test insight.',
    actions,
    ...(action_intents ? { action_intents } : {}),
    confidence_breakdown: {
      or_score: 0.8,
      combined_score: 0.8,
      model_version: 'test',
      evidence_refs: ['ch_test123'],
    },
    detector_id: 'test_detector',
    rule_id: 'test_rule',
    state: 'identified',
    created_at: new Date(),
  } as unknown as Insight
}

/** The payload hash the executor computes for a given insight+action. */
function payloadHashFor(insightId: string, label: string, type: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ insight_id: insightId, action_label: label, action_type: type }))
    .digest('hex')
}

interface ReceiptDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  insight_id: string
  outcome: string
  payload_hash: string
}

/** In-memory action_receipts collection honoring the unique-index contract. */
function makeReceiptsCollection(seed: ReceiptDoc[] = []) {
  const docs: ReceiptDoc[] = seed.map((d) => structuredClone(d))
  const key = (d: ReceiptDoc) => `${d.tenant_id}|${d.insight_id}|${d.payload_hash}`
  const matchesOutcome = (outcome: string, filter: unknown): boolean => {
    if (filter === undefined) return true
    if (typeof filter === 'string') return outcome === filter
    const f = filter as { $in?: string[] }
    return Array.isArray(f.$in) ? f.$in.includes(outcome) : true
  }
  const matches = (d: ReceiptDoc, filter: Record<string, unknown>) =>
    (filter['id'] === undefined || d.id === filter['id']) &&
    (filter['tenant_id'] === undefined || d.tenant_id === filter['tenant_id']) &&
    (filter['insight_id'] === undefined || d.insight_id === filter['insight_id']) &&
    (filter['payload_hash'] === undefined || d.payload_hash === filter['payload_hash']) &&
    matchesOutcome(d.outcome, filter['outcome'])

  return {
    docs,
    createIndex: vi.fn(async () => ({})),
    insertOne: vi.fn(async (doc: ReceiptDoc) => {
      if (docs.some((d) => key(d) === key(doc))) {
        const err = new Error('duplicate key') as Error & { code: number }
        err.code = 11000
        throw err
      }
      docs.push(structuredClone(doc))
      return { acknowledged: true }
    }),
    findOne: vi.fn(async (filter: Record<string, unknown>) => {
      const found = docs.find((d) => matches(d, filter))
      return found ? structuredClone(found) : null
    }),
    findOneAndUpdate: vi.fn(async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
      const d = docs.find((doc) => matches(doc, filter))
      if (!d) return null
      for (const [k, v] of Object.entries(update['$set'] ?? {})) d[k] = v
      for (const [k, v] of Object.entries(update['$inc'] ?? {})) d[k] = (Number(d[k]) || 0) + Number(v)
      for (const k of Object.keys(update['$unset'] ?? {})) delete d[k]
      return structuredClone(d)
    }),
    deleteOne: vi.fn(async (filter: Record<string, unknown>) => {
      const idx = docs.findIndex((d) => matches(d, filter))
      if (idx >= 0) docs.splice(idx, 1)
      return { deletedCount: idx >= 0 ? 1 : 0 }
    }),
    find: vi.fn(() => ({ sort: () => ({ toArray: async () => docs.map((d) => structuredClone(d)) }) })),
  }
}

function makeDb(seed: ReceiptDoc[] = [], creds: Record<string, unknown> | null = null) {
  const receipts = makeReceiptsCollection(seed)
  const db = {
    collection: (name: string) => {
      if (name === 'action_receipts') return receipts
      if (name === 'connector_credentials') return { findOne: vi.fn(async () => creds) }
      if (name === 'tenant_settings') return { findOne: vi.fn(async () => null) }
      return { findOne: vi.fn(async () => null), createIndex: vi.fn(async () => ({})) }
    },
  }
  return { db: db as never, receipts }
}

const SENDGRID = { api_key: 'sg-key' }

function seedReceipt(overrides: Partial<ReceiptDoc>): ReceiptDoc {
  return {
    id: 'prior-receipt',
    tenant_id: 'tenant-1',
    insight_id: 'insight-1',
    action_type: 'send_email',
    action_label: 'Send an email reminder',
    outcome: 'executed',
    executed_at: new Date(),
    dry_run: false,
    payload_hash: payloadHashFor('insight-1', 'Send an email reminder', 'send_email'),
    ...overrides,
  }
}

describe('OAK-002: dangerous action types deleted', () => {
  it('guardrail: source no longer contains the deleted refund/cancel/publish endpoints or action types', () => {
    const source = readFileSync(new URL('../action-executor.ts', import.meta.url), 'utf-8')

    expect(source).not.toMatch(/api\.stripe\.com/)
    expect(source).not.toMatch(/api\.linkedin\.com/)
    expect(source).not.toMatch(/api\.x\.com\/2\/tweets/)
    expect(source).not.toMatch(/api\.xero\.com/)
    expect(source).not.toMatch(/'stripe_refund'/)
    expect(source).not.toMatch(/'stripe_pause'/)
    expect(source).not.toMatch(/'post_linkedin'/)
    expect(source).not.toMatch(/'post_twitter'/)
    expect(source).not.toMatch(/'xero_credit_note'/)
  })

  describe('behavioral', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('a refund-worded action classifies as log_only (skipped) and never calls fetch', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch should never be called for a deleted action type') }))
      const { db } = makeDb()
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Refund the customer immediately']), 'tenant-1', {})

      expect(summary.receipts).toHaveLength(1)
      expect(summary.receipts[0]!.outcome).toBe('execution_skipped')
      expect(summary.receipts[0]!.action_type).toBe('log_only')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('a LinkedIn/Twitter-worded action also classifies as log_only and never calls fetch', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch should never be called for a deleted action type') }))
      const { db } = makeDb()
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(
        makeInsight(['Post this update on LinkedIn', 'Tweet about it']),
        'tenant-1',
        {},
      )

      expect(summary.receipts.every((r) => r.action_type === 'log_only' && r.outcome === 'execution_skipped')).toBe(true)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('a subscription-pause-worded action also classifies as log_only', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch should never be called') }))
      const { db } = makeDb()
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Pause the subscription']), 'tenant-1', {})

      expect(summary.receipts[0]!.action_type).toBe('log_only')
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('kept action types still dispatch (regression guard)', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('send_email still classifies and dispatches (not deleted)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) })))
      const { db } = makeDb([], SENDGRID)
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})

      expect(summary.receipts[0]!.action_type).toBe('send_email')
      expect(summary.receipts[0]!.outcome).toBe('executed')
      expect(fetch).toHaveBeenCalledWith('https://api.sendgrid.com/v3/mail/send', expect.anything())
    })
  })

  describe('claim-before-dispatch idempotency', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('skips re-dispatch when a receipt for the same insight+action already succeeded', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('should not be called — already executed') }))
      const existing = seedReceipt({ outcome: 'executed' })
      const { db } = makeDb([existing], SENDGRID)

      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})

      expect(summary.receipts[0]).toEqual(existing)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('re-dispatches via claim transition when the prior receipt failed', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) })))
      const failed = seedReceipt({ outcome: 'execution_failed', outcome_reason: 'SendGrid 422', attempts: 1 })
      const { db, receipts } = makeDb([failed], SENDGRID)

      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})

      expect(fetch).toHaveBeenCalled()
      expect(summary.receipts[0]!.outcome).toBe('executed')
      expect(summary.receipts[0]!.attempts).toBe(2)
      expect(receipts.docs).toHaveLength(1) // same receipt, transitioned — not a new row
    })

    it('concurrent execute() calls cannot double-dispatch the same action', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) })))
      const { db } = makeDb([], SENDGRID)
      const executor = new ActionExecutor(db)
      const insight = makeInsight(['Send an email reminder'])

      const [a, b] = await Promise.all([
        executor.execute(insight, 'tenant-1', {}),
        executor.execute(insight, 'tenant-1', {}),
      ])

      expect(fetch).toHaveBeenCalledTimes(1)
      // The loser of the claim sees either the still-pending claim or the
      // already-finalized executed receipt — never a second dispatch.
      for (const outcome of [a.receipts[0]!.outcome, b.receipts[0]!.outcome]) {
        expect(['executed', 'pending']).toContain(outcome)
      }
    })

    it('a stale pending claim is marked execution_ambiguous — never blindly re-dispatched', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('must not re-dispatch an unknown outcome') }))
      const stalePending = seedReceipt({
        outcome: 'pending',
        claimed_at: new Date(Date.now() - 10 * 60 * 1000),
        executed_at: new Date(Date.now() - 10 * 60 * 1000),
      })
      const { db, receipts } = makeDb([stalePending], SENDGRID)

      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})

      expect(fetch).not.toHaveBeenCalled()
      expect(summary.receipts[0]!.outcome).toBe('execution_ambiguous')
      expect(receipts.docs[0]!.outcome).toBe('execution_ambiguous')
    })

    it('a fresh pending claim is deferred to, not re-dispatched', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('another dispatcher owns this claim') }))
      const freshPending = seedReceipt({ outcome: 'pending', claimed_at: new Date() })
      const { db } = makeDb([freshPending], SENDGRID)

      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})

      expect(fetch).not.toHaveBeenCalled()
      expect(summary.receipts[0]!.outcome).toBe('pending')
    })

    it('a dry-run skip does not suppress a later live execution of the same action', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) })))
      const dryRunSkip = seedReceipt({ outcome: 'execution_skipped', outcome_reason: 'dry_run', dry_run: true })
      const { db } = makeDb([dryRunSkip], SENDGRID)

      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})

      expect(fetch).toHaveBeenCalled()
      expect(summary.receipts[0]!.outcome).toBe('executed')
    })
  })

  describe('failure classification', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('a 4xx SendGrid response classifies as execution_failed (definite, not worth blind retry)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422, text: async () => 'bad request' })))
      const { db } = makeDb([], SENDGRID)
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})
      expect(summary.receipts[0]!.outcome).toBe('execution_failed')
    })

    it('a 5xx SendGrid response classifies as execution_ambiguous (may be worth retrying)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => 'unavailable' })))
      const { db } = makeDb([], SENDGRID)
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})
      expect(summary.receipts[0]!.outcome).toBe('execution_ambiguous')
    })
  })

  // PRD-116: detector-declared action_intents are authoritative over
  // keyword classification — in both directions.
  describe('PRD-116: declared action_intents', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('a declared send_email intent dispatches even when its label would keyword-classify as log_only', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) })))
      const { db } = makeDb([], SENDGRID)
      const executor = new ActionExecutor(db)
      // "Email me a reminder before this policy renews" doesn't match
      // /send.*email|email.*remind/ — the declaration is what makes it send.
      const summary = await executor.execute(
        makeInsight(
          ['Email me a reminder before this policy renews'],
          [{ type: 'send_email', label: 'Email me a reminder before this policy renews' }],
        ),
        'tenant-1',
        {},
      )
      expect(summary.receipts[0]!.action_type).toBe('send_email')
      expect(summary.receipts[0]!.outcome).toBe('executed')
      expect(fetch).toHaveBeenCalledWith('https://api.sendgrid.com/v3/mail/send', expect.anything())
    })

    it('a declared log_only intent suppresses a label that would keyword-classify as external', async () => {
      // The safer direction matters more: a detector that explicitly
      // declares log_only must never dispatch, whatever the regex thinks
      // the label sounds like.
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch must not run for a declared log_only') }))
      const { db } = makeDb([], SENDGRID)
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(
        makeInsight(
          ['Send an email reminder'],
          [{ type: 'log_only', label: 'Send an email reminder' }],
        ),
        'tenant-1',
        {},
      )
      expect(summary.receipts[0]!.action_type).toBe('log_only')
      expect(summary.receipts[0]!.outcome).toBe('execution_skipped')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('previewActions reflects the declared intent — the approval gate names the same action the executor runs', async () => {
      const { previewActions } = await import('../action-executor.js')
      const previews = previewActions(
        ['Email me a reminder before this policy renews', 'Review the renewal terms'],
        [{ type: 'send_email', label: 'Email me a reminder before this policy renews' }],
      )
      expect(previews[0]).toMatchObject({ type: 'send_email', external: true })
      expect(previews[1]).toMatchObject({ type: 'log_only', external: false })
    })

    it('a declared intent whose label is not in actions still executes — declared intents are the actionable set', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) })))
      const { db } = makeDb([], SENDGRID)
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(
        makeInsight(
          ['Review the renewal terms'],
          [{ type: 'send_email', label: 'Email me a reminder before this policy renews' }],
        ),
        'tenant-1',
        {},
      )
      expect(summary.receipts.map((r) => r.action_type).sort()).toEqual(['log_only', 'send_email'])
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })
})
