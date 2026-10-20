'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, AlertCircle, CheckCircle2, Sparkles, FileQuestion } from 'lucide-react'
import {
  PageHeader,
  GlassCard,
  GlassButton,
  EmptyState,
  Skeleton,
  PageTransition,
} from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useAuth } from '@/lib/auth-context'
import { CATEGORY_ICONS, CATEGORY_LABELS } from '@/lib/document-categories'
import { displayDocName } from '@/lib/doc-name'
import { POLICY_TYPE_LABELS, POLICY_TYPES, PERSON_SCOPED_POLICY_TYPES } from '@/lib/policyTypes'
import { useConfirm } from '@/components/ConfirmSheetProvider'
import { DeletionReceiptCard } from '@/components/DeletionReceiptCard'
import { DOCUMENT_DELETE_MESSAGE } from '@/lib/deletion-receipt-copy'
import {
  fetchDocument,
  fetchProfileSuggestions,
  fetchDocumentFileUrl,
  applyDocumentToProfile,
  applyPolicySuggestion,
  deleteFamilyDocument,
  type DeletionReceipt,
  type FamilyDocumentDetail,
  type ProfileSuggestion,
  type DocumentPolicySuggestion,
  type PolicyType,
} from '@/lib/api'

function money(minor: number): string {
  return `£${Math.round(minor / 100).toLocaleString()}`
}

function fieldLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface PolicyDraft {
  type: PolicyType
  provider: string
  coverageAmount: string
  monthlyPremium: string
  renewalDate: string
  policyNumber: string
  // PRD-110: '' until the user picks — never prefilled from the document.
  memberId: string
  // Claims/24-7-assistance line the document stated — display and
  // tel:/mailto: only in the crisis playbooks, never dialed or sent
  // automatically. Prefilled from OCR when the document states one.
  contactPhone: string
  contactEmail: string
}

function toPolicyDraft(s: DocumentPolicySuggestion): PolicyDraft {
  return {
    type: s.type ?? 'life',
    provider: s.provider,
    coverageAmount:
      s.coverageAmountMinor != null ? String(Math.round(s.coverageAmountMinor / 100)) : '',
    monthlyPremium:
      s.monthlyPremiumMinor != null ? String(Math.round(s.monthlyPremiumMinor / 100)) : '',
    renewalDate: s.renewalDate ?? '',
    policyNumber: s.policyNumber ?? '',
    memberId: '',
    contactPhone: s.contactPhone ?? '',
    contactEmail: s.contactEmail ?? '',
  }
}

