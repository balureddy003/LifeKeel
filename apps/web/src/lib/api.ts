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
import { fetchOrQueue } from './offline-queue'
import { cachedFetch, invalidateCache } from './fetch-cache'
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
// its resolved (no-longer-open) states are 'approved' | 'completed' |
// 'dismissed' | 'archived' | 'resolved' ('resolved' is PRD-107 — auto-retracted
// when a later evaluation no longer reproduces the condition, distinct from an
// explicit dismiss/approve; 'approved' means a human has decided even while
// action execution is still pending/in-flight). This adapts that shape to the
// flat one the rest of this app reads, instead of every call site re-deriving
// it (or silently getting NaN). Deliberately excludes 'execution_failed' — an
// insight whose approved actions failed to execute should keep surfacing as
// open/actionable so a human notices and can retry via
// POST /insights/:id/retry-execution.
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

export const RESOLVED_INSIGHT_STATES = ['approved', 'completed', 'dismissed', 'archived', 'resolved']

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
  // Cached 30s — the score card, gate list, and AppShell warmer all read
  // this; an insight list that old is fine and the page paints instantly.
  return cachedFetch('family-insights', 30_000, () =>
    apiFetch<{ insights: RawInsight[] }>(
      `/insights?detectors=${FAMILY_DETECTORS.join(',')}`,
      { insights: [] },
    ).then((r) =>
      (r.insights ?? [])
        .filter((i) => (FAMILY_DETECTORS as readonly string[]).includes(i.detector_id))
        .map(adaptInsight),
    ),
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
    // Zero insights only means "no gaps" if detectors actually ran. A
    // profile saved by the wizard's per-step autosave (never finalised)
    // also has zero insights — scoring that 100 told a family with a
    // £400k mortgage and no life cover they were "on track".
    return profile?.insights_evaluated_at
      ? { score: 100, hasLiveData: true }
      : { score: 0, hasLiveData: false }
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

    // Live-verification finding: an Azure OpenAI-backed answer can take
    // 40+ seconds with no server-side timeout, during which the UI had
    // nothing to show but static dots — reads as a dead button. This caps
    // the wait so a slow provider degrades to the labeled local fallback
    // instead of hanging indefinitely.
    const res = await fetch(`${base}/assistant/ask`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) {
      const data = (await res.json()) as { content?: string; isLive?: boolean }
      if (typeof data.content === 'string') {
        return { content: data.content, isLive: Boolean(data.isLive) }
      }
    } else if (res.status >= 500) {
      reportError(new Error(`API ${res.status}`), { path: '/assistant/ask' })
    }
  } catch (err) {
    // Network failure or unreachable backend — report it (this function
    // predates apiFetch's reporting convention and was a blind spot), then
    // fall through to the labeled local map.
    reportError(err, { path: '/assistant/ask' })
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

// A best-effort, editable policies[] suggestion from an OCR'd insurance
// document — see apps/api/src/ocr/profile-mapping.ts's
// mapExtractedFieldsToPolicySuggestion for what's populated vs. left null
// for the user to fill in.
export interface DocumentPolicySuggestion {
  type: PolicyType | null
  provider: string
  coverageAmountMinor: number | null
  monthlyPremiumMinor: number | null
  renewalDate: string | null
  policyNumber: string | null
}

export interface DocumentSuggestions {
  suggestions: ProfileSuggestion[]
  policySuggestion: DocumentPolicySuggestion | null
}

export async function fetchProfileSuggestions(documentId: string): Promise<DocumentSuggestions> {
  return apiFetch<DocumentSuggestions>(
    `/documents/${documentId}/profile-suggestions`,
    { suggestions: [], policySuggestion: null },
  )
}

export async function applyDocumentToProfile(
  documentId: string,
  paths?: string[],
): Promise<{ applied: { path: string; label: string; valueMinor: number }[]; insightsGenerated: number }> {
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
  return { applied: data.applied ?? [], insightsGenerated: data.insights_generated ?? 0 }
}

export interface ApplyPolicyInput {
  type: PolicyType
  provider: string
  coverageAmountMinor: number
  monthlyPremiumMinor: number
  renewalDate?: string
  policyNumber?: string
  // Optional roster-member attribution (PRD-110) — user-picked only.
  memberId?: string
}

export async function applyPolicySuggestion(
  documentId: string,
  policy: ApplyPolicyInput,
): Promise<{ applied: FinancialProfilePolicy; insightsGenerated: number }> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${base}/documents/${documentId}/apply-policy`, {
    method: 'POST',
    headers,
    body: JSON.stringify(policy),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not add this policy to your Financial Profile')
  return { applied: data.applied, insightsGenerated: data.insights_generated ?? 0 }
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
  /** The saved grant's refresh token is dead — the user must reconnect. */
  needsReauth?: boolean
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

export interface ConnectorSyncResource {
  resource: string
  last_synced_at: string | null
  backfill_complete: boolean
  total_records_synced: number
  last_error: { status: number; status_text: string; at: string } | null
}

// Server-side sync state per resource (POST /connectors/:id/backfill and
// GET /connectors/:id/sync/status existed with no frontend caller — see
// remediation item 21). Empty resources just means "nothing synced yet".
export async function fetchConnectorSyncStatus(connectorId: string): Promise<ConnectorSyncResource[]> {
  return apiFetch<{ resources: ConnectorSyncResource[] }>(
    `/connectors/${connectorId}/sync/status`,
    { resources: [] },
  ).then((r) => r.resources ?? [])
}

// Fire-and-forget backfill — the server runs it in the background (202);
// callers poll fetchConnectorSyncStatus for progress.
export async function triggerConnectorBackfill(connectorId: string): Promise<boolean> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${base}/connectors/${connectorId}/backfill`, { method: 'POST', headers })
    return res.ok || res.status === 202
  } catch (err) {
    reportError(err, { connectorId })
    return false
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
  /** ISO 'YYYY-MM-DD', optional. */
  dateOfBirth?: string
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
  // Deliberately not apiFetch: "no family yet" is a successful 200 with
  // {family: null}, while a network failure or 5xx means "couldn't check"
  // — callers (signIn especially) have to tell those apart. Swallowing
  // both into null used to drop a returning user into onboarding on a
  // flaky connection, which reads as account loss.
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${base}/family`, { headers })
  } catch (err) {
    reportError(err, { path: '/family' })
    throw err
  }
  if (!res.ok) {
    if (res.status >= 500) reportError(new Error(`API ${res.status}`), { path: '/family' })
    throw new Error(`API ${res.status}`)
  }
  const data = (await res.json()) as { family: ApiFamilyGroup | null }
  return data.family ?? null
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
  dateOfBirth?: string,
): Promise<ApiFamilyGroup> {
  return familyGroupRequest('/family/members', 'POST', { name, email, role, ...(dateOfBirth ? { date_of_birth: dateOfBirth } : {}) })
}

export async function updateFamilyGroupMemberRole(id: string, role: ApiFamilyMember['role']): Promise<ApiFamilyGroup> {
  return familyGroupRequest(`/family/members/${id}`, 'PATCH', { role })
}

/** ISO 'YYYY-MM-DD'. Powers age/years-until-university derivation — see apps/web/src/lib/age.ts. */
export async function updateFamilyGroupMemberDateOfBirth(id: string, dateOfBirth: string): Promise<ApiFamilyGroup> {
  return familyGroupRequest(`/family/members/${id}`, 'PATCH', { date_of_birth: dateOfBirth })
}

export async function removeFamilyGroupMember(id: string): Promise<ApiFamilyGroup> {
  return familyGroupRequest(`/family/members/${id}`, 'DELETE')
}

// ── Family sharing (PRD-110) ────────────────────────────────────────────────
// Submitting a join request never creates a login or grants any access by
// itself — only an explicit organizer approval does (see the PRD's Trust
// tier section). This mirrors the Act layer's "prepare, don't auto-execute"
// discipline, applied here to account access instead of financial actions.

export interface AccessRequest {
  id: string
  name: string
  email: string
  requestedAt: string
}

// Public — no auth token exists yet for the person submitting this.
export async function joinFamily(
  inviteCode: string,
  name: string,
  email: string,
  password: string,
): Promise<{ familyName: string }> {
  const base = getApiBase()
  const res = await fetch(`${base}/family/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_code: inviteCode, name, email, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "Couldn't submit your request")
  return { familyName: data.family_name as string }
}

