import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerKeelRoutes, keelAgentEnabled } from '../routes.js'
import { createFakeDb } from './fake-db.js'

const members = (id: string) => [
  { id: `${id}-org`, user_id: `${id}-org`, role: 'organizer', status: 'active' },
  { id: `${id}-adult`, user_id: `${id}-adult`, role: 'adult', status: 'active' },
]

function build() {
  const fake = createFakeDb({
    family_groups: [
      { tenant_id: 'A', members: members('A') },
      { tenant_id: 'B', members: members('B') },
    ],
  })
  const askAssistant = vi.fn(async () => ({
    content: 'Your emergency fund covers 4 months.',
    isLive: true,
    data_as_of: '2026-10-28T10:00:00.000Z',
  }))
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    const tenant = String(req.headers['x-tenant'] ?? 'A')
    const user = String(req.headers['x-user'] ?? `${tenant}-org`)
    req.authContext = { tenant_id: tenant, user_id: user, roles: ['owner'] }
  })
  registerKeelRoutes(app, fake.db, { askAssistant })
  return { app, fake, askAssistant }
}

const as = (tenant: string, user: string) => ({ 'x-tenant': tenant, 'x-user': user })
const turn = (app: ReturnType<typeof build>['app'], message: string, headers = {}, extra = {}) =>
  app.inject({ method: 'POST', url: '/keel/turns', headers, payload: { message, ...extra } })

afterEach(() => {
  delete process.env['KEEL_AGENT_ENABLED']
})

describe('GET /keel/setup-state', () => {
  it("returns the caller's own household state with no-store headers", async () => {
    const { app } = build()
    const res = await app.inject({
      method: 'GET',
      url: '/keel/setup-state',
      headers: as('A', 'A-org'),
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.json()).toMatchObject({ role: 'organizer', bootstrap: false, catalog_version: 1 })
  })

  it('ignores tenant or user ids in the query string', async () => {
    const { app, fake } = build()
    await app.inject({
      method: 'GET',
      url: '/keel/setup-state?tenant_id=B&user_id=B-org',
      headers: as('A', 'A-org'),
    })
    const scoped = fake.calls.filter((c) => c.collection !== 'tenant_keys')
    expect(scoped.length).toBeGreaterThan(0)
    expect(scoped.every((c) => c.filter['tenant_id'] === 'A')).toBe(true)
  })
})

describe('POST /keel/turns', () => {
  it('JSON mode returns the events and a thread id, and stores the exchange encrypted', async () => {
    const { app, fake } = build()
    const res = await turn(app, 'Where do I start?', as('A', 'A-org'))
    expect(res.statusCode).toBe(200)
    const body = res.json() as { events: Array<{ type: string }>; thread_id: string }
    expect(body.thread_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.events.at(-1)).toMatchObject({
      type: 'done',
      route: 'setup',
      thread_id: body.thread_id,
    })
    const stored = fake.data['keel_messages']!
    expect(stored).toHaveLength(2)
    for (const m of stored) {
      expect(String(m['content_enc'])).toMatch(/^dek:/)
      expect(JSON.stringify(m)).not.toContain('Where do I start')
    }
  })

  it('streams server-sent events and ends with done carrying the thread id', async () => {
    const { app } = build()
    const res = await app.inject({
      method: 'POST',
      url: '/keel/turns',
      headers: { ...as('A', 'A-org'), accept: 'text/event-stream' },
      payload: { message: 'Where do I start?' },
    })
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.headers['cache-control']).toBe('private, no-store')
    const events = res.body
      .split('\n\n')
      .filter((b) => b.startsWith('event: keel'))
      .map((b) => JSON.parse(b.split('data: ')[1]!) as { type: string; thread_id?: string })
    expect(events.map((e) => e.type)).toEqual([
      'status',
      'card',
      'card',
      'text',
      'provenance',
      'done',
    ])
    expect(events.at(-1)!.thread_id).toBeTruthy()
  })

  it('rejects malformed input and drops unknown fields instead of echoing them', async () => {
    const { app, askAssistant } = build()
    expect((await turn(app, '', as('A', 'A-org'))).statusCode).toBe(400)
    expect((await turn(app, 'x'.repeat(2001), as('A', 'A-org'))).statusCode).toBe(400)
    expect(
      (await turn(app, 'hi', as('A', 'A-org'), { page_context: { route: 'https://evil.test/x' } }))
        .statusCode,
    ).toBe(400)
    expect(
      (await turn(app, 'hi', as('A', 'A-org'), { page_context: { anchors: ['ok', 'Not Valid!'] } }))
        .statusCode,
    ).toBe(400)
    expect((await turn(app, 'hi', as('A', 'A-org'), { thread_id: 'not-a-uuid' })).statusCode).toBe(
      400,
    )
    const res = await turn(app, 'What does my emergency fund cover?', as('A', 'A-org'), {
      tenant_id: 'B',
      user_id: 'B-org',
    })
    expect(res.statusCode).toBe(200)
    expect(askAssistant).toHaveBeenCalledOnce()
  })

  it('does not store sensitive exchanges', async () => {
    const { app, fake } = build()
    const res = await turn(app, 'I have chest pain, where do I start?', as('A', 'A-org'))
    expect(res.json().thread_id).toBeUndefined()
    expect(fake.data['keel_messages'] ?? []).toHaveLength(0)
  })

  it('answers even when saving history fails', async () => {
    const { app, fake } = build()
    const original = fake.data
    void original
    const failing = createFakeDb(
      { family_groups: [{ tenant_id: 'A', members: members('A') }] },
      { failing: ['keel_threads'] },
    )
    const app2 = Fastify()
    app2.addHook('onRequest', async (req) => {
      req.authContext = { tenant_id: 'A', user_id: 'A-org', roles: ['owner'] }
    })
    registerKeelRoutes(app2, failing.db, {
      askAssistant: async () => ({ content: 'ok', isLive: true }),
    })
    const res = await turn(app2, 'What does my emergency fund cover?')
    expect(res.statusCode).toBe(200)
    expect(res.json().events.some((e: { type: string }) => e.type === 'text')).toBe(true)
    void app
  })

  it('the kill switch turns every /keel route into 404', async () => {
    process.env['KEEL_AGENT_ENABLED'] = 'false'
    expect(keelAgentEnabled()).toBe(false)
    const { app } = build()
    expect((await app.inject({ method: 'GET', url: '/keel/setup-state' })).statusCode).toBe(404)
    expect((await turn(app, 'hi')).statusCode).toBe(404)
  })
})

