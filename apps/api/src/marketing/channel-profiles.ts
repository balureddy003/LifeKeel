/**
 * Channel profiles (PRD-210, phase 2): the desired state of LifeKeel's profile on each network
 * (name, handle, bio, link), a read-back of what is actually there, the drift between them, and an
 * approved update where the network's API allows one.
 *
 * Accounts are created by a person, never here. Reading is public and free of credentials (Bluesky);
 * writing is Tier 2 and only ever happens through the approve route in routes/marketing-profiles.ts,
 * against the exact text that was approved.
 */
import { createHash } from 'node:crypto'
import type { Db } from 'mongodb'
import { providerFetch } from '../provider-gateway.js'
import { decryptEnveloped } from '../crypto/envelope.js'
import type { SocialConnectionDoc } from './social-publisher.js'
import { checkCopy, type CopyCheck } from './copy-guard.js'

export const PROFILE_CHANNELS = [
  'linkedin',
  'bluesky',
  'instagram',
  'facebook',
  'threads',
  'x',
] as const
export type ProfileChannel = (typeof PROFILE_CHANNELS)[number]

export interface DesiredProfile {
  display_name: string
  handle: string
  /** The short text under the name: bio, intro or tagline, per network. */
  bio: string
  link: string
}

export interface ProfileDoc {
  tenant_id: string
  channel: ProfileChannel
  desired: DesiredProfile
  /** Manual setup steps the person ticks off. */
  checklist: Record<string, boolean>
  actual?: {
    display_name: string
    bio: string
    /** null = this network's API does not say; drift never reports an unknown. */
    has_avatar: boolean | null
    has_banner: boolean | null
    checked_at: Date
  }
  drift: ProfileDrift[]
  applied_at?: Date
  applied_by?: string
  updated_by: string
  updated_at: Date
}

export interface ProfileDrift {
  field: 'display_name' | 'bio' | 'avatar' | 'banner'
  desired: string
  actual: string
}

/** Character limits for the bio-like field on each network. */
export const BIO_LIMIT: Record<ProfileChannel, number> = {
  linkedin: 120, // tagline
  bluesky: 256,
  instagram: 150,
  facebook: 255,
  threads: 150,
  x: 160,
}

/** Networks whose API lets the console read the live profile, and write it after approval. */
export const SUPPORTS_CHECK: ReadonlySet<ProfileChannel> = new Set([
  'bluesky',
  'x',
  'facebook',
  'instagram',
  'threads',
])
export const SUPPORTS_APPLY: ReadonlySet<ProfileChannel> = new Set(['bluesky'])

const COMMON_STEPS = [
  'account_created',
  'two_factor_app',
  'avatar_set',
  'banner_set',
  'bio_set',
  'link_set',
]
export const CHECKLIST_ITEMS: Record<ProfileChannel, string[]> = {
  linkedin: [...COMMON_STEPS, 'two_admins', 'website_verified'],
  bluesky: [...COMMON_STEPS, 'domain_handle'],
  instagram: [...COMMON_STEPS, 'linked_to_facebook_page', 'professional_account'],
  facebook: [...COMMON_STEPS, 'two_admins', 'website_verified'],
  threads: [...COMMON_STEPS],
  x: [...COMMON_STEPS],
}

const SITE = 'https://lifekeel.co.uk'
const link = (network: string) =>
  `${SITE}/?utm_source=${network}&utm_medium=social&utm_campaign=profile`

/** Starting text, from docs/marketing/social-presence-kit.md. Edited in the console after that. */
export const DEFAULT_PROFILES: Record<ProfileChannel, DesiredProfile> = {
  linkedin: {
    display_name: 'LifeKeel',
    handle: 'lifekeel',
    bio: "One home for your family's savings, cover and papers. Free to start.",
    link: link('linkedin'),
  },
  bluesky: {
    display_name: 'LifeKeel',
    handle: 'lifekeel.co.uk',
    bio: "Your family's chart, kept current. Savings, cover and papers in one place, and the steps if something happens. Free to start. Informational only, not financial advice. lifekeel.co.uk",
    link: link('bluesky'),
  },
  instagram: {
    display_name: 'LifeKeel',
    handle: 'lifekeel',
    bio: "Your family's chart, kept current. Savings, cover & papers in one place. Free to start. Info only, not financial advice.",
    link: link('instagram'),
  },
  facebook: {
    display_name: 'LifeKeel',
    handle: 'lifekeel',
    bio: "LifeKeel keeps your family's chart: what you hold on file, what looks missing and the steps if something happens. Free to start. Informational only, not financial advice.",
    link: link('facebook'),
  },
  threads: {
    display_name: 'LifeKeel',
    handle: 'lifekeel',
    bio: "Your family's chart, kept current. Savings, cover & papers in one place. Free to start. Info only, not financial advice.",
    link: link('threads'),
  },
  x: {
    display_name: 'LifeKeel',
    handle: 'lifekeel',
    bio: "Your family's chart, kept current. Savings, cover and papers in one place. Free to start. Informational only, not financial advice.",
    link: link('x'),
  },
}

