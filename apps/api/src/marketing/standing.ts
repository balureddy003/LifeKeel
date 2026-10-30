/**
 * Standing approvals (step 2): the scheduler and the circuit breakers.
 *
 * A human approved exact post texts into the bank (marketing/bank.ts) and set a policy: which networks, how
 * many posts, which hours, and until when. This module turns approved bank entries into scheduled posts
 * within that policy, on its own, and stops itself when something looks wrong. It never publishes: it only
 * inserts posts in state `approved`, carrying the approver of the bank entry, and the existing publish
 * path (publishDueMarketingPosts -> publishPost) sends them, still honouring `marketing_paused`,
 * `dry_run_mode` and the copy-guard recheck.
 *
 * The only part of a published text that varies from what the human approved is its tracking link: the
 * approved text holds LINK_TOKEN, and each scheduled post gets its own freshly tagged link there.
 *
 * Limits of what this can detect: it sees publish failures, unhealthy connections, expired approvals and
 * changed copy rules. It cannot see that a post is landing badly with readers. That is why every text is
 * human-approved first, caps are small, and revoking is immediate.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { getAuditLogger, type AuditAction } from '../audit/audit-log.js'
import { getPlatformConfig } from '../operator/platform-config.js'
import { checkCopy } from './copy-guard.js'
import { contentHash } from './content-plan.js'
import { IMAGE_REQUIRED_CHANNELS, plannableChannels } from './channels.js'
import { cardUrl } from './cards.js'
import { postFeatures, uniquePostTag } from './post-stats.js'
import { bankCollection, renderBankContent, type BankEntryDoc } from './bank.js'
import { siteLink, type MarketingPostDoc } from '../routes/marketing-posts.js'

export const POLICY_MAX_DAYS = 30
export const SCHEDULE_HORIZON_DAYS = 7
/** A post is only ever scheduled at least this far ahead, so a revoke or pause can still catch it. */
export const MIN_LEAD_MINUTES = 30
/** Consecutive publish failures on one network before it is paused. */
export const FAILURE_TRIP_COUNT = 2

/** The same limits the console shows. Rendered text, link included, must fit. */
export const CHANNEL_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  bluesky: 300,
  threads: 500,
  linkedin: 3000,
  instagram: 2200,
  facebook: 5000,
  mastodon: 500,
}

export interface PausedChannel {
  channel: string
  reason: string
  at: Date
}

export interface StandingPolicyDoc {
  tenant_id: string
  enabled: boolean
  enabled_by: string
  enabled_at: Date
  reason: string
  expires_at: Date
  channels: string[]
  max_per_channel_per_week: number
  max_per_channel_per_day: number
  min_gap_hours: number
  repeat_cooldown_days: number
  /** Europe/London hours a post may be scheduled at. */
  hours: number[]
  paused_channels: PausedChannel[]
  /** When an operator last resumed a paused channel; the failure breaker looks only at posts after it. */
  resumed_at: Record<string, Date>
  disabled_by?: string
  disabled_at?: Date
  disable_reason?: string
  last_run_at?: Date
}

export interface PolicyInput {
  reason: string
  expires_in_days: number
  channels: string[]
  max_per_channel_per_week?: number
  max_per_channel_per_day?: number
  min_gap_hours?: number
  repeat_cooldown_days?: number
  hours?: number[]
}

export const POLICY_DEFAULTS = {
  max_per_channel_per_week: 3,
  max_per_channel_per_day: 1,
  min_gap_hours: 24,
  repeat_cooldown_days: 45,
  hours: [9, 13, 17],
} as const

/** The earliest and latest London hour a post may be scheduled at. */
export const WINDOW_START_HOUR = 8
export const WINDOW_END_HOUR = 20

export function policyCollection(db: Db) {
  return db.collection<StandingPolicyDoc>('marketing_standing_policy')
}

