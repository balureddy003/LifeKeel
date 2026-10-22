/**
 * Lifecycle email engine — the conversion layer between "captured" and
 * "customer". Three sequences, all consent-gated, deduped, and reversible:
 *
 *   lead_nurture   newsletter sign-ups with consent.marketing (the readiness quiz is retired) → welcome →
 *                  day-3 education → day-7 last call. Stops automatically
 *                  the moment the lead signs up (same email) or is
 *                  suppressed/unsubscribed.
 *   activation     user signed up 48–96h ago but the tenant still has no
 *                  family_financial_profile → one "finish setup" nudge.
 *   upgrade        free-plan tenant ≥7d old whose user logged in ≥3 times
 *                  in the last 14d → one "what paid unlocks" email.
 *                  Tenants inside an active signup trial are excluded —
 *                  the trial sequence owns their conversion timing.
 *   trial          billing.trial_ends_at within 72h → "trial ending" email;
 *                  trial_expired ≤48h ago → "features paused" winback.
 *   winback        tenant churned (billing.plan_downgraded audit entry)
 *                  3–14d ago and is still free → one "your data's still
 *                  here" return email. Once ever per tenant — a second
 *                  churn doesn't re-trigger it.
 *
 * Safety: every send is a `lifecycle_sends` ledger row keyed
 * `${sequence}:${step}:${recipient}` — a send is claimed in `pending`
 * BEFORE the email goes out, so racing sweeps can't double-send, then
 * settled to the outcome the provider actually returned (`sent` only
 * when SendGrid accepted, `skipped` for a deliberate non-send, `failed`
 * on provider error). Recoverable rows may be re-claimed up to
 * MAX_SEND_ATTEMPTS; pending/sent rows suppress re-sends forever.
 * The whole engine honors platform_config.marketing_paused and per-lead
 * `suppressed`/`consent.marketing`. Content stays informational —
 * no product recommendations, no "buy this policy" (CLAUDE.md rule).
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Db } from 'mongodb'
import sgMail from '@sendgrid/mail'
import { createLogger } from '@lifekeel/platform'
import { getPlatformConfig } from '../operator/platform-config.js'
import { getGrowthEventsCollection } from '../db.js'
import { utmQuery } from './utm.js'
import { excludeMinorUsers } from '../family/family-permissions.js'
import { recordSpend, spendCost } from '../spend-ledger.js'
import { button, escapeHtml, renderEmail } from '../email/layout.js'

const log = createLogger({ service: 'lifecycle', version: '0.0.0' })

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

interface LifecycleSendDoc {
  id: string
  /** `${sequence}:${step}:${recipientId}` — unique, claimed before send. */
  key: string
  sequence: 'lead_nurture' | 'activation' | 'upgrade' | 'trial' | 'winback' | 'campaign'
  step: string
  recipient: string // lead id or user id
  email: string
  /** pending = claimed, provider call in flight; sent = SendGrid accepted;
   *  skipped = deliberately not sent (e.g. provider unconfigured);
   *  failed = provider rejected. */
  status: 'pending' | 'sent' | 'skipped' | 'failed'
  attempts: number
  error?: string
  created_at: Date
  updated_at?: Date
  /** Set on campaign claims so engagement can roll up per campaign. */
  campaign_id?: string
  /** Recipient snapshot for campaign claims — the durable send job carries
   *  only {campaign_id, key}, so the worker rebuilds the recipient from
   *  these fields (payload-by-reference). */
  recipient_kind?: 'user' | 'lead'
  recipient_name?: string
  // Engagement, filled in by the SendGrid event webhook (POST /webhooks/sendgrid).
  delivered_at?: Date
  opened_at?: Date
  open_count?: number
  clicked_at?: Date
  click_count?: number
  bounced?: boolean
  spam_reported?: boolean
}

export function lifecycleSendsCol(db: Db) {
  return db.collection<LifecycleSendDoc>('lifecycle_sends')
}

