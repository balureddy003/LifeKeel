/**
 * Connector health alert job tests.
 */

import { describe, expect, it } from 'vitest'
import { createCredentialExpiryInsights } from '../connector-health-alert.js'

/**
 * OAK-003: createCredentialExpiryInsights now atomically claims a dedup
 * marker (connector_health_dedup, unique on tenant_id+connector_id)
 * before inserting an insight, instead of a plain findOne-then-insertOne
 * pair. A fresh in-memory store per call, faithful enough to real Mongo's
 * findOneAndUpdate+upsert semantics for this test file's purposes: no
 * existing doc → upsert creates one and returns it; existing doc whose
 * alerted_at satisfies the filter's $lt → updated and returned; existing
 * doc that doesn't satisfy it → null (already claimed within the window).
 */
function makeDedupCol(seed: Array<{ tenant_id: string; connector_id: string; alerted_at: Date }> = []) {
  const docs = [...seed]
  return {
    createIndex: async () => ({}),
    findOneAndUpdate: async (
      filter: { tenant_id: string; connector_id: string; alerted_at: { $lt: Date } },
      update: { $set: { tenant_id: string; connector_id: string; alerted_at: Date } },
    ) => {
      const existing = docs.find(d => d.tenant_id === filter.tenant_id && d.connector_id === filter.connector_id)
      if (!existing) {
        const doc = { ...update.$set }
        docs.push(doc)
        return doc
      }
      if (existing.alerted_at < filter.alerted_at.$lt) {
        existing.alerted_at = update.$set.alerted_at
        return existing
      }
      return null
    },
  }
}

