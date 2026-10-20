'use client'

/**
 * PRD-143 review screen: each value Keel read, next to the quote it came from,
 * with confirm, edit and reject. Nothing is saved to the profile until a
 * person confirms it, and the server enforces that; this screen is how they
 * do it. A value Keel could not find in the document's own text, or read from
 * an image, is marked as needing a check rather than shown as certain.
 */
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertCircle, Check, Pencil, X } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { CATEGORY_LABELS } from '@/lib/document-categories'
import {
  confirmDocumentType,
  reviewDocumentFields,
  type DocumentCandidate,
  type FamilyDocumentDetail,
  type ReviewDecision,
} from '@/lib/api'
import {
  FIELD_LABELS,
  FIRST_ADDED,
  GROUNDING_TEXT,
  NO_FIELDS_TEXT,
  READ_FAILED_TEXT,
  READ_FAILED_TITLE,
  REVIEW_INTRO,
  REVIEW_TITLE,
  SAVE_HINT,
  SCAN_FAILED_TEXT,
  TYPE_CARD_TEXT,
  TYPE_CARD_TITLE,
  documentAgeText,
} from '@/lib/extraction-review-copy'

const TYPES = ['insurance', 'pension', 'mortgage', 'income', 'investment', 'tax', 'will', 'other']

export interface ExtractionReviewApi {
  confirmType: typeof confirmDocumentType
  review: typeof reviewDocumentFields
}
const realApi: ExtractionReviewApi = {
  confirmType: confirmDocumentType,
  review: reviewDocumentFields,
}

/** The quote with the value picked out, so the eye lands on what Keel read. */
function Quote({ snippet, value }: { snippet: string; value: string }) {
  const at = snippet.toLowerCase().indexOf(value.toLowerCase())
  if (at < 0) return <>{snippet}</>
  return (
    <>
      {snippet.slice(0, at)}
      <mark className="bg-family-500/20 text-ink-primary rounded px-0.5">
        {snippet.slice(at, at + value.length)}
      </mark>
      {snippet.slice(at + value.length)}
    </>
  )
}

