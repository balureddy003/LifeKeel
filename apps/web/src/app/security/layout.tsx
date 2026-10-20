import type { Metadata } from 'next'
import { PublicShell } from '@/components/landing/PublicShell'

export const metadata: Metadata = { title: 'Security — LifeKeel' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>
}
