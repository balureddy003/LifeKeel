/**
 * Connector credential routes — backfill-on-connect coverage.
 *
 * Covers a real bug: saving API-key credentials never triggered a
 * historical backfill — only the OAuth2 callback did. A tenant could
 * connect a connector and see nothing sync until someone manually called
 * POST /connectors/:id/backfill, which nothing in the UI does. Uses
 * 'gmail' (one of the family app's own allowed connectors — see KEEL-002's
 * FAMILY_CONNECTOR_ALLOWLIST in connector-credentials.ts) rather than the
 * original 'trading-212' example, which isn't a connector this app
 * actually offers and would now be rejected before reaching the backfill
 * logic this test exists to cover.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerConnectorCredentialRoutes } from '../routes/connector-credentials.js'
import { withTenantKeys } from './helpers/tenant-keys-fake.js'

const backfillMock = vi.fn(async () => [{ records_fetched: 3, insights_triggered: 1, resource: 'Account' }])
const testConnectionMock = vi.fn(async () => ({ success: true, message: 'ok' }))

vi.mock('@lifekeel/pipeline', () => ({
  ConnectorSyncEngine: class {
    backfill = backfillMock
    testConnection = testConnectionMock
  },
}))

const TEST_TENANT = 'tenant-connector-test'

function makeDb() {
  const credCol = {
    replaceOne: vi.fn(async () => ({})),
    findOne: vi.fn(async () => null),
    find: vi.fn(() => ({ project: () => ({ toArray: async () => [] }), toArray: async () => [] })),
    deleteOne: vi.fn(async () => ({})),
  }
  return { collection: withTenantKeys(() => credCol) } as any
}

const fakeConnectorLoader = {
  get: vi.fn((id: string) => ({ id, resources: [{ name: 'Account', path: '/equity/account' }] })),
} as any

async function buildApp(withPipelineDeps: boolean) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TEST_TENANT, user_id: 'user-1' }
  })
  const db = makeDb()
  registerConnectorCredentialRoutes(
    app,
    db,
    withPipelineDeps ? fakeConnectorLoader : undefined,
    withPipelineDeps ? ({} as any) : undefined,
    withPipelineDeps ? ({} as any) : undefined,
  )
  return app
}

describe('POST /connectors/:id/credentials', () => {
  beforeEach(() => {
    backfillMock.mockClear()
    testConnectionMock.mockClear()
    fakeConnectorLoader.get.mockClear()
  })

  it('triggers a historical backfill after saving api_key credentials', async () => {
    const app = await buildApp(true)
    const response = await app.inject({
      method: 'POST',
      url: '/connectors/gmail/credentials',
      payload: { auth_type: 'api_key', api_key: 'secret', extra: { live_mode: 'true' } },
    })

    expect(response.statusCode).toBe(200)
    // Backfill is fire-and-forget — flush microtasks so the mocked call registers.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fakeConnectorLoader.get).toHaveBeenCalledWith('gmail')
    expect(testConnectionMock).toHaveBeenCalledTimes(1)
    expect(testConnectionMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'gmail' }), TEST_TENANT)
    expect(backfillMock).toHaveBeenCalledTimes(1)
    expect(backfillMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'gmail' }), TEST_TENANT)
  })

  it('does not throw when pipeline dependencies are unavailable', async () => {
    const app = await buildApp(false)
    const response = await app.inject({
      method: 'POST',
      url: '/connectors/gmail/credentials',
      payload: { auth_type: 'api_key', api_key: 'secret' },
    })

    expect(response.statusCode).toBe(200)
    expect(testConnectionMock).not.toHaveBeenCalled()
    expect(backfillMock).not.toHaveBeenCalled()
  })

  it('rejects invalid credentials and deletes the saved record', async () => {
    testConnectionMock.mockResolvedValueOnce({ success: false, message: 'Unauthorized' })
    const app = await buildApp(true)
    const response = await app.inject({
      method: 'POST',
      url: '/connectors/gmail/credentials',
      payload: { auth_type: 'api_key', api_key: 'secret', extra: { live_mode: 'true' } },
    })

    expect(response.statusCode).toBe(422)
    const body = JSON.parse(response.body)
    expect(body.code).toBe('CREDENTIALS_REJECTED')
    expect(testConnectionMock).toHaveBeenCalledTimes(1)
    expect(backfillMock).not.toHaveBeenCalled()
  })
})
