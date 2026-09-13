/**
 * React hooks for fetching family data from the Kairos API.
 * Returns an honest empty/zero state when the API is unreachable or has
 * no data yet, rather than falling back to fabricated content.
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  fetchFamilyInsights,
  fetchFamilyGoals,
  fetchFamilyReadinessScore,
  fetchFinancialProfile,
  RESOLVED_INSIGHT_STATES,
  type FamilyInsight,
  type FamilyGoal,
} from './api'
import { useAuth } from './auth-context'
import type { TimelineEvent } from './modes'

export function useFamilyInsights() {
  const [insights, setInsights] = useState<FamilyInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchFamilyInsights()
      setInsights(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load insights')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { insights, loading, error, refresh }
}

export function useFamilyGoals() {
  const [goals, setGoals] = useState<FamilyGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchFamilyGoals()
      setGoals(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load goals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { goals, loading, error, refresh }
}

export function useFamilyReadinessScore() {
  const [score, setScore] = useState<number>(0)
  const [hasLiveData, setHasLiveData] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { score: apiScore, hasLiveData: liveData } = await fetchFamilyReadinessScore()
      if (!cancelled) {
        setScore(apiScore)
        setHasLiveData(liveData)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { score, hasLiveData, loading }
}

export type HealthDomain = 'protection' | 'wealth' | 'goals' | 'savings'

export interface DomainHealth {
  score: number
  hasLiveData: boolean
  insights: FamilyInsight[]
}

const DOMAIN_DETECTOR_MAP: Record<HealthDomain, string> = {
  protection: 'family_protection_gap',
  wealth: 'family_retirement_gap',
  goals: 'family_education_shortfall',
  savings: 'family_emergency_fund_adequacy',
}

// Fallback scores shown only when the API has no insights yet — labeled as
// sample/illustrative in the UI rather than presented as real numbers.
const DOMAIN_FALLBACK_SCORE: Record<HealthDomain, number> = {
  protection: 90,
  wealth: 65,
  goals: 80,
  savings: 85,
}

/**
 * Computes a 0-100 health score per family domain from live detector
 * insights. Starts from 100 (no known gaps) and subtracts a confidence-
 * weighted penalty per currently-open insight — a domain with excellent
 * real coverage and one open, low-confidence flag should score close to
 * 100, not 0. Resolved (approved/dismissed) insights carry no penalty,
 * since they're no longer active problems, but — deliberately — don't add
 * anything back either: this is a snapshot of current gaps, not a
 * completed-tasks tally. Falls back to a labeled sample score when no
 * insights exist for that domain yet.
 *
 * Previously this scored (resolvedCount / totalCount) * 100 minus the same
 * penalty, which meant every domain scored exactly 0% the moment any
 * insight existed and nothing had been manually resolved yet — the normal
 * state for a family that just finished submitting a real, honest
 * financial profile. The one moment this score matters most (right after
 * connecting real data) was the one moment it was guaranteed to read as
 * "0% Wealth, 0% Protection" regardless of how well-covered the family
 * actually was.
 *
 * A domain with zero insights is ambiguous on its own — it means either
 * "no data submitted yet" or "data submitted, detector found nothing
 * wrong" (the ideal outcome), and those need to render differently: the
 * first is a sample/illustrative number, the second is a real, verified
 * "all clear". Distinguishes them by also checking whether a financial
 * profile exists at all — a well-covered family who did everything right
 * was otherwise shown the exact same "sample data" placeholder as someone
 * who'd never connected anything.
 */
