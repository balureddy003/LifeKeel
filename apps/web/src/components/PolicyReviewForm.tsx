'use client'

import { Loader2, AlertCircle } from 'lucide-react'
import { GlassButton } from '@/components/Glass'
import { POLICY_TYPE_LABELS, POLICY_TYPES, PERSON_SCOPED_POLICY_TYPES } from '@/lib/policyTypes'
import type { PolicyType } from '@/lib/api'

export interface PolicyDraft {
  type: PolicyType
  provider: string
  coverageAmount: string
  monthlyPremium: string
  renewalDate: string
  policyNumber: string
  memberId: string
  // Claims/24-7-assistance line — display and tel:/mailto: only in the
  // playbook later, never dialed or sent automatically. Often prefilled
  // from a scanned document/email, always user-editable.
  contactPhone: string
  contactEmail: string
}

/**
 * The "review Oak's suggestion, then confirm" form for turning a policy
 * (found in a document or an email) into a real Financial Profile entry.
 * Field-for-field the same as the document-detail page's own version —
 * kept as a separate component (not shared with it) so it's additive: the
 * already-live, just-verified document flow is untouched.
 */
export function PolicyReviewForm({
  draft,
  onChange,
  onSubmit,
  submitting,
  error,
  members,
  submitLabel = 'Add to Financial Profile',
}: {
  draft: PolicyDraft
  onChange: (draft: PolicyDraft) => void
  onSubmit: () => void
  submitting: boolean
  error: string | null
  members: { id: string; name: string }[]
  submitLabel?: string
}) {
  return (
    <>
      <div className="space-y-3 mb-4">
        <label className="block">
          <div className="text-xs text-ink-tertiary mb-1.5">Policy type</div>
          <select
            value={draft.type}
            onChange={(e) => onChange({ ...draft, type: e.target.value as PolicyType })}
            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          >
            {POLICY_TYPES.map((t) => (
              <option key={t} value={t}>{POLICY_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        {PERSON_SCOPED_POLICY_TYPES.has(draft.type) && members.length > 0 && (
          <label className="block">
            <div className="text-xs text-ink-tertiary mb-1.5">Who is this policy for?</div>
            <select
              value={draft.memberId}
              onChange={(e) => onChange({ ...draft, memberId: e.target.value })}
              className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
            >
              <option value="">The whole household / not sure</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <div className="text-xs text-ink-tertiary mb-1.5">Provider</div>
          <input
            type="text"
            value={draft.provider}
            onChange={(e) => onChange({ ...draft, provider: e.target.value })}
            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs text-ink-tertiary mb-1.5">Coverage amount</div>
            <input
              type="text"
              inputMode="numeric"
              value={draft.coverageAmount}
              onChange={(e) => onChange({ ...draft, coverageAmount: e.target.value })}
              placeholder="0 if none"
              className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
            />
          </label>
          <label className="block">
            <div className="text-xs text-ink-tertiary mb-1.5">Monthly premium</div>
            <input
              type="text"
              inputMode="numeric"
              value={draft.monthlyPremium}
              onChange={(e) => onChange({ ...draft, monthlyPremium: e.target.value })}
              placeholder="0 if none"
              className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
            />
          </label>
        </div>
        <label className="block">
          <div className="text-xs text-ink-tertiary mb-1.5">Policy number (if known)</div>
          <input
            type="text"
            value={draft.policyNumber}
            onChange={(e) => onChange({ ...draft, policyNumber: e.target.value })}
            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <label className="block">
          <div className="text-xs text-ink-tertiary mb-1.5">Renewal date (if known)</div>
          <input
            type="date"
            value={draft.renewalDate}
            onChange={(e) => onChange({ ...draft, renewalDate: e.target.value })}
            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs text-ink-tertiary mb-1.5">Claims/assistance phone</div>
            <input
              type="tel"
              value={draft.contactPhone}
              onChange={(e) => onChange({ ...draft, contactPhone: e.target.value })}
              placeholder="If known"
              className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
            />
          </label>
          <label className="block">
            <div className="text-xs text-ink-tertiary mb-1.5">Claims/assistance email</div>
            <input
              type="email"
              value={draft.contactEmail}
              onChange={(e) => onChange({ ...draft, contactEmail: e.target.value })}
              placeholder="If known"
              className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
            />
          </label>
        </div>
        <div className="text-[11px] text-ink-tertiary -mt-1">
          Shown in your emergency playbooks so the family can call or email fast — Oak never contacts anyone for you.
        </div>
      </div>
      {error && (
        <div role="status" aria-live="polite" className="flex items-start gap-2 mb-3 text-xs text-danger">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      <GlassButton onClick={onSubmit} disabled={submitting || !draft.provider.trim()}>
        {submitting ? <Loader2 size={18} className="animate-spin" /> : submitLabel}
      </GlassButton>
    </>
  )
}
