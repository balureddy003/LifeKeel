'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Calculator, Landmark, Wallet, Vault, FileText, Upload, Plug } from 'lucide-react'
import { PageHeader, ListSection, ListRow, PageTransition } from '@/components/Glass'
import { useAppStore } from '@/lib/store'
import { haptic } from '@/lib/haptics'

/**
 * Top-level "Finances" destination — the vault, profile, cashflow and
 * assets previously lived one hop deep under Home cards or Settings,
 * which buried the product's core data surface behind discovery luck.
 * This page is deliberately a hub (links, no data of its own): each
 * destination already exists; the gap was getting to them.
 */
export default function FinancesPage() {
  const profileCompleteness = useAppStore((s) => s.profileCompleteness)

  return (
    <PageTransition>
    <div className="px-5 pt-2 space-y-6">
      <PageHeader
        title="Finances"
        subtitle="Your family's money, documents, and connections"
      />

      <ListSection title="Money">
        <Link href="/financial-profile" onClick={() => haptic('light')}>
          <ListRow icon={Calculator} chevron>
            <div className="text-base font-medium flex items-center gap-2">
              Financial Profile
              {profileCompleteness > 0 && profileCompleteness < 100 && (
                <span className="text-xs font-semibold text-family-400">{profileCompleteness}%</span>
              )}
            </div>
            <div className="text-xs text-ink-tertiary mt-0.5">Income, protection, savings — powers your readiness score</div>
          </ListRow>
        </Link>
        <Link href="/cashflow" onClick={() => haptic('light')}>
          <ListRow icon={Wallet} label="Cash Flow" chevron />
        </Link>
        <Link href="/assets" onClick={() => haptic('light')}>
          <ListRow icon={Landmark} label="Assets" chevron />
        </Link>
      </ListSection>

      <ListSection title="Vault & Documents">
        <Link href="/vault" onClick={() => haptic('light')}>
          <ListRow icon={Vault} label="Family Vault" chevron />
        </Link>
        <Link href="/documents" onClick={() => haptic('light')}>
          <ListRow icon={FileText} label="Documents" chevron />
        </Link>
        <Link href="/upload" onClick={() => haptic('light')}>
          <ListRow icon={Upload} label="Upload a Document" chevron />
        </Link>
      </ListSection>

      <ListSection title="Connections">
        <Link href="/connect" onClick={() => haptic('light')}>
          <ListRow icon={Plug} label="Connected Services" chevron />
        </Link>
      </ListSection>
    </div>
    </PageTransition>
  )
}
