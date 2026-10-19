'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AuthShell } from '@/components/landing/AuthShell'
import { reportError } from '@/lib/observability'

// Catches render errors within a route segment without taking down the rest
// of the app shell. See global-error.tsx for the last-resort boundary that
// covers the root layout itself.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportError(error, { digest: error.digest })
  }, [error])

  return (
    <AuthShell title="Something went wrong" sub="This page hit an unexpected error. Your data is safe.">
      <button type="button" className="lk-btn" onClick={reset}>
        Try again
      </button>
      <Link href="/" className="lk-textlink lk-textlink-muted">
        Back to home
      </Link>
    </AuthShell>
  )
}
