/**
 * Two-date fact store for the resilience engine (intent 94, B3). Owner decision 2026-11-14: MongoDB, with
 * `valid_from` (when the figure became true) and `recorded_at` (when LifeKeel learned it) on every fact.
 * Append-only: a correction is a new row, never an overwrite, so "what did we know on that date" can be
 * answered. Only allow-listed money figures in whole minor units are stored: no free text, no health data,
 * nothing sensitive. The collection is tenant-keyed and in the erasure wipe, so deleting an account
 * deletes its history.
 */
import type { Db } from 'mongodb'

export const FACT_KEYS = [
  'savings_minor',
  'monthly_inflow_minor',
  'monthly_spend_minor',
  'income_protection_monthly_minor',
  'life_cover_lump_sum_minor',
  'mortgage_monthly_payment_minor',
] as const
export type FactKey = (typeof FACT_KEYS)[number]

export interface EngineFactDoc {
  tenant_id: string
  key: FactKey
  value_minor: number
  valid_from: Date
  recorded_at: Date
  entered_by: string
}

export interface NewFact {
  key: FactKey
  valueMinor: number
  validFrom: Date
  enteredBy: string
  /** Defaults to now; settable so tests and imports can state when a figure was learned. */
  recordedAt?: Date
}

const validDate = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime())

export async function recordFact(db: Db, tenantId: string, fact: NewFact): Promise<void> {
  if (!(FACT_KEYS as readonly string[]).includes(fact.key)) {
    throw new RangeError(`unknown fact key: ${String(fact.key)}`)
  }
  if (!Number.isInteger(fact.valueMinor) || fact.valueMinor < 0) {
    throw new RangeError('value must be a whole, non-negative amount in minor units')
  }
  const recordedAt = fact.recordedAt ?? new Date()
  if (!validDate(fact.validFrom) || !validDate(recordedAt))
    throw new RangeError('dates must be real dates')
  if (!tenantId || !fact.enteredBy) throw new RangeError('tenant and enteredBy are required')
  await db.collection<EngineFactDoc>('engine_facts').insertOne({
    tenant_id: tenantId,
    key: fact.key,
    value_minor: fact.valueMinor,
    valid_from: fact.validFrom,
    recorded_at: recordedAt,
    entered_by: fact.enteredBy,
  })
}

/**
 * The figures as they stood: true by `validAt`, and known by `knownAt`. Per key, the latest `valid_from`
 * wins; a later entry for the same `valid_from` (a correction) wins once it is known.
 */
export async function factsAsOf(
  db: Db,
  tenantId: string,
  at: { validAt: Date; knownAt: Date },
): Promise<Partial<Record<FactKey, number>>> {
  const rows = await db
    .collection<EngineFactDoc>('engine_facts')
    .find({
      tenant_id: tenantId,
      valid_from: { $lte: at.validAt },
      recorded_at: { $lte: at.knownAt },
    })
    .sort({ valid_from: -1, recorded_at: -1, _id: -1 })
    .toArray()
  const out: Partial<Record<FactKey, number>> = {}
  for (const r of rows) if (out[r.key] === undefined) out[r.key] = r.value_minor
  return out
}
