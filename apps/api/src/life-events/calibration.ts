/**
 * PRD-213 M4: drift-sentinel calibration harness.
 *
 * Widening unreported-change detection (new signals, looser thresholds) is
 * gated on measured precision — "a held-out window, explicit abstention
 * zone, and measured precision/recall before any nudge widens". This is the
 * machinery that produces that measurement:
 *
 * - Candidate rules run shadow-only on the same snapshot diff the shipped
 *   detector sees. They never set nudge state; they record a row in
 *   `life_change_calibration` instead.
 * - Each candidate verdict is three-way: `fire` (would have nudged),
 *   `abstain` (inside the explicit border zone — counted, never nudges),
 *   `clear`. The abstain zone is not an error margin: it is the deliberate
 *   "we don't know, so we say nothing" band whose rows later tell us how
 *   often borderline states resolve into real reported life events.
 * - `calibrationSummary` joins recorded rows against the family's own
 *   reported life events (signals `family.life_event`) within the follow-up
 *   window: fired→matched is the precision proxy, abstained→matched is the
 *   missed-opportunity (recall) proxy for the abstention band.
 *
 * Rows carry reason codes only — the same codes the audit log already
 * holds — never profile values or member names.
 */
import type { Db } from 'mongodb'
import type { ProfileChangeSnapshot } from './detect-unreported-change.js'

export type CandidateVerdict = 'fire' | 'abstain' | 'clear'

export interface CandidateSignal {
  reason: 'salary_drop_major' | 'emergency_fund_shrinking' | 'new_earner_added' | 'earner_removed'
  verdict: CandidateVerdict
}

const STILL_EARNING = new Set(['employed', 'self_employed'])

/**
 * Shadow-only candidate rules evaluated on the same previous→next diff the
 * shipped detector uses. A candidate that overlaps a shipped rule returns
 * `clear` here — the real path already fires, so a shadow row would only
 * double-count.
 */
export function evaluateCandidateLifeChanges(
  previous: ProfileChangeSnapshot | null,
  next: ProfileChangeSnapshot,
): CandidateSignal[] {
  if (!previous) return []
  const out: CandidateSignal[] = []

  const matchedPairs: Array<{
    prev: ProfileChangeSnapshot['earners'][number]
    cur: ProfileChangeSnapshot['earners'][number]
  }> = []
  for (const e of next.earners) {
    const prev = e.member_id
      ? previous.earners.find((p) => p.member_id === e.member_id)
      : previous.earners.find((p) => !p.member_id)
    if (prev) matchedPairs.push({ prev, cur: e })
  }

  // salary_drop_major: a big pay cut that stops short of today's
  // salary_to_zero rule. The abstention band (25–50%) is where a noisy
  // month lives — recorded, never nudged.
  for (const { prev, cur } of matchedPairs) {
    const shippedFires =
      (STILL_EARNING.has(prev.employment_status) && !STILL_EARNING.has(cur.employment_status)) ||
      (prev.monthly_salary_minor > 0 && cur.monthly_salary_minor === 0)
    if (shippedFires || prev.monthly_salary_minor <= 0) continue
    const ratio = cur.monthly_salary_minor / prev.monthly_salary_minor
    out.push({
      reason: 'salary_drop_major',
      verdict: ratio <= 0.5 ? 'fire' : ratio <= 0.75 ? 'abstain' : 'clear',
    })
  }

  // emergency_fund_shrinking: sub-threshold drawdowns the shipped 40%-drain
  // rule ignores. 20–40% fires the shadow row; 10–20% abstains.
  {
    const p = previous.emergency_savings_minor
    const n = next.emergency_savings_minor
    if (p > 0 && n > p * 0.6) {
      const drop = 1 - n / p
      out.push({
        reason: 'emergency_fund_shrinking',
        verdict: drop >= 0.2 ? 'fire' : drop >= 0.1 ? 'abstain' : 'clear',
      })
    }
  }

  // Roster movement is the highest-signal, highest-noise candidate family:
  // an earner appearing or disappearing can mean job change, marriage,
  // divorce, death — or plain roster cleanup. Exactly why it stays shadow.
  for (const e of next.earners) {
    if (e.member_id && !previous.earners.some((p) => p.member_id === e.member_id)) {
      out.push({ reason: 'new_earner_added', verdict: 'fire' })
    }
  }
  for (const e of previous.earners) {
    if (e.member_id && !next.earners.some((n) => n.member_id === e.member_id)) {
      out.push({ reason: 'earner_removed', verdict: 'fire' })
    }
  }

  return out.filter((c) => c.verdict !== 'clear')
}

