/**
 * Quick add of a policy: POST /family/policies (and a dry-run check). One short form instead of the long
 * financial-profile wizard. Adds one entry to the household's policy list and says at once whether the
 * monthly and yearly premium agree.
 *
 * Access: household editors only (`isHouseholdEditor`). Tier 0: writes what the household typed and nothing
 * else; no model call, nothing sent out. Copy states arithmetic, never advice or a product (rule 2).
 * Writes the same place `/documents/:id/apply-policy` does (`family_financial_profile.policies`), so detectors
 * and the domain pages see the policy with no second store.
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getTenantCollection } from '@lifekeel/platform'
import { markBriefsStale } from '../briefs/briefs.js'
import { isHouseholdEditor } from '../family/family-permissions.js'
import { premiumCheck } from '../resilience/premium-check.js'
import { policyChanges, type PolicyFigure } from '../resilience/policy-changes.js'
import { MAX_MINOR } from './family-financial-profile.js'

const money = z.number().int().nonnegative().max(MAX_MINOR)

const PolicyBody = z
  .object({
    type: z.enum(['life', 'income_protection', 'critical_illness']),
    provider: z.string().trim().min(1).max(120),
    member_id: z.string().min(1).max(60).optional(),
    covers_member_id: z.string().min(1).max(60).optional(),
    coverage_amount_minor: money.optional(),
    monthly_premium_minor: money.optional(),
    annual_premium_minor: money.optional(),
    contact_phone: z.string().trim().max(40).optional(),
    contact_email: z.string().trim().max(254).optional(),
    policy_number: z.string().trim().max(60).optional(),
    renewal_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'not a real date')
      .optional(),
  })
  .strict()

// Edit: only the three figures a household changes; a different provider or type is a new policy.
const EditBody = z
  .object({
    coverage_amount_minor: money.optional(),
    monthly_premium_minor: money.optional(),
    annual_premium_minor: money.optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'nothing to change')

const CheckBody = z
  .object({ monthly_premium_minor: money.optional(), annual_premium_minor: money.optional() })
  .strict()

type Family = { members?: { id: string; user_id?: string }[] } | null

export function registerFamilyPoliciesRoutes(app: FastifyInstance, db: Db): void {
  const editor = async (req: {
    authContext: { tenant_id: string; user_id: string; roles?: string[] }
  }) =>
    isHouseholdEditor(db, req.authContext.tenant_id, req.authContext.user_id, req.authContext.roles)

  // Dry run for live typing: same function the save uses, nothing stored.
  app.post('/family/policies/check', async (req, reply) => {
    if (!(await editor(req)))
      return reply.status(403).send({ error: 'Only household editors can add policies' })
    const parsed = CheckBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid amounts' })
    return {
      check: premiumCheck(parsed.data.monthly_premium_minor, parsed.data.annual_premium_minor),
    }
  })

  app.post('/family/policies', async (req, reply) => {
    if (!(await editor(req)))
      return reply.status(403).send({ error: 'Only household editors can add policies' })
    const parsed = PolicyBody.safeParse(req.body)
    if (!parsed.success)
      return reply.status(400).send({ error: 'Invalid policy', issues: parsed.error.issues })
    const b = parsed.data
    const { tenant_id } = req.authContext

    // A person it names must be on this family's list; never a guess, never someone else's id.
    const family = (await db.collection('family_groups').findOne({ tenant_id })) as Family
    const onRoster = (id: string) => (family?.members ?? []).some((m) => m.id === id)
    for (const id of [b.member_id, b.covers_member_id])
      if (id && !onRoster(id))
        return reply.status(400).send({ error: 'That person is not on the family list' })

    const policy: Record<string, unknown> = {
      id: `pol_${randomUUID()}`,
      type: b.type,
      provider: b.provider,
      coverage_amount_minor: b.coverage_amount_minor ?? 0,
      monthly_premium_minor: b.monthly_premium_minor ?? 0,
      ...(b.annual_premium_minor ? { annual_premium_minor: b.annual_premium_minor } : {}),
      ...(b.renewal_date ? { renewal_date: b.renewal_date } : {}),
      ...(b.policy_number ? { policy_number: b.policy_number } : {}),
      ...(b.contact_phone ? { contact_phone: b.contact_phone } : {}),
      ...(b.contact_email ? { contact_email: b.contact_email } : {}),
      ...(b.member_id ? { member_id: b.member_id } : {}),
      ...(b.covers_member_id ? { beneficiary_member_id: b.covers_member_id } : {}),
    }
    await getTenantCollection<Record<string, unknown>>(
      db,
      'family_financial_profile',
      tenant_id,
    ).updateOne(
      {},
      { $push: { policies: policy }, $set: { updated_at: new Date() }, $inc: { version: 1 } },
      { upsert: true },
    )
    // A policy changes what a brief may have been built on: mark them stale so they recompute once.
    await markBriefsStale(db, tenant_id).catch(() => {})
    return reply.status(201).send({
      policy,
      check: premiumCheck(b.monthly_premium_minor, b.annual_premium_minor),
    })
  })

  // Change a premium or cover on a policy already on the list, and say what changed and what did not.
  app.patch('/family/policies/:id', async (req, reply) => {
    if (!(await editor(req)))
      return reply.status(403).send({ error: 'Only household editors can change policies' })
    const parsed = EditBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid change' })
    const { id } = req.params as { id: string }
    const { tenant_id } = req.authContext
    const col = getTenantCollection<Record<string, unknown>>(
      db,
      'family_financial_profile',
      tenant_id,
    )
    const profile = (await col.findOne({})) as { policies?: Record<string, unknown>[] } | null
    const before = (profile?.policies ?? []).find((p) => p['id'] === id)
    if (!before) return reply.status(404).send({ error: 'That policy is not on the list' })

    const patch = parsed.data as Partial<Record<PolicyFigure, number>>
    const changes = policyChanges(before as Partial<Record<PolicyFigure, number>>, patch)
    const after = {
      ...before,
      ...Object.fromEntries(changes.changed.map((c) => [c.field, c.after])),
    }
    if (changes.changed.length > 0) {
      await col.updateOne(
        {},
        {
          $set: {
            ...Object.fromEntries(
              changes.changed.map((c) => [`policies.$[p].${c.field}`, c.after]),
            ),
            updated_at: new Date(),
          },
          $inc: { version: 1 },
        },
        { arrayFilters: [{ 'p.id': id }] },
      )
      await markBriefsStale(db, tenant_id).catch(() => {})
    }
    return {
      policy: after,
      changes,
      check: premiumCheck(
        after['monthly_premium_minor'] as number | undefined,
        after['annual_premium_minor'] as number | undefined,
      ),
    }
  })
}
