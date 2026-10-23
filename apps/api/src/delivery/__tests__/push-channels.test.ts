/**
 * PRD-140: push payloads carry no financial content, a dead device is removed
 * and recorded, email is the floor for a failed push, the FCM sender signs and
 * caches its own token, and channel state reports counts only.
 */
import crypto from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  MobilePushChannel,
  PermanentPushFailure,
  WebPushChannel,
  type InsightNotification,
} from '../channels.js'
import { buildAlertPushPayload, buildDigestPushPayload } from '../push-payload.js'
import { DeliveryRouter } from '../delivery-router.js'
import {
  CompositeMobilePushSender,
  FcmMobilePushSender,
  parseServiceAccount,
} from '../fcm-sender.js'
import { getChannelState } from '../channel-state.js'
import { registerFamilyChannelRoutes } from '../../routes/family-channels.js'
import { renderHeartbeat } from '../../feed/render-heartbeat.js'
import { renderQuietCareDigest } from '../../feed/render-quiet-care.js'

const T = 't1'

const loud: InsightNotification = {
  insight_id: 'ins-secret-1',
  tenant_id: T,
  hypothesis: 'Life Cover Gap With Aviva',
  urgency: 'high',
  or_score: 0.91,
  estimated_impact_low: 1_250_000,
  estimated_impact_high: 2_400_000,
  currency: 'GBP',
  reasoning: 'Your life cover of £150,000 is below your mortgage of £300,000.',
  recommended_actions: ['Speak to a licensed adviser about Aviva'],
  action_url: 'https://app.example.test/insights/ins-secret-1?src=alert&i=ins-secret-1',
  approve_url: 'https://api.example.test/a/APPROVE-TOKEN',
  dismiss_url: 'https://api.example.test/a/DISMISS-TOKEN',
  why_url: 'https://api.example.test/why/WHY-TOKEN',
}

const FORBIDDEN =
  /Aviva|£|\d{2,}%|150,000|300,000|1[,.]?250|APPROVE|DISMISS|WHY-TOKEN|Life Cover|mortgage|confidence/i

describe('push payloads carry no financial content', () => {
  it('the alert payload is generic and links only to the deep link', () => {
    const p = buildAlertPushPayload(loud)
    expect(p).toEqual({
      title: 'LifeKeel',
      body: 'You have a new update in LifeKeel.',
      url: loud.action_url,
    })
    expect(`${p.title} ${p.body}`).not.toMatch(FORBIDDEN)
    expect(buildAlertPushPayload({ ...loud, urgency: 'critical' }).body).toBe(
      'An important update needs your attention.',
    )
  })

  it('what the web and mobile channels actually hand to the sender is generic', async () => {
    const web = vi.fn(async (_sub: unknown, _payload: string) => {})
    await new WebPushChannel({ send: web }).send(
      { endpoint: 'https://e', keys: { p256dh: 'a', auth: 'b' } },
      loud,
    )
    const webBody = web.mock.calls[0]![1] as string
    expect(JSON.parse(webBody)).toEqual({
      title: 'LifeKeel',
      body: 'You have a new update in LifeKeel.',
      url: loud.action_url,
    })
    expect(webBody).not.toMatch(FORBIDDEN)

    const mobile = vi.fn(async (_token: string, _payload: unknown) => ({}))
    await new MobilePushChannel({ send: mobile }).send('token-12345678', loud)
    const sent = JSON.stringify(mobile.mock.calls[0]![1])
    expect(sent).not.toMatch(FORBIDDEN)
    expect(sent).toContain(loud.action_url)
  })

  it('digest and heartbeat push-shaped payloads are generic too', () => {
    for (const kind of [
      'quiet_care_digest',
      'quiet_care_digest_missed',
      'weekly_heartbeat',
    ] as const) {
      const p = buildDigestPushPayload(kind, 'https://app.example.test')
      expect(`${p.title} ${p.body}`).not.toMatch(/\d|£|score|aviva/i)
    }
    const hb = renderHeartbeat({
      period: 'week',
      window_start: new Date(),
      score_delta: 4,
      moved_events: 1,
      open_insights: 2,
      new_insights: 1,
      resolved_insights: 0,
      renewals: [{ type: 'life', renewal_date: '2026-12-02' }],
      pending_steps: 3,
      profile_stale: false,
      review_due: false,
      app_url: 'https://app.example.test',
    })
    expect(`${hb.push_title} ${hb.push_body}`).not.toMatch(/\d|score|life cover|policy/i)
    const qc = renderQuietCareDigest({
      period_label: 'September 2026',
      range_label: '1–30 September',
      check: { status: 'ran', last_check: new Date() },
      score: 62,
      score_delta: 3,
      moved_events: 1,
      new_insights: 1,
      resolved_insights: 0,
      renewals: [{ type: 'life', renewal_date: '2026-12-02' }],
      worth_a_look: { text: 'Cover looks low', href: 'https://x' },
      paused: [],
      next_check: new Date(),
      app_url: 'https://app.example.test',
    })
    expect(`${qc.push_title} ${qc.push_body}`).not.toMatch(/\d|score|life cover|policy|\bcover\b/i)
  })
})

