import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerResendWebhookRoutes } from '../webhooks-resend.js'
import { lifecycleSendsCol, ensureLifecycleIndexes } from '../../marketing/lifecycle-emails.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance

// A real whsec_-shaped secret — the route verifies Svix HMAC-SHA256 over
// `svix-id`.`svix-timestamp`.rawBody, so tests sign exactly the same way.
const SECRET_BYTES = randomBytes(32)
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`

function signBody(body: string): { id: string; timestamp: string; signature: string } {
  const id = `msg_${randomBytes(8).toString('hex')}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', SECRET_BYTES)
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest('base64')
  return { id, timestamp, signature: `v1,${sig}` }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('resend-webhook-test')
  ensureLifecycleIndexes(db)

  app = Fastify()
  // Mirror server.ts: preserve raw bytes for signature verification.
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    ;(req as unknown as { rawBody?: Buffer }).rawBody = body as Buffer
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')))
    } catch (err) {
      done(err as Error)
    }
  })
  registerResendWebhookRoutes(app, db)
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})

beforeEach(async () => {
  for (const name of await db.listCollections().toArray()) {
    await db.collection(name.name).deleteMany({})
  }
})

const PREV_KEY = process.env['RESEND_WEBHOOK_SECRET']
beforeAll(() => {
  process.env['RESEND_WEBHOOK_SECRET'] = SECRET
})
afterAll(() => {
  process.env['RESEND_WEBHOOK_SECRET'] = PREV_KEY
})

async function postEvent(event: object, signIt = true) {
  const body = JSON.stringify(event)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signIt) {
    const { id, timestamp, signature } = signBody(body)
    headers['svix-id'] = id
    headers['svix-timestamp'] = timestamp
    headers['svix-signature'] = signature
  }
  return app.inject({ method: 'POST', url: '/webhooks/resend', payload: body, headers })
}

async function claimSend(key: string, recipient = 'lead-1') {
  await lifecycleSendsCol(db).insertOne({
    id: 'x',
    key,
    sequence: 'campaign',
    step: 's',
    recipient,
    email: 'a@b.co',
    status: 'sent',
    attempts: 1,
    created_at: new Date(),
  })
}

const withTag = (type: string, lk: string, created = '2026-10-23T12:00:00.000Z') => ({
  type,
  created_at: created,
  data: { email_id: 'e1', to: ['a@b.co'], tags: { lk } },
})

describe('POST /webhooks/resend', () => {
  it('rejects an unsigned event', async () => {
    const res = await postEvent(withTag('email.delivered', 'k'), false)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a forged signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/resend',
      payload: JSON.stringify(withTag('email.delivered', 'k')),
      headers: {
        'content-type': 'application/json',
        'svix-id': 'msg_x',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': `v1,${Buffer.from('forged').toString('base64')}`,
      },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a stale timestamp (replay window)', async () => {
    const body = JSON.stringify(withTag('email.delivered', 'k'))
    const stale = String(Math.floor(Date.now() / 1000) - 3600)
    const sig = createHmac('sha256', SECRET_BYTES)
      .update(`msg_x.${stale}.`)
      .update(body)
      .digest('base64')
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/resend',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'svix-id': 'msg_x',
        'svix-timestamp': stale,
        'svix-signature': `v1,${sig}`,
      },
    })
    expect(res.statusCode).toBe(401)
  })

  it('records delivered + open + click on the ledger row via the lk tag', async () => {
    await claimSend('campaign:c1:lead-1')
    const ts = '2026-10-23T12:00:00.000Z'
    await postEvent(withTag('email.delivered', 'campaign:c1:lead-1', ts))
    await postEvent(withTag('email.opened', 'campaign:c1:lead-1', '2026-10-23T12:01:00.000Z'))
    const res = await postEvent(
      withTag('email.opened', 'campaign:c1:lead-1', '2026-10-23T12:02:00.000Z'),
    )
    expect(res.statusCode).toBe(200)
    await postEvent(withTag('email.clicked', 'campaign:c1:lead-1'))
    const row = await lifecycleSendsCol(db).findOne({ key: 'campaign:c1:lead-1' })
    expect(row?.delivered_at).toBeTruthy()
    expect(row?.open_count).toBe(2)
    // First-open wins — $min keeps the earliest timestamp.
    expect(new Date(row!.opened_at!).toISOString()).toBe('2026-10-23T12:01:00.000Z')
    expect(row?.click_count).toBe(1)
  })

  it('marks bounced for email.bounced and email.failed', async () => {
    await claimSend('campaign:c1:lead-2')
    await postEvent(withTag('email.bounced', 'campaign:c1:lead-2'))
    const row = await lifecycleSendsCol(db).findOne({ key: 'campaign:c1:lead-2' })
    expect(row?.bounced).toBe(true)
  })

  it('ignores events without an lk tag and unknown event types', async () => {
    const noTag = await postEvent({ type: 'email.delivered', data: {} })
    const unknown = await postEvent(withTag('email.sent', 'x'))
    expect(noTag.json().applied).toBe(0)
    expect(unknown.json().applied).toBe(0)
  })

  it('suppresses a complaining recipient', async () => {
    await claimSend('campaign:c1:lead-9', 'lead-9')
    await db.collection('leads').insertOne({ id: 'lead-9', suppressed: false })
    await postEvent(withTag('email.complained', 'campaign:c1:lead-9'))
    const lead = await db.collection('leads').findOne({ id: 'lead-9' })
    expect(lead?.['suppressed']).toBe(true)
  })
})
