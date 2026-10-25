/**
 * Family app API client — bridges the family frontend to the shared LifeKeel API.
 *
 * Uses the same /insights and /goals endpoints as Studio, filtered by the
 * family vertical's detector ids. Falls back to an empty/null result when
 * the API is unreachable (offline-first, matching the family app's PWA
 * posture) rather than fabricated data.
 */

import { turnstileErrorMessage, turnstileHeaders } from './turnstile'
import { AI_RESPONSES } from './life-data'
import type { InboxItem } from './onboarding-data'
import { getApiBase } from './env'
import { credFetch } from './http'
import { captureAttribution, getAttribution } from './attribution'
import { fetchOrQueue } from './offline-queue'
import { cachedFetch, invalidateCache } from './fetch-cache'
import { reportError } from './observability'
import { detectEmergency, EMERGENCY_REPLY } from './emergency-detection'
import { getSessionToken } from '@/lib/session-token'

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
  /** How many times this (rule, entity) has fired — >1 means the gap
   *  re-occurred after being dismissed/resolved. Absent on first fires. */
  repeat_count?: number
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
  repeat_count?: number
}

export const RESOLVED_INSIGHT_STATES = [
  'approved',
  'completed',
  'dismissed',
  'archived',
  'resolved',
]

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
    ...(typeof raw.repeat_count === 'number' ? { repeat_count: raw.repeat_count } : {}),
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
  'family_estate_readiness',
  'family_education_pacing',
  'family_emergency_trajectory',
  'family_debt_health',
  'family_policy_review',
] as const

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  return getSessionToken()
}

// `onFailure` fires only for what the fallback can't honestly explain away
// as a normal empty state — a thrown fetch (offline/unreachable) or a 5xx —
// never for an ordinary 4xx ("no family yet"). Optional and additive: every
// existing caller that doesn't pass it keeps the exact same "always
// resolves with fallback, look identical to a real empty" behavior. A
// caller whose empty state and its genuine-failure state must read
// differently to the user (Inbox: "nothing to show you" vs "couldn't check
// right now") opts in instead of silently caching a transient failure as
// truth — confirmed live: a single dropped request during a dev-server
// blip made a real 15-item feed render as permanently empty until reload.
async function apiFetch<T>(path: string, fallback: T, onFailure?: () => void): Promise<T> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await credFetch(`${base}${path}`, { headers })
    if (!res.ok) {
      if (res.status >= 500) {
        reportError(new Error(`API ${res.status}`), { path })
        onFailure?.()
      }
      return fallback
    }
    return (await res.json()) as T
  } catch (err) {
    // fetch() itself threw — offline or unreachable, not a status code.
    reportError(err, { path })
    onFailure?.()
    return fallback
  }
}

// Public product status — unauthenticated route that stays reachable during
// maintenance so the shell can render the outage banner. apiFetch's fallback
// doubles as the "API unreachable" answer: no banner, OfflineBanner owns that.
export interface MaintenanceWindow {
  starts_at: string
  ends_at: string
  message: string
}

export interface PublicStatus {
  maintenance_mode: boolean
  signups_enabled: boolean
  /** Present only while the window is upcoming or in progress. */
  maintenance_window?: MaintenanceWindow
}

export async function fetchPublicStatus(): Promise<PublicStatus> {
  return apiFetch<PublicStatus>('/status', { maintenance_mode: false, signups_enabled: true })
}

export async function fetchFamilyInsights(): Promise<FamilyInsight[]> {
  // The `detectors` param is now filtered server-side (GET /insights), so a
  // tenant active in other verticals doesn't push family insights off the
  // page before they even reach here. Still filter client-side too — cheap,
  // and keeps this honest if the server-side filter is ever relaxed.
  // Cached 30s — the score card, gate list, and AppShell warmer all read
  // this; an insight list that old is fine and the page paints instantly.
  return cachedFetch('family-insights', 30_000, () =>
    apiFetch<{ insights: RawInsight[] }>(`/insights?detectors=${FAMILY_DETECTORS.join(',')}`, {
      insights: [],
    }).then((r) =>
      (r.insights ?? [])
        .filter((i) => (FAMILY_DETECTORS as readonly string[]).includes(i.detector_id))
        .map(adaptInsight),
    ),
  )
}

// PRD-117: member-attributed insights only — the member twin read model
// already embeds them, but other surfaces (e.g. a member-scoped inbox
// filter) can query the same attribution directly.
export async function fetchMemberInsights(memberId: string): Promise<FamilyInsight[]> {
  return cachedFetch(`member-insights:${memberId}`, 30_000, () =>
    apiFetch<{ insights: RawInsight[] }>(
      `/insights?detectors=${FAMILY_DETECTORS.join(',')}&member_id=${encodeURIComponent(memberId)}`,
      { insights: [] },
    ).then((r) => (r.insights ?? []).map(adaptInsight)),
  )
}

// Real readiness for a /events "What If?" scenario — computed server-side
// from the family's actual profile (apps/api's event-readiness.ts) rather
// than /events' hardcoded EVENT_STABILITY fallback map. hasLiveData: false
// (the only field guaranteed present) means "no real number for this
// event id" — the caller falls back to its own static sample.
export interface EventReadiness {
  stability: number
  explanation: string
  hasLiveData: boolean
  /** Present on non-live results when the event has a formula but the
   *  profile lacks its inputs — the UI names these instead of a silent
   *  "sample scenario" (intent 21). */
  missing_inputs?: string[]
}

export async function fetchEventReadiness(
  eventId: string,
): Promise<EventReadiness | { hasLiveData: false; missing_inputs?: string[] }> {
  return apiFetch<EventReadiness | { hasLiveData: false; missing_inputs?: string[] }>(
    `/family/events/${encodeURIComponent(eventId)}/readiness`,
    { hasLiveData: false },
  )
}

// PRD-117: the member twin read model — roster record + earner slice +
// attributed policies/funds/insights, assembled server-side per read.
export interface MemberTwin {
  member: {
    id: string
    name: string
    role: string
    status: string
    date_of_birth?: string
    age: number | null
  }
  financial: {
    earner: {
      employment_status: EmploymentStatus
      monthly_salary_minor: number
      income_protection_monthly_minor: number
      pension_balance_minor?: number
      monthly_pension_contribution_minor?: number
    } | null
    policies: Array<
      Pick<
        FinancialProfilePolicy,
        'type' | 'provider' | 'coverage_amount_minor' | 'monthly_premium_minor' | 'renewal_date'
      >
    >
    education_funds: Array<{
      child_name?: string
      current_savings_minor: number
      target_savings_minor: number
      years_remaining: number
      months_remaining: number
      needed_monthly_minor: number
    }>
    insights: RawInsight[]
  }
  /** PRD-118: per-member readiness — same component vocabulary as the
   *  family score (minus emergency_fund, which is household-level).
   *  Components carry no explaining insights here; financial.insights
   *  already holds the member's open list. */
  readiness: {
    score: number | null
    components: Array<Omit<ReadinessComponent, 'insights'>>
  } | null
  /** PRD-124: present only when fetched with mode='youth' — redacted
   *  kid-legible projection; financial/readiness are empty in that mode. */
  youth?: {
    age_band: 'younger' | 'teen'
    headline: string
    savings_goals: Array<{ name: string; progress_pct: number; years_until_goal: number }>
    /** PRD-129: age-banded literacy lessons — concepts + a "try it", no
     *  amounts or products. */
    lessons: Array<{ id: string; title: string; body: string; try_it: string }>
  }
  has_live_data: boolean
}

export async function fetchMemberTwin(
  memberId: string,
  mode?: 'youth',
): Promise<MemberTwin | null> {
  return apiFetch<MemberTwin | null>(
    `/family/members/${encodeURIComponent(memberId)}/twin${mode === 'youth' ? '?mode=youth' : ''}`,
    null,
  )
}

/** PRD-126/127: the member's agent persona — proactive member-scoped
 *  nudges read off the twin and persisted in member_nudges. 'guardian'
 *  persona for minors (speaks to adults). */
export interface MemberAgent {
  member: { id: string; name: string; role: string; status: string; age: number | null }
  persona: 'adult' | 'guardian'
  nudges: Array<{
    id: string
    kind: 'attention' | 'insight' | 'progress'
    title: string
    detail: string
    first_seen_at: string
    source?: { component?: string; insight_id?: string }
  }>
  provisional: boolean
}

export async function fetchMemberAgent(memberId: string): Promise<MemberAgent | null> {
  return apiFetch<MemberAgent | null>(`/family/members/${encodeURIComponent(memberId)}/agent`, null)
}

export async function dismissMemberNudge(memberId: string, nudgeId: string): Promise<boolean> {
  const token = getAuthToken()
  const res = await fetch(
    `${getApiBase()}/family/members/${encodeURIComponent(memberId)}/agent/nudges/${encodeURIComponent(nudgeId)}/dismiss`,
    { method: 'POST', headers: { Authorization: `Bearer ${token ?? ''}` } },
  )
  return res.ok
}

export async function fetchFamilyGoals(): Promise<FamilyGoal[]> {
  return apiFetch<{ goals: FamilyGoal[] }>('/goals', { goals: [] }).then((r) => r.goals ?? [])
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
// PRD-114: the composite Family Readiness Score, computed server-side from
// deterministic subscores over the real profile + vault contents — see
// apps/api/src/readiness/score.ts. Insights explain the subscores; they no
// longer subtract from them directly.
export interface ReadinessComponentInsight {
  id: string
  detector_id: string
  rule_id: string
  hypothesis: string
  confidence: number
}

export type ReadinessComponentKey =
  'emergency_fund' | 'protection' | 'retirement' | 'education' | 'estate'

export interface ReadinessComponent {
  key: ReadinessComponentKey
  label: string
  score: number | null
  weight: number
  detail: string
  /** The profile figures behind the score — the "why" audit trail. */
  drivers?: { label: string; value_minor?: number; value?: string }[]
  gated?: boolean
  /** PRD-137: scope disclaimer rendered with the score (estate). */
  caption?: string
  insights: ReadinessComponentInsight[]
}

export interface FamilyReadiness {
  score: number | null
  has_live_data: boolean
  computed_at: string
  components: ReadinessComponent[]
  insights: ReadinessComponentInsight[]
}

export async function fetchFamilyReadiness(): Promise<FamilyReadiness | null> {
  return apiFetch<FamilyReadiness | null>('/family/readiness', null)
}

export interface ReadinessHistoryPoint {
  date: string
  score: number
  components: Record<string, number>
}

export async function fetchReadinessHistory(): Promise<ReadinessHistoryPoint[]> {
  const res = await apiFetch<{ history: ReadinessHistoryPoint[] }>('/family/readiness/history', {
    history: [],
  })
  return res.history
}

// Starts from 100 (no known gaps) and subtracts a confidence-weighted
// penalty per currently-open insight — kept only as the offline fallback
// when /family/readiness can't be reached, since it still beats showing
// nothing. The comment below documents why even that fallback must check
// insights_evaluated_at before scoring an insight-free profile 100.
export async function fetchFamilyReadinessScore(): Promise<{
  score: number
  hasLiveData: boolean
  /** When this number was last computed — the server recomputes on every
   *  read and says so via computed_at; surfaced on the score card so a
   *  stable score reads as "just checked, unchanged" rather than stale. */
  computedAt: string | null
}> {
  const server = await fetchFamilyReadiness()
  if (server && server.has_live_data && server.score !== null) {
    return { score: server.score, hasLiveData: true, computedAt: server.computed_at }
  }
  if (server && !server.has_live_data)
    return { score: 0, hasLiveData: false, computedAt: server.computed_at }
  if (server && server.has_live_data && server.score === null)
    return { score: 0, hasLiveData: true, computedAt: server.computed_at }

  const insights = await fetchFamilyInsights()
  if (insights.length === 0) {
    const profile = await fetchFinancialProfile()
    // Zero insights only means "no gaps" if detectors actually ran. A
    // profile saved by the wizard's per-step autosave (never finalised)
    // also has zero insights — scoring that 100 told a family with a
    // £400k mortgage and no life cover they were "on track".
    return profile?.insights_evaluated_at
      ? { score: 100, hasLiveData: true, computedAt: profile.insights_evaluated_at }
      : { score: 0, hasLiveData: false, computedAt: null }
  }
  const openPenalty = insights
    .filter((i) => !RESOLVED_INSIGHT_STATES.includes(i.state))
    .reduce((sum, i) => sum + i.confidence, 0)
  return {
    score: Math.round(Math.max(0, Math.min(100, 100 - openPenalty * 10))),
    hasLiveData: true,
    computedAt: new Date().toISOString(),
  }
}

// ── Saved scenarios (PRD-115) ───────────────────────────────────────────
// "What if income drops in N months" projections — inputs are stored,
// results are always recomputed server-side against the live profile on
// read (see routes/family-scenarios.ts), so a saved scenario moves as the
// family's real numbers move.
export interface ScenarioInputs {
  /** Household monthly income change in minor units — negative for a loss. */
  monthlyIncomeDeltaMinor?: number
  monthlyExtraSavingsMinor?: number
  targetChildName?: string
  /** Months until the income change takes effect; 0 = immediate. */
  monthsUntilChange?: number
  /**
   * PRD-132: ordered regime changes — the flat delta/horizon fields are
   * the one-step shorthand for this and are ignored when steps exist.
   * Deltas accumulate: a later step's +X can undo an earlier −X.
   */
  steps?: ScenarioStep[]
  /** G7: scope the projection to one roster member's earner slice and
   * their beneficiary education funds. Omit for the household aggregate. */
  member_id?: string
}

export interface ScenarioStep {
  atMonth: number
  monthlyIncomeDeltaMinor?: number
  monthlyExpenseDeltaMinor?: number
}

export interface ScenarioResult {
  currentMonthlyIncomeMinor: number
  projectedMonthlyIncomeMinor: number
  currentMonthlySurplusMinor: number
  projectedMonthlySurplusMinor: number
  currentRunwayMonths: number | null
  projectedRunwayMonths: number | null
  savingsAtChangeMinor: number
  monthsUntilChange: number
  /** PRD-132: one point per timeline step — null for single-step inputs. */
  timeline: Array<{
    atMonth: number
    monthlyIncomeMinor: number
    monthlyExpensesMinor: number
    savingsMinor: number
    runwayMonths: number | null
  }> | null
  /** PRD-132: the month the fund runs out mid-timeline, if it does. */
  fundDepletedAtMonth: number | null
  educationFundProjection: {
    childName: string
    yearsRemaining: number
    projectedMonthsToTarget: number | null
    onTrack: boolean | null
  } | null
}

export interface FamilyScenario {
  id: string
  name: string
  inputs: ScenarioInputs
  /** G7: display name of the scoped member; null = household scope. */
  member_name: string | null
  created_by: string
  created_at: string
  result: ScenarioResult | null
  has_live_data: boolean
}

async function scenarioRequest<T>(path: string, init: RequestInit, fallback: T): Promise<T> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await credFetch(`${base}${path}`, { ...init, headers })
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch (err) {
    reportError(err, { path })
    return fallback
  }
}

/** Pure-math preview — persists nothing, never calls an LLM. */
export async function previewScenario(
  inputs: ScenarioInputs,
): Promise<{ result: ScenarioResult | null; has_live_data: boolean } | null> {
  return scenarioRequest(
    '/family/scenarios/preview',
    { method: 'POST', body: JSON.stringify(inputs) },
    null,
  )
}

export async function saveFamilyScenario(
  name: string,
  inputs: ScenarioInputs,
): Promise<FamilyScenario | null> {
  const data = await scenarioRequest<{ scenario: FamilyScenario } | null>(
    '/family/scenarios',
    { method: 'POST', body: JSON.stringify({ name, ...inputs }) },
    null,
  )
  return data?.scenario ?? null
}

export async function fetchFamilyScenarios(): Promise<FamilyScenario[]> {
  return apiFetch<{ scenarios: FamilyScenario[] }>('/family/scenarios', { scenarios: [] }).then(
    (r) => r.scenarios ?? [],
  )
}

