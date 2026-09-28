/**
 * Lifecycle email engine — the conversion layer between "captured" and
 * "customer". Three sequences, all consent-gated, deduped, and reversible:
 *
 *   lead_nurture   quiz/lead captures with consent.marketing → welcome →
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
 *
 * Safety: every send is a `lifecycle_sends` ledger row keyed
 * `${sequence}:${step}:${recipient}` — a send is claimed by insert BEFORE
 * the email goes out, so racing sweeps can't double-send. The whole
 * engine honors platform_config.marketing_paused and per-lead
 * `suppressed`/`consent.marketing`. Content stays informational —
 * no product recommendations, no "buy this policy" (CLAUDE.md rule).
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Db } from 'mongodb'
import sgMail from '@sendgrid/mail'
import { createLogger } from '@agentoak/platform'
import { getPlatformConfig } from '../operator/platform-config.js'
import { getGrowthEventsCollection } from '../db.js'

const log = createLogger({ service: 'lifecycle', version: '0.0.0' })

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

interface LifecycleSendDoc {
  id: string
  /** `${sequence}:${step}:${recipientId}` — unique, claimed before send. */
  key: string
  sequence: 'lead_nurture' | 'activation' | 'upgrade' | 'trial'
  step: string
  recipient: string // lead id or user id
  email: string
  status: 'sent' | 'skipped' | 'failed'
  error?: string
  created_at: Date
}

export function lifecycleSendsCol(db: Db) {
  return db.collection<LifecycleSendDoc>('lifecycle_sends')
}

