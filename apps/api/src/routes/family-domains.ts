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
import { checkRecordValues } from '../domains/records.js'
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

  /** The view plus what a generic page needs to draw it: the pack's shape, the roster, edit rights. */
  async function respond(
    ctx: { tenant_id: string; user_id: string; roles?: readonly string[] },
    pack: DomainPack,
  ) {
    const [view, canEdit, { roster }] = await Promise.all([
      buildDomainView(db, ctx.tenant_id, pack, ctx.user_id),
      isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles),
      loadDomainRows(db, ctx.tenant_id, pack),
    ])
    const { external: _external, ...publicPack } = pack
    return { ...view, pack: publicPack, can_edit: canEdit, roster }
  }
  const records = (tenantId: string) =>
    getTenantCollection<DomainRecordDoc>(db, 'domain_records', tenantId)
  // One record per real-world thing (a car per registration), even when two saves land at
  // once: the key is unique per household, domain and record type. Records saved before
  // this rule have no key, so they are checked by value as well (see the add route).
  db.collection('domain_records')
    .createIndex(
      { tenant_id: 1, domain_id: 1, record: 1, identity_key: 1 },
      { unique: true, partialFilterExpression: { identity_key: { $type: 'string' } } },
    )
    .catch(() => {})
  const identityKey = (v: string | undefined) => (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

  /** The checks adding and editing share: shape, known fields, real people and dates, no secrets. */
  async function checkBody(
    tenantId: string,
    pack: DomainPack,
    rec: DomainPack['records'][number],
    body: unknown,
  ) {
    const parsed = RecordBody.safeParse(body)
    if (!parsed.success) return { error: 'Check the details and try again' }
    const { values } = parsed.data
    const known = new Set(rec.fields.map((f) => f.key))
    if (Object.keys(values).some((k) => !known.has(k)))
      return { error: 'Check the details and try again' }
    const { roster } = await loadDomainRows(db, tenantId, { ...pack, records: [] })
    const problem = checkRecordValues(
      rec,
      values,
      new Set(roster.map((m) => m.id)),
      parsed.data.holder_member_id,
      parsed.data.covers_member_id,
    )
    if (problem) return { error: problem }
    const bad = Object.entries(values).find(([, v]) => SECRET_PATTERNS.some((re) => re.test(v)))
    if (bad)
      return {
        error: 'That looks like a password or code. Record where it is kept, never the secret.',
      }
    return { parsed: parsed.data, values }
  }

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
    return respond(ctx, pack)
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
      if (!member) return reply.code(400).send({ error: 'Choose a person in the family' })
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
      const checked = await checkBody(ctx.tenant_id, pack, rec, req.body)
      if ('error' in checked) return reply.code(400).send({ error: checked.error })
      const { parsed, values } = checked
      const wanted = rec.identity ? identityKey(values[rec.identity]) : ''
      const already = () =>
        reply.code(409).send({ error: `That ${rec.label.toLowerCase()} is already on the list.` })
      if (wanted) {
        const have = (await records(ctx.tenant_id)
          .find({ domain_id: pack.id, record: rec.key })
          .toArray()) as DomainRecordDoc[]
        if (have.some((r) => identityKey(r.values[rec.identity!]) === wanted)) return already()
      }
      const now = new Date()
      const doc = {
        ...(wanted ? { identity_key: wanted } : {}),
        id: `dr_${randomUUID()}`,
        domain_id: pack.id,
        record: rec.key,
        holder_member_id: parsed.holder_member_id ?? null,
        covers_member_id: parsed.covers_member_id ?? null,
        values,
        created_by: ctx.user_id,
        created_at: now,
        updated_at: now,
      }
      try {
        await records(ctx.tenant_id).insertOne(doc)
      } catch (err) {
        // Two saves at once: the other one got there first.
        if ((err as { code?: number }).code === 11000) return already()
        throw err
      }
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

  app.put<{ Params: { id: string; rowId: string } }>(
    '/family/domains/:id/records/:rowId',
    async (req, reply) => {
      const ctx = req.authContext
      if (!ctx) return reply.code(401).send({ error: 'Authentication required' })
      if (!(await isHouseholdEditor(db, ctx.tenant_id, ctx.user_id, ctx.roles)))
        return reply.code(403).send({ error: 'Only a household editor can change records' })
      const pack = find(req.params.id)
      const existing = pack
        ? ((await records(ctx.tenant_id).findOne({
            id: req.params.rowId,
            domain_id: pack.id,
          })) as DomainRecordDoc | null)
        : null
      const rec = pack?.records.find((r) => r.key === existing?.record)
      if (!pack || !existing || !rec || rec.source.kind !== 'store')
        return reply.code(404).send({ error: 'Not found' })
      const checked = await checkBody(ctx.tenant_id, pack, rec, req.body)
      if ('error' in checked) return reply.code(400).send({ error: checked.error })
      const { parsed, values } = checked
      const wanted = rec.identity ? identityKey(values[rec.identity]) : ''
      const clash = () =>
        reply.code(409).send({ error: `That ${rec.label.toLowerCase()} is already on the list.` })
      if (wanted) {
        const have = (await records(ctx.tenant_id)
          .find({ domain_id: pack.id, record: rec.key })
          .toArray()) as DomainRecordDoc[]
        if (
          have.some((r) => r.id !== existing.id && identityKey(r.values[rec.identity!]) === wanted)
        )
          return clash()
      }
      try {
        await records(ctx.tenant_id).updateOne(
          { id: existing.id, domain_id: pack.id },
          {
            $set: {
              values,
              holder_member_id: parsed.holder_member_id ?? null,
              covers_member_id: parsed.covers_member_id ?? null,
              updated_at: new Date(),
              ...(wanted ? { identity_key: wanted } : {}),
            },
            ...(wanted ? {} : { $unset: { identity_key: '' } }),
          },
        )
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return clash()
        throw err
      }
      await getAuditLogger()?.fromRequest(
        req,
        'domain_record.updated',
        'domain_records',
        existing.id,
        {},
      )
      return { id: existing.id }
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
    try {
      await getTenantCollection<DomainConfirmationDoc>(
        db,
        'domain_confirmations',
        ctx.tenant_id,
      ).updateOne(
        { domain_id: pack.id, user_id: ctx.user_id, result_version: view.result_version },
        { $setOnInsert: { confirmed_at: new Date() } },
        { upsert: true },
      )
    } catch (err) {
      // Two taps at once can race the unique index; the stamp exists either way.
      if ((err as { code?: number }).code !== 11000) throw err
    }
    await getAuditLogger()?.fromRequest(
      req,
      'domain.confirmed',
      'domain_confirmations',
      pack.id,
      {},
    )
    return respond(ctx, pack)
  })
}
