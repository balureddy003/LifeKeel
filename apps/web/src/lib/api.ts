/**
 * Family app API client — bridges the family frontend to the shared Kairos API.
 *
 * Uses the same /insights and /goals endpoints as Studio, filtered by the
 * family vertical's detector ids. Falls back to an empty/null result when
 * the API is unreachable (offline-first, matching the family app's PWA
 * posture) rather than fabricated data.
 */

import { AI_RESPONSES } from './life-data'
import type { InboxItem } from './onboarding-data'
import { getApiBase } from './env'
import { reportError } from './observability'

export interface FamilyInsight {
  id: string
  detector_id: string
  rule_id: string
  hypothesis: string
  reasoning: string
  actions: string[]
  confidence: number
  urgency: string
  category: string
  state: string
  created_at: string
}

// Real engine output (packages/engine's Trigger/Insight schema) has no flat
// `confidence` field — it lives at confidence_breakdown.combined_score — and
// its terminal states are 'completed' | 'dismissed' | 'archived' | 'resolved'
// (PRD-107 — auto-retracted when a later evaluation no longer reproduces the
// condition, distinct from an explicit dismiss/approve), not 'approved'.
// This adapts that shape to the flat one the rest of this app reads, instead
// of every call site re-deriving it (or silently getting NaN).
interface RawInsight {
  id: string
  detector_id: string
  rule_id: string
  hypothesis: string
  reasoning: string
  actions: string[]
  confidence_breakdown?: { combined_score?: number; or_score?: number }
  urgency: string
  category: string
  state: string
  created_at: string
}

export const RESOLVED_INSIGHT_STATES = ['completed', 'dismissed', 'archived', 'resolved']

function adaptInsight(raw: RawInsight): FamilyInsight {
  return {
    id: raw.id,
    detector_id: raw.detector_id,
    rule_id: raw.rule_id,
    hypothesis: raw.hypothesis,
    reasoning: raw.reasoning,
    actions: raw.actions,
    confidence: raw.confidence_breakdown?.combined_score ?? raw.confidence_breakdown?.or_score ?? 0,
    urgency: raw.urgency,
    category: raw.category,
    state: raw.state,
    created_at: raw.created_at,
  }
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

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('agentoak_token')
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
    if (!res.ok) {
      // 4xx here is routine — "no family yet", "not signed in yet" — that's
      // exactly why every caller treats the fallback as a normal empty
      // state, not an error. Only report what the fallback can't explain
      // away as a legitimate empty state: a network failure (caught below)
      // or the server itself erroring.
      if (res.status >= 500) reportError(new Error(`API ${res.status}`), { path })
      return fallback
    }
    return (await res.json()) as T
  } catch (err) {
    // fetch() itself threw — offline or unreachable, not a status code.
    reportError(err, { path })
    return fallback
  }
}

export async function fetchFamilyInsights(): Promise<FamilyInsight[]> {
  // The `detectors` param is now filtered server-side (GET /insights), so a
  // tenant active in other verticals doesn't push family insights off the
  // page before they even reach here. Still filter client-side too — cheap,
  // and keeps this honest if the server-side filter is ever relaxed.
  return apiFetch<{ insights: RawInsight[] }>(
    `/insights?detectors=${FAMILY_DETECTORS.join(',')}`,
    { insights: [] },
  ).then((r) =>
    (r.insights ?? [])
      .filter((i) => (FAMILY_DETECTORS as readonly string[]).includes(i.detector_id))
      .map(adaptInsight),
  )
}

export async function fetchFamilyGoals(): Promise<FamilyGoal[]> {
  return apiFetch<{ goals: FamilyGoal[] }>(
    '/goals',
    { goals: [] },
  ).then((r) => r.goals ?? [])
}

