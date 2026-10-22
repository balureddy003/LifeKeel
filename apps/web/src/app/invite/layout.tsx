import type { Metadata } from 'next'
import { PublicShell } from '@/components/landing/PublicShell'

export const metadata: Metadata = { title: 'Join your family — LifeKeel' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>
}