// Returns a promise — the unique `key` index IS the dedup lock, so callers
// that are about to insert must await this or a racing claim can slip
// through before the index exists (createIndex is async even in tests).
export function ensureLifecycleIndexes(db: Db): Promise<void> {
  const col = lifecycleSendsCol(db)
  return Promise.all([
    col.createIndex({ key: 1 }, { unique: true }),
    col.createIndex({ created_at: -1 }),
  ])
    .then(() => undefined)
    .catch(() => {})
}

// ── Unsubscribe tokens ─────────────────────────────────────────────────────
// HMAC(JWT_SECRET, `unsub:${leadId}`) — an unsubscribe link proves possession
// of the email that carried it without any login or DB lookup.

export function unsubscribeToken(leadId: string): string {
  return createHmac('sha256', process.env['JWT_SECRET'] ?? 'dev-secret')
    .update(`unsub:${leadId}`)
    .digest('base64url')
}

export function verifyUnsubscribeToken(leadId: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(leadId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** User-side unsubscribe — campaigns mail signed-up users too, and marketing
 *  mail to users needs a working opt-out (the lifecycle account emails like
 *  trial-ending are transactional and don't include it). */
export function userUnsubscribeToken(userId: string): string {
  return createHmac('sha256', process.env['JWT_SECRET'] ?? 'dev-secret')
    .update(`unsub-user:${userId}`)
    .digest('base64url')
}

export function verifyUserUnsubscribeToken(userId: string, token: string): boolean {
  const expected = Buffer.from(userUnsubscribeToken(userId))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function userUnsubUrl(base: string, userId: string): string {
  return `${base}/users/unsubscribe?id=${encodeURIComponent(userId)}&sig=${userUnsubscribeToken(userId)}`
}

function unsubUrl(base: string, leadId: string): string {
  return `${base}/leads/unsubscribe?id=${encodeURIComponent(leadId)}&sig=${unsubscribeToken(leadId)}`
}

// ── Sending ────────────────────────────────────────────────────────────────

function getFromEmail(): string {
  return process.env['SENDGRID_FROM_EMAIL'] ?? 'hello@lifekeel.co.uk'
}

/** 'sent' = SendGrid accepted the message; 'skipped' = deliberately not
 *  sent. Provider rejections throw — the caller settles the ledger row
 *  to 'failed'. Callers must record the outcome; a bare success return
 *  without a provider call is the bug this signature exists to prevent. */
export type SendOutcome = 'sent' | 'skipped'

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  unsubLink?: string,
  /** `lk` = the lifecycle_sends ledger key; SendGrid echoes it back on every
   *  event webhook so opens/clicks/bounces join to the exact send. */
  customArgs?: Record<string, string>,
): Promise<SendOutcome> {
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn({ to, subject }, 'No SENDGRID_API_KEY — skipping lifecycle email')
    return 'skipped'
  }
  sgMail.setApiKey(apiKey)
  await sgMail.send({
    to,
    from: { email: getFromEmail(), name: 'LifeKeel' },
    subject,
    html,
    trackingSettings: {
      openTracking: { enable: true },
      clickTracking: { enable: true },
    },
    ...(customArgs ? { customArgs } : {}),
    ...(unsubLink ? { headers: { 'List-Unsubscribe': `<${unsubLink}>` } } : {}),
  })
  return 'sent'
}

// ── Ledger claim/settle ────────────────────────────────────────────────────

/** Recoverable outcomes may be re-claimed on a later sweep, up to this many
 *  attempts total. pending/sent rows suppress re-sends permanently — that is
 *  the dedup guarantee. */
export const MAX_SEND_ATTEMPTS = 3
const RETRYABLE_STATUSES = ['skipped', 'failed'] as const

/** Claim a ledger row for `base`. The unique `key` insert wins the first
 *  attempt; an existing row is re-claimable only while it sits in a
 *  retryable state under the attempt cap. Returns null when another row
 *  already owns the key. */
export async function claimSend(
  db: Db,
  base: Omit<LifecycleSendDoc, 'status' | 'attempts'>,
): Promise<LifecycleSendDoc | null> {
  const col = lifecycleSendsCol(db)
  const row: LifecycleSendDoc = { ...base, status: 'pending', attempts: 1 }
  try {
    await col.insertOne(row)
    return row
  } catch {
    const retried = await col.findOneAndUpdate(
      {
        key: base.key,
        status: { $in: [...RETRYABLE_STATUSES] },
        attempts: { $lt: MAX_SEND_ATTEMPTS },
      },
      { $set: { status: 'pending', updated_at: new Date() }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    )
    return retried ?? null
  }
}

/** Settle a claimed row to the outcome the provider actually returned.
 *  Exported for the campaign worker, which settles rows claimed by
 *  queueCampaignSend on a different call stack. */
export async function settleSend(
  db: Db,
  key: string,
  outcome: SendOutcome | 'failed',
  error?: string,
) {
  await lifecycleSendsCol(db).updateOne(
    { key },
    { $set: { status: outcome, updated_at: new Date(), ...(error ? { error } : {}) } },
  )
}

/** Ledger keys that suppress a new send — pending/sent rows always do;
 *  retryable rows only once their attempt budget is spent (below the cap
 *  they resurface in collectJobs and get re-claimed by claimSend). */
async function claimedSendKeys(db: Db, filter: Record<string, unknown>): Promise<Set<string>> {
  const rows = await lifecycleSendsCol(db)
    .find(filter, { projection: { _id: 0, key: 1, status: 1, attempts: 1 } })
    .toArray()
  return new Set(
    rows
      .filter(
        (r) =>
          !(
            RETRYABLE_STATUSES.includes(r['status'] as 'skipped' | 'failed') &&
            ((r['attempts'] as number | undefined) ?? 1) < MAX_SEND_ATTEMPTS
          ),
      )
      .map((r) => r['key'] as string),
  )
}

/** Lifecycle and campaign emails in the shared branded layout. `title` is the hero heading. */
export function wrap(body: string, unsubLink?: string, title?: string): string {
  return renderEmail({
    preheader: title ?? "LifeKeel — your family's chart, kept current.",
    title,
    bodyHtml: body.replaceAll('<p>', '<p style="margin:0 0 16px;">'),
    footer: {
      reason: 'You got this because you signed up for LifeKeel or its updates.',
      unsubscribeUrl: unsubLink,
    },
  })
}

export const cta = (url: string, label: string) => button({ url, label })

// ── Email bodies (informational only — never advice/arranging) ──────────────
// Exported so the copy test can run every body through the marketing copy guard.

export function leadWelcomeBody(firstName: string, appUrl: string, unsub: string): string {
  return wrap(
    `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Thanks for joining the LifeKeel newsletter.</p>
    <p>LifeKeel keeps your family's chart: what you hold on file across savings, cover and papers,
    what looks missing, and the steps if something happens. It is free to start, and nothing is
    sent or changed for you unless you approve it.</p>
    ${cta(`${appUrl}/signup?${utmQuery({ source: 'lifecycle', medium: 'email', campaign: 'lead_nurture', content: 'welcome' })}`, 'Start free')}
  `,
    unsub,
    'Welcome to LifeKeel',
  )
}

export function leadEducationBody(firstName: string, appUrl: string, unsub: string): string {
  return wrap(
    `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Three things families often find out late: an emergency buffer that looks fine until income
    stops, cover that is on file for one person but not another, and an education fund that has
    fallen behind its target.</p>
    <p>LifeKeel shows these from the figures you enter, so you can see where things stand. It does
    not make product recommendations; for decisions, a licensed professional can look at your whole
    situation.</p>
    ${cta(`${appUrl}/signup?${utmQuery({ source: 'lifecycle', medium: 'email', campaign: 'lead_nurture', content: 'day3' })}`, 'Put your family on the chart')}
  `,
    unsub,
    'Three things families often find out late',
  )
}

export function leadLastCallBody(firstName: string, appUrl: string, unsub: string): string {
  return wrap(
    `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>One last note from us. If the timing is not right, no problem; if you would rather not hear
    from us again, the unsubscribe link below is one click.</p>
    ${cta(`${appUrl}/signup?${utmQuery({ source: 'lifecycle', medium: 'email', campaign: 'lead_nurture', content: 'day7' })}`, 'Start free')}
  `,
    unsub,
    'Still here when you\u2019re ready',
  )
}

export function activationBody(firstName: string, appUrl: string): string {
  return wrap(
    `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Your LifeKeel account is set up. The last step is your family profile, which takes a few
    minutes. Until it is filled in, there is nothing on your chart for LifeKeel to check.</p>
    ${cta(`${appUrl}/family-setup?${utmQuery({ source: 'lifecycle', medium: 'email', campaign: 'activation' })}`, 'Finish family setup')}
  `,
    undefined,
    'One step left — your family profile',
  )
}

export function upgradeBody(firstName: string, appUrl: string, unsub?: string): string {
  return wrap(
    `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>You have been using LifeKeel for a while. Keel Plus (£7.99 a month, cancel any time) adds two
    things the free plan does not: reading policy details from an uploaded document for you to
    confirm, and plain-language summaries of the financial email you connect.</p>
    ${cta(`${appUrl}/upgrade?${utmQuery({ source: 'lifecycle', medium: 'email', campaign: 'upgrade' })}`, 'See Keel Plus')}
  `,
    unsub,
    'What Keel Plus adds',
  )
}

export function trialEndingBody(firstName: string, endsAt: Date, appUrl: string): string {
  const date = endsAt.toLocaleDateString('en-GB', { month: 'long', day: 'numeric' })
  return wrap(
    `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Your LifeKeel trial ends <strong>${date}</strong>. After that, document reading and email
    summaries pause. Everything already extracted stays where it is.</p>
    ${cta(`${appUrl}/upgrade?${utmQuery({ source: 'lifecycle', medium: 'email', campaign: 'trial', content: 'ending' })}`, 'See Keel Plus')}
  `,
    undefined,
    'Your LifeKeel trial ends soon',
  )
}

export function trialExpiredBody(firstName: string, appUrl: string): string {
  return wrap(
    `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Your LifeKeel trial has ended, so document reading and email summaries are paused. Your
    documents, insights and everything already found are untouched.</p>
    ${cta(`${appUrl}/upgrade?${utmQuery({ source: 'lifecycle', medium: 'email', campaign: 'trial', content: 'expired' })}`, 'See Keel Plus')}
  `,
    undefined,
    'Your trial has ended',
  )
}

export function winbackBody(firstName: string, appUrl: string, unsub?: string): string {
  return wrap(
    `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Your Keel Plus subscription has ended and your account is back on the free plan. Nothing was
    deleted: your family's profile, documents and every insight are still there.</p>
    ${cta(`${appUrl}/upgrade?${utmQuery({ source: 'lifecycle', medium: 'email', campaign: 'winback' })}`, 'See your account')}
  `,
    unsub,
    'Your Keel data is still here',
  )
}

// ── The sweep ─────────────────────────────────────────────────────────────

interface EmailJob {
  key: string
  sequence: LifecycleSendDoc['sequence']
  step: string
  recipient: string
  email: string
  subject: string
  html: string
  leadId?: string // when set, suppress/stage bookkeeping applies
}

async function collectJobs(db: Db, appUrl: string): Promise<EmailJob[]> {
  const jobs: EmailJob[] = []
  const now = Date.now()

  // ── lead_nurture: consenting, unsuppressed leads who haven't signed up ──
  const leads = await db
    .collection('leads')
    .find(
      {
        'consent.marketing': true,
        suppressed: { $ne: true },
        stage: { $in: ['new', 'contacted'] },
      },
      { projection: { _id: 0, id: 1, email: 1, name: 1, score_band: 1, created_at: 1 } },
    )
    .limit(500)
    .toArray()
  if (leads.length > 0) {
    const emails = leads.map((l) => l['email'] as string)
    const signedUp = new Set(
      (
        await db
          .collection('users')
          .find({ email: { $in: emails } }, { projection: { _id: 0, email: 1 } })
          .toArray()
      ).map((u) => u['email'] as string),
    )
    const sent = await claimedSendKeys(db, {
      sequence: 'lead_nurture',
      email: { $in: emails },
    })
    for (const lead of leads) {
      const email = lead['email'] as string
      if (signedUp.has(email)) continue // converted — nurture stops itself
      const id = lead['id'] as string
      const age = now - (lead['created_at'] as Date).getTime()
      const firstName = String(lead['name'] ?? 'there').split(' ')[0] || 'there'
      const unsub = unsubUrl(appUrl, id)
      const steps: { step: string; minAge: number; subject: string; html: string }[] = [
        {
          step: 'welcome',
          minAge: 1 * HOUR,
          subject: 'Welcome to LifeKeel',
          html: leadWelcomeBody(firstName, appUrl, unsub),
        },
        {
          step: 'day3',
          minAge: 3 * DAY,
          subject: 'Three things families often find out late',
          html: leadEducationBody(firstName, appUrl, unsub),
        },
        {
          step: 'day7',
          minAge: 7 * DAY,
          subject: 'Still here when you\u2019re ready',
          html: leadLastCallBody(firstName, appUrl, unsub),
        },
      ]
      for (const s of steps) {
        const key = `lead_nurture:${s.step}:${id}`
        if (age >= s.minAge && !sent.has(key)) {
          jobs.push({
            key,
            sequence: 'lead_nurture',
            step: s.step,
            recipient: id,
            email,
            subject: s.subject,
            html: s.html,
            leadId: id,
          })
          break // one step per sweep per lead — no same-day double-send
        }
      }
    }
  }

  // ── activation: signed up 48–96h ago, no family profile yet ──
  // (every user fetch passes excludeMinorUsers — intent 09: a member whose
  // roster entry is 'child' or under 18 never receives marketing mail,
  // whatever flags the account carries)
  const recentUsers = await excludeMinorUsers(
    db,
    await db
      .collection('users')
      .find(
        {
          created_at: { $gte: new Date(now - 4 * DAY), $lte: new Date(now - 2 * DAY) },
          status: 'active',
        },
        { projection: { _id: 0, id: 1, email: 1, name: 1, tenant_id: 1, created_at: 1 } },
      )
      .limit(500)
      .toArray(),
  )
  if (recentUsers.length > 0) {
    const tenantIds = [...new Set(recentUsers.map((u) => u['tenant_id'] as string))]
    const profiled = new Set(
      (
        await db
          .collection('family_financial_profile')
          .find({ tenant_id: { $in: tenantIds } }, { projection: { _id: 0, tenant_id: 1 } })
          .toArray()
      ).map((p) => p['tenant_id'] as string),
    )
    const sentKeys = await claimedSendKeys(db, {
      sequence: 'activation',
      recipient: { $in: recentUsers.map((u) => u['id'] as string) },
    })
    for (const u of recentUsers) {
      if (profiled.has(u['tenant_id'] as string)) continue
      const key = `activation:nudge:${u['id']}`
      if (sentKeys.has(key)) continue
      jobs.push({
        key,
        sequence: 'activation',
        step: 'nudge',
        recipient: u['id'] as string,
        email: u['email'] as string,
        subject: 'One step left — your family profile',
        html: activationBody(String(u['name'] ?? 'there').split(' ')[0] || 'there', appUrl),
      })
    }
  }

  // ── trial: free tenants whose signup trial ends in ≤72h or expired ≤48h
  //  ago — the highest-converting lifecycle moment there is. ──
  const trialTenants = await db
    .collection('tenants')
    .find(
      {
        plan: { $in: ['free', null] },
        'billing.trial_ends_at': { $exists: true },
      },
      { projection: { _id: 0, tenant_id: 1, billing: 1 } },
    )
    .limit(500)
    .toArray()
  const actionableTrials = trialTenants.filter((t) => {
    const b = t['billing'] as Record<string, unknown> | undefined
    const endsAt = b?.['trial_ends_at'] as Date | undefined
    if (!endsAt) return false
    const ms = endsAt.getTime() - now
    // Ending soon, or expired within the last 48h (trial_expired flag or clock).
    return (ms > 0 && ms <= 3 * DAY) || (ms <= 0 && ms >= -2 * DAY)
  })
  if (actionableTrials.length > 0) {
    const tenantIds = actionableTrials.map((t) => t['tenant_id'] as string)
    const users = await excludeMinorUsers(
      db,
      await db
        .collection('users')
        .find(
          { tenant_id: { $in: tenantIds }, status: 'active' },
          { projection: { _id: 0, id: 1, email: 1, name: 1, tenant_id: 1 } },
        )
        .limit(500)
        .toArray(),
    )
    const sentKeys = await claimedSendKeys(db, {
      sequence: 'trial',
      recipient: { $in: users.map((u) => u['id'] as string) },
    })
    const endsByTenant = new Map(
      actionableTrials.map((t) => [
        t['tenant_id'] as string,
        (t['billing'] as Record<string, unknown>)['trial_ends_at'] as Date,
      ]),
    )
    for (const u of users) {
      const endsAt = endsByTenant.get(u['tenant_id'] as string)
      if (!endsAt) continue
      const ending = endsAt.getTime() > now
      const step = ending ? 'ending' : 'expired'
      const key = `trial:${step}:${u['id']}`
      if (sentKeys.has(key)) continue
      const firstName = String(u['name'] ?? 'there').split(' ')[0] || 'there'
      jobs.push({
        key,
        sequence: 'trial',
        step,
        recipient: u['id'] as string,
        email: u['email'] as string,
        subject: ending ? 'Your LifeKeel trial ends soon' : 'Your trial has ended — AI is paused',
        html: ending
          ? trialEndingBody(firstName, endsAt, appUrl)
          : trialExpiredBody(firstName, appUrl),
      })
    }
  }

  // ── winback: churned 3–14d ago (plan_downgraded audit entry), still
  //  free, not re-subscribed. One email per tenant ever — the dedup key
  //  is per-user so a churn-return-churn cycle doesn't re-mail. ──
  const churned = await db
    .collection('audit_log')
    .find(
      {
        action: 'billing.plan_downgraded',
        timestamp: { $gte: new Date(now - 14 * DAY), $lte: new Date(now - 3 * DAY) },
      },
      { projection: { _id: 0, tenant_id: 1, timestamp: 1 } },
    )
    .sort({ timestamp: -1 })
    .limit(200)
    .toArray()
  // Latest downgrade wins — an old churn superseded by a re-subscribe then
  // another churn still counts (audit timestamps are per-event).
  const churnedAt = new Map<string, Date>()
  for (const a of churned) {
    const tid = a['tenant_id'] as string
    if (!churnedAt.has(tid)) churnedAt.set(tid, a['timestamp'] as Date)
  }
  if (churnedAt.size > 0) {
    const stillFree = new Set(
      (
        await db
          .collection('tenants')
          .find(
            {
              tenant_id: { $in: [...churnedAt.keys()] },
              plan: { $in: ['free', null] },
              stripe_subscription_id: { $exists: false },
            },
            { projection: { _id: 0, tenant_id: 1 } },
          )
          .toArray()
      ).map((t) => t['tenant_id'] as string),
    )
    if (stillFree.size > 0) {
      const users = await excludeMinorUsers(
        db,
        await db
          .collection('users')
          .find(
            { tenant_id: { $in: [...stillFree] }, status: 'active', email_opt_out: { $ne: true } },
            { projection: { _id: 0, id: 1, email: 1, name: 1, tenant_id: 1 } },
          )
          .limit(500)
          .toArray(),
      )
      const sentKeys = await claimedSendKeys(db, {
        sequence: 'winback',
        recipient: { $in: users.map((u) => u['id'] as string) },
      })
      for (const u of users) {
        const key = `winback:return:${u['id']}`
        if (sentKeys.has(key)) continue
        jobs.push({
          key,
          sequence: 'winback',
          step: 'return',
          recipient: u['id'] as string,
          email: u['email'] as string,
          subject: 'Your Keel data is still here',
          html: winbackBody(
            String(u['name'] ?? 'there').split(' ')[0] || 'there',
            appUrl,
            userUnsubUrl(appUrl, String(u['id'])),
          ),
        })
      }
    }
  }

  // ── upgrade: free tenant ≥7d, engaged user (≥3 logins/14d), NOT in an
  //  active trial — the trial sequence owns conversion timing there. ──
  const loginAgg = await db
    .collection('login_events')
    .aggregate([
      { $match: { success: true, created_at: { $gte: new Date(now - 14 * DAY) } } },
      { $group: { _id: '$user_id', logins: { $sum: 1 } } },
      { $match: { logins: { $gte: 3 } } },
      { $limit: 500 },
    ])
    .toArray()
  // Tenants that hit a paid wall in the last 14d qualify without the login
  // threshold — paying-intent beats passive engagement as a trigger.
  const intentTenants = new Set(
    (
      await db
        .collection('growth_events')
        .find(
          { event: 'upgrade_intent', created_at: { $gte: new Date(now - 14 * DAY) } },
          { projection: { _id: 0, 'meta.tenant_id': 1 } },
        )
        .limit(500)
        .toArray()
    ).map((e) => (e['meta'] as Record<string, unknown> | undefined)?.['tenant_id'] as string),
  )
  const engagedUserIds = loginAgg.map((r) => r['_id'] as string)
  if (engagedUserIds.length > 0 || intentTenants.size > 0) {
    const userFilter: Record<string, unknown> =
      intentTenants.size > 0
        ? {
            status: 'active',
            $or: [{ id: { $in: engagedUserIds } }, { tenant_id: { $in: [...intentTenants] } }],
          }
        : { status: 'active', id: { $in: engagedUserIds } }
    const users = await excludeMinorUsers(
      db,
      await db
        .collection('users')
        .find(
          { ...userFilter, email_opt_out: { $ne: true } },
          { projection: { _id: 0, id: 1, email: 1, name: 1, tenant_id: 1 } },
        )
        .toArray(),
    )
    const tenantIds = [...new Set(users.map((u) => u['tenant_id'] as string))]
    const freeTenants = new Set(
      (
        await db
          .collection('tenants')
          // null/absent plan = free tier. $not $gt now excludes active trials
          // (missing or already-past trial_ends_at) — trialing tenants get the
          // trial sequence instead of a generic "what paid unlocks" nudge.
          .find(
            {
              tenant_id: { $in: tenantIds },
              plan: { $in: ['free', null] },
              created_at: { $lte: new Date(now - 7 * DAY) },
              'billing.trial_ends_at': { $not: { $gt: new Date() } },
            },
            { projection: { _id: 0, tenant_id: 1 } },
          )
          .toArray()
      ).map((t) => t['tenant_id'] as string),
    )
    const sentKeys = await claimedSendKeys(db, {
      sequence: 'upgrade',
      recipient: { $in: users.map((u) => u['id'] as string) },
    })
    for (const u of users) {
      if (!freeTenants.has(u['tenant_id'] as string)) continue
      const key = `upgrade:nudge:${u['id']}`
      if (sentKeys.has(key)) continue
      jobs.push({
        key,
        sequence: 'upgrade',
        step: 'nudge',
        recipient: u['id'] as string,
        email: u['email'] as string,
        subject: 'What Keel Plus adds',
        html: upgradeBody(
          String(u['name'] ?? 'there').split(' ')[0] || 'there',
          appUrl,
          userUnsubUrl(appUrl, String(u['id'])),
        ),
      })
    }
  }

  return jobs
}

/** One lifecycle pass — collects due steps, claims each in the ledger, sends.
 *  Honors marketing_paused globally. With no provider configured the sweep
 *  returns early and claims nothing — an unconfigured run must not leave
 *  rows that look sent, nor burn dedup keys a configured run could use.
 *  Returns the claimed rows with their settled statuses. */
export async function runLifecycleSweep(
  db: Db,
  opts: { maxPerSweep?: number; appUrl?: string } = {},
): Promise<LifecycleSendDoc[]> {
  await ensureLifecycleIndexes(db)
  if ((await getPlatformConfig(db)).marketing_paused) {
    log.info({}, 'marketing_paused — lifecycle sweep skipped')
    return []
  }
  if (!process.env['SENDGRID_API_KEY']) {
    log.warn({}, 'No SENDGRID_API_KEY — lifecycle sweep skipped, nothing claimed')
    return []
  }
  const appUrl = (opts.appUrl ?? process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(
    /\/$/,
    '',
  )
  const max = opts.maxPerSweep ?? 100
  const jobs = await collectJobs(db, appUrl)
  const sent: LifecycleSendDoc[] = []

  for (const job of jobs.slice(0, max)) {
    const row = await claimSend(db, {
      id: randomUUID(),
      key: job.key,
      sequence: job.sequence,
      step: job.step,
      recipient: job.recipient,
      email: job.email,
      created_at: new Date(),
    })
    if (!row) continue // another sweep claimed it, or attempts are spent
    try {
      const outcome = await sendEmail(
        job.email,
        job.subject,
        job.html,
        job.leadId
          ? unsubUrl(appUrl, job.leadId)
          : ['upgrade', 'winback'].includes(job.sequence)
            ? userUnsubUrl(appUrl, job.recipient)
            : undefined,
        { lk: job.key },
      )
      await settleSend(
        db,
        job.key,
        outcome,
        outcome === 'skipped' ? 'sendgrid_not_configured' : undefined,
      )
      row.status = outcome
      if (outcome === 'sent') {
        // First nurture touch promotes the lead out of "new".
        if (job.leadId) {
          await db
            .collection('leads')
            .updateOne(
              { id: job.leadId, stage: 'new' },
              { $set: { stage: 'contacted', updated_at: new Date() } },
            )
        }
        await getGrowthEventsCollection(db).insertOne({
          event: 'lifecycle_email_sent',
          meta: { sequence: job.sequence, step: job.step },
          created_at: new Date(),
        })
        // Lifecycle mail is platform-paid SendGrid spend; leads carry no
        // tenant, so 'platform' keeps the ledger honest about whose bill
        // it lands on.
        void recordSpend(db, {
          tenant_id: 'platform',
          service: 'marketing',
          provider: 'sendgrid',
          unit: 'email',
          units: 1,
          cost_microdollars: spendCost('sendgrid', 'email'),
          meta: { sequence: job.sequence, step: job.step },
        }).catch(() => {})
      }
    } catch (err) {
      row.status = 'failed'
      row.error = String(err).slice(0, 300)
      await settleSend(db, job.key, 'failed', row.error)
    }
    sent.push(row)
  }
  return sent
}