export function ensurePolicyIndexes(db: Db): void {
  policyCollection(db)
    .createIndex({ tenant_id: 1 }, { unique: true })
    .catch(() => {})
  db.collection('marketing_posts')
    .createIndex({ tenant_id: 1, bank_entry_id: 1, scheduled_at: 1 })
    .catch(() => {})
}

// ── time helpers (Europe/London) ─────────────────────────────────────────────

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
})

export function londonParts(d: Date): { y: number; m: number; d: number; h: number } {
  const get = (t: string) => Number(LONDON.formatToParts(d).find((p) => p.type === t)?.value)
  const h = get('hour')
  return { y: get('year'), m: get('month'), d: get('day'), h: h === 24 ? 0 : h }
}

/** The UTC instant at which the London clock reads `h:00` on the given London date. */
export function londonToUtc(y: number, m: number, d: number, h: number): Date {
  const guess = Date.UTC(y, m - 1, d, h)
  const seen = londonParts(new Date(guess)).h
  return new Date(guess + (h - seen) * 3_600_000)
}

function dayKey(d: Date): string {
  const p = londonParts(d)
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** Monday 00:00 UTC of the week containing `d`; the unit the weekly cap counts in. */
export function weekStartUtc(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = (x.getUTCDay() + 6) % 7
  x.setUTCDate(x.getUTCDate() - dow)
  return x
}

// ── policy ───────────────────────────────────────────────────────────────────

function clamp(n: number | undefined, lo: number, hi: number, dflt: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? (n as number) : dflt))
}

/** Enable or renew the policy. The expiry is capped, so a standing approval always needs renewing. */
export async function enableStanding(
  db: Db,
  tenantId: string,
  userId: string,
  input: PolicyInput,
  now = new Date(),
): Promise<StandingPolicyDoc> {
  const days = clamp(input.expires_in_days, 1, POLICY_MAX_DAYS, POLICY_MAX_DAYS)
  const hours = [...new Set(input.hours ?? POLICY_DEFAULTS.hours)]
    .filter((h) => Number.isInteger(h) && h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR)
    .sort((a, b) => a - b)
  const col = policyCollection(db)
  const existing = await col.findOne({ tenant_id: tenantId })
  const doc: StandingPolicyDoc = {
    tenant_id: tenantId,
    enabled: true,
    enabled_by: userId,
    enabled_at: now,
    reason: input.reason,
    expires_at: new Date(now.getTime() + days * 86_400_000),
    channels: [...new Set(input.channels)],
    max_per_channel_per_week: clamp(
      input.max_per_channel_per_week,
      1,
      7,
      POLICY_DEFAULTS.max_per_channel_per_week,
    ),
    max_per_channel_per_day: clamp(
      input.max_per_channel_per_day,
      1,
      2,
      POLICY_DEFAULTS.max_per_channel_per_day,
    ),
    min_gap_hours: clamp(input.min_gap_hours, 1, 72, POLICY_DEFAULTS.min_gap_hours),
    repeat_cooldown_days: clamp(
      input.repeat_cooldown_days,
      7,
      180,
      POLICY_DEFAULTS.repeat_cooldown_days,
    ),
    hours: hours.length > 0 ? hours : [...POLICY_DEFAULTS.hours],
    paused_channels: existing?.paused_channels ?? [],
    resumed_at: existing?.resumed_at ?? {},
  }
  await col.replaceOne({ tenant_id: tenantId }, doc, { upsert: true })
  audit(tenantId, userId, 'marketing.standing_enable', tenantId, {
    expires_at: doc.expires_at.toISOString(),
    channels: doc.channels,
    reason: input.reason,
  })
  return doc
}

