/**
 * In-house social publisher — replaced Postiz with direct per-channel calls.
 *
 * Channels are enabled purely by env credentials; a channel with no
 * credentials simply isn't listed and publish attempts for it fail with
 * `channel_not_configured:<channel>` (lands the post in publish_failed,
 * retryable through approve once credentials exist).
 *
 * Supported + required env:
 *   x        X_ACCESS_TOKEN                       — OAuth2 user-context token,
 *                                                   scopes tweet.write + users.read.
 *                                                   POST /2/tweets.
 *   linkedin LINKEDIN_ACCESS_TOKEN                — OAuth2 token, w_member_social.
 *            LINKEDIN_AUTHOR_URN                  — e.g. urn:li:person:abc123
 *                                                   POST /rest/posts.
 *   bluesky  BSKY_HANDLE + BSKY_APP_PASSWORD      — app-password auth;
 *                                                   createSession → createRecord.
 *
 * Duck-type-compatible with the old PostizClient (listIntegrations /
 * createPost) so marketing-posts.ts and its tests didn't have to change
 * shape. `integration_id` on a post is now just a label — dispatch keys off
 * `channel` alone.
 */

export interface ChannelInfo {
  id: string
  name: string
  identifier: string
  disabled: boolean
}

export interface CreatePostArgs {
  integrationId: string
  content: string
  channel: string
  type: 'now' | 'schedule'
  date: Date
}

export interface SocialPublisher {
  listIntegrations(): Promise<ChannelInfo[]>
  createPost(args: CreatePostArgs): Promise<unknown>
}

interface ChannelHandler {
  info: ChannelInfo
  publish(content: string): Promise<{ external_id?: string; url?: string }>
}

async function checked(res: Response, what: string): Promise<void> {
  if (res.ok) return
  const detail = (await res.text().catch(() => '')).slice(0, 300)
  throw new Error(`${what} ${res.status}: ${detail}`)
}

// ---------------------------------------------------------------------------
// X (Twitter) — API v2, user-context OAuth2 bearer.
// ---------------------------------------------------------------------------

function xHandler(token: string): ChannelHandler {
  return {
    info: { id: 'x:default', name: 'X', identifier: 'x', disabled: false },
    async publish(content) {
      const res = await fetch('https://api.x.com/2/tweets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content }),
      })
      await checked(res, 'x /2/tweets')
      const data = (await res.json()) as { data?: { id?: string } }
      const id = data.data?.id
      return { external_id: id, url: id ? `https://x.com/i/web/status/${id}` : undefined }
    },
  }
}

// ---------------------------------------------------------------------------
// LinkedIn — Posts API (rest/posts), author URN required.
// ---------------------------------------------------------------------------

function linkedinHandler(token: string, authorUrn: string): ChannelHandler {
  return {
    info: { id: 'linkedin:default', name: 'LinkedIn', identifier: 'linkedin', disabled: false },
    async publish(content) {
      const res = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Linkedin-Version': '202501',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author: authorUrn,
          commentary: content,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
      })
      await checked(res, 'linkedin /rest/posts')
      const id = res.headers.get('x-restli-id') ?? undefined
      return { external_id: id }
    },
  }
}

// ---------------------------------------------------------------------------
// Bluesky — app-password session then repo createRecord.
// ---------------------------------------------------------------------------

function blueskyHandler(handle: string, appPassword: string, service = 'https://bsky.social'): ChannelHandler {
  return {
    info: { id: 'bluesky:default', name: 'Bluesky', identifier: 'bluesky', disabled: false },
    async publish(content) {
      const sessRes = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: handle, password: appPassword }),
      })
      await checked(sessRes, 'bluesky createSession')
      const sess = (await sessRes.json()) as { accessJwt?: string; did?: string }
      if (!sess.accessJwt || !sess.did) throw new Error('bluesky createSession: no session returned')

      const postRes = await fetch(`${service}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sess.accessJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: sess.did,
          collection: 'app.bsky.feed.post',
          record: { $type: 'app.bsky.feed.post', text: content, createdAt: new Date().toISOString() },
        }),
      })
      await checked(postRes, 'bluesky createRecord')
      const rec = (await postRes.json()) as { uri?: string }
      const postId = rec.uri?.split('/').pop()
      return {
        external_id: rec.uri,
        url: postId ? `https://bsky.app/profile/${handle}/post/${postId}` : undefined,
      }
    },
  }
}

// ---------------------------------------------------------------------------

export class EnvSocialPublisher implements SocialPublisher {
  constructor(private readonly handlers: ReadonlyMap<string, ChannelHandler>) {}

  listIntegrations(): Promise<ChannelInfo[]> {
    return Promise.resolve([...this.handlers.values()].map((h) => h.info))
  }

  async createPost(args: CreatePostArgs): Promise<unknown> {
    const handler = this.handlers.get(args.channel)
    if (!handler) throw new Error(`channel_not_configured:${args.channel}`)
    return handler.publish(args.content)
  }
}

/** Null when no channel has credentials — callers treat null as
 *  "publishing not configured" rather than throwing at boot. */
export function socialPublisherFromEnv(): EnvSocialPublisher | null {
  const handlers = new Map<string, ChannelHandler>()

  const xToken = process.env['X_ACCESS_TOKEN']
  if (xToken) handlers.set('x', xHandler(xToken))

  const liToken = process.env['LINKEDIN_ACCESS_TOKEN']
  const liUrn = process.env['LINKEDIN_AUTHOR_URN']
  if (liToken && liUrn) handlers.set('linkedin', linkedinHandler(liToken, liUrn))

  const bskyHandle = process.env['BSKY_HANDLE']
  const bskyPass = process.env['BSKY_APP_PASSWORD']
  if (bskyHandle && bskyPass) {
    handlers.set('bluesky', blueskyHandler(bskyHandle, bskyPass, process.env['BSKY_SERVICE_URL']))
  }

  return handlers.size === 0 ? null : new EnvSocialPublisher(handlers)
}