describe('conversation isolation', () => {
  async function seedThread(app: ReturnType<typeof build>['app'], tenant: string, user: string) {
    const res = await turn(app, 'Where do I start?', as(tenant, user))
    return res.json().thread_id as string
  }

  it('the owner can list, read and delete their own thread', async () => {
    const { app } = build()
    const id = await seedThread(app, 'A', 'A-org')
    const list = await app.inject({
      method: 'GET',
      url: '/keel/threads',
      headers: as('A', 'A-org'),
    })
    expect(list.json().threads).toEqual([
      expect.objectContaining({ id, title: 'Where do I start?' }),
    ])
    const one = await app.inject({
      method: 'GET',
      url: `/keel/threads/${id}`,
      headers: as('A', 'A-org'),
    })
    expect(one.statusCode).toBe(200)
    expect(one.json().messages.map((m: { author: string }) => m.author)).toEqual(['user', 'keel'])
    expect(one.json().messages[0].content).toBe('Where do I start?')
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/keel/threads/${id}`,
          headers: as('A', 'A-org'),
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ method: 'GET', url: `/keel/threads/${id}`, headers: as('A', 'A-org') }))
        .statusCode,
    ).toBe(404)
  })

  it('another adult in the same household gets a uniform 404 and an empty list', async () => {
    const { app } = build()
    const id = await seedThread(app, 'A', 'A-org')
    const read = await app.inject({
      method: 'GET',
      url: `/keel/threads/${id}`,
      headers: as('A', 'A-adult'),
    })
    expect(read.statusCode).toBe(404)
    expect(read.json()).toEqual({ error: 'Not found' })
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/keel/threads/${id}`,
          headers: as('A', 'A-adult'),
        })
      ).statusCode,
    ).toBe(404)
    const list = await app.inject({
      method: 'GET',
      url: '/keel/threads',
      headers: as('A', 'A-adult'),
    })
    expect(list.json().threads).toEqual([])
    // The organizer's thread is untouched.
    expect(
      (await app.inject({ method: 'GET', url: `/keel/threads/${id}`, headers: as('A', 'A-org') }))
        .statusCode,
    ).toBe(200)
  })

  it('a different household cannot read, delete or continue the thread', async () => {
    const { app, fake } = build()
    const id = await seedThread(app, 'A', 'A-org')
    expect(
      (await app.inject({ method: 'GET', url: `/keel/threads/${id}`, headers: as('B', 'B-org') }))
        .statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/keel/threads/${id}`,
          headers: as('B', 'B-org'),
        })
      ).statusCode,
    ).toBe(404)
    const cont = await turn(app, 'Where do I start?', as('B', 'B-org'), { thread_id: id })
    expect(cont.json().thread_id).not.toBe(id)
    expect(fake.data['keel_messages']!.filter((m) => m['thread_id'] === id)).toHaveLength(2)
  })

  it("delete-all removes only the caller's history", async () => {
    const { app } = build()
    await seedThread(app, 'A', 'A-org')
    await seedThread(app, 'A', 'A-adult')
    await app.inject({ method: 'DELETE', url: '/keel/threads', headers: as('A', 'A-org') })
    expect(
      (await app.inject({ method: 'GET', url: '/keel/threads', headers: as('A', 'A-org') })).json()
        .threads,
    ).toEqual([])
    expect(
      (
        await app.inject({ method: 'GET', url: '/keel/threads', headers: as('A', 'A-adult') })
      ).json().threads,
    ).toHaveLength(1)
  })

  it('expired threads are not readable even before the database cleanup runs', async () => {
    const { app, fake } = build()
    const id = await seedThread(app, 'A', 'A-org')
    fake.data['keel_threads']![0]!['expires_at'] = new Date(Date.now() - 1000)
    expect(
      (await app.inject({ method: 'GET', url: `/keel/threads/${id}`, headers: as('A', 'A-org') }))
        .statusCode,
    ).toBe(404)
    expect(
      (await app.inject({ method: 'GET', url: '/keel/threads', headers: as('A', 'A-org') })).json()
        .threads,
    ).toEqual([])
  })

  it('retention is 30 days from activity', async () => {
    const { app, fake } = build()
    await seedThread(app, 'A', 'A-org')
    const days =
      ((fake.data['keel_threads']![0]!['expires_at'] as Date).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThanOrEqual(30)
  })
})

describe('proposal routes', () => {
  it('apply and dismiss work for the owner; another household gets 404 and nothing is written', async () => {
    const { app, fake } = build()
    const res = await turn(app, 'Recommended settings for my family?', as('A', 'A-org'))
    const proposal = (
      res.json().events as Array<{ type: string; card?: { kind: string; proposal_id: string } }>
    ).find((e) => e.type === 'card' && e.card?.kind === 'proposal')!.card!
    const url = `/keel/proposals/${proposal.proposal_id}/confirm`
    expect((await app.inject({ method: 'POST', url, headers: as('B', 'B-org') })).statusCode).toBe(
      404,
    )
    expect(
      (await app.inject({ method: 'POST', url, headers: as('A', 'A-adult') })).statusCode,
    ).toBe(404)
    expect(fake.data['delivery_preferences'] ?? []).toHaveLength(0)
    expect((await app.inject({ method: 'POST', url, headers: as('A', 'A-org') })).statusCode).toBe(
      200,
    )
    expect(fake.data['delivery_preferences']![0]).toMatchObject({ digest_mode: true })
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/keel/proposals/nope/confirm',
          headers: as('A', 'A-org'),
        })
      ).statusCode,
    ).toBe(404)
  })
})
