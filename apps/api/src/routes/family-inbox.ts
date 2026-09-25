/**
 * Family Inbox Routes — Oak's recommendations feed (NOT a mail reader).
 *
 * GET  /inbox           — what Oak noticed and what to do next: open family
 *                         insights (protection/retirement/… gaps) plus
 *                         policy details found in the connected mailbox
 * POST /inbox/:id/dismiss — dismiss an inbox item
 *
 * Inbox items are created by the email scanning pipeline (gmail connector
 * → classify → summarize → create inbox item). When no email is connected,
 * the endpoint returns an empty list and the frontend shows mock data.
 *
 * Security: all routes require JWT auth. tenant_id from JWT, never from body.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { Engine, Insight } from '@agentoak/engine'
import { createLogger, getTenantCollection } from '@agentoak/platform'
import { evaluateProfileAndGenerateInsights, FinancialProfileSchema } from './family-financial-profile.js'
import type { PolicyType } from '../ocr/profile-mapping.js'

const log = createLogger({ service: 'family-inbox', version: '0.0.0' })

export interface InboxItemDoc {
  id: string
  tenant_id: string
  source: string
  subject: string
  ai_summary: string
  action_label: string
  action_type: 'review' | 'renew' | 'compare' | 'update' | 'info'
  priority: 'high' | 'medium' | 'low'
  date: string
  read: boolean
  dismissed: boolean
  created_at: Date
  email_message_id?: string
  connector_id?: string
  /** Policy facts stated in the email (see email/classify.ts). */
  policy_details?: import('../email/classify.js').EmailPolicyDetails
}

/** Reply/forward prefixes, [EXTERNAL] tags and (# ClaimNo … #) refs stripped, so a back-and-forth groups as one conversation. */
function threadKey(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^(\s*(re|fw|fwd)\s*:\s*|\s*\[[^\]]*\]\s*)+/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * A claim can generate dozens of near-identical mails. Collapse each
 * conversation to its newest message with a count, so the feed stays a list
 * of things to look at, not a mailbox.
 */
function groupEmailThreads<T extends { subject: string; date: string }>(items: T[]): (T & { threadCount?: number })[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = threadKey(item.subject)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.values()].map((g) => {
    const newest = [...g].sort((a, b) => (a.date < b.date ? 1 : -1))[0]!
    return g.length > 1 ? { ...newest, threadCount: g.length } : newest
  })
}

const INSIGHT_PREFIX = 'insight:'
const DOC_PREFIX = 'doc:'

const URGENCY_TO_PRIORITY: Record<string, 'high' | 'medium' | 'low'> = {
  critical: 'high',
  high: 'high',
  medium: 'medium',
  low: 'low',
}

const DETECTOR_ROUTE: Record<string, string> = {
  family_protection_gap: '/health/protection',
  family_retirement_gap: '/health/wealth',
  family_education_shortfall: '/health/goals',
  family_emergency_fund_adequacy: '/health/savings',
}

/**
 * The engine stores the rule id (e.g. "no_income_protection") as the
 * hypothesis; a person shouldn't read snake_case. Sentence-case it, and
 * pass through anything that is already prose.
 */
function feedTitle(i: Record<string, unknown>): string {
  const raw = String(i['hypothesis'] ?? i['rule_id'] ?? '')
  if (!raw) return 'Oak noticed something'
  if (/\s/.test(raw)) return raw
  const words = raw.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd → a Date at UTC midnight, else null. */
function parseDocDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? raw.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (!m) return null
  const iso = m[1]!.length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]]
  const d = new Date(Date.UTC(Number(iso[0]), Number(iso[1]) - 1, Number(iso[2])))
  return Number.isNaN(d.getTime()) ? null : d
}

const DEADLINE_WINDOW_DAYS = 30

/**
 * An insurance document Oak has read, as a feed item: a deadline inside the
 * next 30 days (e.g. a claim form) ranks high; otherwise a policy that was
 * found gets a "review and add to your profile" nudge. Informational only —
 * Oak never files or submits anything.
 */
