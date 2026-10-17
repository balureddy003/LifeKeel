/**
 * CLAUDE.md rule 1 at the generic connector route: POST /connectors/:id/actions/:action
 * used to run any connector action for an authenticated tenant, including broker orders,
 * emails and public posts. The live-trading checks live in the trade-executor path, which this
 * route does not use. The route is now read-only: only an exact registry GET action may run.
 */
import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { CONNECTORS } from '@lifekeel/workflows'
import { registerConnectorCredentialRoutes } from '../connector-credentials.js'
import { classifyConnectorAction } from '../../connectors/action-gate.js'

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

const post = (f: Awaited<ReturnType<typeof app>>, connector: string, action: string) =>
  f.inject({ method: 'POST', url: `/connectors/${connector}/actions/${action}`, payload: { ticker: 'AAPL_US_EQ', quantity: 1 } })

const writes = CONNECTORS.flatMap((c) => c.actions.filter((a) => a.method !== 'GET').map((a) => [c.id, a.id] as const))

describe('connector action gate (read-only route)', () => {
  it('the registry has write actions to protect', () => {
    expect(writes.length).toBeGreaterThan(50)
  })

  it.each(writes)('refuses %s %s with 403 before any credential lookup', async (connector, action) => {
    const f = await app()
    const res = await post(f, connector, action)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ ok: false, error: 'action_requires_approval' })
  })

  it('does not let the twitter_x aliases the executor resolves reach a write', async () => {
    const f = await app()
    for (const alias of ['create_tweet', 'create_thread', 'reply_tweet']) {
      const res = await post(f, 'twitter_x', alias)
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ ok: false, error: 'unknown_action' })
    }
  })

  it('still lets an exact registry GET action reach the executor', async () => {
    const f = await app()
    const res = await post(f, 'trading-212', 'get_cash')
    expect(res.statusCode).not.toBe(403)
    expect(res.statusCode).not.toBe(404)
  })

  it('classifies read, write and unknown', () => {
    expect(classifyConnectorAction('trading-212', 'get_cash')).toBe('read')
    expect(classifyConnectorAction('trading-212', 'place_market_order')).toBe('write')
    expect(classifyConnectorAction('trading-212', 'nope')).toBe('unknown')
    expect(classifyConnectorAction('nope', 'get_cash')).toBe('unknown')
  })
})
