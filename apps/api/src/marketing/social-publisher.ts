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
 *   mastodon MASTODON_INSTANCE_URL +              — instance token;
 *            MASTODON_ACCESS_TOKEN                    POST /api/v1/statuses.
 *
 * OAuth-connected channels (operator "Connect" buttons, tokens in
 * connector_credentials, decrypted only inside the dispatch call):
 *   x          connector twitter_x           — executor action createPosts
 *   facebook   connector facebook_pages      — page token + extra.page_id
 *   linkedin   connector linkedin            — extra.author_urn captured at
 *                                              callback (rest/posts, no refresh
 *                                              — tokens live ~60 days)
 *   threads    connector threads             — extra.user_id; container →
 *                                              publish two-step
 *   instagram  connector instagram_business  — extra.ig_user_id; media
 *                                              container → publish; REQUIRES
 *                                              an image (media_url) — IG has
 *                                              no text-post API.
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
  /** Attached image URL — required by Instagram, optional photo for Facebook. */
  mediaUrl?: string
}

export interface SocialPublisher {
  listIntegrations(tenantId?: string): Promise<ChannelInfo[]>
  createPost(args: CreatePostArgs): Promise<unknown>
}

import type { Db } from 'mongodb'
import { decryptEnveloped } from '../crypto/envelope.js'
import { ConnectorActionExecutor } from '@lifekeel/workflows'

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
    info: {
      id: 'linkedin:default',
      name: 'LinkedIn',
      identifier: 'linkedin',
      disabled: false,
      source: 'env',
    },
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

function blueskyHandler(
  handle: string,
  appPassword: string,
  service = 'https://bsky.social',
): ChannelHandler {
  return {
    info: {
      id: 'bluesky:default',
      name: 'Bluesky',
      identifier: 'bluesky',
      disabled: false,
      source: 'env',
    },
    async publish(content) {
      const sessRes = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: handle, password: appPassword }),
      })
      await checked(sessRes, 'bluesky createSession')
      const sess = (await sessRes.json()) as { accessJwt?: string; did?: string }
      if (!sess.accessJwt || !sess.did)
        throw new Error('bluesky createSession: no session returned')

      const postRes = await fetch(`${service}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sess.accessJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: sess.did,
          collection: 'app.bsky.feed.post',
          record: {
            $type: 'app.bsky.feed.post',
            text: content,
            createdAt: new Date().toISOString(),
          },
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
// Threads — Graph Threads API. Publishing is two-step: create a media
// container, then publish it. Bearer is the long-lived user token minted by
// the OAuth callback (th_exchange_token), user id stored in cred.extra.
// ---------------------------------------------------------------------------

function threadsHandler(token: string, userId: string): ChannelHandler {
  const base = 'https://graph.threads.net/v1.0'
  return {
    info: {
      id: 'threads:default',
      name: 'Threads',
      identifier: 'threads',
      disabled: false,
      source: 'env',
    },
    async publish(content) {
      const container = await fetch(`${base}/${userId}/threads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: 'TEXT', text: content }),
      })
      await checked(container, 'threads create container')
      const creationId = ((await container.json()) as { id?: string }).id
      if (!creationId) throw new Error('threads create container: no id returned')

      const pub = await fetch(`${base}/${userId}/threads_publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId }),
      })
      await checked(pub, 'threads publish container')
      const mediaId = ((await pub.json()) as { id?: string }).id
      return { external_id: mediaId }
    },
  }
}

// ---------------------------------------------------------------------------
// Instagram Business — Graph API via the linked Facebook Page's token.
// Two-step like Threads: media container (image required — there is no
// text-post endpoint), then publish. Caption limit 2200.
// ---------------------------------------------------------------------------

function instagramHandler(pageToken: string, igUserId: string, mediaUrl: string): ChannelHandler {
  const base = 'https://graph.facebook.com/v19.0'
  return {
    info: {
      id: 'instagram:default',
      name: 'Instagram',
      identifier: 'instagram',
      disabled: false,
      source: 'connection',
    },
    async publish(content) {
      const container = await fetch(`${base}/${igUserId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pageToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: mediaUrl, caption: content }),
      })
      await checked(container, 'instagram create media container')
      const creationId = ((await container.json()) as { id?: string }).id
      if (!creationId) throw new Error('instagram create container: no id returned')

      const pub = await fetch(`${base}/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pageToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId }),
      })
      await checked(pub, 'instagram publish container')
      const mediaId = ((await pub.json()) as { id?: string }).id
      return { external_id: mediaId }
    },
  }
}

// ---------------------------------------------------------------------------
// Mastodon — instance API, plain bearer token. Text posts fit marketing
// content natively; /statuses/{id} doubles as the engagement read.
// ---------------------------------------------------------------------------

function mastodonHandler(instanceUrl: string, token: string): ChannelHandler {
  const base = instanceUrl.replace(/\/$/, '')
  return {
    info: {
      id: 'mastodon:default',
      name: 'Mastodon',
      identifier: 'mastodon',
      disabled: false,
      source: 'env',
    },
    async publish(content) {
      const res = await fetch(`${base}/api/v1/statuses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: content }),
      })
      await checked(res, 'mastodon /api/v1/statuses')
      const data = (await res.json()) as { id?: string; url?: string }
      return { external_id: data.id, url: data.url }
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

  const mastodonInstance = process.env['MASTODON_INSTANCE_URL']
  const mastodonToken = process.env['MASTODON_ACCESS_TOKEN']
  if (mastodonInstance && mastodonToken)
    handlers.set('mastodon', mastodonHandler(mastodonInstance, mastodonToken))

  return handlers.size === 0 ? null : new EnvSocialPublisher(handlers)
}