// Starts from 100 (no known gaps) and subtracts a confidence-weighted
// penalty per currently-open insight, matching useFamilyHealthDomains'
// per-domain scoring. Previously this was (resolvedCount / totalCount) *
// 100, which scored exactly 0% for any family with insights and nothing
// manually resolved yet — the normal state right after submitting a real
// financial profile, which is the one moment this number is most visible
// and most likely to be read as "the app found nothing good about my
// finances" rather than "you haven't clicked dismiss on anything yet".
//
// Zero insights is itself ambiguous — "no profile submitted" and "profile
// submitted, nothing wrong found" (the ideal outcome) both produce an empty
// array. Checking whether a profile actually exists is what tells a
// well-covered family "you're verified and clear" instead of showing them
// the same "No data yet, connect your accounts" prompt as someone who
// hasn't done anything.
export async function fetchFamilyReadinessScore(): Promise<{ score: number; hasLiveData: boolean }> {
  const insights = await fetchFamilyInsights()
  if (insights.length === 0) {
    const profile = await fetchFinancialProfile()
    return profile ? { score: 100, hasLiveData: true } : { score: 0, hasLiveData: false }
  }
  const openPenalty = insights
    .filter((i) => !RESOLVED_INSIGHT_STATES.includes(i.state))
    .reduce((sum, i) => sum + i.confidence, 0)
  return { score: Math.round(Math.max(0, Math.min(100, 100 - openPenalty * 10))), hasLiveData: true }
}

/**
 * Fetches an AI-style response for a user query. Calls the backend
 * assistant endpoint (POST /assistant/ask), which reasons over the
 * tenant's real financial profile and open insights via an LLM. Falls
 * back to the local AI_RESPONSES map (compliance-safe, isLive: false)
 * when the backend is unreachable or returns a non-2xx status — this
 * keeps the previous behavior as a genuine offline degradation path
 * rather than the whole feature.
 *
 * Returns both the content and an `isLive` flag so the UI can distinguish
 * real API responses from mock fallbacks and label them accordingly.
 */
export async function fetchAIResponse(query: string): Promise<{ content: string; isLive: boolean }> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/assistant/ask`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    })
    if (res.ok) {
      const data = (await res.json()) as { content?: string; isLive?: boolean }
      if (typeof data.content === 'string') {
        return { content: data.content, isLive: Boolean(data.isLive) }
      }
    }
  } catch {
    // Network failure or unreachable backend — fall through to the local map.
  }

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

export interface FamilyDocumentDetail extends FamilyDocument {
  rawText: string
}

export async function fetchDocument(id: string): Promise<FamilyDocumentDetail | null> {
  return apiFetch<FamilyDocumentDetail | null>(`/documents/${id}`, null)
}

export interface ProfileSuggestion {
  path: string
  label: string
  valueMinor: number
  sourceField: string
  sourceValue: string
}

export async function fetchProfileSuggestions(documentId: string): Promise<ProfileSuggestion[]> {
  return apiFetch<{ suggestions: ProfileSuggestion[] }>(
    `/documents/${documentId}/profile-suggestions`,
    { suggestions: [] },
  ).then((r) => r.suggestions)
}

export async function applyDocumentToProfile(
  documentId: string,
  paths?: string[],
): Promise<{ applied: { path: string; label: string; valueMinor: number }[] }> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${base}/documents/${documentId}/apply-to-profile`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ paths }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not apply this document to your Financial Profile')
  return data
}

// ── Connectors ────────────────────────────────────────────────────────────

export interface ConnectorStatus {
  id: string
  name: string
  category: string
  connected: boolean
  comingSoon?: boolean
  lastSync?: string
  authUrl?: string
}

// Trading212/Zerodha deliberately excluded — see family-connectors.ts.
const FAMILY_CONNECTORS: { id: string; name: string; category: string; comingSoon?: boolean }[] = [
  { id: 'email', name: 'Email', category: 'email' },
  { id: 'open-banking', name: 'Open Banking', category: 'bank', comingSoon: true },
]

export async function fetchConnectorStatuses(): Promise<ConnectorStatus[]> {
  return apiFetch<{ connectors: ConnectorStatus[] }>(
    '/connectors/status',
    { connectors: FAMILY_CONNECTORS.map((c) => ({ ...c, connected: false })) },
  ).then((r) => r.connectors ?? [])
}

// Mirrors apps/api/src/email/providers.ts — host/port stay server-side, the
// client only needs the id (to send) and label/hint (to display). Picking
// "Other" leaves host/port to the user, which is what makes this connector
// generic rather than tied to a fixed provider list.
export interface EmailProviderOption {
  id: string
  name: string
  passwordHint: string
}

