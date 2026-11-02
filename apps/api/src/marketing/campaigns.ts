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
 *   - consent, account status, minor status and the global pause are
 *     checked again by the worker immediately before each send.
 *   - users: status active + email_opt_out != true; every campaign email
 *     carries a List-Unsubscribe header + footer link to /users/unsubscribe.
 *   - leads: consent.marketing + !suppressed, with /leads/unsubscribe.
 *   - platform_config.marketing_paused halts sends entirely, including
 *     jobs already queued (the campaign is paused, resumable later).
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
  MAX_SEND_ATTEMPTS,
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
import { activeEmailProvider, emailConfigured } from '../email/transport.js'
import { escapeHtml } from '../email/layout.js'

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
  /** false while recipients are still being claimed; completion waits for true. */
  audience_materialized?: boolean
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
    .replaceAll('{{first_name}}', escapeHtml(r.firstName))
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
  return wrap(`${paras}\n${ctaHtml}`, unsub, campaign.subject)
}

// ── Durable per-recipient send (B11) ──────────────────────────────────────
// A campaign send is not one synchronous loop over up to 2,000 recipients:
// queueCampaignSend writes a claimed `pending` ledger row per recipient and
// enqueues a payload-by-reference job; runCampaignSendJob is the queue
// consumer that settles one row. The claim rows are the durable state.
//
// Ordering rules (review F06–F08):
//  - Every claim row is written before any job is published, and the
//    campaign records `audience_materialized: true` in between. Completion
//    requires that flag, so a fast worker can never finish the campaign
//    while recipients are still being added. An empty audience completes
//    straight away.
//  - A worker takes a row with an atomic pending → sending update. Only the
//    holder of that claim may call the provider or settle the row, so two
//    deliveries of one job (or a resume during a slow send) send once.
//  - Immediately before calling the provider the worker re-checks the
//    global marketing pause and the recipient's current eligibility.
//  - A row stuck in 'sending' past SEND_CLAIM_STALE_MS means a worker died
//    mid-send: the provider may or may not have accepted it. It is settled
//    'failed' with attempts spent — recorded, never blindly re-sent.

export const CAMPAIGN_SEND_QUEUE = 'campaign-send'
/** A provider call that has not settled after this long is treated as lost. */
const SEND_CLAIM_STALE_MS = 10 * 60 * 1000

export interface CampaignSendJob {
  campaign_id: string
  /** lifecycle_sends claim key — the durable per-recipient row */
  key: string
}

/** Claim + enqueue every resolved recipient. Throws before any claims when
 *  the platform is paused or the provider is unconfigured, so the route's
 *  draft rollback leaves nothing half-queued. Idempotent under re-run:
 *  rows a previous run left pending are re-enqueued; settled rows are not. */
