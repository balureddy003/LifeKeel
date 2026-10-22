import type { Metadata } from 'next'
import { PublicShell } from '@/components/landing/PublicShell'
import { LegalLayout } from '../legal/LegalLayout'

export const metadata: Metadata = { title: 'Cookies & device storage — LifeKeel' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <PublicShell>
      <LegalLayout>{children}</LegalLayout>
    </PublicShell>
  )
}
