/**
 * social-publisher — env detection and per-channel HTTP contracts. fetch is
 * stubbed; no real network in tests.
 */
import { LINKEDIN_API_VERSION_DEFAULT } from '../linkedin-version.js'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  EnvSocialPublisher,
  DbSocialPublisher,
  socialPublisherFromEnv,
  tidRkey,
  type SocialConnectionDoc,
} from '../social-publisher.js'
import { encryptIfNeeded, decryptIfNeeded } from '@lifekeel/platform'

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
    for (const k of [
      'X_ACCESS_TOKEN',
      'LINKEDIN_ACCESS_TOKEN',
      'LINKEDIN_AUTHOR_URN',
      'BSKY_HANDLE',
      'BSKY_APP_PASSWORD',
    ]) {
      vi.stubEnv(k, '')
    }
    expect(socialPublisherFromEnv()).toBeNull()
  })

  it('enables exactly the configured channels', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    vi.stubEnv('LINKEDIN_ACCESS_TOKEN', 'litok')
    // LinkedIn also needs the author URN — half-configured stays off. The
    // manual integrations are always listed (need no credential).
    const partial = socialPublisherFromEnv()
    const nonManual = async (p: typeof partial) =>
      (await p!.listIntegrations()).filter((i) => i.source !== 'manual').map((i) => i.id)
    expect(await nonManual(partial)).toEqual(['x:env'])

    vi.stubEnv('LINKEDIN_AUTHOR_URN', 'urn:li:person:abc')
    const both = socialPublisherFromEnv()
    expect((await nonManual(both)).sort()).toEqual(['linkedin:env', 'x:env'])
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
      pub.createPost({
        integrationId: 'x',
        content: 'hi',
        channel: 'linkedin',
        type: 'now',
        date: new Date(),
      }),
    ).rejects.toThrow('channel_not_configured:linkedin')
  })

  it('posts to X with the bearer token and returns the status url', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    const fetchMock = vi.fn(async () => jsonRes({ data: { id: 'tw-1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const pub = socialPublisherFromEnv()!
    const res = (await pub.createPost({
      integrationId: 'x',
      content: 'hello keel',
      channel: 'x',
      type: 'now',
      date: new Date(),
    })) as { external_id?: string; url?: string }

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.x.com/2/tweets')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer xtok')
    expect(JSON.parse(String(init.body))).toEqual({ text: 'hello keel' })
    expect(res.external_id).toBe('tw-1')
    expect(res.url).toBe('https://x.com/i/web/status/tw-1')
  })

  it('serves x:manual as an intent URL without calling X or needing credentials', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    const fetchMock = vi.fn(async () => jsonRes({ data: { id: 'tw-1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const pub = socialPublisherFromEnv()!
    const res = (await pub.createPost({
      integrationId: 'x:manual',
      content: 'manual post & a link',
      channel: 'x',
      type: 'now',
      date: new Date(),
    })) as { manual?: { intent_url: string } }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.manual!.intent_url).toContain('https://twitter.com/intent/tweet?text=')
    expect(decodeURIComponent(res.manual!.intent_url.split('text=')[1]!)).toBe(
      'manual post & a link',
    )
  })

  it('posts to LinkedIn with the author URN and protocol headers', async () => {
    vi.stubEnv('LINKEDIN_ACCESS_TOKEN', 'litok')
    vi.stubEnv('LINKEDIN_AUTHOR_URN', 'urn:li:person:abc')
    const fetchMock = vi.fn(async () =>
      jsonRes({}, { headers: { 'x-restli-id': 'urn:li:share:1' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const pub = socialPublisherFromEnv()!
    await pub.createPost({
      integrationId: 'x',
      content: 'hi linkedin',
      channel: 'linkedin',
      type: 'now',
      date: new Date(),
    })

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

  it('sends the current LinkedIn API version by default, and LINKEDIN_API_VERSION when set', async () => {
    vi.stubEnv('LINKEDIN_ACCESS_TOKEN', 'litok')
    vi.stubEnv('LINKEDIN_AUTHOR_URN', 'urn:li:person:abc')
    const fetchMock = vi.fn(async () =>
      jsonRes({}, { headers: { 'x-restli-id': 'urn:li:share:1' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const post = () =>
      socialPublisherFromEnv()!.createPost({
        integrationId: 'x',
        content: 'v',
        channel: 'linkedin',
        type: 'now',
        date: new Date(),
      })
    await post()
    const version = (i: number) =>
      (
        (fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].headers as Record<
          string,
          string
        >
      )['Linkedin-Version']
    expect(version(0)).toBe(LINKEDIN_API_VERSION_DEFAULT)
    vi.stubEnv('LINKEDIN_API_VERSION', '202701')
    await post()
    expect(version(1)).toBe('202701')
    vi.stubEnv('LINKEDIN_API_VERSION', 'not-a-version')
    await post()
    expect(version(2)).toBe(LINKEDIN_API_VERSION_DEFAULT) // a malformed override is ignored, not sent
  })

  it('turns LinkedIn rejecting the API version into an error that says what to change', async () => {
    vi.stubEnv('LINKEDIN_ACCESS_TOKEN', 'litok')
    vi.stubEnv('LINKEDIN_AUTHOR_URN', 'urn:li:person:abc')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonRes(
          {
            status: 426,
            code: 'NONEXISTENT_VERSION',
            message: 'Requested version 20250101 is not active',
          },
          { status: 426 },
        ),
      ),
    )
    await expect(
      socialPublisherFromEnv()!.createPost({
        integrationId: 'x',
        content: 'v',
        channel: 'linkedin',
        type: 'now',
        date: new Date(),
      }),
    ).rejects.toThrow(/linkedin_api_version_expired.*LINKEDIN_API_VERSION/s)
  })

  it('leaves other LinkedIn failures alone, so a bad token is not blamed on the version', async () => {
    vi.stubEnv('LINKEDIN_ACCESS_TOKEN', 'litok')
    vi.stubEnv('LINKEDIN_AUTHOR_URN', 'urn:li:person:abc')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonRes({ message: 'Invalid access token' }, { status: 401 })),
    )
    const err = await socialPublisherFromEnv()!
      .createPost({
        integrationId: 'x',
        content: 'v',
        channel: 'linkedin',
        type: 'now',
        date: new Date(),
      })
      .catch((e: Error) => e)
    expect(String(err)).toMatch(/401/)
    expect(String(err)).not.toMatch(/api_version_expired/)
  })

  it('bluesky opens a session then creates the feed record', async () => {
    vi.stubEnv('BSKY_HANDLE', 'keel.bsky.social')
    vi.stubEnv('BSKY_APP_PASSWORD', 'app-pass')
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('createSession')) return jsonRes({ accessJwt: 'jwt-1', did: 'did:plc:1' })
      return jsonRes({ uri: 'at://did:plc:1/app.bsky.feed.post/3k1' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pub = socialPublisherFromEnv()!
    const res = (await pub.createPost({
      integrationId: 'x',
      content: 'hi bsky',
      channel: 'bluesky',
      type: 'now',
      date: new Date(),
    })) as { url?: string }

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [postUrl, postInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(postUrl).toContain('com.atproto.repo.createRecord')
    expect((postInit.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-1')
    expect(res.url).toBe('https://bsky.app/profile/keel.bsky.social/post/3k1')
  })

  it('surfaces non-2xx responses as errors with status and detail', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    const pub = socialPublisherFromEnv()!
    await expect(
      pub.createPost({
        integrationId: 'x',
        content: 'hi',
        channel: 'x',
        type: 'now',
        date: new Date(),
      }),
    ).rejects.toThrow('x /2/tweets 401')
  })
})

describe('DbSocialPublisher', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function makeDb(
    conns: Partial<SocialConnectionDoc>[] = [],
    creds: Record<string, unknown>[] = [],
  ) {
    const docs = conns.map(
      (c) => ({ status: 'active', credentials: {}, ...c }) as Record<string, unknown>,
    )
    const credDocs = creds
    const col = {
      findOne: vi.fn(
        async (f: Record<string, unknown>) =>
          docs.find((d) => d['tenant_id'] === f['tenant_id'] && d['channel'] === f['channel']) ??
          null,
      ),
      find: vi.fn((f: Record<string, unknown>) => ({
        toArray: async () => docs.filter((d) => d['tenant_id'] === f['tenant_id']),
      })),
      updateOne: vi.fn(async (f: Record<string, unknown>, u: { $set: Record<string, unknown> }) => {
        const doc = docs.find(
          (d) => d['tenant_id'] === f['tenant_id'] && d['channel'] === f['channel'],
        )
        if (doc) Object.assign(doc, u.$set)
        return { modifiedCount: doc ? 1 : 0 }
      }),
    }
    const credCol = {
      findOne: vi.fn(
        async (f: Record<string, unknown>) =>
          credDocs.find(
            (d) => d['tenant_id'] === f['tenant_id'] && d['connector_id'] === f['connector_id'],
          ) ?? null,
      ),
      find: vi.fn((f: Record<string, unknown>) => ({
        toArray: async () =>
          credDocs.filter((d) => {
            if (d['tenant_id'] !== f['tenant_id']) return false
            const cond = f['connector_id']
            if (cond && typeof cond === 'object' && '$in' in (cond as Record<string, unknown>)) {
              return (cond as { $in: unknown[] }).$in.includes(d['connector_id'])
            }
            return d['connector_id'] === cond
          }),
      })),
      updateOne: vi.fn(async (f: Record<string, unknown>, u: { $set: Record<string, unknown> }) => {
        const doc = credDocs.find(
          (d) => d['tenant_id'] === f['tenant_id'] && d['connector_id'] === f['connector_id'],
        )
        if (doc) {
          for (const [k, v] of Object.entries(u.$set)) {
            const parts = k.split('.')
            let target = doc
            for (const p of parts.slice(0, -1))
              target = (target[p] ??= {}) as Record<string, unknown>
            target[parts[parts.length - 1]!] = v
          }
        }
        return { modifiedCount: doc ? 1 : 0 }
      }),
    }
    return {
      db: {
        collection: (name: string) => (name === 'connector_credentials' ? credCol : col),
      } as never,
      col,
      credCol,
      docs,
      credDocs,
    }
  }

  const xCred = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    tenant_id: 't1',
    connector_id: 'twitter_x',
    auth_type: 'oauth2',
    access_token: 'x-access-1', // no SETTINGS_ENCRYPTION_KEY in tests → passthrough
    refresh_token: 'x-refresh-1',
    token_expires_at: new Date(Date.now() + 3600_000),
    token_type: 'Bearer',
    extra: { username: 'lifekeel' },
    ...over,
  })

  const conn = (over: Partial<SocialConnectionDoc> = {}): Partial<SocialConnectionDoc> => ({
    tenant_id: 't1',
    channel: 'bluesky',
    handle: 'keel.bsky.social',
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
      integrationId: 'x',
      content: 'from db conn',
      channel: 'bluesky',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
    })) as { url?: string }
    expect(res.url).toBe('https://bsky.app/profile/keel.bsky.social/post/9z')
  })

  it('marks the connection error on publish failure and recovers it on success', async () => {
    const { db, docs } = makeDb([conn()])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    )
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({
        integrationId: 'x',
        content: 'hi',
        channel: 'bluesky',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
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
      integrationId: 'x',
      content: 'via env',
      channel: 'x',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
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
    const bluesky = integrations.filter((i) => i.identifier === 'bluesky' && i.source !== 'manual')
    expect(bluesky).toHaveLength(1)
    expect(bluesky[0]!.source).toBe('connection')
    expect(bluesky[0]!.name).toContain('@keel.bsky.social')
    expect(integrations.find((i) => i.identifier === 'x')!.source).toBe('env')
  })

  it('throws channel_not_configured when neither conn nor env covers the channel', async () => {
    const { db } = makeDb([])
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({
        integrationId: 'x',
        content: 'hi',
        channel: 'x',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
    ).rejects.toThrow('channel_not_configured:x')
  })

  it('publishes to X via the connector_credentials OAuth token', async () => {
    const { db } = makeDb([], [xCred()])
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      expect(url).toBe('https://api.x.com/2/tweets')
      expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer x-access-1')
      expect(JSON.parse(String(init!.body)).text).toBe('hello X')
      return jsonRes({ data: { id: 'tw-x1' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pub = new DbSocialPublisher(db, null)
    const res = (await pub.createPost({
      integrationId: 'x:connection',
      content: 'hello X',
      channel: 'x',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
    })) as { external_id?: string; url?: string }
    expect(res.external_id).toBe('tw-x1')
    expect(res.url).toBe('https://x.com/i/web/status/tw-x1')
  })

  it('refreshes an expired X token before publishing (Basic auth, rotated tokens persisted)', async () => {
    vi.stubEnv('X_CLIENT_ID', 'cid')
    vi.stubEnv('X_CLIENT_SECRET', 'csec')
    const { db, credDocs } = makeDb(
      [],
      [xCred({ token_expires_at: new Date(Date.now() - 60_000) })],
    )
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('oauth2/token')) {
        const auth = (init!.headers as Record<string, string>)['Authorization']
        expect(auth).toBe(`Basic ${Buffer.from('cid:csec').toString('base64')}`)
        expect(String(init!.body)).toContain('refresh_token=x-refresh-1')
        return jsonRes({ access_token: 'x-fresh', refresh_token: 'x-refresh-2', expires_in: 7200 })
      }
      expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer x-fresh')
      return jsonRes({ data: { id: 'tw-r1' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pub = new DbSocialPublisher(db, null)
    const res = (await pub.createPost({
      integrationId: 'x:connection',
      content: 'hi',
      channel: 'x',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
    })) as { external_id?: string }
    expect(res.external_id).toBe('tw-r1')
    expect(calls[0]).toContain('oauth2/token')
    expect(calls[1]).toBe('https://api.x.com/2/tweets')
    // Rotated tokens persist encrypted — decrypt to assert the values.
    expect(decryptIfNeeded(String(credDocs[0]!['access_token']))).toBe('x-fresh')
    expect(decryptIfNeeded(String(credDocs[0]!['refresh_token']))).toBe('x-refresh-2')
  })

  it('surfaces the real X error detail instead of collapsing every 403 into a permissions hint', async () => {
    const { db } = makeDb([], [xCred()])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonRes(
          {
            title: 'Forbidden',
            detail: 'You are not allowed to create a Tweet with duplicate content.',
          },
          { status: 403 },
        ),
      ),
    )
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({
        integrationId: 'x:connection',
        content: 'same text twice',
        channel: 'x',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
    ).rejects.toThrow('duplicate content')
  })

  it('permission-shaped X errors get the reconnect hint — tokens keep the scopes they were issued with', async () => {
    const { db } = makeDb([], [xCred()])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonRes(
          { title: 'Forbidden', detail: 'You are not permitted to perform this action.' },
          { status: 403 },
        ),
      ),
    )
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({
        integrationId: 'x:connection',
        content: 'hi',
        channel: 'x',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
    ).rejects.toThrow('disconnect and reconnect X')
  })

  it('lists the X OAuth connection with its handle and shadows env X', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    const { db } = makeDb([], [xCred()])
    const pub = new DbSocialPublisher(db, socialPublisherFromEnv())
    const integrations = await pub.listIntegrations('t1')
    // Two X entries: the connected account shadows the env token, and the
    // always-on manual handoff sits alongside as a credential-free option.
    const x = integrations.filter((i) => i.identifier === 'x')
    expect(x).toHaveLength(2)
    const conn = x.find((i) => i.id === 'x:connection')!
    expect(conn.source).toBe('connection')
    expect(conn.name).toContain('@lifekeel')
    expect(x.find((i) => i.id === 'x:manual')!.source).toBe('manual')
    expect(integrations.find((i) => i.id === 'x:env')).toBeUndefined()
  })

  const oauthCred = (connectorId: string, extra: Record<string, string>) => ({
    tenant_id: 't1',
    connector_id: connectorId,
    auth_type: 'oauth2',
    access_token: `tok-${connectorId}`, // no SETTINGS_ENCRYPTION_KEY → passthrough
    token_type: 'Bearer',
    extra,
  })

  it('lists X once when it is stored in both social_connections and connector_credentials', async () => {
    // X connect mirrors its token onto social_connections, so both stores hold it.
    const { db } = makeDb([conn({ channel: 'x', handle: 'lifekeel' })], [xCred()])
    const pub = new DbSocialPublisher(db, null)
    const ids = (await pub.listIntegrations('t1')).map((i) => i.id)
    expect(ids.filter((id) => id === 'x:connection')).toHaveLength(1)
    expect(ids).toContain('x:manual')
  })

  it('publishes a Facebook page post via the page token + stored page_id', async () => {
    const { db } = makeDb(
      [],
      [oauthCred('facebook_pages', { page_id: 'pg-42', page_name: 'Keel HQ' })],
    )
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      expect(url).toBe('https://graph.facebook.com/v19.0/pg-42/feed')
      expect((init!.headers as Record<string, string>)['Authorization']).toBe(
        'Bearer tok-facebook_pages',
      )
      expect(JSON.parse(String(init!.body))).toEqual({ message: 'hello fb' })
      return jsonRes({ id: 'pg-42_113' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pub = new DbSocialPublisher(db, null)
    const res = (await pub.createPost({
      integrationId: 'facebook:connection',
      content: 'hello fb',
      channel: 'facebook',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
    })) as { external_id?: string; url?: string }
    expect(res.external_id).toBe('pg-42_113')
    expect(res.url).toBe('https://facebook.com/pg-42_113')
  })

  it('posts a Facebook photo when media_url is set', async () => {
    const { db } = makeDb([], [oauthCred('facebook_pages', { page_id: 'pg-42' })])
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://graph.facebook.com/v19.0/pg-42/photos')
      expect(JSON.parse(String(init!.body))).toEqual({
        caption: 'with pic',
        image_url: 'https://keel.example/pic.png',
      })
      return jsonRes({ id: 'ph-9', post_id: 'pg-42_114' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pub = new DbSocialPublisher(db, null)
    const res = (await pub.createPost({
      integrationId: 'facebook:connection',
      content: 'with pic',
      channel: 'facebook',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
      mediaUrl: 'https://keel.example/pic.png',
    })) as { external_id?: string }
    expect(res.external_id).toBe('pg-42_114')
  })

  it('publishes a Threads post through the two-step container flow', async () => {
    const { db } = makeDb([], [oauthCred('threads', { user_id: 'th-1', username: '@lifekeel' })])
    const calls: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, body: JSON.parse(String(init!.body)) })
        if (url.endsWith('/threads')) return jsonRes({ id: 'container-7' })
        return jsonRes({ id: 'media-88' })
      }),
    )
    const pub = new DbSocialPublisher(db, null)
    const res = (await pub.createPost({
      integrationId: 'threads:connection',
      content: 'hello threads',
      channel: 'threads',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
    })) as { external_id?: string }
    expect(calls[0]!.url).toBe('https://graph.threads.net/v1.0/th-1/threads')
    expect(calls[0]!.body).toEqual({ media_type: 'TEXT', text: 'hello threads' })
    expect(calls[1]!.url).toBe('https://graph.threads.net/v1.0/th-1/threads_publish')
    expect(calls[1]!.body).toEqual({ creation_id: 'container-7' })
    expect(res.external_id).toBe('media-88')
  })

  it('publishes to LinkedIn via the OAuth token and captured member URN', async () => {
    const { db } = makeDb(
      [],
      [oauthCred('linkedin', { author_urn: 'urn:li:person:oauth-sub', name: 'Balu' })],
    )
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.linkedin.com/rest/posts')
      expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-linkedin')
      const body = JSON.parse(String(init!.body)) as Record<string, unknown>
      expect(body['author']).toBe('urn:li:person:oauth-sub')
      return jsonRes({}, { headers: { 'x-restli-id': 'urn:li:share:77' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pub = new DbSocialPublisher(db, null)
    const res = (await pub.createPost({
      integrationId: 'linkedin:connection',
      content: 'hi linkedin',
      channel: 'linkedin',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
    })) as { external_id?: string }
    expect(res.external_id).toBe('urn:li:share:77')
  })

  it('rejects Instagram without an image, then publishes via container→publish', async () => {
    const { db } = makeDb(
      [],
      [oauthCred('instagram_business', { ig_user_id: 'ig-9', ig_username: '@keel' })],
    )
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/media')) return jsonRes({ id: 'container-3' })
      return jsonRes({ id: 'media-55' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({
        integrationId: 'ig',
        content: 'no image',
        channel: 'instagram',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
    ).rejects.toThrow('image is required')

    const res = (await pub.createPost({
      integrationId: 'ig',
      content: 'with image',
      channel: 'instagram',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
      mediaUrl: 'https://keel.example/i.png',
    })) as { external_id?: string }
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v19.0/ig-9/media')
    expect(JSON.parse(String(init.body))).toEqual({
      image_url: 'https://keel.example/i.png',
      caption: 'with image',
    })
    expect(res.external_id).toBe('media-55')
  })

  it('lists every OAuth-connected channel with its account label', async () => {
    const { db } = makeDb(
      [],
      [
        oauthCred('facebook_pages', { page_id: 'pg-1', page_name: 'Keel HQ' }),
        oauthCred('threads', { user_id: 'th-1', username: '@lifekeel' }),
        oauthCred('linkedin', { author_urn: 'urn:li:person:x', name: 'Balu Reddy' }),
        oauthCred('instagram_business', { ig_user_id: 'ig-1', ig_username: '@keel' }),
      ],
    )
    const pub = new DbSocialPublisher(db, null)
    const integrations = await pub.listIntegrations('t1')
    const byId = new Map(
      integrations.filter((i) => i.source !== 'manual').map((i) => [i.identifier, i.name]),
    )
    expect(byId.get('facebook')).toBe('Facebook (Keel HQ)')
    expect(byId.get('threads')).toBe('Threads (@lifekeel)')
    expect(byId.get('linkedin')).toBe('LinkedIn (Balu Reddy)')
    expect(byId.get('instagram')).toBe('Instagram (@keel)')
  })

  it('surfaces needs_reauth as a reconnect error instead of a dead publish', async () => {
    const { db } = makeDb(
      [],
      [{ ...oauthCred('threads', { user_id: 'th-1' }), needs_reauth: true }],
    )
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({
        integrationId: 't',
        content: 'hi',
        channel: 'threads',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
    ).rejects.toThrow('reconnect')
  })

  it('lists the manual X channel even with no credentials at all', async () => {
    const { db } = makeDb([])
    const pub = new DbSocialPublisher(db, null)
    const integrations = await pub.listIntegrations('t1')
    const manual = integrations.find((i) => i.id === 'x:manual')
    expect(manual).toBeDefined()
    expect(manual!.source).toBe('manual')
    expect(manual!.disabled).toBe(false)
  })

  it('lists a manual post option for every network whose composer accepts prefilled text', async () => {
    const { db } = makeDb([])
    const pub = new DbSocialPublisher(db, null)
    const manual = (await pub.listIntegrations('t1')).filter((i) => i.source === 'manual')
    expect(manual.map((i) => i.id).sort()).toEqual([
      'bluesky:manual',
      'linkedin:manual',
      'threads:manual',
      'x:manual',
    ])
    expect(manual.find((i) => i.id === 'linkedin:manual')!.name).toBe('LinkedIn (manual post)')
  })

  it('builds each network’s own composer link without fetch or credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { db } = makeDb([])
    const pub = new DbSocialPublisher(db, null)
    const text = 'Hello & welcome #LifeKeel'
    const urlFor = async (channel: string) =>
      (
        (await pub.createPost({
          integrationId: `${channel}:manual`,
          content: text,
          channel,
          type: 'now',
          date: new Date(),
          tenantId: 't1',
        })) as { manual: { intent_url: string } }
      ).manual.intent_url
    const enc = encodeURIComponent(text)
    expect(await urlFor('bluesky')).toBe(`https://bsky.app/intent/compose?text=${enc}`)
    expect(await urlFor('linkedin')).toBe(
      `https://www.linkedin.com/feed/?shareActive=true&text=${enc}`,
    )
    expect(await urlFor('threads')).toBe(`https://www.threads.net/intent/post?text=${enc}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a manual post for a network with no prefilled-text composer link', async () => {
    const { db } = makeDb([])
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({
        integrationId: 'instagram:manual',
        content: 'hi',
        channel: 'instagram',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
    ).rejects.toThrow('channel_not_configured:instagram')
  })

  it('manual dispatch returns the intent URL and never touches fetch or stored credentials', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ data: { id: 'tw-x1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { db } = makeDb([], [xCred()])
    const pub = new DbSocialPublisher(db, null)
    const res = (await pub.createPost({
      integrationId: 'x:manual',
      content: 'hi manual',
      channel: 'x',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
    })) as {
      manual?: { intent_url: string }
      publisher: { source: string; integration_id: string }
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.manual!.intent_url).toContain('https://twitter.com/intent/tweet?text=')
    expect(res.publisher.source).toBe('manual')
    expect(res.publisher.integration_id).toBe('x:manual')
  })

  it('x:manual never falls through to the env credential', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    const fetchMock = vi.fn(async () => jsonRes({ data: { id: 'tw-wrong' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { db } = makeDb([])
    const pub = new DbSocialPublisher(db, socialPublisherFromEnv())
    const res = (await pub.createPost({
      integrationId: 'x:manual',
      content: 'hi',
      channel: 'x',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
    })) as { manual?: { intent_url: string } }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.manual).toBeDefined()
  })

  it('manual dispatch rejects channels without an intent path', async () => {
    const { db } = makeDb([])
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({
        integrationId: 'facebook:manual',
        content: 'hi',
        channel: 'facebook',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
    ).rejects.toThrow('channel_not_configured:facebook')
  })
})

describe('B12 — publisher binding + gateway policy', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function makeDb(
    conns: Partial<SocialConnectionDoc>[] = [],
    creds: Record<string, unknown>[] = [],
  ) {
    const docs = conns.map(
      (c) => ({ status: 'active', credentials: {}, ...c }) as Record<string, unknown>,
    )
    const col = {
      findOne: vi.fn(
        async (f: Record<string, unknown>) =>
          docs.find((d) => d['tenant_id'] === f['tenant_id'] && d['channel'] === f['channel']) ??
          null,
      ),
      find: vi.fn((f: Record<string, unknown>) => ({
        toArray: async () => docs.filter((d) => d['tenant_id'] === f['tenant_id']),
      })),
      updateOne: vi.fn(async (f: Record<string, unknown>, u: { $set: Record<string, unknown> }) => {
        const doc = docs.find(
          (d) => d['tenant_id'] === f['tenant_id'] && d['channel'] === f['channel'],
        )
        if (doc) Object.assign(doc, u.$set)
        return { modifiedCount: doc ? 1 : 0 }
      }),
    }
    const credCol = {
      findOne: vi.fn(
        async (f: Record<string, unknown>) =>
          creds.find(
            (d) => d['tenant_id'] === f['tenant_id'] && d['connector_id'] === f['connector_id'],
          ) ?? null,
      ),
      find: vi.fn((f: Record<string, unknown>) => ({
        toArray: async () => creds.filter((d) => d['tenant_id'] === f['tenant_id']),
      })),
      updateOne: vi.fn(async () => ({ modifiedCount: 0 })),
    }
    return {
      db: {
        collection: (name: string) => (name === 'connector_credentials' ? credCol : col),
      } as never,
    }
  }

  it('a :connection id never falls through to the env account', async () => {
    // The old channel-keyed dispatch could silently post to the platform's
    // env X account when the tenant connection was missing — a public post
    // from the wrong account.
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    const fetchMock = vi.fn(async () => jsonRes({ data: { id: 'tw-wrong' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { db } = makeDb([])
    const pub = new DbSocialPublisher(db, socialPublisherFromEnv())
    await expect(
      pub.createPost({
        integrationId: 'x:connection',
        content: 'hi',
        channel: 'x',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
    ).rejects.toThrow('channel_not_configured:x')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an :env id never dips into tenant-stored credentials', async () => {
    const { db } = makeDb([
      {
        tenant_id: 't1',
        channel: 'bluesky',
        handle: 'keel.bsky.social',
        credentials: { app_password: 'app-pass' },
      },
    ])
    const { db: dbNoEnv } = makeDb([], [])
    void dbNoEnv
    const pub = new DbSocialPublisher(db, null)
    await expect(
      pub.createPost({
        integrationId: 'bluesky:env',
        content: 'hi',
        channel: 'bluesky',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
    ).rejects.toThrow('channel_not_configured:bluesky')
  })

  it('a mismatched id channel cannot redirect the dispatch', async () => {
    vi.stubEnv('BSKY_HANDLE', 'env.bsky.social')
    vi.stubEnv('BSKY_APP_PASSWORD', 'env-pass')
    const fetchMock = vi.fn(async () => jsonRes({ accessJwt: 'j', did: 'did:plc:1' }))
    vi.stubGlobal('fetch', fetchMock)
    const { db } = makeDb([])
    const pub = new DbSocialPublisher(db, socialPublisherFromEnv())
    await expect(
      pub.createPost({
        integrationId: 'x:connection',
        content: 'hi',
        channel: 'bluesky',
        type: 'now',
        date: new Date(),
        tenantId: 't1',
      }),
    ).rejects.toThrow('channel_not_configured:bluesky')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the result names the resolved publisher — account and credential source', async () => {
    vi.stubEnv('X_ACCESS_TOKEN', 'xtok')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonRes({ data: { id: 'tw-1' } })),
    )
    const pub = socialPublisherFromEnv()!
    const res = (await pub.createPost({
      integrationId: 'x:env',
      content: 'hello',
      channel: 'x',
      type: 'now',
      date: new Date(),
    })) as { publisher?: { source: string; account: string; integration_id: string } }
    expect(res.publisher).toEqual({
      integration_id: 'x:env',
      channel: 'x',
      source: 'env',
      account: 'env credential',
    })
  })

  it('tenant-connection results name the tenant account', async () => {
    const { db } = makeDb([
      {
        tenant_id: 't1',
        channel: 'bluesky',
        handle: 'keel.bsky.social',
        credentials: { app_password: 'app-pass' },
      },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url.includes('createSession')) return jsonRes({ accessJwt: 'j', did: 'did:plc:1' })
        return jsonRes({ uri: 'at://did:plc:1/app.bsky.feed.post/zz' })
      }),
    )
    const pub = new DbSocialPublisher(db, null)
    const res = (await pub.createPost({
      integrationId: 'bluesky:connection',
      content: 'hi',
      channel: 'bluesky',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
      idempotencyKey: 'post-9',
    })) as { publisher?: { source: string; account: string } }
    expect(res.publisher?.source).toBe('connection')
    expect(res.publisher?.account).toBe('@keel.bsky.social')
  })

  it('bluesky dispatch carries a deterministic record key from the post id', async () => {
    const { db } = makeDb([
      {
        tenant_id: 't1',
        channel: 'bluesky',
        handle: 'keel.bsky.social',
        credentials: { app_password: 'app-pass' },
      },
    ])
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('createSession')) return jsonRes({ accessJwt: 'j', did: 'did:plc:1' })
      return jsonRes({ uri: 'at://did:plc:1/app.bsky.feed.post/zz' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const pub = new DbSocialPublisher(db, null)
    await pub.createPost({
      integrationId: 'bluesky:connection',
      content: 'hi',
      channel: 'bluesky',
      type: 'now',
      date: new Date(),
      tenantId: 't1',
      idempotencyKey: 'post-9-abc',
    })
    const [, recordInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    const recordBody = JSON.parse(String(recordInit.body)) as { rkey?: string }
    // The rkey IS the dedupe: a retried createRecord with the same key is
    // refused by the repo instead of double-posting.
    expect(recordBody.rkey).toBe(tidRkey('post-9-abc'))
  })
})
