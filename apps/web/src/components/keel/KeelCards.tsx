'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, CircleDashed, Clock, HelpCircle, Lock, MinusCircle } from 'lucide-react'
import { confirmProposal, dismissProposal } from '@/lib/keel/client'
import { resolveRouteKey } from '@/lib/keel/routes'
import { requestSpotlight } from '@/lib/keel/spotlight'
import type { NavCard, ProposalCard, SetupChecklistCard, StepStatus } from '@/lib/keel/types'

const STATUS: Record<StepStatus, { label: string; icon: typeof Check; tone: string }> = {
  done: { label: 'Done', icon: Check, tone: 'text-success' },
  partial: { label: 'Started', icon: CircleDashed, tone: 'text-warning' },
  not_started: { label: 'To do', icon: CircleDashed, tone: 'text-ink-tertiary' },
  not_applicable: { label: 'Not needed', icon: MinusCircle, tone: 'text-ink-tertiary' },
  waiting_on_other: { label: 'Waiting on someone', icon: Clock, tone: 'text-ink-tertiary' },
  blocked: { label: 'Needs an organizer or editor', icon: Lock, tone: 'text-ink-tertiary' },
  unknown: { label: "Couldn't check", icon: HelpCircle, tone: 'text-warning' },
}

/** A real link, so middle-click and screen-reader link lists work. Unknown keys render nothing. */
export function NavChip({ card, onNavigate }: { card: NavCard; onNavigate?: () => void }) {
  const href = resolveRouteKey(card.route_key)
  if (!href) return null
  return (
    <Link
      href={href}
      onClick={() => {
        onNavigate?.()
        requestSpotlight(card.anchor)
      }}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-family-500 px-4 text-sm font-semibold text-[rgb(var(--on-cta))]"
    >
      {card.label}
      <ArrowRight size={14} aria-hidden />
    </Link>
  )
}

export function SetupChecklist({
  card,
  onNavigate,
}: {
  card: SetupChecklistCard
  onNavigate?: () => void
}) {
  const [all, setAll] = useState(false)
  const open = card.steps.filter((s) => s.status === 'not_started' || s.status === 'partial')
  const shown = all ? card.steps : open.slice(0, 3)
  return (
    <div
      className="mt-2 rounded-xl border border-ink-tertiary/15 p-3"
      data-testid="setup-checklist"
    >
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-ink-primary">
          Setup {card.completed} of {card.total}
        </span>
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="font-semibold text-family-400"
        >
          {all ? 'Show less' : 'View setup'}
        </button>
      </div>
      <ul className="space-y-1.5">
        {shown.map((s) => {
          const st = STATUS[s.status]
          const Icon = st.icon
          const href = resolveRouteKey(s.route_key)
          const actionable = href && (s.status === 'not_started' || s.status === 'partial')
          return (
            <li key={s.id} className="flex items-start gap-2 text-sm">
              <Icon size={15} className={`mt-0.5 flex-shrink-0 ${st.tone}`} aria-hidden />
              <span className="min-w-0 flex-1">
                {actionable ? (
                  <Link
                    href={href}
                    onClick={() => onNavigate?.()}
                    className="underline underline-offset-2"
                  >
                    {s.title}
                  </Link>
                ) : (
                  s.title
                )}
                <span className="ml-1 text-xs text-ink-tertiary">· {st.label}</span>
                {s.hint && <span className="block text-xs text-ink-tertiary">{s.hint}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

type ProposalState =
  'idle' | 'applying' | 'applied' | 'dismissed' | 'conflict' | 'forbidden' | 'failed' | 'gone'

const PROPOSAL_MESSAGE: Record<ProposalState, string> = {
  idle: '',
  applying: 'Applying…',
  applied: 'Done. You can change these in Settings at any time.',
  dismissed: 'Okay, nothing was changed.',
  conflict: 'Your settings changed since this was prepared. Ask Keel again for a fresh one.',
  forbidden: 'Only the household organizer can apply this.',
  failed: "That didn't go through. Nothing was changed. Try again in a moment.",
  gone: 'This suggestion is no longer available. Ask Keel again for a fresh one.',
}

/** Tier 1: Keel prepared it; nothing changes until this person presses Apply. */
export function Proposal({ card, onApplied }: { card: ProposalCard; onApplied?: () => void }) {
  // A card reloaded from history may be long past its 15 minutes; the server would refuse it anyway.
  const [state, setState] = useState<ProposalState>(() =>
    Date.parse(card.expires_at) <= Date.now() ? 'gone' : 'idle',
  )
  const showActions = state === 'idle' || state === 'applying' || state === 'failed'

  const apply = async () => {
    setState('applying')
    const out = await confirmProposal(card.proposal_id)
    setState(out)
    if (out === 'applied') onApplied?.()
  }
  const dismiss = async () => {
    await dismissProposal(card.proposal_id)
    setState('dismissed')
  }

  return (
    <div className="mt-2 rounded-xl border border-ink-tertiary/15 p-3" data-testid="proposal">
      <p className="text-sm font-semibold text-ink-primary">{card.title}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {card.changes.map((c) => (
          <li key={c.key}>
            {c.label}: <span className="text-ink-tertiary line-through">{c.from}</span>{' '}
            <span aria-hidden>→</span> <strong>{c.to}</strong>
          </li>
        ))}
      </ul>
      {showActions && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void apply()}
            disabled={state === 'applying'}
            className="min-h-[44px] rounded-full bg-family-500 px-4 text-sm font-semibold text-[rgb(var(--on-cta))] disabled:opacity-50"
          >
            Apply these settings
          </button>
          <button
            type="button"
            onClick={() => void dismiss()}
            disabled={state === 'applying'}
            className="min-h-[44px] rounded-full px-4 text-sm font-semibold text-ink-secondary disabled:opacity-50"
          >
            Not now
          </button>
        </div>
      )}
      {state !== 'idle' && (
        <p role="status" className="mt-2 text-xs text-ink-tertiary">
          {PROPOSAL_MESSAGE[state]}
        </p>
      )}
    </div>
  )
}

export function Provenance({ dataAsOf }: { dataAsOf: string }) {
  const time = new Date(dataAsOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return <p className="mt-2 text-[11px] text-ink-tertiary">From your saved records, as of {time}</p>
}
