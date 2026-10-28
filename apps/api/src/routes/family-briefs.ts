/**
 * Household briefs — PRD-222 (Stage 1).
 *
 * Hot path: POST creates a brief in one solver call and mints a share
 * link; GET /b/:token serves the stored result (never recomputes, never
 * touches the profile or a model). Two timestamps:
 *
 *   link_fetched_at      first GET — telemetry only; link unfurlers and
 *                        mail scanners set this. Never shown as "opened".
 *   confirmed_opened_at  POST /b/:token/confirm — the product promise.
 *                        A confirm from the creator's own session is
 *                        recorded as self_viewed_at, not a confirmed open.
 *
 * First brief per household is free; a second brief requires the
 * household_record entitlement (or an existing paid plan) → 402
 * brief_gate + brief_gate_hit event.
 */
import type { Db } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { randomBytes, randomUUID } from 'node:crypto'
import { getTenantCollection } from '@lifekeel/platform'
import { getAuditLogger } from '../audit/audit-log.js'
import { isHouseholdEditor } from '../family/family-permissions.js'
import {
  BRIEF_PROBLEM_TYPES,
  BRIEF_SOLVER_VERSION,
  SHARE_TOKEN_TTL_DAYS,
  briefDataVersion,
  briefsFor,
  emitBriefEvent,
  solveBrief,
  tokenHash,
  type BriefInputs,
  type BriefProblemType,
  type HouseholdBriefDoc,
} from '../briefs/briefs.js'

interface FamilyGroupsDoc extends Record<string, unknown> {
  members?: Array<{ user_id?: string; name?: string; role?: string }>
}
interface TenantDoc extends Record<string, unknown> {
  plan?: string
  entitlements?: Record<string, unknown> | string[]
}

const PAID_PLANS = new Set(['plus', 'family', 'pro', 'unlimited'])
const num = (v: unknown, lo = 0, hi = 1e9) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null

function badInputs(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, msg: string) {
  return reply.code(400).send({ error: msg })
}

/** Resolve the member the share link is addressed to (display name only). */
async function memberName(
  db: Db,
  tenantId: string,
  forMemberId: string | null,
): Promise<{ id: string | null; name: string | null }> {
  if (!forMemberId) return { id: null, name: null }
  const doc = await db
    .collection('family_groups')
    .findOne<FamilyGroupsDoc>({ tenant_id: tenantId }, { projection: { members: 1 } })
  const m = doc?.members?.find((x) => x.user_id === forMemberId)
  return { id: forMemberId, name: m?.name ?? null }
}

async function tenantEntitled(db: Db, tenantId: string): Promise<boolean> {
  const t = await db.collection('tenants').findOne<TenantDoc>({ tenant_id: tenantId })
  if (!t) return false
  if (t.plan && PAID_PLANS.has(t.plan)) return true
  const ent = t.entitlements
  if (Array.isArray(ent)) return ent.includes('household_record')
  return ent?.household_record === true
}

function briefView(b: HouseholdBriefDoc, revealToken?: string) {
  return {
    id: b.id,
    problem_type: b.problem_type,
    inputs: b.inputs,
    result: b.result,
    template_sentence: b.template_sentence,
    solver_version: b.solver_version,
    data_version: b.data_version,
    stale: b.stale,
    share: b.share
      ? {
          for_member_id: b.share.for_member_id,
          for_member_name: b.share.for_member_name,
          expires_at: b.share.expires_at,
          revoked: !!b.share.revoked_at,
          url: revealToken ?? undefined,
        }
      : null,
    link_fetched_at: b.link_fetched_at,
    confirmed_opened_at: b.confirmed_opened_at,
    created_by: b.created_by,
    created_at: b.created_at,
  }
}

