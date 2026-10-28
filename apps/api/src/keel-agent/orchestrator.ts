/**
 * One Keel turn. Order matters (flow chart §8 in AI_AGENT_INLINE_CHATBOX.md):
 *
 *   emergency / special-category / health hint  -> governed /assistant/ask, untouched
 *   minor                                       -> fixed notice, no household data
 *   no family yet (bootstrap)                   -> static guidance only, no household reads
 *   setup_next | preset | how_to                -> deterministic, no model call
 *   open                                        -> governed /assistant/ask, then a delivery check
 *
 * Setup, help and presets are built by code from saved records and reviewed
 * text, so the same question always gets the same honest answer even when
 * every AI provider is down. Everything model-generated comes from the
 * existing governed assistant pipeline (task gateway, guards, quarantine).
 */
import type { Db } from 'mongodb'
import { containsSpecialCategoryContent, detectEmergency } from '@lifekeel/platform'
import type { KeelContext , buildKeelContext, type AuthIdentity } from './context.js'
import { classifyIntent } from './intent.js'
import { renderHelp } from './help.js'
import {
  currentNotificationSettings,
  diffSettings,
  pickPreset,
  type SettingChange,
} from './presets.js'
import { createProposal } from './proposals.js'
import type { RouteKey } from './route-keys.js'
import { STEP_TITLES, type SetupState, type StepId, type StepStatus } from './setup-state.js'
import { bindTools } from './tools.js'

export interface SetupChecklistCard {
  kind: 'setup_checklist'
  completed: number
  total: number
  verified_complete: boolean
  next_step_id: StepId | null
  steps: Array<{
    id: StepId
    title: string
    status: StepStatus
    hint?: string
    route_key: RouteKey
  }>
}
export interface NavCard {
  kind: 'navigate'
  route_key: RouteKey
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

export type KeelAnswerRoute =
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
  | { type: 'done'; route: KeelAnswerRoute; is_live: boolean; thread_id?: string }
  | { type: 'error'; code: 'unavailable' | 'access_changed' }

export interface AssistantReply {
  content: string
  isLive: boolean
  emergency?: boolean
  verified?: boolean
  quarantined?: boolean
  data_as_of?: string
}

export interface TurnInput {
  message: string
  route?: string
  member_id?: string
  medical_hint?: boolean
}

export interface TurnDeps {
  db: Db
  auth: AuthIdentity
  /** The governed Ask Keel pipeline (verified answers, quarantine, gateway). */
  askAssistant: (input: TurnInput) => Promise<AssistantReply>
}

export interface TurnOutcome {
  route: KeelAnswerRoute
  /** Text and cards worth saving to history; undefined when nothing should be stored. */
  transcript?: { content: string; cards: KeelCard[]; data_as_of: string }
}

const MINOR_NOTICE =
  "Keel's setup guide is for the adults in your household. A parent or guardian can walk you through it."
const BOOTSTRAP_HELP =
  'Welcome. The first step is to create your household, which takes about three minutes. After that I can show what is done and what comes next, step by step.'

const SETTING_LABELS: Record<string, string> = {
  digest_mode: 'Digest of routine updates',
  heartbeat_cadence: 'Check-in summary',
  min_urgency: 'Lowest urgency to notify',
}

const fmt = (v: unknown): string =>
  v === true ? 'On' : v === false ? 'Off' : String(v).replace(/_/g, ' ')

function checklistCard(state: SetupState): SetupChecklistCard {
  return {
    kind: 'setup_checklist',
    completed: state.completed,
    total: state.total,
    verified_complete: state.verified_complete,
    next_step_id: state.next_step_id,
    steps: state.steps.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      route_key: s.route_key,
      ...(s.hint ? { hint: s.hint } : {}),
    })),
  }
}

