import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerSendgridWebhookRoutes } from '../webhooks-sendgrid.js'
import { lifecycleSendsCol, ensureLifecycleIndexes } from '../../marketing/lifecycle-emails.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance

// A real Ed25519 keypair — the route verifies SendGrid's signature over
// `timestamp + rawBody`, so tests sign exactly the same way.
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pubB64 = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('base64')

function signBody(body: string): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('base64')
  return { timestamp, signature }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('sg-webhook-test')
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
  registerSendgridWebhookRoutes(app, db)
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

const PREV_KEY = process.env['SENDGRID_EVENT_WEBHOOK_KEY']
beforeAll(() => { process.env['SENDGRID_EVENT_WEBHOOK_KEY'] = pubB64 })
afterAll(() => { process.env['SENDGRID_EVENT_WEBHOOK_KEY'] = PREV_KEY })

async function postEvents(events: object[], signIt = true) {
  const body = JSON.stringify(events)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signIt) {
    const { timestamp, signature } = signBody(body)
    headers['x-twilio-email-event-webhook-timestamp'] = timestamp
    headers['x-twilio-email-event-webhook-signature'] = signature
  }
  return app.inject({ method: 'POST', url: '/webhooks/sendgrid', payload: body, headers })
}

async function claimSend(key: string, recipient = 'lead-1') {
  await lifecycleSendsCol(db).insertOne({
    id: 'x', key, sequence: 'campaign', step: 's', recipient,
    email: 'a@b.co', status: 'sent', created_at: new Date(),
  })
}

describe('POST /webhooks/sendgrid', () => {
  it('rejects an unsigned batch', async () => {
    const res = await postEvents([{ event: 'open', lk: 'k' }], false)
    expect(res.statusCode).toBe(400)
  })

  it('rejects a forged signature', async () => {
    const body = JSON.stringify([{ event: 'open', lk: 'k' }])
    const res = await app.inject({
      method: 'POST', url: '/webhooks/sendgrid', payload: body,
      headers: {
        'content-type': 'application/json',
        'x-twilio-email-event-webhook-timestamp': '1',
        'x-twilio-email-event-webhook-signature': Buffer.from('forged').toString('base64'),
      },
    })
    expect(res.statusCode).toBe(401)
  })

  it('records open + click on the ledger row via lk', async () => {
    await claimSend('campaign:c1:lead-1')
    const res = await postEvents([
      { event: 'delivered', lk: 'campaign:c1:lead-1', timestamp: 1700000000 },
      { event: 'open', lk: 'campaign:c1:lead-1', timestamp: 1700000100 },
      { event: 'open', lk: 'campaign:c1:lead-1', timestamp: 1700000200 },
      { event: 'click', lk: 'campaign:c1:lead-1', timestamp: 1700000300 },
    ])
    expect(res.statusCode).toBe(200)
    expect(res.json().applied).toBe(4)
    const row = await lifecycleSendsCol(db).findOne({ key: 'campaign:c1:lead-1' })
    expect(row?.delivered_at).toBeTruthy()
    expect(row?.open_count).toBe(2)
    // First-open wins — $min keeps the earliest timestamp.
    expect(new Date(row!.opened_at!).getTime()).toBe(1700000100000)
    expect(row?.click_count).toBe(1)
  })

  it('ignores events without a ledger key and unknown event types', async () => {
    const res = await postEvents([{ event: 'open' }, { event: 'processed', lk: 'x' }])
    expect(res.json().applied).toBe(0)
  })

  it('suppresses a spam-reported recipient', async () => {
    await claimSend('campaign:c1:lead-9', 'lead-9')
    await db.collection('leads').insertOne({ id: 'lead-9', suppressed: false })
    await postEvents([{ event: 'spamreport', lk: 'campaign:c1:lead-9', timestamp: 1700000000 }])
    const lead = await db.collection('leads').findOne({ id: 'lead-9' })
    expect(lead?.['suppressed']).toBe(true)
  })
})
