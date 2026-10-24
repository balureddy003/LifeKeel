'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader, GlassCard, GlassButton, EmptyState, Skeleton } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  FileCheck2,
  Loader2,
  Download,
  CircleCheck,
  CircleX,
  CircleSlash,
  ShieldAlert,
  FlaskConical,
  CircleDashed,
} from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { fetchFamilyReceipts, downloadFamilyReceiptsCsv, type FamilyReceipt } from '@/lib/api'

// The Receipt Chain is the family's answer to "what did Keel actually do?" —
// every propose/approve/execute record, hash-chained so the ledger itself
// carries its own tamper-evidence, and exportable so the family can pin it.

const ACTION_LABELS: Record<string, string> = {
  'insight.approve': 'Approved an insight',
  'insight.dismiss': 'Dismissed an insight',
  'insight.prepare': 'Prepared an action',
  send_email: 'Sent an email',
  send_whatsapp: 'Sent a WhatsApp message',
  crm_tag: 'Tagged a contact',
  log_only: 'Recorded a note',
}

function actionLabel(r: FamilyReceipt): string {
  return r.action_label ?? ACTION_LABELS[r.action_type] ?? r.action_type.replace(/[._]/g, ' ')
}

const OUTCOME_META: Record<string, { label: string; tone: string; Icon: typeof CircleCheck }> = {
  approved: { label: 'Approved & ran', tone: 'text-success', Icon: CircleCheck },
  executed: { label: 'Ran', tone: 'text-success', Icon: CircleCheck },
  dismissed: { label: 'Dismissed', tone: 'text-ink-tertiary', Icon: CircleX },
  auto_approved: { label: 'Auto-approved & ran', tone: 'text-success', Icon: CircleCheck },
  auto_dismissed: { label: 'Timed out & skipped', tone: 'text-ink-tertiary', Icon: CircleX },
  policy_blocked: { label: 'Blocked by policy', tone: 'text-danger', Icon: ShieldAlert },
  budget_blocked: { label: 'Stopped by budget guard', tone: 'text-danger', Icon: ShieldAlert },
  pending: { label: 'Dispatch pending', tone: 'text-warning', Icon: CircleDashed },
  execution_failed: { label: 'Failed to run', tone: 'text-danger', Icon: CircleX },
  execution_ambiguous: { label: 'Outcome unknown', tone: 'text-warning', Icon: CircleDashed },
  execution_skipped: {
    label: 'Recorded, not dispatched',
    tone: 'text-ink-tertiary',
    Icon: CircleSlash,
  },
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const seconds = Math.max(0, (Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortHash(h: string): string {
  return `${h.slice(0, 8)}…${h.slice(-6)}`
}

const PAGE_SIZE = 50

export default function ReceiptsPage() {
  const toast = useToast()
  const [receipts, setReceipts] = useState<FamilyReceipt[]>([])
  const [total, setTotal] = useState(0)
  const [chainHead, setChainHead] = useState<string | null>(null)
  const [chainNote, setChainNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    fetchFamilyReceipts(PAGE_SIZE, 0).then((r) => {
      setReceipts(r.receipts)
      setTotal(r.total)
      setChainHead(r.chain_head)
      setChainNote(r.chain_note)
      setLoading(false)
    })
  }, [])

  const loadMore = async () => {
    setLoadingMore(true)
    const more = await fetchFamilyReceipts(PAGE_SIZE, receipts.length)
    setReceipts((prev) => [...prev, ...more.receipts])
    setLoadingMore(false)
  }

  const handleExport = async () => {
    haptic('light')
    setExporting(true)
    const ok = await downloadFamilyReceiptsCsv()
    setExporting(false)
    if (ok) {
      toast({ message: 'Receipt chain exported' })
      haptic('success')
    } else {
      toast({
        message: "The export didn't come through — try again in a moment.",
        variant: 'error',
      })
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24">
      <PageHeader title="Receipts" subtitle="What Keel did — proposed, approved, run" />

      {chainHead && (
        <GlassCard className="mb-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-ink-tertiary uppercase tracking-wide">
                Chain head
              </div>
              <div className="mt-1 font-mono text-xs text-ink break-all">
                {shortHash(chainHead)}
              </div>
              <p className="mt-2 text-xs text-ink-tertiary leading-relaxed">{chainNote}</p>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-family-500/80 px-4 py-2 text-sm font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export
            </button>
          </div>
        </GlassCard>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : receipts.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="Nothing on the record yet"
          description="When Keel proposes an action and it is approved, dismissed or run, the receipt lands here — in order, and impossible to quietly rewrite."
        />
      ) : (
        <div className="space-y-3">
          {receipts.map((r) => {
            const meta = OUTCOME_META[r.outcome] ?? {
              label: r.outcome.replace(/_/g, ' '),
              tone: 'text-ink-tertiary',
              Icon: CircleDashed,
            }
            return (
              <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <GlassCard className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <meta.Icon className={`h-4 w-4 shrink-0 ${meta.tone}`} />
                        <span className="text-sm font-medium text-ink truncate">
                          {actionLabel(r)}
                        </span>
                        {r.dry_run && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-medium text-ink-tertiary">
                            <FlaskConical className="h-3 w-3" /> dry run
                          </span>
                        )}
                      </div>
                      <div className={`mt-1 text-xs font-medium ${meta.tone}`}>{meta.label}</div>
                      {r.outcome_reason && (
                        <div className="mt-1 text-xs text-ink-tertiary">{r.outcome_reason}</div>
                      )}
                      <div className="mt-2 text-xs text-ink-tertiary leading-relaxed">
                        {r.policy}
                        {r.approved_by && r.approved_by !== 'auto-trust' && ' · by you'}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-ink-tertiary">{when(r.executed_at)}</div>
                      <div
                        className="mt-1 font-mono text-[10px] text-ink-tertiary/70"
                        title={`Receipt ${r.id} · chain position ${r.chain_index} · ${r.chain_hash}`}
                      >
                        #{r.chain_index} {shortHash(r.chain_hash)}
                      </div>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            )
          })}

          {receipts.length < total && (
            <div className="flex justify-center pt-2">
              <GlassButton onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Show earlier receipts'
                )}
              </GlassButton>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
