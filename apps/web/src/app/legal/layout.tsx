import { PublicShell } from '@/components/landing/PublicShell'
import { LegalLayout } from './LegalLayout'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <PublicShell>
      <LegalLayout>{children}</LegalLayout>
    </PublicShell>
  )
}
