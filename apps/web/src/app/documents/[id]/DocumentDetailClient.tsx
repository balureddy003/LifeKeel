'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, AlertCircle, CheckCircle2, Sparkles, FileQuestion } from 'lucide-react'
import { PageHeader, GlassCard, GlassButton, EmptyState, Skeleton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { CATEGORY_ICONS, CATEGORY_LABELS } from '@/lib/document-categories'
import {
  fetchDocument,
  fetchProfileSuggestions,
  applyDocumentToProfile,
  type FamilyDocumentDetail,
  type ProfileSuggestion,
} from '@/lib/api'

function money(minor: number): string {
  return `£${Math.round(minor / 100).toLocaleString()}`
}

function fieldLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function DocumentDetailClient() {
  const params = useParams<{ id: string }>()
  const [doc, setDoc] = useState<FamilyDocumentDetail | null | undefined>(undefined)
  const [suggestions, setSuggestions] = useState<ProfileSuggestion[]>([])
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      fetchDocument(params.id),
      fetchProfileSuggestions(params.id),
    ])
    setDoc(d)
    setSuggestions(s)
  }, [params.id])

  useEffect(() => {
    load()
  }, [load])

  const handleApply = async () => {
    haptic('light')
    setApplying(true)
    setError(null)
    try {
      const result = await applyDocumentToProfile(params.id)
      haptic('success')
      setApplied(result.applied.map((a) => a.label))
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Could not apply this document to your Financial Profile')
    } finally {
      setApplying(false)
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
          <EmptyState icon={FileQuestion} title="Document not found" description="It may have been deleted, or you may not have access to it." />
        </GlassCard>
      </div>
    )
  }

  const Icon = CATEGORY_ICONS[doc.category] ?? FileQuestion
  const fields = Object.entries(doc.extractedData ?? {})

  return (
    <div className="px-5 pt-2 pb-10 space-y-4">
      <PageHeader title={doc.filename} backHref="/upload" subtitle={CATEGORY_LABELS[doc.category] ?? 'Document'} />

      <GlassCard className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-white/[0.05] flex items-center justify-center flex-shrink-0">
          <Icon size={18} className="text-ink-secondary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{doc.filename}</div>
          <div className="text-xs text-ink-tertiary mt-0.5">
            Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
          </div>
        </div>
      </GlassCard>

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

      <AnimatePresence mode="wait">
        {applied ? (
          <motion.div key="applied" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} role="status" aria-live="polite">
            <GlassCard className="p-4 border-success/20 flex items-start gap-3">
              <CheckCircle2 size={20} className="text-success flex-shrink-0 mt-0.5" />
              <div className="text-sm text-ink-secondary flex-1">
                Applied {applied.join(', ')} to your Financial Profile.{' '}
                <Link href="/financial-profile" className="text-family-400 font-semibold">
                  Review and save to generate insights
                </Link>
                .
              </div>
            </GlassCard>
          </motion.div>
        ) : suggestions.length > 0 ? (
          <motion.div key="suggestions" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
            <GlassCard className="p-4 border-family-500/20">
              <div className="flex items-start gap-2 mb-3">
                <Sparkles size={16} className="text-family-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm font-semibold text-family-400">Add to your Financial Profile?</div>
              </div>
              <div className="space-y-2 mb-4">
                {suggestions.map((s) => (
                  <div key={s.path} className="flex items-center justify-between text-sm rounded-xl bg-white/[0.03] px-3 py-2.5">
                    <span className="text-ink-secondary">{s.label}</span>
                    <span className="font-semibold text-ink-primary">{money(s.valueMinor)}</span>
                  </div>
                ))}
              </div>
              {error && (
                <div role="status" aria-live="polite" className="flex items-start gap-2 mb-3 text-xs text-danger">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
              <GlassButton onClick={handleApply} disabled={applying}>
                {applying ? <Loader2 size={18} className="animate-spin" /> : 'Apply to Financial Profile'}
              </GlassButton>
            </GlassCard>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {fields.length === 0 && suggestions.length === 0 && (
        <GlassCard>
          <EmptyState icon={FileQuestion} title="No details extracted" description="This document was stored but no fields could be read from it." />
        </GlassCard>
      )}
    </div>
  )
}
