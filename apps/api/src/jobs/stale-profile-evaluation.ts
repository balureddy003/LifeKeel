/**
 * Stale profile evaluation sweep — closes the gap where a family's profile
 * has real, accurate data (autosaved across wizard steps) but detectors
 * were never run against it, because the family never clicked the final
 * "Save & Generate Insights" submit, and never manually hit
 * POST /family/financial-profile/evaluate either.
 *
 * Once a day, finds every profile that is either (a) never evaluated, or
 * (b) edited since its last evaluation, and runs the same
 * evaluateProfileAndGenerateInsights() pass the /evaluate route runs
 * on-demand, through the same persistAndDeliverInsights pipeline every
 * other Tier-0 detector pass uses.
 *
 * This is NOT prediction: current_age / target_retirement_age /
 * years_remaining on the profile are static user-entered integers with
 * nothing incrementing them over time, so re-running the engine does not
 * make a time-based condition newly true on its own. It only guarantees
 * real data that was saved but never evaluated eventually gets evaluated,
 * without the family having to remember to ask.
 *
 * Safety properties:
 *  - Deterministic: evaluateProfileAndGenerateInsights is the exact same
 *    pure function the /evaluate route calls — no LLM, no new rules.
 *  - Deduped: persistAndDeliverInsights (insights-persist.ts) dedupes per
 *    (detector_id, rule_id, entity_key) within each rule's dedup_window_ms
 *    — a re-run against unchanged data does not re-notify.
 *  - Non-destructive: a profile that fails FinancialProfileSchema.safeParse
 *    OR isSubstantivelyComplete (below) is skipped, not crashed on or
 *    coerced — same behavior as the /evaluate route for a malformed
 *    profile, plus a guard the route doesn't need (a human clicking
 *    "Save & Generate Insights" has implicitly already decided the form is
 *    done; this sweep has no such signal, so it must decide for itself).
 *  - Self-limiting: insights_evaluated_at is stamped after every pass
 *    (evaluated or skipped), so a profile is only re-attempted once it
 *    changes again (updated_at moves past insights_evaluated_at) — not
 *    every single day forever.
 *  - No delivery of its own: reuses onInsightsGenerated
 *    (persistAndDeliverInsights) exactly as live evaluation already does —
 *    no new delivery path, no new trust tier.
 *
 * Tier 0 (informational only) — see ARCHITECTURE.md's trust-tier model.
 * Scheduled daily from server.ts under the 'stale-profile-evaluation' cron
 * lock.
 */

import type { Db } from 'mongodb'
import type { Engine, Insight } from '@agentoak/engine'
import { createLogger } from '@agentoak/platform'
import { getFamilyFinancialProfileCollection } from '../db.js'
import { buildDedupeKey, emitReadinessEvent } from '../feed/emit.js'
import {
  FinancialProfileSchema,
  evaluateProfileAndGenerateInsights,
  type FinancialProfile,
} from '../routes/family-financial-profile.js'

const log = createLogger({ service: 'stale-profile-evaluation', version: '0.0.0' })

export interface StaleProfileSweepSummary {
  candidates: number
  evaluated: number
  skippedIncomplete: number
  failed: number
}

// Mirrors apps/web/src/app/financial-profile/page.tsx's computeCompleteness
// — same spirit (key fields across each wizard step are non-default), kept
// as a separate implementation because that one works off form strings and
// this one off the already-parsed FinancialProfile. The codebase already
// learned this lesson once: evaluating against a step the user hasn't
// reached yet (still at its zero/default) produces a misleading insight
// that only clears once the real numbers arrive — see the comment on
// `generate_insights` in family-financial-profile.ts's POST handler. This
// requires real signal from household, emergency fund, AND retirement
// specifically — the three steps whose defaults that bug depended on.
// Education funds are legitimately empty for a childless household, so
// not required here.
export function isSubstantivelyComplete(profile: FinancialProfile): boolean {
  return (
    profile.household.monthly_salary_minor > 0 &&
    (profile.emergency_fund.emergency_savings_minor > 0 || profile.emergency_fund.monthly_expenses_minor > 0) &&
    profile.retirement.current_age > 0 &&
    profile.retirement.target_retirement_age > 0
  )
}

