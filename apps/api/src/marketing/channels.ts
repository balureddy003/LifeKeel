/**
 * One answer to "which social channels can we post to, and are they healthy?"
 *
 * Credentials live in two stores: Bluesky app passwords in `social_connections`,
 * and the OAuth channels (X, LinkedIn, Facebook, Instagram, Threads) in
 * `connector_credentials`. Planning used to read only the first, so five of six
 * platforms never received a draft. Everything that plans, drafts or reports
 * connection state now goes through here.
 *
 * Nothing here returns a credential. Environment presence is reported as a
 * boolean only.
 */
import type { Db } from 'mongodb'
import { CONNECTOR_CHANNELS } from './social-publisher.js'
import { VERSION_ERROR_PREFIX } from './linkedin-version.js'

/** A check older than this says nothing about now. */
const CHECK_FRESH_MS = 3 * 86_400_000

export const SOCIAL_CHANNELS = [
  'bluesky',
  'linkedin',
  'x',
  'threads',
  'instagram',
  'facebook',
] as const
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number]

export type ChannelStatus =
  | 'connected'
  | 'expiring_soon'
  /** Connected, but a recent post or the daily check failed for a reason we can name. */
  | 'degraded'
  | 'needs_reauth'
  | 'error'
  | 'not_configured'

/** Channels whose OAuth token has no refresh token, so it simply expires. */
const NO_REFRESH: ReadonlySet<string> = new Set(['linkedin'])
export const EXPIRY_WARN_DAYS = 7

export interface ChannelInfo {
  channel: string
  source: 'social_connections' | 'oauth'
  handle: string
  status: Exclude<ChannelStatus, 'not_configured'>
  /** Safe to draft for and publish to right now. */
  usable: boolean
  expires_at: Date | null
  last_error: string | null
  updated_at: Date | null
}

const isUsable = (s: ChannelInfo['status']) =>
  s === 'connected' || s === 'expiring_soon' || s === 'degraded'

/** Every connection this tenant has, from both credential stores. */
export async function listChannels(
  db: Db,
  tenantId: string,
  now = new Date(),
): Promise<ChannelInfo[]> {
  const [conns, creds] = await Promise.all([
    db.collection('social_connections').find({ tenant_id: tenantId }).toArray(),
    db
      .collection('connector_credentials')
      .find({ tenant_id: tenantId, connector_id: { $in: Object.values(CONNECTOR_CHANNELS) } })
      .toArray(),
  ])
  const channelByConnector = new Map(Object.entries(CONNECTOR_CHANNELS).map(([ch, c]) => [c, ch]))
  const out: ChannelInfo[] = []

  for (const c of conns) {
    const status = c['status'] === 'active' ? 'connected' : 'error'
    out.push({
      channel: c['channel'] as string,
      source: 'social_connections',
      handle: (c['handle'] as string) ?? '',
      status,
      usable: isUsable(status),
      expires_at: null,
      last_error: (c['last_error'] as string | null | undefined) ?? null,
      updated_at: (c['updated_at'] as Date | undefined) ?? null,
    })
  }

  for (const cred of creds) {
    const channel =
      channelByConnector.get(cred['connector_id'] as string) ?? String(cred['connector_id'])
    const extra = cred['extra'] as Record<string, string> | undefined
    const expiresAt = (cred['token_expires_at'] as Date | undefined) ?? null
    let status: ChannelInfo['status'] = 'connected'
    let lastError: string | null = null
    if (cred['needs_reauth'] === true) {
      status = 'needs_reauth'
      lastError = `${channel} token expired — reconnect`
    } else if (NO_REFRESH.has(channel) && expiresAt) {
      if (expiresAt.getTime() <= now.getTime()) {
        status = 'needs_reauth'
        lastError = `${channel} token expired — reconnect`
      } else if (expiresAt.getTime() - now.getTime() <= EXPIRY_WARN_DAYS * 86_400_000) {
        status = 'expiring_soon'
      }
    }
    out.push({
      channel,
      source: 'oauth',
      handle:
        extra?.['username'] ??
        extra?.['page_name'] ??
        extra?.['name'] ??
        extra?.['ig_username'] ??
        '',
      status,
      usable: isUsable(status),
      expires_at: NO_REFRESH.has(channel) ? expiresAt : null,
      last_error: lastError,
      updated_at: (cred['updated_at'] as Date | undefined) ?? null,
    })
  }
  await overlayRecentProblems(db, tenantId, out, now)
  return out
}