/** PRD-136: opt a saved scenario in/out of the nightly watchlist recompute. */
export async function setScenarioWatch(id: string, watch: boolean): Promise<boolean> {
  const res = await scenarioRequest<{ ok: boolean }>(
    `/family/scenarios/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ watch }) },
    { ok: false },
  )
  return res.ok === true
}

export interface FamilyScenarioWatchEntry {
  id: string
  name: string
  inputs: ScenarioInputs
  watch: boolean
  last_projection: {
    runway_months: number | null
    depletion_month: number | null
    at: string
  } | null
}

export async function fetchScenarioWatchlist(): Promise<FamilyScenarioWatchEntry[]> {
  return apiFetch<{ scenarios: FamilyScenarioWatchEntry[] }>('/family/scenarios/watchlist', {
    scenarios: [],
  }).then((r) => r.scenarios ?? [])
}

export async function deleteFamilyScenario(id: string): Promise<boolean> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await credFetch(`${base}/family/scenarios/${id}`, { method: 'DELETE', headers })
    return res.ok
  } catch (err) {
    reportError(err, { action: 'deleteFamilyScenario', id })
    return false
  }
}

// ── PRD-136: readiness feed ───────────────────────────────────────────────

export type ReadinessEventType =
  | 'score_moved'
  | 'insight_opened'
  | 'insight_repeated'
  | 'insight_resolved'
  | 'action_attributed'
  | 'scenario_moved'
  | 'renewal_approaching'
  | 'document_processed'
  | 'profile_changed'
  | 'playbook_steps_pending'
  | 'milestone'
  | 'sweep_quiet'

export interface FeedEvent {
  id: string
  type: ReadinessEventType
  severity: 'info' | 'notice' | 'attention' | 'critical'
  direction: 'up' | 'down' | 'flat' | null
  member_id: string | null
  domain: string | null
  title: string
  summary: string
  evidence: { label: string; value?: string; value_minor?: number }[]
  links: {
    kind: 'insight' | 'component' | 'document' | 'scenario' | 'member' | 'profile_field'
    id: string
  }[]
  next_check_at: string | null
  dedupe_key: string
  created_at: string
  /** Present on the synthetic collapsed sweep_quiet item. */
  quiet_days?: number
  /** Set when a feed mute covers this event (only with include_muted=1,
   *  or right after feedback in the same session). */
  muted?: boolean
  muted_reason?: string | null
}

export interface FeedSummary {
  window: string
  total: number
  by_type: Record<string, number>
  up: number
  down: number
  composite_delta: number | null
}

export interface FetchFeedParams {
  since?: string
  member_id?: string
  domain?: string
  limit?: number
  /** 'youth' returns the child's redacted slice (server-side). */
  mode?: 'youth'
}

export async function fetchFeed(params: FetchFeedParams = {}): Promise<FeedEvent[]> {
  const qs = new URLSearchParams()
  if (params.since) qs.set('since', params.since)
  if (params.member_id) qs.set('member_id', params.member_id)
  if (params.domain) qs.set('domain', params.domain)
  if (params.limit !== undefined) qs.set('limit', String(params.limit))
  if (params.mode) qs.set('mode', params.mode)
  const query = qs.toString()
  return apiFetch<{ events: FeedEvent[] }>(`/family/feed${query ? `?${query}` : ''}`, {
    events: [],
  }).then((r) => r.events ?? [])
}

export async function fetchFeedSummary(window: '7d' | '30d' = '7d'): Promise<FeedSummary> {
  return apiFetch<FeedSummary>(`/family/feed/summary?window=${window}`, {
    window,
    total: 0,
    by_type: {},
    up: 0,
    down: 0,
    composite_delta: null,
  })
}

export type FeedFeedbackValue =
  'useful' | 'not_relevant' | 'handled' | 'remind_later' | 'data_wrong'

/** PRD-136 §3: one feedback entry per user per event — 'useful' also
 *  undoes a 'not_relevant' mute server-side. */
export async function submitFeedback(
  eventId: string,
  value: FeedFeedbackValue,
): Promise<{ ok: boolean; muted_until?: string }> {
  return scenarioRequest<{ ok: boolean; muted_until?: string }>(
    `/family/feed/${encodeURIComponent(eventId)}/feedback`,
    { method: 'POST', body: JSON.stringify({ value }) },
    { ok: false },
  )
}

// ── PRD-137: family legacy register ────────────────────────────────────────
// Every record is a family declaration — the verification label rides every
// payload so the UI can never present it as a legal fact.

export type LegacyVerification =
  'document_linked' | 'user_declared' | 'family_understanding' | 'unverified'

export interface LegacyRole {
  role:
    | 'executor'
    | 'trustee'
    | 'attorney'
    | 'guardian'
    | 'beneficiary'
    | 'witness'
    | 'caretaker'
    | 'successor_intended'
  member_id?: string
  contact_id?: string
  share_pct?: number
  verification: LegacyVerification
}

export interface LegacyDocument {
  id: string
  type:
    | 'will'
    | 'codicil'
    | 'power_of_attorney'
    | 'advance_directive'
    | 'trust_deed'
    | 'letter_of_wishes'
    | 'guardianship_nomination'
    | 'funeral_wishes'
    | 'probate_record'
    | 'civil_certificate'
  subject_member_id: string
  jurisdiction: string
  signed_on?: string
  last_reviewed_on?: string
  review_due_on?: string
  original_location?: string
  vault_document_id?: string
  roles: LegacyRole[]
  covers_asset_ids: string[]
  verification: LegacyVerification
  notes?: string
  visibility: 'adults' | 'organizer' | 'named_roles'
  created_at: string
  updated_at: string
}

export type LegacyDocumentInput = Omit<LegacyDocument, 'id' | 'created_at' | 'updated_at'>

export interface LegacyContact {
  id: string
  name: string
  relationship: string
  email?: string
  phone?: string
  firm?: string
  kind: 'family' | 'solicitor' | 'notary' | 'accountant' | 'land_agent' | 'other'
  created_at: string
}

export type LegacyContactInput = Omit<LegacyContact, 'id' | 'created_at'>

export interface LegacyNote {
  id: string
  node: { kind: 'member' | 'document' | 'asset' | 'contact'; id: string }
  text: string
  author_user_id: string
  created_at: string
  verification: 'family_understanding'
}

export type LegacyNoteInput = Pick<LegacyNote, 'node' | 'text'>

export interface PropertyLegacy {
  ownership_basis: 'purchase' | 'inherited' | 'gift' | 'trust' | 'customary_succession' | 'unknown'
  jurisdiction: string
  recorded_owners: LegacyRole[]
  claimed_owners: LegacyRole[]
  title_reference?: string
  title_document_id?: string
  acquired_on?: string
  occupants?: string
  insured: 'yes' | 'no' | 'unknown'
  mortgage_outstanding_minor?: number
  dispute: 'none' | 'possible' | 'active' | 'unknown'
  professional_contact_id?: string
  verification: LegacyVerification
}

export async function fetchLegacyDocuments(): Promise<LegacyDocument[]> {
  return apiFetch<{ documents: LegacyDocument[] }>('/family/legacy/documents', {
    documents: [],
  }).then((r) => r.documents ?? [])
}

export async function createLegacyDocument(
  input: LegacyDocumentInput,
): Promise<LegacyDocument | null> {
  const res = await scenarioRequest<{ document: LegacyDocument } | null>(
    '/family/legacy/documents',
    { method: 'POST', body: JSON.stringify(input) },
    null,
  )
  return res?.document ?? null
}

export async function updateLegacyDocument(
  id: string,
  patch: Partial<LegacyDocumentInput>,
): Promise<LegacyDocument | null> {
  const res = await scenarioRequest<{ document: LegacyDocument } | null>(
    `/family/legacy/documents/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
    null,
  )
  return res?.document ?? null
}

export async function deleteLegacyDocument(id: string): Promise<boolean> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await credFetch(`${base}/family/legacy/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    })
    return res.ok
  } catch (err) {
    reportError(err, { action: 'deleteLegacyDocument', id })
    return false
  }
}

export async function fetchLegacyContacts(): Promise<LegacyContact[]> {
  return apiFetch<{ contacts: LegacyContact[] }>('/family/legacy/contacts', { contacts: [] }).then(
    (r) => r.contacts ?? [],
  )
}

export async function createLegacyContact(
  input: LegacyContactInput,
): Promise<LegacyContact | null> {
  const res = await scenarioRequest<{ contact: LegacyContact } | null>(
    '/family/legacy/contacts',
    { method: 'POST', body: JSON.stringify(input) },
    null,
  )
  return res?.contact ?? null
}

export async function fetchLegacyNotes(): Promise<LegacyNote[]> {
  return apiFetch<{ notes: LegacyNote[] }>('/family/legacy/notes', { notes: [] }).then(
    (r) => r.notes ?? [],
  )
}

export async function createLegacyNote(input: LegacyNoteInput): Promise<LegacyNote | null> {
  const res = await scenarioRequest<{ note: LegacyNote } | null>(
    '/family/legacy/notes',
    { method: 'POST', body: JSON.stringify(input) },
    null,
  )
  return res?.note ?? null
}

export async function updateAssetLegacy(assetId: string, legacy: PropertyLegacy): Promise<boolean> {
  const res = await scenarioRequest<{ asset: unknown } | null>(
    `/family/assets/${encodeURIComponent(assetId)}/legacy`,
    { method: 'PATCH', body: JSON.stringify(legacy) },
    null,
  )
  return res !== null
}

/** PRD-137 §6: continuity rehearsal — what a given adult could actually
 *  find if they had to step in tomorrow. Read model, nothing moves. */
export interface LegacyRehearsal {
  as: { id: string; name: string }
  findability_pct: number
  visible_documents: { id: string; type: string; subject_name: string | null }[]
  hidden_documents: { id: string; type: string; subject_name: string | null; reason: string }[]
  documents_without_location: { id: string; type: string }[]
  properties_without_title: { id: string; name: string }[]
  named_roles: { document_id: string; type: string; role: string }[]
  reachable_contacts: { id: string; name: string; kind: string }[]
  only_one_person_knows: { kind: 'document' | 'asset'; id: string; label: string }[]
}

export async function fetchLegacyRehearsal(memberId: string): Promise<LegacyRehearsal | null> {
  return apiFetch<LegacyRehearsal | null>(
    `/family/legacy/rehearsal?as=${encodeURIComponent(memberId)}`,
    null,
  )
}

/** PRD-214 M3: a dated record left behind when a rehearsal is completed,
 *  plus the deterministic insights filed from the gaps it found. */
export interface RehearsalRecord {
  id: string
  as_member_id: string
  as_member_name: string
  findability_pct: number
  gap_counts: {
    hidden_documents: number
    documents_without_location: number
    properties_without_title: number
    only_one_person_knows: number
  }
  gap_insights_created: number
  completed_at: string
}

export async function completeLegacyRehearsal(
  memberId: string,
): Promise<{ record: RehearsalRecord; view: LegacyRehearsal } | null> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const res = await credFetch(`${base}/family/legacy/rehearsal`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ as: memberId }),
    })
    if (!res.ok) return null
    return (await res.json()) as { record: RehearsalRecord; view: LegacyRehearsal }
  } catch (err) {
    reportError(err, { path: '/family/legacy/rehearsal' })
    return null
  }
}

export async function fetchLegacyRehearsals(): Promise<{ records: RehearsalRecord[] } | null> {
  return apiFetch<{ records: RehearsalRecord[] } | null>('/family/legacy/rehearsals', null)
}

/** PRD-137 §5: the register as nodes+edges for the Family map tab. No
 *  amounts — ids, labels and verification only. */
export interface LegacyGraphNode {
  id: string
  kind: 'member' | 'contact' | 'document' | 'asset' | 'policy'
  label: string
  sublabel?: string
  verification?: LegacyVerification
  meta?: Record<string, unknown>
}
export interface LegacyGraphEdge {
  from: string
  to: string
  kind: 'subject_of' | 'names_as' | 'covers' | 'evidence_for' | 'owns' | 'occupies' | 'advises'
  label?: string
  verification?: LegacyVerification
}
export interface LegacyGraph {
  nodes: LegacyGraphNode[]
  edges: LegacyGraphEdge[]
}

export async function fetchLegacyGraph(): Promise<LegacyGraph | null> {
  return apiFetch<LegacyGraph | null>('/family/legacy/graph', null)
}

// ── PRD-136 §5: notification preference center ────────────────────────────
// Tenant-level today; organizer edits, all adults read. The exempt criticals
// ride every response so the UI renders "always sent" without hardcoding.

export interface NotificationPrefs {
  channels: string[]
  whatsapp_to: string | null
  sms_to: string | null
  email_to: string | null
  web_push_enabled: boolean
  mobile_push_enabled: boolean
  min_urgency: 'critical' | 'high' | 'medium' | 'low'
  business_name: string
  quiet_hours_start: number | null
  quiet_hours_end: number | null
  digest_mode: boolean
  enabled: boolean
  heartbeat_cadence: 'weekly' | 'monthly' | 'off'
  heartbeat_quiet_weeks: boolean
  domains_muted: string[]
  member_scope: 'all' | 'mine'
  /** PRD-139: true while "switch to digest only?" is on offer and unanswered. */
  digest_offer_pending: boolean
}

export interface NotificationPrefsResponse {
  preferences: NotificationPrefs
  exempt_criticals: string[]
}

export type NotificationPrefsPatch = Partial<
  Pick<
    NotificationPrefs,
    | 'channels'
    | 'quiet_hours_start'
    | 'quiet_hours_end'
    | 'digest_mode'
    | 'min_urgency'
    | 'heartbeat_cadence'
    | 'heartbeat_quiet_weeks'
    | 'domains_muted'
    | 'member_scope'
  >
>

export async function fetchNotificationPrefs(): Promise<NotificationPrefsResponse | null> {
  return apiFetch<NotificationPrefsResponse | null>('/family/notifications', null)
}

// ── Perceived protection (PRD-141) ──────────────────────────────────────

export async function fetchPerceivedProtectionDue(): Promise<{
  quarter: string
  due: boolean
} | null> {
  return apiFetch<{ quarter: string; due: boolean } | null>('/family/perceived-protection', null)
}

/** score 1 to 5, or null to skip this quarter. Resolves false on any failure. */
export async function answerPerceivedProtection(score: number | null): Promise<boolean> {
  const token = typeof window === 'undefined' ? null : getSessionToken()
  try {
    const res = await credFetch(`${getApiBase()}/family/perceived-protection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(score === null ? { skipped: true } : { score }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Operator: retention metrics (PRD-141) ───────────────────────────────

export interface RetentionMetrics {
  generated_at: string
  min_cohort: number
  definitions: Record<string, string>
  digest_delivery: { scheduled: number; delivered: number; rate: number | null }
  data_freshness: { mean_share_running: number | null; families: number | null }
  digest_engagement: Record<string, { clicks_per_100: number | null }>
  notification_budget: { dropped_by_reason: Record<string, number> | null }
  notification_health: {
    unsubscribes_per_100_digests: number | null
    digest_only_share: number | null
    heartbeat_off_share: number | null
  }
  received_value_retention: Record<'month_3' | 'month_6', { retained_share: number | null }>
  perceived_protection: { quarter: string; mean: number | null; responses: number | null }
}

export function fetchRetentionMetrics(): Promise<RetentionMetrics> {
  return operatorRequest('/operator/retention')
}

// ── Who processes your documents (PRD-142) ──────────────────────────────

export interface AiDisclosureProcessor {
  id: string
  name: string
  hosting: 'self_hosted' | 'hosted'
  status: 'run_by_lifekeel' | 'terms_under_review' | 'approved' | 'review_overdue'
  region: string | null
  retention: string[]
  sub_processors: string[] | null
  review_due: string | null
  used_by_tasks: number
}

export interface AiDisclosureTask {
  task_id: string
  purpose: string
  where: 'device' | 'lifekeel' | 'lifekeel_or_hosted' | 'hosted'
  processors: string[]
  retention_class: string
}

export interface AiDisclosure {
  generated_at: string
  processors: AiDisclosureProcessor[]
  tasks: AiDisclosureTask[]
}

/** null when signed out or the registry is not loaded. */
export async function fetchAiDisclosure(): Promise<AiDisclosure | null> {
  return apiFetch<AiDisclosure | null>('/ai/processors', null)
}

// ── Trust page and evidence register (PRD-208) ───────────────────────────

export interface TrustClaim {
  id: string
  statement: string
  evidence?: { kind: 'page' | 'check' | 'commitment'; href?: string; how: string }
  verified_at: string
}
export interface TrustData {
  claims: TrustClaim[]
  ai: AiDisclosure
  backups: { retention_days: number | null; statement: string }
}

/** Public; null when the API is unreachable or the registries are not loaded. */
export async function fetchTrust(): Promise<TrustData | null> {
  return apiFetch<TrustData | null>('/trust', null)
}

export interface EvidenceClaim {
  id: string
  statement: string
  publishable: boolean
  reason?: string
  state: 'published' | 'stale' | 'needs_owner' | 'not_evidenced'
  owner: string | null
  verified_at: string | null
  renew_by: string | null
}

export async function fetchOperatorEvidence(): Promise<{
  claims: EvidenceClaim[]
  attention: number
}> {
  const token = getAuthToken()
  const res = await credFetch(`${getApiBase()}/operator/evidence`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Could not load the evidence register')
  return data as { claims: EvidenceClaim[]; attention: number }
}

export async function saveOperatorEvidence(
  id: string,
  body: { owner: string; verified_at: string; renew_by: string; reason: string },
): Promise<void> {
  const token = getAuthToken()
  const res = await credFetch(`${getApiBase()}/operator/evidence/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Could not save the evidence record')
}

// ── Delivery channels (PRD-140) ─────────────────────────────────────────

export interface ChannelState {
  email: { available: boolean }
  web_push: { devices: number; enabled: boolean }
  mobile_push: { devices: number; enabled: boolean; platforms: string[] }
  recent_failures: { web_push: number; mobile_push: number; last_at: string | null }
  first_channel: 'mobile_push' | 'web_push' | 'email' | 'none'
}

/** null for children (403), signed-out visitors and any failure. */
export async function fetchChannelState(): Promise<ChannelState | null> {
  return apiFetch<ChannelState | null>('/family/channels', null)
}

// ── Freshness (PRD-145) ──────────────────────────────────────────────────

export interface FreshnessCheck {
  detector_id: string
  label: string
  state: 'running' | 'paused_missing' | 'paused_stale'
  /** Field names only, e.g. "emergency_fund.monthly_expenses_minor". */
  input: string[]
  since: string
}

export interface FreshnessResponse {
  checked_at: string | null
  share_running: number | null
  detectors: FreshnessCheck[]
}

/** null for children (403), signed-out visitors and any failure. */
export async function fetchFreshness(): Promise<FreshnessResponse | null> {
  return apiFetch<FreshnessResponse | null>('/family/freshness', null)
}

/** The organizer's answer to the digest-only offer. null on any failure. */
export async function answerDigestOffer(
  accept: boolean,
): Promise<NotificationPrefsResponse | null> {
  return scenarioRequest<NotificationPrefsResponse | null>(
    '/family/notifications/digest-offer',
    { method: 'POST', body: JSON.stringify({ accept }) },
    null,
  )
}

export async function updateNotificationPrefs(
  patch: NotificationPrefsPatch,
): Promise<NotificationPrefsResponse | null> {
  return scenarioRequest<NotificationPrefsResponse | null>(
    '/family/notifications',
    { method: 'PATCH', body: JSON.stringify(patch) },
    null,
  )
}

/**
 * Fetches an AI-style response for a user query. Calls the backend
 * assistant endpoint (POST /assistant/ask), which reasons over the
 * tenant's real financial profile and open insights via an LLM. Falls
 * Three honest outcomes, not two:
 * - 'live'        — the backend answered against the family's real data.
 * - 'canned'      — the backend answered but chose the generic/local text,
 *                   or the device is genuinely offline. Renders as a
 *                   labeled sample.
 * - 'unavailable' — the call itself failed while online (backend down,
 *                   5xx, timeout, malformed body). The distinguishing
 *                   state: a real outage must never render as either a
 *                   live answer OR a routine sample — it gets its own
 *                   "temporarily unavailable" surface with a retry.
 */
export type AssistantAnswerStatus = 'live' | 'canned' | 'unavailable' | 'emergency'

export async function fetchAIResponse(
  query: string,
  memberId?: string,
  opts?: { memberName?: string },
): Promise<{ content: string; status: AssistantAnswerStatus; dataAsOf?: string }> {
  // Deterministic emergency short-circuit — before any network call, so
  // a "chest pain"-type message gets safety guidance instantly, offline
  // or while the assistant is down, and the text never leaves the
  // device. The API screens the same query independently.
  const emergency = detectEmergency(query)
  if (emergency) {
    return { content: EMERGENCY_REPLY[emergency], status: 'emergency' }
  }

  // Read once up front: a dead-connection failure is honest "canned"
  // fallback territory (the offline banner is already telling the user),
  // while an online failure means the assistant itself is broken.
  const wasOffline = typeof navigator !== 'undefined' && !navigator.onLine
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

    // Device-first privacy: run the reversible PII curtain over the user's
    // typed query before it leaves the device — structured identifiers
    // (emails, phones, cards, postcodes, NI/NHS/IBAN) and the member's name
    // never transit the network even though the assistant is LifeKeel-side.
    // The ephemeral restore map dies with this call; the response is
    // restored only for non-URL occurrences.
    // Layer-B: when the user enabled on-device AI, an NER token classifier
    // (on-device-ner.ts) also finds unanchored contextual PII — names,
    // employers, places with no dictionary entry or regex anchor. It never
    // widens egress: a disabled/absent/slow model yields zero entities and
    // the deterministic curtain runs unchanged.
    const { redactForCloudEgressAsync } = await import('./onDeviceLlm')
    const { classifyEntities } = await import('./on-device-ner')
    const curtain = await redactForCloudEgressAsync(
      query,
      {
        memberNames: opts?.memberName ? [opts.memberName] : [],
      },
      { classify: classifyEntities },
    )
    const safeQuery = curtain.redactedText

    const res = await credFetch(`${base}/assistant/ask`, {
      method: 'POST',
      headers,
      // PRD-122: memberId scopes the answer to one roster member's twin.
      // medical_hint carries the curtain's special-category flag — the
      // server routes the query to the lifekeel_infra_required sensitive
      // task (self-hosted only, fails closed); it re-screens the query too,
      // so this is a cooperative signal, not a trust boundary.
      body: JSON.stringify({
        query: safeQuery,
        ...(memberId ? { member_id: memberId } : {}),
        ...(curtain.hasSpecialCategoryHint ? { medical_hint: true } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) {
      const data = (await res.json()) as {
        content?: string
        isLive?: boolean
        quarantined?: boolean
        emergency?: boolean
        data_as_of?: string
      }
      if (typeof data.content === 'string') {
        return {
          content: curtain.restore(data.content),
          status: data.emergency === true ? 'emergency' : data.isLive ? 'live' : 'canned',
          // The server stamps when the underlying profile/insights were
          // read — the chat shows it so an older answer after a profile
          // edit is honestly dated, not silently stale (intent 30).
          ...(typeof data.data_as_of === 'string' ? { dataAsOf: data.data_as_of } : {}),
        }
      }
      reportError(new Error('assistant/ask returned no content'), { path: '/assistant/ask' })
    } else {
      reportError(new Error(`API ${res.status}`), { path: '/assistant/ask' })
    }
  } catch (err) {
    reportError(err, { path: '/assistant/ask' })
  }

  if (!wasOffline) return { content: '', status: 'unavailable' }

  const lower = query.toLowerCase()
  for (const [key, response] of Object.entries(AI_RESPONSES)) {
    if (lower.includes(key)) return { content: response, status: 'canned' }
  }
  return {
    content:
      "Based on the information you've entered, here is a summary from your family's data. This is for informational purposes only — please consult a qualified professional before making financial decisions. Would you like to see the specific numbers from your family's profile?",
    status: 'canned',
  }
}

// ── Documents ─────────────────────────────────────────────────────────────

export interface FamilyDocument {
  id: string
  filename: string
  category: string
  // 'stored' = uploaded and scanned (free, every plan), AI field
  // extraction not run. 'uploaded'/'processing'/'extracted'/'error' cover
  // the paid AI-extraction pipeline. The R2 upload pipeline adds the scan
  // stages before any of those (CLOUDFLARE_INTEGRATION.md §7.3).
  status:
    | 'uploaded'
    | 'processing'
    | 'extracted'
    | 'stored'
    | 'error'
    | 'awaiting_upload'
    | 'scan_queued'
    | 'scanning'
    | 'scan_error'
    | 'clean'
    | 'applied'
    | 'infected'
    | 'rejected'
    | 'failed'
  uploadedAt: string
  extractedData?: Record<string, string>
}

/** Accepted by the upload pipeline; the server enforces the same list. */
export const UPLOAD_ACCEPT =
  'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif'

/** Browsers often leave HEIC/DOCX types blank: fall back to the extension. */
function uploadMime(file: File): string {
  if (file.type) return file.type
  const ext = file.name.toLowerCase().split('.').pop()
  return (
    {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      heic: 'image/heic',
      heif: 'image/heif',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
    }[ext ?? ''] ?? 'application/octet-stream'
  )
}

async function sha256Hex(file: File): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}

/**
 * Direct upload (CLOUDFLARE_INTEGRATION.md §7.4): ask the API for a 5-minute
 * presigned PUT, send the bytes straight to the private quarantine bucket,
 * then tell the API it's done. Returns null when this household isn't on
 * the direct path yet, so the caller falls back to the multipart route.
 */
async function uploadDocumentDirect(
  file: File,
  clientScreen?: 'clear' | 'flagged' | 'unscreened',
): Promise<FamilyDocument | null> {
  const base = getApiBase()
  const token = getAuthToken()
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const mime = uploadMime(file)
  const init = await credFetch(`${base}/documents/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      filename: file.name,
      mime,
      size: file.size,
      sha256: await sha256Hex(file),
      ...(clientScreen ? { client_screen: clientScreen } : {}),
    }),
  })
  if (init.status === 409) {
    const body = await init.json().catch(() => ({}))
    if (body.error === 'direct_upload_unavailable') return null
  }
  if (!init.ok) {
    const body = await init.json().catch(() => ({}))
    throw new Error(body.message || body.error || `Upload failed: ${init.status}`)
  }
  const { document_id, upload } = (await init.json()) as {
    document_id: string
    upload: { url: string; headers: Record<string, string> }
  }
  // The browser sets Content-Length from the Blob; scripts may not. One retry.
  const put = () =>
    fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file }).then((r) => {
      if (!r.ok) throw new Error(`Storage refused the upload (${r.status})`)
    })
  try {
    await put()
  } catch {
    await put()
  }
  const done = await credFetch(`${base}/documents/${document_id}/complete`, {
    method: 'POST',
    headers: auth,
  })
  if (!done.ok) throw new Error(`Upload failed: ${done.status}`)
  const { status } = (await done.json()) as { status: FamilyDocument['status'] }
  return {
    id: document_id,
    filename: file.name,
    category: 'other',
    status,
    uploadedAt: new Date().toISOString(),
  }
}

