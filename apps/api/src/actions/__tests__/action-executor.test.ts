/**
 * OAK-002: the action executor must never trigger a real Stripe refund/
 * subscription cancellation or a public LinkedIn/Twitter post — those
 * action types were deleted outright (see the file's own header comment).
 * Guardrail (source-level) + behavioral (the classifier/dispatcher no
 * longer recognizes refund/publish keywords, and never calls fetch for
 * them) coverage, mirroring insights-prepare.test.ts's SendGrid guardrail
 * pattern for PRD-103.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Insight } from '@agentoak/engine'
import { ActionExecutor } from '../action-executor.js'

function makeInsight(actions: string[]): Insight {
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

function makeDb() {
  const col = {
    createIndex: vi.fn(async () => ({})),
    insertOne: vi.fn(async () => ({ acknowledged: true })),
    deleteOne: vi.fn(async () => ({ acknowledged: true })),
    findOne: vi.fn(async () => null),
    find: vi.fn(() => ({ sort: () => ({ toArray: async () => [] }) })),
  }
  return { collection: () => col } as any
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
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch should never be called for a deleted action type') }))
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('a refund-worded action classifies as log_only (skipped) and never calls fetch', async () => {
      const executor = new ActionExecutor(makeDb())
      const summary = await executor.execute(makeInsight(['Refund the customer immediately']), 'tenant-1', {})

      expect(summary.receipts).toHaveLength(1)
      expect(summary.receipts[0]!.outcome).toBe('execution_skipped')
      expect(summary.receipts[0]!.action_type).toBe('log_only')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('a LinkedIn/Twitter-worded action also classifies as log_only and never calls fetch', async () => {
      const executor = new ActionExecutor(makeDb())
      const summary = await executor.execute(
        makeInsight(['Post this update on LinkedIn', 'Tweet about it']),
        'tenant-1',
        {},
      )

      expect(summary.receipts.every((r) => r.action_type === 'log_only' && r.outcome === 'execution_skipped')).toBe(true)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('a subscription-pause-worded action also classifies as log_only', async () => {
      const executor = new ActionExecutor(makeDb())
      const summary = await executor.execute(makeInsight(['Pause the subscription']), 'tenant-1', {})

      expect(summary.receipts[0]!.action_type).toBe('log_only')
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('kept action types still dispatch (regression guard)', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) })))
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('send_email still classifies and dispatches (not deleted)', async () => {
      const db = makeDb()
      db.collection = ((name: string) => {
        if (name === 'connector_credentials') return { findOne: vi.fn(async () => ({ api_key: 'sg-key' })) }
        if (name === 'tenant_settings') return { findOne: vi.fn(async () => null) }
        return {
          createIndex: vi.fn(async () => ({})),
          insertOne: vi.fn(async () => ({})),
          findOne: vi.fn(async () => null),
          deleteOne: vi.fn(async () => ({})),
        }
      }) as any
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})

      expect(summary.receipts[0]!.action_type).toBe('send_email')
      expect(summary.receipts[0]!.outcome).toBe('executed')
      expect(fetch).toHaveBeenCalledWith('https://api.sendgrid.com/v3/mail/send', expect.anything())
    })
  })

  describe('idempotency (durable retry support)', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('skips re-dispatch when a receipt for the same insight+action already succeeded', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('should not be called — already executed') }))
      const existingReceipt = {
        id: 'prior-receipt', tenant_id: 'tenant-1', insight_id: 'insight-1',
        action_type: 'send_email', action_label: 'Send an email reminder',
        outcome: 'executed', executed_at: new Date(), dry_run: false, payload_hash: 'irrelevant-in-mock',
      }
      const db = makeDb()
      db.collection = (() => ({
        createIndex: vi.fn(async () => ({})),
        insertOne: vi.fn(async () => ({ acknowledged: true })),
        deleteOne: vi.fn(async () => ({ acknowledged: true })),
        findOne: vi.fn(async () => existingReceipt),
        find: vi.fn(() => ({ sort: () => ({ toArray: async () => [] }) })),
      })) as any

      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})

      expect(summary.receipts[0]).toEqual(existingReceipt)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('re-dispatches (retries) when the existing receipt for the same action previously failed', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) })))
      const staleFailedReceipt = {
        id: 'prior-receipt', tenant_id: 'tenant-1', insight_id: 'insight-1',
        action_type: 'send_email', action_label: 'Send an email reminder',
        outcome: 'execution_failed', executed_at: new Date(), dry_run: false, payload_hash: 'irrelevant-in-mock',
      }
      const db = makeDb()
      const deleteOne = vi.fn(async () => ({ acknowledged: true }))
      db.collection = ((name: string) => {
        if (name === 'connector_credentials') return { findOne: vi.fn(async () => ({ api_key: 'sg-key' })) }
        if (name === 'tenant_settings') return { findOne: vi.fn(async () => null) }
        return {
          createIndex: vi.fn(async () => ({})),
          insertOne: vi.fn(async () => ({ acknowledged: true })),
          deleteOne,
          findOne: vi.fn(async () => staleFailedReceipt),
          find: vi.fn(() => ({ sort: () => ({ toArray: async () => [] }) })),
        }
      }) as any

      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})

      expect(deleteOne).toHaveBeenCalledWith({ id: 'prior-receipt' })
      expect(summary.receipts[0]!.outcome).toBe('executed')
      expect(fetch).toHaveBeenCalled()
    })
  })

  describe('failure classification', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('a 4xx SendGrid response classifies as execution_failed (definite, not worth blind retry)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422, text: async () => 'bad request' })))
      const db = makeDb()
      const fallback = db.collection
      db.collection = ((name: string) => {
        if (name === 'connector_credentials') return { findOne: vi.fn(async () => ({ api_key: 'sg-key' })) }
        if (name === 'tenant_settings') return { findOne: vi.fn(async () => null) }
        return fallback()
      }) as any
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})
      expect(summary.receipts[0]!.outcome).toBe('execution_failed')
    })

    it('a 5xx SendGrid response classifies as execution_ambiguous (may be worth retrying)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => 'unavailable' })))
      const db = makeDb()
      const fallback = db.collection
      db.collection = ((name: string) => {
        if (name === 'connector_credentials') return { findOne: vi.fn(async () => ({ api_key: 'sg-key' })) }
        if (name === 'tenant_settings') return { findOne: vi.fn(async () => null) }
        return fallback()
      }) as any
      const executor = new ActionExecutor(db)
      const summary = await executor.execute(makeInsight(['Send an email reminder']), 'tenant-1', {})
      expect(summary.receipts[0]!.outcome).toBe('execution_ambiguous')
    })
  })
})
