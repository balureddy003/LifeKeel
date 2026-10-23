/**
 * /metrics scrape authorization (§8.4): a valid scrape token returns the
 * exposition text; wrong, missing, and session-JWT credentials get 401.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Engine } from '@lifekeel/engine'
import { AuthService } from '@lifekeel/platform'
import { metricsScrapeAuthorized, registerMetricsRoutes } from '../metrics.js'

const TOKEN = 'scrape-token-0123456789abcdef'
let app: FastifyInstance

const engine = {
  detectorCount: 3,
  metrics: { snapshot: () => ({ total_evaluations: 0, avg_latency_ms: 0, detectors: {} }) },
} as unknown as Engine

beforeAll(async () => {
  process.env['METRICS_SCRAPE_TOKEN'] = TOKEN
  app = Fastify()
  await registerMetricsRoutes(app, engine)
  await app.ready()
})

afterAll(async () => {
  delete process.env['METRICS_SCRAPE_TOKEN']
  await app.close()
})

describe('GET /metrics', () => {
  it('returns the exposition text for the scrape token', async () => {
    const res = await app.inject({ url: '/metrics', headers: { authorization: `Bearer ${TOKEN}` } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('lifekeel_engine_detectors_loaded')
  })

  it('401s a missing or wrong token', async () => {
    expect((await app.inject({ url: '/metrics' })).statusCode).toBe(401)
    const wrong = await app.inject({ url: '/metrics', headers: { authorization: 'Bearer nope' } })
    expect(wrong.statusCode).toBe(401)
  })

  it('401s a valid session JWT', async () => {
    const jwt = await new AuthService('x'.repeat(32)).sign({
      sub: 'u',
      tenant_id: 't-1',
      roles: ['admin'],
    })
    const res = await app.inject({ url: '/metrics', headers: { authorization: `Bearer ${jwt}` } })
    expect(res.statusCode).toBe(401)
  })
})

describe('metricsScrapeAuthorized', () => {
  it('is open only when no token is configured', () => {
    expect(metricsScrapeAuthorized(undefined, undefined)).toBe(true)
    expect(metricsScrapeAuthorized(undefined, TOKEN)).toBe(false)
    expect(metricsScrapeAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false)
  })
})