export async function uploadDocument(
  file: File,
  clientScreen?: 'clear' | 'flagged' | 'unscreened',
): Promise<FamilyDocument> {
  const direct = await uploadDocumentDirect(file, clientScreen)
  if (direct) return direct
  const base = getApiBase()
  const token = getAuthToken()
  const formData = new FormData()
  formData.append('file', file)
  // On-device screen outcome (see lib/on-device-doc-screen.ts). Only the
  // outcome transits — never the marker or document content — and the
  // server treats 'flagged' as authoritative while re-screening anyway.
  if (clientScreen) formData.append('clientScreen', clientScreen)

  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await credFetch(`${base}/documents/upload`, {
    method: 'POST',
    headers,
    body: formData,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  return (await res.json()) as FamilyDocument
}

export async function fetchDocuments(): Promise<{
  documents: FamilyDocument[]
  aiExtractionEnabled: boolean
}> {
  return apiFetch<{ documents: FamilyDocument[]; aiExtractionEnabled: boolean }>('/documents', {
    documents: [],
    aiExtractionEnabled: false,
  })
}

/** One extracted value awaiting a person's decision (PRD-143). */
export interface DocumentCandidate {
  key: string
  value: string
  confidence: number
  grounding:
    'verbatim_unique' | 'verbatim_ambiguous' | 'keyword' | 'absence' | 'not_found' | 'image_only'
  span: { start: number; end: number } | null
  /** A short quote of the document around the value; null when there is no text to quote. */
  snippet: string | null
  needs_review: boolean
  status: 'proposed' | 'confirmed' | 'edited' | 'rejected'
  edited_value?: string
}

export interface DocumentClassification {
  category: string
  confidence: number
  needs_confirmation: boolean
  confirmed: boolean
}

export interface FamilyDocumentDetail extends FamilyDocument {
  rawText: string
  classification?: DocumentClassification | null
  documentDate?: string | null
  /** clean | infected | error | not_performed */
  scan?: string
  candidates?: DocumentCandidate[]
}

export interface ReviewDecision {
  key: string
  action: 'confirm' | 'edit' | 'reject'
  value?: string
}

/** What the person says this document is. Never changes anything until they do. */
export async function confirmDocumentType(
  id: string,
  category: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const token = getAuthToken()
    const res = await credFetch(
      `${getApiBase()}/documents/${encodeURIComponent(id)}/confirm-type`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ category }),
      },
    )
    if (res.ok) return { ok: true }
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: data.error ?? 'Could not save that' }
  } catch (err) {
    reportError(err, { action: 'confirmDocumentType', id })
    return { ok: false, error: 'Network error — please try again' }
  }
}