export const LIFE_CHANGE_CALIBRATION_COLLECTION = 'life_change_calibration'
export const CALIBRATION_MATCH_WINDOW_DAYS = 30

export interface CalibrationRow {
  tenant_id: string
  reason: CandidateSignal['reason']
  verdict: Exclude<CandidateVerdict, 'clear'>
  fired_at: Date
}

/** Records shadow rows for non-clear candidates. Never throws — the
 *  calibration harness must be invisible to the profile save path. */
export async function recordCalibrationCandidates(
  db: Db,
  tenantId: string,
  candidates: CandidateSignal[],
): Promise<void> {
  const rows = candidates.filter(
    (c): c is CandidateSignal & { verdict: Exclude<CandidateVerdict, 'clear'> } =>
      c.verdict !== 'clear',
  )
  if (rows.length === 0) return
  const firedAt = new Date()
  await db
    .collection<CalibrationRow>(LIFE_CHANGE_CALIBRATION_COLLECTION)
    .insertMany(
      rows.map((r) => ({
        tenant_id: tenantId,
        reason: r.reason,
        verdict: r.verdict,
        fired_at: firedAt,
      })),
    )
    .catch(() => {})
}

export interface CalibrationSummaryRow {
  reason: string
  /** Shadow rows that would have nudged. */
  fired: number
  /** Fired rows where the family reported a life event within 30 days — precision proxy. */
  fired_matched: number
  /** Rows held by the abstention band. */
  abstained: number
  /** Abstained rows followed by a reported life event — missed-opportunity proxy. */
  abstained_matched: number
}

/**
 * Per-reason evidence for the widening gate. `matched` = a `family.life_event`
 * signal exists in the match window after the row fired. A reported event is
 * not labelled by reason (the nudge never names its guess), so matching is
 * any-event-within-window: coarse, but honest — and exactly the conservatism
 * M4 wants before authority widens.
 */
export async function calibrationSummary(
  db: Db,
  tenantId: string,
  windowDays = 90,
): Promise<CalibrationSummaryRow[]> {
  const since = new Date(Date.now() - windowDays * 24 * 3_600_000)
  const rows = await db
    .collection<CalibrationRow>(LIFE_CHANGE_CALIBRATION_COLLECTION)
    .find({ tenant_id: tenantId, fired_at: { $gte: since } })
    .toArray()

  const events = await db
    .collection('signals')
    .find({ tenant_id: tenantId, signal_type: 'family.life_event', created_at: { $gte: since } })
    .project<{ created_at: Date }>({ created_at: 1 })
    .toArray()

  const matchWindowMs = CALIBRATION_MATCH_WINDOW_DAYS * 24 * 3_600_000
  const matched = (firedAt: Date) =>
    events.some((e) => {
      const delta = e.created_at.getTime() - firedAt.getTime()
      return delta >= 0 && delta <= matchWindowMs
    })

  const byReason = new Map<string, CalibrationSummaryRow>()
  for (const r of rows) {
    const row = byReason.get(r.reason) ?? {
      reason: r.reason,
      fired: 0,
      fired_matched: 0,
      abstained: 0,
      abstained_matched: 0,
    }
    if (r.verdict === 'fire') {
      row.fired += 1
      if (matched(r.fired_at)) row.fired_matched += 1
    } else {
      row.abstained += 1
      if (matched(r.fired_at)) row.abstained_matched += 1
    }
    byReason.set(r.reason, row)
  }
  return [...byReason.values()]
}
