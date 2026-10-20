/**
 * Segment campaigns — one-shot, operator-drafted email to a filtered cohort.
 * This is the "growth tool" half of the lifecycle engine: where sequences
 * are automatic and timing-driven, campaigns are explicit — a human writes
 * the copy, previews the audience, and fires the send. The send button IS
 * the approval gate (audited, marketing.manage), matching the trust model:
 * no autonomy for externally-facing communication at scale.
 *
 * Rails shared with lifecycle-emails.ts:
 *   - recipients claimed in lifecycle_sends (sequence 'campaign') BEFORE
 *     send — a campaign is one-shot (status sent) so a re-send 409s, and
 *     the ledger dedup guards against racing double-clicks anyway.
 *   - users: status active + email_opt_out != true; every campaign email
 *     carries a List-Unsubscribe header + footer link to /users/unsubscribe.
 *   - leads: consent.marketing + !suppressed, with /leads/unsubscribe.
 *   - platform_config.marketing_paused halts sends entirely.
 *
 * Body is operator-authored plain text; blank lines split paragraphs and
 * {{first_name}} interpolates. Copy obligations (informational only, no
 * regulated advice) sit on the operator — same bar as social posts.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { createLogger } from '@lifekeel/platform'
import { getPlatformConfig } from '../operator/platform-config.js'
import { getGrowthEventsCollection } from '../db.js'
import {
  lifecycleSendsCol,
  ensureLifecycleIndexes,
  claimSend,
  settleSend,
  sendEmail,
  wrap,
  cta,
  unsubscribeToken,
  userUnsubUrl,
} from './lifecycle-emails.js'
import { excludeMinorUsers } from '../family/family-permissions.js'
import { recordSpend, spendCost } from '../spend-ledger.js'
import { queueManager } from '../queue/QueueManager.js'
import { checkCopy, describeViolations } from './copy-guard.js'

const log = createLogger({ service: 'campaigns', version: '0.0.0' })
const DAY = 24 * 60 * 60 * 1000
/** Hard ceiling per send — runaway filters can't turn one click into a
 *  mail-bombing incident. Raise deliberately, not by accident. */
const MAX_RECIPIENTS = 2000

export interface CampaignAudience {
  /** Which sides of the signup boundary to include. */
  audience: 'users' | 'leads' | 'both'
  /** users: plan tiers to include ('free'/'starter'/...); default all. */
  plans?: string[]
  /** users: true = only active trials, false = exclude them. */
  trialing?: boolean
  /** users: limit to tenants that do/don't have a family profile. */
  has_profile?: boolean
  /** leads: lifecycle stages to include; default ['new','contacted']. */
  lead_stages?: string[]
  /** both: first-touch utm_source allowlist. */
  utm_sources?: string[]
  /** both: created_at within the last N days. */
  created_within_days?: number
  /** both: created_at at least N days ago. */
  min_age_days?: number
}

export interface CampaignDoc {
  id: string
  name: string
  subject: string
  body_text: string
  cta_url?: string
  cta_label?: string
  filter: CampaignAudience
  status: 'draft' | 'sending' | 'paused' | 'sent'
  created_by: string
  created_at: Date
  sent_at?: Date
  stats?: {
    targeted: number
    sent: number
    skipped: number
    failed: number
    /** recipients whose claim row has reached a terminal state */
    settled: number
  }
}

export function campaignsCol(db: Db) {
  return db.collection<CampaignDoc>('campaigns')
}

export function ensureCampaignIndexes(db: Db): void {
  campaignsCol(db)
    .createIndex({ id: 1 }, { unique: true })
    .catch(() => {})
  campaignsCol(db)
    .createIndex({ status: 1, created_at: -1 })
    .catch(() => {})
}

interface Recipient {
  kind: 'user' | 'lead'
  id: string
  email: string
  firstName: string
}

function createdWindow(filter: CampaignAudience, now: number): Record<string, Date> | undefined {
  const w: Record<string, Date> = {}
  if (filter.created_within_days) w['$gte'] = new Date(now - filter.created_within_days * DAY)
  if (filter.min_age_days) w['$lte'] = new Date(now - filter.min_age_days * DAY)
  return Object.keys(w).length > 0 ? w : undefined
}

