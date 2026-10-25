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
  /** The account that would publish — handle, page name, member URN.
   *  Shown in previews and recorded on the post so "which account did this
   *  go out as" is never ambiguous (§14.7). */
  account?: string
}

/** Which account actually dispatched the post — recorded on the post doc
 *  and in audit evidence. `source` is the credential store that supplied it. */
export interface PublisherIdentity {
  integration_id: string
  channel: string
  source: 'env' | 'connection'
  account: string
}

export interface PublishResult {
  external_id?: string
  url?: string
  publisher: PublisherIdentity
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
  /** Stable dedupe id for the dispatch — the marketing post id. Forwarded to
   *  providers that honour one (Mastodon Idempotency-Key, Bluesky record
   *  key) and makes gateway retries safe where the provider supports it. */
  idempotencyKey?: string
}

export interface SocialPublisher {
  listIntegrations(tenantId?: string): Promise<ChannelInfo[]>
  createPost(args: CreatePostArgs): Promise<unknown>
}

import { createHash } from 'node:crypto'
import type { Db } from 'mongodb'
import { decryptEnveloped } from '../crypto/envelope.js'
import { encryptIfNeeded } from '@lifekeel/platform'
import { ConnectorActionExecutor } from '@lifekeel/workflows'
import { providerFetch } from '../provider-gateway.js'
import {
  isLinkedinVersionError,
  linkedinApiVersion,
  versionErrorMessage,
} from './linkedin-version.js'

interface ChannelHandler {
  info: ChannelInfo
  publish(
    content: string,
    ctx: { idempotencyKey?: string },
  ): Promise<Omit<PublishResult, 'publisher'>>
}

// ---------------------------------------------------------------------------
// X (Twitter) — API v2, user-context OAuth2 bearer.
// ---------------------------------------------------------------------------

function xHandler(
  token: string,
  source: 'env' | 'connection' = 'env',
  account = 'env credential',
): ChannelHandler {
  return {
    info: {
      id: `x:${source}`,
      name: 'X',
      identifier: 'x',
      disabled: false,
      source,
      account,
    },
    async publish(content, ctx) {
      const res = await providerFetch(
        'https://api.x.com/2/tweets',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: content }),
        },
        {
          label: 'x /2/tweets',
          breakerKey: 'x:env',
          ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
        },
      )
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
      id: 'linkedin:env',
      name: 'LinkedIn',
      identifier: 'linkedin',
      disabled: false,
      source: 'env',
      account: authorUrn,
    },
    async publish(content, ctx) {
      const version = linkedinApiVersion()
      let res: Response
      try {
        res = await providerFetch(
          'https://api.linkedin.com/rest/posts',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Linkedin-Version': version,
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
          },
          {
            label: 'linkedin /rest/posts',
            breakerKey: 'linkedin:env',
            ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
          },
        )
      } catch (err) {
        // An expired version is a config problem, not a transient failure: say what to change.
        if (isLinkedinVersionError(err)) throw new Error(versionErrorMessage(version))
        throw err
      }
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
  source: 'env' | 'connection' = 'env',
): ChannelHandler {
  return {
    info: {
      id: `bluesky:${source}`,
      name: `Bluesky (@${handle})`,
      identifier: 'bluesky',
      disabled: false,
      source,
      account: `@${handle}`,
    },
    async publish(content, ctx) {
      const sessRes = await providerFetch(
        `${service}/xrpc/com.atproto.server.createSession`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: handle, password: appPassword }),
        },
        // Session creates are idempotent — a retried open just opens a
        // second session, so timeouts are safe to retry here.
        { label: 'bluesky createSession', breakerKey: `bluesky:${handle}`, timeoutRetriable: true },
      )
      const sess = (await sessRes.json()) as { accessJwt?: string; did?: string }
      if (!sess.accessJwt || !sess.did)
        throw new Error('bluesky createSession: no session returned')

      const postRes = await providerFetch(
        `${service}/xrpc/com.atproto.repo.createRecord`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sess.accessJwt}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            repo: sess.did,
            collection: 'app.bsky.feed.post',
            // Deterministic record key = real dedupe: a retried write with
            // the same rkey is refused by the repo instead of double-posting.
            ...(ctx.idempotencyKey ? { rkey: tidRkey(ctx.idempotencyKey) } : {}),
            record: blueskyRecord(content),
          }),
        },
        {
          label: 'bluesky createRecord',
          breakerKey: `bluesky:${handle}`,
          ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
          timeoutRetriable: Boolean(ctx.idempotencyKey),
        },
      )
      const rec = (await postRes.json()) as { uri?: string }
      const postId = rec.uri?.split('/').pop()
      return {
        external_id: rec.uri,
        url: postId ? `https://bsky.app/profile/${handle}/post/${postId}` : undefined,
      }
    },
  }
}