export async function fetchAccessRequests(): Promise<AccessRequest[]> {
  return apiFetch<{ requests: AccessRequest[] }>('/family/access-requests', { requests: [] }).then((r) => r.requests)
}

async function accessRequestAction(id: string, action: 'approve' | 'deny'): Promise<Record<string, unknown>> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${base}/family/access-requests/${id}/${action}`, { method: 'POST', headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export async function approveAccessRequest(id: string): Promise<{ name: string; email: string }> {
  const data = await accessRequestAction(id, 'approve')
  return { name: data['name'] as string, email: data['email'] as string }
}

export async function denyAccessRequest(id: string): Promise<void> {
  await accessRequestAction(id, 'deny')
}

export async function resetInviteCode(): Promise<string> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${base}/family/invite-code/reset`, { method: 'POST', headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "Couldn't reset the invite code")
  return data.inviteCode as string
}

// ── Friend referral (PRD-112) ───────────────────────────────────────────────

export async function fetchMyReferralCode(): Promise<string | null> {
  const r = await apiFetch<{ code: string | null }>('/referrals/my-code', { code: null })
  return r.code
}

export async function fetchReferralSummary(): Promise<{ pending: number; rewarded: number }> {
  return apiFetch<{ pending: number; rewarded: number }>('/referrals', { pending: 0, rewarded: 0 })
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

// ── Approval gate (Act layer — remediation item 25) ──────────────────────────
// POST /insights/:id/approve executes an insight's recommended actions via the
// ActionExecutor — send_email / send_whatsapp / crm_tag dispatch to real
// external providers. The gate screen (app/insights/[id]) always renders
// fetchInsightActionPreview before approveInsight is callable, so a human sees
// the classified effect of every action first. Approve is atomic server-side
// (only from state 'identified'), so a double-click can't double-dispatch.

export interface InsightActionPreviewItem {
  label: string
  type: 'send_email' | 'send_whatsapp' | 'crm_tag' | 'log_only'
  /** true when approval dispatches to an external provider. */
  external: boolean
  /** Plain-language consequence rendered on the gate. */
  summary: string
}

export interface InsightActionPreview {
  insight: FamilyInsight
  actions: InsightActionPreviewItem[]
  /** Tenant dry-run mode — nothing is actually sent when true. */
  dry_run: boolean
}

export async function fetchInsightActionPreview(insightId: string): Promise<InsightActionPreview | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/insights/${insightId}/action-preview`, { headers })
    if (!res.ok) return null
    const data = (await res.json()) as { insight: RawInsight; actions: InsightActionPreviewItem[]; dry_run: boolean }
    return {
      insight: adaptInsight(data.insight),
      actions: data.actions ?? [],
      dry_run: data.dry_run === true,
    }
  } catch (err) {
    reportError(err, { insightId })
    return null
  }
}

export interface ApproveInsightResult {
  ok: boolean
  /** 'completed' | 'execution_failed' | other insight state after the call. */
  state?: string | undefined
  message?: string | undefined
  error?: string | undefined
}

async function insightActionPost(insightId: string, action: string, body?: Record<string, unknown>): Promise<ApproveInsightResult> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/insights/${insightId}/${action}`, {
      method: 'POST',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({})) as { insight?: { state?: string }; message?: string; error?: string }
    if (!res.ok) return { ok: false, error: data.error ?? `Request failed (${res.status})` }
    return { ok: true, state: data.insight?.state, message: data.message }
  } catch (err) {
    reportError(err, { insightId, action })
    return { ok: false, error: 'Network error — please try again' }
  }
}