/** Handover sections — names/locations only, never raw files or balances. */
async function handoverSections(db: Db, tenantId: string) {
  const [group, docs, assets, profile] = await Promise.all([
    db
      .collection('family_groups')
      .findOne<{ members?: Array<Record<string, unknown>> }>(
        { tenant_id: tenantId },
        { projection: { members: 1, legacy_contacts: 1, children: 1 } },
      ),
    getTenantCollection<{ title?: string; doc_type?: string; section?: string }>(
      db,
      'documents',
      tenantId,
    )
      .find({})
      .limit(50)
      .toArray(),
    getTenantCollection<{ label?: string; name?: string; kind?: string }>(
      db,
      'family_assets',
      tenantId,
    )
      .find({})
      .limit(50)
      .toArray(),
    getTenantCollection<{ policies?: Array<Record<string, unknown>> }>(
      db,
      'family_financial_profile',
      tenantId,
    ).findOne({}, { projection: { policies: 1 } }),
  ])
  return {
    adults: (group?.members ?? []).map((m) => ({
      name: m['name'] ?? null,
      role: m['role'] ?? null,
    })),
    key_papers: docs.map((d: { title?: string }) => ({
      title: d.title ?? 'Document',
      location: 'In LifeKeel documents',
    })),
    accounts: assets.map((a: { label?: string; name?: string; kind?: string }) => ({
      name: a.label ?? a.name ?? null,
      kind: a.kind ?? null,
    })),
    policies: (profile?.policies ?? []).map((p) => ({
      type: p['policy_type'] ?? p['type'] ?? null,
      provider: p['provider'] ?? null,
      renewal_date: p['renewal_date'] ?? null,
    })),
  }
}

