/**
 * POST /property/manual-entry — property-wealth vertical's answer to
 * ExternalPositionsPanel: rightmove/zoopla/land-registry are all
 * `status: planned` in their connector YAMLs with no live API (needs a
 * partner agreement, not engineering), so this is the only way a
 * property-wealth tenant can get real data into Kairos today.
 *
 * Unlike ExternalPositionsPanel's route (which only writes to `signals` and
 * never evaluates), this follows the same persist-signal -> engine.evaluate()
 * synchronously -> deliver pattern already used by /events and
 * SocialAnalyticsPoller, so a submitted property actually produces a live
 * insight instead of just a display-only row.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Engine, Insight } from '@kairos/engine'
import { getDb } from '../db.js'
import { persistSignal } from '../signals.js'

const PropertyEntrySchema = z.object({
  address: z.string().min(1),
  property_value_minor: z.number().int().positive(),
  purchase_price_minor: z.number().int().positive().optional(),
  monthly_rent_minor: z.number().int().nonnegative(),
  area_benchmark_yield_pct: z.number(),
  area: z.string().min(1).default('the local area'),
  void_days: z.number().int().nonnegative().default(0),
})

type PropertyEntry = z.infer<typeof PropertyEntrySchema>

function computeYieldFields(entry: PropertyEntry) {
  const net_yield_pct = entry.property_value_minor > 0
    ? Math.round((entry.monthly_rent_minor * 12 / entry.property_value_minor) * 10000) / 100
    : 0
  const yield_gap_pct = Math.round((entry.area_benchmark_yield_pct - net_yield_pct) * 100) / 100
  return { net_yield_pct, yield_gap_pct }
}

export async function registerPropertyRoutes(
  app: FastifyInstance,
  engine: Engine,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): Promise<void> {
  app.post<{ Body: PropertyEntry }>('/property/manual-entry', async (request, reply) => {
    const parsed = PropertyEntrySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid property entry', issues: parsed.error.issues })
    }
    const { tenant_id } = request.authContext
    const entry = parsed.data
    const { net_yield_pct, yield_gap_pct } = computeYieldFields(entry)
    const eventId = crypto.randomUUID()

    const data = {
      address: entry.address,
      area: entry.area,
      property_value_minor: entry.property_value_minor,
      purchase_price_minor: entry.purchase_price_minor ?? entry.property_value_minor,
      monthly_rent_minor: entry.monthly_rent_minor,
      void_days: entry.void_days,
      area_benchmark_yield_pct: entry.area_benchmark_yield_pct,
      net_yield_pct,
      yield_gap_pct,
    }

    const signalId = await persistSignal({
      tenant_id,
      signal_type: 'property.valuation',
      source: 'manual-entry',
      external_id: eventId,
      data,
    })

    const result = await engine.evaluate({
      event_type: 'property.valuation',
      tenant_id,
      event_id: eventId,
      data,
      derived_from_signals: [signalId],
    })

    if (result.insights.length > 0 && onInsightsGenerated) {
      await onInsightsGenerated(result.insights, tenant_id)
    }

    return reply.send({ ok: true, net_yield_pct, yield_gap_pct, insights_generated: result.insights.length })
  })

  app.get('/property/manual-entry', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()
    const docs = await db
      .collection('signals')
      .find({ tenant_id, signal_type: 'property.valuation', source: 'manual-entry' })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray()
    return reply.send({ properties: docs.map((d) => d['data']) })
  })
}