describe('createCredentialExpiryInsights', () => {
  function makeDb({ existingInsight = false, noCreds = false, staleError = false } = {}) {
    const connectorCreds = noCreds
      ? []
      : [{ tenant_id: 'tenant-1', connector_id: 'trading-212', name: 'Trading 212' }]
    const insights: Array<Record<string, unknown>> = existingInsight
      ? [{
          tenant_id: 'tenant-1',
          detector_id: 'system_connector_health',
          rule_id: 'expired_credentials',
          entity_key: 'trading-212',
          state: 'identified',
          created_at: new Date(Date.now() - 1 * 60 * 60 * 1000),
        }]
      : []
    // OAK-003: dedup now lives in connector_health_dedup, not a findOne
    // against `insights` — "an alert already exists" means a marker doc
    // was already claimed for this tenant+connector within the window.
    const dedupSeed = existingInsight
      ? [{ tenant_id: 'tenant-1', connector_id: 'trading-212', alerted_at: new Date(Date.now() - 1 * 60 * 60 * 1000) }]
      : []
    const errorAt = staleError
      ? new Date(Date.now() - 60 * 60 * 1000)
      : new Date()
    const syncStates = [{
      tenant_id: 'tenant-1',
      connector_id: 'trading-212',
      last_error: { status: 401, status_text: 'Unauthorized', at: errorAt },
    }]

    return {
      collection: (name: string) => {
        if (name === 'connector_sync_state') {
          return {
            find: (query?: Record<string, unknown>) => ({
              toArray: async () => {
                if (!query) return syncStates
                const minAt = (query['last_error.at'] as { $gte?: Date })?.$gte
                if (!minAt) return syncStates
                return syncStates.filter(s => (s.last_error.at as Date) >= minAt)
              },
            }),
          }
        }
        if (name === 'pending_trades') {
          // No rejected trades by default — existing tests only test sync path.
          return { find: () => ({ toArray: async () => [] }) }
        }
        if (name === 'connector_credentials') {
          return {
            findOne: async () => connectorCreds[0] ?? null,
          }
        }
        if (name === 'insights') {
          return {
            findOne: async (q: Record<string, unknown>) => {
              // Check both pre-existing and newly-inserted insights for dedup.
              return insights.find(i =>
                i['tenant_id'] === q['tenant_id'] &&
                i['detector_id'] === q['detector_id'] &&
                i['entity_key'] === q['entity_key'] &&
                i['state'] === q['state'],
              ) ?? null
            },
            insertOne: async (doc: Record<string, unknown>) => {
              insights.push(doc)
              return { insertedId: 'id' }
            },
          }
        }
        if (name === 'connector_health_dedup') return makeDedupCol(dedupSeed)
        throw new Error(`Unexpected collection: ${name}`)
      },
    } as any
  }

  it('creates an insight for a connector with a recent 401', async () => {
    const db = makeDb()
    const result = await createCredentialExpiryInsights({ db, lookbackMs: 10 * 60 * 1000 })
    expect(result.created).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('skips if an alert already exists within the dedup window', async () => {
    const db = makeDb({ existingInsight: true })
    const result = await createCredentialExpiryInsights({ db, lookbackMs: 10 * 60 * 1000 })
    expect(result.created).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('returns empty when the last error is outside the lookback window', async () => {
    const db = makeDb({ staleError: true })
    const result = await createCredentialExpiryInsights({ db, lookbackMs: 10 * 60 * 1000 })
    expect(result.created).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('creates an insight when auto-placed trades are rejected with HTTP 401', async () => {
    // Trading 212 API key is bad → every auto-trade is rejected with 401.
    // These failures land in pending_trades, not connector_sync_state, so
    // without scanning trades the tenant is never notified.
    const rejectedTrades = [{
      tenant_id: 'tenant-1',
      status: 'rejected',
      receipt: { reason: 'Broker rejected the order: HTTP 401' },
      updated_at: new Date(),
    }]
    const insights: Array<Record<string, unknown>> = []

    const db = {
      collection: (name: string) => {
        if (name === 'connector_sync_state') {
          return { find: () => ({ toArray: async () => [] }) }
        }
        if (name === 'pending_trades') {
          return {
            find: (query?: Record<string, unknown>) => ({
              toArray: async () => {
                if (!query) return rejectedTrades
                const cutoff = (query['updated_at'] as { $gte?: Date })?.$gte
                if (!cutoff) return rejectedTrades
                return rejectedTrades.filter(t => (t.updated_at as Date) >= cutoff)
              },
            }),
          }
        }
        if (name === 'connector_credentials') {
          return { findOne: async () => ({ tenant_id: 'tenant-1', connector_id: 'trading-212', name: 'Trading 212' }) }
        }
        if (name === 'insights') {
          return {
            findOne: async (q: Record<string, unknown>) => {
              return insights.find(i =>
                i['tenant_id'] === q['tenant_id'] &&
                i['detector_id'] === q['detector_id'] &&
                i['entity_key'] === q['entity_key'] &&
                i['state'] === q['state'],
              ) ?? null
            },
            insertOne: async (doc: Record<string, unknown>) => {
              insights.push(doc)
              return { insertedId: 'id' }
            },
          }
        }
        if (name === 'connector_health_dedup') return makeDedupCol()
        throw new Error(`Unexpected collection: ${name}`)
      },
    } as any

    const result = await createCredentialExpiryInsights({ db, lookbackMs: 10 * 60 * 1000 })
    expect(result.created).toBe(1)
    expect(result.skipped).toBe(0)
    expect(insights[0]['entity_key']).toBe('trading-212')
    expect((insights[0]['feature_snapshot'] as Record<string, unknown>)['source']).toBe('trade_execution')
  })

  it('dedupes across both sync and trade execution sources for the same connector', async () => {
    // Both sync state and pending_trades have 401s for trading-212 — only one
    // insight should be created.
    const syncStates = [{
      tenant_id: 'tenant-1',
      connector_id: 'trading-212',
      last_error: { status: 401, status_text: 'Unauthorized', at: new Date() },
    }]
    const rejectedTrades = [{
      tenant_id: 'tenant-1',
      status: 'rejected',
      receipt: { reason: 'Broker rejected the order: HTTP 401' },
      updated_at: new Date(),
    }]
    const insights: Array<Record<string, unknown>> = []

    const db = {
      collection: (name: string) => {
        if (name === 'connector_sync_state') {
          return { find: () => ({ toArray: async () => syncStates }) }
        }
        if (name === 'pending_trades') {
          return { find: () => ({ toArray: async () => rejectedTrades }) }
        }
        if (name === 'connector_credentials') {
          return { findOne: async () => ({ name: 'Trading 212' }) }
        }
        if (name === 'insights') {
          return {
            findOne: async (q: Record<string, unknown>) => {
              // Dedup-aware: check newly-inserted insights too.
              return insights.find(i =>
                i['tenant_id'] === q['tenant_id'] &&
                i['detector_id'] === q['detector_id'] &&
                i['entity_key'] === q['entity_key'] &&
                i['state'] === q['state'],
              ) ?? null
            },
            insertOne: async (doc: Record<string, unknown>) => {
              insights.push(doc)
              return { insertedId: 'id' }
            },
          }
        }
        if (name === 'connector_health_dedup') return makeDedupCol()
        throw new Error(`Unexpected collection: ${name}`)
      },
    } as any

    const result = await createCredentialExpiryInsights({ db, lookbackMs: 10 * 60 * 1000 })
    expect(result.created).toBe(1) // sync source creates it, trade source dedupes
    expect(result.skipped).toBe(1)
  })
})
