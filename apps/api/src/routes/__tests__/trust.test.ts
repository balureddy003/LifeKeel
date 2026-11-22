/** PRD-208: GET /trust is public and filtered; PUT /operator/evidence records and audits. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import {
  getProcessorRegistry,
  getTaskRegistry,
  initTaskGateway,
  processorsInUse,
} from '../../ai/task-gateway.js'

vi.mock('../../operator/operator-auth.js', () => ({
  requireOperator: () => async (req: { operatorContext?: unknown }) => {
    req.operatorContext = { user_id: 'op1', roles: ['super_admin'], source: 'database' }
  },
}))
import { registerTrustRoutes } from '../trust.js'

function fakeDb() {
  const evidence: Record<string, unknown>[] = []
  const audit: Record<string, unknown>[] = []
  const db = {
    collection(name: string) {
      if (name === 'trust_evidence')
        return {
          find: () => ({ toArray: async () => evidence }),
          findOne: async (q: { claim_id: string }) =>
            evidence.find((e) => e['claim_id'] === q.claim_id) ?? null,
          updateOne: async (q: { claim_id: string }, u: { $set: Record<string, unknown> }) => {
            const i = evidence.findIndex((e) => e['claim_id'] === q.claim_id)
            if (i >= 0) evidence[i] = u.$set
            else evidence.push(u.$set)
          },
        }
      if (name === 'operator_audit_log')
        return {
          insertOne: async (d: Record<string, unknown>) => audit.push(d),
          createIndex: async () => 'i',
        }
      return { createIndex: async () => 'i' }
    },
  }
  return { db, evidence, audit }
}

async function setup() {
  initTaskGateway({ collection: () => ({}) } as never)
  const { db, evidence, audit } = fakeDb()
  const app = Fastify()
  registerTrustRoutes(app, db as never)
  await app.ready()
  return { app, evidence, audit }
}

const PROVIDER_ENV = [
  'LIFEKEEL_LLM_PROVIDER',
  'AZURE_OPENAI_ENDPOINT',
  'VERTEX_PROJECT',
  'GROQ_API_KEY',
  'XAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OLLAMA_BASE_URL',
  'LOCAL_TEXT_ENABLED',
]

describe('processors in use (hands-on review G8)', () => {
  afterEach(() => vi.unstubAllEnvs())
  const only = (name: string) => {
    for (const k of PROVIDER_ENV) vi.stubEnv(k, '')
    vi.stubEnv(name, 'x')
  }

  it('leaves out an unreviewed provider under enforce, because every call to it is refused', () => {
    initTaskGateway({ collection: () => ({}) } as never)
    only('ANTHROPIC_API_KEY')
    const tasks = [...getTaskRegistry().values()]
    expect(processorsInUse(tasks, getProcessorRegistry(), 'enforce').has('anthropic')).toBe(false)
    expect(processorsInUse(tasks, getProcessorRegistry(), 'warn').has('anthropic')).toBe(true)
  })

  it('counts no hosted provider when no credential is configured', () => {
    initTaskGateway({ collection: () => ({}) } as never)
    for (const k of PROVIDER_ENV) vi.stubEnv(k, '')
    expect(processorsInUse(getTaskRegistry().values(), getProcessorRegistry(), 'warn').size).toBe(0)
  })

  it('lists the approved provider that serves, and not the self-hosted model while it is off', () => {
    initTaskGateway({ collection: () => ({}) } as never)
    only('GROQ_API_KEY')
    const inUse = processorsInUse(getTaskRegistry().values(), getProcessorRegistry(), 'enforce')
    expect(inUse.has('groq')).toBe(true)
    expect(inUse.has('ollama')).toBe(false)
    expect(inUse.has('anthropic')).toBe(false)
  })
})

describe('trust routes', () => {
  it('serves the processor table and no claims until one is evidenced, with no internals', async () => {
    const { app } = await setup()
    const body = (await app.inject({ method: 'GET', url: '/trust' })).json()
    expect(body.claims).toEqual([])
    expect(body.ai.processors.length).toBeGreaterThan(0)
    for (const p of body.ai.processors) expect(typeof p.in_use).toBe('boolean')
    expect(body.backups).toHaveProperty('statement')
    expect(JSON.stringify(body)).not.toMatch(/owner|reason/)
  })

  it('publishes a claim after the operator records it, and audits the change', async () => {
    const { app, audit } = await setup()
    const put = await app.inject({
      method: 'PUT',
      url: '/operator/evidence/no_commission',
      payload: {
        owner: 'Sam Owner',
        verified_at: '2026-10-01',
        renew_by: '2099-01-01',
        reason: 'Checked the partner terms',
      },
    })
    expect(put.statusCode).toBe(200)
    expect(audit[0]).toMatchObject({
      action: 'operator.trust_evidence.update',
      target_id: 'no_commission',
    })
    const body = (await app.inject({ method: 'GET', url: '/trust' })).json()
    expect(body.claims.map((c: { id: string }) => c.id)).toEqual(['no_commission'])
    expect(JSON.stringify(body.claims)).not.toContain('Sam Owner')
  })

  it('refuses to record evidence for a claim that has none, or a renewal before verification', async () => {
    const { app } = await setup()
    const good = {
      owner: 'Sam',
      verified_at: '2026-10-01',
      renew_by: '2027-01-01',
      reason: 'Checked it',
    }
    expect(
      (await app.inject({ method: 'PUT', url: '/operator/evidence/pen_test', payload: good }))
        .statusCode,
    ).toBe(409)
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/operator/evidence/no_commission',
          payload: { ...good, renew_by: '2026-01-01' },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ method: 'PUT', url: '/operator/evidence/nope', payload: good }))
        .statusCode,
    ).toBe(404)
  })

  it('lists every claim with a state for the operator', async () => {
    const { app } = await setup()
    const body = (await app.inject({ method: 'GET', url: '/operator/evidence' })).json()
    expect(body.claims.find((c: { id: string }) => c.id === 'pen_test').state).toBe('not_evidenced')
    expect(body.attention).toBeGreaterThan(0)
  })
})
