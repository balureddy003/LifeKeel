/** PRD-142 amendment 3: GET /ai/processors tells the truth about review status. */
import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { initTaskGateway } from '../../ai/task-gateway.js'
import { registerAiDisclosureRoutes } from '../ai-disclosure.js'

describe('GET /ai/processors', () => {
  it('returns the loaded registries: self-hosted as run by LifeKeel, hosted as under review', async () => {
    initTaskGateway({ collection: () => ({}) } as never)
    const app = Fastify()
    registerAiDisclosureRoutes(app)
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/ai/processors' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const status = Object.fromEntries(
      body.processors.map((p: { id: string; status: string }) => [p.id, p.status]),
    )
    expect(status['ollama']).toBe('run_by_lifekeel')
    expect(status['anthropic']).toBe('terms_under_review')
    expect(body.tasks.length).toBeGreaterThanOrEqual(14)
    expect(JSON.stringify(body)).not.toMatch(/dpa_date|breach_notice|not_reviewed/)
  })
})
