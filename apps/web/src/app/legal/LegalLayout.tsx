import type { ReactNode } from 'react'
import { DocsLayout } from '@/components/landing/DocsLayout'
import { LEGAL_NAV } from './legal-nav'

export function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout label="Legal" groups={LEGAL_NAV}>
      {children}
    </DocsLayout>
  )
}