const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz'

/** A TID-shaped rkey derived deterministically from the idempotency key —
 *  Bluesky validates record keys as TIDs, so a raw hashed key is refused
 *  ("Invalid TID string format") while a hash *in TID format* keeps the
 *  dedupe property: a retried write replays the same rkey and is refused
 *  instead of double-posting. */
/** A bare URL in `text` renders as dead text on Bluesky — the post needs a
 *  link facet (clickable) and an `app.bsky.embed.external` card (the rich
 *  preview every other scheduler ships). Byte offsets, not char offsets. */
export function blueskyRecord(content: string): Record<string, unknown> {
  const encoder = new TextEncoder()
  const facets: Record<string, unknown>[] = []
  let firstUrl: string | undefined
  for (const m of content.matchAll(/https?:\/\/\S+/g)) {
    const url = m[0]
    firstUrl ??= url
    facets.push({
      index: {
        byteStart: encoder.encode(content.slice(0, m.index)).length,
        byteEnd: encoder.encode(content.slice(0, m.index + url.length)).length,
      },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    })
  }
  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text: content,
    createdAt: new Date().toISOString(),
  }
  if (facets.length > 0) record['facets'] = facets
  if (firstUrl)
    record['embed'] = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: firstUrl,
        title: 'LifeKeel',
        description: 'One calm place for the family’s cover, runway and papers.',
      },
    }
  return record
}

export function tidRkey(seed: string): string {
  const h = createHash('sha256').update(seed).digest()
  let n = h.readBigUInt64BE(0)
  let s = ''
  for (let i = 0; i < 13; i++) {
    s = TID_ALPHABET[Number(n & 31n)] + s
    n >>= 5n
  }
  return s
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
      id: 'threads:env',
      name: 'Threads',
      identifier: 'threads',
      disabled: false,
      source: 'env',
      account: userId,
    },
    async publish(content) {
      const container = await providerFetch(
        `${base}/${userId}/threads`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ media_type: 'TEXT', text: content }),
        },
        // A retried container create only orphans a container — nothing is
        // public until the publish step, so timeouts are safe to retry.
        {
          label: 'threads create container',
          breakerKey: `threads:${userId}`,
          timeoutRetriable: true,
        },
      )
      const creationId = ((await container.json()) as { id?: string }).id
      if (!creationId) throw new Error('threads create container: no id returned')

      const pub = await providerFetch(
        `${base}/${userId}/threads_publish`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: creationId }),
        },
        { label: 'threads publish container', breakerKey: `threads:${userId}`, retries: 0 },
      )
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
      id: 'instagram:connection',
      name: 'Instagram',
      identifier: 'instagram',
      disabled: false,
      source: 'connection',
      account: igUserId,
    },
    async publish(content) {
      const container = await providerFetch(
        `${base}/${igUserId}/media`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${pageToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: mediaUrl, caption: content }),
        },
        {
          label: 'instagram create media container',
          breakerKey: `instagram:${igUserId}`,
          timeoutRetriable: true,
        },
      )
      const creationId = ((await container.json()) as { id?: string }).id
      if (!creationId) throw new Error('instagram create container: no id returned')

      const pub = await providerFetch(
        `${base}/${igUserId}/media_publish`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${pageToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: creationId }),
        },
        { label: 'instagram publish container', breakerKey: `instagram:${igUserId}`, retries: 0 },
      )
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
  const host = new URL(base).host
  return {
    info: {
      id: 'mastodon:env',
      name: 'Mastodon',
      identifier: 'mastodon',
      disabled: false,
      source: 'env',
      account: host,
    },
    async publish(content, ctx) {
      const res = await providerFetch(
        `${base}/api/v1/statuses`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: content }),
        },
        // Mastodon honours Idempotency-Key natively — with the post id
        // attached, even a timed-out publish is safe to retry.
        {
          label: 'mastodon /api/v1/statuses',
          breakerKey: `mastodon:${host}`,
          ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}),
          timeoutRetriable: Boolean(ctx.idempotencyKey),
        },
      )
      const data = (await res.json()) as { id?: string; url?: string }
      return { external_id: data.id, url: data.url }
    },
  }
}

// ---------------------------------------------------------------------------

/**
 * Split `<channel>:<source>` integration ids. The composer lists ids like
 * `x:env` (env credential) or `x:connection` (tenant-stored account); a
 * post's integration_id binds dispatch to that source — publishing via a
 * different account than the one previewed is exactly the ambiguity the
 * old channel-keyed dispatch had. Bare ids (no `:source`, or a source we
 * don't recognise — e.g. legacy Postiz ids) resolve tenant-first then env
 * for backwards compatibility, but the chosen source is always recorded.
 */