/** Revoke: stop scheduling and reject every standing post that has not been sent yet. */
export async function revokeStanding(
  db: Db,
  tenantId: string,
  userId: string,
  reason: string,
  now = new Date(),
): Promise<{ rejected: number }> {
  await policyCollection(db).updateOne(
    { tenant_id: tenantId },
    { $set: { enabled: false, disabled_by: userId, disabled_at: now, disable_reason: reason } },
  )
  const rejected = await rejectFuturePosts(
    db,
    { tenant_id: tenantId },
    'standing_revoked',
    userId,
    now,
  )
  audit(tenantId, userId, 'marketing.standing_disable', tenantId, { reason, rejected })
  return { rejected }
}

export async function resumeChannel(
  db: Db,
  tenantId: string,
  userId: string,
  channel: string,
  now = new Date(),
): Promise<boolean> {
  const res = await policyCollection(db).updateOne(
    { tenant_id: tenantId, 'paused_channels.channel': channel },
    { $pull: { paused_channels: { channel } }, $set: { [`resumed_at.${channel}`]: now } },
  )
  if (res.modifiedCount === 1) audit(tenantId, userId, 'marketing.standing_resume', channel, {})
  return res.modifiedCount === 1
}

async function rejectFuturePosts(
  db: Db,
  filter: { tenant_id: string; bank_entry_id?: string; channel?: string },
  reason: string,
  by: string,
  now: Date,
): Promise<number> {
  const res = await db.collection<MarketingPostDoc>('marketing_posts').updateMany(
    {
      ...filter,
      approved_via: 'standing',
      state: 'approved',
      scheduled_at: { $gt: now },
    },
    { $set: { state: 'rejected', rejected_by: by, rejected_at: now, publish_error: reason } },
  )
  return res.modifiedCount
}

// ── scheduler ────────────────────────────────────────────────────────────────

export interface ScheduleDeps {
  /** Builds a tagged link; defaults to the site's own builder. */
  linkFor?: (channel: string, path: string, tag: string, campaign: string) => string
}

export interface ScheduleResult {
  scheduled: number
  skipped_reason?: string
}

function sampleLink(entry: BankEntryDoc): string {
  return entry.link_path ? `https://lifekeel.co.uk${entry.link_path}?utm_content=p0000000` : ''
}

/** Why an approved entry cannot be used for a channel right now, or null when it can. */
export function entryBlock(entry: BankEntryDoc, channel: string, now: Date): string | null {
  if (entry.status !== 'approved') return 'not_approved'
  if (!entry.expires_at || entry.expires_at.getTime() <= now.getTime()) return 'approval_expired'
  if (!entry.approved_by) return 'no_approver'
  if (contentHash(entry.content) !== entry.content_hash) return 'hash_mismatch'
  if (!entry.channels.includes(channel)) return 'channel_not_approved'
  if (IMAGE_REQUIRED_CHANNELS.has(channel) && !entry.card && !entry.media_url)
    return 'image_required'
  const rendered = renderBankContent(entry.content, sampleLink(entry))
  if (!checkCopy(rendered, 'social').ok) return 'copy_guard_failed'
  const limit = CHANNEL_CHAR_LIMITS[channel]
  if (limit && rendered.length > limit) return 'too_long_for_channel'
  return null
}

const POST_STATES = ['approved', 'publishing', 'awaiting_manual', 'published'] as const

export async function scheduleStanding(
  db: Db,
  now = new Date(),
  deps: ScheduleDeps = {},
  onlyTenant?: string,
): Promise<ScheduleResult> {
  if ((await getPlatformConfig(db)).marketing_paused)
    return { scheduled: 0, skipped_reason: 'marketing_paused' }
  const policies = await policyCollection(db)
    .find({
      enabled: true,
      expires_at: { $gt: now },
      ...(onlyTenant ? { tenant_id: onlyTenant } : {}),
    })
    .toArray()
  let scheduled = 0
  for (const policy of policies) scheduled += await scheduleTenant(db, policy, now, deps)
  return { scheduled }
}

