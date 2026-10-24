/**
 * R37: a connector OAuth flow can only be completed by the signed-in user
 * who started it. R38: the Gmail grant asks for read-only access.
 *
 * Real MongoDB (MongoMemoryServer) so the parked grant's single-use
 * findOneAndDelete and its encryption run for real; Google's endpoints are
 * stubbed with a fetch mock.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

vi.mock('../jobs/email-scan.js', () => ({ scanTenantInbox: vi.fn(async () => ({})) }))
vi.mock('@lifekeel/pipeline', () => ({ ConnectorSyncEngine: class {} }))

const { registerConnectorCredentialRoutes } = await import('../routes/connector-credentials.js')

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance

const ATTACKER = { tenant_id: 'tenant-attacker', user_id: 'attacker' }
const VICTIM = { tenant_id: 'tenant-victim', user_id: 'victim' }

beforeAll(async () => {
  process.env['JWT_SECRET'] = 'connector-oauth-binding-test-secret-0123456789'
  process.env['GOOGLE_CLIENT_ID'] = 'client-id'
  process.env['GOOGLE_CLIENT_SECRET'] = 'client-secret'
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('oauth-binding')
  app = Fastify()
  app.addHook('onRequest', async (request) => {
    const who = request.headers['x-who']
    if (who === 'attacker') request.authContext = { ...ATTACKER, roles: ['admin'] } as never
    if (who === 'victim') request.authContext = { ...VICTIM, roles: ['admin'] } as never
  })
  registerConnectorCredentialRoutes(app, db)
  await app.ready()

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'victim-access',
            refresh_token: 'victim-refresh',
            expires_in: 3600,
          }),
          { status: 200 },
        )
      }
      if (String(url).includes('/gmail/v1/users/me/profile')) {
        return new Response(JSON.stringify({ emailAddress: 'victim@gmail.com' }), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
})

beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await app.close()
  await client.close()
  await mongod.stop()
})

async function startAs(who: 'attacker' | 'victim'): Promise<{ authUrl: URL; state: string }> {
  const res = await app.inject({
    method: 'GET',
    url: '/connectors/gmail/oauth/start?app=family&mode=json',
    headers: { 'x-who': who },
  })
  expect(res.statusCode).toBe(200)
  const authUrl = new URL(res.json().auth_url)
  return { authUrl, state: authUrl.searchParams.get('state')! }
}

async function callback(state: string): Promise<URL> {
  const res = await app.inject({
    method: 'GET',
    url: `/connectors/gmail/oauth/callback?code=provider-code&state=${encodeURIComponent(state)}`,
  })
  expect(res.statusCode).toBe(302)
  return new URL(String(res.headers.location))
}

const savedCredentials = () => db.collection('connector_credentials').find({}).toArray()

describe('R38: Gmail scope', () => {
  it('requests gmail.readonly only — no full-mailbox or send permission', async () => {
    const { authUrl } = await startAs('attacker')
    const scope = authUrl.searchParams.get('scope')!
    expect(scope).toBe('https://www.googleapis.com/auth/gmail.readonly')
    expect(scope).not.toContain('mail.google.com')
    expect(scope).not.toContain('gmail.send')
  })
})

describe('R37: the callback parks the grant; only its initiator can claim it', () => {
  it("a victim who completes the attacker's link cannot attach their mailbox to the attacker's household", async () => {
    const { state } = await startAs('attacker')
    const landing = await callback(state)
    const grant = landing.searchParams.get('complete')!
    expect(grant).toBeTruthy()
    // Nothing is saved by the callback itself.
    expect(await savedCredentials()).toHaveLength(0)

    const victimClaim = await app.inject({
      method: 'POST',
      url: '/connectors/gmail/oauth/complete',
      headers: { 'x-who': 'victim' },
      payload: { grant },
    })
    expect(victimClaim.statusCode).toBe(403)

    // The grant is single-use: the attacker can't claim it afterwards either.
    const attackerClaim = await app.inject({
      method: 'POST',
      url: '/connectors/gmail/oauth/complete',
      headers: { 'x-who': 'attacker' },
      payload: { grant },
    })
    expect(attackerClaim.statusCode).toBe(404)
    expect(await savedCredentials()).toHaveLength(0)
  })

  it('the user who started the flow completes it and the tokens are stored encrypted', async () => {
    const { state } = await startAs('victim')
    const grant = (await callback(state)).searchParams.get('complete')!
    const res = await app.inject({
      method: 'POST',
      url: '/connectors/gmail/oauth/complete',
      headers: { 'x-who': 'victim' },
      payload: { grant },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().params).toEqual({ connected: 'email', email: 'victim@gmail.com' })
    const creds = await savedCredentials()
    expect(creds.every((c) => c['tenant_id'] === VICTIM.tenant_id)).toBe(true)
    expect(JSON.stringify(creds)).not.toContain('victim-refresh')
    expect(await db.collection('oauth_pending_grants').countDocuments({})).toBe(0)
  })

  it('a completion request must be signed in', async () => {
    const { state } = await startAs('victim')
    const grant = (await callback(state)).searchParams.get('complete')!
    const res = await app.inject({
      method: 'POST',
      url: '/connectors/gmail/oauth/complete',
      payload: { grant },
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})
