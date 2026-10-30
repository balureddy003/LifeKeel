/**
 * Household single-point-of-failure map (PRD-231, Intent 85).
 *
 * One row per recurring obligation the household has entered: who is named,
 * who pays, whose phone or email gets the notices, the next due date and what
 * happens if that person is unavailable. Tier 0 — informational only; no
 * reminders are scheduled or sent, nothing leaves the tenant, and the summary
 * is counts and dates only (never a score of a person).
 *
 * A row naming the other adult is the creator's estimate until that adult
 * confirms it (Intent 82 / PRD-229 rule): confirming is one action by an
 * active adult who is not the row's creator, and nothing is notified.
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getAuditLogger } from '../audit/audit-log.js'
import { SECRET_PATTERNS } from '../briefs/catalogue.js'
import {
  isFamilyAdult,
  isHouseholdEditor,
  isMinorMember,
  memberMatchesUser,
} from '../family/family-permissions.js'
import type { FamilyGroupDoc } from './family-group.js'

export interface ObligationDoc {
  id: string
  tenant_id: string
  label: string
  category: string | null
  /** Free label — "Sam", "the joint account"; never a linked identity. */
  named_person: string
  pays_from: string | null
  notices_to: string | null
  next_due_date: string
  recurrence: string | null
  if_unavailable: string | null
  source: 'entered' | 'suggested'
  /** True while a row naming someone else waits for that adult to confirm. */
  entered_by_creator: boolean
  confirmed_by: string | null
  created_by: string
  created_at: Date
  updated_at: Date
}

const CATEGORIES = ['housing', 'utilities', 'insurance', 'childcare', 'finance', 'other'] as const
const RECURRENCE = ['monthly', 'quarterly', 'annual', 'one-off'] as const

const ObligationSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    category: z.enum(CATEGORIES).optional(),
    named_person: z.string().trim().min(1).max(80),
    pays_from: z.string().trim().max(120).optional(),
    notices_to: z.string().trim().max(120).optional(),
    next_due_date: z.iso.date(),
    recurrence: z.enum(RECURRENCE).optional(),
    if_unavailable: z.string().trim().max(300).optional(),
  })
  .strict()

function obligationsFor(db: Db, tenantId: string) {
  return db.collection<ObligationDoc>('household_obligations').find({ tenant_id: tenantId })
}

function view(doc: ObligationDoc) {
  return {
    ...doc,
    pending_confirmation: doc.entered_by_creator && doc.confirmed_by === null,
  }
}

/** Free-text fields get the same secret-shaped guard as handover facts (Intent 79). */
function rejectSecrets(fields: Record<string, string | undefined>): string | null {
  for (const [k, v] of Object.entries(fields)) {
    if (v && SECRET_PATTERNS.some((re) => re.test(v)))
      return `“${k}” looks like it contains a password or code — record where it lives, never the secret itself.`
  }
  return null
}

/** Does this free-label resolve to a roster member? Exact name or first name. */
function namedMember(group: FamilyGroupDoc | null, name: string) {
  const n = name.trim().toLowerCase()
  const first = n.split(/\s+/)[0]
  return (group?.members ?? []).find((m) => {
    const mn = m.name?.trim().toLowerCase()
    return mn === n || mn?.split(/\s+/)[0] === first
  })
}