async function scheduleTenant(
  db: Db,
  policy: StandingPolicyDoc,
  now: Date,
  deps: ScheduleDeps,
): Promise<number> {
  const posts = db.collection<MarketingPostDoc>('marketing_posts')
  const bank = bankCollection(db)
  const linkFor = deps.linkFor ?? siteLink
  const tenantId = policy.tenant_id
  const healthy = new Set((await plannableChannels(db, tenantId, now)).channels)
  const paused = new Set(policy.paused_channels.map((p) => p.channel))
  const channels = policy.channels.filter((c) => healthy.has(c) && !paused.has(c))
  if (channels.length === 0) return 0

  const entries = await bank
    .find({ tenant_id: tenantId, status: 'approved', expires_at: { $gt: now } })
    .toArray()
  if (entries.length === 0) return 0

  const horizon = new Date(
    Math.min(now.getTime() + SCHEDULE_HORIZON_DAYS * 86_400_000, policy.expires_at.getTime()),
  )
  const earliest = new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000)
  const today = londonParts(now)
  let made = 0

  for (const channel of channels) {
    // Everything already on the calendar for this network, from any source, counts toward the caps.
    const existing = await posts
      .find({
        tenant_id: tenantId,
        channel,
        state: { $in: [...POST_STATES] },
        scheduled_at: {
          $gte: new Date(now.getTime() - 14 * 86_400_000),
          $lte: new Date(horizon.getTime() + 2 * 86_400_000),
        },
      })
      .toArray()
    const times = existing.map((p) => p.scheduled_at!.getTime()).sort((a, b) => a - b)
    const perDay = new Map<string, number>()
    const perWeek = new Map<number, number>()
    for (const t of times) {
      const d = new Date(t)
      perDay.set(dayKey(d), (perDay.get(dayKey(d)) ?? 0) + 1)
      perWeek.set(weekStartUtc(d).getTime(), (perWeek.get(weekStartUtc(d).getTime()) ?? 0) + 1)
    }
    let lastFormat: string | null = null

    for (let offset = 0; offset < SCHEDULE_HORIZON_DAYS; offset++) {
      const day = new Date(Date.UTC(today.y, today.m - 1, today.d + offset, 12))
      const p = londonParts(day)
      for (const hour of policy.hours) {
        const at = londonToUtc(p.y, p.m, p.d, hour)
        if (at < earliest || at > horizon) continue
        if ((perDay.get(dayKey(at)) ?? 0) >= policy.max_per_channel_per_day) continue
        if ((perWeek.get(weekStartUtc(at).getTime()) ?? 0) >= policy.max_per_channel_per_week)
          continue
        const gap = policy.min_gap_hours * 3_600_000
        if (times.some((t) => Math.abs(t - at.getTime()) < gap)) continue

        const entry = await pickEntry(db, entries, channel, policy, at, now, lastFormat)
        if (!entry) continue

        const id = randomUUID()
        const tag = await uniquePostTag(posts)
        const link = entry.link_path
          ? linkFor(channel, entry.link_path, tag, entry.campaign ?? 'lifekeel_social')
          : ''
        const content = renderBankContent(entry.content, link)
        let media_url = entry.media_url
        if (entry.card) {
          const url = cardUrl(id, entry.card)
          if (url) media_url = url
        }
        if (IMAGE_REQUIRED_CHANNELS.has(channel) && !media_url) continue
        await posts.insertOne({
          id,
          tenant_id: tenantId,
          channel,
          integration_id: `${channel}:connection`,
          content,
          campaign: entry.campaign ?? 'lifekeel_social',
          scheduled_at: at,
          state: 'approved',
          // The human who approved this exact text, when they did. Never the scheduler.
          approved_by: entry.approved_by!,
          approved_at: entry.approved_at!,
          approved_via: 'standing',
          bank_entry_id: entry.id,
          generated: 'template',
          copy_check: checkCopy(content, 'social'),
          pillar: entry.pillar ?? undefined,
          brief_id: entry.brief_id ?? undefined,
          post_tag: tag,
          features: postFeatures({
            channel,
            content,
            pillar: entry.pillar ?? null,
            scheduled_at: at,
            format: entry.format ?? null,
            hook: entry.hook ?? null,
            media_url,
          }),
          ...(entry.card ? { card: entry.card } : {}),
          ...(entry.alt_text ? { alt_text: entry.alt_text } : {}),
          ...(media_url ? { media_url } : {}),
          created_by: 'standing-scheduler',
          created_at: now,
        } as MarketingPostDoc)
        await bank.updateOne(
          { id: entry.id },
          { $inc: { times_scheduled: 1 }, $set: { last_scheduled_at: at } },
        )
        entry.times_scheduled += 1
        entry.last_scheduled_at = at
        times.push(at.getTime())
        perDay.set(dayKey(at), (perDay.get(dayKey(at)) ?? 0) + 1)
        perWeek.set(weekStartUtc(at).getTime(), (perWeek.get(weekStartUtc(at).getTime()) ?? 0) + 1)
        lastFormat = entry.format ?? null
        made++
        audit(tenantId, entry.approved_by!, 'marketing.standing_schedule', id, {
          bank_entry_id: entry.id,
          channel,
          scheduled_at: at.toISOString(),
        })
      }
    }
  }
  await policyCollection(db).updateOne({ tenant_id: tenantId }, { $set: { last_run_at: now } })
  return made
}

