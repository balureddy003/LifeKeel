/**
 * Mission Control — one ranked list of decisions waiting on a human.
 *
 * Read-only over collections that already exist; it creates nothing and
 * executes nothing. Each decision carries what the operator needs to judge it
 * without opening another page (evidence, effect, undo) and the permission
 * required to act, so the list is filtered to what the caller may touch.
 *
 * Deliberately text-free about customers: titles use ids, counts, channels and
 * case subjects — never message bodies, financial data or model output.
 */
import type { Db } from 'mongodb'
import {
  allUsableChannels,
  channelIssues,
  PLATFORM_SETUP,
  SOCIAL_CHANNELS,
} from '../marketing/channels.js'
import { nextMondayKey } from '../marketing/content-plan.js'
import {
  hasOperatorPermission,
  type OperatorPermission,
  type PlatformRole,
} from './operator-auth.js'

export type DecisionKind =
  | 'proposal'
  | 'alert'
  | 'support_case'
  | 'post_draft'
  | 'post_failed'
  | 'campaign_draft'
  | 'dual_approval'
  | 'plan_week'
  | 'plan_missing'
  | 'channel_attention'
  | 'profile_drift'

export type DecisionSeverity = 'danger' | 'warning' | 'info'

export interface Decision {
  /** `${kind}:${source id}` — stable, used by the batch endpoint. */
  id: string
  kind: DecisionKind
  severity: DecisionSeverity
  title: string
  /** Evidence: why this is on the list. */
  why: string
  /** What happens if the operator says yes. */
  effect: string
  /** How to reverse it (or why it cannot be). */
  undo: string
  href: string
  required_permission: OperatorPermission
  /** Only proposals and alerts can be actioned in a batch; everything else
   *  is "open the page" — posts and campaigns publish externally, four-eyes
   *  and erasure need their own deliberate click (intent 03). */
  batchable: boolean
  created_at: string
}

export const SUPPORT_SLA_HOURS = 24
export const MAX_DECISIONS = 50

const SEVERITY_RANK: Record<DecisionSeverity, number> = { danger: 0, warning: 1, info: 2 }

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(0).toISOString()
}

/** The Monday (UTC) of the week a date falls in, as YYYY-MM-DD. */
function mondayOf(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}

const channelLabel = (c: string) =>
  PLATFORM_SETUP[c as (typeof SOCIAL_CHANNELS)[number]]?.label ?? c

