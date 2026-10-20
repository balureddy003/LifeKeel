/**
 * EPIC-001: Alert Consolidation Engine
 *
 * Server-side reconciliation of insights that reference the same entity.
 * Mirrors Apple Health's source-priority model: when multiple detectors
 * fire on the same entity, one primary insight is shown (selected by
 * detector priority × severity × confidence), and the rest are preserved
 * as secondary factors visible via "See all factors" drill-down.
 *
 * Three cases:
 *  1. Redundant/same-direction → silently consolidated (one card)
 *  2. Different but compatible → secondary factors in expandable list
 *  3. Genuinely contradictory → primary shown, but with explicit
 *     "Conflicting signal" flag naming the disagreeing detector
 *
 * Raw insight documents are never mutated — consolidation is a read-side
 * view computed at query time so it's consistent across web, mobile, and
 * any future notification channel.
 */

import type { Db } from 'mongodb'
import type { Insight } from '@lifekeel/engine'

export interface DetectorPrioritySettings {
  /** Tenant-specific per-detector priority overrides (higher = higher priority). */
  detector_priorities: Record<string, number>
  /** Default tier priorities applied when no tenant override exists. */
  tier_priorities: Record<DetectorTier, number>
  /**
   * Per-vertical action verb sets for contradiction detection.
   * When not set, defaults to the family vocabulary.
   * This makes the contradiction detector configurable per vertical
   * rather than hardcoded to a fixed verb list.
   */
  contradiction_actions?: ContradictionActionSet
}

export interface ContradictionActionSet {
  /** Actions that recommend reducing something (spend, exposure, coverage gaps) */
  reduce: string[]
  /** Actions that recommend increasing something (savings, contributions, cover) */
  increase: string[]
}

/** Default contradiction verb sets per vertical. */
const DEFAULT_CONTRADICTION_ACTIONS: Record<string, ContradictionActionSet> = {
  family: {
    reduce: ['reduce', 'cut', 'pause', 'defer', 'downsize'],
    increase: ['increase', 'add', 'top_up', 'boost', 'accelerate'],
  },
}

/** Fallback when no vertical-specific set is configured. */
const FALLBACK_ACTIONS: ContradictionActionSet = DEFAULT_CONTRADICTION_ACTIONS['family']!

export type DetectorTier = 'regulatory' | 'deterministic' | 'llm_scored'

export const DEFAULT_TIER_PRIORITIES: Record<DetectorTier, number> = {
  regulatory: 300,
  deterministic: 200,
  llm_scored: 100,
}

const URGENCY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

export interface ConsolidatedInsightGroup {
  entity_key: string
  primary: Insight
  secondary: Insight[]
  count: number
  max_urgency: 'low' | 'medium' | 'high' | 'critical'
  has_conflict: boolean
  conflicting_detector_ids: string[]
}

export async function getDetectorPrioritySettings(
  db: Db,
  tenantId: string,
  verticalId?: string,
): Promise<DetectorPrioritySettings> {
  const doc = await db.collection('tenant_settings').findOne({ tenant_id: tenantId })
  const stored = doc?.['detector_priorities'] as Partial<DetectorPrioritySettings> | undefined
  // Resolve contradiction action set: tenant override → vertical default → family fallback
  const verticalActions = verticalId ? DEFAULT_CONTRADICTION_ACTIONS[verticalId] : undefined
  const contradictionActions = stored?.contradiction_actions ?? verticalActions ?? FALLBACK_ACTIONS
  return {
    detector_priorities: stored?.detector_priorities ?? {},
    tier_priorities: {
      ...DEFAULT_TIER_PRIORITIES,
      ...(stored?.tier_priorities ?? {}),
    },
    contradiction_actions: contradictionActions,
  }
}

/**
 * Classify a detector into a default tier. Regulatory/safety detectors
 * (compliance, risk) rank above deterministic rule-based detectors, which
 * rank above LLM-scored detectors. Tenants can override per-detector.
 */
export function classifyDetectorTier(insight: Insight): DetectorTier {
  if (insight.category === 'compliance') return 'regulatory'
  if (insight.category === 'risk' && insight.urgency === 'critical') return 'regulatory'
  // If the insight has an LLM score, it's LLM-scored; otherwise deterministic.
  if (insight.confidence_breakdown?.llm_score !== undefined) return 'llm_scored'
  return 'deterministic'
}