export function useFamilyHealthDomains() {
  const { insights, loading: insightsLoading, error } = useFamilyInsights()
  const [hasProfile, setHasProfile] = useState(false)
  // Two independent fetches (insights, financial profile) feed this hook,
  // and insights consistently resolves first — the returned `loading` flag
  // used to reflect only that one, so any domain with zero insights (no
  // profile-gap detector fired) rendered with the profile fetch's default
  // `hasProfile: false` for a few real seconds: a lower score, a "some
  // sample data" label, and the generic AI Memory card instead of a real
  // insight, all before silently correcting themselves once the slower
  // fetch caught up. Found by watching a real dashboard load and comparing
  // against hand-computed expected scores — three of four domains were
  // already correct while the fourth (whichever had no insights) was
  // transiently wrong. Gating loading on both fetches removes the flicker.
  const [profileLoading, setProfileLoading] = useState(true)
  const loading = insightsLoading || profileLoading

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((p) => {
      if (cancelled) return
      setHasProfile(!!p)
      setProfileLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const domains: Record<HealthDomain, DomainHealth> = {} as Record<HealthDomain, DomainHealth>

  for (const domain of Object.keys(DOMAIN_DETECTOR_MAP) as HealthDomain[]) {
    const detectorId = DOMAIN_DETECTOR_MAP[domain]
    const domainInsights = insights.filter((i) => i.detector_id === detectorId)

    if (domainInsights.length === 0) {
      domains[domain] = hasProfile
        ? { score: 100, hasLiveData: true, insights: [] }
        : { score: DOMAIN_FALLBACK_SCORE[domain], hasLiveData: false, insights: [] }
      continue
    }

    const openPenalty = domainInsights
      .filter((i) => !RESOLVED_INSIGHT_STATES.includes(i.state))
      .reduce((sum, i) => sum + i.confidence, 0)
    const score = Math.round(Math.max(0, Math.min(100, 100 - openPenalty * 10)))
    domains[domain] = { score, hasLiveData: true, insights: domainInsights }
  }

  return { domains, loading, error }
}

/**
 * Generates timeline events from the real family roster. Without
 * birthdates (not currently in the family group schema), education
 * milestones can't be computed — returns an empty array so the UI
 * can show an honest empty state instead of fabricated events.
 */
export function useFamilyTimeline() {
  const { family } = useAuth()
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const members = family?.members ?? []
      if (members.length === 0) {
        if (!cancelled) { setEvents([]); setLoading(false) }
        return
      }

      // No birthdate field exists on family members yet, so there's no
      // real basis for computing milestone years (e.g. university) —
      // leave events empty rather than guessing a year, per the honest
      // empty-state approach documented above.
      if (!cancelled) { setEvents([]); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [family])

  return {
    events,
    loading,
    hasData: events.length > 0,
    hasChildren: (family?.members ?? []).some((m) => m.role === 'child'),
  }
}
// Same detector-can-fire-multiple-rules issue fixed in AIAnswer.tsx's
// KEYWORD_DETECTOR (see that file's comment) — family_protection_gap and
// family_emergency_fund_adequacy each cover two distinct concerns, so
// naively taking "the first insight for this detector" picks whichever
// happens to sort first, not the one relevant to the scenario. Verified
// live: without a preferred rule, "Medical emergency" only showed the
// right one (no_income_protection, relevant to being unable to work due
// to illness) because it happened to come first in array order — the
// same pattern would have silently shown the wrong rule for "Family
// member passed away" (life insurance, not income protection) had that
// order been different, exactly like the Assistant bug did for "job".
const EVENT_DETECTOR_MAP: Record<string, { detectorId: string; preferredRuleId?: string }> = {
  bereavement: { detectorId: 'family_protection_gap', preferredRuleId: 'life_insurance_below_household_needs' },
  medical: { detectorId: 'family_protection_gap', preferredRuleId: 'no_income_protection' },
  'job-loss': { detectorId: 'family_emergency_fund_adequacy', preferredRuleId: 'emergency_fund_below_3_months' },
  university: { detectorId: 'family_education_shortfall', preferredRuleId: 'education_fund_behind_target' },
  retirement: { detectorId: 'family_retirement_gap' },
}

/**
 * Fetches event-specific readiness data from the API. Falls back to the
 * provided hardcoded stability score and explanation when the API has
 * no insights for the given event.
 */
export function useEventReadiness(
  eventId: string,
  fallbackStability: number,
  fallbackExplanation: string,
) {
  const [stability, setStability] = useState(fallbackStability)
  const [explanation, setExplanation] = useState(fallbackExplanation)
  const [hasLiveData, setHasLiveData] = useState(false)
  const [insightId, setInsightId] = useState<string | null>(null)
  const [ruleId, setRuleId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const mapping = EVENT_DETECTOR_MAP[eventId]
      if (!mapping) {
        if (!cancelled) {
          setStability(fallbackStability)
          setExplanation(fallbackExplanation)
          setHasLiveData(false)
          setInsightId(null)
          setRuleId(null)
          setLoading(false)
        }
        return
      }

      try {
        const insights = await fetchFamilyInsights()
        const candidates = insights.filter((i) => i.detector_id === mapping.detectorId)
        const matching = candidates.find((i) => i.rule_id === mapping.preferredRuleId) ?? candidates[0]
        if (!cancelled) {
          if (matching && (matching.reasoning || matching.hypothesis)) {
            setStability(matching.confidence > 0 ? Math.round(matching.confidence * 100) : fallbackStability)
            setExplanation(matching.reasoning || matching.hypothesis || fallbackExplanation)
            setHasLiveData(true)
            setInsightId(matching.id)
            setRuleId(matching.rule_id)
          } else {
            setStability(fallbackStability)
            setExplanation(fallbackExplanation)
            setHasLiveData(false)
            setInsightId(null)
            setRuleId(null)
          }
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setStability(fallbackStability)
          setExplanation(fallbackExplanation)
          setHasLiveData(false)
          setInsightId(null)
          setRuleId(null)
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [eventId, fallbackStability, fallbackExplanation])

  return { stability, explanation, hasLiveData, insightId, ruleId, loading }
}
