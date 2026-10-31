/**
 * Employer-provided cover facts (PRD-232, Intent 84). Household-entered:
 * death-in-service, group income protection, health cover as printed in the
 * source. Tier 0 — read-only facts that pre-fill the job-change brief's
 * recorded-cover field; nothing is sent, extracted or connected. Any later
 * extraction stays `candidate_for_review` — nothing affects a brief until the
 * household confirms it.
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getAuditLogger } from '../audit/audit-log.js'
import { isFamilyAdult, isHouseholdEditor } from '../family/family-permissions.js'

export interface EmployerCoverDoc {
  id: string
  tenant_id: string
  member_label: string
  type: string
  name_as_printed: string
  source: string | null
  last_seen_at: string | null
  ends_with_employment: boolean
  confirmed: boolean
  created_by: string
  created_at: Date
  updated_at: Date
}

const COVER_TYPES = ['death_in_service', 'income_protection', 'health_cover', 'other'] as const

const CoverSchema = z
  .object({
    member_label: z.string().trim().min(1).max(80),
    type: z.enum(COVER_TYPES),
    name_as_printed: z.string().trim().min(1).max(160),
    source: z.string().trim().max(160).optional(),
    last_seen_at: z.iso.date().optional(),
    ends_with_employment: z.boolean().optional(),
    confirmed: z.boolean().optional(),
  })
  .strict()

const col = (db: Db) => db.collection<EmployerCoverDoc>('employer_cover_facts')

export function registerEmployerCoverRoutes(app: FastifyInstance, db: Db) {
  app.get('/family/employer-cover', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx || !(await isFamilyAdult(db, ctx.tenant_id, ctx.user_id)))
      return reply.code(401).send({ error: 'Adults only' })
    const facts = await col(db).find({ tenant_id: ctx.tenant_id }).sort({ created_at: 1 }).toArray()
    return { facts }
  })

  app.post('/family/employer-cover', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    if (!(await isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles)))
      return reply.code(403).send({ error: 'Only a household editor can add cover facts' })
    const parsed = CoverSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Check the details and try again' })
    const i = parsed.data
    const now = new Date()
    const doc: EmployerCoverDoc = {
      id: `ec_${randomUUID()}`,
      tenant_id: ctx.tenant_id,
      member_label: i.member_label,
      type: i.type,
      name_as_printed: i.name_as_printed,
      source: i.source ?? null,
      last_seen_at: i.last_seen_at ?? null,
      ends_with_employment: i.ends_with_employment ?? true,
      confirmed: i.confirmed ?? true,
      created_by: ctx.user_id,
      created_at: now,
      updated_at: now,
    }
    await col(db).insertOne(doc)
    await getAuditLogger()?.fromRequest(
      req,
      'employer_cover.created',
      'employer_cover_facts',
      doc.id,
      {},
    )
    return reply.code(201).send({ fact: doc })
  })

  app.put<{ Params: { id: string } }>('/family/employer-cover/:id', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    if (!(await isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles)))
      return reply.code(403).send({ error: 'Only a household editor can change cover facts' })
    const parsed = CoverSchema.partial().strict().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Check the details and try again' })
    const $set = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as Record<string, unknown>
    $set['updated_at'] = new Date()
    const r = await col(db).updateOne({ id: req.params.id, tenant_id: ctx.tenant_id }, { $set })
    if (!r.matchedCount) return reply.code(404).send({ error: 'Fact not found' })
    await getAuditLogger()?.fromRequest(
      req,
      'employer_cover.updated',
      'employer_cover_facts',
      req.params.id,
      {},
    )
    return { fact: await col(db).findOne({ id: req.params.id }) }
  })

  app.delete<{ Params: { id: string } }>('/family/employer-cover/:id', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    if (!(await isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles)))
      return reply.code(403).send({ error: 'Only a household editor can remove cover facts' })
    const r = await col(db).deleteOne({ id: req.params.id, tenant_id: ctx.tenant_id })
    if (!r.deletedCount) return reply.code(404).send({ error: 'Fact not found' })
    await getAuditLogger()?.fromRequest(
      req,
      'employer_cover.deleted',
      'employer_cover_facts',
      req.params.id,
      {},
    )
    return { ok: true }
  })
}
