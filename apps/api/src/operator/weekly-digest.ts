/**
 * Weekly operator digest — a Monday-morning summary so nobody has to open
 * the console to know whether the platform is healthy and what autopilot
 * did last week. Persisted to `operator_digests` (the console reads the
 * latest) and posted to the ops Slack channel via sendOpsAlert — both are
 * best-effort, neither failure breaks the cron.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { sendOpsAlert } from '../operator/ops-alerts.js'
import { readFunnel } from '../marketing/funnel.js'

export interface WeeklyDigestDoc {
  id: string
  window_days: number
  signups_7d: number
  signups_prev_7d: number
  leads_new: number
  leads_total_7d: number
  open_alerts: number
  autopilot_executed_7d: number
  autopilot_pending_proposals: number
  marketing_published_7d: number
  lifecycle_sent_7d: number
  /** Paywall hits in the last 7d — tenants bumping into paid features. */
  upgrade_intent_7d: number
  /** Top promoted blog post by attributed signups this week, if any. */
  top_content?: { slug: string; signups: number }
  /** PRD-210: the marketing engine's week, so nobody has to open the console to know what needs them. */
  marketing?: {
    drafts_awaiting_review: number
    drafts_failing_copy_guard: number
    next_week_items_planned: number
    profile_drift_open: number
    funnel_7d: { visit: number; cta_click: number; signup: number; profile: number; first_insight: number }
    top_source_by_signups?: { source: string; signups: number }
    top_pillar_by_signups?: { pillar: string; signups: number }
  }
  created_at: Date
}

export async function runWeeklyDigest(db: Db): Promise<WeeklyDigestDoc> {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  const [
    signups7d,
    signupsPrev7d,
    leadsNew,
    leads7d,
    openAlerts,
    autopilotExecuted,
    pendingProposals,
    marketingPublished,
    lifecycleSent,
    upgradeIntent,
    weekSignups,
  ] = await Promise.all([
    db.collection('users').countDocuments({ created_at: { $gte: weekAgo } }),
    db.collection('users').countDocuments({ created_at: { $gte: twoWeeksAgo, $lt: weekAgo } }),
    db.collection('leads').countDocuments({ stage: 'new' }),
    db.collection('leads').countDocuments({ created_at: { $gte: weekAgo } }),
    db.collection('operator_alerts').countDocuments({ status: 'open' }),
    db
      .collection('autopilot_actions')
      .countDocuments({ status: 'executed', created_at: { $gte: weekAgo } }),
    db.collection('autopilot_actions').countDocuments({ status: 'proposed' }),
    db
      .collection('marketing_posts')
      .countDocuments({ state: 'published', published_at: { $gte: weekAgo } }),
    db
      .collection('lifecycle_sends')
      .countDocuments({ status: 'sent', created_at: { $gte: weekAgo } }),
    db
      .collection('growth_events')
      .countDocuments({ event: 'upgrade_intent', created_at: { $gte: weekAgo } }),
    // utm_medium=social signups this week → top promoted slug.
    db
      .collection('users')
      .find(
        { created_at: { $gte: weekAgo }, 'attribution.utm_medium': 'social' },
        { projection: { _id: 0, 'attribution.utm_content': 1 } },
      )
      .toArray(),
  ])

  const marketing = await marketingSection(db, now)

  const slugCounts = new Map<string, number>()
  for (const u of weekSignups) {
    const slug = (u['attribution'] as Record<string, string> | undefined)?.['utm_content']
    if (slug) slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1)
  }
  const top = [...slugCounts.entries()].sort((a, b) => b[1] - a[1])[0]

  const digest: WeeklyDigestDoc = {
    id: randomUUID(),
    window_days: 7,
    signups_7d: signups7d,
    signups_prev_7d: signupsPrev7d,
    leads_new: leadsNew,
    leads_total_7d: leads7d,
    open_alerts: openAlerts,
    autopilot_executed_7d: autopilotExecuted,
    autopilot_pending_proposals: pendingProposals,
    marketing_published_7d: marketingPublished,
    lifecycle_sent_7d: lifecycleSent,
    upgrade_intent_7d: upgradeIntent,
    ...(top ? { top_content: { slug: top[0], signups: top[1] } } : {}),
    marketing,
    created_at: now,
  }
  // Spread — insertOne stamps _id on the object it's given; keep the
  // returned digest free of Mongo internals.
  await db.collection('operator_digests').insertOne({ ...digest })

  const signupDelta =
    signupsPrev7d === 0
      ? signups7d > 0
        ? 'new'
        : 'flat'
      : `${signups7d >= signupsPrev7d ? '+' : ''}${Math.round(((signups7d - signupsPrev7d) / signupsPrev7d) * 100)}% WoW`
  const lines = [
    `Signups: ${signups7d} (${signupDelta})`,
    `Leads: ${leads7d} new this week · ${leadsNew} waiting in "new"`,
    `Open alerts: ${openAlerts}`,
    `Autopilot: ${autopilotExecuted} actions executed · ${pendingProposals} proposals awaiting review`,
    `Marketing: ${marketingPublished} posts published · ${lifecycleSent} lifecycle emails · ${upgradeIntent} upgrade-intent hits`,
  ]
  if (top) lines.push(`Top content: ${top[0]} → ${top[1]} signups`)
  const f = marketing.funnel_7d
  lines.push(
    `Funnel (7d): ${f.visit} visits · ${f.cta_click} clicks · ${f.signup} signups · ${f.profile} profiles · ${f.first_insight} first insights`,
    `Marketing queue: ${marketing.drafts_awaiting_review} drafts to review (${marketing.drafts_failing_copy_guard} fail the copy guard) · ${marketing.next_week_items_planned} items planned for next week · ${marketing.profile_drift_open} profile differences open`,
  )
  if (marketing.top_source_by_signups) lines.push(`Best source: ${marketing.top_source_by_signups.source} → ${marketing.top_source_by_signups.signups} signups`)
  if (marketing.top_pillar_by_signups) lines.push(`Best pillar: ${marketing.top_pillar_by_signups.pillar} → ${marketing.top_pillar_by_signups.signups} signups`)
  await sendOpsAlert({
    title: 'LifeKeel — weekly operator digest',
    message: lines.join('\n'),
    severity: 'info',
    fingerprint: `weekly-digest-${now.toISOString().slice(0, 10)}`,
  })
  return digest
}

