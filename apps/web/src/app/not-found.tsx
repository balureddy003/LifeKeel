'use client'

import Link from 'next/link'
import { AuthShell } from '@/components/landing/AuthShell'
import { GlassCard, PageHeader } from '@/components/Glass'
import { useAuth } from '@/lib/auth-context'

export default function NotFound() {
  const { isAuthenticated } = useAuth()

  // Signed in: stay inside the app, with no sign-in link and no public-page chrome.
  if (isAuthenticated) {
    return (
      <div className="space-y-4">
        <PageHeader title="Page not found" subtitle="This page doesn't exist, or may have moved." />
        <GlassCard className="p-5">
          <Link href="/" className="btn-primary">
            Back to home
          </Link>
        </GlassCard>
      </div>
    )
  }

  return (
    <AuthShell title="Page not found" sub="This page doesn't exist, or may have moved.">
      <Link href="/" className="lk-btn">
        Back to home
      </Link>
      <div className="lk-or">or try</div>
      <Link href="/guides" className="lk-btn lk-btn-quiet">
        Read the guides
      </Link>
      <Link href="/login" className="lk-textlink lk-textlink-muted">
        Sign in
      </Link>
    </AuthShell>
  )
}