/** Least-used usable entry that was not on this network within the cooldown; varies the format. */
async function pickEntry(
  db: Db,
  entries: BankEntryDoc[],
  channel: string,
  policy: StandingPolicyDoc,
  at: Date,
  now: Date,
  lastFormat: string | null,
): Promise<BankEntryDoc | null> {
  const usable = entries.filter((e) => entryBlock(e, channel, now) === null)
  if (usable.length === 0) return null
  const cooldownStart = new Date(at.getTime() - policy.repeat_cooldown_days * 86_400_000)
  const cooldownEnd = new Date(at.getTime() + policy.repeat_cooldown_days * 86_400_000)
  const recent = await db
    .collection<MarketingPostDoc>('marketing_posts')
    .find({
      tenant_id: policy.tenant_id,
      channel,
      bank_entry_id: { $in: usable.map((e) => e.id) },
      state: { $in: [...POST_STATES] },
      scheduled_at: { $gte: cooldownStart, $lte: cooldownEnd },
    })
    .toArray()
  const blocked = new Set(recent.map((p) => p.bank_entry_id))
  const free = usable.filter((e) => !blocked.has(e.id))
  if (free.length === 0) return null
  free.sort((a, b) => {
    const sameA = a.format && a.format === lastFormat ? 1 : 0
    const sameB = b.format && b.format === lastFormat ? 1 : 0
    return (
      sameA - sameB ||
      a.times_scheduled - b.times_scheduled ||
      (a.last_scheduled_at?.getTime() ?? 0) - (b.last_scheduled_at?.getTime() ?? 0)
    )
  })
  return free[0]!
}

// ── circuit breakers ─────────────────────────────────────────────────────────

export interface BreakerResult {
  channels_paused: string[]
  entries_retired: number
  posts_rejected: number
}

