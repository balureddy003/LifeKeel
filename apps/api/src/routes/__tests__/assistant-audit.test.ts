/**
 * OAK-012: POST /assistant/ask previously wrote no audit trail at all —
 * every other insight-affecting action (approve, dismiss, prepare) is
 * audited, but asking the assistant a question about a family's real
 * financial data wasn't. Verifies the route now calls
 * getAuditLogger().fromRequest(...) with the new 'assistant.ask' action,
 * on both the live-LLM success path and the graceful-fallback path.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { initAuditLogger } from '../../audit/audit-log.js'
import { registerAssistantRoutes } from '../assistant.js'

// assistant.ts reads insights via the global db.ts singleton (getInsightsCollection),
// not the `db` passed into registerAssistantRoutes — without this mock it tries a
// real MongoDB connection and hangs for serverSelectionTimeoutMS (5s), timing out
// the test. Same pattern as assistant.test.ts.
vi.mock('../../db.js', () => ({
  getInsightsCollection: vi.fn(async () => ({
    find: () => ({
      sort: () => ({
        limit: () => ({
          toArray: async () => [],
        }),
      }),
    }),
  })),
}))

function makeFakeDb() {
  const col = {
    findOne: async () => null,
    insertOne: async () => ({}),
    createIndex: async () => ({}),
    // Phase 2 (Digital Twin gap audit) added a 'documents' lookup for
    // unreviewed AI Memory items — same find().sort().limit().toArray()
    // shape the insights mock above already uses.
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
  }
  return { collection: () => col } as any
}

function makeAuditDb() {
  const insertOneFn = vi.fn(async () => ({ acknowledged: true }))
  const db = {
    collection: () => ({
      createIndex: vi.fn(async () => {}),
      insertOne: insertOneFn,
    }),
  } as any
  return { db, insertOneFn }
}

describe('OAK-012: POST /assistant/ask writes an audit log entry', () => {
  let auditInsertOne: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const { db, insertOneFn } = makeAuditDb()
    initAuditLogger(db, true)
    auditInsertOne = insertOneFn
  })

  it('logs an assistant.ask audit entry for the request', async () => {
    const app = Fastify()
    app.addHook('onRequest', async (request: any) => {
      request.authContext = { tenant_id: 'tenant-audit-test', user_id: 'user-1' }
    })
    registerAssistantRoutes(app, makeFakeDb())

    const res = await app.inject({ method: 'POST', url: '/assistant/ask', payload: { query: 'How is my family doing?' } })

    expect(res.statusCode).toBe(200)
    expect(auditInsertOne).toHaveBeenCalledTimes(1)
    const entry = auditInsertOne.mock.calls[0]![0]
    expect(entry.action).toBe('assistant.ask')
    expect(entry.tenant_id).toBe('tenant-audit-test')
    expect(entry.resource_type).toBe('assistant')
    expect(entry.resource_id).toBe('ask')
    expect(typeof entry.metadata.is_live).toBe('boolean')
  })
})