export function parseIntegrationId(integrationId: string): {
  channel: string | null
  source: 'env' | 'connection' | 'any'
} {
  const idx = integrationId.lastIndexOf(':')
  if (idx === -1) return { channel: null, source: 'any' }
  const source = integrationId.slice(idx + 1)
  if (source === 'connection') return { channel: integrationId.slice(0, idx), source: 'connection' }
  if (source === 'env' || source === 'default')
    return { channel: integrationId.slice(0, idx), source: 'env' }
  return { channel: null, source: 'any' }
}

export class EnvSocialPublisher implements SocialPublisher {
  constructor(private readonly handlers: ReadonlyMap<string, ChannelHandler>) {}

  listIntegrations(): Promise<ChannelInfo[]> {
    return Promise.resolve([...this.handlers.values()].map((h) => h.info))
  }

  async createPost(args: CreatePostArgs): Promise<PublishResult> {
    const handler = this.handlers.get(args.channel)
    if (!handler) throw new Error(`channel_not_configured:${args.channel}`)
    const out = await handler.publish(args.content, {
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
    })
    return {
      ...out,
      publisher: {
        integration_id: handler.info.id,
        channel: args.channel,
        source: 'env',
        account: handler.info.account ?? handler.info.name,
      },
    }
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
  const res = await providerFetch(
    `${service}/xrpc/com.atproto.server.createSession`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    },
    { label: 'bluesky createSession', breakerKey: `bluesky:${handle}`, timeoutRetriable: true },
  )
  const sess = (await res.json()) as { did?: string }
  if (!sess.did) throw new Error('bluesky createSession: no did returned')
  return { did: sess.did }
}