export function approveInsight(insightId: string, notes?: string): Promise<ApproveInsightResult> {
  return insightActionPost(insightId, 'approve', notes?.trim() ? { notes: notes.trim() } : undefined)
}

// Recovery path for an approved insight whose actions failed to execute —
// idempotent server-side (receipts dedupe by payload_hash); safe to retry.
export function retryInsightExecution(insightId: string): Promise<ApproveInsightResult> {
  return insightActionPost(insightId, 'retry-execution')
}

export async function dismissInsight(insightId: string, reason?: string): Promise<boolean> {
  const result = await insightActionPost(insightId, 'dismiss', reason?.trim() ? { reason: reason.trim() } : undefined)
  return result.ok
}

export interface AutomationSettings {
  dry_run_mode: boolean
  trust_level_by_workflow: Record<string, number>
  renewal_reminders_enabled: boolean
  renewal_reminder_lead_days: number[]
  auto_execute_enabled: boolean
}

export async function fetchAutomationSettings(): Promise<AutomationSettings | null> {
  return apiFetch<AutomationSettings | null>('/settings/automation', null)
}

export async function updateAutomationSettings(
  patch: { dry_run_mode?: boolean; renewal_reminders_enabled?: boolean; renewal_reminder_lead_days?: number[]; auto_execute_enabled?: boolean },
): Promise<AutomationSettings | null | 'queued'> {
  try {
    const res = await fetchOrQueue(
      '/settings/automation',
      { method: 'PATCH', body: JSON.stringify(patch) },
      'Automation setting',
    )
    if (res === 'queued') return 'queued'
    if (!res.ok) return null
    return (await res.json()) as AutomationSettings
  } catch (err) {
    reportError(err, { path: '/settings/automation' })
    return null
  }
}