export async function runBreakers(
  db: Db,
  now = new Date(),
  onlyTenant?: string,
): Promise<BreakerResult> {
  const result: BreakerResult = { channels_paused: [], entries_retired: 0, posts_rejected: 0 }
  const policies = await policyCollection(db)
    .find({ enabled: true, ...(onlyTenant ? { tenant_id: onlyTenant } : {}) })
    .toArray()
  const posts = db.collection<MarketingPostDoc>('marketing_posts')
  const bank = bankCollection(db)

  for (const policy of policies) {
    const tenantId = policy.tenant_id
    // 1. Two publish failures in a row on one network: pause that network, not the others.
    for (const channel of policy.channels) {
      if (policy.paused_channels.some((p) => p.channel === channel)) continue
      const since = policy.resumed_at?.[channel] ?? new Date(0)
      const last = await posts
        .find({
          tenant_id: tenantId,
          channel,
          approved_via: 'standing',
          state: { $in: ['published', 'publish_failed'] },
          scheduled_at: { $lte: now, $gt: since },
        })
        .sort({ scheduled_at: -1 })
        .limit(FAILURE_TRIP_COUNT)
        .toArray()
      const recent = last[0]?.scheduled_at
      if (
        last.length === FAILURE_TRIP_COUNT &&
        last.every((p) => p.state === 'publish_failed') &&
        recent &&
        now.getTime() - recent.getTime() <= 7 * 86_400_000
      ) {
        const reason = `${FAILURE_TRIP_COUNT} publish failures in a row`
        await policyCollection(db).updateOne(
          { tenant_id: tenantId },
          { $push: { paused_channels: { channel, reason, at: now } } },
        )
        result.channels_paused.push(`${tenantId}:${channel}`)
        // A paused network must not keep sending what was already queued for it: those posts would
        // most likely fail the same way. They are rejected, and the bank entries become schedulable
        // again once an operator resumes the network.
        result.posts_rejected += await rejectFuturePosts(
          db,
          { tenant_id: tenantId, channel },
          'channel_paused',
          'system:standing',
          now,
        )
        audit(tenantId, 'system:standing', 'marketing.standing_breaker', channel, { reason })
      }
    }
    // 2. Approvals that have expired, or whose text no longer passes the current rules, are retired,
    //    and anything still waiting to go out from them is rejected.
    const approved = await bank.find({ tenant_id: tenantId, status: 'approved' }).toArray()
    for (const entry of approved) {
      let why: string | null = null
      if (!entry.expires_at || entry.expires_at.getTime() <= now.getTime()) why = 'approval_expired'
      else if (!checkCopy(renderBankContent(entry.content, sampleLink(entry)), 'social').ok)
        why = 'copy_rules_changed'
      if (!why) continue
      await bank.updateOne(
        { id: entry.id, status: 'approved' },
        {
          $set: {
            status: 'retired',
            retired_by: 'system:standing',
            retired_at: now,
            retired_reason: why,
          },
        },
      )
      result.entries_retired++
      result.posts_rejected += await rejectFuturePosts(
        db,
        { tenant_id: tenantId, bank_entry_id: entry.id },
        why,
        'system:standing',
        now,
      )
      audit(tenantId, 'system:standing', 'marketing.standing_breaker', entry.id, { reason: why })
    }
  }
  return result
}

// ── status (read by the routes and Mission Control) ─────────────────────────

export interface StandingStatus {
  policy: StandingPolicyDoc | null
  active: boolean
  bank: { candidate: number; approved: number; retired: number }
  /** Posts the bank could still supply, as weeks at the policy's pace. */
  weeks_of_posts_left: number | null
  upcoming: { id: string; channel: string; scheduled_at: Date; bank_entry_id?: string }[]
}