export const EMAIL_PROVIDER_OPTIONS: EmailProviderOption[] = [
  { id: 'gmail', name: 'Gmail', passwordHint: 'Use a Google App Password, not your regular password (Google Account → Security → App passwords).' },
  { id: 'outlook', name: 'Outlook / Microsoft 365', passwordHint: 'Use an app password if your account has multi-factor authentication enabled.' },
  { id: 'yahoo', name: 'Yahoo Mail', passwordHint: 'Generate an app password from Yahoo Account Security settings.' },
  { id: 'icloud', name: 'iCloud Mail', passwordHint: 'Use an app-specific password from appleid.apple.com.' },
  { id: 'custom', name: 'Other / custom', passwordHint: "Check your email provider's IMAP settings page for the server host and port." },
]

export interface ConnectEmailPayload {
  provider?: string
  host?: string
  port?: number
  useTls?: boolean
  username: string
  password: string
}

export async function connectEmail(payload: ConnectEmailPayload): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${base}/connectors/email/credentials`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const base = data.error || 'Could not connect — check your details and try again.'
    // `detail` carries the mail server's actual reason (e.g. Gmail's real
    // auth-failure text) — append it when present so the message says more
    // than "check the host, port, and password" for the exact same error
    // whether the password was wrong or IMAP is disabled entirely.
    const error = data.detail && data.detail !== base ? `${base} (${data.detail})` : base
    return { ok: false, error }
  }
  return { ok: true }
}

/** Kicks off the Gmail OAuth flow — resolves to the Google consent-screen
 * URL to navigate the browser to. On success, the callback lands back on
 * this same /connect/email page with ?connected=email; on failure, with
 * ?connect=gmail&error=... (see registerConnectorCredentialRoutes' family
 * branch in apps/api/src/routes/connector-credentials.ts). */
export async function startGmailOAuth(): Promise<string> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${base}/connectors/gmail/oauth/start?app=family&mode=json`, { headers })
  if (!res.ok) throw new Error('Could not start Google sign-in — please try again.')
  const data = (await res.json()) as { auth_url?: string }
  if (!data.auth_url) throw new Error('Could not start Google sign-in — please try again.')
  return data.auth_url
}

export interface EmailScanResult {
  scanned: number
  inboxItemsCreated: number
  documentsCreated: number
}