/** Confirm, edit or reject extracted values. All or nothing on the server. */
export async function reviewDocumentFields(
  id: string,
  decisions: ReviewDecision[],
): Promise<{ ok: true; candidates: DocumentCandidate[] } | { ok: false; error: string }> {
  try {
    const token = getAuthToken()
    const res = await credFetch(`${getApiBase()}/documents/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ decisions }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      candidates?: DocumentCandidate[]
      problems?: { key: string; reason: string }[]
    }
    if (res.ok && data.candidates) return { ok: true, candidates: data.candidates }
    const invalid = data.problems?.some((p) => p.reason === 'invalid_value')
    return {
      ok: false,
      error: invalid
        ? 'That value does not look right for this field.'
        : (data.error ?? 'Could not save that'),
    }
  } catch (err) {
    reportError(err, { action: 'reviewDocumentFields', id })
    return { ok: false, error: 'Network error — please try again' }
  }
}

export async function fetchDocument(id: string): Promise<FamilyDocumentDetail | null> {
  return apiFetch<FamilyDocumentDetail | null>(`/documents/${id}`, null)
}

/**
 * Fetches the original uploaded file's bytes and returns a local object URL
 * for the AI Memory review drawer's side-by-side preview — auth is a Bearer
 * header, so this can't just be an <img src> pointed at the API directly.
 * Caller is responsible for URL.revokeObjectURL when done with it.
 *
 * R2-stored documents come from a 60-second presigned URL (§7.4 mode=url),
 * straight from object storage; GridFS-era documents (409) and any failure
 * fall back to the bytes-through-the-API route.
 */
export async function fetchDocumentFileUrl(
  id: string,
): Promise<{ url: string; mimeType: string } | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const signed = await credFetch(`${base}/documents/${id}/file?mode=url`, { headers })
    if (signed.ok) {
      const { url } = (await signed.json()) as { url: string }
      const obj = await fetch(url, { cache: 'no-store' })
      if (obj.ok) {
        const blob = await obj.blob()
        return { url: URL.createObjectURL(blob), mimeType: blob.type }
      }
    }
    const res = await credFetch(`${base}/documents/${id}/file`, { headers })
    if (!res.ok) return null
    const blob = await res.blob()
    return { url: URL.createObjectURL(blob), mimeType: blob.type }
  } catch (err) {
    reportError(err, { documentId: id })
    return null
  }
}

// ── Digital Estate Vault (Phase 3, Digital Twin gap audit) ─────────────────
// Encrypted storage for estate documents (wills, power of attorney) —
// adult family members only (the API 403s a child's token). No release,
// notification, or "dead man's switch" logic exists anywhere here or on the
// server: every read/write is a signed-in adult's own explicit action.

export interface VaultDocument {
  id: string
  filename: string
  mimeType: string
  uploadedAt: string
  uploadedBy: string | null
  /** PRD-114: user-declared document type — feeds the estate component of
   *  GET /family/readiness. null for documents uploaded before the field
   *  existed. */
  docType: VaultDocType | null
  /** PRD-134: client-side-encrypted under a family passphrase — the
   *  server returns the sealed envelope and the browser unseals it. */
  sealed?: boolean
}

export const VAULT_DOC_TYPES = [
  'will',
  'power_of_attorney',
  'insurance_policy',
  'estate_instruction',
  'other',
] as const
export type VaultDocType = (typeof VAULT_DOC_TYPES)[number]

export const VAULT_DOC_TYPE_LABELS: Record<VaultDocType, string> = {
  will: 'Will',
  power_of_attorney: 'Power of attorney',
  insurance_policy: 'Insurance policy',
  estate_instruction: 'Estate instructions',
  other: 'Other',
}

export async function fetchVaultDocuments(): Promise<{
  documents: VaultDocument[]
  forbidden: boolean
}> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const res = await credFetch(`${base}/vault/documents`, { headers })
    if (res.status === 403) return { documents: [], forbidden: true }
    if (!res.ok) return { documents: [], forbidden: false }
    const data = (await res.json().catch(() => ({}))) as { documents?: VaultDocument[] }
    return { documents: data.documents ?? [], forbidden: false }
  } catch (err) {
    reportError(err, { path: '/vault/documents' })
    return { documents: [], forbidden: false }
  }
}

export async function uploadVaultDocument(
  file: File,
  docType?: VaultDocType,
  /** PRD-134: when set, the file is sealed client-side before upload —
   *  the server stores ciphertext it cannot read. */
  sealPassphrase?: string,
): Promise<VaultDocument> {
  const base = getApiBase()
  const token = getAuthToken()
  const formData = new FormData()
  let upload: Blob = file
  if (sealPassphrase) {
    const { sealFile } = await import('./vault-seal')
    upload = new Blob([(await sealFile(await file.arrayBuffer(), sealPassphrase)) as BlobPart], {
      type: 'application/octet-stream',
    })
  }
  formData.append('file', upload, file.name)
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const params = new URLSearchParams()
  if (docType) params.set('doc_type', docType)
  if (sealPassphrase) {
    params.set('sealed', '1')
    params.set('mime', file.type || 'application/octet-stream')
  }
  const qs = params.toString()
  const res = await credFetch(`${base}/vault/documents/upload${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    headers,
    body: formData,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Upload failed: ${res.status}`)
  return data as VaultDocument
}

export async function fetchVaultDocumentFileUrl(
  id: string,
  /** PRD-134: sealed docs need the passphrase + declared mime to unseal
   *  in-browser; unsealed docs pass nothing. */
  seal?: { passphrase: string; mimeType: string },
): Promise<{ url: string; mimeType: string } | 'wrong-passphrase' | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await credFetch(`${base}/vault/documents/${id}/file`, { headers })
    if (!res.ok) return null
    if (seal) {
      const { unsealFile, VaultSealError } = await import('./vault-seal')
      try {
        const plaintext = await unsealFile(await res.arrayBuffer(), seal.passphrase)
        const blob = new Blob([plaintext], { type: seal.mimeType })
        return { url: URL.createObjectURL(blob), mimeType: seal.mimeType }
      } catch (err) {
        if (err instanceof VaultSealError) return 'wrong-passphrase'
        throw err
      }
    }
    const blob = await res.blob()
    return { url: URL.createObjectURL(blob), mimeType: blob.type }
  } catch (err) {
    reportError(err, { documentId: id })
    return null
  }
}

export async function deleteVaultDocument(id: string): Promise<boolean> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await credFetch(`${base}/vault/documents/${id}`, { method: 'DELETE', headers })
    return res.ok
  } catch (err) {
    reportError(err, { documentId: id })
    return false
  }
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
  contactPhone: string | null
  contactEmail: string | null
}

export interface DocumentSuggestions {
  suggestions: ProfileSuggestion[]
  policySuggestion: DocumentPolicySuggestion | null
}

export async function fetchProfileSuggestions(documentId: string): Promise<DocumentSuggestions> {
  return apiFetch<DocumentSuggestions>(`/documents/${documentId}/profile-suggestions`, {
    suggestions: [],
    policySuggestion: null,
  })
}

export async function applyDocumentToProfile(
  documentId: string,
  paths?: string[],
): Promise<{
  applied: { path: string; label: string; valueMinor: number }[]
  insightsGenerated: number
}> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await credFetch(`${base}/documents/${documentId}/apply-to-profile`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ paths }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok)
    throw new Error(data.error || 'Could not apply this document to your Financial Profile')
  // The profile mutated and may have generated new insights — Home's
  // score/rings, the Family/Intelligence pages, and the Inbox feed all
  // read their own 30s-cached copy of one of these (see the identical fix
  // on submitFinancialProfile for how this class of bug was found).
  invalidateCache('financial-profile')
  invalidateCache('family-insights')
  invalidateCache('inbox-items')
  return { applied: data.applied ?? [], insightsGenerated: data.insights_generated ?? 0 }
}

export interface ApplyPolicyInput {
  type: PolicyType
  provider: string
  coverageAmountMinor: number
  monthlyPremiumMinor: number
  renewalDate?: string
  policyNumber?: string
  // Claims/24-7-assistance line stated on the document/email — display and
  // tel:/mailto: only, never dialed or sent automatically.
  contactPhone?: string
  contactEmail?: string
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

  const res = await credFetch(`${base}/documents/${documentId}/apply-policy`, {
    method: 'POST',
    headers,
    body: JSON.stringify(policy),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not add this policy to your Financial Profile')
  // The profile mutated and may have generated new insights — Home's
  // score/rings, the Family/Intelligence pages, and the Inbox feed all
  // read their own 30s-cached copy of one of these (see the identical fix
  // on submitFinancialProfile for how this class of bug was found).
  invalidateCache('financial-profile')
  invalidateCache('family-insights')
  invalidateCache('inbox-items')
  return { applied: data.applied, insightsGenerated: data.insights_generated ?? 0 }
}

/**
 * Same as applyPolicySuggestion, for a policy Keel found in a connected
 * email rather than an uploaded document — the Inbox item's own reviewed,
 * possibly-edited fields, never applied unconfirmed.
 */
export async function applyInboxPolicy(
  inboxItemId: string,
  policy: ApplyPolicyInput,
): Promise<{ applied: FinancialProfilePolicy; insightsGenerated: number }> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await credFetch(`${base}/inbox/${inboxItemId}/apply-policy`, {
    method: 'POST',
    headers,
    body: JSON.stringify(policy),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not add this policy to your Financial Profile')
  // The profile mutated and may have generated new insights — Home's
  // score/rings, the Family/Intelligence pages, and the Inbox feed all
  // read their own 30s-cached copy of one of these (see the identical fix
  // on submitFinancialProfile for how this class of bug was found).
  invalidateCache('financial-profile')
  invalidateCache('family-insights')
  invalidateCache('inbox-items')
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
  return apiFetch<{ connectors: ConnectorStatus[] }>('/connectors/status', {
    connectors: FAMILY_CONNECTORS.map((c) => ({ ...c, connected: false })),
  }).then((r) => r.connectors ?? [])
}

/**
 * Just the email connector's live state, with an explicit failure flag —
 * fetchConnectorStatuses' fallback (every connector "not connected") looks
 * identical to a real disconnect, which briefly showed "Connect your
 * email" over an actually-connected-but-needs-reauth mailbox after a
 * dropped request (confirmed live). Inbox uses this instead so it can
 * leave the banner alone rather than assert the wrong state.
 */
export async function fetchEmailConnectorStatus(): Promise<{
  connected: boolean
  needsReauth: boolean
  failed: boolean
}> {
  let failed = false
  const { connectors } = await apiFetch<{ connectors: ConnectorStatus[] }>(
    '/connectors/status',
    { connectors: [] },
    () => {
      failed = true
    },
  )
  const email = connectors.find((c) => c.id === 'email')
  return { connected: !!email?.connected, needsReauth: !!email?.needsReauth, failed }
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
  {
    id: 'gmail',
    name: 'Gmail',
    passwordHint:
      'Use a Google App Password, not your regular password (Google Account → Security → App passwords).',
  },
  {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    passwordHint: 'Use an app password if your account has multi-factor authentication enabled.',
  },
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    passwordHint: 'Generate an app password from Yahoo Account Security settings.',
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    passwordHint: 'Use an app-specific password from appleid.apple.com.',
  },
  {
    id: 'custom',
    name: 'Other / custom',
    passwordHint: "Check your email provider's IMAP settings page for the server host and port.",
  },
]

export interface ConnectEmailPayload {
  provider?: string
  host?: string
  port?: number
  useTls?: boolean
  username: string
  password: string
}

export async function connectEmail(
  payload: ConnectEmailPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await credFetch(`${base}/connectors/email/credentials`, {
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

// ── Open Banking (PRD-133) — read-only account-info connector. The
// provider list is deliberately tiny: 'sandbox' (dev/test demo accounts)
// and 'truelayer' (a consented access token — the OAuth flow that mints
// it is the partnership-dependent piece). No payment initiation exists
// anywhere in this path.
export interface ExternalAccount {
  id: string
  provider: string
  name: string
  type: string
  currency: string
  /** null when the bank connection hasn't returned a balance yet. */
  balance_minor: number | null
  synced_at: string
}

export async function connectOpenBanking(
  provider: 'sandbox' | 'truelayer',
  accessToken?: string,
): Promise<{ ok: true; accounts: number } | { ok: false; error: string }> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/connectors/open-banking/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ provider, ...(accessToken ? { accessToken } : {}) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok)
    return {
      ok: false,
      error: data.error || 'Could not connect — check the details and try again.',
    }
  return { ok: true, accounts: data.accounts ?? 0 }
}

export async function syncOpenBanking(): Promise<boolean> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/connectors/open-banking/sync`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return res.ok
}

export async function fetchOpenBankingAccounts(): Promise<ExternalAccount[]> {
  return apiFetch<{ accounts: ExternalAccount[] }>('/connectors/open-banking/accounts', {
    accounts: [],
  }).then((r) => r.accounts ?? [])
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

  const res = await credFetch(`${base}/connectors/gmail/oauth/start?app=family&mode=json`, {
    headers,
  })
  if (!res.ok) throw new Error('Could not start Google sign-in — please try again.')
  const data = (await res.json()) as { auth_url?: string }
  if (!data.auth_url) throw new Error('Could not start Google sign-in — please try again.')
  return data.auth_url
}

/**
 * Every connector OAuth round trip ends here. The API callback no longer
 * saves the grant; it redirects back with ?complete=<id>, and the signed-in
 * user claims it, so someone else's authorization link can't attach your
 * account to their household. Returns the params to show the outcome with
 * (?connected=… or ?connect=…&error=…), or the current ones when there is
 * nothing to claim.
 */
export async function resolveOAuthReturnParams(): Promise<URLSearchParams> {
  const current = new URLSearchParams(window.location.search)
  const grant = current.get('complete')
  const connectorId = current.get('connect')
  if (!grant || !connectorId) return current

  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const res = await credFetch(
      `${base}/connectors/${encodeURIComponent(connectorId)}/oauth/complete`,
      { method: 'POST', headers, body: JSON.stringify({ grant }) },
    )
    const data = (await res.json().catch(() => ({}))) as {
      params?: Record<string, string>
      error?: string
    }
    if (res.ok && data.params) return new URLSearchParams(data.params)
    return new URLSearchParams({ connect: connectorId, error: data.error ?? 'connect_failed' })
  } catch {
    return new URLSearchParams({ connect: connectorId, error: 'connect_failed' })
  }
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

  const res = await credFetch(`${base}/connectors/email/scan`, { method: 'POST', headers })
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
export async function fetchConnectorSyncStatus(
  connectorId: string,
): Promise<ConnectorSyncResource[]> {
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
    const res = await credFetch(`${base}/connectors/${connectorId}/backfill`, {
      method: 'POST',
      headers,
    })
    return res.ok || res.status === 202
  } catch (err) {
    reportError(err, { connectorId })
    return false
  }
}

/** PRD-146: counts and categories only; the API never sends content. */
export interface DeletionReceipt {
  id: string
  kind: 'document' | 'mailbox' | 'account'
  status: 'completed' | 'partial' | 'in_progress'
  requested_at: string
  completed_at: string | null
  removed: { category: string; count: number }[]
  kept: string[]
  verification: { passed: boolean; residual: { category: string; count: number }[] } | null
  live_data_erased: boolean
  backups: { retention_days: number | null; statement: string }
  processors: { id: string; name: string; stated_retention: string }[]
}

/** Held for one page after account deletion; see /account-deleted. */
export const RECEIPT_STORAGE_KEY = 'lifekeel_deletion_receipt'

/** Disconnect a mailbox and delete what was read from it. Null on any failure. */
export async function disconnectMailboxAndDelete(
  connectorId: string,
): Promise<DeletionReceipt | null> {
  try {
    const token = getAuthToken()
    const res = await credFetch(`${getApiBase()}/connectors/${connectorId}/disconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ delete_data: true }),
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => ({}))) as { receipt?: DeletionReceipt }
    return data.receipt ?? null
  } catch (err) {
    reportError(err, { connectorId })
    return null
  }
}

/** Delete one uploaded document. The receipt lists what was removed. */
export async function deleteFamilyDocument(
  id: string,
): Promise<{ ok: boolean; receipt?: DeletionReceipt; error?: string }> {
  try {
    const token = getAuthToken()
    const res = await credFetch(`${getApiBase()}/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const data = (await res.json().catch(() => ({}))) as {
      receipt?: DeletionReceipt
      error?: string
    }
    if (!res.ok) return { ok: false, error: data.error ?? `Request failed (${res.status})` }
    return { ok: true, ...(data.receipt ? { receipt: data.receipt } : {}) }
  } catch (err) {
    reportError(err, { action: 'deleteFamilyDocument', id })
    return { ok: false, error: 'Network error — please try again' }
  }
}

export async function disconnectConnector(connectorId: string): Promise<boolean> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await credFetch(`${base}/connectors/${connectorId}/disconnect`, {
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
  /** The `users.id` this roster entry is bound to after invite acceptance (PRD-123). */
  userId?: string
  /** ISO 'YYYY-MM-DD', optional. */
  dateOfBirth?: string
}

export interface ApiFamilyGroup {
  id: string
  name: string
  inviteCode: string
  members: ApiFamilyMember[]
  /** Gap-8: the organizer-authored context note Ask Keel reads. */
  contextNote?: string
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

  const res = await credFetch(`${base}${path}`, {
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
    res = await credFetch(`${base}/family`, { headers })
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
  return familyGroupRequest('/family/members', 'POST', {
    name,
    email,
    role,
    ...(dateOfBirth ? { date_of_birth: dateOfBirth } : {}),
  })
}

export async function updateFamilyGroupMemberRole(
  id: string,
  role: ApiFamilyMember['role'],
): Promise<ApiFamilyGroup> {
  return familyGroupRequest(`/family/members/${id}`, 'PATCH', { role })
}

/** ISO 'YYYY-MM-DD'. Powers age/years-until-university derivation — see apps/web/src/lib/age.ts. */
export async function updateFamilyGroupMemberDateOfBirth(
  id: string,
  dateOfBirth: string,
): Promise<ApiFamilyGroup> {
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
  turnstileToken?: string | null,
): Promise<{ familyName: string }> {
  const base = getApiBase()
  const res = await credFetch(`${base}/family/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...turnstileHeaders(turnstileToken) },
    body: JSON.stringify({ invite_code: inviteCode, name, email, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok)
    throw new Error(
      turnstileErrorMessage(data.error) ?? (data.error || "Couldn't submit your request"),
    )
  return { familyName: data.family_name as string }
}

export async function fetchAccessRequests(): Promise<AccessRequest[]> {
  return apiFetch<{ requests: AccessRequest[] }>('/family/access-requests', { requests: [] }).then(
    (r) => r.requests,
  )
}

// ── Per-member invites (PRD-123) ──────────────────────────────────────────
// The organizer-facing direction of family sharing: invite a specific pending
// roster member by email, they accept via a one-time link, and their existing
// roster entry flips to active — no duplicate member, no join-request queue.

export interface MemberInviteResult {
  invited: boolean
  /** false when the API has no SendGrid key — share inviteUrl manually. */
  emailed: boolean
  inviteUrl: string
}

export async function inviteFamilyMember(
  memberId: string,
  email?: string,
): Promise<MemberInviteResult> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/family/members/${memberId}/invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(email ? { email } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "Couldn't send the invite. Please try again.")
  return { invited: data.invited, emailed: data.emailed, inviteUrl: data.invite_url }
}

export interface FamilyInviteInfo {
  memberName: string
  familyName: string
  expiresAt: string
}

// Public — the invitee has no auth token yet.
export async function fetchFamilyInvite(token: string): Promise<FamilyInviteInfo> {
  const base = getApiBase()
  const res = await credFetch(`${base}/family/invite/${encodeURIComponent(token)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'This invite link is invalid or has expired')
  return { memberName: data.member_name, familyName: data.family_name, expiresAt: data.expires_at }
}

// Public — accepting both verifies the token AND proves ownership of the
// email (via a new or existing password). Returns a session token so the
// acceptor lands signed in.
export async function acceptFamilyInvite(
  token: string,
  password: string,
): Promise<{
  token: string
  user: { id: string; email: string; name: string; email_verified?: boolean }
}> {
  const base = getApiBase()
  const res = await credFetch(`${base}/family/invite/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "Couldn't accept the invite. Please try again.")
  return { token: data.token, user: data.user }
}

async function accessRequestAction(
  id: string,
  action: 'approve' | 'deny',
): Promise<Record<string, unknown>> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await credFetch(`${base}/family/access-requests/${id}/${action}`, {
    method: 'POST',
    headers,
  })
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
  const res = await credFetch(`${base}/family/invite-code/reset`, { method: 'POST', headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "Couldn't reset the invite code")
  return data.inviteCode as string
}

// ── Family continuity (PRD-130) ─────────────────────────────────────────────

export interface FamilyContinuity {
  continuity: {
    enabled: boolean
    designated_member_ids: string[]
    check_in_after_days: number
    grace_days: number
  }
  state: {
    phase: 'watching' | 'check_in_sent' | 'alerted'
    inactive_since?: string
    check_in_sent_at?: string
    alerted_at?: string
  }
  is_organizer: boolean
}

export async function fetchFamilyContinuity(): Promise<FamilyContinuity | null> {
  return apiFetch<FamilyContinuity | null>('/family/continuity', null)
}

export async function updateFamilyContinuity(
  input: FamilyContinuity['continuity'],
): Promise<FamilyContinuity['continuity']> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await credFetch(`${base}/family/continuity`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "Couldn't save continuity settings")
  return data.continuity
}

// ── Family cash flow (PRD-131) ──────────────────────────────────────────────

export interface CashflowEntry {
  id: string
  kind: 'income' | 'expense'
  label: string
  amount_minor: number
  recurrence: 'weekly' | 'monthly' | 'yearly' | 'once'
  monthly_minor: number
  member_id?: string
  created_at: string
}

export interface CashflowSummary {
  entries: CashflowEntry[]
  summary: {
    monthly_inflow_minor: number
    monthly_outflow_minor: number
    net_minor: number
    runway_months: number | null
  }
}

export async function fetchFamilyCashflow(): Promise<CashflowSummary | null> {
  return apiFetch<CashflowSummary | null>('/family/cashflow', null)
}

export async function addCashflowEntry(input: {
  kind: 'income' | 'expense'
  label: string
  amount_minor: number
  recurrence: string
}): Promise<boolean> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/family/cashflow/entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  })
  return res.ok
}

export async function deleteCashflowEntry(id: string): Promise<boolean> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/family/cashflow/entries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return res.ok
}

// ── Assets register (gap 8's non-sensitive slice) ────────────────────────
// Declared assets — property, vehicles, valuables — any active adult can
// maintain. Same sensitivity class as the financial profile; medical/health
// stays deferred by design.
export const ASSET_KINDS = [
  'property',
  'vehicle',
  'savings_account',
  'investment',
  'valuable',
  'other',
] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  property: 'Property',
  vehicle: 'Vehicle',
  savings_account: 'Savings account',
  investment: 'Investment',
  valuable: 'Valuable',
  other: 'Other',
}

export interface FamilyAsset {
  id: string
  kind: AssetKind
  name: string
  value_minor: number
  notes: string | null
  /** PRD-137 §1: the declared property-legacy sub-record, when the asset
   *  is property — null otherwise. */
  legacy?: PropertyLegacy | null
  created_at: string
  updated_at: string
}

export interface AssetList {
  assets: FamilyAsset[]
  summary: { total_minor: number; by_kind: Record<string, number> }
}

export async function fetchFamilyAssets(): Promise<AssetList> {
  return apiFetch<AssetList>('/family/assets', {
    assets: [],
    summary: { total_minor: 0, by_kind: {} },
  })
}

async function assetRequest(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<FamilyAsset | null | boolean> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const res = await credFetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) return method === 'DELETE' ? false : null
    if (method === 'DELETE') return true
    const data = (await res.json()) as { asset: FamilyAsset }
    return data.asset
  } catch (err) {
    reportError(err, { path })
    return method === 'DELETE' ? false : null
  }
}

export async function addFamilyAsset(input: {
  kind: AssetKind
  name: string
  value_minor: number
  notes?: string
}): Promise<FamilyAsset | null> {
  return (await assetRequest('/family/assets', 'POST', input)) as FamilyAsset | null
}

export async function updateFamilyAsset(
  id: string,
  patch: { name?: string; value_minor?: number; notes?: string | null },
): Promise<FamilyAsset | null> {
  return (await assetRequest(
    `/family/assets/${encodeURIComponent(id)}`,
    'PATCH',
    patch,
  )) as FamilyAsset | null
}

export async function deleteFamilyAsset(id: string): Promise<boolean> {
  return (await assetRequest(`/family/assets/${encodeURIComponent(id)}`, 'DELETE')) as boolean
}

/** Gap-8: the organizer-authored context note Ask Keel reads as household
 *  background. Empty string clears it. */
export async function updateFamilyContext(note: string): Promise<ApiFamilyGroup | null> {
  try {
    return await familyGroupRequest('/family/context', 'PATCH', { note })
  } catch {
    return null
  }
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
  /** Figures in the draft that appear verbatim in the family's data —
   *  the only part the UI may label "from your data" (draft-provenance.ts).
   *  Everything else is generated wording the reviewer should check. */
  provenance?: { facts: string[] }
}

// Copy-to-clipboard / open-in-email-client only — there is no "send"
// endpoint anywhere in this app, on purpose. See docs/prd/103-tier1-prepare-actions.md.
export async function prepareInsightDraft(insightId: string): Promise<InsightDraft | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await credFetch(`${base}/insights/${insightId}/prepare`, {
      method: 'POST',
      headers,
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { draft?: InsightDraft | null } | null
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

export async function fetchInsightActionPreview(
  insightId: string,
): Promise<InsightActionPreview | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await credFetch(`${base}/insights/${insightId}/action-preview`, { headers })
    if (!res.ok) return null
    const data = (await res.json()) as {
      insight: RawInsight
      actions: InsightActionPreviewItem[]
      dry_run: boolean
    }
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

async function insightActionPost(
  insightId: string,
  action: string,
  body?: Record<string, unknown>,
): Promise<ApproveInsightResult> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await credFetch(`${base}/insights/${insightId}/${action}`, {
      method: 'POST',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = (await res.json().catch(() => ({}))) as {
      insight?: { state?: string }
      message?: string
      error?: string
    }
    if (!res.ok) return { ok: false, error: data.error ?? `Request failed (${res.status})` }
    return { ok: true, state: data.insight?.state, message: data.message }
  } catch (err) {
    reportError(err, { insightId, action })
    return { ok: false, error: 'Network error — please try again' }
  }
}

export function approveInsight(insightId: string, notes?: string): Promise<ApproveInsightResult> {
  return insightActionPost(
    insightId,
    'approve',
    notes?.trim() ? { notes: notes.trim() } : undefined,
  )
}

// Recovery path for an approved insight whose actions failed to execute —
// idempotent server-side (receipts dedupe by payload_hash); safe to retry.
export function retryInsightExecution(insightId: string): Promise<ApproveInsightResult> {
  return insightActionPost(insightId, 'retry-execution')
}

export async function dismissInsight(insightId: string, reason?: string): Promise<boolean> {
  const result = await insightActionPost(
    insightId,
    'dismiss',
    reason?.trim() ? { reason: reason.trim() } : undefined,
  )
  return result.ok
}

export interface AutomationSettings {
  dry_run_mode: boolean
  trust_level_by_workflow: Record<string, number>
  renewal_reminders_enabled: boolean
  renewal_reminder_lead_days: number[]
  auto_execute_enabled: boolean
  daily_marketing_drafts_enabled: boolean
}

export async function fetchAutomationSettings(): Promise<AutomationSettings | null> {
  return apiFetch<AutomationSettings | null>('/settings/automation', null)
}

export async function updateAutomationSettings(patch: {
  dry_run_mode?: boolean
  renewal_reminders_enabled?: boolean
  renewal_reminder_lead_days?: number[]
  auto_execute_enabled?: boolean
  daily_marketing_drafts_enabled?: boolean
}): Promise<AutomationSettings | null | 'queued'> {
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
    const res = await credFetch(`${base}/reminders/${id}/cancel`, {
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

    const res = await credFetch(`${base}/account/export`, { headers })
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch (err) {
    reportError(err, { path: '/account/export' })
    return null
  }
}

// confirmation must be the account's own email, typed — the server's check,
// not just a client formality.
export async function deleteAccount(confirmation: string): Promise<{
  ok: boolean
  error?: string | undefined
  receipt?: DeletionReceipt | undefined
  /** True when the wipe has not finished; access is already closed and it completes by itself. */
  inProgress?: boolean | undefined
}> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await credFetch(`${base}/account/delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirmation }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: data.error ?? `Request failed (${res.status})` }
    }
    const data = (await res.json().catch(() => ({}))) as {
      receipt?: DeletionReceipt
      in_progress?: boolean
    }
    return { ok: true, receipt: data.receipt, inProgress: data.in_progress === true }
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

export async function fetchInboxItems(): Promise<{
  items: InboxItem[]
  isLive: boolean
  failed: boolean
}> {
  // Cached 30s — AppShell already warms this on auth for the tab badge, so
  // opening Inbox right after app load paints from cache instead of a
  // skeleton. Invalidated on dismiss so a removed item stays removed.
  let failed = false
  return cachedFetch('inbox-items', 30_000, () =>
    apiFetch<{ items: InboxItem[] }>('/inbox', { items: [] }, () => {
      failed = true
    }).then((r) => ({
      items: r.items ?? [],
      isLive: (r.items?.length ?? 0) > 0,
      failed,
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
export type PolicyType =
  'life' | 'income_protection' | 'health' | 'critical_illness' | 'car' | 'home' | 'travel'

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
  // Claims/24-7-assistance line stated on the source document/email —
  // display and tel:/mailto: only, never dialed or sent automatically.
  contact_phone?: string
  contact_email?: string
  // policy it is; car/home stay unset (household-wide by nature).
  member_id?: string
  // Who the policy *protects* — distinct from member_id (the holder). Lets
  // family_policy_review flag beneficiaries who've left the roster.
  beneficiary_member_id?: string
  /** Intent 38: prior premiums, appended server-side when the recorded
   *  amount changes — the price-creep trail. Current premium stays in
   *  monthly_premium_minor. */
  premium_history?: Array<{ amount_minor: number; effective_from: string }>
}

export interface FinancialProfile {
  /** Set server-side when detectors last ran (the wizard's final submit). */
  insights_evaluated_at?: string
  household: {
    employment_status: EmploymentStatus
    monthly_salary_minor: number
    annual_living_expenses_minor: number
    mortgage_outstanding_minor: number
    life_cover_minor: number
    income_protection_monthly_minor: number
    /** Total non-mortgage monthly debt service — feeds family_debt_health's DTI check. */
    monthly_debt_payments_minor: number
    // PRD-104: additive — a mixed-earner household (one partner retired,
    // one still working; one salaried, one self-employed) couldn't be
    // represented at all before this, so the arbitrary single status
    // picked for the household decided whether a real protection gap was
    // ever surfaced (KEEL-029). Each entry links to a real family-roster
    // member (member_id) rather than an anonymous second earner. See
    // family-financial-profile.ts's multi-event evaluation.
    members: Array<{
      member_id: string
      employment_status: EmploymentStatus
      monthly_salary_minor: number
      income_protection_monthly_minor: number
      pension_balance_minor?: number
      monthly_pension_contribution_minor?: number
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

async function fetchFinancialProfileRaw(): Promise<{
  profile: FinancialProfile | null
  version: number
}> {
  return apiFetch<{ profile: FinancialProfile | null; version?: number }>(
    '/family/financial-profile',
    { profile: null },
  ).then((r) => ({ profile: r.profile ?? null, version: r.version ?? 0 }))
}

/** Annual review state — due when it's been >365 days since the family
 *  last confirmed the profile (or last touched it, if never reviewed). */
export interface ProfileReviewState {
  due: boolean
  last_reviewed_at: string | null
  /** Human-readable labels of what changed since the last confirmation. */
  changed: string[]
}

export async function fetchProfileReview(): Promise<ProfileReviewState> {
  return apiFetch<ProfileReviewState>('/family/financial-profile/review', {
    due: false,
    last_reviewed_at: null,
    changed: [],
  })
}

export async function respondToProfileReview(action: 'confirm' | 'later'): Promise<boolean> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const res = await credFetch(`${base}/family/financial-profile/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action }),
    })
    return res.ok
  } catch (err) {
    reportError(err, { action: 'respondToProfileReview' })
    return false
  }
}

// Live-verification finding: page.tsx, family/page.tsx, FamilyRoster.tsx,
// Intelligence.tsx, EventDetailClient.tsx, AssetProfileClient.tsx, and
// useFamilyData.ts's hook each call this independently on mount — on the
// home page alone, several of them mount together and fire 6+ simultaneous
// duplicate GETs to the same endpoint, which is what made the dashboard's
// first paint feel stuck. Cached the same way fetchFamilyInsights already
// is: concurrent callers share one in-flight request, and the result stays
// fresh for 30s. fetchFinancialProfileWithVersion (the wizard's own read,
// below) deliberately stays uncached — KEEL-006's concurrency check needs a
// genuinely current version, not a 30s-old one.
export async function fetchFinancialProfile(): Promise<FinancialProfile | null> {
  return cachedFetch('financial-profile', 30_000, () =>
    fetchFinancialProfileRaw().then((r) => r.profile),
  )
}

/**
 * Same as fetchFinancialProfile, plus the document's current version —
 * KEEL-006: the wizard needs this to detect (rather than silently overwrite)
 * a concurrent edit from another tab/device. Only the wizard needs the
 * version; every other caller keeps using the plain fetchFinancialProfile.
 */
export async function fetchFinancialProfileWithVersion(): Promise<{
  profile: FinancialProfile | null
  version: number
}> {
  // Deliberately NOT apiFetch's silent-fallback path: a failed load must
  // reach the wizard as an error, because rendering EMPTY_FORM after a
  // transient failure reads as "your saved answers were lost" — and the
  // next autosave would then overwrite the real profile with blanks
  // (KEEL-006's version check only guards that once the doc has a nonzero
  // version; a first-failure save carries none).
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await credFetch(`${base}/family/financial-profile`, { headers })
  if (!res.ok) {
    const err = new Error(`Profile load failed (${res.status})`)
    reportError(err, { path: '/family/financial-profile' })
    throw err
  }
  const data = (await res.json()) as { profile?: FinancialProfile | null; version?: number }
  return { profile: data.profile ?? null, version: data.version ?? 0 }
}

// generateInsights defaults to false — most calls are the wizard's per-step
// autosave, which should only persist progress. Detector evaluation against
// a step the user hasn't reached yet (still at its default/empty value)
// produces a stale insight that never gets retracted once the real number
// arrives later in the form, so only the final "Save & Generate Insights"
// step should pass true.
//
// `version`, when passed, is sent so the server can detect a concurrent
// edit from another tab/device (KEEL-006) — omit it for a first-ever save.
export async function submitFinancialProfile(
  profile: FinancialProfile,
  generateInsights = false,
  version?: number,
): Promise<{ insightsGenerated: number; version: number }> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await credFetch(`${base}/family/financial-profile`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...profile,
      generate_insights: generateInsights,
      ...(version !== undefined ? { version } : {}),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 409)
      throw new Error(data.error || 'This profile was updated elsewhere — reload and try again.')
    throw new Error(data.error || 'Request failed')
  }
  // Every other reader (Family, Intelligence, event/asset detail pages,
  // useFamilyData's hooks) holds fetchFinancialProfile's cached copy —
  // without dropping it here, a save could sit invisible to them for up to
  // 30s, reading as "my edit didn't save" even though it did.
  invalidateCache('financial-profile')
  // A generate_insights submit can create brand-new insights server-side —
  // Home's score/rings (family-insights) and the Inbox feed (inbox-items)
  // both read their own 30s-cached copy. Confirmed live: finishing the
  // wizard, then checking Inbox within that window, showed "Nothing needs
  // your attention" over three real, just-created recommendations because
  // an earlier page load (before the submit) had cached an empty result.
  if (generateInsights) {
    invalidateCache('family-insights')
    invalidateCache('inbox-items')
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

// A real policy contact the step's provider(s) actually have on file —
// display and tel:/mailto: only, the family still makes the call/send.
export interface LifeEventStepContact {
  provider: string
  phone?: string
  email?: string
}

export type LifeEventType =
  'job_loss' | 'bereavement' | 'disability' | 'medical' | 'car' | 'property' | 'travel'

export interface LifeEventPlaybookStep {
  id: string
  title: string
  body: string
  // Eligible for the same Tier 1 "prepare, don't send" draft affordance
  // Present only when a policy on file has a phone/email to surface for
  // this step (render-playbook.ts's resolveStepContacts) — absent, not an
  // empty array, when nothing matched.
  contacts?: LifeEventStepContact[]
  // insight cards use (PRD-103) — see prepareLifeEventStepDraft below.
  contact: boolean
  // The family's data already covers this step's concern — the step still
  // renders (transparency about what's on file), but the UI shows it
  // differently from a genuinely-open action.
  covered?: boolean
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
  // G6: the reporter's own free-text account of the situation — shown to
  // the family and fed to Ask Keel's grounding. null when not provided.
  context: string | null
  // Server-persisted checklist completion (was localStorage-only — see the
  // complete endpoint below). Only ids the current playbook contains.
  completed_step_ids: string[]
  playbook: LifeEventPlaybook | null
}

export async function fetchLifeEvents(): Promise<LifeEvent[]> {
  return apiFetch<{ events: LifeEvent[] }>('/family/life-events', { events: [] }).then(
    (r) => r.events ?? [],
  )
}

export async function reportLifeEvent(
  eventType: LifeEventType,
  affectedMemberId?: string,
  context?: string,
): Promise<LifeEvent | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await credFetch(`${base}/family/life-events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event_type: eventType,
        ...(affectedMemberId ? { affected_member_id: affectedMemberId } : {}),
        ...(context?.trim() ? { context: context.trim() } : {}),
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
    await credFetch(`${base}/family/life-events/nudge/dismiss`, { method: 'POST', headers })
  } catch (err) {
    reportError(err, { action: 'dismissLifeChangeNudge' })
  }
}

// Same copy-to-clipboard / open-in-email-client-only posture as
// prepareInsightDraft above — there is no "send" endpoint here either.
export async function prepareLifeEventStepDraft(
  eventId: string,
  stepId: string,
): Promise<InsightDraft | null> {
  try {
    const base = getApiBase()
    const token = getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await credFetch(`${base}/family/life-events/${eventId}/steps/${stepId}/prepare`, {
      method: 'POST',
      headers,
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { draft?: InsightDraft | null } | null
    return data?.draft ?? null
  } catch (err) {
    reportError(err, { eventId, stepId })
    return null
  }
}

// PRD-113 + device-first telemetry: fire-and-forget audit-only ping after
// an on-device draft attempt — no draft content or step body sent, just a
// metadata-only outcome enum so device coverage and abstention rates are
// observable (guard rejection, unavailability, template fallback) without
// compromising the privacy property the feature exists for.
// Deliberately not awaited by the caller; a failure here shouldn't block
// or affect the draft the family already has on screen.
export type OnDevicePingOutcome =
  'generated' | 'template_fallback' | 'abstained' | 'guard_rejected' | 'unavailable' | 'error'

export function pingOnDeviceDraftUsed(
  eventId: string,
  stepId: string,
  outcome: OnDevicePingOutcome = 'generated',
): void {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  credFetch(`${base}/family/life-events/${eventId}/steps/${stepId}/prepare-on-device`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ outcome }),
  }).catch(() => {
    // Best-effort observability only — never surfaced to the user.
  })
}

// Persists checklist completion server-side (an explicit done flag, not a
// toggle — see the route's comment on cross-device convergence). Returns
// the server's authoritative id list, or null on failure so the caller can
// revert its optimistic update.
export async function setLifeEventStepDone(
  eventId: string,
  stepId: string,
  done: boolean,
): Promise<string[] | null | 'queued'> {
  try {
    const res = await fetchOrQueue(
      `/family/life-events/${eventId}/steps/${stepId}/complete`,
      { method: 'POST', body: JSON.stringify({ done }) },
      'Checklist step',
    )
    if (res === 'queued') return 'queued' // keep the optimistic toggle; lands on reconnect
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { completed_step_ids?: string[] } | null
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
  return apiFetch<{ entries: AuditLogEntry[] }>(`/audit-log${qs}`, { entries: [] }).then(
    (r) => r.entries ?? [],
  )
}

// ── Receipt Chain (PRD-214, M7) — what Keel did, hash-chained ─────────────

export interface FamilyReceipt {
  id: string
  chain_index: number
  chain_hash: string
  payload_hash: string
  action_type: string
  action_label: string | null
  outcome: string
  outcome_reason: string | null
  executed_at: string
  approved_by: string | null
  approved_via: string | null
  detector_id: string | null
  insight_id: string | null
  dry_run: boolean
  /** Plain-language "policy that allowed it", derived server-side. */
  policy: string
}

export interface FamilyReceiptsResponse {
  receipts: FamilyReceipt[]
  total: number
  chain_head: string | null
  chain_note: string
}

export async function fetchFamilyReceipts(limit = 50, offset = 0): Promise<FamilyReceiptsResponse> {
  return apiFetch<FamilyReceiptsResponse>(`/family/receipts?limit=${limit}&offset=${offset}`, {
    receipts: [],
    total: 0,
    chain_head: null,
    chain_note: '',
  })
}

/** CSV export — fetched with the family's credentials, saved as a blob. */
export async function downloadFamilyReceiptsCsv(): Promise<boolean> {
  try {
    const headers: Record<string, string> = {}
    const token = getAuthToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await credFetch(`${getApiBase()}/family/receipts?format=csv`, { headers })
    if (!res.ok) return false
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lifekeel-receipts-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

// ── Earned-Scope Contracts (PRD-214, M5) — autonomy as an artifact ────────

export interface ScopeContract {
  scope_id: string
  template_version: number
  title: string
  /** The grant in plain language — the sentence the family said yes to. */
  terms_text: string
  /** What the scope can never do — stated, not implied. */
  boundary_text: string
  scope_class: 'notification'
  state: 'granted' | 'suspended' | 'collapsed' | 'not_granted'
  enabled: boolean
  granted_at?: string
  granted_by?: string
  suspended_at?: string
  suspend_reason?: string
  collapsed_at?: string
  collapse_reason?: string
  adjustments: Array<{ at: string; kind: 'downward'; reason: string; detail: string }>
  history: Array<{ at: string; event: string; actor: string; note?: string }>
  evidence: Record<string, number>
}

export async function fetchScopeContracts(): Promise<ScopeContract[]> {
  return apiFetch<{ contracts: ScopeContract[] }>('/family/scope-contracts', {
    contracts: [],
  }).then((r) => r.contracts ?? [])
}

// ── Password reset & email verification ─────────────────────────────────

// Someone reaching these is very possibly locked out of an account they
// need right now — a raw browser network error ("Failed to fetch") leaking
// straight into that moment is the wrong kind of scary. Distinguish "we
// couldn't even reach the server" from "the server said no."
async function authPostRequest(
  path: string,
  body: Record<string, unknown>,
  turnstileToken?: string | null,
): Promise<void> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...turnstileHeaders(turnstileToken),
  }
  // resend-verification is dual-mode server-side: an Authorization header
  // resolves the user, otherwise the email in the body does.
  if (token) headers['Authorization'] = `Bearer ${token}`
  let res: Response
  try {
    res = await credFetch(`${getApiBase()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("Couldn't reach LifeKeel — check your connection and try again.")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok)
    throw new Error(
      turnstileErrorMessage(data.error) ??
        (data.error || "That didn't go through — try again in a moment."),
    )
}

export async function requestPasswordReset(
  email: string,
  turnstileToken?: string | null,
): Promise<void> {
  return authPostRequest('/auth/request-password-reset', { email, app: 'family' }, turnstileToken)
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
  turnstileToken?: string | null,
): Promise<void> {
  return authPostRequest(
    '/auth/reset-password',
    { token, new_password: newPassword },
    turnstileToken,
  )
}

export async function verifyEmail(token: string): Promise<void> {
  return authPostRequest('/auth/verify-email', { token })
}

// Signed-in callers omit `email` (the server reads them from the token);
// the link can also be requested logged-out by passing one.
export async function resendVerificationEmail(email?: string): Promise<void> {
  return authPostRequest('/auth/resend-verification', email ? { email } : {})
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
  meta_description?: string
  cover_image?: string
}

/** Public, unauthenticated. */
export async function fetchBlogPosts(): Promise<BlogPostSummary[]> {
  const res = await credFetch(`${getApiBase()}/blog/posts`)
  if (!res.ok) return []
  const data = await res.json().catch(() => ({ posts: [] }))
  return data.posts ?? []
}

/** Public, unauthenticated. Returns null on 404 or any failure. */
export async function fetchBlogPost(slug: string): Promise<BlogPost | null> {
  const res = await credFetch(`${getApiBase()}/blog/posts/${encodeURIComponent(slug)}`)
  if (!res.ok) return null
  return res.json().catch(() => null)
}

// ── Billing (Keel Plus) ───────────────────────────────────────────────────

export interface BillingSubscription {
  plan: string
  status: string
  subscription?: {
    id: string
    status: string
    current_period_end?: number | null
    cancel_at_period_end?: boolean
  } | null
}

export async function fetchBillingSubscription(): Promise<BillingSubscription | null> {
  return apiFetch<BillingSubscription | null>('/billing/subscription', null)
}

export async function startLifeKeelPlusCheckout(): Promise<string> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await credFetch(`${base}/billing/checkout`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ plan: 'starter', app: 'family' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not start checkout')
  return data.checkout_url as string
}

/** Redeems a promo code — throws with the server's reason on failure. */
export async function redeemPromoCode(
  code: string,
): Promise<{ grant_credits: number; credits_balance: number }> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await credFetch(`${base}/billing/redeem-promo-code`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not redeem code')
  return data
}

/** Opens the Stripe customer portal — subscription management/cancel lives there. */
export async function openBillingPortal(returnUrl?: string): Promise<string> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await credFetch(`${base}/billing/portal`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ return_url: returnUrl }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not open subscription management')
  return data.portal_url as string
}

// ── Marketing posts (social channels) ─────────────────────────────────────

export interface MarketingIntegration {
  id: string
  name: string
  identifier?: string
  disabled: boolean
  source?: 'env' | 'connection'
  /** The account that would publish — handle, page name or URN. */
  account?: string
}

export interface SocialConnection {
  tenant_id: string
  channel: string
  handle: string
  status: 'active' | 'error'
  last_error?: string
  connected_by?: string
  created_at?: string
  updated_at?: string
}

export type MarketingPostState = 'draft' | 'approved' | 'published' | 'publish_failed' | 'rejected'

export interface MarketingPost {
  id: string
  channel: string
  integration_id: string
  content: string
  state: MarketingPostState
  scheduled_at?: string
  auto_published?: boolean
  campaign?: string
  generated?: 'llm' | 'template'
  dry_run?: boolean
  created_at: string
  approved_at?: string
  published_at?: string
  publish_error?: string
  external_url?: string
  media_url?: string
  /** Marketing copy guard result (PRD-210); a failing post cannot be approved. */
  copy_check?: { ok: boolean; violations: { rule: string; match: string }[] }
  metrics?: { likes?: number; reposts?: number; replies?: number }
}

/** Null when no channel is configured (503) or the request fails — distinct
 *  from "no channels connected" ([]). */
export async function fetchMarketingIntegrations(): Promise<MarketingIntegration[] | null> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const res = await credFetch(`${base}/marketing/integrations`, { headers })
    if (!res.ok) return null
    const data = await res.json().catch(() => ({}))
    return (data.integrations ?? []) as MarketingIntegration[]
  } catch {
    return null
  }
}

export async function fetchMarketingPosts(): Promise<MarketingPost[]> {
  const data = await apiFetch<{ posts: MarketingPost[] }>('/marketing/posts', { posts: [] })
  return data.posts
}

async function marketingRequest<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<T> {
  const base = getApiBase()
  const token = getAuthToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await credFetch(`${base}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Request failed')
  return data as T
}

export async function createMarketingPost(input: {
  integration_id: string
  channel: string
  content: string
  scheduled_at?: string
  campaign?: string
  media_url?: string
}): Promise<MarketingPost> {
  const data = await marketingRequest<{ post: MarketingPost }>('/marketing/posts', 'POST', {
    ...input,
  })
  return data.post
}

export async function approveMarketingPost(id: string): Promise<MarketingPost> {
  const data = await marketingRequest<{ post: MarketingPost }>(
    `/marketing/posts/${id}/approve`,
    'POST',
  )
  return data.post
}

export async function rejectMarketingPost(id: string): Promise<MarketingPost> {
  const data = await marketingRequest<{ post: MarketingPost }>(
    `/marketing/posts/${id}/reject`,
    'POST',
  )
  return data.post
}

/** Edit a draft/publish_failed post — content and/or schedule ('' clears it). */
export async function updateMarketingPost(
  id: string,
  patch: { content?: string; scheduled_at?: string | null; media_url?: string | null },
): Promise<MarketingPost> {
  const data = await marketingRequest<{ post: MarketingPost }>(`/marketing/posts/${id}`, 'PATCH', {
    ...patch,
  })
  return data.post
}

export async function generateMarketingPost(input: {
  integration_id: string
  channel: string
  topic?: string
  blog_slug?: string
  campaign?: string
}): Promise<MarketingPost> {
  const data = await marketingRequest<{ post: MarketingPost }>(
    '/marketing/posts/generate',
    'POST',
    { ...input },
  )
  return data.post
}

/** Generate up to 3 draft variants without persisting — the composer
 *  shows them side by side and the operator picks one to edit/queue. */
export async function previewMarketingDrafts(input: {
  integration_id: string
  channel: string
  topic?: string
  blog_slug?: string
  campaign?: string
  count?: number
}): Promise<string[]> {
  const data = await marketingRequest<{ drafts: string[] }>('/marketing/posts/generate', 'POST', {
    ...input,
    preview: true,
  })
  return data.drafts ?? []
}

export interface FunnelBreakdown {
  key: string
  visit: number
  cta_click: number
  signup: number
  profile: number
  first_insight: number
}

export interface FunnelView {
  window_days: number
  steps: { step: 'visit' | 'cta_click' | 'signup' | 'profile' | 'first_insight'; count: number }[]
  by_source: FunnelBreakdown[]
  by_campaign: FunnelBreakdown[]
}

export interface MarketingPerformance {
  posts: {
    slug: string
    title?: string
    views: number
    cta_clicks: number
    signups: number
    leads: number
  }[]
  channels: { channel: string; views: number; cta_clicks: number; leads: number; signups: number }[]
  campaigns: { campaign: string; views: number; signups: number; leads: number }[]
  totals: { views: number; cta_clicks: number; signups: number; leads: number }
  /** Visit to first-insight funnel from the daily rollups (PRD-210); null until they exist. */
  funnel: FunnelView | null
  /** "What works" — engagement normalized against the account median
   *  (x=1.0); providers don't expose impressions so this is comparative,
   *  not an absolute rate. */
  insights: {
    measured_posts: number
    unmeasured_channels: string[]
    rows: { label: string; measured: number; engagement_x: number }[]
    top_post?: { channel: string; excerpt: string; engagement: number }
  }
}

export async function fetchMarketingPerformance(): Promise<MarketingPerformance | null> {
  return apiFetch<MarketingPerformance | null>('/marketing/performance', null)
}

export async function fetchSocialConnections(): Promise<SocialConnection[]> {
  const data = await apiFetch<{ connections: SocialConnection[] }>('/marketing/connections', {
    connections: [],
  })
  return data.connections
}

export async function connectBluesky(input: {
  handle: string
  app_password: string
}): Promise<SocialConnection> {
  const data = await marketingRequest<{ connection: SocialConnection }>(
    '/marketing/connections/bluesky',
    'POST',
    { ...input },
  )
  return data.connection
}

// ── Channel profiles (PRD-210, phase 2) ─────────────────────────────────

export interface ChannelProfileView {
  channel: string
  desired: { display_name: string; handle: string; bio: string; link: string }
  desired_hash: string
  problems: string[]
  bio_limit: number
  checklist_items: string[]
  checklist: Record<string, boolean>
  actual: {
    display_name: string
    bio: string
    /** null = this network's API does not say. */
    has_avatar: boolean | null
    has_banner: boolean | null
    checked_at: string
  } | null
  drift: { field: string; desired: string; actual: string }[]
  supports_check: boolean
  supports_apply: boolean
  saved: boolean
  applied_at: string | null
  dry_run?: boolean
}

export async function fetchChannelProfiles(): Promise<ChannelProfileView[]> {
  const data = await apiFetch<{ profiles: ChannelProfileView[] }>('/marketing/profiles', {
    profiles: [],
  })
  return data.profiles
}

export const saveChannelProfile = (channel: string, desired: ChannelProfileView['desired']) =>
  marketingRequest<ChannelProfileView>(`/marketing/profiles/${channel}`, 'PUT', { ...desired })

export const tickProfileStep = (channel: string, item: string, done: boolean) =>
  marketingRequest<ChannelProfileView>(`/marketing/profiles/${channel}/checklist`, 'PUT', {
    item,
    done,
  })

export const checkChannelProfile = (channel: string) =>
  marketingRequest<ChannelProfileView>(`/marketing/profiles/${channel}/check`, 'POST')

export const applyChannelProfile = (channel: string, expected_hash: string) =>
  marketingRequest<ChannelProfileView>(`/marketing/profiles/${channel}/apply`, 'POST', {
    expected_hash,
  })

// ── Weekly content plan (PRD-210, phase 3) ──────────────────────────────

export interface PlanPostView {
  id: string
  channel: string
  content: string
  content_hash: string
  state: MarketingPostState
  scheduled_at: string | null
  copy_check: { ok: boolean; violations: { rule: string; match: string }[] }
  /** Instagram cannot post without an image; true until a media URL is attached. */
  needs_image?: boolean
  media_url?: string | null
  alt_text?: string | null
  format?: string | null
  hook?: string | null
}

export interface PlanItemView {
  id: string
  week_key: string
  slot: number
  pillar: string
  title: string
  scheduled_at: string
  status: 'planned' | 'skipped'
  posts: PlanPostView[]
}

export interface PlanWeekView {
  week_key: string
  available_channels: string[]
  /** Connected channels left out of the plan, and why (dead token, error). */
  skipped_channels?: { channel: string; status: string; reason: string }[]
  items: PlanItemView[]
}

export async function fetchPlanWeek(week: string): Promise<PlanWeekView> {
  return apiFetch<PlanWeekView>(`/marketing/plan?week=${encodeURIComponent(week)}`, {
    week_key: week,
    available_channels: [],
    items: [],
  })
}

export const generatePlanWeek = (week_start: string) =>
  marketingRequest<PlanWeekView>('/marketing/plan/generate', 'POST', { week_start })

export const approvePlanPosts = (items: { post_id: string; content_hash: string }[]) =>
  marketingRequest<{
    approved: number
    refused: number
    results: { post_id: string; ok: boolean; error?: string }[]
  }>('/marketing/plan/approve', 'POST', { items })

export const skipPlanItem = (id: string) =>
  marketingRequest<{ ok: boolean }>(`/marketing/plan/items/${id}/skip`, 'POST')

export async function disconnectSocialChannel(channel: string): Promise<void> {
  await marketingRequest<{ ok: boolean }>(`/marketing/connections/${channel}`, 'DELETE')
}

/**
 * Kick off an OAuth connect flow for a social connector (twitter_x,
 * facebook_pages, linkedin, threads, instagram_business). The generic
 * connector route builds the authorize URL (signed tenant-bound state);
 * the callback lands back on /operator/marketing?connected=<connector_id>.
 * Tokens land encrypted in connector_credentials — no secret ever crosses
 * this request.
 */
export async function startConnectorConnect(
  connectorId: string,
): Promise<{ auth_url: string } | null> {
  const data = await apiFetch<{ auth_url?: string } | null>(
    `/connectors/${connectorId}/oauth/start?app=marketing&mode=json`,
    null,
  )
  return data?.auth_url ? { auth_url: data.auth_url } : null
}

export async function startXConnect(): Promise<{ auth_url: string } | null> {
  return startConnectorConnect('twitter_x')
}

export interface OperatorOverview {
  generated_at: string
  users: {
    total: number
    active: number
    suspended: number
    signups_today: number
    signups_week: number
    signups_prev_week?: number
  }
  tenants: { total: number; active: number }
  marketing: { publish_failed: number; queued: number }
  leads: Record<string, number>
  leads_7d?: number
  leads_prev_7d?: number
  signups_by_source_7d: Record<string, number>
  growth_events_7d: Array<{ event: string; count: number }>
  /** Per-day counts of funnel events over the last 30 days — sparkline feed. */
  activity_30d?: Array<{ day: string; event: string; count: number }>
  support?: { open: number }
}

export interface OperatorUser {
  id: string
  email: string
  name: string
  tenant_id: string
  roles: string[]
  status?: string
  email_verified?: boolean
  external_provider?: string
  attribution?: { utm_source?: string; utm_campaign?: string }
  failed_login_attempts?: number
  locked_until?: string
  sessions_revoked_at?: string
  mfa_enabled?: boolean
  created_at: string
}

export interface OperatorTenantHealth {
  score: number
  factors: { label: string; points: number }[]
}

export interface OperatorTenant {
  tenant_id: string
  name?: string
  status?: string
  plan?: string
  country?: string
  created_at?: string
  user_count: number
  health?: OperatorTenantHealth
}

async function operatorRequest<T>(path: string): Promise<T> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Operator request failed')
  return data as T
}

export interface OperatorIdentity {
  user_id: string
  tenant_id: string
  roles: string[]
  source: 'database' | 'bootstrap'
}

/** Mirrors the backend's OperatorPermission union — kept as a string here so
 *  new permissions don't break older frontends; nav filtering uses `string`. */
export type OperatorPermission = string

export interface OperatorMe {
  operator: OperatorIdentity
  permissions: OperatorPermission[]
}

/** Cheap identity check for the operator shell's access gate — the full
 *  overview payload would be wasted work on every first paint. */
export function fetchOperatorMe(): Promise<OperatorMe> {
  return operatorRequest<OperatorMe>('/operator/me')
}

export function fetchOperatorOverview(): Promise<OperatorOverview> {
  return operatorRequest<OperatorOverview>('/operator/overview')
}

export interface OperatorListPage {
  /** Absent on cursor-paginated responses — counting millions of rows on
   *  every keystroke page is exactly what the cursor avoids. */
  total?: number
  limit: number
  offset: number
  next_cursor?: string
}

export interface OperatorUserFilters {
  status?: string | undefined
  /** Exact tenant_id — the tenant drill-down from the tenants page. */
  tenant?: string | undefined
}

export function fetchOperatorUsers(
  query = '',
  filters: OperatorUserFilters = {},
  page: { limit?: number; offset?: number; cursor?: string } = {},
): Promise<{ users: OperatorUser[] } & OperatorListPage> {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (filters.status) params.set('status', filters.status)
  if (filters.tenant) params.set('tenant', filters.tenant)
  if (page.limit !== undefined) params.set('limit', String(page.limit))
  if (page.cursor) params.set('cursor', page.cursor)
  else if (page.offset !== undefined) params.set('offset', String(page.offset))
  const qs = params.toString()
  return operatorRequest(`/operator/users${qs ? `?${qs}` : ''}`)
}

export function fetchOperatorTenants(
  query = '',
  filters: { status?: string | undefined } = {},
  page: { limit?: number; offset?: number; cursor?: string } = {},
): Promise<{ tenants: OperatorTenant[] } & OperatorListPage> {
  const params = new URLSearchParams()
  if (query) params.set('q', query)
  if (filters.status) params.set('status', filters.status)
  if (page.limit !== undefined) params.set('limit', String(page.limit))
  if (page.cursor) params.set('cursor', page.cursor)
  else if (page.offset !== undefined) params.set('offset', String(page.offset))
  const qs = params.toString()
  return operatorRequest(`/operator/tenants${qs ? `?${qs}` : ''}`)
}

export interface OperatorTenantMember {
  id: string
  email: string
  name: string
  roles: string[]
  status?: string
  created_at: string
}

/** Tenant detail + member list — powers the inline member expansion on the
 *  operator tenants page. */
export function fetchOperatorTenant(id: string): Promise<{
  tenant: OperatorTenant
  members: OperatorTenantMember[]
  health: OperatorTenantHealth
}> {
  return operatorRequest(`/operator/tenants/${encodeURIComponent(id)}`)
}

export interface OperatorLoginEvent {
  created_at: string
  success: boolean
  method?: string
  ip?: string
}

export interface OperatorCaseSummary {
  id: string
  subject: string
  status: string
  updated_at: string
}

export interface OperatorUserDossier {
  user: OperatorUser
  tenant: OperatorTenant | null
  dossier: {
    recent_logins: OperatorLoginEvent[]
    insights: Record<string, number>
    ledger_tail: {
      timestamp: string
      type: string
      amount: number
      balance_after?: number
      reason?: string
    }[]
    support_cases: OperatorCaseSummary[]
    audit_trail: OperatorAuditEntry[]
  }
}

/** The one-screen support dossier for a single user. */
export function fetchOperatorUser(id: string): Promise<OperatorUserDossier> {
  return operatorRequest(`/operator/users/${encodeURIComponent(id)}`)
}

export interface OperatorRecord {
  user_id: string
  roles: string[]
  status: 'active' | 'suspended'
  source: 'database' | 'bootstrap'
  /** Bootstrap entries only — false means dormant (a DB super_admin exists). */
  effective?: boolean
  user?: { id: string; email: string; name: string } | null
}

export interface OperatorAuditEntry {
  operator_user_id: string
  operator_roles: string[]
  action: string
  target_type: string
  target_id: string
  reason: string
  request_id: string
  ip: string
  created_at: string
}

export interface OperatorOperations {
  generated_at: string
  process: { uptime_seconds: number; rss_bytes: number }
  mongo: { ok: boolean; ping_ms: number }
  insights_by_state: Record<string, number>
  marketing_posts_by_state: Record<string, number>
  cron_locks: Array<
    Record<string, unknown> & {
      name?: string
      owner?: string
      expires_at?: string
      stale?: boolean
    }
  >
  reminders_by_state: Record<string, number>
  failed_reminders: Array<{
    id: string
    tenant_id?: string
    due_at?: string
    attempts?: number
    last_error?: string
    policy?: { type?: string; provider?: string }
  }>
  stale_reminder_claims: number
  connectors: {
    by_connector: Record<string, number>
    expiring_tokens_7d: number
    list: Array<{
      tenant_id: string
      connector_id: string
      auth_type?: string
      token_expires_at?: string
      created_at?: string
    }>
  }
  delivery_by_state: Record<string, number>
  failed_deliveries: Array<{
    tenant_id?: string
    channel?: string
    status?: string
    error?: string
    updated_at?: string
  }>
  failed_posts: Array<{ id: string; channel?: string; publish_error?: string; updated_at?: string }>
  queue:
    | {
        available: true
        pending: number
        processing: number
        delayed: number
        dead: number
        dead_jobs: Array<{ id: string; attempts?: number; enqueuedAt: number }>
      }
    | { available: false }
  growth_events_24h: number
  documents_pending: number
  /** Triage notes from runbooks.yaml, keyed by alert/queue name. */
  runbooks?: Record<string, { what: string; safe_to_requeue: string; escalate: string }>
}

export type OperatorAlertAction = 'ack' | 'snooze' | 'resolve' | 'reopen'

export interface OperatorAlert {
  dedup_key: string
  status: 'open' | 'ack' | 'snoozed' | 'resolved'
  title?: string
  severity?: 'info' | 'warning' | 'danger'
  signal_value?: number
  resolved_signal_value?: number | null
  snoozed_until?: string | null
  updated_by?: string
  updated_at: string
}

export function fetchOperatorAlerts(): Promise<{ alerts: OperatorAlert[] }> {
  return operatorRequest('/operator/alerts')
}

export async function setOperatorAlertState(
  dedupKey: string,
  action: OperatorAlertAction,
  context: { title?: string; severity?: string; href?: string; signal_value?: number } = {},
): Promise<void> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/alerts/state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ dedup_key: dedupKey, action, ...context }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Alert action failed')
}

/** Dual-control actions return 202 { approval_required } — the mutation has
 *  NOT happened yet. Surface that instead of letting callers toast success. */
function throwIfPendingApproval(data: unknown): void {
  const body = data as { approval_required?: boolean; message?: string }
  if (body?.approval_required) {
    throw new Error(body.message ?? "Awaiting a second operator's confirmation")
  }
}

async function operatorAction(path: string, reason: string): Promise<void> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ reason }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Operator action failed')
  throwIfPendingApproval(data)
}

export const suspendOperatorUser = (id: string, reason: string) =>
  operatorAction(`/operator/users/${id}/suspend`, reason)
export const reactivateOperatorUser = (id: string, reason: string) =>
  operatorAction(`/operator/users/${id}/reactivate`, reason)
export const sendUserPasswordReset = (id: string, reason: string) =>
  operatorAction(`/operator/users/${id}/password-reset`, reason)
export const revokeUserSessions = (id: string, reason: string) =>
  operatorAction(`/operator/users/${id}/revoke-sessions`, reason)
export const unlockUser = (id: string, reason: string) =>
  operatorAction(`/operator/users/${id}/unlock`, reason)
export const disableUserMfa = (id: string, reason: string) =>
  operatorAction(`/operator/users/${id}/mfa-disable`, reason)

export interface OperatorUserExport {
  exported_at: string
  requested_by?: string
  reason: string
  user: Record<string, unknown>
  tenant: Record<string, unknown> | null
  members: OperatorTenantMember[]
  leads: Record<string, unknown>[]
  operator_actions_on_record: Record<string, unknown>[]
}

/** Data-subject export — same POST+reason shape as other operator actions,
 *  but returns the assembled bundle instead of void. */
export async function exportOperatorUser(id: string, reason: string): Promise<OperatorUserExport> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/users/${id}/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ reason }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Export failed')
  return data as OperatorUserExport
}

export const eraseOperatorUser = (id: string, reason: string) =>
  operatorAction(`/operator/users/${id}/erase`, reason)

export interface OperatorSecurity {
  generated_at: string
  locked_users: Array<{
    id: string
    email: string
    tenant_id: string
    failed_login_attempts?: number
    locked_until?: string
  }>
  users_with_failed_logins: number
  suspended_users: number
  sessions_revoked_7d: number
  logins_24h: { successful: number; failed: number }
  failed_by_ip_24h: Array<{ ip: string; count: number }>
  new_ip_logins_24h: Array<{ email: string; ip: string; first_seen: string }>
  recent_login_events: Array<{
    email?: string
    success: boolean
    reason?: string
    ip?: string
    user_agent?: string
    created_at: string
  }>
}

export function fetchOperatorSecurity(): Promise<OperatorSecurity> {
  return operatorRequest('/operator/security')
}
export const suspendOperatorTenant = (id: string, reason: string) =>
  operatorAction(`/operator/tenants/${id}/suspend`, reason)
export const reactivateOperatorTenant = (id: string, reason: string) =>
  operatorAction(`/operator/tenants/${id}/reactivate`, reason)
export const suspendOperator = (id: string, reason: string) =>
  operatorAction(`/operator/operators/${id}/suspend`, reason)
export const reactivateOperator = (id: string, reason: string) =>
  operatorAction(`/operator/operators/${id}/reactivate`, reason)
export const retryReminder = (id: string, reason: string) =>
  operatorAction(`/operator/reminders/${id}/retry`, reason)
export const requeueDeadJob = (queue: string, jobId: string, reason: string) =>
  operatorAction(`/operator/queues/${queue}/dead/${jobId}/requeue`, reason)
export const revokeConnector = (connectorId: string, tenantId: string, reason: string) =>
  operatorAction(`/operator/connectors/${connectorId}/tenants/${tenantId}/revoke`, reason)

// ── Operator: funnel ──────────────────────────────────────────────────────

export interface OperatorFunnel {
  window_days: number
  totals: {
    leads_30d: number
    signups_30d: number
    activated_tenants: number
    paying_tenants: number
  }
  leads_by_stage: Record<string, number>
  by_source: Array<{
    source: string
    leads: number
    signups: number
    paying: number
    trialing: number
  }>
  /** Activation steps for the 30d signup cohort — measured from persisted
   *  tenant state (profile exists / first insight / connector linked),
   *  not anonymous client events. */
  activation?: {
    cohort_signups_30d: number
    steps: { key: string; label: string; count: number; pct: number }[]
    median_time_to_first_insight_hours: number | null
  }
  /** The funnel's paying end: conversions in-window (first credit ledger
   *  plan_grant, or billing_period_start when the ledger is off), the
   *  active-trial pipeline, and MRR over priced plans. */
  revenue?: {
    paying_tenants: number
    paying_30d: number
    trialing_tenants: number
    mrr_pence: number
    currency: string
    median_days_to_paid: number | null
  }
}

export function fetchOperatorFunnel(): Promise<OperatorFunnel> {
  return operatorRequest('/operator/funnel')
}

// ── Operator: referrals ───────────────────────────────────────────────────

export interface OperatorReferrals {
  totals: {
    codes_issued: number
    referrals: number
    pending: number
    rewarded: number
    credits_granted: number
  }
  leaderboard: {
    tenant_id: string
    tenant_name: string
    code: string
    pending: number
    rewarded: number
    referrals: number
  }[]
  recent: {
    referrer_tenant_id: string
    referrer_name: string
    referred_name: string
    code: string
    status: string
    created_at: string
    rewarded_at: string | null
  }[]
}

export function fetchOperatorReferrals(): Promise<OperatorReferrals> {
  return operatorRequest('/operator/referrals')
}

// ── Operator: configuration ───────────────────────────────────────────────

export type LlmProviderId = 'anthropic' | 'openai' | 'azure' | 'vertex' | 'ollama' | 'groq' | 'xai'

export interface PlatformConfig {
  maintenance_mode: boolean
  signups_enabled: boolean
  marketing_paused: boolean
  /** Kill switch: while true the autopilot sweep (shadow and live) does nothing. */
  autopilot_paused: boolean
  maintenance_window: MaintenanceWindow | null
  llm_provider_override: LlmProviderId | null
}

export interface ConfigHistoryEntry {
  changes: Partial<PlatformConfig>
  before: PlatformConfig
  after: PlatformConfig
  changed_by?: string
  reason: string
  created_at: string
}

export function fetchOperatorConfiguration(): Promise<{
  config: PlatformConfig
  history: ConfigHistoryEntry[]
}> {
  return operatorRequest('/operator/configuration')
}

export async function updateOperatorConfiguration(
  changes: Partial<Omit<PlatformConfig, 'llm_provider_override'>> & {
    /** 'auto' clears the override back to router detection. */
    llm_provider_override?: LlmProviderId | 'auto' | null
  },
  reason: string,
): Promise<PlatformConfig> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/configuration`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...changes, reason }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Configuration update failed')
  return (data as { config: PlatformConfig }).config
}

// ── Operator: infrastructure ──────────────────────────────────────────────

export interface CostSnapshot {
  id: string
  service: string
  monthly_usd: number
  note?: string
  recorded_by?: string
  recorded_at: string
}

export function fetchInfrastructure(): Promise<{
  services: CostSnapshot[]
  total_monthly_usd: number
  history: CostSnapshot[]
}> {
  return operatorRequest('/operator/infrastructure')
}

export async function recordCostSnapshot(
  service: string,
  monthlyUsd: number,
  reason: string,
  note?: string,
): Promise<void> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/infrastructure/snapshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      service,
      monthly_usd: monthlyUsd,
      reason,
      ...(note !== undefined ? { note } : {}),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Snapshot failed')
}

export function fetchOperatorLead(
  id: string,
): Promise<{ lead: OperatorLead & { attribution?: Record<string, string> } }> {
  return operatorRequest(`/operator/leads/${id}`)
}

export async function createOperator(
  userId: string,
  roles: string[],
  reason: string,
): Promise<void> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/operators`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ user_id: userId, roles, reason }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Could not add operator')
  throwIfPendingApproval(data)
}

export function fetchOperators(): Promise<{
  operators: OperatorRecord[]
  bootstrap: OperatorRecord[]
}> {
  return operatorRequest('/operator/operators')
}

// ── Operator: dual control (four-eyes) ──────────────────────────────────

export interface DualApproval {
  id: string
  action: string
  target_type: string
  target_id: string
  required_permission: string
  reason: string
  requested_by: string
  status: 'pending' | 'confirmed' | 'consumed'
  created_at: string
  expires_at: string
  confirmed_by?: string
}

export function fetchDualApprovals(
  status: 'pending' | 'confirmed' | 'consumed' = 'pending',
): Promise<{ approvals: DualApproval[] }> {
  return operatorRequest(`/operator/dual-approvals?status=${status}`)
}

export async function confirmDualApproval(id: string, reason: string): Promise<void> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/dual-approvals/${id}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ reason }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Confirmation failed')
}

export function fetchOperatorAudit(
  query: {
    action?: string | undefined
    target_type?: string | undefined
    target_id?: string | undefined
  } = {},
): Promise<{ entries: OperatorAuditEntry[]; total: number }> {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v) as [string, string][],
  )
  return operatorRequest(`/operator/audit${params.size ? `?${params}` : ''}`)
}

export function fetchOperatorOperations(): Promise<OperatorOperations> {
  return operatorRequest('/operator/operations')
}

// ── Operator: AI gateway health (PRD-217) ────────────────────────────────
// Metadata-only: task ids, models, outcomes, latencies, costs and registry
// status. Prompt and completion content never reaches this surface.

export interface OperatorAiTaskHealth {
  task_id: string
  data_boundary: string
  budget_class?: string | undefined
  deadline_ms: number
  primary_model: string
  serving_processor: string | null
  breaker_state: 'closed' | 'open' | 'half-open'
  /** Operator disabled the task — calls are refused pre-provider and land
   *  on the caller's honest fallback. */
  disabled: boolean
  calls: number
  failures: number
  /** Calls refused by the disabled switch — demand against an off task,
   *  counted separately from real failures. */
  disabled_refusals: number
  /** PRD-215 P8: ok calls (not failures or disabled refusals). */
  accepted_calls: number
  /** Calls whose output the guard rejected — subtracted from accepted. */
  guard_rejected_calls: number
  correct_calls: number
  failure_rate: number
  p50_ms: number | null
  p95_ms: number | null
  cost_microdollars: number
  /** PRD-215 P8: cost ÷ correct calls; null when nothing was accepted. */
  cost_per_correct_microdollars: number | null
}

export interface OperatorAiProcessor {
  id: string
  name: string
  hosting: 'self_hosted' | 'hosted'
  status: 'approved' | 'unreviewed' | 'self_hosted'
  reviewed_at: string
  review_due: string
  review_lapsed: boolean
}

export interface OperatorAiHealth {
  generated_at: string
  window_days: number
  tasks: OperatorAiTaskHealth[]
  processors: OperatorAiProcessor[]
  assistant_answer_mix: Record<string, number> & {
    total: number
    generation_escape_rate: number | null
  }
  guard_events: Array<{ type: string; action: string; count: number }>
  /** PRD-215: per-task cascade tier counts (rule_hit / prefilter_skip /
   *  encoder_skip / model_call). model_call share is the generator-escape
   *  signal for tiered tasks. */
  cascade_funnel: Array<{ task_id: string; stage: string; count: number }>
  disabled_tasks: string[]
  /** Self-hosted model queue stats — mean wait for a concurrency slot. */
  local_model: { calls: number; queue_wait_mean_s: number | null }
}

export function fetchOperatorAiHealth(days = 7): Promise<OperatorAiHealth> {
  return operatorRequest(`/operator/ai-health?days=${days}`)
}

/** PRD-217 disable→fallback switch. A 202 (approval required) throws with
 *  the server's message — the caller's ReasonAction surfaces it. */
export async function setOperatorAiTaskState(
  taskId: string,
  enabled: boolean,
  reason: string,
): Promise<void> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/ai-tasks/${encodeURIComponent(taskId)}/state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ enabled, reason }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Could not update the task')
  throwIfPendingApproval(data)
}