function setupText(state: SetupState): string {
  const lines: string[] = []
  if (state.role === 'viewer') {
    lines.push(
      "You can follow your household's progress here. Changes are made by an organizer or editor.",
    )
  }
  lines.push(`You've finished **${state.completed} of ${state.total}** setup steps.`)

  const waiting = state.steps.filter((s) => s.status === 'waiting_on_other')
  for (const s of waiting) lines.push(`Waiting on someone else: ${s.title.toLowerCase()}.`)

  const unknown = state.steps.filter((s) => s.status === 'unknown')
  if (unknown.length > 0) {
    lines.push(
      `I couldn't check ${unknown.length === 1 ? 'one step' : `${unknown.length} steps`} just now, so I'm not counting ${unknown.length === 1 ? 'it' : 'them'} as done or missing.`,
    )
  }

  const next = state.steps.find((s) => s.id === state.next_step_id)
  if (next) {
    const why =
      next.reason_code === 'missing_date_of_birth'
        ? ' Some children have no date of birth yet.'
        : next.reason_code === 'needs_review'
          ? ' A document is uploaded but not reviewed yet.'
          : ''
    lines.push(`**Next:** ${next.title} (about ${next.est_minutes} min).${why}`)
    const after = state.steps.filter((s) => state.next_step_ids.includes(s.id) && s.id !== next.id)
    if (after.length > 0)
      lines.push(`After that: ${after.map((s) => s.title.toLowerCase()).join('; ')}.`)
  } else if (state.verified_complete) {
    lines.push(
      'Everything I can check for your household is set up. Review it each year, or after a big life change.',
    )
  } else {
    const blocked = state.steps.filter((s) => s.status === 'blocked')
    if (blocked.length > 0)
      lines.push('The remaining steps can be done by your household organizer or an editor.')
  }
  return lines.join('\n\n')
}

export async function runTurn(
  deps: TurnDeps,
  input: TurnInput,
  emit: (e: KeelEvent) => void,
): Promise<TurnOutcome> {
  const { db } = deps
  const ctx: KeelContext = await buildKeelContext(db, deps.auth)
  const tools = bindTools(ctx, db)
  const done = (route: KeelAnswerRoute, isLive: boolean) =>
    emit({ type: 'done', route, is_live: isLive })

  // 1-2. Safety first: emergencies, health-bearing and special-category questions go straight to the
  // governed assistant, which short-circuits or quarantines them before any data is loaded.
  const sensitive =
    detectEmergency(input.message) !== null ||
    input.medical_hint === true ||
    containsSpecialCategoryContent(input.message)
  if (sensitive) return delegate(deps, ctx, input, emit, { store: false })

  // 3. Minors get a fixed notice and no household data.
  if (ctx.isMinor) {
    emit({ type: 'text', content: MINOR_NOTICE })
    done('minor', false)
    return { route: 'minor' }
  }

  const intent = classifyIntent(input.message, input.route)

  // 4. Bootstrap: no active household yet. Static guidance only; no household reads.
  if (!ctx.hasFamily) {
    const state = await tools.setupGetState({})
    emit({ type: 'card', card: checklistCard(state) })
    emit({
      type: 'card',
      card: { kind: 'navigate', route_key: 'family-setup', label: 'Create your household' },
    })
    emit({ type: 'text', content: BOOTSTRAP_HELP })
    done('bootstrap', false)
    return { route: 'bootstrap' }
  }

  if (intent === 'setup_next') {
    emit({ type: 'status', label: 'checking_setup' })
    const state = await tools.setupGetState({})
    const cards: KeelCard[] = [checklistCard(state)]
    const next = state.steps.find((s) => s.id === state.next_step_id)
    if (next)
      cards.push({
        kind: 'navigate',
        route_key: next.route_key,
        label: `Open: ${next.title}`,
        ...(next.anchor ? { anchor: next.anchor } : {}),
      })
    const content = setupText(state)
    for (const card of cards) emit({ type: 'card', card })
    emit({ type: 'text', content })
    emit({
      type: 'provenance',
      sources: [{ label: 'Your saved household records' }],
      data_as_of: state.data_as_of,
    })
    done('setup', false)
    return { route: 'setup', transcript: { content, cards, data_as_of: state.data_as_of } }
  }

  if (intent === 'how_to') {
    const match = await tools.helpSearch({
      query: input.message,
      ...(input.route ? { route: input.route } : {}),
    })
    if (match) {
      const content = renderHelp(match.topic)
      const cards: KeelCard[] = [
        { kind: 'navigate', route_key: match.topic.route_key, label: `Open: ${match.topic.title}` },
      ]
      for (const card of cards) emit({ type: 'card', card })
      emit({ type: 'text', content })
      done('help', false)
      return { route: 'help', transcript: { content, cards, data_as_of: new Date().toISOString() } }
    }
  }

  if (intent === 'preset') return presetTurn(deps, ctx, tools, input, emit)

  // 5. Open question: the governed assistant pipeline.
  return delegate(deps, ctx, input, emit, { store: true })
}