describe('FCM sender', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const account = JSON.stringify({
    project_id: 'proj-1',
    client_email: 'svc@proj-1.iam.gserviceaccount.com',
    private_key: privateKey,
  })
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const mk = (
    send: (url: string, init: RequestInit) => Response,
    clock = { t: 1_800_000_000_000 },
  ) => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return send(url, init)
    }) as unknown as typeof fetch
    return {
      calls,
      clock,
      sender: new FcmMobilePushSender(parseServiceAccount(account), fetchImpl, () => clock.t),
    }
  }
  const ok = (url: string) =>
    url.includes('oauth2')
      ? json(200, { access_token: 'ACCESS', expires_in: 3600 })
      : json(200, { name: 'projects/proj-1/messages/abc' })

  it('is not configured without a service account, and parse rejects junk', async () => {
    expect(new FcmMobilePushSender(null).isConfigured()).toBe(false)
    await expect(
      new FcmMobilePushSender(null).send('t', { title: 'a', body: 'b' }),
    ).rejects.toThrow(/not configured/)
    expect(parseServiceAccount(undefined)).toBeNull()
    expect(parseServiceAccount('not json')).toBeNull()
    expect(parseServiceAccount('{"project_id":"x"}')).toBeNull()
  })

  it('signs a valid RS256 JWT and sends a generic notification with stringified data', async () => {
    const { calls, sender } = mk(ok)
    const r = await sender.send('device-token-1', {
      title: 'LifeKeel',
      body: 'You have a new update in LifeKeel.',
      data: { url: 'https://app/x' },
    })
    expect(r).toEqual({ id: 'projects/proj-1/messages/abc' })

    const assertion = new URLSearchParams(String(calls[0]!.init.body)).get('assertion')!
    const [h, c, sig] = assertion.split('.') as [string, string, string]
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    expect(claims).toMatchObject({
      iss: 'svc@proj-1.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    })
    expect(claims.exp - claims.iat).toBe(3600)
    expect(
      crypto
        .createVerify('RSA-SHA256')
        .update(`${h}.${c}`)
        .verify(publicKey, Buffer.from(sig, 'base64url')),
    ).toBe(true)

    expect(calls[1]!.url).toBe('https://fcm.googleapis.com/v1/projects/proj-1/messages:send')
    expect((calls[1]!.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer ACCESS',
    )
    expect(JSON.parse(String(calls[1]!.init.body)).message).toMatchObject({
      token: 'device-token-1',
      notification: { title: 'LifeKeel', body: 'You have a new update in LifeKeel.' },
      data: { url: 'https://app/x' },
    })
  })

  it('caches the access token, then refreshes it shortly before expiry', async () => {
    const { calls, sender, clock } = mk(ok)
    await sender.send('t', { title: 'a', body: 'b' })
    await sender.send('t', { title: 'a', body: 'b' })
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1)
    clock.t += 3_600_000 - 30_000 // inside the 60s refresh margin
    await sender.send('t', { title: 'a', body: 'b' })
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2)
  })

  it('an unregistered token is a permanent failure; other errors are not', async () => {
    const gone = mk((url) =>
      url.includes('oauth2')
        ? ok(url)
        : json(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }),
    )
    await expect(gone.sender.send('t', { title: 'a', body: 'b' })).rejects.toBeInstanceOf(
      PermanentPushFailure,
    )
    const flaky = mk((url) =>
      url.includes('oauth2') ? ok(url) : json(503, { error: { status: 'UNAVAILABLE' } }),
    )
    const err = await flaky.sender.send('t', { title: 'a', body: 'b' }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PermanentPushFailure)
    const noAuth = mk(() => json(401, {}))
    await expect(noAuth.sender.send('t', { title: 'a', body: 'b' })).rejects.toThrow(
      /FCM auth returned 401/,
    )
  })

  it('the composite sends Expo tokens to Expo and everything else to FCM, or refuses when FCM is off', async () => {
    const expo = { send: vi.fn(async () => ({ id: 'e' })) }
    const fcm = { isConfigured: () => true, send: vi.fn(async () => ({ id: 'f' })) }
    const both = new CompositeMobilePushSender(expo, fcm as never)
    expect(await both.send('ExponentPushToken[abc]', { title: 'a', body: 'b' })).toEqual({
      id: 'e',
    })
    expect(await both.send('fcm-token-xyz', { title: 'a', body: 'b' })).toEqual({ id: 'f' })
    const off = new CompositeMobilePushSender(expo, {
      isConfigured: () => false,
      send: vi.fn(),
    } as never)
    await expect(off.send('fcm-token-xyz', { title: 'a', body: 'b' })).rejects.toThrow(
      /FCM not configured/,
    )
  })
})

