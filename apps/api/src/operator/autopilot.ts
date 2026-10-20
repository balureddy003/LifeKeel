/**
 * Autopilot — supervised autonomy for the operator console.
 *
 * Every rule here is Tier 0/1 by construction: reversible, low blast
 * radius, and idempotent against its own ledger. Each executed action
 * writes an `autopilot_actions` row keyed by a unique `dedup_key` —
 * "act once per target" is enforced by the database, not by care.
 * A job that dead-letters again after its one autopilot requeue stays
 * dead for a human; a reminder that fails again stays failed.
 *
 * Trust tiers (CLAUDE.md): anything irreversible, financial, regulated,
 * or externally publishing is in NEVER_AUTONOMOUS and rejected in code —
 * config cannot enable it. Operators enable rules one at a time as the
 * ledger proves each one's precision.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { queueManager } from '../queue/QueueManager.js'
import { WEBHOOK_INGEST_QUEUE } from '../queue/WebhookQueue.js'
import { rolesWithPermission, type PlatformRole } from './operator-auth.js'
import { draftBlogPromoPost } from '../routes/marketing-posts.js'
import type { LlmFn } from '@lifekeel/platform'

export interface AutopilotRuleConfig {
  rule: string
  enabled: boolean
  /** Max targets acted on in a single sweep — the circuit breaker. */
  max_blast_radius: number
  /** Minimum minutes between this rule's sweeps. */
  cooldown_minutes: number
  last_run_at?: Date
  updated_by?: string
  updated_at?: Date
}

export interface AutopilotActionDoc {
  id: string
  rule: string
  /** `rule:target` — unique, so a rule can only ever act once on a target. */
  dedup_key: string
  target_type: string
  target_id: string
  reason: string
  /** proposed → approved (claimed) → executed | failed; rejected is terminal. */
  status: 'executed' | 'failed' | 'proposed' | 'approved' | 'rejected'
  result?: string
  /** Tier-2 proposals carry the intended mutation here — the approve
   *  route executes it server-side; the client never supplies it. */
  proposal?: {
    kind: string
    required_permission: string
    summary: string
    payload: Record<string, unknown>
  }
  resolved_by?: string
  resolved_at?: Date
  created_at: Date
}

interface Candidate {
  target_type: string
  target_id: string
  dedup_key: string
  reason: string
  /** When set, the sweep files a proposal instead of acting — a human
   *  approves or rejects from the console, and the action only happens
   *  on approval via PROPOSAL_HANDLERS. */
  proposal?: AutopilotActionDoc['proposal']
  act?: () => Promise<string>
}

interface AutopilotRule {
  id: string
  label: string
  description: string
  defaults: { max_blast_radius: number; cooldown_minutes: number }
  collect: (db: Db) => Promise<Candidate[]>
}

/** Auth-flavored publish failures — a dead token is an operator-shaped
 *  problem (reconnect), unlike content rejections which are edit-shaped. */
const AUTH_ERROR = /401|403|unauthori[sz]ed|invalid[_ ]?token|expired|needs.?reauth/i