export async function scanEmailInbox(): Promise<EmailScanResult | null> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${base}/connectors/email/scan`, { method: 'POST', headers })
  if (!res.ok) return null
  return (await res.json()) as EmailScanResult
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
  } catch (err) {
    reportError(err, { connectorId })
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

// ── Insight drafts (Tier 1 "prepare, don't send" — PRD-103) ────────────────

export interface InsightDraft {
  content: string
  generated_at: string
}

// Copy-to-clipboard / open-in-email-client only — there is no "send"
// endpoint anywhere in this app, on purpose. See docs/prd/103-tier1-prepare-actions.md.
export async function prepareInsightDraft(insightId: string): Promise<InsightDraft | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/insights/${insightId}/prepare`, {
      method: 'POST',
      headers,
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null) as { draft?: InsightDraft | null } | null
    return data?.draft ?? null
  } catch (err) {
    reportError(err, { insightId })
    return null
  }
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
  } catch (err) {
    reportError(err, { itemId })
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

// ── Financial profile ────────────────────────────────────────────────────
// Feeds the family vertical's detectors (protection gap, emergency fund,
// education shortfall, retirement gap) — without this, those detectors have
// no real signals to evaluate and every event/home panel stays on sample data.

export interface FinancialProfileEducationFund {
  child_name: string
  child_age: number
  current_savings_minor: number
  target_savings_minor: number
  years_remaining: number
}

export type EmploymentStatus = 'employed' | 'self_employed' | 'unemployed' | 'retired'

// PRD-105: car/home added — recordable now, coverage-adequacy reasoning
// for either is a separate, later PRD (see PRD-105's "Out of scope").
export type PolicyType = 'life' | 'income_protection' | 'health' | 'critical_illness' | 'car' | 'home'

// Additive to household.life_cover_minor / income_protection_monthly_minor
// below, not a replacement — those two fields still feed the original
// protection-gap rules directly. This is the policy-level model (PRD-102)
// that powers renewal tracking and coverage-type-gap detection.
export interface FinancialProfilePolicy {
  type: PolicyType
  provider: string
  coverage_amount_minor: number
  monthly_premium_minor: number
  renewal_date?: string
}

export interface FinancialProfile {
  household: {
    employment_status: EmploymentStatus
    monthly_salary_minor: number
    annual_living_expenses_minor: number
    mortgage_outstanding_minor: number
    life_cover_minor: number
    income_protection_monthly_minor: number
    // PRD-104: additive — a mixed-earner household (one partner retired,
    // one still working; one salaried, one self-employed) couldn't be
    // represented at all before this, so the arbitrary single status
    // picked for the household decided whether a real protection gap was
    // ever surfaced (OAK-029). Each entry links to a real family-roster
    // member (member_id) rather than an anonymous second earner. See
    // family-financial-profile.ts's multi-event evaluation.
    members: Array<{
      member_id: string
      employment_status: EmploymentStatus
      monthly_salary_minor: number
      income_protection_monthly_minor: number
    }>
  }
  emergency_fund: {
    emergency_savings_minor: number
    monthly_expenses_minor: number
    has_high_interest_debt: boolean
    high_interest_debt_balance_minor: number
  }
  retirement: {
    current_age: number
    target_retirement_age: number
    pension_balance_minor: number
    monthly_contribution_minor: number
    target_retirement_income_minor: number
    expected_annual_growth_pct: number
  }
  education_funds: FinancialProfileEducationFund[]
  policies: FinancialProfilePolicy[]
}

async function fetchFinancialProfileRaw(): Promise<{ profile: FinancialProfile | null; version: number }> {
  return apiFetch<{ profile: FinancialProfile | null; version?: number }>(
    '/family/financial-profile',
    { profile: null },
  ).then((r) => ({ profile: r.profile ?? null, version: r.version ?? 0 }))
}

export async function fetchFinancialProfile(): Promise<FinancialProfile | null> {
  return fetchFinancialProfileRaw().then((r) => r.profile)
}

/**
 * Same as fetchFinancialProfile, plus the document's current version —
 * OAK-006: the wizard needs this to detect (rather than silently overwrite)
 * a concurrent edit from another tab/device. Only the wizard needs the
 * version; every other caller keeps using the plain fetchFinancialProfile.
 */
export async function fetchFinancialProfileWithVersion(): Promise<{ profile: FinancialProfile | null; version: number }> {
  return fetchFinancialProfileRaw()
}

// generateInsights defaults to false — most calls are the wizard's per-step
// autosave, which should only persist progress. Detector evaluation against
// a step the user hasn't reached yet (still at its default/empty value)
// produces a stale insight that never gets retracted once the real number
// arrives later in the form, so only the final "Save & Generate Insights"
// step should pass true.
//
// `version`, when passed, is sent so the server can detect a concurrent
// edit from another tab/device (OAK-006) — omit it for a first-ever save.
export async function submitFinancialProfile(
  profile: FinancialProfile,
  generateInsights = false,
  version?: number,
): Promise<{ insightsGenerated: number; version: number }> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${base}/family/financial-profile`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...profile, generate_insights: generateInsights, ...(version !== undefined ? { version } : {}) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 409) throw new Error(data.error || 'This profile was updated elsewhere — reload and try again.')
    throw new Error(data.error || 'Request failed')
  }
  return { insightsGenerated: data.insights_generated ?? 0, version: data.version ?? version ?? 0 }
}

// ── Life events (PRD-108) ────────────────────────────────────────────────
// A life event is a fact the family declares happened ("I lost my job"),
// distinct from /events' hypothetical "What If?" simulator (life-data.ts's
// LIFE_EVENTS/EVENT_ACTIONS) — that stays a sample scenario explorer;
// this reports a real event and gets back a playbook personalized against
// the real financial profile, re-rendered live on every fetch rather than
// frozen at report time.

export type LifeEventType = 'job_loss' | 'bereavement' | 'disability'

export interface LifeEventPlaybookStep {
  id: string
  title: string
  body: string
  // Eligible for the same Tier 1 "prepare, don't send" draft affordance
  // insight cards use (PRD-103) — see prepareLifeEventStepDraft below.
  contact: boolean
}

export interface LifeEventPlaybook {
  event_type: LifeEventType
  title: string
  intro: string
  steps: LifeEventPlaybookStep[]
}

export interface LifeEvent {
  id: string
  event_type: LifeEventType
  affected_member_id: string | null
  reported_at: string
  playbook: LifeEventPlaybook | null
}

export async function fetchLifeEvents(): Promise<LifeEvent[]> {
  return apiFetch<{ events: LifeEvent[] }>('/family/life-events', { events: [] }).then((r) => r.events ?? [])
}

export async function reportLifeEvent(eventType: LifeEventType, affectedMemberId?: string): Promise<LifeEvent | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/family/life-events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event_type: eventType,
        ...(affectedMemberId ? { affected_member_id: affectedMemberId } : {}),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Request failed')
    return data as LifeEvent
  } catch (err) {
    reportError(err, { eventType })
    return null
  }
}

// Same copy-to-clipboard / open-in-email-client-only posture as
// prepareInsightDraft above — there is no "send" endpoint here either.
export async function prepareLifeEventStepDraft(eventId: string, stepId: string): Promise<InsightDraft | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/family/life-events/${eventId}/steps/${stepId}/prepare`, {
      method: 'POST',
      headers,
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null) as { draft?: InsightDraft | null } | null
    return data?.draft ?? null
  } catch (err) {
    reportError(err, { eventId, stepId })
    return null
  }
}