export default function DocumentDetailClient() {
  const params = useParams<{ id: string }>()
  const { family } = useAuth()
  const [doc, setDoc] = useState<FamilyDocumentDetail | null | undefined>(undefined)
  const [suggestions, setSuggestions] = useState<ProfileSuggestion[]>([])
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<string[] | null>(null)
  const [appliedInsights, setAppliedInsights] = useState(0)
  const [policyApplying, setPolicyApplying] = useState(false)
  const [policyApplied, setPolicyApplied] = useState(false)
  const [policyAppliedInsights, setPolicyAppliedInsights] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ url: string; mimeType: string } | null | undefined>(
    undefined,
  )

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([fetchDocument(params.id), fetchProfileSuggestions(params.id)])
    setDoc(d)
    setSuggestions(s.suggestions)
    setPolicyDraft(s.policySuggestion ? toPolicyDraft(s.policySuggestion) : null)
  }, [params.id])

  useEffect(() => {
    load()
  }, [load])

  // Split-view review: the source file next to what Keel extracted from it,
  // so approving a suggestion doesn't require trusting OCR blind. Fetched
  // separately from the metadata load above since it's a binary blob, not
  // JSON — and revoked on unmount/id-change so it doesn't leak memory.
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setPreview(undefined)
    fetchDocumentFileUrl(params.id).then((p) => {
      if (cancelled) {
        if (p) URL.revokeObjectURL(p.url)
        return
      }
      objectUrl = p?.url ?? null
      setPreview(p)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [params.id])

  const confirm = useConfirm()
  const [deletion, setDeletion] = useState<DeletionReceipt | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete this document?',
      message: DOCUMENT_DELETE_MESSAGE,
      confirmLabel: 'Delete document',
      destructive: true,
    })
    if (!ok) return
    haptic('warning')
    setDeleting(true)
    setError(null)
    const result = await deleteFamilyDocument(params.id)
    setDeleting(false)
    if (result.ok && result.receipt) {
      haptic('success')
      setDeletion(result.receipt)
    } else {
      haptic('warning')
      setError(result.error ?? 'Could not delete this document')
    }
  }

  const handleApply = async () => {
    haptic('light')
    setApplying(true)
    setError(null)
    try {
      const result = await applyDocumentToProfile(params.id)
      haptic('success')
      setApplied(result.applied.map((a) => a.label))
      setAppliedInsights(result.insightsGenerated)
    } catch (err) {
      haptic('warning')
      setError(
        err instanceof Error
          ? err.message
          : 'Could not apply this document to your Financial Profile',
      )
    } finally {
      setApplying(false)
    }
  }

  const handleApplyPolicy = async () => {
    if (!policyDraft) return
    haptic('light')
    setPolicyApplying(true)
    setPolicyError(null)
    try {
      const result = await applyPolicySuggestion(params.id, {
        type: policyDraft.type,
        provider: policyDraft.provider.trim(),
        coverageAmountMinor: Math.round((Number(policyDraft.coverageAmount) || 0) * 100),
        monthlyPremiumMinor: Math.round((Number(policyDraft.monthlyPremium) || 0) * 100),
        ...(policyDraft.renewalDate ? { renewalDate: policyDraft.renewalDate } : {}),
        ...(policyDraft.policyNumber.trim()
          ? { policyNumber: policyDraft.policyNumber.trim() }
          : {}),
        ...(PERSON_SCOPED_POLICY_TYPES.has(policyDraft.type) && policyDraft.memberId
          ? { memberId: policyDraft.memberId }
          : {}),
        ...(policyDraft.contactPhone.trim()
          ? { contactPhone: policyDraft.contactPhone.trim() }
          : {}),
        ...(policyDraft.contactEmail.trim()
          ? { contactEmail: policyDraft.contactEmail.trim() }
          : {}),
      })
      haptic('success')
      setPolicyApplied(true)
      setPolicyAppliedInsights(result.insightsGenerated)
    } catch (err) {
      haptic('warning')
      setPolicyError(
        err instanceof Error ? err.message : 'Could not add this policy to your Financial Profile',
      )
    } finally {
      setPolicyApplying(false)
    }
  }

  if (doc === undefined) {
    return (
      <div className="px-5 pt-2 pb-10 space-y-4">
        <PageHeader title="Document" backHref="/upload" />
        <GlassCard className="p-4 flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-2xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </GlassCard>
        <GlassCard className="p-4 space-y-2.5">
          <Skeleton className="h-3.5 w-32 mb-1" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </GlassCard>
      </div>
    )
  }

  if (doc === null) {
    return (
      <div className="px-5 pt-2">
        <PageHeader title="Document" backHref="/upload" />
        <GlassCard>
          <EmptyState
            icon={FileQuestion}
            title="Document not found"
            description="It may have been deleted, or you may not have access to it."
          />
        </GlassCard>
      </div>
    )
  }

  if (deletion) {
    return (
      <div className="px-5 pt-2 pb-10 space-y-4">
        <PageHeader title="Document deleted" backHref="/upload" />
        <DeletionReceiptCard receipt={deletion} />
        <Link href="/upload" className="inline-block text-sm font-semibold text-family-400">
          Back to documents
        </Link>
      </div>
    )
  }

  const Icon = CATEGORY_ICONS[doc.category] ?? FileQuestion
  const fields = Object.entries(doc.extractedData ?? {})
  const docName = displayDocName(doc)

  return (
    <PageTransition>
      <div className="px-5 pt-2 pb-10 space-y-4">
        <PageHeader
          title={docName}
          backHref="/upload"
          subtitle={CATEGORY_LABELS[doc.category] ?? 'Document'}
        />

        <GlassCard className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-tint/[0.05] flex items-center justify-center flex-shrink-0">
            <Icon size={18} className="text-ink-secondary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{docName}</div>
            <div className="text-xs text-ink-tertiary mt-0.5">
              Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
            </div>
          </div>
        </GlassCard>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs font-semibold text-danger px-3 py-2 rounded-xl bg-danger/10 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete document'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {preview !== null && (
            <GlassCard className="p-3">
              <div className="text-sm font-semibold text-ink-secondary mb-2 px-1">
                Original document
              </div>
              {preview === undefined ? (
                <Skeleton className="h-64 w-full rounded-2xl" />
              ) : preview.mimeType.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not an optimizable remote image
                <img
                  src={preview.url}
                  alt={`Preview of ${doc.filename}`}
                  className="w-full rounded-2xl object-contain max-h-[70vh]"
                />
              ) : preview.mimeType === 'application/pdf' ? (
                <iframe
                  src={preview.url}
                  title={`Preview of ${doc.filename}`}
                  className="w-full h-[70vh] rounded-2xl border border-tint/[0.06]"
                />
              ) : (
                <div className="text-sm text-ink-tertiary p-4 text-center">
                  No inline preview for this file type.{' '}
                  <a
                    href={preview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-family-400 font-semibold"
                  >
                    Open the file
                  </a>
                </div>
              )}
            </GlassCard>
          )}

          {fields.length > 0 && (
            <GlassCard className="p-4">
              <div className="text-sm font-semibold text-ink-secondary mb-3">Extracted details</div>
              <div className="space-y-2.5">
                {fields.map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-ink-tertiary flex-shrink-0">{fieldLabel(key)}</span>
                    <span className="text-ink-primary text-right">{value}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>

        <AnimatePresence mode="wait">
          {applied ? (
            <motion.div
              key="applied"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              role="status"
              aria-live="polite"
            >
              <GlassCard className="p-4 border-success/20 flex items-start gap-3">
                <CheckCircle2 size={20} className="text-success flex-shrink-0 mt-0.5" />
                <div className="text-sm text-ink-secondary flex-1">
                  Applied {applied.join(', ')} to your Financial Profile.{' '}
                  {appliedInsights > 0 ? (
                    <>
                      {appliedInsights} new insight{appliedInsights === 1 ? '' : 's'} generated —{' '}
                      <Link href="/" className="text-family-400 font-semibold">
                        see them on your home feed
                      </Link>
                      .
                    </>
                  ) : (
                    <>
                      <Link href="/financial-profile" className="text-family-400 font-semibold">
                        Review your profile
                      </Link>
                      .
                    </>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          ) : suggestions.length > 0 ? (
            <motion.div
              key="suggestions"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <GlassCard className="p-4 border-family-500/20">
                <div className="flex items-start gap-2 mb-3">
                  <Sparkles size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm font-semibold text-family-400">
                    Add to your Financial Profile?
                  </div>
                </div>
                <div className="space-y-2 mb-4">
                  {suggestions.map((s) => (
                    <div
                      key={s.path}
                      className="flex items-center justify-between text-sm rounded-xl bg-tint/[0.03] px-3 py-2.5"
                    >
                      <span className="text-ink-secondary">{s.label}</span>
                      <span className="font-semibold text-ink-primary">{money(s.valueMinor)}</span>
                    </div>
                  ))}
                </div>
                {error && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-start gap-2 mb-3 text-xs text-danger"
                  >
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}
                <GlassButton onClick={handleApply} disabled={applying}>
                  {applying ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    'Apply to Financial Profile'
                  )}
                </GlassButton>
              </GlassCard>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {policyApplied ? (
            <motion.div
              key="policy-applied"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              role="status"
              aria-live="polite"
            >
              <GlassCard className="p-4 border-success/20 flex items-start gap-3">
                <CheckCircle2 size={20} className="text-success flex-shrink-0 mt-0.5" />
                <div className="text-sm text-ink-secondary flex-1">
                  Added as a policy on your Financial Profile.{' '}
                  {policyAppliedInsights > 0 ? (
                    <>
                      {policyAppliedInsights} new insight{policyAppliedInsights === 1 ? '' : 's'}{' '}
                      generated —{' '}
                      <Link href="/" className="text-family-400 font-semibold">
                        see them on your home feed
                      </Link>
                      .
                    </>
                  ) : (
                    <>
                      <Link href="/financial-profile" className="text-family-400 font-semibold">
                        Review your profile
                      </Link>
                      .
                    </>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          ) : policyDraft ? (
            <motion.div
              key="policy-suggestion"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <GlassCard className="p-4 border-family-500/20">
                <div className="flex items-start gap-2 mb-3">
                  <Sparkles size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm font-semibold text-family-400">
                    Add as an insurance policy?
                  </div>
                </div>
                <div className="text-xs text-ink-tertiary mb-3">
                  Found on this document — check these before adding, especially the policy type.
                </div>
                <div className="space-y-3 mb-4">
                  <label className="block">
                    <div className="text-xs text-ink-tertiary mb-1.5">Policy type</div>
                    <select
                      value={policyDraft.type}
                      onChange={(e) =>
                        setPolicyDraft({ ...policyDraft, type: e.target.value as PolicyType })
                      }
                      className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                    >
                      {POLICY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {POLICY_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {PERSON_SCOPED_POLICY_TYPES.has(policyDraft.type) &&
                    (family?.members ?? []).length > 0 && (
                      <label className="block">
                        <div className="text-xs text-ink-tertiary mb-1.5">
                          Who is this policy for?
                        </div>
                        <select
                          value={policyDraft.memberId}
                          onChange={(e) =>
                            setPolicyDraft({ ...policyDraft, memberId: e.target.value })
                          }
                          className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                        >
                          <option value="">The whole household / not sure</option>
                          {(family?.members ?? []).map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  <label className="block">
                    <div className="text-xs text-ink-tertiary mb-1.5">Provider</div>
                    <input
                      type="text"
                      value={policyDraft.provider}
                      onChange={(e) => setPolicyDraft({ ...policyDraft, provider: e.target.value })}
                      className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <div className="text-xs text-ink-tertiary mb-1.5">Coverage amount</div>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={policyDraft.coverageAmount}
                        onChange={(e) =>
                          setPolicyDraft({ ...policyDraft, coverageAmount: e.target.value })
                        }
                        placeholder="0 if none"
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-ink-tertiary mb-1.5">Monthly premium</div>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={policyDraft.monthlyPremium}
                        onChange={(e) =>
                          setPolicyDraft({ ...policyDraft, monthlyPremium: e.target.value })
                        }
                        placeholder="0 if none"
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <div className="text-xs text-ink-tertiary mb-1.5">Policy number (if known)</div>
                    <input
                      type="text"
                      value={policyDraft.policyNumber}
                      onChange={(e) =>
                        setPolicyDraft({ ...policyDraft, policyNumber: e.target.value })
                      }
                      className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                    />
                  </label>
                  <label className="block">
                    <div className="text-xs text-ink-tertiary mb-1.5">Renewal date (if known)</div>
                    <input
                      type="date"
                      value={policyDraft.renewalDate}
                      onChange={(e) =>
                        setPolicyDraft({ ...policyDraft, renewalDate: e.target.value })
                      }
                      className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <div className="text-xs text-ink-tertiary mb-1.5">
                        Claims/assistance phone
                      </div>
                      <input
                        type="tel"
                        value={policyDraft.contactPhone}
                        onChange={(e) =>
                          setPolicyDraft({ ...policyDraft, contactPhone: e.target.value })
                        }
                        placeholder="If known"
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-ink-tertiary mb-1.5">
                        Claims/assistance email
                      </div>
                      <input
                        type="email"
                        value={policyDraft.contactEmail}
                        onChange={(e) =>
                          setPolicyDraft({ ...policyDraft, contactEmail: e.target.value })
                        }
                        placeholder="If known"
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      />
                    </label>
                  </div>
                  <div className="text-[11px] text-ink-tertiary -mt-1">
                    Shown in your emergency playbooks so the family can call or email fast — Keel
                    never contacts anyone for you.
                  </div>
                </div>
                {policyError && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-start gap-2 mb-3 text-xs text-danger"
                  >
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    {policyError}
                  </div>
                )}
                <GlassButton
                  onClick={handleApplyPolicy}
                  disabled={policyApplying || !policyDraft.provider.trim()}
                >
                  {policyApplying ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    'Add to Financial Profile'
                  )}
                </GlassButton>
              </GlassCard>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {fields.length === 0 && suggestions.length === 0 && !policyDraft && (
          <GlassCard>
            <EmptyState
              icon={FileQuestion}
              title="No details extracted"
              description="This document was stored but no fields could be read from it."
            />
          </GlassCard>
        )}
      </div>
    </PageTransition>
  )
}
