import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

// The route persists life events through getSignalsCollection()/getDb()
// from db.js — faked in memory so the test needs no Mongo.
const signalRows: Record<string, unknown>[] = []
const signalsCol = {
  find: (filter: Record<string, unknown>) => ({
    sort: () => ({
      toArray: async () =>
        signalRows.filter((r) => r['tenant_id'] === filter['tenant_id'] && r['signal_type'] === filter['signal_type']),
    }),
  }),
  findOne: async (filter: Record<string, unknown>) =>
    signalRows.find(
      (r) =>
        r['tenant_id'] === filter['tenant_id'] &&
        r['signal_type'] === filter['signal_type'] &&
        r['id'] === filter['id'],
    ) ?? null,
  createIndex: vi.fn(async () => ({})),
  updateOne: vi.fn(
    async (filter: Record<string, unknown>, update: Record<string, unknown>, opts?: { upsert?: boolean }) => {
      const row = signalRows.find((r) => matches(r, filter))
      if (row) {
        Object.assign(row, update.$set)
        return { matchedCount: 1 }
      }
      if (opts?.upsert) signalRows.push({ ...(update.$setOnInsert as object), ...(update.$set as object) })
      return { matchedCount: 0, upsertedCount: opts?.upsert ? 1 : 0 }
    },
  ),
}

function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => row[k] === v)
}

const fakeDb = {
  collection: (name: string) => {
    if (name === 'signals') return signalsCol
    if (name === 'family_financial_profile') {
      return {
        findOne: async () => ({
          tenant_id: 't1',
          household: { employment_status: 'employed', monthly_salary_minor: 400_000 },
          emergency_fund: { emergency_savings_minor: 900_000, monthly_expenses_minor: 300_000 },
        }),
      }
    }
    if (name === 'insight_attribution') {
      return { updateOne: vi.fn(async () => ({})), find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }
    }
    // family_groups / insights / anything else the route's helpers touch.
    return {
      findOne: async () => null,
      find: () => ({ project: () => ({ limit: () => ({ toArray: async () => [] }) }), limit: () => ({ toArray: async () => [] }), toArray: async () => [] }),
      updateOne: vi.fn(async () => ({})),
      createIndex: vi.fn(async () => ({})),
    }
  },
}

vi.mock('../db.js', () => ({
  getDb: async () => fakeDb,
  getSignalsCollection: async () => signalsCol,
  getLifeChangeNudgeStateCollection: () => ({ findOne: async () => null, updateOne: vi.fn(async () => ({})) }),
  getFamilyFinancialProfileCollection: () => ({ createIndex: vi.fn(() => Promise.resolve('')), findOne: async () => null }),
}))
vi.mock('../local-model.js', () => ({ familyDataLlmFromEnv: () => null }))
vi.mock('../life-events/vault-reminder.js', () => ({ maybeSendVaultReminder: vi.fn(async () => {}) }))
vi.mock('../audit/audit-log.js', () => ({ getAuditLogger: () => null }))
vi.mock('../lib/schema-registry.js', () => ({
  getSchemaRegistry: () => ({ validate: () => ({ valid: true, errors: [], warnings: [] }) }),
}))
vi.mock('../lib/signal-enricher.js', () => ({
  getSignalEnricher: () => ({ enrich: async (data: Record<string, unknown>) => ({ enriched: data, enrichment_metadata: {} }) }),
}))

const { registerLifeEventRoutes } = await import('../routes/life-events.js')

async function build() {
  const app = Fastify({ logger: { level: 'error' } })
  app.addHook('onRequest', async (req) => {
    ;(req as never as { authContext: unknown }).authContext = { tenant_id: 't1', user_id: 'u1' }
  })
  registerLifeEventRoutes(app, fakeDb as never)
  return app
}

describe('life-event free-text context (G6)', () => {
  it('stores and returns the reporter\'s context verbatim', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'POST',
      url: '/family/life-events',
      payload: { event_type: 'medical', context: "  Mum's at County Hospital — kids need pickup Thursday.  " },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.context).toBe("Mum's at County Hospital — kids need pickup Thursday.")

    const stored = signalRows.find((r) => r['id'] === body.id)!
    expect((stored['data'] as Record<string, unknown>)['context']).toBe(
      "Mum's at County Hospital — kids need pickup Thursday.",
    )

    const list = await app.inject({ method: 'GET', url: '/family/life-events' })
    const event = list.json().events.find((e: { id: string }) => e.id === body.id)
    expect(event.context).toBe("Mum's at County Hospital — kids need pickup Thursday.")
  })

  it('omits context when not provided — response carries null, doc carries nothing', async () => {
    const app = await build()
    const res = await app.inject({ method: 'POST', url: '/family/life-events', payload: { event_type: 'job_loss' } })
    expect(res.statusCode).toBe(201)
    expect(res.json().context).toBeNull()
    const stored = signalRows.find((r) => r['id'] === res.json().id)!
    expect('context' in (stored['data'] as Record<string, unknown>)).toBe(false)
  })

  it('rejects context over 2000 chars', async () => {
    const app = await build()
    const res = await app.inject({
      method: 'POST',
      url: '/family/life-events',
      payload: { event_type: 'medical', context: 'x'.repeat(2001) },
    })
    expect(res.statusCode).toBe(400)
  })
})
