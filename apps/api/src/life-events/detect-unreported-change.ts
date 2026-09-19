/**
 * PRD-111: unreported life-change nudge.
 *
 * Detects when a final financial-profile save crosses a real threshold —
 * an earner losing employment, a salary dropping to zero, emergency
 * savings draining fast — that the family hasn't already told Oak about
 * via /life-events. Deliberately sourced only from data the family
 * already typed into their own profile, never an external transaction
 * feed (see the PRD's "Market bar" section and CLAUDE.md's "second rule"
 * for why that's a permanent choice, not a v1 limitation).
 *
 * `detectUnreportedLifeChange` is pure and returns only an internal
 * reason code — every caller in this codebase must treat that reason as
 * audit-log-only. No route may ever return it to a client: the nudge
 * itself must never guess or name what it thinks happened.
 */
import type { Db } from 'mongodb'
import type { FastifyRequest } from 'fastify'
import { getSignalsCollection, getLifeChangeNudgeStateCollection } from '../db.js'
import { getAuditLogger } from '../audit/audit-log.js'

export interface EarnerSnapshot {
  member_id?: string
  employment_status: string
  monthly_salary_minor: number
}

export interface ProfileChangeSnapshot {
  earners: EarnerSnapshot[]
  emergency_savings_minor: number
}

export type NudgeReason = 'employment_status_change' | 'salary_to_zero' | 'emergency_fund_drained'

const STILL_EARNING = new Set(['employed', 'self_employed'])

/**
 * Compares two consecutive profile snapshots and returns the first
 * threshold crossed, or null if nothing did. `previous === null` (a
 * household's first-ever save) always returns null — there's nothing to
 * diff a first save against.
 */
export function detectUnreportedLifeChange(
  previous: ProfileChangeSnapshot | null,
  next: ProfileChangeSnapshot,
): NudgeReason | null {
  if (!previous) return null

  for (const nextEarner of next.earners) {
    // The top-level household earner has no member_id and is matched
    // positionally (there's always exactly one); members[] entries match
    // by member_id. An earner with no match in `previous` (newly added
    // this save) has nothing to compare against and is skipped.
    const prevEarner = nextEarner.member_id
      ? previous.earners.find((e) => e.member_id === nextEarner.member_id)
      : previous.earners.find((e) => !e.member_id)
    if (!prevEarner) continue

    if (STILL_EARNING.has(prevEarner.employment_status) && !STILL_EARNING.has(nextEarner.employment_status)) {
      return 'employment_status_change'
    }
    if (prevEarner.monthly_salary_minor > 0 && nextEarner.monthly_salary_minor === 0) {
      return 'salary_to_zero'
    }
  }

  if (previous.emergency_savings_minor > 0 && next.emergency_savings_minor <= previous.emergency_savings_minor * 0.6) {
    return 'emergency_fund_drained'
  }

  return null
}

const RECENT_LIFE_EVENT_WINDOW_DAYS = 30

/**
 * Orchestration wrapper: runs detection, checks whether the family
 * already reported a matching life event recently, and if not, flags the
 * nudge as active. Called from the financial-profile save path only on a
 * final submit (generate_insights: true) — the same gate that already
 * protects insight generation from firing on mid-wizard autosaves.
 */
export async function maybeFlagUnreportedLifeChange(
  req: FastifyRequest,
  previous: ProfileChangeSnapshot | null,
  next: ProfileChangeSnapshot,
  db: Db,
): Promise<void> {
  const reason = detectUnreportedLifeChange(previous, next)
  if (!reason) return

  const { tenant_id } = req.authContext
  const signals = await getSignalsCollection()
  const cutoff = new Date(Date.now() - RECENT_LIFE_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const alreadyReported = await signals.findOne({
    tenant_id,
    signal_type: 'family.life_event',
    created_at: { $gte: cutoff },
  })
  if (alreadyReported) return

  await getLifeChangeNudgeStateCollection(db).updateOne(
    { tenant_id },
    { $set: { active: true, reason, triggered_at: new Date() } },
    { upsert: true },
  )
  getAuditLogger()?.fromRequest(req, 'life_event.nudge_shown', 'life_event_nudge', tenant_id, { reason })
}