export function registerFamilyBriefRoutes(app: FastifyInstance, db: Db) {
  const audit = () => getAuditLogger()

  /** POST /family/briefs — create a brief + share link (Tier 0). */
  app.post<{
    Body: { problem_type?: string; inputs?: BriefInputs; for_member_id?: string | null }
  }>('/family/briefs', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    const { tenant_id, user_id, roles } = ctx
    if (!(await isHouseholdEditor(db, tenant_id, user_id, roles)))
      return reply.code(403).send({ error: 'Only a household editor can create a brief' })

    const problem = req.body?.problem_type
    if (!problem || !BRIEF_PROBLEM_TYPES.includes(problem as BriefProblemType))
      return badInputs(reply, 'problem_type must be income_stops, earning_less or handover_gap')
    const inputs = req.body?.inputs ?? {}
    const cleaned: BriefInputs = {
      monthly_income_minor: num(inputs.monthly_income_minor, 0) ?? undefined,
      monthly_essentials_minor: num(inputs.monthly_essentials_minor, 0) ?? undefined,
      liquid_savings_minor: num(inputs.liquid_savings_minor, 0) ?? undefined,
      income_protection_monthly_minor: num(inputs.income_protection_monthly_minor, 0) ?? undefined,
      deferred_period_months: num(inputs.deferred_period_months, 0, 240) ?? undefined,
      new_income_minor: num(inputs.new_income_minor, 0) ?? undefined,
      months_until_change: num(inputs.months_until_change, 0, 600) ?? undefined,
    }

    // First brief free — the second-brief gate (PRD-223's drop-off point).
    const existing = await briefsFor(db, tenant_id).countDocuments({})
    if (existing >= 1 && !(await tenantEntitled(db, tenant_id))) {
      await emitBriefEvent(db, tenant_id, 'brief_gate_hit', { problem_type: problem })
      return reply.code(402).send({
        error: 'brief_gate',
        message:
          'The first brief is free. Keeping the record and further briefs need the household record.',
        required_entitlement: 'household_record',
      })
    }

    const solved = solveBrief(problem as BriefProblemType, cleaned)
    if ('error' in solved) return badInputs(reply, solved.error)

    const token = randomBytes(24).toString('hex')
    const member = await memberName(db, tenant_id, req.body?.for_member_id ?? null)
    const now = new Date()
    const doc: HouseholdBriefDoc = {
      id: `brief_${randomUUID()}`,
      tenant_id,
      problem_type: problem as BriefProblemType,
      inputs: cleaned,
      result: solved.result,
      template_sentence: solved.template_sentence,
      narrated_sentence: null,
      solver_version: BRIEF_SOLVER_VERSION,
      data_version: briefDataVersion(problem as BriefProblemType, cleaned),
      stale: false,
      share: {
        token_hash: tokenHash(token),
        for_member_id: member.id,
        for_member_name: member.name,
        expires_at: new Date(now.getTime() + SHARE_TOKEN_TTL_DAYS * 86_400_000),
        revoked_at: null,
      },
      link_fetched_at: null,
      confirmed_opened_at: null,
      confirmed_by: null,
      created_by: user_id,
      created_at: now,
      updated_at: now,
    }
    await briefsFor(db, tenant_id).insertOne(doc)
    await emitBriefEvent(db, tenant_id, 'brief_created', { problem_type: problem })
    await emitBriefEvent(db, tenant_id, 'brief_share_link_generated', { problem_type: problem })
    await audit()?.fromRequest(req, 'brief.created', 'household_briefs', doc.id, {
      problem_type: problem,
    })
    return reply.code(201).send({ brief: briefView(doc, token) })
  })

  /** GET /family/briefs — the household's briefs, newest first. */
  app.get('/family/briefs', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    const { tenant_id } = ctx
    const list = await briefsFor(db, tenant_id)
      .find({})
      .sort({ created_at: -1 })
      .limit(50)
      .toArray()
    return { briefs: list.map((b: HouseholdBriefDoc) => briefView(b)) }
  })

  /** GET /family/briefs/:id — recompute once if inputs went stale. */
  app.get<{ Params: { id: string } }>('/family/briefs/:id', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    const { tenant_id } = ctx
    let b = await briefsFor(db, tenant_id).findOne({ id: req.params.id })
    if (!b) return reply.code(404).send({ error: 'Brief not found' })
    if (b.stale) {
      const solved = solveBrief(b.problem_type, b.inputs)
      if (!('error' in solved)) {
        b = {
          ...b,
          result: solved.result,
          template_sentence: solved.template_sentence,
          stale: false,
        }
        await briefsFor(db, tenant_id).updateOne(
          { id: b.id },
          {
            $set: {
              result: solved.result,
              template_sentence: solved.template_sentence,
              stale: false,
              updated_at: new Date(),
            },
          },
        )
      }
    }
    const extra =
      b.problem_type === 'handover_gap' ? { sections: await handoverSections(db, tenant_id) } : {}
    return { brief: { ...briefView(b), ...extra } }
  })

  /** POST /family/briefs/:id/revoke — kill the share link (410 on next fetch). */
  app.post<{ Params: { id: string } }>('/family/briefs/:id/revoke', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    const { tenant_id, user_id, roles } = ctx
    if (!(await isHouseholdEditor(db, tenant_id, user_id, roles)))
      return reply.code(403).send({ error: 'Only a household editor can revoke a brief link' })
    const res = await briefsFor(db, tenant_id).updateOne(
      { id: req.params.id, 'share.revoked_at': null },
      { $set: { 'share.revoked_at': new Date(), updated_at: new Date() } },
    )
    if (!(res as { matchedCount?: number }).matchedCount)
      return reply.code(404).send({ error: 'Brief not found or already revoked' })
    await audit()?.fromRequest(req, 'brief.share_revoked', 'household_briefs', req.params.id, {})
    return { ok: true }
  })

  /** POST /family/briefs/:id/share — re-mint a link (after expiry/revoke). */
  app.post<{ Params: { id: string }; Body: { for_member_id?: string | null } }>(
    '/family/briefs/:id/share',
    async (req, reply) => {
      const ctx = req.authContext
      if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
      const { tenant_id, user_id, roles } = ctx
      if (!(await isHouseholdEditor(db, tenant_id, user_id, roles)))
        return reply.code(403).send({ error: 'Only a household editor can share a brief' })
      const member = await memberName(db, tenant_id, req.body?.for_member_id ?? null)
      const token = randomBytes(24).toString('hex')
      const now = new Date()
      const res = await briefsFor(db, tenant_id).updateOne(
        { id: req.params.id },
        {
          $set: {
            share: {
              token_hash: tokenHash(token),
              for_member_id: member.id,
              for_member_name: member.name,
              expires_at: new Date(now.getTime() + SHARE_TOKEN_TTL_DAYS * 86_400_000),
              revoked_at: null,
            },
            link_fetched_at: null,
            confirmed_opened_at: null,
            confirmed_by: null,
            updated_at: now,
          },
        },
      )
      if (!(res as { matchedCount?: number }).matchedCount)
        return reply.code(404).send({ error: 'Brief not found' })
      await emitBriefEvent(db, tenant_id, 'brief_share_link_generated', { brief_id: req.params.id })
      await audit()?.fromRequest(req, 'brief.share_created', 'household_briefs', req.params.id, {})
      return {
        share: {
          url: token,
          expires_at: new Date(now.getTime() + SHARE_TOKEN_TTL_DAYS * 86_400_000),
        },
      }
    },
  )

  /** GET /b/:token — public share view. No-store; fetched ≠ opened. */
  app.get<{ Params: { token: string } }>('/b/:token', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    // The token alone identifies the tenant — scan without tenant filter.
    const brief = await db
      .collection('household_briefs')
      .findOne<HouseholdBriefDoc>({ 'share.token_hash': tokenHash(req.params.token) })
    if (!brief?.share) return reply.code(404).send({ error: 'Link not found or expired' })
    if (brief.share.revoked_at) return reply.code(410).send({ error: 'This link was revoked' })
    if (brief.share.expires_at.getTime() < Date.now())
      return reply.code(404).send({ error: 'Link not found or expired' })
    if (!brief.link_fetched_at) {
      await db
        .collection('household_briefs')
        .updateOne(
          { id: brief.id, link_fetched_at: null },
          { $set: { link_fetched_at: new Date() } },
        )
      await emitBriefEvent(db, brief.tenant_id, 'brief_link_fetched', {
        problem_type: brief.problem_type,
      })
    }
    const extra =
      brief.problem_type === 'handover_gap'
        ? { sections: await handoverSections(db, brief.tenant_id) }
        : {}
    return {
      problem_type: brief.problem_type,
      result: brief.result,
      template_sentence: brief.template_sentence,
      for_member_name: brief.share.for_member_name,
      confirmed_opened_at: brief.confirmed_opened_at,
      created_at: brief.created_at,
      ...extra,
    }
  })

  /** POST /b/:token/confirm — the explicit "view the numbers" action. */
  app.post<{ Params: { token: string }; Body: { member_id?: string } }>(
    '/b/:token/confirm',
    async (req, reply) => {
      reply.header('Cache-Control', 'private, no-store')
      const brief = await db
        .collection('household_briefs')
        .findOne<HouseholdBriefDoc>({ 'share.token_hash': tokenHash(req.params.token) })
      if (!brief?.share) return reply.code(404).send({ error: 'Link not found or expired' })
      if (brief.share.revoked_at) return reply.code(410).send({ error: 'This link was revoked' })
      if (brief.share.expires_at.getTime() < Date.now())
        return reply.code(404).send({ error: 'Link not found or expired' })

      const confirmer = req.authContext?.user_id ?? null
      const isSelf = confirmer !== null && confirmer === brief.created_by
      if (!brief.confirmed_opened_at && !isSelf) {
        await db
          .collection('household_briefs')
          .updateOne(
            { id: brief.id, confirmed_opened_at: null },
            { $set: { confirmed_opened_at: new Date(), confirmed_by: confirmer } },
          )
        await emitBriefEvent(db, brief.tenant_id, 'brief_confirmed_open', {
          problem_type: brief.problem_type,
        })
      }
      // A self-open is recorded nowhere on the promise path — it must not
      // count as "the other adult has seen it" (PRD-222).
      const fresh = await db
        .collection('household_briefs')
        .findOne<HouseholdBriefDoc>({ id: brief.id })
      return {
        confirmed: !isSelf,
        confirmed_opened_at: fresh?.confirmed_opened_at ?? null,
      }
    },
  )
}
