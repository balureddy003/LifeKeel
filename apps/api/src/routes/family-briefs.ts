/**
 * Immutable household briefs. New catalogue shares are addressed to an active
 * adult and require that participant's session. Acknowledgements bind each
 * adult to the same stored result hash; link fetches are telemetry only.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getAuditLogger } from '../audit/audit-log.js'
import {
  isFamilyAdult,
  isHouseholdEditor,
  isMinorMember,
  memberMatchesUser,
} from '../family/family-permissions.js'
import type { FamilyGroupDoc } from './family-group.js'
import { taskLlm } from '../ai/task-gateway.js'
import { encryptForTenant, decryptEnveloped } from '../crypto/envelope.js'
import { BRIEF_CATALOGUE, solveCatalogueBrief, type BriefFact } from '../briefs/catalogue.js'
import {
  BRIEF_PROBLEM_TYPES,
  SENSITIVE_FACTS_TTL_MS,
  BRIEF_SOLVER_VERSION,
  SHARE_TOKEN_TTL_DAYS,
  briefDataVersion,
  briefsFor,
  emitBriefEvent,
  narrateBrief,
  solveBrief,
  tokenHash,
  type BriefInputs,
  type BriefProblemType,
  type HouseholdBriefDoc,
} from '../briefs/briefs.js'

const PAID_PLANS = new Set(['plus', 'family', 'pro', 'unlimited'])
const CreateSchema = z
  .object({
    contract_version: z.literal(2).optional(),
    problem_type: z.string().max(80),
    inputs: z.record(z.string(), z.unknown()),
    for_member_id: z.string().max(120).nullable().optional(),
  })
  .strict()
const AckSchema = z.object({ result_version: z.string().length(64) }).strict()

async function tenantEntitled(db: Db, tenantId: string): Promise<boolean> {
  const t = await db
    .collection('tenants')
    .findOne<{ plan?: string; entitlements?: unknown }>({ tenant_id: tenantId })
  if (t?.plan && PAID_PLANS.has(t.plan)) return true
  const ent = t?.entitlements as unknown
  return Array.isArray(ent)
    ? ent.includes('household_record')
    : (ent as Record<string, unknown>)?.['household_record'] === true
}

/** A confirmation only counts for the exact stored version and intended users. */
function confirmation(b: HouseholdBriefDoc) {
  const acks = (b.acknowledgements ?? []).filter((a) => a.result_version === b.result_version)
  const creator = acks.find((a) => a.user_id === b.created_by)?.confirmed_at ?? null
  const recipient = acks.find((a) => a.user_id === b.share?.for_user_id)?.confirmed_at ?? null
  return { creator_at: creator, recipient_at: recipient, both_confirmed: !!creator && !!recipient }
}

function briefView(b: HouseholdBriefDoc, token?: string, facts?: BriefFact[]) {
  return {
    id: b.id,
    problem_type: b.problem_type,
    contract_version: b.contract_version,
    title: b.title,
    inputs: b.inputs,
    result: b.result,
    template_sentence: b.template_sentence,
    facts: facts ?? b.facts ?? [],
    sensitive: !!b.sensitive,
    sensitive_access: b.sensitive_access ?? [],
    solver_version: b.solver_version,
    data_version: b.data_version,
    result_version: b.result_version,
    as_of_date: b.as_of_date,
    stale: b.stale,
    confirmation: confirmation(b),
    share: b.share
      ? {
          for_member_id: b.share.for_member_id,
          for_member_name: b.share.for_member_name,
          expires_at: b.share.expires_at,
          revoked: !!b.share.revoked_at,
          url: token,
        }
      : null,
    link_fetched_at: b.link_fetched_at,
    confirmed_opened_at: b.confirmed_opened_at,
    created_by: b.created_by,
    created_at: b.created_at,
  }
}