export function ensureLifecycleIndexes(db: Db): void {
  lifecycleSendsCol(db).createIndex({ key: 1 }, { unique: true }).catch(() => {})
  lifecycleSendsCol(db).createIndex({ created_at: -1 }).catch(() => {})
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

function unsubUrl(base: string, leadId: string): string {
  return `${base}/leads/unsubscribe?id=${encodeURIComponent(leadId)}&sig=${unsubscribeToken(leadId)}`
}

// ── Sending ────────────────────────────────────────────────────────────────

function getFromEmail(): string {
  return process.env['SENDGRID_FROM_EMAIL'] ?? 'hello@agentoak.ai'
}

async function sendEmail(to: string, subject: string, html: string, unsubLink?: string): Promise<void> {
  const apiKey = process.env['SENDGRID_API_KEY']
  if (!apiKey) {
    log.warn({ to, subject }, 'No SENDGRID_API_KEY — skipping lifecycle email')
    return
  }
  sgMail.setApiKey(apiKey)
  await sgMail.send({
    to,
    from: { email: getFromEmail(), name: 'Agent Oak' },
    subject,
    html,
    ...(unsubLink ? { headers: { 'List-Unsubscribe': `<${unsubLink}>` } } : {}),
  })
}

function wrap(body: string, unsubLink?: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
${body}
<p style="color:#9a9ab0;font-size:11px;margin-top:32px;border-top:1px solid #eee;padding-top:12px;">
Agent Oak — your family's digital twin.${unsubLink ? ` <a href="${unsubLink}" style="color:#9a9ab0;">Unsubscribe</a>` : ''}
</p></div>`
}

const cta = (url: string, label: string) =>
  `<a href="${url}" style="display:inline-block;padding:12px 22px;background:#6c5ce7;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;margin:16px 0;">${label}</a>`

// ── Email bodies (informational only — never advice/arranging) ──────────────

function leadWelcomeBody(firstName: string, scoreBand: string | undefined, appUrl: string, unsub: string): string {
  const band = scoreBand ? ` Your readiness check came back <strong>${scoreBand}</strong>.` : ''
  return wrap(`
    <p>Hi ${firstName},</p>
    <p>Thanks for checking your family's readiness with Agent Oak.${band}</p>
    <p>Oak watches the signals families usually find out too late — coverage gaps,
    savings drift, renewal deadlines — and tells you what's on file before it matters.
    Your free account holds your result and starts your family's profile.</p>
    ${cta(`${appUrl}/signup?utm_source=lifecycle&utm_medium=email&utm_campaign=lead_nurture&utm_content=welcome`, 'See your result')}
  `, unsub)
}

function leadEducationBody(firstName: string, appUrl: string, unsub: string): string {
  return wrap(`
    <p>Hi ${firstName},</p>
    <p>Most families have the same three blind spots: an emergency buffer that looks
    fine until it isn't, a policy that renewed into a worse rate, and an education
    fund that's quietly behind target.</p>
    <p>Oak's detectors look for exactly these — on your numbers, not averages.
    A few minutes of setup is all it takes.</p>
    ${cta(`${appUrl}/signup?utm_source=lifecycle&utm_medium=email&utm_campaign=lead_nurture&utm_content=day3`, 'Set up your family profile')}
  `, unsub)
}

function leadLastCallBody(firstName: string, appUrl: string, unsub: string): string {
  return wrap(`
    <p>Hi ${firstName},</p>
    <p>Last note from us — your readiness result is still saved. If the timing's
    not right, no problem; if you'd rather not hear from us again, the unsubscribe
    link below is one click.</p>
    <p>Whenever you're ready, Oak is.</p>
    ${cta(`${appUrl}/signup?utm_source=lifecycle&utm_medium=email&utm_campaign=lead_nurture&utm_content=day7`, 'Pick up where you left off')}
  `, unsub)
}

function activationBody(firstName: string, appUrl: string): string {
  return wrap(`
    <p>Hi ${firstName},</p>
    <p>Your Agent Oak account is set up — the last step is your family profile
    (about 2 minutes). That's what turns Oak's detectors on: until then it has
    nothing to watch.</p>
    ${cta(`${appUrl}/family-setup?utm_source=lifecycle&utm_medium=email&utm_campaign=activation`, 'Finish family setup')}
  `)
}

function upgradeBody(firstName: string, appUrl: string): string {
  return wrap(`
    <p>Hi ${firstName},</p>
    <p>You've been using Agent Oak to watch your family's finances — nice work.
    Paid plans unlock the two things free can't do: AI extraction from uploaded
    documents (policies, statements — no manual entry) and AI summaries of the
    emails Oak scans.</p>
    <p>If you're mid-document-pile, that's the upgrade worth it.</p>
    ${cta(`${appUrl}/upgrade?utm_source=lifecycle&utm_medium=email&utm_campaign=upgrade`, 'See paid plans')}
  `)
}

function trialEndingBody(firstName: string, endsAt: Date, appUrl: string): string {
  const date = endsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  return wrap(`
    <p>Hi ${firstName},</p>
    <p>Your Agent Oak trial ends <strong>${date}</strong>. After that, AI document
    extraction and inbox summaries pause — everything you've already extracted
    stays exactly where it is.</p>
    <p>If Oak's been pulling signal out of your family's paperwork, upgrading keeps
    it running without a gap.</p>
    ${cta(`${appUrl}/upgrade?utm_source=lifecycle&utm_medium=email&utm_campaign=trial&utm_content=ending`, 'Keep AI features on')}
  `)
}

function trialExpiredBody(firstName: string, appUrl: string): string {
  return wrap(`
    <p>Hi ${firstName},</p>
    <p>Your Agent Oak trial has ended — AI document extraction and inbox summaries
    are paused. Your documents, insights, and everything Oak already found are
    untouched.</p>
    <p>Any time you want the AI back on, it's one upgrade away.</p>
    ${cta(`${appUrl}/upgrade?utm_source=lifecycle&utm_medium=email&utm_campaign=trial&utm_content=expired`, 'Reactivate AI features')}
  `)
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
  const leads = await db.collection('leads')
    .find({ 'consent.marketing': true, suppressed: { $ne: true }, stage: { $in: ['new', 'contacted'] } },
      { projection: { _id: 0, id: 1, email: 1, name: 1, score_band: 1, created_at: 1 } })
    .limit(500)
    .toArray()
  if (leads.length > 0) {
    const emails = leads.map((l) => l['email'] as string)
    const signedUp = new Set(
      (await db.collection('users').find({ email: { $in: emails } }, { projection: { _id: 0, email: 1 } }).toArray())
        .map((u) => u['email'] as string),
    )
    const sent = new Set(
      (await lifecycleSendsCol(db).find({ sequence: 'lead_nurture', email: { $in: emails } }, { projection: { _id: 0, key: 1 } }).toArray())
        .map((s) => s['key'] as string),
    )
    for (const lead of leads) {
      const email = lead['email'] as string
      if (signedUp.has(email)) continue // converted — nurture stops itself
      const id = lead['id'] as string
      const age = now - (lead['created_at'] as Date).getTime()
      const firstName = String(lead['name'] ?? 'there').split(' ')[0] || 'there'
      const unsub = unsubUrl(appUrl, id)
      const steps: { step: string; minAge: number; subject: string; html: string }[] = [
        { step: 'welcome', minAge: 1 * HOUR, subject: 'Your family readiness result', html: leadWelcomeBody(firstName, lead['score_band'] as string | undefined, appUrl, unsub) },
        { step: 'day3', minAge: 3 * DAY, subject: "The 3 blind spots most families have", html: leadEducationBody(firstName, appUrl, unsub) },
        { step: 'day7', minAge: 7 * DAY, subject: 'Still here when you\u2019re ready', html: leadLastCallBody(firstName, appUrl, unsub) },
      ]
      for (const s of steps) {
        const key = `lead_nurture:${s.step}:${id}`
        if (age >= s.minAge && !sent.has(key)) {
          jobs.push({ key, sequence: 'lead_nurture', step: s.step, recipient: id, email, subject: s.subject, html: s.html, leadId: id })
          break // one step per sweep per lead — no same-day double-send
        }
      }
    }
  }

  // ── activation: signed up 48–96h ago, no family profile yet ──
  const recentUsers = await db.collection('users')
    .find({ created_at: { $gte: new Date(now - 4 * DAY), $lte: new Date(now - 2 * DAY) }, status: 'active' },
      { projection: { _id: 0, id: 1, email: 1, name: 1, tenant_id: 1, created_at: 1 } })
    .limit(500)
    .toArray()
  if (recentUsers.length > 0) {
    const tenantIds = [...new Set(recentUsers.map((u) => u['tenant_id'] as string))]
    const profiled = new Set(
      (await db.collection('family_financial_profile').find({ tenant_id: { $in: tenantIds } }, { projection: { _id: 0, tenant_id: 1 } }).toArray())
        .map((p) => p['tenant_id'] as string),
    )
    const sentKeys = new Set(
      (await lifecycleSendsCol(db).find({ sequence: 'activation', recipient: { $in: recentUsers.map((u) => u['id'] as string) } }, { projection: { _id: 0, key: 1 } }).toArray())
        .map((s) => s['key'] as string),
    )
    for (const u of recentUsers) {
      if (profiled.has(u['tenant_id'] as string)) continue
      const key = `activation:nudge:${u['id']}`
      if (sentKeys.has(key)) continue
      jobs.push({
        key, sequence: 'activation', step: 'nudge', recipient: u['id'] as string, email: u['email'] as string,
        subject: 'One step left — your family profile', html: activationBody(String(u['name'] ?? 'there').split(' ')[0] || 'there', appUrl),
      })
    }
  }

  // ── trial: free tenants whose signup trial ends in ≤72h or expired ≤48h
  //  ago — the highest-converting lifecycle moment there is. ──
  const trialTenants = await db.collection('tenants')
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
    const users = await db.collection('users')
      .find({ tenant_id: { $in: tenantIds }, status: 'active' }, { projection: { _id: 0, id: 1, email: 1, name: 1, tenant_id: 1 } })
      .limit(500)
      .toArray()
    const sentKeys = new Set(
      (await lifecycleSendsCol(db).find({ sequence: 'trial', recipient: { $in: users.map((u) => u['id'] as string) } }, { projection: { _id: 0, key: 1 } }).toArray())
        .map((s) => s['key'] as string),
    )
    const endsByTenant = new Map(actionableTrials.map((t) => [t['tenant_id'] as string, ((t['billing'] as Record<string, unknown>)['trial_ends_at'] as Date)]))
    for (const u of users) {
      const endsAt = endsByTenant.get(u['tenant_id'] as string)
      if (!endsAt) continue
      const ending = endsAt.getTime() > now
      const step = ending ? 'ending' : 'expired'
      const key = `trial:${step}:${u['id']}`
      if (sentKeys.has(key)) continue
      const firstName = String(u['name'] ?? 'there').split(' ')[0] || 'there'
      jobs.push({
        key, sequence: 'trial', step, recipient: u['id'] as string, email: u['email'] as string,
        subject: ending ? 'Your Agent Oak trial ends soon' : 'Your trial has ended — AI is paused',
        html: ending ? trialEndingBody(firstName, endsAt, appUrl) : trialExpiredBody(firstName, appUrl),
      })
    }
  }

  // ── upgrade: free tenant ≥7d, engaged user (≥3 logins/14d), NOT in an
  //  active trial — the trial sequence owns conversion timing there. ──
  const loginAgg = await db.collection('login_events').aggregate([
    { $match: { success: true, created_at: { $gte: new Date(now - 14 * DAY) } } },
    { $group: { _id: '$user_id', logins: { $sum: 1 } } },
    { $match: { logins: { $gte: 3 } } },
    { $limit: 500 },
  ]).toArray()
  // Tenants that hit a paid wall in the last 14d qualify without the login
  // threshold — paying-intent beats passive engagement as a trigger.
  const intentTenants = new Set(
    (await db.collection('growth_events')
      .find({ event: 'upgrade_intent', created_at: { $gte: new Date(now - 14 * DAY) } }, { projection: { _id: 0, 'meta.tenant_id': 1 } })
      .limit(500).toArray())
      .map((e) => (e['meta'] as Record<string, unknown> | undefined)?.['tenant_id'] as string),
  )
  const engagedUserIds = loginAgg.map((r) => r['_id'] as string)
  if (engagedUserIds.length > 0 || intentTenants.size > 0) {
    const userFilter: Record<string, unknown> = intentTenants.size > 0
      ? { status: 'active', $or: [{ id: { $in: engagedUserIds } }, { tenant_id: { $in: [...intentTenants] } }] }
      : { status: 'active', id: { $in: engagedUserIds } }
    const users = await db.collection('users')
      .find(userFilter, { projection: { _id: 0, id: 1, email: 1, name: 1, tenant_id: 1 } })
      .toArray()
    const tenantIds = [...new Set(users.map((u) => u['tenant_id'] as string))]
    const freeTenants = new Set(
      (await db.collection('tenants')
        // null/absent plan = free tier. $not $gt now excludes active trials
        // (missing or already-past trial_ends_at) — trialing tenants get the
        // trial sequence instead of a generic "what paid unlocks" nudge.
        .find({ tenant_id: { $in: tenantIds }, plan: { $in: ['free', null] }, created_at: { $lte: new Date(now - 7 * DAY) }, 'billing.trial_ends_at': { $not: { $gt: new Date() } } },
          { projection: { _id: 0, tenant_id: 1 } }).toArray())
        .map((t) => t['tenant_id'] as string),
    )
    const sentKeys = new Set(
      (await lifecycleSendsCol(db).find({ sequence: 'upgrade', recipient: { $in: users.map((u) => u['id'] as string) } }, { projection: { _id: 0, key: 1 } }).toArray())
        .map((s) => s['key'] as string),
    )
    for (const u of users) {
      if (!freeTenants.has(u['tenant_id'] as string)) continue
      const key = `upgrade:nudge:${u['id']}`
      if (sentKeys.has(key)) continue
      jobs.push({
        key, sequence: 'upgrade', step: 'nudge', recipient: u['id'] as string, email: u['email'] as string,
        subject: 'What a paid plan unlocks',
        html: upgradeBody(String(u['name'] ?? 'there').split(' ')[0] || 'there', appUrl),
      })
    }
  }

  return jobs
}

/** One lifecycle pass — collects due steps, claims each in the ledger, sends.
 *  Honors marketing_paused globally. Returns the claimed rows. */
export async function runLifecycleSweep(db: Db, opts: { maxPerSweep?: number; appUrl?: string } = {}): Promise<LifecycleSendDoc[]> {
  ensureLifecycleIndexes(db)
  if ((await getPlatformConfig(db)).marketing_paused) {
    log.info({}, 'marketing_paused — lifecycle sweep skipped')
    return []
  }
  const appUrl = (opts.appUrl ?? process.env['AGENT_OAK_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
  const max = opts.maxPerSweep ?? 100
  const jobs = await collectJobs(db, appUrl)
  const sent: LifecycleSendDoc[] = []

  for (const job of jobs.slice(0, max)) {
    const row: LifecycleSendDoc = {
      id: randomUUID(), key: job.key, sequence: job.sequence, step: job.step,
      recipient: job.recipient, email: job.email, status: 'sent', created_at: new Date(),
    }
    try {
      await lifecycleSendsCol(db).insertOne(row)
    } catch {
      continue // dedup — another sweep already claimed this send
    }
    try {
      await sendEmail(job.email, job.subject, job.html, job.leadId ? unsubUrl(appUrl, job.leadId) : undefined)
      // First nurture touch promotes the lead out of "new".
      if (job.leadId) {
        await db.collection('leads').updateOne(
          { id: job.leadId, stage: 'new' },
          { $set: { stage: 'contacted', updated_at: new Date() } },
        )
      }
      await getGrowthEventsCollection(db).insertOne({
        event: 'lifecycle_email_sent',
        meta: { sequence: job.sequence, step: job.step },
        created_at: new Date(),
      })
    } catch (err) {
      row.status = 'failed'
      row.error = String(err).slice(0, 300)
      await lifecycleSendsCol(db).updateOne({ id: row.id }, { $set: { status: 'failed', error: row.error } })
    }
    sent.push(row)
  }
  return sent
}
