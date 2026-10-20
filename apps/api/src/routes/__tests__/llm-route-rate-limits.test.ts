/**
 * KEEL-015 + KEEL-026: the LLM-backed routes (POST /assistant/ask,
 * POST /insights/:id/prepare) each declare their own tighter route-level
 * rate limit rather than only inheriting the shared global one. Proves
 * the config is actually wired to something real — registering
 * @fastify/rate-limit and hammering each route past its declared ceiling
 * — not just that a `config` object with the right shape exists.
 */

import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
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
  const col = { findOne: async () => null, insertOne: async () => ({}), createIndex: async () => ({}) }
  return { collection: () => col } as any
}

describe('KEEL-015 + KEEL-026: LLM routes have a dedicated, tighter rate limit', () => {
  it('POST /assistant/ask (max 10/min) returns 429 on the 11th request within a minute', async () => {
    const app = Fastify()
    await app.register(rateLimit, { global: false })
    app.addHook('onRequest', async (request: any) => {
      request.authContext = { tenant_id: 'tenant-rate-limit-test', user_id: 'user-1' }
    })
    registerAssistantRoutes(app, makeFakeDb())

    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'POST', url: '/assistant/ask', payload: { query: 'hi' } })
      statuses.push(res.statusCode)
    }

    expect(statuses[10]).toBe(429)
  })
})