function priorityScore(insight: Insight, settings: DetectorPrioritySettings): number {
  const tenantOverride = settings.detector_priorities[insight.detector_id]
  if (tenantOverride !== undefined) return tenantOverride
  const tier = classifyDetectorTier(insight)
  return settings.tier_priorities[tier] ?? 0
}

function severityScore(insight: Insight): number {
  const urgencyWeight = URGENCY_WEIGHT[insight.urgency] ?? 1
  const confidence = insight.confidence_breakdown?.combined_score ?? 0
  return urgencyWeight * confidence
}

function totalScore(insight: Insight, settings: DetectorPrioritySettings): number {
  // Priority tier dominates; severity × confidence is the tie-breaker within a tier.
  return priorityScore(insight, settings) * 1000 + severityScore(insight)
}

/**
 * Detect whether two insights on the same entity are genuinely
 * contradictory (one says trim, another says buy) vs. merely different
 * factors or redundant same-direction signals.
 *
 * Uses the configurable contradiction action set from tenant settings,
 * which defaults to the vertical-appropriate vocabulary. Each vertical
 * has its own reduce/increase vocabulary rather than a shared hardcoded
 * verb list.
 */
export function isContradictory(
  left: Insight,
  right: Insight,
  actions: ContradictionActionSet = FALLBACK_ACTIONS,
): boolean {
  const reduceSet = new Set(actions.reduce.map(a => a.toLowerCase().trim()))
  const increaseSet = new Set(actions.increase.map(a => a.toLowerCase().trim()))
  const leftActions = (left.actions ?? []).map(a => a.toLowerCase().trim())
  const rightActions = (right.actions ?? []).map(a => a.toLowerCase().trim())
  const leftReduces = leftActions.some(a => reduceSet.has(a))
  const leftIncreases = leftActions.some(a => increaseSet.has(a))
  const rightReduces = rightActions.some(a => reduceSet.has(a))
  const rightIncreases = rightActions.some(a => increaseSet.has(a))
  return (leftReduces && rightIncreases) || (leftIncreases && rightReduces)
}

export function consolidateInsights(
  insights: Insight[],
  settings: DetectorPrioritySettings,
): ConsolidatedInsightGroup[] {
  // Group by entity_key (skip insights without one — they stay as singletons)
  const groups = new Map<string, Insight[]>()
  for (const insight of insights) {
    const key = insight.entity_key ?? `__no_entity__:${insight.id}`
    const list = groups.get(key) ?? []
    list.push(insight)
    groups.set(key, list)
  }

  const result: ConsolidatedInsightGroup[] = []
  for (const [entityKey, group] of groups) {
    if (group.length === 1) {
      const sole = group[0]!
      result.push({
        entity_key: entityKey,
        primary: sole,
        secondary: [],
        count: 1,
        max_urgency: sole.urgency,
        has_conflict: false,
        conflicting_detector_ids: [],
      })
      continue
    }

    // Rank by priority × severity × confidence
    const ranked = [...group].sort(
      (a, b) => totalScore(b, settings) - totalScore(a, settings),
    )
    const primary = ranked[0]!
    const secondary = ranked.slice(1)

    // Detect contradictions between primary and each secondary
    const conflictingDetectorIds: string[] = []
    const actions = settings.contradiction_actions ?? FALLBACK_ACTIONS
    for (const sec of secondary) {
      if (isContradictory(primary, sec, actions)) {
        conflictingDetectorIds.push(sec.detector_id)
      }
    }

    const maxUrgency = group.reduce(
      (max, i) => (URGENCY_WEIGHT[i.urgency] ?? 1) > (URGENCY_WEIGHT[max] ?? 1) ? i.urgency : max,
      'low' as Insight['urgency'],
    )

    result.push({
      entity_key: entityKey,
      primary,
      secondary,
      count: group.length,
      max_urgency: maxUrgency,
      has_conflict: conflictingDetectorIds.length > 0,
      conflicting_detector_ids: conflictingDetectorIds,
    })
  }

  // Sort groups by max severity (primary's score)
  result.sort((a, b) => totalScore(b.primary, settings) - totalScore(a.primary, settings))
  return result
}