// ── Operator: autopilot ───────────────────────────────────────────────────

export interface ShadowStats {
  total: number
  reviewed: number
  right: number
  /** right / reviewed; null until a row is reviewed. */
  precision: number | null
  promotable: boolean
}

export interface AutopilotRule {
  rule: string
  label: string
  description: string
  enabled: boolean
  /** shadow = logs "would do" only; live = acts. */
  mode: 'shadow' | 'live'
  /** Present only while the rule is shadowing. */
  shadow?: ShadowStats | null
  max_blast_radius: number
  cooldown_minutes: number
  last_run_at?: string
  updated_by?: string
  updated_at?: string
}

export interface AutopilotAction {
  id: string
  rule: string
  target_type: string
  target_id: string
  reason: string
  status: 'executed' | 'failed' | 'proposed' | 'approved' | 'rejected' | 'shadow'
  result?: string
  would_do?: string
  review?: 'right' | 'wrong'
  proposal?: {
    kind: string
    required_permission: string
    summary: string
  }
  resolved_by?: string
  resolved_at?: string
  created_at: string
}

export function fetchOperatorAutopilot(): Promise<{
  rules: AutopilotRule[]
  recent_actions: AutopilotAction[]
  never_autonomous: string[]
  paused: boolean
  shadow_promotion: { min_reviewed: number; min_precision: number }
}> {
  return operatorRequest('/operator/autopilot')
}