// ---------------------------------------------------------------------------
// Tenant-stored connections — `social_connections` collection. Credentials
// are envelope-encrypted at rest under per-tenant DEKs (crypto/envelope.ts), same posture as
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

async function handlerForConnection(db: Db, conn: SocialConnectionDoc): Promise<ChannelHandler> {
  if (conn.channel === 'bluesky') {
    const appPassword = await decryptEnveloped(db, conn.credentials['app_password'])
    if (!appPassword) throw new Error('bluesky connection: no app password stored')
    return blueskyHandler(conn.handle, appPassword, conn.service)
  }
  throw new Error(`connection_unsupported:${conn.channel}`)
}

const CHANNEL_NAMES: Record<string, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  bluesky: 'Bluesky',
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
  mastodon: 'Mastodon',
}

/** Marketing channel id → connector_credentials connector id. The OAuth
 *  connect flow for each lives under /connectors/:id/oauth/*; the callback
 *  enriches `extra` with the ids publishing needs (page_id, author_urn,
 *  ig_user_id, user_id). */
export const CONNECTOR_CHANNELS: Record<string, string> = {
  x: 'twitter_x',
  facebook: 'facebook_pages',
  linkedin: 'linkedin',
  threads: 'threads',
  instagram: 'instagram_business',
}

/** Label shown on the connected channel card — X's handle, Facebook's page
 *  name, Threads' username, etc. Captured into cred.extra at OAuth callback. */
function connectorLabel(channel: string, extra: Record<string, string> | undefined): string {
  const name = CHANNEL_NAMES[channel] ?? channel
  // Display names (FB page, LinkedIn person) are used verbatim; handle fields
  // get a normalized '@' — X's callback stores bare usernames while the Meta
  // callbacks store '@'-prefixed ones.
  const display = extra?.['page_name'] ?? extra?.['name']
  if (display) return `${name} (${display})`
  const handle = extra?.['username'] ?? extra?.['ig_username']
  if (!handle) return name
  return `${name} (${handle.startsWith('@') ? handle : `@${handle}`})`
}

interface ConnectorCredDoc {
  tenant_id: string
  connector_id: string
  access_token?: string
  needs_reauth?: boolean
  extra?: Record<string, string>
}