export function registerFamilyBriefRoutes(app: FastifyInstance, db: Db) {
  /**
   * Decrypt envelope-stored facts for sensitive briefs; undefined = use stored.
   * Intent 79: expired sensitive facts are purged on read (DPIA retention),
   * and every successful decrypt records a content-free access entry —
   * who opened it and when, never what.
   */
  async function factsFor(b: HouseholdBriefDoc, viewer?: string): Promise<BriefFact[] | undefined> {
    if (!b.facts_encrypted) return undefined
    // Encrypted facts need a signed-in participant. An anonymous read gets
    // nothing and leaves a trace of the attempt — never 'anonymous' as if it
    // were a legitimate viewer.
    if (!viewer) {
      await briefsFor(db, b.tenant_id).updateOne(
        { id: b.id },
        { $push: { sensitive_access: { user_id: 'anonymous_denied', at: new Date() } } },
      )
      return []
    }
    if (b.facts_expire_at && b.facts_expire_at < new Date()) {
      await briefsFor(db, b.tenant_id).updateOne(
        { id: b.id },
        { $unset: { facts_encrypted: '', facts: '' } },
      )
      return []
    }
    const facts = JSON.parse((await decryptEnveloped(db, b.facts_encrypted)) ?? '[]')
    await briefsFor(db, b.tenant_id).updateOne(
      { id: b.id },
      { $push: { sensitive_access: { user_id: viewer ?? 'anonymous', at: new Date() } } },
    )
    return facts
  }

  async function recipient(tenant: string, creator: string, id: string | null | undefined) {
    const group = await db
      .collection<FamilyGroupDoc>('family_groups')
      .findOne({ tenant_id: tenant })
    return group?.members.find(
      (m) =>
        m.id === id && m.status === 'active' && !isMinorMember(m) && !memberMatchesUser(m, creator),
    )
  }
  async function participant(b: HouseholdBriefDoc, ctx?: { tenant_id: string; user_id: string }) {
    return (
      !!ctx &&
      ctx.tenant_id === b.tenant_id &&
      (ctx.user_id === b.created_by || ctx.user_id === b.share?.for_user_id) &&
      (await isFamilyAdult(db, b.tenant_id, ctx.user_id))
    )
  }
  async function loadShare(token: string) {
    return db
      .collection<HouseholdBriefDoc>('household_briefs')
      .findOne({ 'share.token_hash': tokenHash(token) })
  }
  function shareError(b: HouseholdBriefDoc | null | undefined) {
    if (!b?.share) return { status: 404, error: 'Link not found or expired' }
    if (b.share.revoked_at) return { status: 410, error: 'This link was revoked' }
    if (b.share.expires_at.getTime() <= Date.now())
      return { status: 404, error: 'Link not found or expired' }
    return null
  }
  async function acknowledge(b: HouseholdBriefDoc, user: string) {
    const now = new Date()
    // Atomic idempotency: duplicate clicks cannot create duplicate receipts.
    await briefsFor(db, b.tenant_id).updateOne(
      {
        id: b.id,
        result_version: b.result_version,
        acknowledgements: {
          $not: { $elemMatch: { user_id: user, result_version: b.result_version } },
        },
      },
      {
        $push: {
          acknowledgements: { user_id: user, result_version: b.result_version!, confirmed_at: now },
        },
        ...(user === b.share?.for_user_id
          ? { $set: { confirmed_opened_at: now, confirmed_by: user } }
          : {}),
      },
    )
    const fresh = await briefsFor(db, b.tenant_id).findOne({ id: b.id })
    return {
      confirmed: true,
      confirmation: confirmation(fresh!),
      confirmed_opened_at: fresh!.confirmed_opened_at,
    }
  }

  app.get('/family/brief-catalogue', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    if (!(await isFamilyAdult(db, tenant_id, user_id)))
      return reply.code(403).send({ error: 'An active adult household membership is required' })
    const group = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id })
    return {
      catalogue: BRIEF_CATALOGUE,
      current_user_id: user_id,
      // Lets the form say up front that this person cannot create briefs.
      can_create: await isHouseholdEditor(db, tenant_id, user_id, req.authContext.roles),
      recipients: (group?.members ?? [])
        .filter((m) => m.status === 'active' && !isMinorMember(m) && !memberMatchesUser(m, user_id))
        .map((m) => ({ id: m.id, name: m.name })),
    }
  })

  /**
   * POST /family/briefs/preview — the answer as the household types, before
   * anything is saved or shared. Same deterministic solver as create: no model,
   * no storage, no entitlement gate (nothing is created). Money briefs only;
   * handover entries hold no calculation and may be sensitive, so they are
   * never previewed.
   */
  app.post(
    '/family/briefs/preview',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const ctx = req.authContext
      if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
      if (!(await isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles)))
        return reply.code(403).send({ error: 'Only a household editor can create a brief' })
      const parsed = z
        .object({ problem_type: z.string().max(80), inputs: z.record(z.string(), z.unknown()) })
        .strict()
        .safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid brief inputs' })
      const entry = BRIEF_CATALOGUE.find((e) => e.id === parsed.data.problem_type)
      if (!entry || entry.mode === 'handover')
        return reply.code(400).send({ error: 'This kind of brief has no calculation to preview' })
      try {
        const solved = solveCatalogueBrief(
          parsed.data.problem_type,
          parsed.data.inputs,
          new Date().toISOString().slice(0, 10),
        )
        return {
          preview: {
            template_sentence: solved.template_sentence,
            result: solved.result,
            facts: solved.facts,
          },
        }
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message })
      }
    },
  )

  app.post('/family/briefs', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    const { tenant_id, user_id, roles } = ctx
    if (!(await isHouseholdEditor(db, tenant_id, user_id, roles)))
      return reply.code(403).send({ error: 'Only a household editor can create a brief' })
    const parsed = CreateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid brief inputs' })
    const { problem_type: problem, inputs, contract_version } = parsed.data
    const now = new Date()
    const asOf = now.toISOString().slice(0, 10)
    const member =
      contract_version === 2 ? await recipient(tenant_id, user_id, parsed.data.for_member_id) : null
    if (contract_version === 2 && !member)
      return reply.code(400).send({
        error: 'Choose another active adult in your household. Invite them from Family if needed.',
      })
    if (contract_version === 2 && !(await isFamilyAdult(db, tenant_id, user_id)))
      return reply.code(403).send({ error: 'An active adult household membership is required' })
    let solved
    try {
      if (contract_version === 2) solved = solveCatalogueBrief(problem, inputs, asOf)
      else {
        if (!BRIEF_PROBLEM_TYPES.includes(problem as BriefProblemType))
          throw new Error('Choose a supported brief')
        const legacy = z
          .object({
            monthly_income_minor: z.number().int().nonnegative().max(1e9).optional(),
            monthly_essentials_minor: z.number().int().nonnegative().max(1e9).optional(),
            liquid_savings_minor: z.number().int().nonnegative().max(1e9).optional(),
            income_protection_monthly_minor: z.number().int().nonnegative().max(1e9).optional(),
            deferred_period_months: z.number().int().min(0).max(240).optional(),
            new_income_minor: z.number().int().nonnegative().max(1e9).optional(),
            months_until_change: z.number().int().min(0).max(600).optional(),
          })
          .strict()
          .parse(inputs)
        const result = solveBrief(problem as BriefProblemType, legacy)
        if ('error' in result) throw new Error(result.error)
        solved = { ...result, inputs: legacy, facts: [], warnings: [] }
      }
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof z.ZodError ? 'Invalid amounts' : (err as Error).message })
    }
    if (
      (await briefsFor(db, tenant_id).countDocuments({})) >= 1 &&
      !(await tenantEntitled(db, tenant_id))
    ) {
      await emitBriefEvent(db, tenant_id, 'brief_gate_hit', { problem_type: problem })
      return reply.code(402).send({
        error: 'brief_gate',
        required_entitlement: 'household_record',
        message: 'Your first brief is free. Further briefs need the household record.',
      })
    }
    const token = randomBytes(24).toString('hex')
    const entry = BRIEF_CATALOGUE.find((e) => e.id === problem)
    const sensitive = !!entry?.sensitive
    const title = entry?.title ?? problem
    const solverVersion = contract_version === 2 ? 'brief-v2' : BRIEF_SOLVER_VERSION
    const resultVersion = createHash('sha256')
      .update(
        JSON.stringify({
          title,
          solverVersion,
          asOf,
          inputs: solved.inputs,
          result: solved.result,
          facts: solved.facts,
          sentence: solved.template_sentence,
        }),
      )
      .digest('hex')
    const doc: HouseholdBriefDoc = {
      id: `brief_${randomUUID()}`,
      tenant_id,
      problem_type: problem,
      title,
      inputs: solved.inputs as BriefInputs,
      result: solved.result,
      ...(sensitive
        ? {
            facts: [] as BriefFact[],
            sensitive: true,
            facts_encrypted: await encryptForTenant(db, tenant_id, JSON.stringify(solved.facts)),
            facts_expire_at: new Date(Date.now() + SENSITIVE_FACTS_TTL_MS),
          }
        : { facts: solved.facts }),
      template_sentence: solved.template_sentence,
      narrated_sentence: null,
      narrated_solver_version: null,
      narrated_data_version: null,
      solver_version: solverVersion,
      data_version: briefDataVersion(problem, solved.inputs),
      result_version: resultVersion,
      as_of_date: asOf,
      acknowledgements: [],
      ...(contract_version ? { contract_version } : {}),
      stale: false,
      share: {
        token_hash: tokenHash(token),
        for_member_id: member?.id ?? parsed.data.for_member_id ?? null,
        for_member_name: member?.name ?? null,
        ...(member ? { for_user_id: member.user_id ?? member.id } : {}),
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
    await getAuditLogger()?.fromRequest(req, 'brief.created', 'household_briefs', doc.id, {
      problem_type: problem,
    })
    return reply.code(201).send({ brief: briefView(doc, token, await factsFor(doc, ctx.user_id)) })
  })

  app.get('/family/briefs', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    const adult = await isFamilyAdult(db, ctx.tenant_id, ctx.user_id)
    // New records are participant-only; legacy (no contract_version) rows stay
    // readable to the creator so the migration is invisible to users.
    const list = await briefsFor(db, ctx.tenant_id)
      .find({
        $or: [
          ...(adult ? [{ created_by: ctx.user_id }, { 'share.for_user_id': ctx.user_id }] : []),
          { contract_version: { $exists: false }, created_by: ctx.user_id },
        ],
      })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray()
    return {
      briefs: await Promise.all(
        list.map(async (b: HouseholdBriefDoc) =>
          briefView(b, undefined, await factsFor(b, ctx.user_id)),
        ),
      ),
    }
  })

  app.get<{ Params: { id: string } }>('/family/briefs/:id', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    let b = await briefsFor(db, ctx.tenant_id).findOne({ id: req.params.id })
    if (!b || (b.contract_version === 2 && !(await participant(b, ctx))))
      return reply.code(404).send({ error: 'Brief not found' })
    // v2 snapshots never recompute. Legacy briefs keep the original
    // stale-recompute-once semantics until replaced.
    if (!b.contract_version && b.stale) {
      const solved = solveBrief(b.problem_type as BriefProblemType, b.inputs)
      if (!('error' in solved)) {
        await briefsFor(db, ctx.tenant_id).updateOne(
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
        b = {
          ...b,
          result: solved.result,
          template_sentence: solved.template_sentence,
          stale: false,
        }
      }
    }
    return reply
      .header('Cache-Control', 'private, no-store')
      .send({ brief: briefView(b, undefined, await factsFor(b, ctx.user_id)) })
  })

  app.post<{ Params: { id: string } }>('/family/briefs/:id/confirm', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Sign in to confirm' })
    const b = await briefsFor(db, ctx.tenant_id).findOne({ id: req.params.id })
    if (!b || !(await participant(b, ctx)))
      return reply.code(403).send({ error: 'Only the two named adults can confirm' })
    if (b.share?.revoked_at || (b.share && b.share.expires_at <= new Date()))
      return reply
        .code(410)
        .send({ error: 'Share expired or revoked; the creator can issue a new link' })
    const ack = AckSchema.safeParse(req.body)
    if (!ack.success || ack.data.result_version !== b.result_version)
      return reply.code(409).send({ error: 'Reload and read this version before confirming' })
    return acknowledge(b, ctx.user_id)
  })

  app.post<{ Params: { id: string } }>('/family/briefs/:id/revoke', async (req, reply) => {
    const { tenant_id, user_id, roles } = req.authContext
    if (!(await isHouseholdEditor(db, tenant_id, user_id, roles)))
      return reply.code(403).send({ error: 'Only a household editor can revoke a link' })
    const res = (await briefsFor(db, tenant_id).updateOne(
      { id: req.params.id, created_by: user_id, 'share.revoked_at': null },
      { $set: { 'share.revoked_at': new Date(), updated_at: new Date() } },
    )) as { matchedCount?: number }
    if (!res.matchedCount)
      return reply.code(404).send({ error: 'Brief not found or already revoked' })
    await getAuditLogger()?.fromRequest(
      req,
      'brief.share_revoked',
      'household_briefs',
      req.params.id,
      {},
    )
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/family/briefs/:id', async (req, reply) => {
    const { tenant_id, user_id, roles } = req.authContext
    if (!(await isHouseholdEditor(db, tenant_id, user_id, roles)))
      return reply.code(403).send({ error: 'Only the creator can delete a brief' })
    const res = (await briefsFor(db, tenant_id).deleteOne({
      id: req.params.id,
      created_by: user_id,
    })) as { deletedCount?: number }
    if (!res.deletedCount) return reply.code(404).send({ error: 'Brief not found' })
    await getAuditLogger()?.fromRequest(
      req,
      'brief.share_revoked',
      'household_briefs',
      req.params.id,
      {},
    )
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: { for_member_id?: string | null } }>(
    '/family/briefs/:id/share',
    async (req, reply) => {
      const { tenant_id, user_id, roles } = req.authContext
      if (!(await isHouseholdEditor(db, tenant_id, user_id, roles)))
        return reply.code(403).send({ error: 'Only a household editor can share a brief' })
      const b = await briefsFor(db, tenant_id).findOne({ id: req.params.id, created_by: user_id })
      if (!b) return reply.code(404).send({ error: 'Brief not found' })
      const member = await recipient(
        tenant_id,
        user_id,
        req.body?.for_member_id ?? b.share?.for_member_id,
      )
      if (b.contract_version === 2 && !member)
        return reply.code(400).send({ error: 'Choose another active adult in your household' })
      const token = randomBytes(24).toString('hex')
      const expiresAt = new Date(Date.now() + SHARE_TOKEN_TTL_DAYS * 86_400_000)
      await briefsFor(db, tenant_id).updateOne(
        { id: b.id },
        {
          $set: {
            share: {
              token_hash: tokenHash(token),
              for_member_id:
                member?.id ?? req.body?.for_member_id ?? b.share?.for_member_id ?? null,
              for_member_name: member?.name ?? b.share?.for_member_name ?? null,
              ...(member ? { for_user_id: member.user_id ?? member.id } : {}),
              expires_at: expiresAt,
              revoked_at: null,
            },
            // Re-sharing always requires fresh explicit receipts from both adults.
            acknowledgements: [],
            confirmed_opened_at: null,
            confirmed_by: null,
            link_fetched_at: null,
            updated_at: new Date(),
          },
        },
      )
      await getAuditLogger()?.fromRequest(req, 'brief.share_created', 'household_briefs', b.id, {})
      return { share: { url: token, expires_at: expiresAt } }
    },
  )

  app.get<{ Params: { token: string } }>('/b/:token', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const b = await loadShare(req.params.token)
    const error = shareError(b)
    if (error) return reply.code(error.status).send({ error: error.error })
    if (b!.contract_version === 2 && !(await participant(b!, req.authContext)))
      return reply
        .code(req.authContext ? 403 : 401)
        .send({ error: 'Sign in as the adult this brief was shared with' })
    await briefsFor(db, b!.tenant_id).updateOne(
      { id: b!.id, link_fetched_at: null },
      { $set: { link_fetched_at: new Date() } },
    )
    return {
      ...briefView(b!, undefined, await factsFor(b!, req.authContext?.user_id)),
      sentence: b!.template_sentence,
      for_member_name: b!.share!.for_member_name,
      // Old anonymous opens remain readable but cannot earn adult receipts.
      can_confirm: b!.contract_version === 2,
    }
  })

  app.post<{ Params: { token: string } }>('/b/:token/confirm', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    const b = await loadShare(req.params.token)
    const error = shareError(b)
    if (error) return reply.code(error.status).send({ error: error.error })
    // Legacy briefs keep the original anonymous-friendly confirm: a
    // non-self click stamps confirmed_opened_at. New catalogue briefs
    // require the named adult's session and the seen result_version.
    if (b!.contract_version !== 2) {
      const confirmer = req.authContext?.user_id ?? null
      const isSelf = confirmer !== null && confirmer === b!.created_by
      if (!b!.confirmed_opened_at && !isSelf) {
        await briefsFor(db, b!.tenant_id).updateOne(
          { id: b!.id, confirmed_opened_at: null },
          { $set: { confirmed_opened_at: new Date(), confirmed_by: confirmer } },
        )
        await emitBriefEvent(db, b!.tenant_id, 'brief_confirmed_open', {
          problem_type: b!.problem_type,
        })
      }
      const fresh = await briefsFor(db, b!.tenant_id).findOne({ id: b!.id })
      return { confirmed: !isSelf, confirmed_opened_at: fresh?.confirmed_opened_at ?? null }
    }
    if (!req.authContext) return reply.code(401).send({ error: 'Sign in to confirm this brief' })
    if (!(await participant(b!, req.authContext)))
      return reply.code(403).send({ error: 'Only the two named adults can confirm' })
    const ack = AckSchema.safeParse(req.body)
    if (!ack.success || ack.data.result_version !== b!.result_version)
      return reply.code(409).send({ error: 'Reload and read this version before confirming' })
    return acknowledge(b!, req.authContext.user_id)
  })

  app.post<{ Params: { id: string } }>('/family/briefs/:id/narrate', async (req, reply) => {
    const { tenant_id } = req.authContext
    const b = await briefsFor(db, tenant_id).findOne({ id: req.params.id })
    if (!b || (b.contract_version === 2 && !(await participant(b, req.authContext))))
      return reply.code(404).send({ error: 'Brief not found' })
    // Catalogue briefs are factual snapshots — this check precedes even
    // constructing a model gateway, so handover/health content can never
    // reach a provider.
    if (b.contract_version === 2)
      return { sentence: b.template_sentence, narrated: false, from_cache: false }
    try {
      return await narrateBrief(db, b, taskLlm('brief.narrate.v1', tenant_id))
    } catch {
      return { sentence: b.template_sentence, narrated: false, from_cache: false }
    }
  })
}