export function updateOperatorAutopilot(
  rule: string,
  update: {
    enabled?: boolean
    mode?: 'shadow' | 'live'
    max_blast_radius?: number
    cooldown_minutes?: number
  },
  reason: string,
): Promise<{ rule: AutopilotRule }> {
  const base = getApiBase()
  const token = getAuthToken()
  return credFetch(`${base}/operator/autopilot/${encodeURIComponent(rule)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...update, reason }),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data.error as string) || 'Autopilot update failed')
    return data
  })
}

export function resolveAutopilotProposal(
  id: string,
  decision: 'approve' | 'reject',
  reason: string,
): Promise<{ ok: boolean; result?: string }> {
  const base = getApiBase()
  const token = getAuthToken()
  return credFetch(`${base}/operator/autopilot/proposals/${encodeURIComponent(id)}/${decision}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ reason }),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data.error as string) || `Proposal ${decision} failed`)
    return data
  })
}

// ── Operator: social channel health ───────────────────────────────────────

export type ChannelStatus =
  'connected' | 'expiring_soon' | 'degraded' | 'needs_reauth' | 'error' | 'not_configured'

export interface ChannelHealth {
  channel: 'bluesky' | 'linkedin' | 'x' | 'threads' | 'instagram' | 'facebook'
  label: string
  status: ChannelStatus
  usable: boolean
  handle: string | null
  expires_at: string | null
  last_publish_at: string | null
  last_error: string | null
  /** Developer-app credentials are set on the API (a yes/no, never the value). */
  app_credentials: boolean
  setup: {
    portal: string
    steps: string[]
    redirect_uri: string | null
    env: string[]
    note?: string
  }
}

