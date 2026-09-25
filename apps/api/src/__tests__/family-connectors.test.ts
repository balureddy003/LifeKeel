/**
 * Family email connector routes — generic IMAP connect/scan/disconnect.
 *
 * Replaces the previous Gmail-only OAuth connector with one that works
 * against any provider's IMAP server. Covers: provider-preset resolution,
 * connection testing before saving, the background scan triggered right
 * after connecting, and the on-demand "scan now" endpoint.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyConnectorRoutes } from '../routes/family-connectors.js'

const testImapConnectionMock = vi.fn(async () => ({ success: true }))
const scanTenantInboxMock = vi.fn(async () => ({ scanned: 3, inboxItemsCreated: 1, documentsCreated: 1 }))

vi.mock('../email/imap-client.js', () => ({
  testImapConnection: (...args: unknown[]) => testImapConnectionMock(...args),
}))

vi.mock('../jobs/email-scan.js', () => ({
  scanTenantInbox: (...args: unknown[]) => scanTenantInboxMock(...args),
}))

const TEST_TENANT = 'tenant-email-connector-test'

function makeDb(existingCredential: Record<string, unknown> | null = null) {
  const credCol = {
    updateOne: vi.fn(async () => ({})),
    deleteOne: vi.fn(async () => ({ deletedCount: existingCredential ? 1 : 0 })),
    findOne: vi.fn(async () => existingCredential),
    find: vi.fn(() => ({ toArray: async () => (existingCredential ? [existingCredential] : []) })),
  }
  return { collection: () => credCol, _credCol: credCol } as any
}

async function buildApp(db: ReturnType<typeof makeDb>) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TEST_TENANT, user_id: 'user-1' }
  })
  registerFamilyConnectorRoutes(app, db)
  return app
}

describe('POST /connectors/email/credentials', () => {
  beforeEach(() => {
    testImapConnectionMock.mockClear()
    scanTenantInboxMock.mockClear()
    testImapConnectionMock.mockResolvedValue({ success: true })
  })

  it('resolves host/port from a known provider preset when not given explicitly', async () => {
    const db = makeDb()
    const app = await buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/connectors/email/credentials',
      payload: { provider: 'gmail', username: 'me@gmail.com', password: 'app-password' },
    })

    expect(response.statusCode).toBe(200)
    expect(testImapConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'imap.gmail.com', port: 993, useTls: true, username: 'me@gmail.com' }),
    )
  })

  it('accepts a fully custom host/port for a provider not in the preset list', async () => {
    const db = makeDb()
    const app = await buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/connectors/email/credentials',
      payload: { host: 'mail.mycompany.example', port: 993, username: 'me@mycompany.example', password: 'secret' },
    })

    expect(response.statusCode).toBe(200)
    expect(testImapConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'mail.mycompany.example', port: 993 }),
    )
  })

  it('rejects when neither a preset nor an explicit host/port is given', async () => {
    const db = makeDb()
    const app = await buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/connectors/email/credentials',
      payload: { username: 'me@example.com', password: 'secret' },
    })

    expect(response.statusCode).toBe(400)
    expect(testImapConnectionMock).not.toHaveBeenCalled()
  })

  it('rejects and does not save when the IMAP login fails', async () => {
    testImapConnectionMock.mockResolvedValueOnce({ success: false, message: 'Invalid credentials' })
    const db = makeDb()
    const app = await buildApp(db)
    const response = await app.inject({
      method: 'POST',
      url: '/connectors/email/credentials',
      payload: { provider: 'gmail', username: 'me@gmail.com', password: 'wrong' },
    })

    expect(response.statusCode).toBe(422)
    const body = JSON.parse(response.body)
    expect(body.code).toBe('CREDENTIALS_REJECTED')
    expect(db._credCol.updateOne).not.toHaveBeenCalled()
  })

  it('never stores the password in plaintext', async () => {
    const db = makeDb()
    const app = await buildApp(db)
    await app.inject({
      method: 'POST',
      url: '/connectors/email/credentials',
      payload: { provider: 'gmail', username: 'me@gmail.com', password: 'super-secret-app-password' },
    })

    const [, update] = db._credCol.updateOne.mock.calls[0]
    expect(update.$set.password).not.toBe('super-secret-app-password')
  })

  it('triggers a background scan right after connecting', async () => {
    const db = makeDb()
    const app = await buildApp(db)
    await app.inject({
      method: 'POST',
      url: '/connectors/email/credentials',
      payload: { provider: 'gmail', username: 'me@gmail.com', password: 'app-password' },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(scanTenantInboxMock).toHaveBeenCalledTimes(1)
    expect(scanTenantInboxMock).toHaveBeenCalledWith(db, TEST_TENANT, expect.objectContaining({ connector_id: 'email' }))
  })
})

describe('POST /connectors/email/scan', () => {
  beforeEach(() => {
    scanTenantInboxMock.mockClear()
  })

  it('returns 404 when no email connector is connected', async () => {
    const db = makeDb(null)
    const app = await buildApp(db)
    const response = await app.inject({ method: 'POST', url: '/connectors/email/scan' })
    expect(response.statusCode).toBe(404)
    expect(scanTenantInboxMock).not.toHaveBeenCalled()
  })

  it('scans and returns the result when connected', async () => {
    const db = makeDb({ tenant_id: TEST_TENANT, connector_id: 'email', auth_type: 'imap' })
    const app = await buildApp(db)
    const response = await app.inject({ method: 'POST', url: '/connectors/email/scan' })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ scanned: 3, inboxItemsCreated: 1, documentsCreated: 1 })
  })
})

describe('GET /connectors/status', () => {
  it('lists the generic email connector instead of gmail', async () => {
    const db = makeDb()
    const app = await buildApp(db)
    const response = await app.inject({ method: 'GET', url: '/connectors/status' })
    const body = JSON.parse(response.body)
    const ids = body.connectors.map((c: { id: string }) => c.id)
    expect(ids).toContain('email')
    expect(ids).not.toContain('gmail')
  })

  it('flags needsReauth on the email connector when its grant was marked dead, and only then', async () => {
    const statusOf = async (cred: Record<string, unknown>) => {
      const app = await buildApp(makeDb(cred))
      const body = JSON.parse((await app.inject({ method: 'GET', url: '/connectors/status' })).body)
      return body.connectors.find((c: { id: string }) => c.id === 'email')
    }
    const dead = await statusOf({ connector_id: 'email', needs_reauth: true })
    expect(dead).toMatchObject({ connected: true, needsReauth: true })
    const healthy = await statusOf({ connector_id: 'email' })
    expect(healthy.connected).toBe(true)
    expect(healthy.needsReauth).toBeUndefined()
  })
})