/**
 * Resolves tenant-stored credentials first, then falls back to the
 * env-configured publisher. Two credential stores feed this:
 * - `social_connections` — Bluesky app-password connects (this module owns it)
 * - `connector_credentials` — OAuth-connected channels (X, Facebook Pages,
 *   LinkedIn, Threads, Instagram Business). Facebook dispatches through
 *   ConnectorActionExecutor (its feed/photos actions fit the generic
 *   single-call shape); LinkedIn/Threads/Instagram use dedicated handlers
 *   because their publish contracts don't (nested body, container→publish
 *   two-step). Stored tokens are decrypted only inside the dispatch call —
 *   listIntegrations never touches them.
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
    return this.db.collection<ConnectorCredDoc>('connector_credentials')
  }

  async listIntegrations(tenantId?: string): Promise<ChannelInfo[]> {
    const envList = this.env ? await this.env.listIntegrations() : []
    if (!tenantId) return envList
    const [conns, creds] = await Promise.all([
      this.connections.find({ tenant_id: tenantId }).toArray(),
      this.connectorCreds
        .find({ tenant_id: tenantId, connector_id: { $in: Object.values(CONNECTOR_CHANNELS) } })
        .toArray(),
    ])
    const connChannels = new Set(conns.map((c) => c.channel))
    const connList: ChannelInfo[] = conns.map((c) => ({
      id: `${c.channel}:connection`,
      name: `${CHANNEL_NAMES[c.channel] ?? c.channel} (@${c.handle})`,
      identifier: c.channel,
      disabled: c.status === 'error',
      source: 'connection' as const,
    }))
    for (const cred of creds) {
      const channel = Object.entries(CONNECTOR_CHANNELS).find(
        ([, c]) => c === cred.connector_id,
      )?.[0]
      if (!channel) continue
      connChannels.add(channel)
      connList.push({
        id: `${channel}:connection`,
        name: connectorLabel(channel, cred.extra),
        identifier: channel,
        disabled: cred.needs_reauth === true,
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

  /** Publish through an OAuth-connected channel. Returns null when the
   *  channel has no connector credential so the caller falls through to
   *  social_connections/env handlers. */
  private async publishViaConnector(
    args: CreatePostArgs,
  ): Promise<{ external_id?: string; url?: string } | null> {
    if (!args.tenantId) return null
    const connectorId = CONNECTOR_CHANNELS[args.channel]
    if (!connectorId) return null
    const cred = await this.connectorCreds.findOne({
      tenant_id: args.tenantId,
      connector_id: connectorId,
    })
    if (!cred) return null
    if (cred.needs_reauth === true) {
      throw new Error(`${args.channel} token expired — reconnect on the Marketing page`)
    }

    // X and Facebook fit the executor's generic action shape (single POST,
    // path params from cred.extra, flat body). The executor also owns token
    // decrypt + refresh-on-expiry + provider error surfacing.
    if (args.channel === 'x') {
      const exec = new ConnectorActionExecutor(this.db)
      const res = await exec.execute(args.tenantId, 'twitter_x', 'createPosts', {
        text: args.content,
      })
      if (!res.ok) throw new Error(res.error ?? `x publish failed: HTTP ${res.status}`)
      const id = (res.body as { data?: { id?: string } } | null)?.data?.id
      return { external_id: id, url: id ? `https://x.com/i/web/status/${id}` : undefined }
    }
    if (args.channel === 'facebook') {
      if (!cred.extra?.['page_id']) {
        throw new Error('facebook: no page connected — reconnect Facebook and pick a Page')
      }
      const exec = new ConnectorActionExecutor(this.db)
      const res = await exec.execute(
        args.tenantId,
        'facebook_pages',
        args.mediaUrl ? 'create_photo_post' : 'create_post',
        args.mediaUrl
          ? { caption: args.content, image_url: args.mediaUrl }
          : { message: args.content },
      )
      if (!res.ok) throw new Error(res.error ?? `facebook publish failed: HTTP ${res.status}`)
      const id =
        (res.body as { id?: string; post_id?: string } | null)?.post_id ??
        (res.body as { id?: string } | null)?.id
      return { external_id: id, url: id ? `https://facebook.com/${id}` : undefined }
    }

    // LinkedIn/Threads/Instagram: dedicated handlers — their contracts are
    // nested bodies or container→publish two-steps the generic executor
    // can't express. Token decrypt is explicit and stays inside this call.
    const token = cred.access_token ? await decryptEnveloped(this.db, cred.access_token) : undefined
    if (!token) throw new Error(`${args.channel}: stored credential has no access token`)
    if (args.channel === 'linkedin') {
      const urn = cred.extra?.['author_urn']
      if (!urn) throw new Error('linkedin: no member URN stored — reconnect LinkedIn')
      return linkedinHandler(token, urn).publish(args.content)
    }
    if (args.channel === 'threads') {
      const userId = cred.extra?.['user_id']
      if (!userId) throw new Error('threads: no user id stored — reconnect Threads')
      return threadsHandler(token, userId).publish(args.content)
    }
    if (args.channel === 'instagram') {
      const igUserId = cred.extra?.['ig_user_id']
      if (!igUserId) throw new Error('instagram: no business account linked — reconnect Instagram')
      if (!args.mediaUrl) {
        throw new Error('instagram: an image is required — set the media URL on the post')
      }
      return instagramHandler(token, igUserId, args.mediaUrl).publish(args.content)
    }
    return null
  }

  async createPost(args: CreatePostArgs): Promise<unknown> {
    const connectorResult = await this.publishViaConnector(args)
    if (connectorResult) return connectorResult
    const conn = args.tenantId
      ? await this.connections.findOne({ tenant_id: args.tenantId, channel: args.channel })
      : null
    if (conn) {
      try {
        const result = await (await handlerForConnection(this.db, conn)).publish(args.content)
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