// ── Automatic reminders (Tier 3 transparency surface) ─────────────────────

export interface PolicyReminder {
  id: string
  kind: 'policy_renewal'
  status: 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed'
  policy: { type: string; provider: string; member_id?: string }
  renewal_date: string
  lead_days: number
  due_at: string
  sent_at: string | null
  cancelled_reason: string | null
}

export async function fetchReminders(): Promise<PolicyReminder[]> {
  const result = await apiFetch<{ reminders: PolicyReminder[] } | null>('/reminders', null)
  return result?.reminders ?? []
}

export async function cancelReminder(id: string): Promise<boolean> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const res = await fetch(`${base}/reminders/${id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    return res.ok
  } catch (err) {
    reportError(err, { path: `/reminders/${id}/cancel` })
    return false
  }
}

// ── Account data rights (export / delete — remediation item 26) ─────────────

// Returns the parsed bundle; the caller turns it into a downloaded file —
// keeping fetch here and DOM work at the call site so this stays testable.
export async function exportAccountData(): Promise<Record<string, unknown> | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/account/export`, { headers })
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch (err) {
    reportError(err, { path: '/account/export' })
    return null
  }
}

// confirmation must be the account's own email, typed — the server's check,
// not just a client formality.
export async function deleteAccount(confirmation: string): Promise<{ ok: boolean; error?: string | undefined }> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/account/delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirmation }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      return { ok: false, error: data.error ?? `Request failed (${res.status})` }
    }
    return { ok: true }
  } catch (err) {
    reportError(err, { path: '/account/delete' })
    return { ok: false, error: 'Network error — please try again' }
  }
}

// ── Inbox ─────────────────────────────────────────────────────────────────

export async function dismissInboxItem(itemId: string): Promise<boolean> {
  try {
    const res = await fetchOrQueue(`/inbox/${itemId}/dismiss`, { method: 'POST' }, 'Inbox dismiss')
    if (res === 'queued') return true // UI already removed it; it lands on reconnect
    if (res.ok) invalidateCache('inbox-items')
    return res.ok
  } catch (err) {
    reportError(err, { itemId })
    return false
  }
}

export async function fetchInboxItems(): Promise<{ items: InboxItem[]; isLive: boolean }> {
  // Cached 30s — AppShell already warms this on auth for the tab badge, so
  // opening Inbox right after app load paints from cache instead of a
  // skeleton. Invalidated on dismiss so a removed item stays removed.
  return cachedFetch('inbox-items', 30_000, () =>
    apiFetch<{ items: InboxItem[] }>(
      '/inbox',
      { items: [] },
    ).then((r) => ({
      items: r.items ?? [],
      isLive: (r.items?.length ?? 0) > 0,
    })),
  )
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
  /** Optional link to a family roster member (role 'child') — mirrors policies[].member_id. */
  member_id?: string
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
  policy_number?: string
  // PRD-110: optional roster-member attribution — person-scoped policies
  // (life, income protection, health, critical illness) can name whose
  // policy it is; car/home stay unset (household-wide by nature).
  member_id?: string
}