export function fetchChannelHealth(): Promise<{ channels: ChannelHealth[] }> {
  return operatorRequest('/marketing/channels/health')
}

// ── Operator: standing approvals (the content bank and the policy) ────────

export interface BankEntry {
  id: string
  content: string
  content_hash: string
  channels: string[]
  format: string | null
  hook: string | null
  pillar: string | null
  status: 'candidate' | 'approved' | 'retired'
  source: 'plan_draft' | 'candidate_job' | 'manual'
  card: { layout: string; headline: string; sub?: string } | null
  media_url: string | null
  link_path: string | null
  copy_check: { ok: boolean; violations: { rule: string; match: string }[] }
  missing_image_for: string[]
  approved_by: string | null
  approved_at: string | null
  expires_at: string | null
  times_scheduled: number
  retired_reason: string | null
  created_at: string
}

export interface StandingPolicy {
  enabled: boolean
  enabled_by: string
  enabled_at: string
  reason: string
  expires_at: string
  channels: string[]
  max_per_channel_per_week: number
  max_per_channel_per_day: number
  min_gap_hours: number
  repeat_cooldown_days: number
  hours: number[]
  paused_channels: { channel: string; reason: string; at: string }[]
}

export interface StandingStatus {
  policy: StandingPolicy | null
  active: boolean
  bank: { candidate: number; approved: number; retired: number }
  weeks_of_posts_left: number | null
  upcoming: { id: string; channel: string; scheduled_at: string; bank_entry_id?: string }[]
}

export function fetchStanding(): Promise<StandingStatus> {
  return operatorRequest('/marketing/standing')
}

export async function fetchBank(status?: BankEntry['status']): Promise<BankEntry[]> {
  const data = await operatorRequest<{ entries: BankEntry[] }>(
    `/marketing/bank${status ? `?status=${status}` : ''}`,
  )
  return data.entries
}

export function saveStandingPolicy(input: {
  reason: string
  expires_in_days: number
  channels: string[]
  max_per_channel_per_week?: number
}): Promise<{ policy: StandingPolicy }> {
  return marketingRequest('/marketing/standing', 'PUT', input)
}

export function disableStanding(reason: string): Promise<{ rejected: number }> {
  return marketingRequest('/marketing/standing/disable', 'POST', { reason })
}

export function resumeStandingChannel(channel: string): Promise<{ ok: true }> {
  return marketingRequest(
    `/marketing/standing/channels/${encodeURIComponent(channel)}/resume`,
    'POST',
  )
}

export function runStandingNow(): Promise<{ scheduled: number }> {
  return marketingRequest('/marketing/standing/run', 'POST')
}

export function approveBankEntries(items: { id: string; content_hash: string }[]): Promise<{
  results: { id: string; ok: boolean; error?: string }[]
  approved: number
  refused: number
}> {
  return marketingRequest('/marketing/bank/approve', 'POST', { items })
}

export function retireBankEntry(id: string, reason?: string): Promise<{ ok: true }> {
  return marketingRequest(`/marketing/bank/${id}/retire`, 'POST', reason ? { reason } : {})
}

export function editBankEntry(id: string, content: string): Promise<BankEntry> {
  return marketingRequest(`/marketing/bank/${id}`, 'PATCH', { content })
}

// ── Operator: Search Console and GA4 read-back (read-only) ────────────────

export type SearchIntegrationStatus = 'connected' | 'not_configured' | 'needs_attention'

export interface SearchView {
  window_days: number
  lag_note: string
  enough_data: boolean
  configured: { credentials: boolean; search_console: boolean; ga4: boolean }
  integrations: Record<
    'search_console' | 'ga4',
    { status: SearchIntegrationStatus; last_ok_at: string | null; last_error: string | null }
  >
  totals: { clicks: number; impressions: number }
  top_queries: {
    query: string
    clicks: number
    impressions: number
    ctr: number
    position: number
  }[]
  top_pages: { path: string; clicks: number; impressions: number; ctr: number; position: number }[]
  near_misses: {
    query: string
    clicks: number
    impressions: number
    ctr: number
    position: number
  }[]
  ga4: {
    sessions: number
    first_party_visits: number
    note: string
    by_source: { source_medium: string; sessions: number; engaged: number; key_events: number }[]
  }
}

export interface TopicSuggestion {
  id: string
  query: string
  impressions: number
  clicks: number
  position: number
  nearest: { kind: 'brief' | 'guide'; id: string; title: string; overlap: number } | null
}

export function fetchSearchView(days = 28): Promise<SearchView> {
  return operatorRequest(`/operator/marketing/search?days=${days}`)
}

export async function fetchTopicSuggestions(): Promise<TopicSuggestion[]> {
  const data = await operatorRequest<{ suggestions: TopicSuggestion[] }>(
    '/operator/marketing/search/suggestions',
  )
  return data.suggestions
}

export function runSearchReadbackNow(): Promise<Record<string, unknown>> {
  return marketingRequest('/operator/marketing/search/run', 'POST')
}

export function generateTopicSuggestions(): Promise<{ suggested: number }> {
  return marketingRequest('/operator/marketing/search/suggestions/generate', 'POST')
}

export function setTopicSuggestion(id: string, action: 'dismiss' | 'used'): Promise<{ ok: true }> {
  return marketingRequest(
    `/operator/marketing/search/suggestions/${encodeURIComponent(id)}/${action}`,
    'POST',
  )
}

// ── Operator: marketing economics ─────────────────────────────────────────

export interface EconomicsRate {
  numerator: number
  denominator: number
  rate: number | null
  low: number | null
  high: number | null
}

export type EconomicsConfidence = 'insufficient' | 'directional' | 'solid'

export interface EconomicsRow {
  key: string
  /** null where the dimension has no visit data (content items). */
  visits: number | null
  cta_clicks: number | null
  signups: number
  profiles: number
  activated: number
  paid: number
  revenue_pence: number
  spend_pence: number | null
  cost_per_signup_pence: number | null
  cac_pence: number | null
  payback_months: number | null
  visit_to_signup: EconomicsRate | null
  signup_to_activated: EconomicsRate
  signup_to_paid: EconomicsRate
  confidence: EconomicsConfidence
  finding: string
}

export interface EconomicsView {
  window_days: number
  model: 'first' | 'last'
  totals: EconomicsRow
  by_source: EconomicsRow[]
  by_campaign: EconomicsRow[]
  by_content: EconomicsRow[]
  last_touch_coverage: number | null
  arpu_pence: number | null
  notes: string[]
  revenue: {
    synced: boolean
    last_sync_at: string | null
    mrr_pence: number | null
    livemode: boolean | null
  }
  rollup_ready: boolean
}

export interface SpendEntry {
  id: string
  month: string
  channel: string
  amount_pence: number
  note?: string
  created_by: string
  created_at: string
}

export function fetchEconomics(days: number, model: 'first' | 'last'): Promise<EconomicsView> {
  return operatorRequest(`/operator/marketing/economics?days=${days}&model=${model}`)
}

/** PRD-218: the weekly posts table — visits/signups joined by post tag. */
export interface PostStatRow {
  id: string
  post_tag: string | null
  variant_of?: string | null
  channel: string
  format: string | null
  hook: string | null
  pillar: string | null
  length_bucket: 'short' | 'medium' | 'long' | null
  hour_bucket: 'morning' | 'midday' | 'afternoon' | 'evening' | null
  has_media: boolean
  posted_at: string | null
  visits: number
  signups: number
  engagement: { likes: number; reposts: number; replies: number }
  tagged: boolean
}

export interface PostStatGroup {
  key: string | null
  posts: number
  visits: number
  signups: number
  visits_per_post: number
  visits_per_post_interval: { low: number; high: number } | null
  signup_rate_interval: { low: number; high: number } | null
  insufficient: boolean
}

export interface PostStatsView {
  rows: PostStatRow[]
  groups: Record<string, PostStatGroup[]>
}

export function fetchPostStats(weeks = 8): Promise<PostStatsView> {
  return operatorRequest(`/operator/marketing/post-stats?weeks=${weeks}`)
}