const nextMondayKey = (from: Date): string => {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7))
  return d.toISOString().slice(0, 10)
}

/** What the marketing engine needs from a person this week, from existing collections and the funnel rollups. */
async function marketingSection(db: Db, now: Date): Promise<NonNullable<WeeklyDigestDoc['marketing']>> {
  const [drafts, failing, planned, drift, funnel] = await Promise.all([
    db.collection('marketing_posts').countDocuments({ state: 'draft' }),
    db.collection('marketing_posts').countDocuments({ state: 'draft', 'copy_check.ok': false }),
    db.collection('content_items').countDocuments({ week_key: nextMondayKey(now), status: 'planned' }),
    db.collection('channel_profiles').countDocuments({ 'drift.0': { $exists: true } }),
    readFunnel(db, 7, now),
  ])
  const step = (k: string) => funnel.steps.find((x) => x.step === k)?.count ?? 0
  const topSource = funnel.by_source.find((b) => b.signup > 0 && b.key !== 'direct')
  const topPillar = funnel.by_campaign.find((b) => b.signup > 0 && b.key.startsWith('pillar_'))
  return {
    drafts_awaiting_review: drafts,
    drafts_failing_copy_guard: failing,
    next_week_items_planned: planned,
    profile_drift_open: drift,
    funnel_7d: {
      visit: step('visit'),
      cta_click: step('cta_click'),
      signup: step('signup'),
      profile: step('profile'),
      first_insight: step('first_insight'),
    },
    ...(topSource ? { top_source_by_signups: { source: topSource.key, signups: topSource.signup } } : {}),
    ...(topPillar ? { top_pillar_by_signups: { pillar: topPillar.key.replace(/^pillar_/, ''), signups: topPillar.signup } } : {}),
  }
}
