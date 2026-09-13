/**
 * OAK-002: POST /connectors/:id/credentials must reject any connector id
 * outside the family app's own allowlist. Before this fix, any
 * authenticated tenant could attach a stripe/linkedin/twitter_x credential
 * directly against the API — connectors the family app's UI never offers —
 * and activate action-executor.ts's real side effects the next time an
 * insight's action text happened to match its keyword patterns.
 */

import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerConnectorCredentialRoutes } from '../routes/connector-credentials.js'

vi.mock('@agentoak/pipeline', () => ({
  ConnectorSyncEngine: class {
    backfill = vi.fn(async () => [])
    testConnection = vi.fn(async () => ({ success: true, message: 'ok' }))
  },
}))

const TEST_TENANT = 'tenant-allowlist-test'

function makeDb() {
  const credCol = {
    replaceOne: vi.fn(async () => ({})),
    findOne: vi.fn(async () => null),
    find: vi.fn(() => ({ project: () => ({ toArray: async () => [] }), toArray: async () => [] })),
    deleteOne: vi.fn(async () => ({})),
  }
  return { collection: () => credCol } as any
}

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TEST_TENANT, user_id: 'user-1' }
  })
  registerConnectorCredentialRoutes(app, makeDb(), undefined, undefined, undefined)
  return app
}

describe('OAK-002: connector allowlist on POST /connectors/:id/credentials', () => {
  it.each(['stripe', 'linkedin', 'twitter_x', 'xero', 'hubspot', 'sendgrid', 'twilio'])(
    'rejects %s with 403 — not a family-app connector',
    async (connectorId) => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'POST',
        url: `/connectors/${connectorId}/credentials`,
        payload: { auth_type: 'api_key', api_key: 'secret' },
      })
      expect(res.statusCode).toBe(403)
    },
  )

  it.each(['gmail', 'email', 'open-banking'])(
    'still accepts %s — a real family-app connector',
    async (connectorId) => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'POST',
        url: `/connectors/${connectorId}/credentials`,
        payload: { auth_type: 'api_key', api_key: 'secret' },
      })
      expect(res.statusCode).not.toBe(403)
    },
  )
})

// Follow-up finding: the allowlist above was only ever wired into
// POST /connectors/:id/credentials — GET /connectors/:id/oauth/start could
// still walk the full OAuth handshake for any of the 30+ registered
// connectors (twitter_x included) with zero gating, reachable via a direct
// API call even though no in-repo UI ever requests it. Studio/kairos-web/
// kairos-mobile legitimately use connectors this app doesn't (twitter_x for
// real social actions), so the fix is scoped to `?app=family` only.
describe('follow-up: connector allowlist on GET /connectors/:id/oauth/start', () => {
  it('rejects twitter_x with 403 when the request claims to be the family app', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/connectors/twitter_x/oauth/start?app=family' })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toContain('twitter_x')
  })

  it('still accepts gmail (a real family-app connector) with ?app=family', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/connectors/gmail/oauth/start?app=family' })
    expect(res.statusCode).not.toBe(403)
  })

  it('does not block twitter_x for the studio frontend — only `family` is gated', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/connectors/twitter_x/oauth/start?app=studio' })
    // Still may fail for unrelated reasons (no OAuth client configured in
    // this test env) — the point is proving it's not blocked by *this*
    // allowlist check specifically.
    expect(res.statusCode).not.toBe(403)
  })

  it('does not block twitter_x when no `app` param is given (defaults to studio)', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/connectors/twitter_x/oauth/start' })
    expect(res.statusCode).not.toBe(403)
  })
})