export const AUTOPILOT_RULES: AutopilotRule[] = [
  {
    id: 'auto_unlock_expired',
    label: 'Clear expired lockouts',
    description:
      'Users whose brute-force lockout window has passed get failed_login_attempts reset — ' +
      'the same state the login path leaves them in anyway, made visible as a ledger entry.',
    defaults: { max_blast_radius: 50, cooldown_minutes: 60 },
    collect: async (db) => {
      const users = await db
        .collection('users')
        .find(
          { locked_until: { $lt: new Date() } },
          { projection: { _id: 0, id: 1, locked_until: 1 } },
        )
        .limit(200)
        .toArray()
      return users.map((u) => ({
        target_type: 'user',
        target_id: u['id'] as string,
        dedup_key: `auto_unlock_expired:${u['id']}:${(u['locked_until'] as Date)?.toISOString()}`,
        reason: 'Lockout window expired — clearing residual lock state',
        act: async () => {
          const r = await db.collection('users').updateOne(
            { id: u['id'], locked_until: { $lt: new Date() } },
            {
              $set: { failed_login_attempts: 0, updated_at: new Date() },
              $unset: { locked_until: '' },
            },
          )
          return r.modifiedCount === 0 ? 'already cleared' : 'cleared lockout residue'
        },
      }))
    },
  },
  {
    id: 'auto_requeue_dead_webhooks',
    label: 'Requeue dead webhook jobs once',
    description:
      'Dead-lettered webhook-ingest jobs get exactly one automatic requeue (attempts reset). ' +
      'A job that dies again stays dead — the ledger dedup guarantees no retry loop.',
    defaults: { max_blast_radius: 10, cooldown_minutes: 60 },
    collect: async (db) => {
      void db
      const stats = await queueManager.inspect(WEBHOOK_INGEST_QUEUE)
      if (!stats) return []
      return stats.dead_jobs
        .filter((j) => j.id !== 'malformed')
        .map((j) => ({
          target_type: 'queue_job',
          target_id: `${WEBHOOK_INGEST_QUEUE}/${j.id}`,
          dedup_key: `auto_requeue_dead_webhooks:${j.id}`,
          reason: `Dead-lettered webhook job — single automatic requeue${j.attempts ? ` (was ${j.attempts} attempts)` : ''}`,
          act: async () => {
            const moved = await queueManager.requeueDead(WEBHOOK_INGEST_QUEUE, j.id)
            return moved ? 'requeued' : 'gone before requeue — skipped'
          },
        }))
    },
  },
  {
    id: 'auto_retry_failed_reminders',
    label: 'Retry failed reminders once',
    description:
      'Reminders that exhausted their own backoff and landed failed get one fresh scheduled attempt — ' +
      'the same reset the manual operator retry performs. Once per reminder, ever.',
    defaults: { max_blast_radius: 25, cooldown_minutes: 120 },
    collect: async (db) => {
      const reminders = await db
        .collection('reminders')
        .find({ status: 'failed' }, { projection: { _id: 0, id: 1 } })
        .limit(200)
        .toArray()
      return reminders.map((r) => ({
        target_type: 'reminder',
        target_id: r['id'] as string,
        dedup_key: `auto_retry_failed_reminders:${r['id']}`,
        reason: 'Reminder exhausted retries — autopilot grants one fresh attempt',
        act: async () => {
          const res = await db.collection('reminders').updateOne(
            // status filter is the race guard — a reminder that already
            // re-failed or got manually retried is left alone.
            { id: r['id'], status: 'failed' },
            {
              $set: {
                status: 'scheduled',
                attempts: 0,
                next_attempt_at: new Date(),
                updated_at: new Date(),
              },
              $unset: { last_error: '' },
            },
          )
          return res.modifiedCount === 0 ? 'no longer failed — skipped' : 'rescheduled'
        },
      }))
    },
  },
  {
    id: 'stale_lead_alerts',
    label: 'Alert on stale leads',
    description:
      'Leads sitting in "new" beyond 48h get a persisted operator alert assigned round-robin ' +
      'to operators holding leads.manage — so the queue never silently ages.',
    defaults: { max_blast_radius: 25, cooldown_minutes: 360 },
    collect: async (db) => {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)
      const stale = await db
        .collection('leads')
        .find(
          { stage: 'new', created_at: { $lt: cutoff } },
          { projection: { _id: 0, id: 1, email: 1 } },
        )
        .limit(200)
        .toArray()
      if (stale.length === 0) return []
      // platform_operators stores role names, not resolved permissions —
      // match on whichever roles currently carry leads.manage.
      const eligible: PlatformRole[] = rolesWithPermission('leads.manage')
      const operators = await db
        .collection('platform_operators')
        .find(
          { status: 'active', roles: { $in: eligible } },
          { projection: { _id: 0, user_id: 1 } },
        )
        .toArray()
      const assigned = await db
        .collection('operator_alerts')
        .countDocuments({ dedup_key: /^stale_lead:/, assignee: { $exists: true } })
      return stale.map((lead, i) => {
        const assignee =
          operators.length > 0
            ? (operators[(assigned + i) % operators.length]!['user_id'] as string)
            : null
        return {
          target_type: 'lead',
          target_id: lead['id'] as string,
          dedup_key: `stale_lead:${lead['id']}`,
          reason: `Lead has been in "new" for over 48h${assignee ? ` — assigned to ${assignee}` : ''}`,
          act: async () => {
            // Upsert keeps an existing triage state (ack/snoozed/resolved)
            // instead of clobbering it back to open.
            await db.collection('operator_alerts').updateOne(
              { dedup_key: `stale_lead:${lead['id']}` },
              {
                $setOnInsert: {
                  dedup_key: `stale_lead:${lead['id']}`,
                  status: 'open',
                  title: `Stale lead: ${lead['email'] ?? lead['id']}`,
                  severity: 'warning',
                  href: '/operator/leads',
                  signal_value: 1,
                  ...(assignee ? { assignee } : {}),
                  created_at: new Date(),
                },
              },
              { upsert: true },
            )
            return assignee ? `alert raised, assigned to ${assignee}` : 'alert raised'
          },
        }
      })
    },
  },
  {
    id: 'channel_auth_failure_alert',
    label: 'Flag channels with repeated auth failures',
    description:
      'A channel whose last 3 publishes all failed with auth-flavored errors (dead token, expired ' +
      'grant) gets a persisted alert pointing at reconnect — distinct from content rejections ' +
      'which need an editor, not an operator.',
    defaults: { max_blast_radius: 5, cooldown_minutes: 360 },
    collect: async (db) => {
      const posts = await db
        .collection('marketing_posts')
        .find(
          { state: 'publish_failed' },
          { projection: { _id: 0, channel: 1, publish_error: 1, updated_at: 1, tenant_id: 1 } },
        )
        .sort({ updated_at: -1 })
        .limit(300)
        .toArray()
      // Last-3-per-channel: only flag when every recent attempt failed auth.
      const byChannel = new Map<string, { authish: number; total: number }>()
      for (const p of posts) {
        const key = `${p['tenant_id']}:${p['channel']}`
        const row = byChannel.get(key) ?? { authish: 0, total: 0 }
        if (row.total < 3) {
          row.total += 1
          if (AUTH_ERROR.test(String(p['publish_error'] ?? ''))) row.authish += 1
        }
        byChannel.set(key, row)
      }
      return [...byChannel.entries()]
        .filter(([, r]) => r.total >= 3 && r.authish === r.total)
        .map(([key]) => {
          const [tenantId, channel] = key.split(':')
          return {
            target_type: 'marketing_channel',
            target_id: key,
            dedup_key: `channel_auth_failure:${key}`,
            reason: `Last 3 publishes to ${channel} all failed with auth errors — reconnect needed`,
            act: async () => {
              await db.collection('operator_alerts').updateOne(
                { dedup_key: `channel_auth_failure:${key}` },
                {
                  $setOnInsert: {
                    dedup_key: `channel_auth_failure:${key}`,
                    status: 'open',
                    title: `${channel} publishing broken — token needs reconnect`,
                    severity: 'danger',
                    href: '/operator/marketing',
                    signal_value: 3,
                    created_at: new Date(),
                  },
                },
                { upsert: true },
              )
              void tenantId
              return 'alert raised'
            },
          }
        })
    },
  },
  {
    id: 'propose_suspend_brute_force',
    label: 'Propose suspending brute-forced accounts',
    description:
      'A user with 15+ failed logins in 24h across 3+ distinct IPs is a credential-stuffing ' +
      'target. Autopilot files a suspension proposal — the suspend itself stays a human call ' +
      '(users.manage), executed only on approve.',
    defaults: { max_blast_radius: 10, cooldown_minutes: 360 },
    collect: async (db) => {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const suspects = await db
        .collection('login_events')
        .aggregate([
          { $match: { success: false, user_id: { $exists: true }, created_at: { $gte: dayAgo } } },
          { $group: { _id: '$user_id', failures: { $sum: 1 }, ips: { $addToSet: '$ip' } } },
          { $match: { failures: { $gte: 15 } } },
          { $limit: 50 },
        ])
        .toArray()
      const out: Candidate[] = []
      for (const s of suspects) {
        const userId = s['_id'] as string
        const ipCount = (s['ips'] as unknown[]).length
        if (ipCount < 3) continue
        const user = await db
          .collection('users')
          .findOne({ id: userId }, { projection: { _id: 0, status: 1, email: 1 } })
        if (!user || user['status'] !== 'active') continue
        out.push({
          target_type: 'user',
          target_id: userId,
          // Day-bucketed: at most one proposal per user per day — rejected
          // proposals resurface if the attack continues, but can't spam.
          dedup_key: `propose_suspend_brute_force:${userId}:${dayAgo.toISOString().slice(0, 10)}`,
          reason: `${s['failures']} failed logins in 24h across ${ipCount} IPs`,
          proposal: {
            kind: 'user.suspend',
            required_permission: 'users.manage',
            summary: `Suspend ${user['email'] ?? userId} — ${s['failures']} failed logins / ${ipCount} IPs in 24h`,
            payload: { user_id: userId },
          },
        })
      }
      return out
    },
  },
  {
    id: 'propose_blog_promo',
    label: 'Propose promoting unpushed blog posts',
    description:
      'A published blog post older than 3 days that no channel has promoted yet gets a ' +
      '"generate a draft" proposal. Approving produces a review-gated draft — it still ' +
      'waits in the queue for human approval like every generated post.',
    defaults: { max_blast_radius: 3, cooldown_minutes: 1440 },
    collect: async (db) => {
      const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const [blogs, posts, conns] = await Promise.all([
        db
          .collection('blog_posts')
          .find(
            { published: true, published_at: { $lt: cutoff } },
            { projection: { _id: 0, slug: 1, title: 1 } },
          )
          .toArray(),
        db
          .collection('marketing_posts')
          .find({}, { projection: { _id: 0, tenant_id: 1, source_blog_slug: 1 } })
          .toArray(),
        db
          .collection('social_connections')
          .find({ status: 'active' }, { projection: { _id: 0, tenant_id: 1, channel: 1 } })
          .toArray(),
      ])
      if (conns.length === 0) return []
      const promoted = new Set(posts.map((p) => `${p['tenant_id']}:${p['source_blog_slug']}`))
      const out: Candidate[] = []
      for (const conn of conns) {
        const tenantId = conn['tenant_id'] as string
        const channel = conn['channel'] as string
        const candidate = blogs.find((b) => !promoted.has(`${tenantId}:${b['slug']}`))
        if (!candidate) continue
        const slug = candidate['slug'] as string
        out.push({
          target_type: 'blog_post',
          target_id: `${tenantId}:${slug}`,
          dedup_key: `propose_blog_promo:${tenantId}:${slug}`,
          reason: `Blog "${candidate['title']}" published >3d ago, never promoted on ${channel}`,
          proposal: {
            kind: 'marketing.blog_draft',
            required_permission: 'marketing.manage',
            summary: `Draft a ${channel} post promoting "${candidate['title']}"`,
            payload: { blog_slug: slug, tenant_id: tenantId, channel },
          },
        })
      }
      return out
    },
  },
]

