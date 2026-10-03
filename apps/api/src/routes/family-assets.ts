/**
 * Family assets register (gap 8's non-sensitive slice).
 *
 * The vision's "life-assets" domain — property, vehicles, valuables — is
 * the same sensitivity class as the financial profile's existing fields
 * (mortgage, savings), not GDPR special-category data. This is a
 * tenant-scoped declared-asset register any active adult can maintain;
 * medical/health domains stay deferred by design.
 *
 *   GET    /family/assets          — entries + a total/by-kind summary
 *   POST   /family/assets          — add an asset
 *   PATCH  /family/assets/:id      — update value/name/notes
 *   DELETE /family/assets/:id      — remove one
 *
 * Tier 0 — pure record-keeping; values feed nothing regulated, and the
 * estate detector reads doc_type metadata only, never these figures.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getTenantCollection } from '@agentoak/platform'
import { isFamilyAdult } from '../lib/family-permissions.js'
import { PropertyLegacy, validateLegacyRefs, type PropertyLegacy as PropertyLegacyT } from './family-legacy.js'
import type { Engine, Insight } from '@agentoak/engine'
import { evaluateEstate } from '../legacy/evaluate-estate.js'

export const ASSET_KINDS = ['property', 'vehicle', 'savings_account', 'investment', 'valuable', 'other'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export interface AssetDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  kind: AssetKind
  name: string
  value_minor: number
  notes?: string
  /** PRD-137: ownership/legacy detail — only on kind 'property'. */
  legacy?: PropertyLegacyT
  created_by: string
  created_at: Date
  updated_at: Date
}

const CreateBody = z.object({
  kind: z.enum(ASSET_KINDS),
  name: z.string().trim().min(1).max(120),
  value_minor: z.number().int().min(0),
  notes: z.string().trim().max(500).optional(),
})

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  value_minor: z.number().int().min(0).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
})

export function registerFamilyAssetRoutes(
  app: FastifyInstance,
  db: Db,
  engine?: Engine,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): void {
  const assetsFor = (tenantId: string) => getTenantCollection<AssetDoc>(db, 'family_assets', tenantId)

  const requireAdult = async (req: { authContext: { tenant_id: string; user_id: string } }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }): Promise<boolean> => {
    const { tenant_id, user_id } = req.authContext
    if (await isFamilyAdult(db, tenant_id, user_id)) return true
    reply.status(403).send({ error: 'The assets register is visible to adult family members only.' })
    return false
  }

  const toView = (a: AssetDoc) => ({
    id: a.id,
    kind: a.kind,
    name: a.name,
    value_minor: a.value_minor,
    notes: a.notes ?? null,
    legacy: a.legacy ?? null,
    created_at: a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at,
    updated_at: a.updated_at instanceof Date ? a.updated_at.toISOString() : a.updated_at,
  })

  app.get('/family/assets', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const docs = (await assetsFor(tenant_id).find({}).toArray()) as AssetDoc[]
    const byKind: Record<string, number> = {}
    let total = 0
    for (const a of docs) {
      byKind[a.kind] = (byKind[a.kind] ?? 0) + a.value_minor
      total += a.value_minor
    }
    return { assets: docs.sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).map(toView), summary: { total_minor: total, by_kind: byKind } }
  })

  app.post('/family/assets', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id, user_id } = req.authContext
    const parsed = CreateBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid asset', issues: parsed.error.issues })
    const now = new Date()
    const doc: AssetDoc = { id: randomUUID(), tenant_id, ...parsed.data, created_by: user_id, created_at: now, updated_at: now }
    await assetsFor(tenant_id).insertOne(doc)
    return reply.status(201).send({ asset: toView(doc) })
  })

  app.patch<{ Params: { id: string } }>('/family/assets/:id', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const parsed = PatchBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid update', issues: parsed.error.issues })
    const { notes, ...rest } = parsed.data
    const update: { $set: Record<string, unknown>; $unset?: Record<string, string> } = {
      $set: { ...rest, updated_at: new Date() },
    }
    if (notes === null) update.$unset = { notes: '' }
    else if (notes !== undefined) update.$set['notes'] = notes
    const existing = await assetsFor(tenant_id).findOne({ id: req.params.id })
    if (!existing) return reply.status(404).send({ error: 'Asset not found' })
    await assetsFor(tenant_id).updateOne({ id: req.params.id }, update)
    const doc = await assetsFor(tenant_id).findOne({ id: req.params.id })
    return reply.send({ asset: toView(doc as AssetDoc) })
  })

  // PRD-137: a property's legacy detail (ownership basis, recorded vs
  // claimed owners, title evidence) lives embedded on the asset. Other
  // kinds have no legacy sub-document.
  app.patch<{ Params: { id: string } }>('/family/assets/:id/legacy', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const existing = await assetsFor(tenant_id).findOne({ id: req.params.id })
    if (!existing) return reply.status(404).send({ error: 'Asset not found' })
    if (existing.kind !== 'property') {
      return reply.status(400).send({ error: 'Legacy details apply to property assets only' })
    }
    const parsed = PropertyLegacy.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid property legacy', issues: parsed.error.issues })
    const roles = [...parsed.data.recorded_owners, ...parsed.data.claimed_owners]
    const refError = await validateLegacyRefs(db, tenant_id, {
      memberIds: roles.map((r) => r.member_id).filter((x): x is string => typeof x === 'string'),
      contactIds: [
        ...roles.map((r) => r.contact_id).filter((x): x is string => typeof x === 'string'),
        ...(parsed.data.professional_contact_id ? [parsed.data.professional_contact_id] : []),
      ],
      vaultDocIds: parsed.data.title_document_id ? [parsed.data.title_document_id] : [],
    })
    if (refError) return reply.status(400).send({ error: refError })
    await assetsFor(tenant_id).updateOne({ id: req.params.id }, { $set: { legacy: parsed.data, updated_at: new Date() } })
    const doc = await assetsFor(tenant_id).findOne({ id: req.params.id })
    void evaluateEstate(db, engine, tenant_id, onInsightsGenerated)
    return reply.send({ asset: toView(doc as AssetDoc) })
  })

  app.delete<{ Params: { id: string } }>('/family/assets/:id', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const res = await assetsFor(tenant_id).deleteOne({ id: req.params.id })
    if ((res as { deletedCount?: number }).deletedCount === 0) {
      return reply.status(404).send({ error: 'Asset not found' })
    }
    return reply.status(204).send()
  })
}