export interface FinancialProfile {
  household: {
  /** Set server-side when detectors last ran (the wizard's final submit). */
  insights_evaluated_at?: string
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

// Live-verification finding: page.tsx, family/page.tsx, FamilyRoster.tsx,
// Intelligence.tsx, EventDetailClient.tsx, AssetProfileClient.tsx, and
// useFamilyData.ts's hook each call this independently on mount — on the
// home page alone, several of them mount together and fire 6+ simultaneous
// duplicate GETs to the same endpoint, which is what made the dashboard's
// first paint feel stuck. Cached the same way fetchFamilyInsights already
// is: concurrent callers share one in-flight request, and the result stays
// fresh for 30s. fetchFinancialProfileWithVersion (the wizard's own read,
// below) deliberately stays uncached — OAK-006's concurrency check needs a
// genuinely current version, not a 30s-old one.
export async function fetchFinancialProfile(): Promise<FinancialProfile | null> {
  return cachedFetch('financial-profile', 30_000, () => fetchFinancialProfileRaw().then((r) => r.profile))
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
  // Every other reader (Family, Intelligence, event/asset detail pages,
  // useFamilyData's hooks) holds fetchFinancialProfile's cached copy —
  // without dropping it here, a save could sit invisible to them for up to
  // 30s, reading as "my edit didn't save" even though it did.
  invalidateCache('financial-profile')
  return { insightsGenerated: data.insights_generated ?? 0, version: data.version ?? version ?? 0 }
}

// ── Life events (PRD-108) ────────────────────────────────────────────────
// A life event is a fact the family declares happened ("I lost my job"),
// distinct from /events' hypothetical "What If?" simulator (life-data.ts's
// LIFE_EVENTS/EVENT_ACTIONS) — that stays a sample scenario explorer;
// this reports a real event and gets back a playbook personalized against
// the real financial profile, re-rendered live on every fetch rather than
// frozen at report time.

export type LifeEventType = 'job_loss' | 'bereavement' | 'disability' | 'medical' | 'car' | 'property' | 'travel'

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
  // Server-persisted checklist completion (was localStorage-only — see the
  // complete endpoint below). Only ids the current playbook contains.
  completed_step_ids: string[]
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

// PRD-111: whether an unreported-life-change nudge is currently active.
// Deliberately just a boolean — the server never sends a reason, so
// there's nothing here that could leak a guess about what changed.
export async function fetchLifeChangeNudge(): Promise<{ active: boolean }> {
  return apiFetch<{ active: boolean }>('/family/life-events/nudge', { active: false })
}

export async function dismissLifeChangeNudge(): Promise<void> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    await fetch(`${base}/family/life-events/nudge/dismiss`, { method: 'POST', headers })
  } catch (err) {
    reportError(err, { action: 'dismissLifeChangeNudge' })
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

// PRD-113: fire-and-forget audit-only ping after a successful on-device
// draft — no draft content or step body sent, just the fact it happened.
// Deliberately not awaited by the caller; a failure here shouldn't block
// or affect the draft the family already has on screen.
export function pingOnDeviceDraftUsed(eventId: string, stepId: string): void {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  fetch(`${base}/family/life-events/${eventId}/steps/${stepId}/prepare-on-device`, { method: 'POST', headers }).catch(() => {
    // Best-effort observability only — never surfaced to the user.
  })
}

// Persists checklist completion server-side (an explicit done flag, not a
// toggle — see the route's comment on cross-device convergence). Returns
// the server's authoritative id list, or null on failure so the caller can
// revert its optimistic update.
export async function setLifeEventStepDone(eventId: string, stepId: string, done: boolean): Promise<string[] | null | 'queued'> {
  try {
    const res = await fetchOrQueue(
      `/family/life-events/${eventId}/steps/${stepId}/complete`,
      { method: 'POST', body: JSON.stringify({ done }) },
      'Checklist step',
    )
    if (res === 'queued') return 'queued' // keep the optimistic toggle; lands on reconnect
    if (!res.ok) return null
    const data = await res.json().catch(() => null) as { completed_step_ids?: string[] } | null
    return data?.completed_step_ids ?? []
  } catch (err) {
    reportError(err, { eventId, stepId, done })
    return null
  }
}

// ── Audit log (read-only — remediation item 22) ─────────────────────────

export interface AuditLogEntry {
  action: string
  resource_type: string
  resource_id: string
  user_id: string
  timestamp: string
  metadata: Record<string, unknown>
}

// `before` is the cursor for pagination — pass the oldest entry's
// timestamp from the previous page.
export async function fetchAuditLog(before?: string): Promise<AuditLogEntry[]> {
  const qs = before ? `?before=${encodeURIComponent(before)}` : ''
  return apiFetch<{ entries: AuditLogEntry[] }>(`/audit-log${qs}`, { entries: [] }).then((r) => r.entries ?? [])
}

// ── Password reset ───────────────────────────────────────────────────────

// Someone reaching either of these two is very possibly locked out of an
// account they need right now — a raw browser network error ("Failed to
// fetch") leaking straight into that moment is the wrong kind of scary.
// Distinguish "we couldn't even reach the server" from "the server said no."
async function passwordResetRequest(path: string, body: Record<string, unknown>): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("Couldn't reach Agent Oak — check your connection and try again.")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "That didn't go through — try again in a moment.")
}

export async function requestPasswordReset(email: string): Promise<void> {
  return passwordResetRequest('/auth/request-password-reset', { email, app: 'family' })
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  return passwordResetRequest('/auth/reset-password', { token, new_password: newPassword })
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