export async function runStaleProfileEvaluationSweep(
  db: Db,
  engine: Engine,
  onInsightsGenerated: (insights: Insight[], tenantId: string) => Promise<void>,
  opts: { now?: Date; limit?: number } = {},
): Promise<StaleProfileSweepSummary> {
  const now = opts.now ?? new Date()
  const limit = opts.limit ?? 500
  const summary: StaleProfileSweepSummary = { candidates: 0, evaluated: 0, skippedIncomplete: 0, failed: 0 }
  const col = getFamilyFinancialProfileCollection(db)

  // Never evaluated, or edited since the last evaluation. $expr is the
  // only way a plain Mongo filter can compare two fields on the same
  // document against each other.
  const candidates = (await col
    .find({
      $or: [
        { insights_evaluated_at: { $exists: false } },
        { $expr: { $gt: ['$updated_at', '$insights_evaluated_at'] } },
      ],
    })
    .limit(limit)
    .toArray()) as unknown as Record<string, unknown>[]

  for (const doc of candidates) {
    summary.candidates++
    const tenantId = doc['tenant_id'] as string
    try {
      const { tenant_id: _t, updated_at: _u, insights_evaluated_at: _e, version: _v, _id: _i, ...rest } = doc
      const parsed = FinancialProfileSchema.safeParse(rest)
      if (!parsed.success || !isSubstantivelyComplete(parsed.data)) {
        // Mid-wizard or genuinely invalid — not an error, just not ready
        // yet. Stamp anyway so this exact state isn't re-checked every
        // day; the next real edit moves updated_at past the stamp and it
        // becomes a candidate again.
        await col.updateOne({ tenant_id: tenantId }, { $set: { insights_evaluated_at: now } })
        summary.skippedIncomplete++
        continue
      }
      // PRD-136 sweep_quiet: the evaluate callback reports new insights but
      // not resolutions, so "nothing changed" is measured by counting open
      // (non-resolved) insights before and after the pass. Unreadable
      // insight collection → null → no event rather than a wrong one.
      const openCount = async (): Promise<number | null> => {
        try {
          const docs = (await db.collection('insights').find({ tenant_id: tenantId }).toArray()) as Record<string, unknown>[]
          return docs.filter((d) => d['state'] !== 'resolved').length
        } catch {
          return null
        }
      }
      const openBefore = await openCount()
      await evaluateProfileAndGenerateInsights(parsed.data, tenantId, engine, db, onInsightsGenerated)
      const openAfter = await openCount()
      if (openBefore !== null && openAfter === openBefore) {
        try {
          const nextCheck = new Date(now)
          nextCheck.setUTCDate(nextCheck.getUTCDate() + 1)
          nextCheck.setUTCHours(6, 30, 0, 0)
          emitReadinessEvent(db, tenantId, {
            type: 'sweep_quiet',
            severity: 'info',
            direction: null,
            member_id: null,
            domain: null,
            title: 'Daily check ran — nothing changed',
            summary: 'Oak re-ran the readiness checks against the saved profile and found nothing new.',
            evidence: [],
            links: [],
            next_check_at: nextCheck,
            dedupe_key: buildDedupeKey('sweep_quiet', tenantId),
          })
        } catch {
          // feed bookkeeping never breaks the sweep
        }
      }
      await col.updateOne({ tenant_id: tenantId }, { $set: { insights_evaluated_at: now } })
      summary.evaluated++
    } catch (err) {
      summary.failed++
      log.error({ err, tenant_id: tenantId }, 'Stale profile evaluation failed')
    }
  }

  if (summary.evaluated > 0 || summary.failed > 0) {
    log.info({ ...summary }, 'Stale profile evaluation sweep')
  }
  return summary
}