/** Hard-coded, not config: these action families can never be automated.
 *  Even a super_admin cannot toggle them on — the registry doesn't carry
 *  them and the PUT route validates against the registry. Irreversible,
 *  financial, regulated, or externally publishing by construction.
 *
 *  Intent 03 made this the single publish-policy door: the former
 *  marketing-posts 'auto-trust' path (trust_level ≥ 5 auto-published new
 *  drafts) was removed rather than formalised, so earned trust can never
 *  buy an external effect anywhere in the codebase. */
export const NEVER_AUTONOMOUS = [
  'user.erase',
  'user.suspend',
  'user.export',
  'operator.grant',
  'operator.update_roles',
  'promotion.create',
  'billing.adjust_credits',
  'plan.change',
  'marketing.publish',
  'marketing.approve',
  'marketing.profile_update',
  'social.post',
  'configuration.update',
  'connector.revoke',
  'support.reply',
] as const

const RULES_BY_ID = new Map(AUTOPILOT_RULES.map((r) => [r.id, r]))

export function getAutopilotRule(id: string): AutopilotRule | undefined {
  return RULES_BY_ID.get(id)
}

function rulesCol(db: Db) {
  return db.collection<AutopilotRuleConfig>('autopilot_rules')
}
export function actionsCol(db: Db) {
  return db.collection<AutopilotActionDoc>('autopilot_actions')
}