// ── Password reset ───────────────────────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/auth/request-password-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, app: 'family' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
}

// ── Public readiness quiz (PRD-201) ─────────────────────────────────────

export interface ReadinessQuizAnswers {
  monthly_salary_minor: number
  emergency_savings_minor: number
  monthly_expenses_minor: number
  mortgage_outstanding_minor: number
  life_cover_minor: number
  dependents: number
}

export interface ReadinessQuizInsight {
  hypothesis: string
  reasoning: string
  category: string
  rule_id: string
  estimated_impact_low: number
  estimated_impact_high: number
}

export interface ReadinessQuizResult {
  score: number | null
  insights: ReadinessQuizInsight[]
  error?: string
}

/** Public, unauthenticated — no token, nothing tied to an identity. */
export async function submitReadinessQuiz(answers: ReadinessQuizAnswers): Promise<ReadinessQuizResult> {
  const res = await fetch(`${getApiBase()}/readiness-quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(answers),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { score: null, insights: [], error: data.error || 'Request failed' }
  return { score: data.score ?? null, insights: data.insights ?? [], error: data.error }
}

// ── Blog / detector-driven content (PRD-202) ────────────────────────────

export interface BlogPostSummary {
  id: string
  title: string
  slug: string
  excerpt: string
  category: 'product' | 'tutorial' | 'case-study' | 'news'
  author: string
  published: boolean
  tags: string[]
  created_at: string
  updated_at: string
  published_at?: string
}

export interface BlogPost extends BlogPostSummary {
  content: string
}

/** Public, unauthenticated. */
export async function fetchBlogPosts(): Promise<BlogPostSummary[]> {
  const res = await fetch(`${getApiBase()}/blog/posts`)
  if (!res.ok) return []
  const data = await res.json().catch(() => ({ posts: [] }))
  return data.posts ?? []
}

/** Public, unauthenticated. Returns null on 404 or any failure. */
export async function fetchBlogPost(slug: string): Promise<BlogPost | null> {
  const res = await fetch(`${getApiBase()}/blog/posts/${encodeURIComponent(slug)}`)
  if (!res.ok) return null
  return res.json().catch(() => null)
}

// ── Billing (Oak Plus) ───────────────────────────────────────────────────

export interface BillingSubscription {
  plan: string
  status: string
}

export async function fetchBillingSubscription(): Promise<BillingSubscription | null> {
  return apiFetch<{ plan: string; status: string } | null>('/billing/subscription', null)
}

export async function startOakPlusCheckout(): Promise<string> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${base}/billing/checkout`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ plan: 'starter', app: 'family' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not start checkout')
  return data.checkout_url as string
}