async function resolveUsers(db: Db, filter: CampaignAudience, now: number): Promise<Recipient[]> {
  const q: Record<string, unknown> = { status: 'active', email_opt_out: { $ne: true } }
  const win = createdWindow(filter, now)
  if (win) q['created_at'] = win
  // Intent 09: a member whose roster entry is 'child' or under 18 never
  // receives campaign mail, whatever consent flags the account carries.
  const users = await excludeMinorUsers(
    db,
    await db
      .collection('users')
      .find(q, { projection: { _id: 0, id: 1, email: 1, name: 1, tenant_id: 1, attribution: 1 } })
      .limit(MAX_RECIPIENTS)
      .toArray(),
  )
  let list = users
  if (filter.utm_sources?.length) {
    const allowed = new Set(filter.utm_sources)
    list = list.filter((u) =>
      allowed.has(
        String((u['attribution'] as Record<string, unknown> | undefined)?.['utm_source'] ?? ''),
      ),
    )
  }

  const needsTenants = !!(
    filter.plans?.length ||
    filter.trialing !== undefined ||
    filter.has_profile !== undefined
  )
  if (needsTenants && list.length > 0) {
    const tids = [...new Set(list.map((u) => u['tenant_id'] as string))]
    const tq: Record<string, unknown> = { tenant_id: { $in: tids } }
    if (filter.plans?.length) tq['plan'] = { $in: filter.plans }
    if (filter.trialing === true) tq['billing.trial_ends_at'] = { $gt: new Date() }
    if (filter.trialing === false) tq['billing.trial_ends_at'] = { $not: { $gt: new Date() } }
    const tenants = await db
      .collection('tenants')
      .find(tq, { projection: { _id: 0, tenant_id: 1 } })
      .toArray()
    const ok = new Set(tenants.map((t) => t['tenant_id'] as string))
    list = list.filter((u) => ok.has(u['tenant_id'] as string))

    if (filter.has_profile !== undefined && list.length > 0) {
      const remaining = [...new Set(list.map((u) => u['tenant_id'] as string))]
      const profiled = new Set(
        (
          await db
            .collection('family_financial_profile')
            .find({ tenant_id: { $in: remaining } }, { projection: { _id: 0, tenant_id: 1 } })
            .toArray()
        ).map((p) => p['tenant_id'] as string),
      )
      list = list.filter((u) => profiled.has(u['tenant_id'] as string) === filter.has_profile)
    }
  }
  return list.map((u) => ({
    kind: 'user' as const,
    id: u['id'] as string,
    email: u['email'] as string,
    firstName: String(u['name'] ?? 'there').split(' ')[0] || 'there',
  }))
}

async function resolveLeads(db: Db, filter: CampaignAudience, now: number): Promise<Recipient[]> {
  const q: Record<string, unknown> = {
    'consent.marketing': true,
    suppressed: { $ne: true },
    stage: { $in: filter.lead_stages?.length ? filter.lead_stages : ['new', 'contacted'] },
  }
  const win = createdWindow(filter, now)
  if (win) q['created_at'] = win
  if (filter.utm_sources?.length) q['attribution.utm_source'] = { $in: filter.utm_sources }
  const leads = await db
    .collection('leads')
    .find(q, { projection: { _id: 0, id: 1, email: 1, name: 1 } })
    .limit(MAX_RECIPIENTS)
    .toArray()
  return leads.map((l) => ({
    kind: 'lead' as const,
    id: l['id'] as string,
    email: l['email'] as string,
    firstName: String(l['name'] ?? 'there').split(' ')[0] || 'there',
  }))
}

export async function resolveAudience(db: Db, filter: CampaignAudience): Promise<Recipient[]> {
  const now = Date.now()
  const out: Recipient[] = []
  if (filter.audience === 'users' || filter.audience === 'both')
    out.push(...(await resolveUsers(db, filter, now)))
  if (filter.audience === 'leads' || filter.audience === 'both')
    out.push(...(await resolveLeads(db, filter, now)))
  return out.slice(0, MAX_RECIPIENTS)
}

/** Render the campaign body: paragraphs on blank lines, {{first_name}}
 *  interpolation, minimal escaping (the operator writes copy, not HTML). */