/** What an approved proposal actually does — server-side only. The
 *  approve route looks the kind up here and passes the stored payload;
 *  nothing about the action is supplied by the client. Every handler is
 *  the same mutation a human operator would trigger through the
 *  corresponding endpoint. */
export interface ProposalDeps {
  /** Governed-fn factory — one policy-bound LlmFn per tenant (intent 01). */
  llmFor?: (tenantId: string) => LlmFn
}
export const PROPOSAL_HANDLERS: Record<
  string,
  (db: Db, payload: Record<string, unknown>, deps: ProposalDeps) => Promise<string>
> = {
  'user.suspend': async (db, payload) => {
    const userId = payload['user_id'] as string
    const result = await db.collection('users').updateOne(
      { id: userId, status: { $nin: ['suspended', 'erased'] } },
      {
        $set: {
          status: 'suspended',
          suspended_at: new Date(),
          sessions_revoked_at: new Date(),
          updated_at: new Date(),
        },
      },
    )
    return result.modifiedCount === 0
      ? 'user already suspended/erased — no-op'
      : 'user suspended, sessions revoked'
  },
  'marketing.blog_draft': async (db, payload, deps) => {
    if (!deps.llmFor) throw new Error('No LLM provider — cannot generate draft')
    const post = await draftBlogPromoPost(
      db,
      deps.llmFor,
      payload['tenant_id'] as string,
      payload['blog_slug'] as string,
      payload['channel'] as string,
    )
    return post ? `draft ${post.id} queued for review` : 'blog post no longer exists — no-op'
  },
}