export async function queueCampaignSend(
  db: Db,
  campaign: CampaignDoc,
): Promise<{ targeted: number }> {
  // Copy guard (PRD-210): subject and body must pass before anything is claimed or sent.
  const copy = checkCopy(`${campaign.subject}\n${campaign.body_text}`, 'email')
  if (!copy.ok) {
    throw Object.assign(new Error(`copy_guard_failed: ${describeViolations(copy)}`), {
      statusCode: 422,
    })
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
  if (!emailConfigured()) {
    throw Object.assign(
      new Error(
        'No email provider configured (RESEND_API_KEY or SENDGRID_API_KEY) — campaign sends are halted',
      ),
      { statusCode: 503 },
    )
  }
  return materializeAndEnqueue(db, campaign)
}

/** Phase 1 claims every recipient, phase 2 marks the audience complete,
 *  phase 3 publishes. Re-runnable from any interruption point. */
async function materializeAndEnqueue(db: Db, campaign: CampaignDoc): Promise<{ targeted: number }> {
  const recipients = await resolveAudience(db, campaign.filter)
  // A resumed run keeps the counts already settled; only a first run starts them.
  const current = await campaignsCol(db).findOne({ id: campaign.id })
  await campaignsCol(db).updateOne(
    { id: campaign.id },
    {
      $set: {
        audience_materialized: false,
        ...(current?.stats
          ? { 'stats.targeted': recipients.length }
          : {
              stats: { targeted: recipients.length, sent: 0, skipped: 0, failed: 0, settled: 0 },
            }),
      },
    },
  )
  for (const r of recipients) {
    await claimSend(db, {
      id: randomUUID(),
      key: `campaign:${campaign.id}:${r.id}`,
      sequence: 'campaign',
      step: campaign.name.slice(0, 80),
      campaign_id: campaign.id,
      recipient: r.id,
      email: r.email,
      recipient_kind: r.kind,
      recipient_name: r.firstName,
      created_at: new Date(),
    })
  }
  await campaignsCol(db).updateOne({ id: campaign.id }, { $set: { audience_materialized: true } })
  await enqueuePending(db, campaign.id)
  await maybeCompleteCampaign(db, campaign.id)
  return { targeted: recipients.length }
}

async function enqueuePending(db: Db, campaignId: string): Promise<number> {
  const pending = await lifecycleSendsCol(db)
    .find({ campaign_id: campaignId, status: 'pending' }, { projection: { _id: 0, key: 1 } })
    .toArray()
  for (const row of pending) {
    // Payload-by-reference: the durable state is the claim row, the job is
    // just a pointer. A dropped job still leaves a re-enqueueable claim.
    await queueManager.publish(CAMPAIGN_SEND_QUEUE, {
      campaign_id: campaignId,
      key: row['key'] as string,
    } satisfies CampaignSendJob)
  }
  return pending.length
}

/** Settle rows whose worker died mid-send. Attempts are spent so no later
 *  claim re-sends a message the provider may already have accepted. */
async function settleStaleSends(db: Db, campaignId: string): Promise<void> {
  const stale = await lifecycleSendsCol(db)
    .find(
      {
        campaign_id: campaignId,
        status: 'sending',
        sending_at: { $lt: new Date(Date.now() - SEND_CLAIM_STALE_MS) },
      },
      { projection: { _id: 0, key: 1, claim_id: 1 } },
    )
    .toArray()
  for (const row of stale) {
    const res = await lifecycleSendsCol(db).updateOne(
      { key: row.key, status: 'sending', claim_id: row.claim_id },
      {
        $set: {
          status: 'failed',
          attempts: MAX_SEND_ATTEMPTS,
          error: 'provider outcome unknown: worker stopped mid-send; not re-sent',
          updated_at: new Date(),
        },
      },
    )
    if (res.modifiedCount === 1)
      await campaignsCol(db).updateOne(
        { id: campaignId },
        { $inc: { 'stats.failed': 1, 'stats.settled': 1 } },
      )
  }
}

/** sending → sent once the audience is fully materialized and no claim is
 *  pending or in flight. Conditional, so only one caller flips it. */
async function maybeCompleteCampaign(db: Db, campaignId: string): Promise<void> {
  await settleStaleSends(db, campaignId)
  const open = await lifecycleSendsCol(db).countDocuments({
    campaign_id: campaignId,
    status: { $in: ['pending', 'sending'] },
  })
  if (open > 0) return
  const finished = await campaignsCol(db).updateOne(
    // $ne false: a campaign queued before this flag existed has no barrier to
    // wait for; it completes on the old rule rather than never completing.
    { id: campaignId, status: 'sending', audience_materialized: { $ne: false } },
    { $set: { status: 'sent', sent_at: new Date() } },
  )
  if (finished.modifiedCount === 1) {
    const done = await campaignsCol(db).findOne({ id: campaignId })
    await getGrowthEventsCollection(db).insertOne({
      event: 'campaign_sent',
      meta: { campaign_id: campaignId, name: done?.name, ...done?.['stats'] },
      created_at: new Date(),
    })
  }
}

/** Why a recipient may no longer be mailed, or null when they still may.
 *  Mirrors resolveUsers/resolveLeads against the current records. */
async function ineligibleReason(db: Db, r: Recipient): Promise<string | null> {
  if (r.kind === 'lead') {
    const lead = await db
      .collection('leads')
      .findOne({ id: r.id }, { projection: { _id: 0, consent: 1, suppressed: 1 } })
    if (!lead) return 'lead_deleted'
    if (lead['suppressed'] === true) return 'lead_suppressed'
    if ((lead['consent'] as { marketing?: boolean } | undefined)?.marketing !== true)
      return 'lead_consent_withdrawn'
    return null
  }
  const user = await db
    .collection('users')
    .findOne(
      { id: r.id },
      { projection: { _id: 0, id: 1, tenant_id: 1, status: 1, email_opt_out: 1 } },
    )
  if (!user) return 'user_deleted'
  if (user['status'] !== 'active') return 'user_inactive'
  if (user['email_opt_out'] === true) return 'user_opted_out'
  if ((await excludeMinorUsers(db, [user])).length === 0) return 'user_is_minor'
  return null
}

/** Queue consumer — settles one recipient claim. Idempotent: at-least-once
 *  delivery is the queue's contract, so a re-delivered job finds the row
 *  claimed or settled and returns. */
export async function runCampaignSendJob(db: Db, job: CampaignSendJob): Promise<void> {
  const campaign = await campaignsCol(db).findOne({ id: job.campaign_id })
  if (!campaign || campaign.status !== 'sending') {
    return // paused/cancelled — resume re-enqueues the pending keys
  }
  if ((await getPlatformConfig(db)).marketing_paused) {
    // Global halt: pause the campaign rather than drop the job, so an
    // operator's resume re-enqueues everything still pending.
    await campaignsCol(db).updateOne(
      { id: campaign.id, status: 'sending' },
      { $set: { status: 'paused' } },
    )
    return
  }

  // Exclusive claim: only the worker that moves pending → sending proceeds.
  const claimId = randomUUID()
  const row = await lifecycleSendsCol(db).findOneAndUpdate(
    { key: job.key, status: 'pending' },
    { $set: { status: 'sending', sending_at: new Date(), claim_id: claimId } },
    { returnDocument: 'after' },
  )
  if (!row) {
    await maybeCompleteCampaign(db, campaign.id) // settled elsewhere, or a stale claim to reconcile
    return
  }

  /** Settle only our own claim; stats move only when the settle landed. */
  const settle = async (
    outcome: 'sent' | 'skipped' | 'failed',
    error?: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await lifecycleSendsCol(db).updateOne(
      { key: job.key, status: 'sending', claim_id: claimId },
      {
        $set: { status: outcome, updated_at: new Date(), ...(error ? { error } : {}), ...extra },
      },
    )
    if (res.modifiedCount === 1)
      await campaignsCol(db).updateOne(
        { id: campaign.id },
        { $inc: { [`stats.${outcome}`]: 1, 'stats.settled': 1 } },
      )
    return res.modifiedCount === 1
  }

  const recipient: Recipient = {
    kind: (row.recipient_kind ?? 'user') as Recipient['kind'],
    id: row.recipient,
    email: row.email,
    firstName: row.recipient_name ?? '',
  }
  const appUrl = (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
  try {
    // Last check before the provider: consent, deletion and age can all
    // change after the audience was resolved.
    const reason = await ineligibleReason(db, recipient)
    if (reason) {
      await settle('skipped', reason, { attempts: MAX_SEND_ATTEMPTS })
    } else {
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
      const settled = await settle(
        outcome,
        outcome === 'skipped' ? 'email_not_configured' : undefined,
      )
      if (settled && outcome === 'sent') {
        // Campaign mail is platform-paid spend; user recipients could carry
        // their tenant but leads can't — 'platform' is the honest bucket.
        const provider = activeEmailProvider() ?? 'sendgrid'
        void recordSpend(db, {
          tenant_id: 'platform',
          service: 'marketing',
          provider,
          unit: 'email',
          units: 1,
          cost_microdollars: spendCost(provider, 'email'),
          meta: { campaign_id: campaign.id },
        }).catch(() => {})
      }
    }
  } catch (err) {
    await settle('failed', String(err).slice(0, 300))
    log.warn({ campaign: campaign.id, to: recipient.email, err }, 'campaign send failed')
  }

  await maybeCompleteCampaign(db, campaign.id)
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

/** Resume a paused send — finishes an interrupted audience materialization
 *  if needed, then re-enqueues every still-pending claim. Returns the
 *  re-enqueued count, or -1 when the campaign wasn't paused. */
export async function resumeCampaign(db: Db, campaignId: string): Promise<number> {
  if ((await getPlatformConfig(db)).marketing_paused) {
    throw Object.assign(new Error('marketing_paused is set — campaign sends are halted'), {
      statusCode: 409,
    })
  }
  const campaign = await campaignsCol(db).findOneAndUpdate(
    { id: campaignId, status: 'paused' },
    { $set: { status: 'sending' } },
    { returnDocument: 'after' },
  )
  if (!campaign) return -1
  if (campaign.audience_materialized === false) {
    await materializeAndEnqueue(db, campaign)
    return lifecycleSendsCol(db).countDocuments({ campaign_id: campaignId, status: 'pending' })
  }
  const requeued = await enqueuePending(db, campaignId)
  // Paused after every claim settled — complete now rather than sit
  // 'sending' waiting on jobs that will never arrive.
  if (requeued === 0) await maybeCompleteCampaign(db, campaignId)
  return requeued
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
