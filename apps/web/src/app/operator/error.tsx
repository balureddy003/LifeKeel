'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { reportError } from '@/lib/observability'

// Operator-scoped boundary: a render failure inside the console used to
// fall through to the root error.tsx, whose generic "Something went
// wrong" gave a non-operator (or a broken operator session) no usable
// next step. The gate's access-denied screen handles the common 403;
// this covers whatever actually threw.
export default function OperatorError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportError(error, { digest: error.digest, path: '/operator' })
  }, [error])

  return (
    <div className="mx-auto max-w-md text-center py-16">
      <ShieldAlert size={28} className="mx-auto text-warning" />
      <h1 className="mt-3 text-xl font-semibold">The console couldn&apos;t load</h1>
      <p className="mt-2 text-sm text-ink-secondary leading-relaxed">
        This page is for platform operators. If you have operator access and still see this, try
        again or sign back in — nothing was changed.
      </p>
      <div className="mt-4 flex items-center justify-center gap-4">
        <button type="button" onClick={reset} className="text-sm font-semibold text-family-400">
          Try again
        </button>
        <Link href="/" className="text-sm font-semibold text-ink-tertiary">
          Back to the product
        </Link>
      </div>
    </div>
  )
}