function renderBody(campaign: CampaignDoc, r: Recipient, appUrl: string): string {
  const escaped = campaign.body_text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{{first_name}}', r.firstName)
  const paras = escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replaceAll('\n', '<br>')}</p>`)
    .join('\n')
  const unsub =
    r.kind === 'lead'
      ? `${appUrl}/leads/unsubscribe?id=${encodeURIComponent(r.id)}&sig=${unsubscribeToken(r.id)}`
      : userUnsubUrl(appUrl, r.id)
  const ctaHtml =
    campaign.cta_url && campaign.cta_label ? cta(campaign.cta_url, campaign.cta_label) : ''
  return wrap(`${paras}\n${ctaHtml}`, unsub)
}

// ── Durable per-recipient send (B11) ──────────────────────────────────────
// A campaign send is no longer one synchronous loop over up to 2,000
// recipients: queueCampaignSend writes a claimed `pending` ledger row per
// recipient and enqueues a payload-by-reference job; runCampaignSendJob is
// the queue consumer that settles one row. Pause flips campaign.status so
// workers drop in-flight jobs; resume re-enqueues the still-pending keys.
// The claim rows double as the per-recipient durable state — a crash loses
// nothing that was already claimed.

export const CAMPAIGN_SEND_QUEUE = 'campaign-send'

export interface CampaignSendJob {
  campaign_id: string
  /** lifecycle_sends claim key — the durable per-recipient row */
  key: string
}

/** Claim + enqueue every resolved recipient. Throws before any claims when
 *  the platform is paused or the provider is unconfigured, so the route's
 *  draft rollback leaves nothing half-queued. Idempotent under re-run:
 *  already-claimed keys are skipped by claimSend and re-enqueued. */
export async function queueCampaignSend(
  db: Db,
  campaign: CampaignDoc,
): Promise<{ targeted: number }> {
  // Copy guard (PRD-210): subject and body must pass before anything is claimed or sent.
  const copy = checkCopy(`${campaign.subject}\n${campaign.body_text}`, 'email')
  if (!copy.ok) {
    throw Object.assign(new Error(`copy_guard_failed: ${describeViolations(copy)}`), { statusCode: 422 })
  }
  ensureCampaignIndexes(db)
  await ensureLifecycleIndexes(db) // the ledger's unique key index is the dedup lock
  if ((await getPlatformConfig(db)).marketing_paused) {
    throw Object.assign(new Error('marketing_paused is set — campaign sends are halted'), {
      statusCode: 409,
    })
  }
  // Provider unconfigured → refuse before any claims: the route rolls the
  // campaign back to draft, nothing is recorded as sent, and a configured
  // retry loses nothing.
  if (!process.env['SENDGRID_API_KEY']) {
    throw Object.assign(
      new Error('SENDGRID_API_KEY is not configured — campaign sends are halted'),
      { statusCode: 503 },
    )
  }
  const recipients = await resolveAudience(db, campaign.filter)
  await campaignsCol(db).updateOne(
    { id: campaign.id },
    {
      $set: { stats: { targeted: recipients.length, sent: 0, skipped: 0, failed: 0, settled: 0 } },
    },
  )
  for (const r of recipients) {
    const key = `campaign:${campaign.id}:${r.id}`
    const row = await claimSend(db, {
      id: randomUUID(),
      key,
      sequence: 'campaign',
      step: campaign.name.slice(0, 80),
      campaign_id: campaign.id,
      recipient: r.id,
      email: r.email,
      recipient_kind: r.kind,
      recipient_name: r.firstName,
      created_at: new Date(),
    })
    if (!row) continue // already mailed by a prior/racing send, or attempts spent
    // Payload-by-reference: the durable state is the claim row, the job is
    // just a pointer. A dropped job still leaves a re-enqueueable claim.
    await queueManager.publish(CAMPAIGN_SEND_QUEUE, {
      campaign_id: campaign.id,
      key,
    } satisfies CampaignSendJob)
  }
  return { targeted: recipients.length }
}

/** Queue consumer — settles one recipient claim. Idempotent: at-least-once
 *  delivery is the queue's contract, so a re-delivered job finds the row
 *  settled and returns. */
export async function runCampaignSendJob(db: Db, job: CampaignSendJob): Promise<void> {
  const campaign = await campaignsCol(db).findOne({ id: job.campaign_id })
  if (!campaign || campaign.status !== 'sending') {
    return // paused/cancelled — resume re-enqueues the pending keys
  }
  const row = await lifecycleSendsCol(db).findOne({ key: job.key })
  if (!row || row.status !== 'pending') return // settled or superseded

  const recipient: Recipient = {
    kind: (row.recipient_kind ?? 'user') as Recipient['kind'],
    id: row.recipient,
    email: row.email,
    firstName: row.recipient_name ?? '',
  }
  const appUrl = (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
  try {
    const unsub =
      recipient.kind === 'lead'
        ? `${appUrl}/leads/unsubscribe?id=${encodeURIComponent(recipient.id)}&sig=${unsubscribeToken(recipient.id)}`
        : userUnsubUrl(appUrl, recipient.id)
    const outcome = await sendEmail(
      recipient.email,
      campaign.subject,
      renderBody(campaign, recipient, appUrl),
      unsub,
      { lk: job.key },
    )
    await settleSend(
      db,
      job.key,
      outcome,
      outcome === 'skipped' ? 'sendgrid_not_configured' : undefined,
    )
    await campaignsCol(db).updateOne(
      { id: campaign.id },
      { $inc: { [`stats.${outcome}`]: 1, 'stats.settled': 1 } },
    )
    if (outcome === 'sent') {
      // Campaign mail is platform-paid spend; user recipients could carry
      // their tenant but leads can't — 'platform' is the honest bucket.
      void recordSpend(db, {
        tenant_id: 'platform',
        service: 'marketing',
        provider: 'sendgrid',
        unit: 'email',
        units: 1,
        cost_microdollars: spendCost('sendgrid', 'email'),
        meta: { campaign_id: campaign.id },
      }).catch(() => {})
    }
  } catch (err) {
    await settleSend(db, job.key, 'failed', String(err).slice(0, 300))
    await campaignsCol(db).updateOne(
      { id: campaign.id },
      { $inc: { 'stats.failed': 1, 'stats.settled': 1 } },
    )
    log.warn({ campaign: campaign.id, to: recipient.email, err }, 'campaign send failed')
  }

  // Completion: no pending claims left → terminal. Conditioned on the
  // 'sending' state so only the last-settling worker flips it.
  const pending = await lifecycleSendsCol(db).countDocuments({
    campaign_id: campaign.id,
    status: 'pending',
  })
  if (pending === 0) {
    const finished = await campaignsCol(db).updateOne(
      { id: campaign.id, status: 'sending' },
      { $set: { status: 'sent', sent_at: new Date() } },
    )
    if (finished.modifiedCount === 1) {
      const done = await campaignsCol(db).findOne({ id: campaign.id })
      await getGrowthEventsCollection(db).insertOne({
        event: 'campaign_sent',
        meta: { campaign_id: campaign.id, name: campaign.name, ...done?.['stats'] },
        created_at: new Date(),
      })
    }
  }
}

/** Pause a live send — workers see status != 'sending' and drop their jobs.
 *  Pending claims stay pending; resume re-enqueues them. */
export async function pauseCampaign(db: Db, campaignId: string): Promise<boolean> {
  const res = await campaignsCol(db).updateOne(
    { id: campaignId, status: 'sending' },
    { $set: { status: 'paused' } },
  )
  return res.modifiedCount === 1
}

/** Resume a paused send — re-enqueues every still-pending claim. Returns
 *  the re-enqueued count, or -1 when the campaign wasn't paused. */
export async function resumeCampaign(db: Db, campaignId: string): Promise<number> {
  const res = await campaignsCol(db).updateOne(
    { id: campaignId, status: 'paused' },
    { $set: { status: 'sending' } },
  )
  if (res.modifiedCount === 0) return -1
  const pending = await lifecycleSendsCol(db)
    .find({ campaign_id: campaignId, status: 'pending' }, { projection: { _id: 0, key: 1 } })
    .toArray()
  if (pending.length === 0) {
    // Paused after every claim settled — complete immediately rather than
    // sit 'sending' waiting on jobs that will never arrive.
    await campaignsCol(db).updateOne(
      { id: campaignId, status: 'sending' },
      { $set: { status: 'sent', sent_at: new Date() } },
    )
    return 0
  }
  for (const row of pending) {
    await queueManager.publish(CAMPAIGN_SEND_QUEUE, {
      campaign_id: campaignId,
      key: row['key'] as string,
    } satisfies CampaignSendJob)
  }
  return pending.length
}

/** Synchronously drain a campaign's pending claims — used by tests and by
 *  ops catch-up when a queue outage left claimed rows unprocessed. */
export async function drainCampaignSends(db: Db, campaignId: string): Promise<number> {
  const pending = await lifecycleSendsCol(db)
    .find({ campaign_id: campaignId, status: 'pending' }, { projection: { _id: 0, key: 1 } })
    .toArray()
  for (const row of pending) {
    await runCampaignSendJob(db, { campaign_id: campaignId, key: row['key'] as string })
  }
  return pending.length
}
