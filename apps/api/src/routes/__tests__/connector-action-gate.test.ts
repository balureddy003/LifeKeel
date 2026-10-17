/**
 * CLAUDE.md rule 1 at the generic connector route: POST /connectors/:id/actions/:action
 * used to run any connector action for an authenticated tenant, including broker
 * orders. The live-trading checks (env flag, tenant opt-in) live in the trade-executor
 * path, which this route does not use, so write actions are refused here instead.
 */
import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { connectorRegistry } from '@lifekeel/workflows'
import { registerConnectorCredentialRoutes } from '../connector-credentials.js'
import { GATED_CONNECTOR_ACTIONS, isGatedConnectorAction } from '../../connectors/action-gate.js'

function fakeDb() {
  const col = () => ({ findOne: async () => null, find: () => ({ toArray: async () => [] }) })
  return { collection: col } as never
}

async function app() {
  const f = Fastify()
  f.addHook('onRequest', async (req) => {
    ;(req as unknown as { authContext: unknown }).authContext = { tenant_id: 't1', user_id: 'u1' }
  })
  registerConnectorCredentialRoutes(f, fakeDb())
  await f.ready()
  return f
}

describe('connector action gate', () => {
  it.each(['place_market_order', 'place_limit_order', 'place_stop_order', 'cancel_order'])(
    'refuses trading-212 %s with 403 before any broker call',
    async (action) => {
      const f = await app()
      const res = await f.inject({ method: 'POST', url: `/connectors/trading-212/actions/${action}`, payload: { ticker: 'AAPL_US_EQ', quantity: 1 } })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ ok: false, error: 'action_requires_approval' })
    },
  )

  it('still lets read actions through to the executor', async () => {
    const f = await app()
    const res = await f.inject({ method: 'POST', url: '/connectors/trading-212/actions/get_cash', payload: {} })
    expect(res.statusCode).not.toBe(403)
  })

  it('every non-GET trading-212 registry action is gated, so a new write action forces a decision', () => {
    const def = connectorRegistry.get('trading-212')
    expect(def).toBeTruthy()
    const writes = def!.actions.filter((a) => a.method !== 'GET').map((a) => a.id)
    expect(writes.length).toBeGreaterThan(0)
    const ungated = writes.filter((id) => !isGatedConnectorAction('trading-212', id))
    expect(ungated).toEqual([])
    expect(Object.keys(GATED_CONNECTOR_ACTIONS)).toContain('trading-212')
  })
})