function documentToFeedItem(d: Record<string, unknown>) {
  const fields = (d['extracted_data'] as Record<string, string> | undefined) ?? {}
  const provider = fields['provider']
  const policyNumber = fields['policy_number']
  if (!provider && !policyNumber) return null
  const uploaded = d['uploaded_at'] instanceof Date ? d['uploaded_at'].toISOString() : new Date().toISOString()
  const due = parseDocDate(fields['due_date'])
  const daysLeft = due ? Math.ceil((due.getTime() - Date.now()) / 86_400_000) : null
  const who = provider ?? 'your insurer'
  const type = fields['policy_type']?.replace(/_/g, ' ')
  const facts = [type && `Type: ${type}`, policyNumber && `Policy ${policyNumber}`, fields['beneficiary'] && `For: ${fields['beneficiary']}`].filter(Boolean).join(' · ')

  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= DEADLINE_WINDOW_DAYS) {
    return {
      id: `${DOC_PREFIX}${String(d['id'])}`,
      emoji: '',
      source: 'Oak',
      subject: `${who} form due ${daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`}`,
      aiSummary: `A document from ${who} lists ${fields['due_date']} as a due date.${facts ? ` ${facts}.` : ''} Check it with your provider — Oak only reads it and does not submit anything.`,
      actionLabel: 'Open document',
      actionType: 'review' as const,
      priority: 'high' as const,
      date: uploaded,
      read: false,
      route: `/documents/${String(d['id'])}`,
    }
  }
  return {
    id: `${DOC_PREFIX}${String(d['id'])}`,
    emoji: '',
    source: 'Oak',
    subject: `Policy found: ${who}${type ? ` ${type}` : ''}`,
    aiSummary: `Oak read a document from ${who}.${facts ? ` ${facts}.` : ''} Review it and add it to your profile so your protection check reflects it.`,
    actionLabel: 'Review policy',
    actionType: 'review' as const,
    priority: 'medium' as const,
    date: uploaded,
    read: false,
    route: `/documents/${String(d['id'])}`,
  }
}

/** An open insight, shaped as a feed item ("Oak noticed X — here's the next step"). */
function insightToFeedItem(i: Record<string, unknown>) {
  const actions = Array.isArray(i['actions']) ? (i['actions'] as unknown[]).filter((a): a is string => typeof a === 'string') : []
  const created = i['created_at'] instanceof Date ? i['created_at'].toISOString() : String(i['created_at'] ?? '')
  return {
    id: `${INSIGHT_PREFIX}${String(i['id'])}`,
    emoji: '',
    source: 'Oak',
    subject: feedTitle(i),
    aiSummary: String(i['reasoning'] ?? '').slice(0, 400),
    actionLabel: (actions[0] ?? 'Review').slice(0, 80),
    actionType: 'review' as const,
    priority: URGENCY_TO_PRIORITY[String(i['urgency'])] ?? 'medium',
    date: created,
    read: false,
    route: DETECTOR_ROUTE[String(i['detector_id'])] ?? '/health/protection',
  }
}

export function registerFamilyInboxRoutes(
  fastify: FastifyInstance,
  db: Db,
  engine?: Engine,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): void {
  const col = db.collection<InboxItemDoc>('inbox_items')

  // Same posture and mechanics as documents.ts's apply-policy: an explicit,
  // user-reviewed mutation (the Inbox card pre-fills from what the email
  // stated, but the user confirms before anything is saved), re-running the
  // detector pass in-request so a new policy's effect (a cleared protection
  // gap, a renewal-window insight) shows up immediately rather than only
  // after the next Financial Profile wizard submit.
  const regenerateInsights = async (tenantId: string): Promise<number> => {
    if (!engine) return 0
    const profiles = getTenantCollection<Record<string, unknown>>(db, 'family_financial_profile', tenantId)
    const doc = await profiles.findOne({})
    if (!doc) return 0
    const parsed = FinancialProfileSchema.safeParse(doc)
    if (!parsed.success) return 0
    return evaluateProfileAndGenerateInsights(parsed.data, tenantId, engine, db, onInsightsGenerated)
  }
  const POLICY_TYPES = new Set<PolicyType>(['life', 'income_protection', 'health', 'critical_illness', 'car', 'home', 'travel'])

  // ── GET /inbox ──────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { limit?: string; unread_only?: string } }>(
    '/inbox',
    async (req) => {
      const { tenant_id } = req.authContext
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100)
      const unreadOnly = req.query.unread_only === 'true'

      // Only emails that carried policy details are recommendations —
      // transaction alerts and receipts (and anything scanned before the
      // classifier was narrowed) are not surfaced. They are hidden, not
      // deleted.
      const filter: Record<string, unknown> = {
        tenant_id,
        dismissed: { $ne: true },
        policy_details: { $exists: true },
      }
      if (unreadOnly) filter['read'] = false

      const items = await col
        .find(filter)
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray()

      const insightDocs = unreadOnly
        ? []
        : await getTenantCollection<Record<string, unknown>>(db, 'insights', tenant_id)
            .find({ detector_id: { $regex: '^family_' }, state: { $in: ['identified', 'sent'] } })
            .sort({ created_at: -1 })
            .limit(limit)
            .toArray()

      const fromInsights = insightDocs.map((i: Record<string, unknown>) => insightToFeedItem(i))

      // Insurance documents Oak has read (uploaded or found in email) — a
      // claim form with a deadline, or a policy not yet on the profile.
      const insuranceDocs = unreadOnly
        ? []
        : await getTenantCollection<Record<string, unknown>>(db, 'documents', tenant_id)
            .find({ category: 'insurance', status: 'extracted', feed_dismissed: { $ne: true } })
            .sort({ uploaded_at: -1 })
            .limit(10)
            .toArray()
      const fromDocuments = insuranceDocs
        .map((d: Record<string, unknown>) => documentToFeedItem(d))
        .filter((x: ReturnType<typeof documentToFeedItem>): x is NonNullable<typeof x> => x !== null)
      const fromEmail = {
        items: items.map((item) => ({
          id: item.id,
          emoji: '',
          source: item.source,
          subject: item.subject,
          aiSummary: item.ai_summary,
          actionLabel: item.action_label,
          actionType: item.action_type,
          priority: item.priority,
          date: item.date,
          read: item.read,
          ...(item.policy_details ? { policy: item.policy_details } : {}),
        })),
      }
      const merged = [...fromInsights, ...fromDocuments, ...groupEmailThreads(fromEmail.items)].sort((a, b) => (a.date < b.date ? 1 : -1))
      return { items: merged.slice(0, limit) }
    },
  )

  // ── POST /inbox/:id/apply-policy ────────────────────────────────────────
  // Turns a policy Oak found in email (item.policy — see classify.ts) into
  // a real policies[] entry on the Financial Profile, the same review-then-
  // confirm shape documents.ts's identically-named endpoint already uses
  // for OCR'd documents. The email item's own extracted facts only ever
  // pre-fill the client's form; nothing here trusts them unconfirmed.
  interface ApplyPolicyBody {
    type?: string
    provider?: string
    coverageAmountMinor?: number
    monthlyPremiumMinor?: number
    renewalDate?: string
    policyNumber?: string
    memberId?: string
  }
  fastify.post<{ Params: { id: string }; Body: ApplyPolicyBody }>(
    '/inbox/:id/apply-policy',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const item = await col.findOne({ id: req.params.id, tenant_id })
      if (!item) {
        return reply.status(404).send({ error: 'Inbox item not found' })
      }

      const { type, provider, coverageAmountMinor, monthlyPremiumMinor, renewalDate, policyNumber, memberId } = req.body
      if (!type || !POLICY_TYPES.has(type as PolicyType)) {
        return reply.status(400).send({ error: 'A valid policy type is required' })
      }
      if (!provider || !provider.trim()) {
        return reply.status(400).send({ error: 'A provider name is required' })
      }

      const policy: Record<string, unknown> = {
        type,
        provider: provider.trim(),
        coverage_amount_minor: Number.isFinite(coverageAmountMinor) && (coverageAmountMinor as number) >= 0 ? coverageAmountMinor : 0,
        monthly_premium_minor: Number.isFinite(monthlyPremiumMinor) && (monthlyPremiumMinor as number) >= 0 ? monthlyPremiumMinor : 0,
      }
      if (renewalDate) policy['renewal_date'] = renewalDate
      if (policyNumber) policy['policy_number'] = policyNumber
      if (typeof memberId === 'string' && memberId.trim()) policy['member_id'] = memberId.trim()

      const profiles = getTenantCollection<Record<string, unknown>>(db, 'family_financial_profile', tenant_id)
      await profiles.updateOne(
        {},
        { $push: { policies: policy }, $set: { updated_at: new Date() } },
        { upsert: true },
      )

      // Acted on — the same "stop nudging about it" treatment applying a
      // document's suggestion gets (documents.ts sets feed_dismissed;
      // dismissing this item is this collection's equivalent).
      await col.updateOne({ id: req.params.id, tenant_id }, { $set: { dismissed: true, dismissed_at: new Date() } })

      const insightsGenerated = await regenerateInsights(tenant_id)

      log.info(
        { itemId: req.params.id, tenant_id, policyType: type, provider, insights_generated: insightsGenerated },
        'Applied an email-found policy to the financial profile',
      )

      return { applied: policy, insights_generated: insightsGenerated }
    },
  )

  // ── POST /inbox/:id/dismiss ─────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/inbox/:id/dismiss', async (req, reply) => {
    const { tenant_id } = req.authContext

    if (req.params.id.startsWith(DOC_PREFIX)) {
      const res = await getTenantCollection<Record<string, unknown>>(db, 'documents', tenant_id).updateOne(
        { id: req.params.id.slice(DOC_PREFIX.length) },
        { $set: { feed_dismissed: true } },
      )
      if (!(res as { matchedCount?: number }).matchedCount) return reply.status(404).send({ error: 'Inbox item not found' })
      return { success: true }
    }

    if (req.params.id.startsWith(INSIGHT_PREFIX)) {
      const res = await getTenantCollection<Record<string, unknown>>(db, 'insights', tenant_id).updateOne(
        { id: req.params.id.slice(INSIGHT_PREFIX.length) },
        { $set: { state: 'dismissed', dismissed_at: new Date() } },
      )
      if (!(res as { matchedCount?: number }).matchedCount) return reply.status(404).send({ error: 'Inbox item not found' })
      return { success: true }
    }

    const result = await col.findOneAndUpdate(
      { id: req.params.id, tenant_id },
      {
        $set: {
          dismissed: true,
          dismissed_at: new Date(),
        },
      },
      { returnDocument: 'after' },
    )

    if (!result) {
      return reply.status(404).send({ error: 'Inbox item not found' })
    }

    log.info({ itemId: req.params.id, tenant_id }, 'Inbox item dismissed')

    return { success: true }
  })

  // ── POST /inbox/:id/read ────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/inbox/:id/read', async (req, reply) => {
    const { tenant_id } = req.authContext

    // Insight-backed items have no read state of their own.
    if (req.params.id.startsWith(INSIGHT_PREFIX) || req.params.id.startsWith(DOC_PREFIX)) return { success: true }

    const result = await col.findOneAndUpdate(
      { id: req.params.id, tenant_id },
      { $set: { read: true, read_at: new Date() } },
      { returnDocument: 'after' },
    )

    if (!result) {
      return reply.status(404).send({ error: 'Inbox item not found' })
    }

    return { success: true }
  })
}