export function isProfileChannel(v: string): v is ProfileChannel {
  return (PROFILE_CHANNELS as readonly string[]).includes(v)
}

/** Problems with the desired text: over the network's limit, or failing the copy guard. */
export function validateDesired(
  channel: ProfileChannel,
  d: DesiredProfile,
): { ok: boolean; problems: string[]; copy: CopyCheck } {
  const problems: string[] = []
  if (!d.display_name.trim()) problems.push('display name is empty')
  if (d.bio.length > BIO_LIMIT[channel])
    problems.push(`bio is ${d.bio.length} characters; ${channel} allows ${BIO_LIMIT[channel]}`)
  const copy = checkCopy(`${d.display_name}\n${d.bio}`, 'social')
  for (const v of copy.violations) problems.push(`copy guard: ${v.rule} ("${v.match}")`)
  return { ok: problems.length === 0, problems, copy }
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** What differs between the desired text and what the network shows. Avatar and banner are
 *  presence-only: the console cannot compare pictures, only notice a missing one. */
export function computeDrift(
  desired: DesiredProfile,
  actual: NonNullable<ProfileDoc['actual']>,
  channel?: ProfileChannel,
): ProfileDrift[] {
  // X rewrites links in a bio into t.co short links, so a link can never match
  // what was typed; compare the wording around it instead.
  const cmp = (t: string) => (channel === 'x' ? norm(t.replace(/https?:\/\/\S+/g, '')) : norm(t))
  const out: ProfileDrift[] = []
  if (norm(desired.display_name) !== norm(actual.display_name))
    out.push({ field: 'display_name', desired: desired.display_name, actual: actual.display_name })
  if (cmp(desired.bio) !== cmp(actual.bio))
    out.push({ field: 'bio', desired: desired.bio, actual: actual.bio })
  // Only a definite "no" counts: null means the network's API cannot tell us.
  if (actual.has_avatar === false)
    out.push({ field: 'avatar', desired: 'a profile picture', actual: 'none' })
  if (actual.has_banner === false)
    out.push({ field: 'banner', desired: 'a banner image', actual: 'none' })
  return out
}

/** A hash of the exact text an approver is shown; apply refuses if the text changed since. */
export function desiredHash(d: DesiredProfile): string {
  return createHash('sha256')
    .update(JSON.stringify([d.display_name, d.bio]))
    .digest('hex')
    .slice(0, 16)
}

const BSKY_PUBLIC = 'https://public.api.bsky.app'

/** Read a Bluesky profile without credentials. Throws if the account is not found. */
export async function readBlueskyProfile(
  handle: string,
): Promise<NonNullable<ProfileDoc['actual']>> {
  const res = await providerFetch(
    `${BSKY_PUBLIC}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`,
    { method: 'GET' },
    { label: 'bluesky getProfile', breakerKey: 'bluesky:public' },
  )
  const p = (await res.json()) as {
    displayName?: string
    description?: string
    avatar?: string
    banner?: string
  }
  return {
    display_name: p.displayName ?? '',
    bio: p.description ?? '',
    has_avatar: Boolean(p.avatar),
    has_banner: Boolean(p.banner),
    checked_at: new Date(),
  }
}

/** Write display name and bio to Bluesky, keeping the avatar and banner already on the record.
 *  Only called from the approve route. */
export async function applyBlueskyProfile(
  db: Db,
  conn: SocialConnectionDoc,
  d: DesiredProfile,
): Promise<void> {
  const service = conn.service ?? 'https://bsky.social'
  const appPassword = await decryptEnveloped(db, conn.credentials['app_password'])
  if (!appPassword) throw new Error('bluesky connection: no app password stored')
  const sessRes = await providerFetch(
    `${service}/xrpc/com.atproto.server.createSession`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: conn.handle, password: appPassword }),
    },
    {
      label: 'bluesky createSession',
      breakerKey: `bluesky:${conn.handle}`,
      timeoutRetriable: true,
    },
  )
  const sess = (await sessRes.json()) as { accessJwt?: string; did?: string }
  if (!sess.accessJwt || !sess.did) throw new Error('bluesky createSession: no session returned')
  const auth = { Authorization: `Bearer ${sess.accessJwt}`, 'Content-Type': 'application/json' }

  let existing: Record<string, unknown> = {}
  let swapRecord: string | undefined
  try {
    const got = await providerFetch(
      `${service}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(sess.did)}&collection=app.bsky.actor.profile&rkey=self`,
      { method: 'GET', headers: auth },
      { label: 'bluesky getRecord', breakerKey: `bluesky:${conn.handle}` },
    )
    const body = (await got.json()) as { value?: Record<string, unknown>; cid?: string }
    existing = body.value ?? {}
    swapRecord = body.cid
  } catch {
    // No profile record yet: create one.
  }

  await providerFetch(
    `${service}/xrpc/com.atproto.repo.putRecord`,
    {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        repo: sess.did,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
        ...(swapRecord ? { swapRecord } : {}),
        record: {
          ...existing,
          $type: 'app.bsky.actor.profile',
          displayName: d.display_name,
          description: d.bio,
        },
      }),
    },
    { label: 'bluesky putRecord', breakerKey: `bluesky:${conn.handle}` },
  )
}

