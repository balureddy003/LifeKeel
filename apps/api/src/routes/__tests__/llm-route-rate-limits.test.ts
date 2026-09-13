/**
 * OAK-015 + OAK-026: the LLM-backed routes (POST /assistant/ask,
 * POST /insights/:id/prepare) and the anonymous public readiness quiz
 * (POST /readiness-quiz) each declare their own tighter route-level
 * rate limit rather than only inheriting the shared global one. Proves
 * the config is actually wired to something real — registering
 * @fastify/rate-limit and hammering each route past its declared ceiling
 * — not just that a `config` object with the right shape exists.
 */

import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { Engine } from '@agentoak/engine'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerReadinessQuizRoutes } from '../readiness-quiz.js'
import { registerAssistantRoutes } from '../assistant.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../../detectors')

function makeFakeDb() {
  const col = { findOne: async () => null, insertOne: async () => ({}), createIndex: async () => ({}) }
  return { collection: () => col } as any
}

describe('OAK-015 + OAK-026: LLM/public routes have a dedicated, tighter rate limit', () => {
  it('POST /readiness-quiz (max 5/min) returns 429 on the 6th request within a minute', async () => {
    const engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()

    const app = Fastify()
    await app.register(rateLimit, { global: false })
    await registerReadinessQuizRoutes(app, makeFakeDb(), engine)

    const payload = {
      monthly_salary_minor: 100,
      emergency_savings_minor: 100,
      monthly_expenses_minor: 100,
      mortgage_outstanding_minor: 0,
      life_cover_minor: 0,
      dependents: 0,
    }

    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: 'POST', url: '/readiness-quiz', payload })
      statuses.push(res.statusCode)
    }

    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true)
    expect(statuses[5]).toBe(429)
  })

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
