/** Wire types for /keel/*. Mirrors apps/api/src/keel-agent/orchestrator.ts and setup-state.ts. */

export type StepStatus =
  'done' | 'partial' | 'not_started' | 'not_applicable' | 'waiting_on_other' | 'blocked' | 'unknown'

export interface SetupStep {
  id: string
  title: string
  status: StepStatus
  reason_code?: string
  route_key: string
  anchor?: string
  est_minutes: number
  can_act: boolean
  hint?: string
}

export interface SetupState {
  bootstrap: boolean
  role: 'organizer' | 'editor' | 'viewer' | 'child' | 'none'
  completed: number
  total: number
  verified_complete: boolean
  next_step_id: string | null
  steps: SetupStep[]
  data_as_of: string
}

export interface SetupChecklistCard {
  kind: 'setup_checklist'
  completed: number
  total: number
  verified_complete: boolean
  next_step_id: string | null
  steps: Array<{ id: string; title: string; status: StepStatus; hint?: string; route_key: string }>
}
export interface NavCard {
  kind: 'navigate'
  route_key: string
  label: string
  anchor?: string
}
export interface ProposalCard {
  kind: 'proposal'
  proposal_id: string
  title: string
  changes: Array<{ key: string; label: string; from: string; to: string }>
  expires_at: string
}
export type KeelCard = SetupChecklistCard | NavCard | ProposalCard

export type KeelRoute =
  | 'emergency'
  | 'quarantined'
  | 'minor'
  | 'bootstrap'
  | 'setup'
  | 'help'
  | 'preset'
  | 'llm'
  | 'verified'
  | 'fallback'

export type KeelEvent =
  | { type: 'status'; label: 'checking_setup' | 'reading_records' }
  | { type: 'card'; card: KeelCard }
  | { type: 'text'; content: string }
  | { type: 'provenance'; sources: Array<{ label: string }>; data_as_of: string }
  | { type: 'done'; route: KeelRoute; is_live: boolean; thread_id?: string }
  | { type: 'error'; code: 'unavailable' | 'access_changed' | 'rate_limited' | 'signed_out' }

export interface KeelMessage {
  id: string
  role: 'user' | 'keel'
  content: string
  cards: KeelCard[]
  route?: KeelRoute
  isLive?: boolean
  dataAsOf?: string
  error?: Extract<KeelEvent, { type: 'error' }>['code']
  /** Set while the reply is still arriving. */
  pending?: boolean
  /** The question that produced an error, so Retry can resend it. */
  retryOf?: string
}

export interface PageContext {
  route: string
  step?: string
  anchors: string[]
}

export interface ThreadSummary {
  id: string
  title: string
  last_active_at: string
}
