/**
 * Events in combination (intent 94, R5). Effects are summed, so listing order never matters, the same
 * loss named by two events is taken once (capped at the inflow), and a payout or protection benefit is
 * never eaten by another event that also removes income. Pure; inputs are not mutated.
 */
import type { MonthFlow } from './cashflow.js'
import { applyEffects, effectsOf, type EngineEvent } from './events.js'

export function applyEvents(timeline: MonthFlow[], events: EngineEvent[]): MonthFlow[] {
  return applyEffects(
    timeline,
    events.flatMap((e) => effectsOf(e, timeline.length)),
  )
}