async function presetTurn(
  deps: TurnDeps,
  ctx: KeelContext,
  tools: ReturnType<typeof bindTools>,
  input: TurnInput,
  emit: (e: KeelEvent) => void,
): Promise<TurnOutcome> {
  const state = await tools.setupGetState({})
  const { adults, children } = state.household
  const preset = pickPreset(adults, children)

  const lines = [`**${preset.title}**`, preset.rationale]
  const stated = parseStatedShape(input.message)
  if (stated && (stated.adults !== adults || stated.children !== children)) {
    lines.push(
      `Your saved household has ${adults} ${adults === 1 ? 'adult' : 'adults'} and ${children} ${children === 1 ? 'child' : 'children'}, so I've used that. If it's out of date, update it on the Family screen.`,
    )
  }
  lines.push(
    '**Suggested order**\n' +
      preset.setup_order.map((id, i) => `${i + 1}. ${STEP_TITLES[id]}`).join('\n'),
  )
  lines.push('**Worth knowing**\n' + preset.guidance.map((g) => `- ${g}`).join('\n'))

  const cards: KeelCard[] = []
  if (ctx.isOrganizer) {
    const current = await currentNotificationSettings(deps.db, ctx)
    const diff: SettingChange[] = diffSettings(current, preset.proposable)
    const proposal = await createProposal(deps.db, ctx, preset.id, diff)
    if (proposal) {
      cards.push({
        kind: 'proposal',
        proposal_id: proposal.id,
        title: 'Notification settings for this setup',
        changes: diff.map((c) => ({
          key: c.key,
          label: SETTING_LABELS[c.key] ?? c.key,
          from: fmt(c.from),
          to: fmt(c.to),
        })),
        expires_at: proposal.expires_at.toISOString(),
      })
      lines.push(
        'I have prepared the notification settings below. Nothing changes until you review and apply them.',
      )
    } else {
      lines.push('Your notification settings already match this starting setup.')
    }
  } else {
    lines.push('Notification settings can be changed by your household organizer in Settings.')
  }
  cards.push({
    kind: 'navigate',
    route_key: 'settings.notifications',
    label: 'Open: Notification settings',
  })

  const content = lines.join('\n\n')
  for (const card of cards) emit({ type: 'card', card })
  emit({ type: 'text', content })
  emit({ type: 'done', route: 'preset', is_live: false })
  return { route: 'preset', transcript: { content, cards, data_as_of: new Date().toISOString() } }
}

function parseStatedShape(message: string): { adults: number; children: number } | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 }
  const n = (s: string) => (/^\d+$/.test(s) ? Number(s) : (words[s.toLowerCase()] ?? NaN))
  const a = /\b(\d+|one|two|three|four|five)\s+adults?\b/i.exec(message)
  const c = /\b(\d+|one|two|three|four|five)\s+(kids?|children|child)\b/i.exec(message)
  if (!a || !c) return null
  const adults = n(a[1]!)
  const children = n(c[1]!)
  return Number.isNaN(adults) || Number.isNaN(children) ? null : { adults, children }
}

async function delegate(
  deps: TurnDeps,
  ctx: KeelContext,
  input: TurnInput,
  emit: (e: KeelEvent) => void,
  opts: { store: boolean },
): Promise<TurnOutcome> {
  emit({ type: 'status', label: 'reading_records' })
  let reply: AssistantReply
  try {
    reply = await deps.askAssistant(input)
  } catch {
    emit({ type: 'error', code: 'unavailable' })
    emit({ type: 'done', route: 'fallback', is_live: false })
    return { route: 'fallback' }
  }

  // Delivery check: membership or role can change while an answer is generating.
  const after = await buildKeelContext(deps.db, deps.auth)
  if (
    after.hasFamily !== ctx.hasFamily ||
    after.isMinor !== ctx.isMinor ||
    after.isOrganizer !== ctx.isOrganizer ||
    after.isEditor !== ctx.isEditor
  ) {
    emit({ type: 'error', code: 'access_changed' })
    return { route: 'fallback' }
  }

  const route: KeelAnswerRoute = reply.emergency
    ? 'emergency'
    : reply.quarantined
      ? 'quarantined'
      : reply.verified
        ? 'verified'
        : reply.isLive
          ? 'llm'
          : 'fallback'
  const asOf = reply.data_as_of ?? new Date().toISOString()
  emit({ type: 'text', content: reply.content })
  if (reply.isLive && !reply.emergency) {
    emit({
      type: 'provenance',
      sources: [{ label: 'Your saved household records' }],
      data_as_of: asOf,
    })
  }
  emit({ type: 'done', route, is_live: reply.isLive })
  // Emergency and health-bearing exchanges are never stored.
  const store = opts.store && route !== 'emergency' && route !== 'quarantined'
  return {
    route,
    ...(store ? { transcript: { content: reply.content, cards: [], data_as_of: asOf } } : {}),
  }
}
