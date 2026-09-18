'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { PageHeader, GlassCard, GlassButton, EmptyState, Skeleton } from '@/components/Glass'
import { ScrollText, Loader2 } from 'lucide-react'
import { fetchAuditLog, type AuditLogEntry } from '@/lib/api'

// The raw action ids (insight.approve, billing.plan_upgraded, …) are
// developer-facing; the viewer translates them into what actually happened.
const ACTION_LABELS: Record<string, string> = {
  'insight.approve': 'Approved an action',
  'insight.retry_execution': 'Retried an action',
  'insight.dismiss': 'Dismissed an insight',
  'insight.prepare': 'Drafted a message',
  'assistant.ask': 'Asked Oak a question',
  'connector.add': 'Connected a service',
  'connector.remove': 'Disconnected a service',
  'settings.update': 'Updated settings',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in attempt',
  'webhook.signature_failed': 'Rejected an unsigned webhook',
  'billing.plan_upgraded': 'Upgraded plan',
  'billing.plan_downgraded': 'Downgraded plan',
  'billing.payment_failed': 'Payment failed',
  'billing.payment_succeeded': 'Payment received',
  'billing.promo_redeemed': 'Redeemed a promo code',
  'billing.credits_adjusted': 'Credits adjusted',
  'billing.credit_reversed': 'Credits reversed',
  'billing.credit_pack_purchased': 'Purchased a credit pack',
  'insight.cleanup_stale': 'Resolved a stale insight',
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ')
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
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const PAGE_SIZE_HINT = 50 // server's default page size — fewer means we're at the end

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  useEffect(() => {
    fetchAuditLog().then((first) => {
      setEntries(first)
      if (first.length < PAGE_SIZE_HINT) setExhausted(true)
      setLoading(false)
    })
  }, [])

  const loadMore = async () => {
    const oldest = entries.at(-1)
    if (!oldest) return
    setLoadingMore(true)
    const next = await fetchAuditLog(oldest.timestamp)
    setEntries((prev) => [...prev, ...next])
    if (next.length < PAGE_SIZE_HINT) setExhausted(true)
    setLoadingMore(false)
  }

  return (
    <div className="px-5 pt-2 pb-10 space-y-4">
      <PageHeader
        title="Activity Log"
        backHref="/settings"
        subtitle="Security-relevant actions on your family's account — kept for 7 years"
      />

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <GlassCard key={i} className="p-4 flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-xl flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <GlassCard>
          <EmptyState
            icon={ScrollText}
            title="Nothing recorded yet"
            description="Actions like sign-ins, approvals, and plan changes will appear here."
          />
        </GlassCard>
      )}

      {!loading && entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <motion.div
              key={`${entry.timestamp}-${entry.action}-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.03 }}
            >
              <GlassCard className="p-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-white/[0.05] flex items-center justify-center flex-shrink-0">
                  <ScrollText size={14} className="text-ink-tertiary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink-primary">{actionLabel(entry.action)}</div>
                  <div className="text-xs text-ink-tertiary mt-0.5">
                    {entry.resource_type.replace(/_/g, ' ')} · {when(entry.timestamp)}
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          ))}

          {!exhausted && (
            <GlassButton variant="secondary" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 size={16} className="animate-spin" /> : 'Load older activity'}
            </GlassButton>
          )}
        </div>
      )}
    </div>
  )
}