/**
 * Connected is not the same as working. Two things we can observe without a human:
 *   - the latest approved post on a channel failed with an API-version rejection
 *     (and nothing has been published there since);
 *   - the daily read-only check of the channel's API failed recently.
 * Either turns a healthy channel into `degraded` with the reason, so it shows up in
 * Connections and Mission Control instead of failing silently at post time.
 */
async function overlayRecentProblems(
  db: Db,
  tenantId: string,
  infos: ChannelInfo[],
  now: Date,
): Promise<void> {
  const healthy = infos.filter((i) => i.status === 'connected' || i.status === 'expiring_soon')
  if (healthy.length === 0) return
  const since = new Date(now.getTime() - CHECK_FRESH_MS)
  const [versionFailures, checks] = await Promise.all([
    db
      .collection('marketing_posts')
      .find(
        {
          tenant_id: tenantId,
          state: 'publish_failed',
          publish_error: { $regex: `^${VERSION_ERROR_PREFIX}` },
          approved_at: { $gte: new Date(now.getTime() - 14 * 86_400_000) },
        },
        { projection: { _id: 0, channel: 1, publish_error: 1, approved_at: 1 } },
      )
      .sort({ approved_at: -1 })
      .limit(50)
      .toArray(),
    db
      .collection('channel_checks')
      .find({ tenant_id: tenantId, ok: false, checked_at: { $gte: since } })
      .toArray(),
  ])
  for (const info of healthy) {
    const failure = versionFailures.find((f) => f['channel'] === info.channel)
    if (failure) {
      const laterOk = await db.collection('marketing_posts').findOne({
        tenant_id: tenantId,
        channel: info.channel,
        state: 'published',
        dry_run: { $ne: true },
        published_at: { $gt: failure['approved_at'] as Date },
      })
      if (!laterOk) {
        info.status = 'degraded'
        info.last_error = String(failure['publish_error'])
        continue
      }
    }
    const check = checks.find((c) => c['channel'] === info.channel)
    if (check) {
      info.status = 'degraded'
      info.last_error = `Daily check failed: ${String(check['error'] ?? 'unknown error')} (posting may still work)`
    }
  }
}

/** The channels planning and drafting may use, plus the ones skipped and why. */
export async function plannableChannels(
  db: Db,
  tenantId: string,
  now = new Date(),
): Promise<{ channels: string[]; skipped: { channel: string; status: string; reason: string }[] }> {
  const all = await listChannels(db, tenantId, now)
  const seen = new Set<string>()
  const channels: string[] = []
  const skipped: { channel: string; status: string; reason: string }[] = []
  for (const c of all) {
    if (c.usable) {
      if (!seen.has(c.channel)) {
        seen.add(c.channel)
        channels.push(c.channel)
      }
    } else {
      skipped.push({ channel: c.channel, status: c.status, reason: c.last_error ?? c.status })
    }
  }
  // A channel that also has a healthy connection is not "skipped".
  return { channels, skipped: skipped.filter((s) => !seen.has(s.channel)) }
}

// ── Health + setup guidance ──────────────────────────────────────────────

interface PlatformSetup {
  label: string
  connector: string | null
  /** Env vars that must hold the developer-app credentials; any one pair suffices. */
  env: string[][]
  portal: string
  steps: string[]
  note?: string
}

