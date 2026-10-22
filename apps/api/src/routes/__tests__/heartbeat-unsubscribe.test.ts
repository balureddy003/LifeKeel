/**
 * Heartbeat one-click opt-out (RFC 8058): signed token, POST performs the
 * opt-out, GET never mutates, and the email carries the headers.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { heartbeatUnsubUrl, registerHeartbeatUnsubscribeRoutes } from '../heartbeat-unsubscribe.js'
import { buildHeartbeatMessage } from '../../auth-email.js'

type Doc = Record<string, unknown>
let prefs: Doc[]
let app: FastifyInstance

const fakeDb = () =>
  ({
    collection: (name: string) => ({
      findOne: async () =>
        name === 'family_groups'
          ? {
              tenant_id: 't1',
              members: [
                { id: 'm1', status: 'active' },
                { id: 'm2', status: 'removed' },
              ],
            }
          : null,
      updateOne: async (f: Doc, u: { $set: Doc; $setOnInsert: Doc }) => {
        let row = prefs.find((p) => p['tenant_id'] === f['tenant_id'])
        if (!row) prefs.push((row = { ...u.$setOnInsert }))
        Object.assign(row, u.$set)
        return { matchedCount: 1 }
      },
    }),
  }) as never

const pathOf = (url: string) => url.replace('http://api.test', '')

beforeEach(async () => {
  prefs = []
  app = Fastify()
  await registerHeartbeatUnsubscribeRoutes(app, fakeDb())
  await app.ready()
})

describe('heartbeat unsubscribe', () => {
  it('POST with the RFC 8058 form body sets heartbeat_cadence to off', async () => {
    const res = await app.inject({
      method: 'POST',
      url: pathOf(heartbeatUnsubUrl('http://api.test', 't1', 'm1')),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    })
    expect(res.statusCode).toBe(200)
    expect(prefs[0]).toMatchObject({ tenant_id: 't1', heartbeat_cadence: 'off' })
  })

  it('GET shows a confirm page and changes nothing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: pathOf(heartbeatUnsubUrl('http://api.test', 't1', 'm1')),
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<form method="post"')
    expect(prefs).toHaveLength(0)
  })

  it('rejects a tampered signature, a swapped member, and a non-active member', async () => {
    const good = pathOf(heartbeatUnsubUrl('http://api.test', 't1', 'm1'))
    const bad = await app.inject({ method: 'POST', url: good.replace(/sig=.{4}/, 'sig=xxxx') })
    expect(bad.statusCode).toBe(400)
    const swapped = await app.inject({
      method: 'POST',
      url: good.replace('member=m1', 'member=m9'),
    })
    expect(swapped.statusCode).toBe(400)
    const removed = await app.inject({
      method: 'POST',
      url: pathOf(heartbeatUnsubUrl('http://api.test', 't1', 'm2')),
    })
    expect(removed.statusCode).toBe(400)
    expect(prefs).toHaveLength(0)
  })
})

describe('buildHeartbeatMessage', () => {
  const rendered = { subject: 's', text: 'body', html: '<p>Hi,</p><p>body</p>' }

  it('adds List-Unsubscribe + List-Unsubscribe-Post and a footer link', () => {
    const url = heartbeatUnsubUrl('http://api.test', 't1', 'm1')
    const m = buildHeartbeatMessage('a@x.test', 'Ann', rendered, url)
    expect(m.headers).toEqual({
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
    expect(m.text).toContain(url)
    expect(m.html).toContain(`href="${url.replaceAll('&', '&amp;')}"`)
  })

  it('omits the headers when no unsubscribe URL is supplied', () => {
    expect('headers' in buildHeartbeatMessage('a@x.test', 'Ann', rendered)).toBe(false)
  })
})
