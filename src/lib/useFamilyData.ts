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
  const [score, setScore] = useState<number>(FAMILY_HEALTH_SCORE)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const apiScore = await fetchFamilyReadinessScore()
      if (!cancelled) {
        setScore(apiScore > 0 ? apiScore : FAMILY_HEALTH_SCORE)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { score, loading }
}

/**
 * Maps a family life-event id to the detector that would surface insights
 * for that scenario. Used by useEventReadiness to filter API insights.
 */
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
          setLoading(false)
        }
        return
      }

      try {
        const insights = await fetchFamilyInsights()
        const matching = insights.find((i) => i.detector_id === detectorId)
        if (!cancelled) {
          if (matching) {
            setStability(matching.confidence > 0 ? Math.round(matching.confidence * 100) : fallbackStability)
            setExplanation(matching.reasoning || matching.hypothesis || fallbackExplanation)
          } else {
            setStability(fallbackStability)
            setExplanation(fallbackExplanation)
          }
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setStability(fallbackStability)
          setExplanation(fallbackExplanation)
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [eventId, fallbackStability, fallbackExplanation])

  return { stability, explanation, loading }
}
