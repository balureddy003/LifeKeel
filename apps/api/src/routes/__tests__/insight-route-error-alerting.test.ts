/**
 * KEEL-008: insights.ts's catch blocks only ever run for a genuine
 * unexpected failure (a legitimate not-found is always handled by an
 * explicit check inside the try, never a throw) — but before this fix,
 * that failure was indistinguishable from "nothing here" to both the
 * client and to ops. Proves the wiring is real: a thrown DB error inside
 * a route actually reaches recordInsightRouteError (Prometheus) and
 * sendOpsAlert (Slack), not just that the helper exists in source.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerInsightRoutes } from '../insights.js'

const recordInsightRouteErrorMock = vi.fn<(route: string) => void>()
const sendOpsAlertMock = vi.fn<(opts: Record<string, unknown>) => Promise<void>>(async () => {})

vi.mock('../metrics.js', () => ({
  recordInsightRouteError: (route: string) => recordInsightRouteErrorMock(route),
}))

vi.mock('../../lib/ops-alerts.js', () => ({
  sendOpsAlert: (opts: Record<string, unknown>) => sendOpsAlertMock(opts),
}))

vi.mock('../../db.js', () => ({
  getInsightsCollection: vi.fn(async () => {
    throw new Error('connection refused')
  }),
  getReceiptsCollection: vi.fn(async () => ({ find: () => ({ toArray: async () => [] }) })),
}))

const TENANT = 'tenant-db-outage-test'

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (request: any) => {
    request.authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  await registerInsightRoutes(app, {} as any)
  return app
}

describe('KEEL-008: insight route DB errors reach metrics + ops alerting', () => {
  beforeEach(() => {
    recordInsightRouteErrorMock.mockClear()
    sendOpsAlertMock.mockClear()
  })

  it('GET /insights/:id records the metric and fires an ops alert on a real DB error', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/insights/some-id' })

    // Client-facing behavior stays exactly as-is — still an honest 404,
    // not leaking that this was actually an infra failure.
    expect(res.statusCode).toBe(404)

    expect(recordInsightRouteErrorMock).toHaveBeenCalledWith('GET /insights/:id')

    expect(sendOpsAlertMock).toHaveBeenCalledTimes(1)
    const alert = sendOpsAlertMock.mock.calls[0]![0] as Record<string, unknown>
    expect(alert.severity).toBe('critical')
    expect(alert.fingerprint).toBe('insight-route-error:GET /insights/:id')
    expect(alert.tenant_id).toBe(TENANT)
    expect(String(alert.message)).toContain('connection refused')
  })

  it('GET /insights (list) records the metric with its own route label, distinct from GET /insights/:id', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/insights' })

    // This route degrades to an empty list rather than 404 — but the
    // internal signal must still fire.
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ insights: [], total: 0, limit: 20, offset: 0, has_more: false })

    expect(recordInsightRouteErrorMock).toHaveBeenCalledWith('GET /insights')
    expect(sendOpsAlertMock).toHaveBeenCalledTimes(1)
  })
})