export const PLATFORM_SETUP: Record<SocialChannel, PlatformSetup> = {
  bluesky: {
    label: 'Bluesky',
    connector: null,
    env: [],
    portal: 'https://bsky.app/settings/app-passwords',
    steps: [
      'In Bluesky go to Settings → Privacy and security → App passwords and create one named "LifeKeel".',
      'In this console choose Connect a channel → Bluesky, enter your handle and the app password.',
    ],
    note: 'No developer app or review needed. Use an app password, never your account password.',
  },
  x: {
    label: 'X',
    connector: 'twitter_x',
    env: [['X_CLIENT_ID', 'X_CLIENT_SECRET']],
    portal: 'https://developer.x.com/en/portal/dashboard',
    steps: [
      'Create a project and app in the X developer portal; enable OAuth 2.0 with read and write permissions.',
      'Add the redirect URI below as a callback URL.',
      'Put the client ID and secret in X_CLIENT_ID and X_CLIENT_SECRET, then use Connect a channel → X.',
    ],
    note: 'Check the current X API plan: posting needs a plan that allows writes, and limits are tight.',
  },
  linkedin: {
    label: 'LinkedIn',
    connector: 'linkedin',
    env: [['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET']],
    portal: 'https://www.linkedin.com/developers/apps',
    steps: [
      'Create a LinkedIn app; add the "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" products.',
      'Add the redirect URI below under Auth → Authorized redirect URLs.',
      'Put the client ID and secret in LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET, then Connect a channel → LinkedIn.',
    ],
    note: 'Posts as the connecting member. The token lasts about 60 days and cannot refresh — reconnect when warned.',
  },
  facebook: {
    label: 'Facebook Page',
    connector: 'facebook_pages',
    env: [['META_CLIENT_ID', 'META_CLIENT_SECRET']],
    portal: 'https://developers.facebook.com/apps',
    steps: [
      'Create a Meta app (Business type) and add Facebook Login.',
      'Add the redirect URI below under Valid OAuth Redirect URIs.',
      'Put the app ID and secret in META_CLIENT_ID and META_CLIENT_SECRET, then Connect a channel → Facebook Page.',
    ],
    note: 'The account must manage a Facebook Page. Only the first Page it manages is used.',
  },
  instagram: {
    label: 'Instagram',
    connector: 'instagram_business',
    env: [['META_CLIENT_ID', 'META_CLIENT_SECRET']],
    portal: 'https://developers.facebook.com/apps',
    steps: [
      'Use the same Meta app as Facebook; add the Instagram product and the redirect URI below.',
      'The Instagram account must be a Business or Creator account linked to your Facebook Page.',
      'Then Connect a channel → Instagram Business.',
    ],
    note: 'Instagram cannot post text only: every post needs an image URL before it can be approved.',
  },
  threads: {
    label: 'Threads',
    connector: 'threads',
    env: [
      ['THREADS_CLIENT_ID', 'THREADS_CLIENT_SECRET'],
      ['META_CLIENT_ID', 'META_CLIENT_SECRET'],
    ],
    portal: 'https://developers.facebook.com/apps',
    steps: [
      'In the Meta app add the Threads API use case and the redirect URI below.',
      'Put the credentials in THREADS_CLIENT_ID / THREADS_CLIENT_SECRET (or reuse META_CLIENT_*).',
      'Then Connect a channel → Threads.',
    ],
    note: 'Tokens refresh automatically for about 60 days of use.',
  },
}

export interface ChannelHealth {
  channel: SocialChannel
  label: string
  status: ChannelStatus
  usable: boolean
  handle: string | null
  expires_at: string | null
  last_publish_at: string | null
  last_error: string | null
  /** Developer-app credentials present in this deployment (booleans only). */
  app_credentials: boolean
  setup: {
    portal: string
    steps: string[]
    redirect_uri: string | null
    env: string[]
    note?: string
  }
}

/** Are the developer-app credentials for this platform set? Booleans only — never the values. */
export function appCredentialsPresent(
  channel: SocialChannel,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const sets = PLATFORM_SETUP[channel].env
  if (sets.length === 0) return true
  return sets.some((pair) => pair.every((k) => Boolean(env[k])))
}

