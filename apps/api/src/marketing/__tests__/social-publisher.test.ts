/**
 * social-publisher — env detection and per-channel HTTP contracts. fetch is
 * stubbed; no real network in tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EnvSocialPublisher, socialPublisherFromEnv } from '../social-publisher.js'

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