describe('router: dead devices and the email floor (real MongoDB)', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('push-test')
  })
  beforeEach(async () => {
    for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  })
  afterAll(async () => {
    await client.close()
    await mongod.stop()
  })

  const ok = { channel: 'email', success: true, delivered_at: new Date() }
  const insight = (id: string) => ({
    id,
    urgency: 'medium',
    hypothesis: 'x',
    created_at: new Date(),
    confidence_breakdown: {},
  })

  async function setup(opts: {
    channels?: string[]
    email?: string | null
    subs?: string[]
    tokens?: string[]
    web?: (sub: { endpoint: string }) => Record<string, unknown>
    mobile?: (token: string) => Record<string, unknown>
  }) {
    await db.collection('delivery_preferences').insertOne({
      tenant_id: T,
      enabled: true,
      min_urgency: 'low',
      channels: opts.channels ?? ['web_push'],
      ...(opts.email === null ? {} : { email_to: opts.email ?? 'a@x.test' }),
      web_push_enabled: (opts.subs?.length ?? 0) > 0,
      mobile_push_enabled: (opts.tokens?.length ?? 0) > 0,
    })
    for (const endpoint of opts.subs ?? []) {
      await db
        .collection('web_push_subscriptions')
        .insertOne({ tenant_id: T, endpoint, keys: { p256dh: 'a', auth: 'b' } })
    }
    for (const token of opts.tokens ?? [])
      await db.collection('mobile_push_tokens').insertOne({ tenant_id: T, token })
    const router = new DeliveryRouter(db as never)
    const emails: string[] = []
    const r = router as unknown as Record<string, unknown>
    r['email'] = { send: async () => (emails.push('email'), ok) }
    r['webPush'] = {
      send: async (sub: { endpoint: string }) =>
        opts.web?.(sub) ?? { channel: 'web_push', success: true, delivered_at: new Date() },
    }
    r['mobilePush'] = {
      send: async (token: string) =>
        opts.mobile?.(token) ?? { channel: 'mobile_push', success: true, delivered_at: new Date() },
    }
    return { router, emails }
  }
  const gone = (channel: string) => ({
    channel,
    success: false,
    error: 'gone',
    permanent: true,
    delivered_at: new Date(),
  })
  const flaky = (channel: string) => ({
    channel,
    success: false,
    error: 'timeout',
    delivered_at: new Date(),
  })
  const prefs = () => db.collection('delivery_preferences').findOne({ tenant_id: T })

  it('an expired web subscription is removed, recorded, the channel switched off, and the alert goes to email', async () => {
    const { router, emails } = await setup({ subs: ['https://dead'], web: () => gone('web_push') })
    const r = await router.deliver(insight('i1'), T)
    expect(r).toMatchObject({ channel: 'email', success: true })
    expect(emails).toHaveLength(1)
    expect(await db.collection('web_push_subscriptions').countDocuments()).toBe(0)
    expect((await prefs())?.['web_push_enabled']).toBe(false)
    expect((await prefs())?.['channels']).not.toContain('web_push')
    expect(
      await db
        .collection('push_failures')
        .find({}, { projection: { _id: 0, at: 0 } })
        .toArray(),
    ).toEqual([{ tenant_id: T, channel: 'web_push', reason: 'device_gone' }])
    expect(
      (await db.collection('notification_ledger').findOne({ key: 'i1' }))?.['fallback_from'],
    ).toBe('push')
  })

  it('a transient push failure keeps the device and still falls back to email', async () => {
    const { router, emails } = await setup({ subs: ['https://slow'], web: () => flaky('web_push') })
    expect((await router.deliver(insight('i1'), T))?.channel).toBe('email')
    expect(emails).toHaveLength(1)
    expect(await db.collection('web_push_subscriptions').countDocuments()).toBe(1)
    expect(await db.collection('push_failures').countDocuments()).toBe(0)
  })

  it('a permanently rejected mobile token is removed the same way', async () => {
    const { router } = await setup({
      channels: ['mobile_push'],
      tokens: ['dead-token-12345'],
      mobile: () => gone('mobile_push'),
    })
    expect((await router.deliver(insight('i1'), T))?.channel).toBe('email')
    expect(await db.collection('mobile_push_tokens').countDocuments()).toBe(0)
    expect((await prefs())?.['mobile_push_enabled']).toBe(false)
  })

  it('one dead device and one live one: the live one delivers, the dead one is removed, no email', async () => {
    const { router, emails } = await setup({
      subs: ['https://dead', 'https://live'],
      web: (s) =>
        s.endpoint === 'https://dead'
          ? gone('web_push')
          : { channel: 'web_push', success: true, delivered_at: new Date() },
    })
    expect((await router.deliver(insight('i1'), T))?.channel).toBe('web_push')
    expect(emails).toHaveLength(0)
    expect(
      (await db.collection('web_push_subscriptions').find({}).toArray()).map((s) => s['endpoint']),
    ).toEqual(['https://live'])
    expect((await prefs())?.['web_push_enabled']).toBe(true)
  })

  it('does not send a second email when email was already one of the channels, or when there is no address', async () => {
    const withEmail = await setup({
      channels: ['web_push', 'email'],
      subs: ['https://dead'],
      web: () => gone('web_push'),
    })
    await withEmail.router.deliver(insight('i1'), T)
    expect(withEmail.emails).toHaveLength(1) // once, via the normal channel order

    await db.collection('delivery_preferences').deleteMany({})
    await db.collection('web_push_subscriptions').deleteMany({})
    await db.collection('notification_ledger').deleteMany({})
    const noEmail = await setup({
      email: null,
      subs: ['https://dead'],
      web: () => gone('web_push'),
    })
    const r = await noEmail.router.deliver(insight('i2'), T)
    expect(r?.success).toBe(false)
    expect(noEmail.emails).toHaveLength(0)
  })

  it('stores the device platform when a token is registered', async () => {
    const router = new DeliveryRouter(db as never)
    await router.saveMobilePushToken(T, 'token-abcdef-1', 'ios')
    await router.saveMobilePushToken(T, 'token-abcdef-2')
    const rows = await db.collection('mobile_push_tokens').find({}).sort({ token: 1 }).toArray()
    expect(rows.map((r) => r['platform'])).toEqual(['ios', undefined])
  })

  it('reports channel state as counts only, and GET /family/channels is adult-only', async () => {
    await setup({
      channels: ['mobile_push', 'email'],
      subs: ['https://a', 'https://b'],
      tokens: ['tok-aaaaaaaa1'],
    })
    await db
      .collection('mobile_push_tokens')
      .updateOne({ token: 'tok-aaaaaaaa1' }, { $set: { platform: 'android' } })
    await db
      .collection('push_failures')
      .insertOne({ tenant_id: T, channel: 'web_push', reason: 'device_gone', at: new Date() })
    await db.collection('family_groups').insertOne({
      tenant_id: T,
      members: [
        {
          id: 'm1',
          user_id: 'u1',
          name: 'A',
          email: 'a@x.test',
          role: 'organizer',
          status: 'active',
        },
      ],
    })
    const state = await getChannelState(db, T)
    expect(state).toMatchObject({
      email: { available: true },
      web_push: { devices: 2, enabled: true },
      mobile_push: { devices: 1, enabled: true, platforms: ['android'] },
      recent_failures: { web_push: 1, mobile_push: 0 },
      first_channel: 'mobile_push',
    })
    expect(JSON.stringify(state)).not.toMatch(/https:\/\/a|tok-aaaa|a@x\.test/)

    const appFor = async (userId: string) => {
      const app = Fastify()
      app.addHook('onRequest', async (req) => {
        ;(req as unknown as { authContext: unknown }).authContext = {
          tenant_id: T,
          user_id: userId,
        }
      })
      registerFamilyChannelRoutes(app, db)
      await app.ready()
      return app
    }
    expect(
      (await (await appFor('u1')).inject({ method: 'GET', url: '/family/channels' })).statusCode,
    ).toBe(200)
    expect(
      (await (await appFor('stranger')).inject({ method: 'GET', url: '/family/channels' }))
        .statusCode,
    ).toBe(403)
  })

  it('first channel is email when there is no device, and none when there is nothing at all', async () => {
    await db.collection('delivery_preferences').insertOne({ tenant_id: T, email_to: 'a@x.test' })
    expect((await getChannelState(db, T)).first_channel).toBe('email')
    await db.collection('delivery_preferences').deleteMany({})
    expect((await getChannelState(db, T)).first_channel).toBe('none')
  })

  it('email is available without a delivery_preferences row — resolved from the roster organizer', async () => {
    // The common case: nothing in signup writes email_to, but the account
    // clearly has an email — the "no email on file" state was a bug, not a
    // missing preference.
    await db.collection('family_groups').insertOne({
      tenant_id: T,
      members: [
        {
          id: 'm1',
          name: 'Org',
          email: 'organizer@x.test',
          role: 'organizer',
          status: 'active',
        },
      ],
    })
    const state = await getChannelState(db, T)
    expect(state.email.available).toBe(true)
    expect(state.first_channel).toBe('email')
    expect(JSON.stringify(state)).not.toMatch(/organizer@x\.test/)
  })

  it('falls back to the account user record when no family doc exists yet', async () => {
    await db.collection('users').insertOne({ tenant_id: T, email: 'acct@x.test' })
    expect((await getChannelState(db, T)).email.available).toBe(true)
  })

  it('a pending child member does not satisfy the email floor', async () => {
    await db.collection('family_groups').insertOne({
      tenant_id: T,
      members: [{ id: 'm1', name: 'Kid', email: 'kid@x.test', role: 'child', status: 'pending' }],
    })
    const state = await getChannelState(db, T)
    expect(state.email.available).toBe(false)
    expect(state.first_channel).toBe('none')
  })

  it('deliver() reaches the email floor for a tenant that never touched notification settings', async () => {
    await db.collection('family_groups').insertOne({
      tenant_id: T,
      members: [
        {
          id: 'm1',
          name: 'Org',
          email: 'organizer@x.test',
          role: 'organizer',
          status: 'active',
        },
      ],
    })
    const router = new DeliveryRouter(db as never)
    const emails: string[] = []
    const r = router as unknown as Record<string, unknown>
    r['email'] = { send: async () => (emails.push('email'), ok) }
    const result = await router.deliver(insight('i-floor'), T)
    expect(result?.channel).toBe('email')
    expect(emails).toHaveLength(1)
  })

  it('deliver() still returns early without prefs when no email can be resolved at all', async () => {
    const router = new DeliveryRouter(db as never)
    expect(await router.deliver(insight('i-nope'), T)).toBeNull()
  })
})