async function handlerForConnection(db: Db, conn: SocialConnectionDoc): Promise<ChannelHandler> {
  if (conn.channel === 'bluesky') {
    const appPassword = await decryptEnveloped(db, conn.credentials['app_password'])
    if (!appPassword) throw new Error('bluesky connection: no app password stored')
    return blueskyHandler(conn.handle, appPassword, conn.service, 'connection')
  }
  // The OAuth connect stores the user-context token on the social_connections
  // row (mirroring Bluesky's app_password) — the connector_credentials doc is
  // the display/registry row, not the publish credential.
  if (conn.channel === 'x') {
    const accessToken = await decryptEnveloped(db, conn.credentials['access_token'])
    if (!accessToken) throw new Error('x connection: no user token stored')
    return xHandler(accessToken, 'connection', conn.handle)
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
      account: `@${c.handle}`,
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
        account: this.accountLabel(channel, cred.extra),
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
  /** Bare account label for preview/audit — the handle, page name or URN
   *  the post will go out under, without the channel-name prefix. */
  private accountLabel(channel: string, extra: Record<string, string> | undefined): string {
    const display = extra?.['page_name'] ?? extra?.['name']
    if (display) return display
    const handle = extra?.['username'] ?? extra?.['ig_username']
    if (handle) return handle.startsWith('@') ? handle : `@${handle}`
    return connectorLabel(channel, extra)
  }

  private async publishViaConnector(
    args: CreatePostArgs,
  ): Promise<{ external_id?: string; url?: string; account: string } | null> {
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
    const account = this.accountLabel(args.channel, cred.extra)

    // X posts via the dedicated handler — the executor's decryptIfNeeded
    // can't read dek: envelope ciphertext (it passes ciphertext through as
    // the Bearer token, which X rejects as "application-only"), so the token
    // is decrypted here like LinkedIn/Threads below.
    if (args.channel === 'x') {
      let xToken = cred.access_token
        ? await decryptEnveloped(this.db, cred.access_token)
        : undefined
      // Expired OAuth token? Refresh it before publishing — without this a
      // lapsed access token throws a bare network error on every post and
      // the rotated refresh token is never persisted back to the credential.
      const expiresAt = cred.token_expires_at ? new Date(cred.token_expires_at).getTime() : null
      if (xToken && expiresAt !== null && expiresAt <= Date.now()) {
        const cid = process.env['X_CLIENT_ID']
        const csec = process.env['X_CLIENT_SECRET']
        const refreshToken = cred.refresh_token
          ? await decryptEnveloped(this.db, cred.refresh_token)
          : undefined
        if (cid && csec && refreshToken) {
          const r = await fetch('https://api.x.com/2/oauth2/token', {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${cid}:${csec}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
          })
          if (r.ok) {
            const d = (await r.json()) as {
              access_token?: string
              refresh_token?: string
              expires_in?: number
            }
            if (d.access_token) {
              xToken = d.access_token
              const $set: Record<string, unknown> = {
                access_token: encryptIfNeeded(d.access_token),
                updated_at: new Date(),
              }
              if (d.refresh_token) $set['refresh_token'] = encryptIfNeeded(d.refresh_token)
              if (d.expires_in)
                $set['token_expires_at'] = new Date(Date.now() + d.expires_in * 1000)
              await this.connectorCreds.updateOne(
                { tenant_id: args.tenantId, connector_id: 'twitter_x' },
                { $set },
              )
            }
          }
        }
      }
      if (!xToken) throw new Error('x: stored credential has no access token')
      let result
      try {
        result = await xHandler(xToken, 'connection', account).publish(args.content, {
          ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
        })
      } catch (err) {
        // A 403 on a user-context write means the grant lacks the scope —
        // the fix is a reconnect, not a retry.
        // Only the permission-shaped 403 ("not permitted to perform this
        // action" = token lacks write scope) maps to a reconnect — real
        // failures like duplicate content must surface as-is.
        if (err instanceof Error && /not permitted to perform this action/i.test(err.message)) {
          throw new Error(
            'x publish rejected — the stored token keeps its original scopes; disconnect and reconnect X',
          )
        }
        throw err
      }
      return { ...result, account }
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
      return { external_id: id, url: id ? `https://facebook.com/${id}` : undefined, account }
    }

    // LinkedIn/Threads/Instagram: dedicated handlers — their contracts are
    // nested bodies or container→publish two-steps the generic executor
    // can't express. Token decrypt is explicit and stays inside this call.
    const token = cred.access_token ? await decryptEnveloped(this.db, cred.access_token) : undefined
    if (!token) throw new Error(`${args.channel}: stored credential has no access token`)
    const ctx = { ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}) }
    if (args.channel === 'linkedin') {
      const urn = cred.extra?.['author_urn']
      if (!urn) throw new Error('linkedin: no member URN stored — reconnect LinkedIn')
      return { ...(await linkedinHandler(token, urn).publish(args.content, ctx)), account }
    }
    if (args.channel === 'threads') {
      const userId = cred.extra?.['user_id']
      if (!userId) throw new Error('threads: no user id stored — reconnect Threads')
      return { ...(await threadsHandler(token, userId).publish(args.content, ctx)), account }
    }
    if (args.channel === 'instagram') {
      const igUserId = cred.extra?.['ig_user_id']
      if (!igUserId) throw new Error('instagram: no business account linked — reconnect Instagram')
      if (!args.mediaUrl) {
        throw new Error('instagram: an image is required — set the media URL on the post')
      }
      return {
        ...(await instagramHandler(token, igUserId, args.mediaUrl).publish(args.content, ctx)),
        account,
      }
    }
    return null
  }

  async createPost(args: CreatePostArgs): Promise<PublishResult> {
    const wanted = parseIntegrationId(args.integrationId)
    // The id's channel part must match the dispatch channel — an
    // 'x:connection' post must never go out over a bluesky credential.
    if (wanted.channel && wanted.channel !== args.channel) {
      throw new Error(`channel_not_configured:${args.channel}`)
    }
    const ctx = { ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}) }

    if (wanted.source !== 'env') {
      const connectorResult = await this.publishViaConnector(args)
      if (connectorResult) {
        return {
          external_id: connectorResult.external_id,
          url: connectorResult.url,
          publisher: {
            integration_id: `${args.channel}:connection`,
            channel: args.channel,
            source: 'connection',
            account: connectorResult.account,
          },
        }
      }
      const conn = args.tenantId
        ? await this.connections.findOne({ tenant_id: args.tenantId, channel: args.channel })
        : null
      if (conn) {
        try {
          const result = await (
            await handlerForConnection(this.db, conn)
          ).publish(args.content, ctx)
          await this.connections.updateOne(
            { tenant_id: conn.tenant_id, channel: conn.channel },
            { $set: { status: 'active', last_error: null, last_used_at: new Date() } },
          )
          return {
            ...result,
            publisher: {
              integration_id: `${args.channel}:connection`,
              channel: args.channel,
              source: 'connection',
              account: `@${conn.handle}`,
            },
          }
        } catch (err) {
          await this.connections.updateOne(
            { tenant_id: conn.tenant_id, channel: conn.channel },
            { $set: { status: 'error', last_error: String(err).slice(0, 300) } },
          )
          throw err
        }
      }
      // An explicit ':connection' id never falls through to the env account —
      // the operator approved THIS account, and silently posting as the
      // platform instead is the ambiguity this binding exists to kill.
      if (wanted.source === 'connection') {
        throw new Error(`channel_not_configured:${args.channel}`)
      }
    }
    if (this.env) return this.env.createPost(args)
    throw new Error(`channel_not_configured:${args.channel}`)
  }
}
