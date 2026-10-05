/**
 * Scenario watchlist — nightly recompute of saved "what if" scenarios
 * (PRD-136 §2/§5).
 *
 * Saved scenarios recompute on read already; this job gives the family a
 * reason to come *look*: when the nightly projection moves runway (or
 * the mid-timeline depletion month) by half a month or more, it emits a
 * `scenario_moved` readiness event ("your 'one income' scenario improved
 * from 3.8 to 4.6 months of runway"). Every watched scenario gets a
 * `last_projection` baseline written on first run — the baseline itself
 * never emits, only deltas do.
 *
 * Opt-out is per scenario (`watch: false` via PATCH /family/scenarios/:id);
 * docs predating the flag count as watched. Tier 0 — read models plus a
 * feed write, no notification, nothing acted on.
 */
import type { Db } from 'mongodb'
import { createLogger, getTenantCollection } from '@lifekeel/platform'
import { projectScenario } from '../scenarios/project.js'
import { buildDedupeKey, emitReadinessEvent } from '../feed/emit.js'
import type { FamilyScenarioDoc } from '../routes/family-scenarios.js'

const log = createLogger({ service: 'scenario-watchlist', version: '0.0.0' })

/** |Δ| in months that counts as a move worth narrating. */
const MOVE_THRESHOLD_MONTHS = 0.5

function runwayDelta(prev: number | null, next: number | null): number | null {
  if (prev === null && next === null) return null
  // null ↔ value is a regime change (fund stopped draining, or started) —
  // always material. null means self-funding, so finite → null is an
  // improvement and null → finite is a regression.
  if (prev === null) return -Math.max(next as number, MOVE_THRESHOLD_MONTHS)
  if (next === null) return Math.max(prev, MOVE_THRESHOLD_MONTHS)
  return next - prev
}

export async function runScenarioWatchlist(db: Db): Promise<{ tenants: number; scenarios: number; moved: number }> {
  const now = new Date()
  const tenants = (await db.collection('family_scenarios').distinct('tenant_id', { watch: { $ne: false } })) as string[]
  let scenarios = 0
  let moved = 0

  for (const tenantId of tenants) {
    const col = getTenantCollection<FamilyScenarioDoc>(db, 'family_scenarios', tenantId)
    const docs = (await col.find({ watch: { $ne: false } }).toArray()) as FamilyScenarioDoc[]
    for (const doc of docs) {
      scenarios++
      let outcome
      try {
        outcome = await projectScenario(db, tenantId, doc.inputs)
      } catch (err) {
        log.warn({ err, tenant_id: tenantId, scenario_id: doc.id }, 'Scenario projection failed — skipped')
        continue
      }
      if (outcome.status !== 'ok' || !outcome.result) continue

      const runway = outcome.result.projectedRunwayMonths
      const depletion = outcome.result.fundDepletedAtMonth
      const prev = doc.last_projection

      const projection = { runway_months: runway, depletion_month: depletion, at: now }
      await col.updateOne({ id: doc.id }, { $set: { last_projection: projection } })

      // First run writes the baseline — there's no "before" to diff.
      if (!prev) continue

      const dRunway = runwayDelta(prev.runway_months, runway)
      const depletionChanged = prev.depletion_month !== depletion
      if ((dRunway === null || Math.abs(dRunway) < MOVE_THRESHOLD_MONTHS) && !depletionChanged) continue

      moved++
      const fell = dRunway !== null && dRunway < 0
      const fmt = (v: number | null) => (v === null ? 'self-funding' : String(v))
      emitReadinessEvent(db, tenantId, {
        type: 'scenario_moved',
        severity: fell ? 'attention' : 'notice',
        direction: dRunway === null ? (depletionChanged ? (depletion === null ? 'up' : 'down') : 'flat') : dRunway > 0 ? 'up' : dRunway < 0 ? 'down' : 'flat',
        member_id: doc.inputs?.member_id ?? null,
        domain: 'scenarios',
        title: `${doc.name}: ${fmt(prev.runway_months)} → ${fmt(runway)} months of runway`.slice(0, 120),
        summary: depletionChanged
          ? `The projection moved — the fund ${depletion === null ? 'no longer runs out mid-timeline' : `now runs out around month ${depletion}`}.`
          : `The projected runway moved ${dRunway !== null && dRunway > 0 ? 'up' : 'down'} on the latest numbers.`,
        evidence: [
          { label: 'Runway', value: `${fmt(prev.runway_months)} → ${fmt(runway)}` },
          ...(depletionChanged ? [{ label: 'Fund depleted', value: `${fmt(prev.depletion_month)} → ${fmt(depletion)}` }] : []),
        ],
        links: [{ kind: 'scenario', id: doc.id }],
        next_check_at: null,
        dedupe_key: buildDedupeKey('scenario_moved', doc.id),
      })
    }
  }

  return { tenants: tenants.length, scenarios, moved }
}