export async function standingStatus(
  db: Db,
  tenantId: string,
  now = new Date(),
): Promise<StandingStatus> {
  const policy = await policyCollection(db).findOne({ tenant_id: tenantId })
  const counts = { candidate: 0, approved: 0, retired: 0 }
  for (const g of await bankCollection(db)
    .aggregate<{ _id: keyof typeof counts; n: number }>([
      { $match: { tenant_id: tenantId } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ])
    .toArray())
    counts[g._id] = g.n
  const usable = await bankCollection(db)
    .find({ tenant_id: tenantId, status: 'approved', expires_at: { $gt: now } })
    .toArray()
  const active = Boolean(policy?.enabled && policy.expires_at.getTime() > now.getTime())
  // Weeks the bank can keep the pace before a text must repeat on a network: the thinnest network decides.
  const weeksLeft =
    policy && policy.channels.length > 0
      ? Math.min(
          ...policy.channels.map(
            (c) =>
              usable.filter((e) => entryBlock(e, c, now) === null).length /
              policy.max_per_channel_per_week,
          ),
        )
      : null
  const upcoming = await db
    .collection<MarketingPostDoc>('marketing_posts')
    .find({
      tenant_id: tenantId,
      approved_via: 'standing',
      state: 'approved',
      scheduled_at: { $gt: now },
    })
    .sort({ scheduled_at: 1 })
    .limit(30)
    .toArray()
  return {
    policy,
    active,
    bank: counts,
    weeks_of_posts_left: weeksLeft === null ? null : Math.round(weeksLeft * 10) / 10,
    upcoming: upcoming.map((p) => ({
      id: p.id,
      channel: p.channel,
      scheduled_at: p.scheduled_at!,
      ...(p.bank_entry_id ? { bank_entry_id: p.bank_entry_id } : {}),
    })),
  }
}

// ── attention items (read by Mission Control) ──────────────────────────────

export const BANK_LOW_WEEKS = 2
export const EXPIRING_SOON_DAYS = 5

export type StandingIssueKind =
  'bank_low' | 'expiring' | 'expired' | 'channel_paused' | 'candidates_waiting'

export interface StandingIssue {
  tenant_id: string
  kind: StandingIssueKind
  channel?: string
  detail: string
  at: Date
  count?: number
}

/** Things a person should look at for tenants that have used standing approvals. */
export async function standingIssues(db: Db, now = new Date()): Promise<StandingIssue[]> {
  const out: StandingIssue[] = []
  for (const policy of await policyCollection(db).find({}).toArray()) {
    const tenantId = policy.tenant_id
    const live = policy.enabled && policy.expires_at.getTime() > now.getTime()
    const candidates = await bankCollection(db).countDocuments({
      tenant_id: tenantId,
      status: 'candidate',
    })
    if (candidates > 0)
      out.push({
        tenant_id: tenantId,
        kind: 'candidates_waiting',
        detail: `${candidates} drafted post${candidates === 1 ? ' is' : 's are'} waiting for your approval`,
        at: now,
        count: candidates,
      })
    if (policy.enabled && !live)
      out.push({
        tenant_id: tenantId,
        kind: 'expired',
        detail: 'The standing approval has expired, so nothing new is being scheduled.',
        at: policy.expires_at,
      })
    if (!live) continue
    const daysLeft = (policy.expires_at.getTime() - now.getTime()) / 86_400_000
    if (daysLeft <= EXPIRING_SOON_DAYS)
      out.push({
        tenant_id: tenantId,
        kind: 'expiring',
        detail: `The standing approval ends in ${Math.max(0, Math.ceil(daysLeft))} day${Math.ceil(daysLeft) === 1 ? '' : 's'}; renew it to keep posting.`,
        at: policy.expires_at,
      })
    for (const p of policy.paused_channels)
      out.push({
        tenant_id: tenantId,
        kind: 'channel_paused',
        channel: p.channel,
        detail: `${p.channel} was paused: ${p.reason}.`,
        at: p.at,
      })
    const status = await standingStatus(db, tenantId, now)
    if (status.weeks_of_posts_left !== null && status.weeks_of_posts_left < BANK_LOW_WEEKS)
      out.push({
        tenant_id: tenantId,
        kind: 'bank_low',
        detail: `The bank can keep the pace for about ${status.weeks_of_posts_left} weeks before a text repeats.`,
        at: now,
      })
  }
  return out
}

function audit(
  tenantId: string,
  userId: string,
  action: AuditAction,
  resourceId: string,
  metadata: Record<string, unknown>,
): void {
  getAuditLogger()?.log({
    tenant_id: tenantId,
    user_id: userId,
    action,
    resource_type: 'marketing_standing',
    resource_id: resourceId,
    metadata,
    ip: '',
    user_agent: 'standing-scheduler',
    timestamp: new Date(),
  })
}
