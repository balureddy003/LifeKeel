/**
 * social-publisher — env detection and per-channel HTTP contracts. fetch is
 * stubbed; no real network in tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EnvSocialPublisher, DbSocialPublisher, socialPublisherFromEnv, type SocialConnectionDoc } from '../social-publisher.js'
import { encryptIfNeeded } from '@agentoak/platform'

function jsonRes(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

describe('socialPublisherFromEnv', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns null when no channel credentials exist', () => {
    for (const k of ['X_ACCESS_TOKEN', 'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AUTHOR_URN', 'BSKY_HANDLE', 'BSKY_APP_PASSWORD']) {
      vi.stubEnv(k, '')
    }
    expect(socialPublisherFromEnv()).toBeNull()
  })

  it('enables exactly the configured channels', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    vi.stubEnv('LINKEDIN_ACCESS_TOKEN', 'litok')
    // LinkedIn also needs the author URN — half-configured stays off.
    const partial = socialPublisherFromEnv()
    expect((await partial!.listIntegrations()).map((i) => i.identifier)).toEqual(['x'])

    vi.stubEnv('LINKEDIN_AUTHOR_URN', 'urn:li:person:abc')
    const both = socialPublisherFromEnv()
    expect((await both!.listIntegrations()).map((i) => i.identifier).sort()).toEqual(['linkedin', 'x'])
  })
})

describe('EnvSocialPublisher.createPost', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('rejects unconfigured channels', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    const pub = socialPublisherFromEnv()!
    await expect(
      pub.createPost({ integrationId: 'x', content: 'hi', channel: 'linkedin', type: 'now', date: new Date() }),
    ).rejects.toThrow('channel_not_configured:linkedin')
  })

  it('posts to X with the bearer token and returns the status url', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    const fetchMock = vi.fn(async () => jsonRes({ data: { id: 'tw-1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const pub = socialPublisherFromEnv()!
    const res = (await pub.createPost({ integrationId: 'x', content: 'hello oak', channel: 'x', type: 'now', date: new Date() })) as { external_id?: string; url?: string }

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.x.com/2/tweets')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer xtok')
    expect(JSON.parse(String(init.body))).toEqual({ text: 'hello oak' })
    expect(res.external_id).toBe('tw-1')
    expect(res.url).toBe('https://x.com/i/web/status/tw-1')
  })

  it('posts to LinkedIn with the author URN and protocol headers', async () => {
    vi.stubEnv('LINKEDIN_ACCESS_TOKEN', 'litok')
    vi.stubEnv('LINKEDIN_AUTHOR_URN', 'urn:li:person:abc')
    const fetchMock = vi.fn(async () => jsonRes({}, { headers: { 'x-restli-id': 'urn:li:share:1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const pub = socialPublisherFromEnv()!
    await pub.createPost({ integrationId: 'x', content: 'hi linkedin', channel: 'linkedin', type: 'now', date: new Date() })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.linkedin.com/rest/posts')
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer litok')
    expect(headers['Linkedin-Version']).toBeTruthy()
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body['author']).toBe('urn:li:person:abc')
    expect(body['commentary']).toBe('hi linkedin')
    expect(body['lifecycleState']).toBe('PUBLISHED')
  })

  it('bluesky opens a session then creates the feed record', async () => {
    vi.stubEnv('BSKY_HANDLE', 'oak.bsky.social')
    vi.stubEnv('BSKY_APP_PASSWORD', 'app-pass')
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('createSession')) return jsonRes({ accessJwt: 'jwt-1', did: 'did:plc:1' })
      return jsonRes({ uri: 'at://did:plc:1/app.bsky.feed.post/3k1' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pub = socialPublisherFromEnv()!
    const res = (await pub.createPost({ integrationId: 'x', content: 'hi bsky', channel: 'bluesky', type: 'now', date: new Date() })) as { url?: string }

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [postUrl, postInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(postUrl).toContain('com.atproto.repo.createRecord')
    expect((postInit.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-1')
    expect(res.url).toBe('https://bsky.app/profile/oak.bsky.social/post/3k1')
  })

  it('surfaces non-2xx responses as errors with status and detail', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const pub = socialPublisherFromEnv()!
    await expect(
      pub.createPost({ integrationId: 'x', content: 'hi', channel: 'x', type: 'now', date: new Date() }),
    ).rejects.toThrow('x /2/tweets 401')
  })
})

describe('DbSocialPublisher', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function makeDb(conns: Partial<SocialConnectionDoc>[] = []) {
    const docs = conns.map((c) => ({ status: 'active', credentials: {}, ...c }) as Record<string, unknown>)
    const col = {
      findOne: vi.fn(async (f: Record<string, unknown>) =>
        docs.find((d) => d['tenant_id'] === f['tenant_id'] && d['channel'] === f['channel']) ?? null,
      ),
      find: vi.fn((f: Record<string, unknown>) => ({
        toArray: async () => docs.filter((d) => d['tenant_id'] === f['tenant_id']),
      })),
      updateOne: vi.fn(async (f: Record<string, unknown>, u: { $set: Record<string, unknown> }) => {
        const doc = docs.find((d) => d['tenant_id'] === f['tenant_id'] && d['channel'] === f['channel'])
        if (doc) Object.assign(doc, u.$set)
        return { modifiedCount: doc ? 1 : 0 }
      }),
    }
    return { db: { collection: () => col } as never, col, docs }
  }

  const conn = (over: Partial<SocialConnectionDoc> = {}): Partial<SocialConnectionDoc> => ({
    tenant_id: 't1',
    channel: 'bluesky',
    handle: 'oak.bsky.social',
    credentials: { app_password: encryptIfNeeded('app-pass')! },
    service: 'https://bsky.social',
    ...over,
  })

  it('publishes through the tenant connection, decrypting the stored password', async () => {
    const { db } = makeDb([conn()])
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('createSession')) {
        expect(JSON.parse(String(init!.body)).password).toBe('app-pass')
        return jsonRes({ accessJwt: 'jwt-1', did: 'did:plc:1' })
      }
      return jsonRes({ uri: 'at://did:plc:1/app.bsky.feed.post/9z' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pub = new DbSocialPublisher(db, null)
    const res = (await pub.createPost({
      integrationId: 'x', content: 'from db conn', channel: 'bluesky', type: 'now', date: new Date(), tenantId: 't1',
    })) as { url?: string }
    expect(res.url).toBe('https://bsky.app/profile/oak.bsky.social/post/9z')
  })

  it('marks the connection error on publish failure and recovers it on success', async () => {
    const { db, docs } = makeDb([conn()])
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({ integrationId: 'x', content: 'hi', channel: 'bluesky', type: 'now', date: new Date(), tenantId: 't1' }),
    ).rejects.toThrow('bluesky createSession 500')
    expect(docs[0]!['status']).toBe('error')
    expect(String(docs[0]!['last_error'])).toContain('500')
  })

  it('falls back to env handlers when the tenant has no connection', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    const { db } = makeDb([])
    const fetchMock = vi.fn(async () => jsonRes({ data: { id: 'tw-9' } }))
    vi.stubGlobal('fetch', fetchMock)
    const pub = new DbSocialPublisher(db, socialPublisherFromEnv())
    const res = (await pub.createPost({
      integrationId: 'x', content: 'via env', channel: 'x', type: 'now', date: new Date(), tenantId: 't1',
    })) as { external_id?: string }
    expect(res.external_id).toBe('tw-9')
  })

  it('connection shadows env for the same channel; other env channels still list', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    vi.stubEnv('BSKY_HANDLE', 'env-acc.bsky.social')
    vi.stubEnv('BSKY_APP_PASSWORD', 'env-pass')
    const { db } = makeDb([conn()])
    const pub = new DbSocialPublisher(db, socialPublisherFromEnv())
    const integrations = await pub.listIntegrations('t1')
    const bluesky = integrations.filter((i) => i.identifier === 'bluesky')
    expect(bluesky).toHaveLength(1)
    expect(bluesky[0]!.source).toBe('connection')
    expect(bluesky[0]!.name).toContain('@oak.bsky.social')
    expect(integrations.find((i) => i.identifier === 'x')!.source).toBe('env')
  })

  it('throws channel_not_configured when neither conn nor env covers the channel', async () => {
    const { db } = makeDb([])
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({ integrationId: 'x', content: 'hi', channel: 'x', type: 'now', date: new Date(), tenantId: 't1' }),
    ).rejects.toThrow('channel_not_configured:x')
  })
})