export function registerHouseholdObligationRoutes(app: FastifyInstance, db: Db) {
  /** Read gate: any active adult may read; write gate: editors only. */
  async function adultsOnly(req: { authContext?: { tenant_id: string; user_id: string } }) {
    const ctx = req.authContext
    if (!ctx) return null
    if (!(await isFamilyAdult(db, ctx.tenant_id, ctx.user_id))) return null
    return ctx
  }

  app.get('/family/obligations', async (req, reply) => {
    const ctx = await adultsOnly(req)
    if (!ctx) return reply.code(401).send({ error: 'Adults only' })
    const rows = await obligationsFor(db, ctx.tenant_id).sort({ next_due_date: 1 }).toArray()
    return { obligations: rows.map(view) }
  })

  /** The map: the rows plus the one-line summary — counts and dates only. */
  app.get('/family/obligations/map', async (req, reply) => {
    const ctx = await adultsOnly(req)
    if (!ctx) return reply.code(401).send({ error: 'Adults only' })
    const rows = await obligationsFor(db, ctx.tenant_id).sort({ next_due_date: 1 }).toArray()
    const dependent = rows.filter((r) => r.named_person.trim() !== '')
    const earliest = rows[0] ?? null
    return {
      obligations: rows.map(view),
      summary: {
        dependent_count: dependent.length,
        earliest_due_date: earliest?.next_due_date ?? null,
        earliest_due_label: earliest?.label ?? null,
      },
    }
  })

  app.post('/family/obligations', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    if (!(await isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles)))
      return reply.code(403).send({ error: 'Only a household editor can add an obligation' })
    const parsed = ObligationSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Check the details and try again' })
    const i = parsed.data
    const secretErr = rejectSecrets({
      named_person: i.named_person,
      pays_from: i.pays_from,
      notices_to: i.notices_to,
      if_unavailable: i.if_unavailable,
    })
    if (secretErr) return reply.code(400).send({ error: secretErr })
    const group = await db
      .collection<FamilyGroupDoc>('family_groups')
      .findOne({ tenant_id: ctx.tenant_id })
    const named = namedMember(group, i.named_person)
    const namesCreator = named !== undefined && memberMatchesUser(named, ctx.user_id)
    const now = new Date()
    const doc: ObligationDoc = {
      id: `obl_${randomUUID()}`,
      tenant_id: ctx.tenant_id,
      label: i.label,
      category: i.category ?? null,
      named_person: i.named_person,
      pays_from: i.pays_from ?? null,
      notices_to: i.notices_to ?? null,
      next_due_date: i.next_due_date,
      recurrence: i.recurrence ?? null,
      if_unavailable: i.if_unavailable ?? null,
      source: 'entered',
      // Naming the other adult is an estimate until that adult confirms.
      entered_by_creator: named !== undefined && !namesCreator,
      confirmed_by: namesCreator ? ctx.user_id : null,
      created_by: ctx.user_id,
      created_at: now,
      updated_at: now,
    }
    await db.collection('household_obligations').insertOne(doc)
    await getAuditLogger()?.fromRequest(
      req,
      'obligation.created',
      'household_obligations',
      doc.id,
      {},
    )
    return reply.code(201).send({ obligation: view(doc) })
  })

  app.put<{ Params: { id: string } }>('/family/obligations/:id', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    if (!(await isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles)))
      return reply.code(403).send({ error: 'Only a household editor can change an obligation' })
    const parsed = ObligationSchema.partial().strict().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Check the details and try again' })
    const i = parsed.data
    const secretErr = rejectSecrets({
      named_person: i.named_person,
      pays_from: i.pays_from,
      notices_to: i.notices_to,
      if_unavailable: i.if_unavailable,
    })
    if (secretErr) return reply.code(400).send({ error: secretErr })
    const existing = await db
      .collection<ObligationDoc>('household_obligations')
      .findOne({ id: req.params.id, tenant_id: ctx.tenant_id })
    if (!existing) return reply.code(404).send({ error: 'Obligation not found' })
    const group = await db
      .collection<FamilyGroupDoc>('family_groups')
      .findOne({ tenant_id: ctx.tenant_id })
    const named = i.named_person !== undefined ? namedMember(group, i.named_person) : undefined
    const renames = i.named_person !== undefined && i.named_person !== existing.named_person
    const $set: Partial<ObligationDoc> = {
      ...Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)),
      updated_at: new Date(),
    } as Partial<ObligationDoc>
    // A rename re-opens the estimate until the newly named adult confirms.
    if (renames) {
      $set.entered_by_creator = named !== undefined && !memberMatchesUser(named!, ctx.user_id)
      $set.confirmed_by =
        named !== undefined && memberMatchesUser(named!, ctx.user_id) ? ctx.user_id : null
    }
    await db.collection('household_obligations').updateOne({ id: existing.id }, { $set })
    await getAuditLogger()?.fromRequest(
      req,
      'obligation.updated',
      'household_obligations',
      existing.id,
      {},
    )
    const fresh = await db
      .collection<ObligationDoc>('household_obligations')
      .findOne({ id: existing.id })
    return { obligation: view(fresh!) }
  })

  app.delete<{ Params: { id: string } }>('/family/obligations/:id', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    if (!(await isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles)))
      return reply.code(403).send({ error: 'Only a household editor can remove an obligation' })
    const r = await db
      .collection('household_obligations')
      .deleteOne({ id: req.params.id, tenant_id: ctx.tenant_id })
    if (!r.deletedCount) return reply.code(404).send({ error: 'Obligation not found' })
    await getAuditLogger()?.fromRequest(
      req,
      'obligation.deleted',
      'household_obligations',
      req.params.id,
      {},
    )
    return { ok: true }
  })

  /**
   * The named adult confirms the row. Any active adult other than the row's
   * creator may confirm — the estimate is about what the creator wrote down
   * for someone else, so the creator can never confirm it themselves.
   */
  app.post<{ Params: { id: string } }>('/family/obligations/:id/confirm', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
    const doc = await db
      .collection<ObligationDoc>('household_obligations')
      .findOne({ id: req.params.id, tenant_id: ctx.tenant_id })
    if (!doc) return reply.code(404).send({ error: 'Obligation not found' })
    const group = await db
      .collection<FamilyGroupDoc>('family_groups')
      .findOne({ tenant_id: ctx.tenant_id })
    const member = (group?.members ?? []).find((m) => memberMatchesUser(m, ctx.user_id))
    if (!member || member.status !== 'active' || isMinorMember(member))
      return reply.code(403).send({ error: 'Only an active adult can confirm' })
    if (doc.created_by === ctx.user_id && doc.entered_by_creator)
      return reply.code(403).send({ error: 'The named adult confirms this themselves' })
    await db
      .collection('household_obligations')
      .updateOne(
        { id: doc.id },
        { $set: { confirmed_by: ctx.user_id, entered_by_creator: false, updated_at: new Date() } },
      )
    const fresh = await db
      .collection<ObligationDoc>('household_obligations')
      .findOne({ id: doc.id })
    return { obligation: view(fresh!) }
  })
}
