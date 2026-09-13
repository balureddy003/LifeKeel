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
