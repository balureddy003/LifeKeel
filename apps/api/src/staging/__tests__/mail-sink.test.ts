/**
 * Staging-only mail sink: in a staging environment, outgoing mail is kept in the
 * staging database and an agent with the test token can read it back, so the
 * confirm-link and approval emails can be tested without a real inbox. It must
 * be impossible to switch on anywhere else.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import sgMail from '@sendgrid/mail'
import { type Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  installStagingMailSink,
  registerStagingMailRoutes,
  resolveStagingSink,
} from '../mail-sink.js'
import { emailConfigured } from '../../email/transport.js'

const TOKEN = 'a-long-random-staging-test-token-0123'
const STAGING = {
  STAGING_MAIL_SINK: 'on',
  LIFEKEEL_ENVIRONMENT: 'staging',
  STAGING_TEST_TOKEN: TOKEN,
  LIFEKEEL_URL: 'https://staging.lifekeel.example',
} as NodeJS.ProcessEnv

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
const realSend = sgMail.send

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = await MongoClient.connect(mongod.getUri())
  db = client.db('staging-sink')
}, 60_000)
afterAll(async () => {
  await client?.close()
  await mongod?.stop()
})
afterEach(async () => {
  sgMail.send = realSend
  await db.collection('staging_mail').deleteMany({})
})

describe('resolveStagingSink: cannot be switched on outside staging', () => {
  it('is off unless asked for', () => {
    expect(resolveStagingSink({} as NodeJS.ProcessEnv)).toBeNull()
    expect(resolveStagingSink({ STAGING_MAIL_SINK: 'off' } as NodeJS.ProcessEnv)).toBeNull()
  })

  it('refuses when the environment is not staging', () => {
    for (const env of [undefined, 'production', 'dev', '']) {
      expect(() =>
        resolveStagingSink({ ...STAGING, LIFEKEEL_ENVIRONMENT: env } as NodeJS.ProcessEnv),
      ).toThrow(/staging/i)
    }
  })

  it('refuses a missing or short token', () => {
    for (const t of [undefined, '', 'short']) {
      expect(() =>
        resolveStagingSink({ ...STAGING, STAGING_TEST_TOKEN: t } as NodeJS.ProcessEnv),
      ).toThrow(/token/i)
    }
  })

  it('refuses when the app address is a production host, even if labelled staging', () => {
    for (const url of [
      'https://app.lifekeel.co.uk',
      'https://app.lifekeel.si',
      'https://lifekeel.co.uk',
    ]) {
      expect(() =>
        resolveStagingSink({ ...STAGING, LIFEKEEL_URL: url } as NodeJS.ProcessEnv),
      ).toThrow(/production/i)
    }
    expect(() =>
      resolveStagingSink({
        ...STAGING,
        LIFEKEEL_APP_HOSTS: 'staging.lifekeel.example,app.lifekeel.co.uk',
      } as NodeJS.ProcessEnv),
    ).toThrow(/production/i)
  })

  it('accepts a proper staging configuration', () => {
    expect(resolveStagingSink(STAGING)).toEqual({ token: TOKEN })
  })

  it('makes the mail senders treat email as configured', () => {
    expect(emailConfigured({} as NodeJS.ProcessEnv)).toBe(false)
    expect(emailConfigured({ STAGING_MAIL_SINK: 'on' } as NodeJS.ProcessEnv)).toBe(true)
  })
})

describe('the sink keeps mail instead of sending it', () => {
  it('stores each message with its recipients and the links in it', async () => {
    installStagingMailSink(async () => db, STAGING)
    await sgMail.send({
      to: ['Partner@Example.com'],
      from: 'wehelp@lifekeel.co.uk',
      subject: 'Confirm your email',
      text: 'Open https://staging.lifekeel.example/verify?token=abc123 to confirm.',
      html: '<a href="https://staging.lifekeel.example/verify?token=abc123">Confirm</a>',
    })
    const [row] = await db.collection('staging_mail').find({}).toArray()
    expect(row?.['to']).toEqual(['partner@example.com'])
    expect(row?.['subject']).toBe('Confirm your email')
    expect(row?.['links']).toEqual(['https://staging.lifekeel.example/verify?token=abc123'])
  })
})

describe('GET /staging/mail', () => {
  async function app() {
    const a = Fastify()
    registerStagingMailRoutes(a, async () => db, STAGING)
    await a.ready()
    return a
  }
  const seed = async () => {
    installStagingMailSink(async () => db, STAGING)
    await sgMail.send({
      to: 'a@example.com',
      from: 'x@y.z',
      subject: 'For A',
      text: 'https://staging.lifekeel.example/one',
    })
    await sgMail.send({ to: 'b@example.com', from: 'x@y.z', subject: 'For B', text: 'hi' })
  }

  it('refuses without the right token', async () => {
    const a = await app()
    for (const headers of [{}, { 'x-staging-token': 'wrong' }]) {
      const r = await a.inject({ method: 'GET', url: '/staging/mail?to=a@example.com', headers })
      expect(r.statusCode).toBe(401)
    }
  })

  it('needs a recipient, so it cannot dump every message', async () => {
    const a = await app()
    const r = await a.inject({
      method: 'GET',
      url: '/staging/mail',
      headers: { 'x-staging-token': TOKEN },
    })
    expect(r.statusCode).toBe(400)
  })

  it('returns only the messages for that recipient, newest first', async () => {
    await seed()
    const a = await app()
    const r = await a.inject({
      method: 'GET',
      url: '/staging/mail?to=A@Example.com',
      headers: { 'x-staging-token': TOKEN },
    })
    expect(r.statusCode).toBe(200)
    const body = r.json() as { messages: Array<{ subject: string; links: string[] }> }
    expect(body.messages.map((m) => m.subject)).toEqual(['For A'])
    expect(body.messages[0]?.links).toEqual(['https://staging.lifekeel.example/one'])
  })

  it('is not registered at all when the sink is off', async () => {
    const a = Fastify()
    registerStagingMailRoutes(a, async () => db, {} as NodeJS.ProcessEnv)
    await a.ready()
    const r = await a.inject({ method: 'GET', url: '/staging/mail?to=a@example.com' })
    expect(r.statusCode).toBe(404)
  })
})
