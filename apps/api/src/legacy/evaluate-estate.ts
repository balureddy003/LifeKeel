/**
 * PRD-137: the "emit estate signal → evaluate → persist insights →
 * resolve stale" pass every estate-touching write shares — vault
 * mutations, legacy register writes, property-legacy patches. Extracted
 * from vault.ts's reevaluateEstate so the legacy routes get identical
 * behaviour instead of a second ad-hoc copy. Callers await or fire-and-
 * forget freely: failures log and never propagate — the primary write
 * already committed.
 */

import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { createLogger } from '@lifekeel/platform'
import type { Engine, Insight } from '@lifekeel/engine'
import { persistSignal } from '../signals.js'
import { resolveStaleInsights } from '../insights-persist.js'
import { buildEstateSignal } from './estate-signal.js'

const log = createLogger({ service: 'evaluate-estate', version: '0.0.0' })

export const ESTATE_DETECTOR_ID = 'family_estate_readiness'
export const ESTATE_RULE_IDS = [
  'estate_no_will',
  'estate_no_power_of_attorney',
  'legacy_will_review_due',
  'legacy_guardianship_gap',
  'legacy_executor_missing',
  'legacy_property_title_gap',
  'legacy_foreign_property_review',
  'legacy_will_asset_mismatch',
  'legacy_beneficiary_conflict',
  'legacy_original_location_unknown',
] as const

export async function evaluateEstate(
  db: Db,
  engine: Engine | undefined,
  tenantId: string,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): Promise<void> {
  if (!engine) return
  try {
    const data = await buildEstateSignal(db, tenantId)
    const eventId = randomUUID()
    const signalId = await persistSignal(
      {
        tenant_id: tenantId,
        signal_type: 'family.estate',
        source: 'manual-entry',
        external_id: eventId,
        data,
      },
      db,
    )
    const result = await engine.evaluate({
      event_type: 'family.estate',
      tenant_id: tenantId,
      event_id: eventId,
      data,
      derived_from_signals: [signalId],
    })
    if (result.insights.length > 0) await onInsightsGenerated?.(result.insights, tenantId)
    // Fresh eval just ran every rule — anything the new data no longer
    // reproduces resolves now.
    await resolveStaleInsights(
      db,
      tenantId,
      ESTATE_DETECTOR_ID,
      [...ESTATE_RULE_IDS],
      result.insights.map((i) => ({ rule_id: i.rule_id, entity_key: i.entity_key ?? '' })),
    )
  } catch (err) {
    log.warn({ err, tenant_id: tenantId }, 'Estate readiness evaluation failed — write already committed')
  }
}
