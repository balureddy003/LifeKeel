/**
 * API request metrics are labelled by route template only (ISSUES H03): an
 * unmatched URL must not create a series or carry its query into telemetry.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { recordApiRequest, renderMetrics, UNMATCHED_ROUTE_LABEL } from '../metrics.js'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  app.addHook('onResponse', async (request, reply) => {
    recordApiRequest(request.method, request.routeOptions.url, reply.statusCode, 0.001)
  })
  app.get('/documents/:id', async () => ({ ok: true }))
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

function apiSeries(text: string): string[] {
  return text.split('\n').filter((l) => /^\w*api_requests_total\{/.test(l))
}

describe('API request metric labels', () => {
  it('uses the route template, not the concrete path', async () => {
    await app.inject({ method: 'GET', url: '/documents/doc-123?token=secret' })
    const series = apiSeries(await renderMetrics())
    expect(series.some((l) => l.includes('route="/documents/:id"'))).toBe(true)
    expect(series.join('\n')).not.toContain('doc-123')
  })

  it('collapses unmatched URLs into one series without query data', async () => {
    const before = apiSeries(await renderMetrics()).length
    for (let i = 0; i < 25; i++) {
      await app.inject({ method: 'GET', url: `/probe-${i}?email=person${i}@example.com` })
    }
    const series = apiSeries(await renderMetrics())
    const text = series.join('\n')
    expect(UNMATCHED_ROUTE_LABEL).toBe('unmatched')
    expect(text).toContain('route="unmatched"')
    expect(text).not.toContain('probe-')
    expect(text).not.toContain('@example.com')
    expect(series.length - before).toBeLessThanOrEqual(1)
  })
})