function ageLabel(since: unknown): string {
  const ms = Date.now() - (since instanceof Date ? since.getTime() : Date.now())
  const h = Math.floor(ms / 3_600_000)
  return h < 1 ? 'under an hour' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`
}

export async function buildDecisions(
  db: Db,
  operator: { user_id: string; roles: PlatformRole[] },
  now = new Date(),
): Promise<Decision[]> {
  const can = (p: OperatorPermission) => hasOperatorPermission(operator.roles, p)
  const out: Decision[] = []
  const slaCutoff = new Date(now.getTime() - SUPPORT_SLA_HOURS * 3_600_000)

  const [proposals, alerts, cases, posts, failed, campaigns, approvals] = await Promise.all([
    db
      .collection('autopilot_actions')
      .find({ status: 'proposed' }, { projection: { _id: 0 } })
      .sort({ created_at: 1 })
      .limit(MAX_DECISIONS)
      .toArray(),
    db
      .collection('operator_alerts')
      .find(
        {
          $or: [{ status: 'open' }, { status: 'snoozed', snoozed_until: { $lt: now } }],
        },
        { projection: { _id: 0 } },
      )
      .limit(MAX_DECISIONS)
      .toArray(),
    db
      .collection('support_cases')
      .find(
        { status: { $in: ['open'] }, updated_at: { $lt: slaCutoff } },
        { projection: { _id: 0, id: 1, subject: 1, updated_at: 1, created_at: 1 } },
      )
      .sort({ updated_at: 1 })
      .limit(MAX_DECISIONS)
      .toArray(),
    db
      .collection('marketing_posts')
      // Weekly-plan drafts (they carry a content item) are one decision per week below,
      // not one card per post.
      .find(
        { state: 'draft', content_item_id: { $exists: false } },
        { projection: { _id: 0, id: 1, channel: 1, created_at: 1, generated: 1 } },
      )
      .sort({ created_at: 1 })
      .limit(MAX_DECISIONS)
      .toArray(),
    db
      .collection('marketing_posts')
      .find(
        { state: 'publish_failed' },
        { projection: { _id: 0, id: 1, channel: 1, created_at: 1 } },
      )
      .limit(MAX_DECISIONS)
      .toArray(),
    db
      .collection('campaigns')
      .find({ status: 'draft' }, { projection: { _id: 0, id: 1, name: 1, created_at: 1 } })
      .limit(MAX_DECISIONS)
      .toArray(),
    db
      .collection('operator_dual_approvals')
      .find(
        {
          status: 'pending',
          requested_by: { $ne: operator.user_id },
          expires_at: { $gt: now },
        },
        { projection: { _id: 0 } },
      )
      .limit(MAX_DECISIONS)
      .toArray(),
  ])

  for (const p of proposals) {
    const proposal = p['proposal'] as { summary?: string; required_permission?: string } | undefined
    const perm = (proposal?.required_permission ?? 'operations.manage') as OperatorPermission
    if (!can(perm)) continue
    out.push({
      id: `proposal:${p['id']}`,
      kind: 'proposal',
      severity: 'warning',
      title: proposal?.summary ?? String(p['reason']),
      why: `${p['reason']} (rule ${p['rule']}, waiting ${ageLabel(p['created_at'])})`,
      effect: 'Runs the prepared action once; anything it drafts still needs its own review.',
      undo: 'Drafts can be rejected or edited; account changes are reversible from Users.',
      href: '/operator/operations',
      required_permission: perm,
      batchable: true,
      created_at: iso(p['created_at']),
    })
  }

  if (can('overview.read')) {
    for (const a of alerts) {
      out.push({
        id: `alert:${a['dedup_key']}`,
        kind: 'alert',
        severity: (a['severity'] as DecisionSeverity) ?? 'warning',
        title: String(a['title'] ?? a['dedup_key']),
        why: `Open alert ${a['dedup_key']}${a['snoozed_until'] ? ' (snooze ended)' : ''}`,
        effect: 'Acknowledging marks it seen; it resurfaces if the signal grows.',
        undo: 'Reopen from the overview.',
        href: String(a['href'] ?? '/operator/operations'),
        required_permission: 'overview.read',
        batchable: true,
        created_at: iso(a['updated_at'] ?? a['created_at']),
      })
    }
  }

  if (can('support.manage')) {
    for (const c of cases) {
      out.push({
        id: `support_case:${c['id']}`,
        kind: 'support_case',
        severity: 'danger',
        title: `Support case past ${SUPPORT_SLA_HOURS}h: ${String(c['subject'] ?? 'no subject').slice(0, 120)}`,
        why: `No operator reply for ${ageLabel(c['updated_at'])}`,
        effect: 'Opens the case so you can reply; nothing is sent automatically.',
        undo: 'Not applicable — opening changes nothing.',
        href: '/operator/support',
        required_permission: 'support.manage',
        batchable: false,
        created_at: iso(c['updated_at']),
      })
    }
  }

  if (can('marketing.manage')) {
    for (const post of posts) {
      out.push({
        id: `post_draft:${post['id']}`,
        kind: 'post_draft',
        severity: 'info',
        title: `${post['generated'] ? 'AI-drafted' : 'Drafted'} ${post['channel']} post awaiting review`,
        why: `Draft waiting ${ageLabel(post['created_at'])}`,
        effect: 'Approving publishes it to the channel — a public, hard-to-undo act.',
        undo: 'Reject or edit before approving; a published post must be deleted on the channel.',
        href: '/operator/marketing',
        required_permission: 'marketing.manage',
        batchable: false,
        created_at: iso(post['created_at']),
      })
    }
    for (const f of failed) {
      out.push({
        id: `post_failed:${f['id']}`,
        kind: 'post_failed',
        severity: 'danger',
        title: `Post failed to publish on ${f['channel']}`,
        why: 'Publish attempt ended in publish_failed',
        effect: 'Opens the queue so you can retry or fix the channel connection.',
        undo: 'Not applicable — nothing was published.',
        href: '/operator/marketing',
        required_permission: 'marketing.manage',
        batchable: false,
        created_at: iso(f['created_at']),
      })
    }
    for (const c of campaigns) {
      out.push({
        id: `campaign_draft:${c['id']}`,
        kind: 'campaign_draft',
        severity: 'info',
        title: `Campaign draft not sent: ${String(c['name']).slice(0, 100)}`,
        why: `Draft since ${iso(c['created_at']).slice(0, 10)}`,
        effect: 'Sending emails the whole audience and needs a second operator to confirm.',
        undo: 'Cannot recall sent email; pause stops anything still queued.',
        href: '/operator/marketing',
        required_permission: 'marketing.manage',
        batchable: false,
        created_at: iso(c['created_at']),
      })
    }
  }

  // ── Social: the week to review, a missing plan, and connections that need a person ──
  if (can('marketing.manage')) {
    const planDrafts = await db
      .collection('marketing_posts')
      .find(
        { state: 'draft', content_item_id: { $exists: true }, scheduled_at: { $gt: now } },
        {
          projection: {
            _id: 0,
            channel: 1,
            scheduled_at: 1,
            copy_check: 1,
            media_url: 1,
            created_at: 1,
          },
        },
      )
      .limit(500)
      .toArray()
    const weeks = new Map<string, typeof planDrafts>()
    for (const p of planDrafts) {
      const key = mondayOf(p['scheduled_at'] as Date)
      weeks.set(key, [...(weeks.get(key) ?? []), p])
    }
    for (const [week, ps] of weeks) {
      const channels = [...new Set(ps.map((p) => String(p['channel'])))]
      const failing = ps.filter(
        (p) => (p['copy_check'] as { ok?: boolean } | undefined)?.ok === false,
      ).length
      const needImage = ps.filter((p) => p['channel'] === 'instagram' && !p['media_url']).length
      const first = ps
        .map((p) => p['scheduled_at'] as Date)
        .sort((a, b) => a.getTime() - b.getTime())[0]!
      const hoursAway = (first.getTime() - now.getTime()) / 3_600_000
      const problems = [
        failing > 0 ? `${failing} fail the copy guard` : null,
        needImage > 0
          ? `${needImage} Instagram post${needImage === 1 ? ' needs' : 's need'} an image`
          : null,
      ].filter(Boolean)
      out.push({
        id: `plan_week:${week}`,
        kind: 'plan_week',
        severity: hoursAway < 72 ? 'warning' : 'info',
        title: `Review and approve the week of ${week}: ${ps.length} posts across ${channels.length} platform${channels.length === 1 ? '' : 's'}`,
        why:
          `${channels.map(channelLabel).join(', ')}; first goes out ${first.toISOString().slice(0, 16).replace('T', ' ')} UTC. ` +
          (problems.length > 0
            ? `${problems.join('; ')} — fix before approving.`
            : 'All pass the copy guard.'),
        effect:
          'Approving the week schedules every post to publish by itself at its time. A public post cannot be unsent.',
        undo: 'Skip an item or reject a scheduled post before its time; a published post must be deleted on the platform.',
        href: '/operator/marketing',
        required_permission: 'marketing.manage',
        batchable: false,
        created_at: iso(
          ps.map((p) => p['created_at'] as Date).sort((a, b) => a.getTime() - b.getTime())[0],
        ),
      })
    }

    // From Thursday (UTC) next week should already be planned.
    const nextWeek = nextMondayKey(new Date(now.getTime() + 24 * 3_600_000))
    if (now.getUTCDay() === 0 || now.getUTCDay() >= 4) {
      const [planned, usable, optedIn] = await Promise.all([
        db.collection('content_items').countDocuments({ week_key: nextWeek }),
        allUsableChannels(db, now),
        db
          .collection('tenant_settings')
          .countDocuments({ 'automation.daily_marketing_drafts_enabled': true }),
      ])
      if (planned === 0 && usable.length > 0)
        out.push({
          id: `plan_missing:${nextWeek}`,
          kind: 'plan_missing',
          severity: 'warning',
          title: `No plan yet for the week of ${nextWeek}`,
          why:
            optedIn === 0
              ? `Automatic weekly drafting is switched off, and ${usable.length} platform connection${usable.length === 1 ? ' is' : 's are'} ready.`
              : 'Automatic drafting is on but nothing was drafted — check the connections and the AI provider.',
          effect:
            'Opening the Plan tab lets you generate the week; nothing is published until you approve it.',
          undo: 'Not applicable — drafting publishes nothing.',
          href: '/operator/marketing',
          required_permission: 'marketing.manage',
          batchable: false,
          created_at: now.toISOString(),
        })
    }

    const drifted = await db
      .collection('channel_profiles')
      .find(
        { 'drift.0': { $exists: true } },
        { projection: { _id: 0, tenant_id: 1, channel: 1, drift: 1, actual: 1 } },
      )
      .limit(MAX_DECISIONS)
      .toArray()
    for (const prof of drifted) {
      const fields = (prof['drift'] as { field: string }[]).map((d) => d.field.replace('_', ' '))
      const checkedAt = (prof['actual'] as { checked_at?: Date } | undefined)?.checked_at
      out.push({
        id: `profile_drift:${prof['tenant_id']}:${prof['channel']}`,
        kind: 'profile_drift',
        severity: 'info',
        title: `${channelLabel(String(prof['channel']))} profile differs from the approved text: ${fields.join(', ')}`,
        why: `Read from the live profile${checkedAt ? ` on ${checkedAt.toISOString().slice(0, 10)}` : ''}; the approved text is saved in Profiles.`,
        effect:
          'Nothing changes by itself. Open Profiles for the approved text to paste in (Bluesky can be applied there after you review it).',
        undo: 'Not applicable — a check changes nothing on the platform.',
        href: '/operator/marketing',
        required_permission: 'marketing.manage',
        batchable: false,
        created_at: iso(checkedAt ?? now),
      })
    }

    for (const issue of await channelIssues(db, now)) {
      const label = channelLabel(issue.channel)
      const soon = issue.status === 'expiring_soon' && issue.expires_at
      const daysLeft = soon
        ? Math.max(0, Math.ceil((issue.expires_at!.getTime() - now.getTime()) / 86_400_000))
        : 0
      out.push({
        id: `channel_attention:${issue.tenant_id}:${issue.channel}`,
        kind: 'channel_attention',
        severity: soon ? 'warning' : 'danger',
        title: soon
          ? `${label} connection expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
          : `${label} needs reconnecting`,
        why: soon
          ? `${label} tokens cannot refresh themselves; after expiry no posts can go out.`
          : (issue.last_error ?? `${label} connection is not working`),
        effect: `Reconnecting ${label} from Connect a channel restores publishing and drafting for it.`,
        undo: 'Not applicable — reconnecting changes no posts.',
        href: '/operator/marketing',
        required_permission: 'marketing.manage',
        batchable: false,
        created_at: iso(issue.updated_at ?? now),
      })
    }
  }

  for (const d of approvals) {
    const perm = d['required_permission'] as OperatorPermission
    if (!can(perm)) continue
    out.push({
      id: `dual_approval:${d['id']}`,
      kind: 'dual_approval',
      severity: 'warning',
      title: `Second-operator confirmation needed: ${d['action']}`,
      why: `Requested by another operator; reason: ${String(d['reason']).slice(0, 160)}`,
      effect: 'Confirming lets the requester run the action once.',
      undo: 'Depends on the action; the approval expires in 30 minutes if unused.',
      href: '/operator/operations',
      required_permission: perm,
      batchable: false,
      created_at: iso(d['created_at']),
    })
  }

  return out
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.created_at.localeCompare(b.created_at),
    )
    .slice(0, MAX_DECISIONS)
}
