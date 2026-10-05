import { describe, expect, it } from 'vitest'
import { buildDedupeKey, emitReadinessEvent } from '../emit.js'

// Fake mongo in the insight-attribution.test.ts style: a readiness_events
// collection honouring upsert-on-filter. getTenantCollection scopes every
// filter with tenant_id, so the fake must match that too.
function makeDb(rows: Record<string, unknown>[] = []) {
  return {
    rows,
    db: {
      collection: () => ({
        updateOne: async (
          filter: Record<string, unknown>,
          update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
          opts?: { upsert?: boolean },
        ) => {
          const existing = rows.find((r) => r['dedupe_key'] === filter['dedupe_key'] && r['tenant_id'] === filter['tenant_id'])
          if (existing) {
            Object.assign(existing, update.$set)
            return { modifiedCount: 1 }
          }
          if (opts?.upsert) {
            rows.push({ tenant_id: filter['tenant_id'], ...update.$setOnInsert, ...update.$set })
            return { upsertedCount: 1 }
          }
          return {}
        },
      }),
    } as never,
  }
}

const flush = () => new Promise((r) => setTimeout(r, 10))

const baseEvent = {
  type: 'score_moved' as const,
  severity: 'info' as const,
  direction: 'up' as const,
  member_id: null,
  domain: 'protection',
  title: 'Score moved',
  summary: 'It moved.',
  evidence: [{ label: 'Score', value: '74 → 82' }],
  links: [{ kind: 'component' as const, id: 'protection' }],
  next_check_at: null,
  dedupe_key: buildDedupeKey('score_moved', 't1'),
}

describe('emitReadinessEvent', () => {
  it('dedupes on dedupe_key: a second emit updates the one doc', async () => {
    const { db, rows } = makeDb()
    emitReadinessEvent(db, 't1', baseEvent)
    await flush()
    emitReadinessEvent(db, 't1', { ...baseEvent, title: 'Score moved again', severity: 'attention' })
    await flush()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Score moved again', severity: 'attention', tenant_id: 't1' })
    expect(rows[0]!['id']).toBeTruthy()
    expect(rows[0]!['created_at']).toBeInstanceOf(Date)
  })

  it('never throws when the collection lacks updateOne', async () => {
    const db = { collection: () => ({ find: () => ({ toArray: async () => [] }) }) } as never
    expect(() => emitReadinessEvent(db, 't1', baseEvent)).not.toThrow()
    await flush()
  })

  it('never throws when collection() itself blows up', async () => {
    const db = { collection: () => { throw new Error('closed client') } } as never
    expect(() => emitReadinessEvent(db, 't1', baseEvent)).not.toThrow()
    await flush()
  })

  it('skips an invalid event shape instead of writing it', async () => {
    const { db, rows } = makeDb()
    emitReadinessEvent(db, 't1', { ...baseEvent, type: 'bogus_type' } as never)
    await flush()
    expect(rows).toHaveLength(0)
  })

  it('buildDedupeKey is type:subject:day', () => {
    expect(buildDedupeKey('score_moved', 't1', '2026-11-04')).toBe('score_moved:t1:2026-11-04')
    expect(buildDedupeKey('insight_opened', 'i_9')).toMatch(/^insight_opened:i_9:\d{4}-\d{2}-\d{2}$/)
  })
})
