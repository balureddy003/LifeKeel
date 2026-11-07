/**
 * Generic routes for domain packs. The pack decides what is recorded; these
 * routes only read adapters, store household-entered records, derive the
 * matrix and stamp "seen by every adult". Tier 0: nothing is sent or done on
 * anyone's behalf, and no copy states whether cover is enough.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getTenantCollection } from '@lifekeel/platform'
import { getAuditLogger } from '../audit/audit-log.js'
import { SECRET_PATTERNS } from '../briefs/catalogue.js'
import { DOMAINS } from '../domains/registry.js'
import type { DomainPack } from '../domains/types.js'
import { buildDomainPlaybook } from '../domains/playbook.js'
import {
  buildDomainView,
  loadDomainRows,
  type DomainConfirmationDoc,
  type DomainRecordDoc,
} from '../domains/view.js'
import { isFamilyAdult, isHouseholdEditor } from '../family/family-permissions.js'

const AckSchema = z.object({ result_version: z.string().length(64) }).strict()
const RecordBody = z
  .object({
    holder_member_id: z.string().max(120).nullable().optional(),
    covers_member_id: z.string().max(120).nullable().optional(),
    values: z.record(z.string(), z.string().max(500)),
  })
  .strict()

export function registerFamilyDomainRoutes(
  app: FastifyInstance,
  db: Db,
  domains: readonly DomainPack[] = DOMAINS,
) {
  const find = (id: string) => domains.find((d) => d.id === id)
  const records = (tenantId: string) =>
    getTenantCollection<DomainRecordDoc>(db, 'domain_records', tenantId)

  app.get('/family/domains', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx || !(await isFamilyAdult(db, ctx.tenant_id, ctx.user_id)))
      return reply.code(401).send({ error: 'Adults only' })
    // The external declaration is deliberately left out: nothing serves it yet.
    return {
      domains: domains.map(({ external: _external, ...d }) => d),
    }
  })

  app.get<{ Params: { id: string } }>('/family/domains/:id', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx || !(await isFamilyAdult(db, ctx.tenant_id, ctx.user_id)))
      return reply.code(401).send({ error: 'Adults only' })
    const pack = find(req.params.id)
    if (!pack) return reply.code(404).send({ error: 'Not found' })
    reply.header('Cache-Control', 'private, no-store')
    return buildDomainView(db, ctx.tenant_id, pack, ctx.user_id)
  })

  app.get<{ Params: { id: string }; Querystring: { member?: string } }>(
    '/family/domains/:id/playbook',
    async (req, reply) => {
      const ctx = req.authContext
      if (!ctx || !(await isFamilyAdult(db, ctx.tenant_id, ctx.user_id)))
        return reply.code(401).send({ error: 'Adults only' })
      const pack = find(req.params.id)
      if (!pack?.playbook) return reply.code(404).send({ error: 'Not found' })
      const { roster, rows } = await loadDomainRows(db, ctx.tenant_id, pack)
      const member = roster.find((m) => m.id === req.query.member)
      if (!member) return reply.code(400).send({ error: 'Choose a person on the family list' })
      reply.header('Cache-Control', 'private, no-store')
      return { ...buildDomainPlaybook(pack, rows, member), roster }
    },
  )

  app.post<{ Params: { id: string; record: string } }>(
    '/family/domains/:id/records/:record',
    async (req, reply) => {
      const ctx = req.authContext
      if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
      if (!(await isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles)))
        return reply.code(403).send({ error: 'Only a household editor can add records' })
      const pack = find(req.params.id)
      const rec = pack?.records.find((r) => r.key === req.params.record)
      if (!pack || !rec) return reply.code(404).send({ error: 'Not found' })
      if (rec.source.kind !== 'store')
        return reply.code(400).send({ error: 'This record is read from elsewhere' })
      const parsed = RecordBody.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ error: 'Check the details and try again' })
      const { values } = parsed.data
      const known = new Set(rec.fields.map((f) => f.key))
      if (Object.keys(values).some((k) => !known.has(k)))
        return reply.code(400).send({ error: 'Check the details and try again' })
      const bad = Object.entries(values).find(([, v]) => SECRET_PATTERNS.some((re) => re.test(v)))
      if (bad)
        return reply.code(400).send({
          error: 'That looks like a password or code. Record where it is kept, never the secret.',
        })
      const now = new Date()
      const doc = {
        id: `dr_${randomUUID()}`,
        domain_id: pack.id,
        record: rec.key,
        holder_member_id: parsed.data.holder_member_id ?? null,
        covers_member_id: parsed.data.covers_member_id ?? null,
        values,
        created_by: ctx.user_id,
        created_at: now,
        updated_at: now,
      }
      await records(ctx.tenant_id).insertOne(doc)
      await getAuditLogger()?.fromRequest(
        req,
        'domain_record.created',
        'domain_records',
        doc.id,
        {},
      )
      return reply.code(201).send({ id: doc.id })
    },
  )

  app.delete<{ Params: { id: string; rowId: string } }>(
    '/family/domains/:id/records/:rowId',
    async (req, reply) => {
      const ctx = req.authContext
      if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
      if (!(await isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles)))
        return reply.code(403).send({ error: 'Only a household editor can remove records' })
      await records(ctx.tenant_id).deleteOne({ id: req.params.rowId, domain_id: req.params.id })
      await getAuditLogger()?.fromRequest(
        req,
        'domain_record.deleted',
        'domain_records',
        req.params.rowId,
        {},
      )
      return reply.code(204).send()
    },
  )

  app.post<{ Params: { id: string } }>('/family/domains/:id/confirm', async (req, reply) => {
    const ctx = req.authContext
    if (!ctx || !(await isFamilyAdult(db, ctx.tenant_id, ctx.user_id)))
      return reply.code(401).send({ error: 'Adults only' })
    const pack = find(req.params.id)
    if (!pack) return reply.code(404).send({ error: 'Not found' })
    const parsed = AckSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Check the details and try again' })
    const view = await buildDomainView(db, ctx.tenant_id, pack, ctx.user_id)
    // A confirmation only counts for the exact version the adult was shown.
    if (parsed.data.result_version !== view.result_version)
      return reply.code(409).send({ error: 'This changed since you opened it. Review it again.' })
    await getTenantCollection<DomainConfirmationDoc>(
      db,
      'domain_confirmations',
      ctx.tenant_id,
    ).updateOne(
      { domain_id: pack.id, user_id: ctx.user_id, result_version: view.result_version },
      { $setOnInsert: { confirmed_at: new Date() } },
      { upsert: true },
    )
    await getAuditLogger()?.fromRequest(
      req,
      'domain.confirmed',
      'domain_confirmations',
      pack.id,
      {},
    )
    return buildDomainView(db, ctx.tenant_id, pack, ctx.user_id)
  })
}
