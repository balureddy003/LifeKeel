/**
 * Family app API client — bridges the family frontend to the shared Kairos API.
 *
 * Uses the same /insights and /goals endpoints as Studio, filtered by the
 * family vertical's detector ids. Falls back to mock data when the API is
 * unreachable (offline-first, matching the family app's PWA posture).
 */

import { AI_RESPONSES } from './life-data'

export interface FamilyInsight {
  id: string
  detector_id: string
  hypothesis: string
  reasoning: string
  actions: string[]
  confidence: number
  urgency: string
  category: string
  state: string
  created_at: string
}

export interface FamilyGoal {
  id: string
  name: string
  description: string
  status: string
  kpis: {
    metric: string
    label: string
    current: number
    target: number
    unit: string
    direction: string
  }[]
}

const FAMILY_DETECTORS = [
  'family_protection_gap',
  'family_education_shortfall',
  'family_emergency_fund_adequacy',
  'family_retirement_gap',
] as const

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
}

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('kairos_token')
}

async function apiFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}${path}`, { headers })
    if (!res.ok) throw new Error(`API ${res.status}`)
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

export async function fetchFamilyInsights(): Promise<FamilyInsight[]> {
  return apiFetch<{ insights: FamilyInsight[] }>(
    `/insights?detectors=${FAMILY_DETECTORS.join(',')}`,
    { insights: [] },
  ).then((r) => r.insights ?? [])
}

export async function fetchFamilyGoals(): Promise<FamilyGoal[]> {
  return apiFetch<{ goals: FamilyGoal[] }>(
    '/goals',
    { goals: [] },
  ).then((r) => r.goals ?? [])
}

export async function fetchFamilyReadinessScore(): Promise<number> {
  const insights = await fetchFamilyInsights()
  if (insights.length === 0) return 0
  const resolved = insights.filter((i) => i.state === 'approved' || i.state === 'dismissed').length
  return Math.round((resolved / insights.length) * 100)
}

/**
 * Fetches an AI-style response for a user query. In production this would
 * call the engine's LLM fusion endpoint; for now it uses the local
 * AI_RESPONSES map with a compliance-safe fallback.
 */
export async function fetchAIResponse(query: string): Promise<string> {
  const lower = query.toLowerCase()
  for (const [key, response] of Object.entries(AI_RESPONSES)) {
    if (lower.includes(key)) return response
  }
  return "Based on the information you've entered, here is a summary from your family's data. This is for informational purposes only — please consult a qualified professional before making financial decisions. Would you like to see the specific numbers from your family's profile?"
}
