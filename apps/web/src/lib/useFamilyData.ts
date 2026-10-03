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
  fetchFamilyReadiness,
  fetchFamilyReadinessScore,
  fetchFinancialProfile,
  fetchEventReadiness as fetchEventReadinessApi,
  type FinancialProfile,
  type ReadinessComponentKey,
  RESOLVED_INSIGHT_STATES,
  type FamilyInsight,
  type FamilyGoal,
} from './api'
import { useAuth } from './auth-context'
import type { TimelineEvent } from './modes'
import { calculateAge } from './age'

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
      try {
        const { score: apiScore, hasLiveData: liveData } = await fetchFamilyReadinessScore()
        if (!cancelled) {
          setScore(apiScore)
          setHasLiveData(liveData)
        }
      } catch {
        // Live-verification finding: this had no catch — a rejected fetch
        // left `loading` true forever, an infinite skeleton on the home
        // page's score card with no error shown. Honest zero/no-data state
        // instead, matching fetchFamilyReadinessScore's own fallback shape.
        if (!cancelled) {
          setScore(0)
          setHasLiveData(false)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { score, hasLiveData, loading }
}

// A target of <= £1 (100 minor units) is unset — see isUnsetTarget in the API.
const TARGET_SET_MINOR = 100

/** Did the domain's detector have real inputs to evaluate? */
function domainWasChecked(domain: HealthDomain, p: FinancialProfile | null): boolean {
  if (!p) return false
  switch (domain) {
    case 'protection':
      return true
    case 'savings':
      return p.emergency_fund.monthly_expenses_minor > 0 || p.household.annual_living_expenses_minor > 0
    case 'wealth':
      return p.retirement.target_retirement_income_minor > TARGET_SET_MINOR
    case 'goals':
      return p.education_funds.some((f) => f.target_savings_minor > TARGET_SET_MINOR)
    case 'estate':
      // Estate readiness is driven by vault contents, not the profile —
      // only the server knows (the vault is adult-gated).
      return false
  }
}

export type HealthDomain = 'protection' | 'wealth' | 'goals' | 'savings' | 'estate'

export interface DomainHealth {
  score: number
  hasLiveData: boolean
  insights: FamilyInsight[]
  /** One-line explanation from the server's composite score (PRD-114), when available. */
  detail?: string
  /** The profile figures the server score was computed from — shown under
   *  "Why this score" on the domain page (G13 explainability). */
  drivers?: { label: string; value_minor?: number; value?: string }[]
  /** True when this member can't see the underlying data (estate vault is adult-only). */
  gated?: boolean
  /** PRD-137: server-supplied scope disclaimer shown under the score (estate). */
  caption?: string
}

// A domain can be explained by more than one detector — the adequacy
// check plus its pacing/trajectory/hygiene companions.
const DOMAIN_DETECTOR_MAP: Record<HealthDomain, string[]> = {
  protection: ['family_protection_gap', 'family_policy_review'],
  wealth: ['family_retirement_gap'],
  goals: ['family_education_shortfall', 'family_education_pacing'],
  savings: ['family_emergency_fund_adequacy', 'family_emergency_trajectory', 'family_debt_health'],
  estate: ['family_estate_readiness'], // PRD-121 — vault doc_type gaps are now detectable
}

// Server readiness component → health domain. When GET /family/readiness
// is reachable, its deterministic subscores replace the client-side
// insight-penalty math — same numbers the Family Readiness Score shows.
const COMPONENT_TO_DOMAIN: Record<ReadinessComponentKey, HealthDomain> = {
  emergency_fund: 'savings',
  protection: 'protection',
  retirement: 'wealth',
  education: 'goals',
  estate: 'estate',
}

// Fallback scores shown only when the API has no insights yet — labeled as
// sample/illustrative in the UI rather than presented as real numbers.
const DOMAIN_FALLBACK_SCORE: Record<HealthDomain, number> = {
  protection: 90,
  wealth: 65,
  goals: 80,
  savings: 85,
  estate: 50,
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
  const [profile, setProfile] = useState<FinancialProfile | null>(null)
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
  const [readiness, setReadiness] = useState<Awaited<ReturnType<typeof fetchFamilyReadiness>>>(null)
  const loading = insightsLoading || profileLoading

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile()
      .then((p) => {
        if (cancelled) return
        // Only a profile detectors have run on counts — an autosaved,
        // never-finalised one has zero insights too, which is not "healthy".
        setHasProfile(!!p?.insights_evaluated_at)
        setProfile(p)
      })
      .catch(() => {
        // Same "unhandled rejection leaves loading stuck forever" gap
        // useFamilyReadinessScore had — no profile is the safe fallback,
        // same as a genuine 404/null response.
        if (!cancelled) setHasProfile(false)
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })
    // PRD-114: the server's deterministic subscores, when reachable.
    // Null on any failure — the insight-penalty math below is the fallback.
    fetchFamilyReadiness().then((r) => {
      if (!cancelled) setReadiness(r)
    })
    return () => { cancelled = true }
  }, [])

  const serverByDomain = new Map<HealthDomain, NonNullable<typeof readiness>['components'][number]>()
  for (const c of readiness?.components ?? []) {
    serverByDomain.set(COMPONENT_TO_DOMAIN[c.key], c)
  }

  const domains: Record<HealthDomain, DomainHealth> = {} as Record<HealthDomain, DomainHealth>

  for (const domain of Object.keys(DOMAIN_DETECTOR_MAP) as HealthDomain[]) {
    const detectorIds = DOMAIN_DETECTOR_MAP[domain]
    const domainInsights = insights.filter((i) => detectorIds.includes(i.detector_id))

    // Server-side composite is authoritative when live: a real subscore
    // for a domain with data, a null subscore meaning "not enough data" —
    // which renders as the sample state, not a false 100.
    const server = serverByDomain.get(domain)
    if (server && readiness?.has_live_data) {
      if (server.gated || server.score === null) {
        domains[domain] = {
          score: DOMAIN_FALLBACK_SCORE[domain],
          hasLiveData: false,
          insights: domainInsights,
          detail: server.detail,
          ...(server.gated ? { gated: true } : {}),
          ...(server.caption ? { caption: server.caption } : {}),
        }
      } else {
        domains[domain] = {
          score: server.score,
          hasLiveData: true,
          insights: domainInsights,
          detail: server.detail,
          ...(server.drivers ? { drivers: server.drivers } : {}),
          ...(server.caption ? { caption: server.caption } : {}),
        }
      }
      continue
    }

    if (domainInsights.length === 0) {
      // Zero insights is only "healthy" if the detector had inputs to
      // judge — with no target entered its check is skipped, and a 100%
      // ring for a check that never ran is the same false comfort.
      domains[domain] = hasProfile && domainWasChecked(domain, profile)
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

// Assumed university-start age for a "starts university" milestone — same
// assumption the Financial Profile wizard's Education Funds step uses
// (yearsUntil(dob, 18)), so this timeline and that step agree.
const UNIVERSITY_START_AGE = 18

/**
 * Generates timeline events from the real family roster. Each child with a
 * birthdate on file (see auth-types.ts's dateOfBirth, apps/web/src/lib/age.ts)
 * gets a "starts university" milestone; a child with no birthdate yet
 * contributes nothing — synchronous, local data, no network call, so this
 * never has a loading or error state of its own to hang on.
 */
export function useFamilyTimeline() {
  const { family } = useAuth()

  const events: TimelineEvent[] = (family?.members ?? [])
    .filter((m) => m.role === 'child' && m.dateOfBirth)
    .map((m) => {
      const currentYear = new Date().getFullYear()
      const age = calculateAge(m.dateOfBirth!)
      const year = currentYear + Math.max(0, UNIVERSITY_START_AGE - age)
      return {
        id: `university-${m.id}`,
        scenarioId: 'university',
        emoji: '🎓',
        label: `${m.name} starts university`,
        year,
        status: year > currentYear ? 'future' : year === currentYear ? 'current' : 'done',
      } satisfies TimelineEvent
    })
    .sort((a, b) => a.year - b.year)

  return {
    events,
    loading: false,
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

    // event-readiness.ts on the API side — the fallback used below when
    // EVENT_DETECTOR_MAP has no mapping (car/property/travel today) or the
    // mapped detector hasn't produced a matching insight yet. Never backed
    // by an Insight document, so insightId/ruleId always stay null on this
    // path — the "Draft a message"/"Learn more" affordances that need one
    // simply don't render for these event types, same as before.
    async function loadFromEventReadiness() {
      const result = await fetchEventReadinessApi(eventId)
      if (cancelled) return
      if ('stability' in result && result.hasLiveData) {
        setStability(result.stability)
        setExplanation(result.explanation)
        setHasLiveData(true)
      } else {
        setStability(fallbackStability)
        setExplanation(fallbackExplanation)
        setHasLiveData(false)
      }
      setInsightId(null)
      setRuleId(null)
      setLoading(false)
    }

    async function load() {
      setLoading(true)
      const mapping = EVENT_DETECTOR_MAP[eventId]
      if (!mapping) {
        await loadFromEventReadiness()
        return
      }

      try {
        const insights = await fetchFamilyInsights()
        const candidates = insights.filter((i) => i.detector_id === mapping.detectorId)
        const matching = candidates.find((i) => i.rule_id === mapping.preferredRuleId) ?? candidates[0]
        if (cancelled) return
        if (matching && (matching.reasoning || matching.hypothesis)) {
          setStability(matching.confidence > 0 ? Math.round(matching.confidence * 100) : fallbackStability)
          setExplanation(matching.reasoning || matching.hypothesis || fallbackExplanation)
          setHasLiveData(true)
          setInsightId(matching.id)
          setRuleId(matching.rule_id)
          setLoading(false)
        } else {
          // Mapped detector exists but hasn't flagged anything yet — fall
          // back to the real-data computation rather than going straight
          // to the static sample, so a clean-but-complete profile still
          // shows a real number instead of a permanent "Sample scenario".
          await loadFromEventReadiness()
        }
      } catch {
        if (!cancelled) await loadFromEventReadiness()
      }
    }
    load()
    return () => { cancelled = true }
  }, [eventId, fallbackStability, fallbackExplanation])

  return { stability, explanation, hasLiveData, insightId, ruleId, loading }
}
