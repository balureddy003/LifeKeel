'use client'

/**
 * Shown once after account deletion (PRD-146). The account no longer exists to
 * ask for its receipt later, so the delete response's receipt is held in
 * sessionStorage for this one page.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GlassCard, PageHeader } from '@/components/Glass'
import { DeletionReceiptCard } from '@/components/DeletionReceiptCard'
import { ACCOUNT_CLOSED_NOTE } from '@/lib/deletion-receipt-copy'
import { RECEIPT_STORAGE_KEY, type DeletionReceipt } from '@/lib/api'

export default function AccountDeletedPage() {
  const [receipt, setReceipt] = useState<DeletionReceipt | null | undefined>(undefined)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(RECEIPT_STORAGE_KEY)
      setReceipt(raw ? (JSON.parse(raw) as DeletionReceipt) : null)
    } catch {
      setReceipt(null)
    }
  }, [])

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Your account is closed" />
      <p className="text-sm text-ink-secondary leading-relaxed mt-2">{ACCOUNT_CLOSED_NOTE}</p>
      <div className="mt-4">
        {receipt ? (
          <DeletionReceiptCard receipt={receipt} />
        ) : receipt === null ? (
          <GlassCard className="p-4">
            <p className="text-sm text-ink-secondary">
              The receipt for this deletion is no longer available on this device.
            </p>
          </GlassCard>
        ) : null}
      </div>
      <Link href="/welcome" className="inline-block mt-6 text-sm font-semibold text-family-400">
        Back to the start
      </Link>
    </div>
  )
}