function FieldRow({
  field,
  busy,
  onDecide,
}: {
  field: DocumentCandidate
  busy: boolean
  onDecide: (d: ReviewDecision) => Promise<string | null>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(field.edited_value ?? field.value)
  const [error, setError] = useState<string | null>(null)
  const label = FIELD_LABELS[field.key] ?? field.key
  const shown = field.status === 'edited' && field.edited_value ? field.edited_value : field.value
  const checkNeeded = field.needs_review && field.status === 'proposed'

  async function decide(d: ReviewDecision) {
    setError(null)
    const problem = await onDecide(d)
    if (problem) setError(problem)
    else setEditing(false)
  }

  return (
    <li
      className={`rounded-xl border p-3 ${checkNeeded ? 'border-warning/30 bg-warning/5' : 'border-tint/[0.08]'}`}
      data-status={field.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-tertiary">{label}</div>
          {editing ? (
            <input
              aria-label={`Edit ${label}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="glass-input mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-primary"
            />
          ) : (
            <div
              className={`text-sm font-medium ${field.status === 'rejected' ? 'line-through text-ink-tertiary' : 'text-ink-primary'}`}
            >
              {shown}
            </div>
          )}
        </div>
        <span className="flex-shrink-0 text-[11px] text-ink-tertiary" aria-label="Status">
          {field.status === 'confirmed' && 'Confirmed'}
          {field.status === 'edited' && 'Edited by you'}
          {field.status === 'rejected' && 'Rejected'}
          {checkNeeded && 'Needs your check'}
        </span>
      </div>

      {field.snippet ? (
        <p className="mt-2 text-xs text-ink-secondary leading-relaxed">
          <span className="text-ink-tertiary">From the document: </span>“
          <Quote snippet={field.snippet} value={field.value} />”
        </p>
      ) : null}
      <p className={`mt-1 text-[11px] ${checkNeeded ? 'text-warning' : 'text-ink-tertiary'}`}>
        {GROUNDING_TEXT[field.grounding]}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {editing ? (
          <>
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => decide({ key: field.key, action: 'edit', value: draft.trim() })}
              className="rounded-lg bg-family-500/20 border border-family-500/30 px-2.5 py-1 text-xs font-semibold text-family-300 disabled:opacity-50"
            >
              Save edit
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
              className="rounded-lg bg-tint/[0.04] border border-tint/[0.08] px-2.5 py-1 text-xs text-ink-secondary"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || field.status === 'confirmed'}
              onClick={() => decide({ key: field.key, action: 'confirm' })}
              className="flex items-center gap-1 rounded-lg bg-family-500/20 border border-family-500/30 px-2.5 py-1 text-xs font-semibold text-family-300 disabled:opacity-50"
            >
              <Check size={12} /> Confirm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded-lg bg-tint/[0.04] border border-tint/[0.08] px-2.5 py-1 text-xs text-ink-secondary disabled:opacity-50"
            >
              <Pencil size={12} /> Edit
            </button>
            <button
              type="button"
              disabled={busy || field.status === 'rejected'}
              onClick={() => decide({ key: field.key, action: 'reject' })}
              className="flex items-center gap-1 rounded-lg bg-tint/[0.04] border border-tint/[0.08] px-2.5 py-1 text-xs text-ink-secondary disabled:opacity-50"
            >
              <X size={12} /> Reject
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  )
}

export function ExtractionReview({
  doc,
  onChange,
  api = realApi,
  now,
}: {
  doc: FamilyDocumentDetail
  /** Receives the updated document after a type confirmation or a review. */
  onChange: (next: FamilyDocumentDetail) => void
  api?: ExtractionReviewApi
  now?: Date
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [typeChoice, setTypeChoice] = useState(doc.classification?.category ?? doc.category)
  const [typeError, setTypeError] = useState<string | null>(null)
  const candidates = doc.candidates ?? []

  // Nothing readable: say so, offer manual entry, and never imply anything was saved.
  if (doc.scan === 'error' || doc.status === 'error') {
    return (
      <GlassCard className="p-4 border-warning/20">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-warning flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-ink-primary">{READ_FAILED_TITLE}</div>
            <p className="text-xs text-ink-secondary mt-1">
              {doc.scan === 'error' ? SCAN_FAILED_TEXT : READ_FAILED_TEXT}
            </p>
            <Link
              href="/financial-profile"
              className="inline-block mt-2 text-xs font-semibold text-family-400"
            >
              Enter the details myself
            </Link>
          </div>
        </div>
      </GlassCard>
    )
  }

  const needsType = doc.classification?.needs_confirmation && !doc.classification.confirmed
  if (needsType) {
    return (
      <GlassCard className="p-4">
        <div className="text-sm font-semibold text-ink-primary">{TYPE_CARD_TITLE}</div>
        <p className="text-xs text-ink-secondary mt-1">{TYPE_CARD_TEXT}</p>
        <label className="block mt-3 text-xs text-ink-tertiary" htmlFor="doc-type">
          Document type
        </label>
        <select
          id="doc-type"
          value={typeChoice}
          onChange={(e) => setTypeChoice(e.target.value)}
          className="glass-input mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink-primary"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {CATEGORY_LABELS[t] ?? t}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setTypeError(null)
            const r = await api.confirmType(doc.id, typeChoice)
            setBusy(false)
            if (!r.ok) return setTypeError(r.error)
            onChange({
              ...doc,
              category: typeChoice,
              classification: { ...doc.classification!, category: typeChoice, confirmed: true },
            })
          }}
          className="mt-3 rounded-lg bg-family-500/20 border border-family-500/30 px-3 py-1.5 text-xs font-semibold text-family-300 disabled:opacity-50"
        >
          This is a {CATEGORY_LABELS[typeChoice]?.toLowerCase() ?? typeChoice} document
        </button>
        {typeError && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {typeError}
          </p>
        )}
      </GlassCard>
    )
  }

  if (doc.status === 'extracted' && candidates.length === 0) {
    return (
      <GlassCard className="p-4">
        <p className="text-sm text-ink-secondary">{NO_FIELDS_TEXT}</p>
        <Link
          href="/financial-profile"
          className="inline-block mt-2 text-xs font-semibold text-family-400"
        >
          Enter the details myself
        </Link>
      </GlassCard>
    )
  }
  if (candidates.length === 0) return null

  const needCheck = candidates.filter((c) => c.needs_review && c.status === 'proposed').length
  const age = documentAgeText(doc.documentDate, now)

  async function decide(d: ReviewDecision): Promise<string | null> {
    setBusy(true)
    const r = await api.review(doc.id, [d])
    setBusy(false)
    if (!r.ok) return r.error
    onChange({ ...doc, candidates: r.candidates })
    return null
  }

  return (
    <GlassCard className="p-4">
      <div className="text-sm font-semibold text-ink-primary">{REVIEW_TITLE}</div>
      <p className="text-xs text-ink-secondary mt-1 leading-relaxed">{REVIEW_INTRO}</p>
      {age && <p className="text-xs text-ink-tertiary mt-1">{age}</p>}
      <p
        className={`text-xs mt-2 ${needCheck > 0 ? 'text-warning font-medium' : 'text-ink-tertiary'}`}
        role="status"
      >
        {FIRST_ADDED(needCheck, candidates.length)}
      </p>
      <ul className="mt-3 space-y-2.5">
        {candidates.map((c) => (
          <FieldRow key={c.key} field={c} busy={busy} onDecide={decide} />
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-ink-tertiary">{SAVE_HINT}</p>
    </GlassCard>
  )
}
