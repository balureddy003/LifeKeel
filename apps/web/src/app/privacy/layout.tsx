import { PublicShell } from '@/components/landing/PublicShell'

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>
}
