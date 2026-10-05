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
import { lifecycleSendsCol, ensureLifecycleIndexes, sendEmail, wrap, cta, unsubscribeToken, userUnsubUrl } from './lifecycle-emails.js'

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
  status: 'draft' | 'sent'
  created_by: string
  created_at: Date
  sent_at?: Date
  stats?: { targeted: number; sent: number; failed: number }
}

export function campaignsCol(db: Db) {
  return db.collection<CampaignDoc>('campaigns')
}

export function ensureCampaignIndexes(db: Db): void {
  campaignsCol(db).createIndex({ id: 1 }, { unique: true }).catch(() => {})
  campaignsCol(db).createIndex({ status: 1, created_at: -1 }).catch(() => {})
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
  const users = await db.collection('users')
    .find(q, { projection: { _id: 0, id: 1, email: 1, name: 1, tenant_id: 1, attribution: 1 } })
    .limit(MAX_RECIPIENTS)
    .toArray()
  let list = users
  if (filter.utm_sources?.length) {
    const allowed = new Set(filter.utm_sources)
    list = list.filter((u) => allowed.has(String((u['attribution'] as Record<string, unknown> | undefined)?.['utm_source'] ?? '')))
  }

  const needsTenants = !!(filter.plans?.length || filter.trialing !== undefined || filter.has_profile !== undefined)
  if (needsTenants && list.length > 0) {
    const tids = [...new Set(list.map((u) => u['tenant_id'] as string))]
    const tq: Record<string, unknown> = { tenant_id: { $in: tids } }
    if (filter.plans?.length) tq['plan'] = { $in: filter.plans }
    if (filter.trialing === true) tq['billing.trial_ends_at'] = { $gt: new Date() }
    if (filter.trialing === false) tq['billing.trial_ends_at'] = { $not: { $gt: new Date() } }
    const tenants = await db.collection('tenants').find(tq, { projection: { _id: 0, tenant_id: 1 } }).toArray()
    const ok = new Set(tenants.map((t) => t['tenant_id'] as string))
    list = list.filter((u) => ok.has(u['tenant_id'] as string))

    if (filter.has_profile !== undefined && list.length > 0) {
      const remaining = [...new Set(list.map((u) => u['tenant_id'] as string))]
      const profiled = new Set(
        (await db.collection('family_financial_profile')
          .find({ tenant_id: { $in: remaining } }, { projection: { _id: 0, tenant_id: 1 } }).toArray())
          .map((p) => p['tenant_id'] as string),
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
  const leads = await db.collection('leads')
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
  if (filter.audience === 'users' || filter.audience === 'both') out.push(...await resolveUsers(db, filter, now))
  if (filter.audience === 'leads' || filter.audience === 'both') out.push(...await resolveLeads(db, filter, now))
  return out.slice(0, MAX_RECIPIENTS)
}

/** Render the campaign body: paragraphs on blank lines, {{first_name}}
 *  interpolation, minimal escaping (the operator writes copy, not HTML). */
function renderBody(campaign: CampaignDoc, r: Recipient, appUrl: string): string {
  const escaped = campaign.body_text
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('{{first_name}}', r.firstName)
  const paras = escaped.split(/\n{2,}/).map((p) => `<p>${p.replaceAll('\n', '<br>')}</p>`).join('\n')
  const unsub = r.kind === 'lead'
    ? `${appUrl}/leads/unsubscribe?id=${encodeURIComponent(r.id)}&sig=${unsubscribeToken(r.id)}`
    : userUnsubUrl(appUrl, r.id)
  const ctaHtml = campaign.cta_url && campaign.cta_label ? cta(campaign.cta_url, campaign.cta_label) : ''
  return wrap(`${paras}\n${ctaHtml}`, unsub)
}

/** Fire a campaign: resolves the audience fresh (a draft's filter may match
 *  different people by send time), claims each send in the ledger, mails.
 *  One-shot — status 'sent' campaigns 409 upstream. */
export async function sendCampaign(db: Db, campaign: CampaignDoc, opts: { appUrl?: string } = {}): Promise<CampaignDoc['stats']> {
  ensureCampaignIndexes(db)
  await ensureLifecycleIndexes(db) // the ledger's unique key index is the dedup lock
  if ((await getPlatformConfig(db)).marketing_paused) {
    throw Object.assign(new Error('marketing_paused is set — campaign sends are halted'), { statusCode: 409 })
  }
  const appUrl = (opts.appUrl ?? process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
  const recipients = await resolveAudience(db, campaign.filter)
  const stats = { targeted: recipients.length, sent: 0, failed: 0 }

  for (const r of recipients) {
    const key = `campaign:${campaign.id}:${r.id}`
    const claimed = await lifecycleSendsCol(db).insertOne({
      id: randomUUID(), key, sequence: 'campaign', step: campaign.name.slice(0, 80),
      campaign_id: campaign.id,
      recipient: r.id, email: r.email, status: 'sent', created_at: new Date(),
    }).then(() => true).catch(() => false)
    if (!claimed) continue // already mailed by a prior/racing send
    try {
      const unsub = r.kind === 'lead'
        ? `${appUrl}/leads/unsubscribe?id=${encodeURIComponent(r.id)}&sig=${unsubscribeToken(r.id)}`
        : userUnsubUrl(appUrl, r.id)
      await sendEmail(r.email, campaign.subject, renderBody(campaign, r, appUrl), unsub, { lk: key })
      stats.sent++
    } catch (err) {
      stats.failed++
      await lifecycleSendsCol(db).updateOne({ key }, { $set: { status: 'failed', error: String(err).slice(0, 300) } })
      log.warn({ campaign: campaign.id, to: r.email, err }, 'campaign send failed')
    }
  }
  await getGrowthEventsCollection(db).insertOne({
    event: 'campaign_sent',
    meta: { campaign_id: campaign.id, name: campaign.name, ...stats },
    created_at: new Date(),
  })
  return stats
}