export function fetchSpend(): Promise<{ entries: SpendEntry[] }> {
  return operatorRequest('/operator/marketing/spend')
}

async function operatorJson<T>(method: 'POST' | 'DELETE', path: string, body: unknown): Promise<T> {
  const token = getAuthToken()
  const res = await credFetch(`${getApiBase()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Request failed')
  return data as T
}

export function addSpendEntry(
  entry: { month: string; channel: string; amount_pence: number; note?: string },
  reason: string,
): Promise<{ entry: SpendEntry }> {
  return operatorJson('POST', '/operator/marketing/spend', { ...entry, reason })
}

export function deleteSpendEntry(id: string, reason: string): Promise<{ ok: boolean }> {
  return operatorJson('DELETE', `/operator/marketing/spend/${encodeURIComponent(id)}`, { reason })
}

export function syncRevenueNow(
  reason: string,
): Promise<{ configured: boolean; invoices: number; subscriptions: number }> {
  return operatorJson('POST', '/operator/marketing/revenue/sync', { reason })
}

/** Verdict on one shadow row — "would that have been the right call?". */
export function reviewShadowAction(
  id: string,
  verdict: 'right' | 'wrong',
  reason: string,
): Promise<{ ok: boolean; shadow: ShadowStats }> {
  const base = getApiBase()
  const token = getAuthToken()
  return credFetch(`${base}/operator/autopilot/shadow/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ verdict, reason }),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data.error as string) || 'Review failed')
    return data
  })
}

// ── Operator: Mission Control ─────────────────────────────────────────────

export interface MissionDecision {
  id: string
  kind:
    | 'proposal'
    | 'alert'
    | 'support_case'
    | 'post_draft'
    | 'post_failed'
    | 'campaign_draft'
    | 'dual_approval'
    | 'plan_week'
    | 'plan_missing'
    | 'channel_attention'
    | 'profile_drift'
  severity: 'danger' | 'warning' | 'info'
  title: string
  why: string
  effect: string
  undo: string
  href: string
  required_permission: string
  /** Only proposals and alerts — everything else opens its own page. */
  batchable: boolean
  created_at: string
}

export function fetchMissionControl(): Promise<{
  decisions: MissionDecision[]
  autopilot_paused: boolean
}> {
  return operatorRequest('/operator/mission-control')
}

export interface MissionBatchResult {
  id: string
  ok: boolean
  status: number
  error?: string
}

export function batchMissionControl(
  items: { id: string; action: 'approve' | 'reject' | 'ack' }[],
  reason: string,
): Promise<{ results: MissionBatchResult[] }> {
  const base = getApiBase()
  const token = getAuthToken()
  return credFetch(`${base}/operator/mission-control/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ items, reason }),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data.error as string) || 'Batch failed')
    return data
  })
}

export interface OperatorDigest {
  id: string
  window_days: number
  signups_7d: number
  signups_prev_7d: number
  leads_new: number
  leads_total_7d: number
  open_alerts: number
  autopilot_executed_7d: number
  autopilot_pending_proposals: number
  marketing_published_7d: number
  lifecycle_sent_7d: number
  upgrade_intent_7d: number
  top_content?: { slug: string; signups: number }
  created_at: string
}

export function fetchOperatorDigest(): Promise<{ digest: OperatorDigest | null }> {
  return operatorRequest('/operator/digest')
}

export function sendOperatorDigest(): Promise<{ digest: OperatorDigest }> {
  const base = getApiBase()
  const token = getAuthToken()
  return credFetch(`${base}/operator/digest/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data.error as string) || 'Digest generation failed')
    return data
  })
}

// ── Operator: leads ───────────────────────────────────────────────────────

export type LeadStage = 'new' | 'qualified' | 'contacted' | 'trial' | 'converted' | 'lost'

export interface OperatorLead {
  id: string
  email: string
  name?: string
  source: string
  stage: LeadStage
  score_band?: string
  suppressed: boolean
  consent?: { marketing: boolean; captured_at?: string; source?: string }
  notes: Array<{ text: string; author_id?: string; created_at: string }>
  created_at: string
  updated_at?: string
}

export function fetchOperatorLeads(
  query: {
    q?: string
    stage?: string
    source?: string
    suppressed?: 'true' | 'false'
    limit?: number
    offset?: number
    cursor?: string
  } = {},
): Promise<{
  leads: OperatorLead[]
  total?: number
  next_cursor?: string
  stages: Record<string, number>
  sources: Record<string, number>
  limit: number
  offset: number
}> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  return operatorRequest(`/operator/leads${params.size ? `?${params}` : ''}`)
}

export async function updateOperatorLead(
  id: string,
  update: { stage?: LeadStage; note?: string },
  reason: string,
): Promise<OperatorLead> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/leads/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...update, reason }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Lead update failed')
  return (data as { lead: OperatorLead }).lead
}

export const suppressOperatorLead = (id: string, reason: string) =>
  operatorAction(`/operator/leads/${id}/suppress`, reason)

// ── Operator: promotions ──────────────────────────────────────────────────

export interface OperatorPromotion {
  code: string
  grant_credits: number
  max_uses: number
  used_count: number
  active: boolean
  expires_at?: string
  created_by?: string
  created_at: string
}

export function fetchOperatorPromotions(
  query = '',
): Promise<{ promotions: OperatorPromotion[]; total: number }> {
  return operatorRequest(`/operator/promotions${query ? `?q=${encodeURIComponent(query)}` : ''}`)
}

export function fetchPromotionRedemptions(code: string): Promise<{
  promotion: OperatorPromotion
  redemptions: Array<{ tenant_id: string; grant_credits: number; redeemed_at: string }>
}> {
  return operatorRequest(`/operator/promotions/${encodeURIComponent(code)}/redemptions`)
}

export async function createOperatorPromotion(
  input: { code: string; grant_credits: number; max_uses: number; expires_at?: string },
  reason: string,
): Promise<void> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/promotions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...input, reason }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Could not create promotion')
}

export const deactivatePromotion = (code: string, reason: string) =>
  operatorAction(`/operator/promotions/${encodeURIComponent(code)}/deactivate`, reason)
export const reactivatePromotion = (code: string, reason: string) =>
  operatorAction(`/operator/promotions/${encodeURIComponent(code)}/reactivate`, reason)

// ── Operator: blog / SEO content ──────────────────────────────────────────

export interface OperatorBlogPost {
  id: string
  title: string
  slug: string
  excerpt: string
  category: 'product' | 'tutorial' | 'case-study' | 'news'
  author: string
  published: boolean
  cover_image?: string
  tags: string[]
  meta_description?: string
  content?: string
  published_at?: string
  created_at: string
  updated_at?: string
}

export type BlogPostInput = Omit<
  OperatorBlogPost,
  'id' | 'published' | 'published_at' | 'created_at' | 'updated_at'
>

export function fetchOperatorBlogPosts(): Promise<{ posts: OperatorBlogPost[] }> {
  return operatorRequest('/operator/blog/posts')
}

export function fetchOperatorBlogPost(id: string): Promise<{ post: OperatorBlogPost }> {
  return operatorRequest(`/operator/blog/posts/${id}`)
}

async function blogPostWrite(
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
): Promise<OperatorBlogPost> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Blog request failed')
  return (data as { post: OperatorBlogPost }).post
}

export const createOperatorBlogPost = (input: BlogPostInput, reason: string) =>
  blogPostWrite('/operator/blog/posts', 'POST', { ...input, reason })
export const updateOperatorBlogPost = (id: string, input: Partial<BlogPostInput>, reason: string) =>
  blogPostWrite(`/operator/blog/posts/${id}`, 'PATCH', { ...input, reason })
export const publishBlogPost = (id: string, reason: string) =>
  operatorAction(`/operator/blog/posts/${id}/publish`, reason)
export const unpublishBlogPost = (id: string, reason: string) =>
  operatorAction(`/operator/blog/posts/${id}/unpublish`, reason)

// ── Operator: segment campaigns ───────────────────────────────────────────

export interface CampaignFilter {
  audience: 'users' | 'leads' | 'both'
  plans?: string[]
  trialing?: boolean
  has_profile?: boolean
  lead_stages?: string[]
  utm_sources?: string[]
  created_within_days?: number
  min_age_days?: number
}

export interface OperatorCampaign {
  id: string
  name: string
  subject: string
  body_text: string
  cta_url?: string
  cta_label?: string
  filter: CampaignFilter
  status: 'draft' | 'sending' | 'paused' | 'sent'
  created_by: string
  created_at: string
  sent_at?: string
  stats?: { targeted: number; sent: number; skipped: number; failed: number; settled: number }
  /** SendGrid event-webhook rollup — null until events arrive (or webhook
   *  unconfigured). */
  engagement?: { opened: number; clicked: number; bounced: number } | null
}

export function fetchOperatorCampaigns(): Promise<{ campaigns: OperatorCampaign[] }> {
  return operatorRequest('/operator/campaigns')
}

async function campaignWrite(path: string, body: Record<string, unknown>): Promise<unknown> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Campaign request failed')
  throwIfPendingApproval(data)
  return data
}

export const createCampaign = async (
  input: Omit<
    OperatorCampaign,
    'id' | 'status' | 'created_by' | 'created_at' | 'sent_at' | 'stats'
  >,
  reason: string,
): Promise<OperatorCampaign> =>
  (
    (await campaignWrite('/operator/campaigns', { ...input, reason })) as {
      campaign: OperatorCampaign
    }
  ).campaign

export const previewCampaignAudience = (
  filter: CampaignFilter,
): Promise<{ count: number; users: number; leads: number }> =>
  campaignWrite('/operator/campaigns/preview', { ...filter }) as Promise<{
    count: number
    users: number
    leads: number
  }>

export const sendCampaignNow = (id: string, reason: string) =>
  operatorAction(`/operator/campaigns/${id}/send`, reason)

export const pauseCampaignSend = (id: string, reason: string) =>
  operatorAction(`/operator/campaigns/${id}/pause`, reason)

export const resumeCampaignSend = (id: string, reason: string) =>
  operatorAction(`/operator/campaigns/${id}/resume`, reason)

// ── Operator: billing ─────────────────────────────────────────────────────

export interface OperatorBillingOverview {
  generated_at: string
  tenants_by_plan: Record<string, number>
  tenants_by_status: Record<string, number>
  stripe_linked_tenants: number
  low_credit_tenants: number
  credits_outstanding: number
  recent_webhooks: Array<{ event_id: string; event_type: string; processed_at: string }>
  recent_adjustments: Array<{
    tenant_id: string
    amount: number
    reason: string
    actor: string
    timestamp: string
  }>
  /** Stripe portal cancellation-survey results, aggregated + recent rows.
   *  'unstated' = churned before the survey existed or reason skipped. */
  churn_by_reason: Record<string, number>
  recent_churned: Array<{
    tenant_id: string
    name?: string
    reason: string | null
    feedback: string | null
    churned_at: string | null
  }>
}

export interface BillingTenant {
  tenant_id: string
  name?: string
  plan?: string
  status?: string
  billing?: {
    credits_balance?: number
    credits_included?: number
    currency?: string
    trial_ends_at?: string
  }
  stripe_customer_id?: string
  stripe_subscription_id?: string
}

export interface LedgerEntry {
  id: string
  type: string
  amount: number
  balance_after: number
  reference?: string
  reason: string
  actor: string
  timestamp: string
}

export function fetchOperatorBilling(): Promise<OperatorBillingOverview> {
  return operatorRequest('/operator/billing')
}

export function fetchBillingTenant(
  id: string,
): Promise<{ tenant: BillingTenant; ledger: LedgerEntry[]; ledger_has_more: boolean }> {
  return operatorRequest(`/operator/billing/tenants/${encodeURIComponent(id)}`)
}

export async function adjustTenantCredits(
  tenantId: string,
  amount: number,
  reason: string,
): Promise<number> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(
    `${base}/operator/billing/tenants/${encodeURIComponent(tenantId)}/adjust-credits`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ amount, reason }),
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Adjustment failed')
  throwIfPendingApproval(data)
  return (data as { credits_balance: number }).credits_balance
}

// ── Operator: Billing setup (Stripe config as code) ───────────────────────

export interface StripeSetupAction {
  object: 'product' | 'price' | 'webhook' | 'portal'
  key: string
  op: 'create' | 'update' | 'replace' | 'noop' | 'skipped'
  details: string[]
}

export interface StripeSetupReconcile {
  mode: 'test' | 'live' | 'unknown'
  applied: boolean
  drift: boolean
  actions: StripeSetupAction[]
  errors: Array<{ object: string; key: string; message: string }>
  ids: { product?: string; prices: Record<string, string>; webhook?: string; portal?: string }
}

export interface StripeSetupStatus {
  configured: boolean
  mode: 'test' | 'live' | 'unknown'
  key_kind: 'restricted' | 'secret' | 'none'
  key_warning: string | null
  webhook: {
    last_event_at: string | null
    last_event_type: string | null
    completed_24h: number
    failed_24h: number
    recent_failures: Array<{
      event_id: string
      event_type: string
      failed_at?: string
      error?: string
    }>
  }
  reconcile: StripeSetupReconcile | null
}

/** Thrown for 409s that ask the operator to confirm something explicitly. */
export class StripeSetupConfirmError extends Error {
  constructor(
    message: string,
    readonly code: 'confirm_live_required' | 'confirm_price_change_required' | string,
    readonly reconcile?: StripeSetupReconcile,
  ) {
    super(message)
  }
}

export function fetchStripeSetup(): Promise<StripeSetupStatus> {
  return operatorRequest('/operator/billing/stripe')
}

export async function reconcileStripeSetup(input: {
  reason: string
  apply: boolean
  confirm_live?: boolean
  confirm_price_change?: boolean
}): Promise<StripeSetupReconcile> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/billing/stripe/reconcile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 409 && typeof data.code === 'string') {
    throw new StripeSetupConfirmError(data.error as string, data.code, data.reconcile)
  }
  if (!res.ok) throw new Error((data.error as string) || 'Stripe setup request failed')
  return data as StripeSetupReconcile
}

// ── Public lead capture ───────────────────────────────────────────────────

export async function captureLead(
  input: {
    email: string
    name?: string
    source: string
    score_band?: string
  },
  turnstileToken?: string | null,
): Promise<boolean> {
  try {
    captureAttribution()
    const attribution = getAttribution()
    const res = await credFetch(`${getApiBase()}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...turnstileHeaders(turnstileToken) },
      body: JSON.stringify({
        ...input,
        consent_marketing: true,
        ...(attribution ? { attribution } : {}),
      }),
    })
    return res.ok
  } catch (err) {
    reportError(err, { path: '/leads' })
    return false
  }
}

// ── Support channel (user-facing + operator inbox) ────────────────────────

export interface SupportMessage {
  id: string
  author: 'user' | 'operator' | 'keel'
  author_id?: string
  author_name?: string
  text: string
  created_at: string
}

export interface SupportCase {
  id: string
  subject: string
  status: 'open' | 'answered' | 'resolved'
  ai_triaged: boolean
  email?: string
  user_id?: string
  tenant_id?: string
  messages: SupportMessage[]
  created_at: string
  updated_at: string
}

async function supportRequest<T>(
  path: string,
  method = 'GET',
  body?: Record<string, unknown>,
): Promise<T> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Request failed')
  return data as T
}

/** AI triage — Keel answers product/account questions before a case exists. */
export function askSupport(question: string): Promise<{ answer: string; isLive: boolean }> {
  return supportRequest('/support/ask', 'POST', { question })
}

export function createSupportCase(
  subject: string,
  message: string,
  triage?: { question: string; answer: string }[],
): Promise<{ case: SupportCase }> {
  return supportRequest('/support/cases', 'POST', {
    subject,
    message,
    ...(triage?.length ? { triage } : {}),
  })
}

export function fetchMySupportCases(): Promise<{ cases: SupportCase[] }> {
  return supportRequest('/support/cases')
}

export function fetchMySupportCase(id: string): Promise<{ case: SupportCase }> {
  return supportRequest(`/support/cases/${encodeURIComponent(id)}`)
}

export function replyToMyCase(id: string, text: string): Promise<{ ok: boolean }> {
  return supportRequest(`/support/cases/${encodeURIComponent(id)}/messages`, 'POST', { text })
}

// Operator inbox
export interface OperatorCaseDetail {
  case: SupportCase
  user?: { id: string; email: string; name: string; status?: string; created_at: string } | null
  tenant?: { tenant_id: string; name?: string; plan?: string; status?: string } | null
  member_count: number
}

export function fetchOperatorSupportCases(
  query: { q?: string; status?: string; cursor?: string; limit?: number } = {},
): Promise<{
  cases: SupportCase[]
  total?: number
  next_cursor?: string
  statuses: Record<string, number>
}> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  return operatorRequest(`/operator/support${params.size ? `?${params}` : ''}`)
}

export function fetchOperatorSupportCase(id: string): Promise<OperatorCaseDetail> {
  return operatorRequest(`/operator/support/${encodeURIComponent(id)}`)
}

export async function replyOperatorCase(id: string, text: string): Promise<void> {
  const base = getApiBase()
  const token = getAuthToken()
  const res = await credFetch(`${base}/operator/support/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data.error as string) || 'Reply failed')
}

export const resolveOperatorCase = (id: string, reason: string) =>
  operatorAction(`/operator/support/${id}/resolve`, reason)
export const reopenOperatorCase = (id: string, reason: string) =>
  operatorAction(`/operator/support/${id}/reopen`, reason)

/** AI-drafted operator reply — proposal only, never sent without the
 *  operator editing and submitting it themselves. */
export function draftOperatorReply(id: string): Promise<{ draft: string }> {
  const base = getApiBase()
  const token = getAuthToken()
  return credFetch(`${base}/operator/support/${encodeURIComponent(id)}/draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: '{}',
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data.error as string) || 'Draft failed')
    return data as { draft: string }
  })
}

/** PRD-220: owner-generated emergency sheet — opt-in sections only. */
export interface SheetSectionView {
  id: string
  title: string
  items: { label: string; detail?: string }[]
}
export async function previewEmergencySheet(
  sections: string[],
): Promise<{ sections: SheetSectionView[] }> {
  const res = await credFetch(`${getApiBase()}/family/emergency-sheet/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify({ sections }),
  })
  if (!res.ok) throw new Error('Could not build the sheet')
  return res.json()
}

/** Referral link variants: campaign distinguishes which artefact brought the visit. */
export function referralLink(code: string, campaign: 'sheet' | 'invite'): string {
  return `${window.location.origin}/signup?ref=${encodeURIComponent(code)}&utm_source=referral&utm_medium=social&utm_campaign=${campaign}`
}

/** PRD-219: operator instruction -> LLM rewrite of a draft (draft/failed only). */
export async function refineMarketingPost(
  postId: string,
  instruction: string,
): Promise<{ post: { id: string; content: string } }> {
  const res = await credFetch(
    `${getApiBase()}/marketing/posts/${encodeURIComponent(postId)}/refine`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({ instruction }),
    },
  )
  if (!res.ok)
    throw new Error(
      ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Refine failed',
    )
  return res.json()
}