type Actual = NonNullable<ProfileDoc['actual']>

/** A function that runs one read-only connector action for a tenant. */
export type ConnectorRead = (
  tenantId: string,
  connectorId: string,
  actionId: string,
  params: Record<string, unknown>,
) => Promise<{ ok: boolean; status: number; body: unknown }>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Read the live profile on X, Facebook, Instagram or Threads through the
 * tenant's OAuth connection. Read-only: nothing here can change a profile.
 * Throws with a plain reason when the channel is not connected or the read fails.
 */
export async function readConnectorProfile(
  db: Db,
  tenantId: string,
  channel: ProfileChannel,
  read: ConnectorRead,
): Promise<Actual> {
  const connectorId = (
    {
      x: 'twitter_x',
      facebook: 'facebook_pages',
      instagram: 'instagram_business',
      threads: 'threads',
    } as Record<string, string>
  )[channel]
  if (!connectorId) throw new Error(`${channel} profile cannot be read by the console`)
  const cred = await db
    .collection('connector_credentials')
    .findOne({ tenant_id: tenantId, connector_id: connectorId })
  if (!cred) throw new Error(`${channel} is not connected`)
  if (cred['needs_reauth'] === true)
    throw new Error(`${channel} token expired — reconnect it first`)
  const extra = (cred['extra'] ?? {}) as Record<string, string>

  const params: Record<string, unknown> = {}
  let actionId: string
  if (channel === 'x') actionId = 'getUsersMe'
  else if (channel === 'facebook') {
    actionId = 'get_profile'
    if (!extra['page_id']) throw new Error('facebook connection has no Page id — reconnect it')
    params['page_id'] = extra['page_id']
  } else if (channel === 'instagram') {
    actionId = 'get_profile'
    if (!extra['ig_user_id'])
      throw new Error('instagram connection has no account id — reconnect it')
    params['ig_user_id'] = extra['ig_user_id']
  } else actionId = 'get_profile'

  const res = await read(tenantId, connectorId, actionId, params)
  if (!res.ok) throw new Error(`${channel} profile read failed (HTTP ${res.status})`)
  const body = (res.body ?? {}) as Record<string, unknown>
  const now = new Date()

  if (channel === 'x') {
    const d = (body['data'] ?? {}) as Record<string, unknown>
    return {
      display_name: str(d['name']),
      bio: str(d['description']),
      // X's stock avatar URL contains "default_profile_images".
      has_avatar:
        Boolean(str(d['profile_image_url'])) &&
        !/default_profile/.test(str(d['profile_image_url'])),
      has_banner: null,
      checked_at: now,
    }
  }
  if (channel === 'facebook') {
    const picture = ((body['picture'] as Record<string, unknown> | undefined)?.['data'] ??
      {}) as Record<string, unknown>
    return {
      display_name: str(body['name']),
      bio: str(body['about']),
      has_avatar: picture['is_silhouette'] === undefined ? null : picture['is_silhouette'] !== true,
      has_banner: Boolean(body['cover']),
      checked_at: now,
    }
  }
  if (channel === 'instagram') {
    return {
      display_name: str(body['name']) || str(body['username']),
      bio: str(body['biography']),
      has_avatar: Boolean(str(body['profile_picture_url'])),
      has_banner: null,
      checked_at: now,
    }
  }
  return {
    display_name: str(body['name']) || str(body['username']),
    bio: str(body['threads_biography']),
    has_avatar: Boolean(str(body['threads_profile_picture_url'])),
    has_banner: null,
    checked_at: now,
  }
}
