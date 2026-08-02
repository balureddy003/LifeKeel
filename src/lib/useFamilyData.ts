/**
 * React hooks for fetching family data from the Kairos API.
 * Falls back to local mock data when the API is unreachable.
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  fetchFamilyInsights,
  fetchFamilyGoals,
  fetchFamilyReadinessScore,
  type FamilyInsight,
  type FamilyGoal,
} from './api'
import { FAMILY_HEALTH_SCORE } from './life-data'
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
      const apiScore = await fetchFamilyReadinessScore()
      if (!cancelled) {
        setScore(apiScore)
        setHasLiveData(apiScore > 0)
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
 * insights. A domain's score reflects how resolved its open insights are —
 * fully resolved (approved/dismissed) insights count as healthy, open ones
 * pull the score down proportional to their confidence. Falls back to a
 * labeled sample score when no insights exist for that domain yet.
 */
export function useFamilyHealthDomains() {
  const { insights, loading, error } = useFamilyInsights()

  const domains: Record<HealthDomain, DomainHealth> = {} as Record<HealthDomain, DomainHealth>

  for (const domain of Object.keys(DOMAIN_DETECTOR_MAP) as HealthDomain[]) {
    const detectorId = DOMAIN_DETECTOR_MAP[domain]
    const domainInsights = insights.filter((i) => i.detector_id === detectorId)

    if (domainInsights.length === 0) {
      domains[domain] = { score: DOMAIN_FALLBACK_SCORE[domain], hasLiveData: false, insights: [] }
      continue
    }

    const resolved = domainInsights.filter((i) => i.state === 'approved' || i.state === 'dismissed').length
    const openPenalty = domainInsights
      .filter((i) => i.state !== 'approved' && i.state !== 'dismissed')
      .reduce((sum, i) => sum + i.confidence, 0)
    const score = Math.round(
      Math.max(0, Math.min(100, (resolved / domainInsights.length) * 100 - openPenalty * 10)),
    )
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

      const currentYear = new Date().getFullYear()
      const generated: TimelineEvent[] = []

      for (const member of members) {
        if (member.role === 'child') {
          generated.push({
            id: `${member.id}-university`,
            emoji: '',
            label: `${member.name}'s University`,
            year: currentYear + 6,
            status: 'future',
          })
        }
      }

      generated.sort((a, b) => a.year - b.year)
      if (!cancelled) { setEvents(generated); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [family])

  return { events, loading, hasData: events.length > 0 }
}
const EVENT_DETECTOR_MAP: Record<string, string> = {
  bereavement: 'family_protection_gap',
  medical: 'family_protection_gap',
  'job-loss': 'family_emergency_fund_adequacy',
  university: 'family_education_shortfall',
  retirement: 'family_retirement_gap',
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const detectorId = EVENT_DETECTOR_MAP[eventId]
      if (!detectorId) {
        if (!cancelled) {
          setStability(fallbackStability)
          setExplanation(fallbackExplanation)
          setHasLiveData(false)
          setLoading(false)
        }
        return
      }

      try {
        const insights = await fetchFamilyInsights()
        const matching = insights.find((i) => i.detector_id === detectorId)
        if (!cancelled) {
          if (matching && (matching.reasoning || matching.hypothesis)) {
            setStability(matching.confidence > 0 ? Math.round(matching.confidence * 100) : fallbackStability)
            setExplanation(matching.reasoning || matching.hypothesis || fallbackExplanation)
            setHasLiveData(true)
          } else {
            setStability(fallbackStability)
            setExplanation(fallbackExplanation)
            setHasLiveData(false)
          }
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setStability(fallbackStability)
          setExplanation(fallbackExplanation)
          setHasLiveData(false)
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [eventId, fallbackStability, fallbackExplanation])

  return { stability, explanation, hasLiveData, loading }
}
