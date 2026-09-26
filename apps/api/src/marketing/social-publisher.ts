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
 *
 * Credentials can also live in the `social_connections` collection,
 * connected per-tenant through /marketing/connections (app-password for
 * Bluesky today; env still covers X/LinkedIn). DbSocialPublisher resolves a
 * tenant's stored connection first and falls back to the env handler for
 * the same channel.
 */

export interface ChannelInfo {
  id: string
  name: string
  identifier: string
  disabled: boolean
  source?: 'env' | 'connection'
}

export interface CreatePostArgs {
  integrationId: string
  content: string
  channel: string
  type: 'now' | 'schedule'
  date: Date
  tenantId?: string
}

export interface SocialPublisher {
  listIntegrations(tenantId?: string): Promise<ChannelInfo[]>
  createPost(args: CreatePostArgs): Promise<unknown>
}

import type { Db } from 'mongodb'
import { decryptIfNeeded } from '@agentoak/platform'
import { ConnectorActionExecutor } from '@agentoak/workflows'

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
    info: { id: 'x:default', name: 'X', identifier: 'x', disabled: false, source: 'env' },
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
    info: { id: 'linkedin:default', name: 'LinkedIn', identifier: 'linkedin', disabled: false, source: 'env' },
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
    info: { id: 'bluesky:default', name: 'Bluesky', identifier: 'bluesky', disabled: false, source: 'env' },
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

// ---------------------------------------------------------------------------
// Tenant-stored connections — `social_connections` collection. Credentials
// are AES-256-GCM encrypted at rest (encryptIfNeeded), same posture as
// connector_credentials. A connection never leaves this module decrypted.
// ---------------------------------------------------------------------------

export interface SocialConnectionDoc {
  tenant_id: string
  channel: string
  handle: string
  credentials: Record<string, string>
  service?: string
  did?: string
  status: 'active' | 'error'
  last_error?: string | null
  last_used_at?: Date
  connected_by: string
  created_at: Date
  updated_at: Date
}

/** Verify a Bluesky handle + app password by opening a session. Returns the
 *  account DID on success; throws with the XRPC error otherwise. Used by the
 *  connect route so bad credentials are rejected before they're stored. */
export async function verifyBlueskyCredentials(
  handle: string,
  appPassword: string,
  service = 'https://bsky.social',
): Promise<{ did: string }> {
  const res = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  })
  await checked(res, 'bluesky createSession')
  const sess = (await res.json()) as { did?: string }
  if (!sess.did) throw new Error('bluesky createSession: no did returned')
  return { did: sess.did }
}

function handlerForConnection(conn: SocialConnectionDoc): ChannelHandler {
  if (conn.channel === 'bluesky') {
    const appPassword = decryptIfNeeded(conn.credentials['app_password'])
    if (!appPassword) throw new Error('bluesky connection: no app password stored')
    return blueskyHandler(conn.handle, appPassword, conn.service)
  }
  throw new Error(`connection_unsupported:${conn.channel}`)
}

const CHANNEL_NAMES: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', bluesky: 'Bluesky' }

/**
 * Resolves tenant-stored credentials first, then falls back to the
 * env-configured publisher. Two credential stores feed this:
 * - `social_connections` — Bluesky app-password connects (this module owns it)
 * - `connector_credentials` (`connector_id: 'twitter_x'`) — X's OAuth2 flow
 *   from /connectors/twitter_x/oauth/*; dispatched through
 *   ConnectorActionExecutor so refresh-on-expiry, Basic-auth confidential
 *   client, and encrypted token rotation are all handled by that pipeline.
 * Stored credentials are decrypted only inside the dispatch call —
 * listIntegrations never touches them.
 */
export class DbSocialPublisher implements SocialPublisher {
  constructor(
    private readonly db: Db,
    private readonly env: EnvSocialPublisher | null,
  ) {}

  private get connections() {
    return this.db.collection<SocialConnectionDoc>('social_connections')
  }

  private get connectorCreds() {
    return this.db.collection<{
      tenant_id: string
      connector_id: string
      needs_reauth?: boolean
      extra?: Record<string, string>
    }>('connector_credentials')
  }

  async listIntegrations(tenantId?: string): Promise<ChannelInfo[]> {
    const envList = this.env ? await this.env.listIntegrations() : []
    if (!tenantId) return envList
    const [conns, xCred] = await Promise.all([
      this.connections.find({ tenant_id: tenantId }).toArray(),
      this.connectorCreds.findOne({ tenant_id: tenantId, connector_id: 'twitter_x' }),
    ])
    const connChannels = new Set(conns.map((c) => c.channel))
    const connList: ChannelInfo[] = conns.map((c) => ({
      id: `${c.channel}:connection`,
      name: `${CHANNEL_NAMES[c.channel] ?? c.channel} (@${c.handle})`,
      identifier: c.channel,
      disabled: c.status === 'error',
      source: 'connection' as const,
    }))
    if (xCred) {
      connChannels.add('x')
      const username = xCred.extra?.['username']
      connList.push({
        id: 'x:connection',
        name: `X${username ? ` (@${username})` : ''}`,
        identifier: 'x',
        disabled: xCred.needs_reauth === true,
        source: 'connection' as const,
      })
    }
    return [
      ...connList,
      // A stored connection shadows the env channel for this tenant — the
      // composer would otherwise show the same channel twice.
      ...envList.filter((i) => !connChannels.has(i.identifier)),
    ]
  }

  async createPost(args: CreatePostArgs): Promise<unknown> {
    // X via the OAuth-connected connector credential — the executor owns
    // token expiry/refresh and surfaces X's humanized errors (e.g. the
    // "Read only app permissions" hint on 402/403).
    if (args.channel === 'x' && args.tenantId) {
      const xCred = await this.connectorCreds.findOne({ tenant_id: args.tenantId, connector_id: 'twitter_x' })
      if (xCred) {
        const exec = new ConnectorActionExecutor(this.db)
        const res = await exec.execute(args.tenantId, 'twitter_x', 'createPosts', { text: args.content })
        if (!res.ok) throw new Error(res.error ?? `x publish failed: HTTP ${res.status}`)
        const id = (res.body as { data?: { id?: string } } | null)?.data?.id
        return { external_id: id, url: id ? `https://x.com/i/web/status/${id}` : undefined }
      }
    }
    const conn = args.tenantId
      ? await this.connections.findOne({ tenant_id: args.tenantId, channel: args.channel })
      : null
    if (conn) {
      try {
        const result = await handlerForConnection(conn).publish(args.content)
        await this.connections.updateOne(
          { tenant_id: conn.tenant_id, channel: conn.channel },
          { $set: { status: 'active', last_error: null, last_used_at: new Date() } },
        )
        return result
      } catch (err) {
        await this.connections.updateOne(
          { tenant_id: conn.tenant_id, channel: conn.channel },
          { $set: { status: 'error', last_error: String(err).slice(0, 300) } },
        )
        throw err
      }
    }
    if (this.env) return this.env.createPost(args)
    throw new Error(`channel_not_configured:${args.channel}`)
  }
}
