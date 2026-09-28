/**
 * Family cash-flow routes (PRD-131).
 *
 * Gap 9's live transaction feed is blocked on bank integrations — this is
 * the codeable substrate underneath it: a tenant-scoped ledger of
 * recurring income/expense entries the family declares (or that a future
 * connector will write), plus a monthly run-rate summary and a runway
 * figure against their emergency savings.
 *
 *   GET    /family/cashflow             — entries + computed summary
 *   POST   /family/cashflow/entries     — add an entry
 *   DELETE /family/cashflow/entries/:id — remove one
 *
 * Entries are intentionally simple: kind + label + amount + recurrence.
 * A 'once' entry (a bonus, a repair bill) is listed but excluded from the
 * monthly run-rate — a one-off isn't part of the burn. When a real feed
 * lands, entries gain a source field and this shape stays.
 *
 * Tier 0 — pure record-keeping and arithmetic, nothing leaves the house.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getTenantCollection } from '@agentoak/platform'
import { getFamilyCashflowCollection, getFamilyFinancialProfileCollection } from '../db.js'

export interface CashflowEntryDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  kind: 'income' | 'expense'
  label: string
  amount_minor: number
  recurrence: 'weekly' | 'monthly' | 'yearly' | 'once'
  member_id?: string
  created_at: Date
}

const EntryBody = z.object({
  kind: z.enum(['income', 'expense']),
  label: z.string().trim().min(1).max(120),
  amount_minor: z.number().int().positive(),
  recurrence: z.enum(['weekly', 'monthly', 'yearly', 'once']).default('monthly'),
  member_id: z.string().min(1).optional(),
})

/** Normalize any recurrence to a monthly equivalent; 'once' contributes 0
 *  to the run-rate by design. */
export function monthlyEquivalentMinor(entry: Pick<CashflowEntryDoc, 'amount_minor' | 'recurrence'>): number {
  switch (entry.recurrence) {
    case 'weekly': return Math.round((entry.amount_minor * 52) / 12)
    case 'yearly': return Math.round(entry.amount_minor / 12)
    case 'monthly': return entry.amount_minor
    case 'once': return 0
  }
}

export function registerFamilyCashflowRoutes(app: FastifyInstance, db: Db): void {
  const entriesFor = (tenantId: string) => getTenantCollection<CashflowEntryDoc>(db, 'family_cashflow_entries', tenantId)
  getFamilyCashflowCollection(db).createIndex({ tenant_id: 1, created_at: -1 }).catch(() => {})

  app.get('/family/cashflow', async (req) => {
    const { tenant_id } = req.authContext
    const entries = ((await entriesFor(tenant_id).find({}).toArray()) as CashflowEntryDoc[])
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    const monthly_inflow_minor = entries.filter((e) => e.kind === 'income').reduce((s, e) => s + monthlyEquivalentMinor(e), 0)
    const monthly_outflow_minor = entries.filter((e) => e.kind === 'expense').reduce((s, e) => s + monthlyEquivalentMinor(e), 0)
    const net_minor = monthly_inflow_minor - monthly_outflow_minor

    // Runway = months the emergency savings cover a net burn. A surplus
    // household doesn't have a runway problem — null, not infinity.
    const profile = await getFamilyFinancialProfileCollection(db).findOne({ tenant_id })
    const savings = (profile?.['emergency_fund'] as { emergency_savings_minor?: number } | undefined)?.emergency_savings_minor ?? 0
    const runway_months = net_minor < 0 ? Math.round((savings / -net_minor) * 10) / 10 : null

    return {
      entries: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.label,
        amount_minor: e.amount_minor,
        recurrence: e.recurrence,
        monthly_minor: monthlyEquivalentMinor(e),
        ...(e.member_id ? { member_id: e.member_id } : {}),
        created_at: e.created_at,
      })),
      summary: { monthly_inflow_minor, monthly_outflow_minor, net_minor, runway_months },
    }
  })

  app.post('/family/cashflow/entries', async (req, reply) => {
    const { tenant_id } = req.authContext
    const parsed = EntryBody.safeParse(req.body ?? {})
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid entry', details: parsed.error.issues })

    const doc: CashflowEntryDoc = { id: randomUUID(), tenant_id, ...parsed.data, created_at: new Date() }
    await entriesFor(tenant_id).insertOne(doc)
    return { entry: { ...doc, monthly_minor: monthlyEquivalentMinor(doc) } }
  })

  app.delete<{ Params: { id: string } }>('/family/cashflow/entries/:id', async (req, reply) => {
    const { tenant_id } = req.authContext
    const result = (await entriesFor(tenant_id).deleteOne({ id: req.params.id })) as { deletedCount: number }
    if (result.deletedCount === 0) return reply.status(404).send({ error: 'Entry not found' })
    return { ok: true }
  })
}
