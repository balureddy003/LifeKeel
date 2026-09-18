'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
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
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-danger/10 border border-danger/20 flex items-center justify-center mb-6">
        <AlertTriangle size={32} className="text-danger" />
      </div>
      <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
      <p className="text-ink-tertiary mb-8 max-w-xs">
        This page hit an unexpected error. Your data is safe — try again.
      </p>
      <button
        onClick={reset}
        className="w-full max-w-xs bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 active:opacity-90"
      >
        Try again
      </button>
    </div>
  )
}
