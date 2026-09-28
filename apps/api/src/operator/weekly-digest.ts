/**
 * Weekly operator digest — a Monday-morning summary so nobody has to open
 * the console to know whether the platform is healthy and what autopilot
 * did last week. Persisted to `operator_digests` (the console reads the
 * latest) and posted to the ops Slack channel via sendOpsAlert — both are
 * best-effort, neither failure breaks the cron.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { sendOpsAlert } from '../lib/ops-alerts.js'

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
  /** Top promoted blog post by attributed signups this week, if any. */
  top_content?: { slug: string; signups: number }
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
    weekSignups,
  ] = await Promise.all([
    db.collection('users').countDocuments({ created_at: { $gte: weekAgo } }),
    db.collection('users').countDocuments({ created_at: { $gte: twoWeeksAgo, $lt: weekAgo } }),
    db.collection('leads').countDocuments({ stage: 'new' }),
    db.collection('leads').countDocuments({ created_at: { $gte: weekAgo } }),
    db.collection('operator_alerts').countDocuments({ status: 'open' }),
    db.collection('autopilot_actions').countDocuments({ status: 'executed', created_at: { $gte: weekAgo } }),
    db.collection('autopilot_actions').countDocuments({ status: 'proposed' }),
    db.collection('marketing_posts').countDocuments({ state: 'published', published_at: { $gte: weekAgo } }),
    db.collection('lifecycle_sends').countDocuments({ status: 'sent', created_at: { $gte: weekAgo } }),
    // utm_medium=social signups this week → top promoted slug.
    db.collection('users')
      .find(
        { created_at: { $gte: weekAgo }, 'attribution.utm_medium': 'social' },
        { projection: { _id: 0, 'attribution.utm_content': 1 } },
      )
      .toArray(),
  ])

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
    ...(top ? { top_content: { slug: top[0], signups: top[1] } } : {}),
    created_at: now,
  }
  // Spread — insertOne stamps _id on the object it's given; keep the
  // returned digest free of Mongo internals.
  await db.collection('operator_digests').insertOne({ ...digest })

  const signupDelta = signupsPrev7d === 0
    ? (signups7d > 0 ? 'new' : 'flat')
    : `${signups7d >= signupsPrev7d ? '+' : ''}${Math.round(((signups7d - signupsPrev7d) / signupsPrev7d) * 100)}% WoW`
  const lines = [
    `Signups: ${signups7d} (${signupDelta})`,
    `Leads: ${leads7d} new this week · ${leadsNew} waiting in "new"`,
    `Open alerts: ${openAlerts}`,
    `Autopilot: ${autopilotExecuted} actions executed · ${pendingProposals} proposals awaiting review`,
    `Marketing: ${marketingPublished} posts published · ${lifecycleSent} lifecycle emails sent`,
  ]
  if (top) lines.push(`Top content: ${top[0]} → ${top[1]} signups`)
  await sendOpsAlert({
    title: 'Agent Oak — weekly operator digest',
    message: lines.join('\n'),
    severity: 'info',
    fingerprint: `weekly-digest-${now.toISOString().slice(0, 10)}`,
  })
  return digest
}
