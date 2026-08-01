/**
 * Family app API client — bridges the family frontend to the shared Kairos API.
 *
 * Uses the same /insights and /goals endpoints as Studio, filtered by the
 * family vertical's detector ids. Falls back to mock data when the API is
 * unreachable (offline-first, matching the family app's PWA posture).
 */

import { AI_RESPONSES } from './life-data'
import type { InboxItem } from './onboarding-data'

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
 *
 * Returns both the content and an `isLive` flag so the UI can distinguish
 * real API responses from mock fallbacks and label them accordingly.
 */
export async function fetchAIResponse(query: string): Promise<{ content: string; isLive: boolean }> {
  const lower = query.toLowerCase()
  for (const [key, response] of Object.entries(AI_RESPONSES)) {
    if (lower.includes(key)) return { content: response, isLive: false }
  }
  return {
    content: "Based on the information you've entered, here is a summary from your family's data. This is for informational purposes only — please consult a qualified professional before making financial decisions. Would you like to see the specific numbers from your family's profile?",
    isLive: false,
  }
}

// ── Documents ─────────────────────────────────────────────────────────────

export interface FamilyDocument {
  id: string
  filename: string
  category: string
  // 'stored' = uploaded and scanned (free, every plan), AI field
  // extraction not run. 'uploaded'/'processing'/'extracted'/'error' cover
  // the paid AI-extraction pipeline.
  status: 'uploaded' | 'processing' | 'extracted' | 'stored' | 'error'
  uploadedAt: string
  extractedData?: Record<string, string>
}

export async function uploadDocument(file: File): Promise<FamilyDocument> {
  const base = getApiBase()
  const token = getAuthToken()
  const formData = new FormData()
  formData.append('file', file)

  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${base}/documents/upload`, {
    method: 'POST',
    headers,
    body: formData,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  return (await res.json()) as FamilyDocument
}

export async function fetchDocuments(): Promise<{ documents: FamilyDocument[]; aiExtractionEnabled: boolean }> {
  return apiFetch<{ documents: FamilyDocument[]; aiExtractionEnabled: boolean }>(
    '/documents',
    { documents: [], aiExtractionEnabled: false },
  )
}

// ── Connectors ────────────────────────────────────────────────────────────

export interface ConnectorStatus {
  id: string
  name: string
  category: string
  connected: boolean
  lastSync?: string
  authUrl?: string
}

const FAMILY_CONNECTORS: { id: string; name: string; category: string }[] = [
  { id: 'gmail', name: 'Gmail', category: 'email' },
  { id: 'open-banking', name: 'Open Banking', category: 'bank' },
  { id: 'trading212', name: 'Trading 212', category: 'investments' },
  { id: 'zerodha', name: 'Zerodha', category: 'investments' },
]

export async function fetchConnectorStatuses(): Promise<ConnectorStatus[]> {
  return apiFetch<{ connectors: ConnectorStatus[] }>(
    '/connectors/status',
    { connectors: FAMILY_CONNECTORS.map((c) => ({ ...c, connected: false })) },
  ).then((r) => r.connectors ?? [])
}

export async function getConnectorAuthUrl(connectorId: string): Promise<string | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/connectors/${connectorId}/auth`, {
      method: 'POST',
      headers,
    })
    if (!res.ok) return null
    const data = await res.json() as { authUrl: string }
    return data.authUrl
  } catch {
    return null
  }
}

export async function disconnectConnector(connectorId: string): Promise<boolean> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/connectors/${connectorId}/disconnect`, {
      method: 'POST',
      headers,
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Family Group ─────────────────────────────────────────────────────────

export interface ApiFamilyMember {
  id: string
  name: string
  email: string
  role: 'organizer' | 'parent' | 'adult' | 'child'
  status: 'active' | 'pending'
  joinedAt: string
}

export interface ApiFamilyGroup {
  id: string
  name: string
  inviteCode: string
  members: ApiFamilyMember[]
}

async function familyGroupRequest(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<ApiFamilyGroup> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data.family as ApiFamilyGroup
}

export async function fetchFamilyGroup(): Promise<ApiFamilyGroup | null> {
  return apiFetch<{ family: ApiFamilyGroup | null }>('/family', { family: null }).then((r) => r.family ?? null)
}

export async function createFamilyGroup(name: string): Promise<ApiFamilyGroup> {
  return familyGroupRequest('/family', 'POST', { name })
}

export async function renameFamilyGroup(name: string): Promise<ApiFamilyGroup> {
  return familyGroupRequest('/family', 'PATCH', { name })
}

export async function addFamilyGroupMember(
  name: string,
  email: string,
  role: ApiFamilyMember['role'],
): Promise<ApiFamilyGroup> {
  return familyGroupRequest('/family/members', 'POST', { name, email, role })
}

export async function updateFamilyGroupMemberRole(id: string, role: ApiFamilyMember['role']): Promise<ApiFamilyGroup> {
  return familyGroupRequest(`/family/members/${id}`, 'PATCH', { role })
}

export async function removeFamilyGroupMember(id: string): Promise<ApiFamilyGroup> {
  return familyGroupRequest(`/family/members/${id}`, 'DELETE')
}

// ── Inbox ─────────────────────────────────────────────────────────────────

export async function dismissInboxItem(itemId: string): Promise<boolean> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/inbox/${itemId}/dismiss`, {
      method: 'POST',
      headers,
    })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchInboxItems(): Promise<{ items: InboxItem[]; isLive: boolean }> {
  return apiFetch<{ items: InboxItem[] }>(
    '/inbox',
    { items: [] },
  ).then((r) => ({
    items: r.items ?? [],
    isLive: (r.items?.length ?? 0) > 0,
  }))
}