export function ensureAutopilotIndexes(db: Db): void {
  actionsCol(db)
    .createIndex({ dedup_key: 1 }, { unique: true })
    .catch(() => {})
  actionsCol(db)
    .createIndex({ created_at: -1 })
    .catch(() => {})
  db.collection('operator_digests')
    .createIndex({ created_at: -1 })
    .catch(() => {})
}

/** Config merged over registry defaults — a rule with no stored doc is
 *  present-but-disabled, so enabling is always a deliberate act. */
export async function listAutopilotRules(
  db: Db,
): Promise<(AutopilotRuleConfig & { label: string; description: string })[]> {
  const stored = new Map((await rulesCol(db).find({}).toArray()).map((c) => [c.rule, c]))
  return AUTOPILOT_RULES.map((r) => ({
    rule: r.id,
    label: r.label,
    description: r.description,
    enabled: stored.get(r.id)?.enabled ?? false,
    max_blast_radius: stored.get(r.id)?.max_blast_radius ?? r.defaults.max_blast_radius,
    cooldown_minutes: stored.get(r.id)?.cooldown_minutes ?? r.defaults.cooldown_minutes,
    ...(stored.get(r.id)?.last_run_at ? { last_run_at: stored.get(r.id)!.last_run_at } : {}),
    ...(stored.get(r.id)?.updated_by ? { updated_by: stored.get(r.id)!.updated_by } : {}),
    ...(stored.get(r.id)?.updated_at ? { updated_at: stored.get(r.id)!.updated_at } : {}),
  }))
}

/** One sweep of every enabled, off-cooldown rule. Each candidate is acted
 *  on under the unique-dedup-key insert — first writer wins, so racing
 *  sweeps (multi-replica, or manual + cron) can't double-act. Returns the
 *  ledger rows written this sweep. */
export async function runAutopilotSweep(db: Db): Promise<AutopilotActionDoc[]> {
  const rules = await listAutopilotRules(db)
  const now = Date.now()
  const executed: AutopilotActionDoc[] = []

  for (const cfg of rules) {
    if (!cfg.enabled) continue
    if (cfg.last_run_at && now - cfg.last_run_at.getTime() < cfg.cooldown_minutes * 60_000) continue
    const def = RULES_BY_ID.get(cfg.rule)
    if (!def) continue

    let acted = 0
    const candidates = await def.collect(db)
    for (const c of candidates) {
      if (acted >= cfg.max_blast_radius) break
      // Ledger insert first — the unique dedup_key makes "already acted
      // or proposed" atomic, so the act is only attempted once per target.
      const isProposal = c.proposal !== undefined
      const row: AutopilotActionDoc = {
        id: randomUUID(),
        rule: cfg.rule,
        dedup_key: c.dedup_key,
        target_type: c.target_type,
        target_id: c.target_id,
        reason: c.reason,
        status: isProposal ? 'proposed' : 'executed',
        ...(c.proposal ? { proposal: c.proposal } : {}),
        created_at: new Date(),
      }
      try {
        await actionsCol(db).insertOne(row)
      } catch {
        continue // dedup — this target was already handled
      }
      if (!isProposal && c.act) {
        try {
          row.result = await c.act()
        } catch (err) {
          row.status = 'failed'
          row.result = String(err).slice(0, 300)
        }
        await actionsCol(db).updateOne(
          { id: row.id },
          { $set: { status: row.status, result: row.result } },
        )
        if (row.status === 'executed') acted += 1
      } else {
        acted += 1 // proposals count against the blast radius too
      }
      executed.push(row)

      // Operator-visible audit trail — actor is the autopilot itself,
      // distinguishable from every human operator row.
      await db.collection('operator_audit_log').insertOne({
        operator_user_id: 'autopilot',
        operator_roles: [] as string[],
        operator_source: 'autopilot',
        action: isProposal ? 'autopilot.propose' : 'autopilot.action',
        target_type: c.target_type,
        target_id: c.target_id,
        reason: `${cfg.rule}: ${c.reason}`,
        metadata: { rule: cfg.rule, status: row.status, result: row.result },
        request_id: '',
        ip: '',
        user_agent: '',
        created_at: new Date(),
      })
    }
    await rulesCol(db).updateOne(
      { rule: cfg.rule },
      { $set: { last_run_at: new Date() }, $setOnInsert: { rule: cfg.rule, enabled: cfg.enabled } },
      { upsert: true },
    )
  }
  return executed
}