export async function channelHealth(
  db: Db,
  tenantId: string,
  opts: { env?: NodeJS.ProcessEnv; now?: Date } = {},
): Promise<ChannelHealth[]> {
  const env = opts.env ?? process.env
  const now = opts.now ?? new Date()
  const base = env['API_BASE_URL'] ?? 'http://localhost:3001'
  const [infos, lastPosts] = await Promise.all([
    listChannels(db, tenantId, now),
    db
      .collection('marketing_posts')
      .aggregate<{ _id: string; at: Date }>([
        {
          $match: {
            tenant_id: tenantId,
            state: 'published',
            dry_run: { $ne: true },
            published_at: { $exists: true },
          },
        },
        { $group: { _id: '$channel', at: { $max: '$published_at' } } },
      ])
      .toArray(),
  ])
  const lastPublish = new Map(lastPosts.map((p) => [p._id, p.at]))
  return SOCIAL_CHANNELS.map((channel) => {
    const setup = PLATFORM_SETUP[channel]
    const matching = infos.filter((i) => i.channel === channel)
    // A healthy connection wins over a stale one for the same channel.
    const info = matching.find((i) => i.usable) ?? matching[0]
    const status: ChannelStatus = info ? info.status : 'not_configured'
    return {
      channel,
      label: setup.label,
      status,
      usable: info?.usable ?? false,
      handle: info?.handle || null,
      expires_at: info?.expires_at ? info.expires_at.toISOString() : null,
      last_publish_at: lastPublish.get(channel)?.toISOString() ?? null,
      last_error: info?.last_error ?? null,
      app_credentials: appCredentialsPresent(channel, env),
      setup: {
        portal: setup.portal,
        steps: setup.steps,
        redirect_uri: setup.connector
          ? `${base}/connectors/${setup.connector}/oauth/callback`
          : null,
        env: setup.env.flat(),
        ...(setup.note ? { note: setup.note } : {}),
      },
    }
  })
}

/** Channels whose API cannot post without an image. */
export const IMAGE_REQUIRED_CHANNELS: ReadonlySet<string> = new Set(['instagram'])

/** True when a post can never publish as it stands because it has no image. */
export function missingImage(post: { channel: string; media_url?: string | null }): boolean {
  return IMAGE_REQUIRED_CHANNELS.has(post.channel) && !post.media_url
}

/**
 * Every (tenant, channel) pair that is healthy right now, across both credential
 * stores. Used by the autopilot rules that look at all tenants.
 */
export async function allUsableChannels(
  db: Db,
  now = new Date(),
): Promise<{ tenant_id: string; channel: string }[]> {
  const [a, b] = await Promise.all([
    db.collection('social_connections').distinct('tenant_id'),
    db
      .collection('connector_credentials')
      .distinct('tenant_id', { connector_id: { $in: Object.values(CONNECTOR_CHANNELS) } }),
  ])
  const tenants = [...new Set([...a, ...b].map(String))]
  const out: { tenant_id: string; channel: string }[] = []
  for (const tenant_id of tenants) {
    for (const channel of (await plannableChannels(db, tenant_id, now)).channels)
      out.push({ tenant_id, channel })
  }
  return out
}

export interface ChannelIssue extends ChannelInfo {
  tenant_id: string
}

/**
 * Connections that need a person: dead tokens, errors, and tokens about to
 * expire (the ones that cannot refresh themselves). Across every tenant.
 */
export async function channelIssues(db: Db, now = new Date()): Promise<ChannelIssue[]> {
  const [a, b] = await Promise.all([
    db.collection('social_connections').distinct('tenant_id'),
    db
      .collection('connector_credentials')
      .distinct('tenant_id', { connector_id: { $in: Object.values(CONNECTOR_CHANNELS) } }),
  ])
  const out: ChannelIssue[] = []
  for (const tenant_id of [...new Set([...a, ...b].map(String))]) {
    const infos = await listChannels(db, tenant_id, now)
    for (const info of infos) {
      const healthyTwin = infos.some((i) => i.channel === info.channel && i.status === 'connected')
      if (info.status !== 'connected' && !healthyTwin) out.push({ ...info, tenant_id })
    }
  }
  return out
}
