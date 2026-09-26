'use client'

/**
 * Client-side gate for the whole /operator/* shell. One /operator/me call
 * on mount — a 401/403 renders a clean "access required" screen instead of
 * every page surfacing its own API error. The routes stay server-gated;
 * this is presentation, not the security boundary.
 */

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { fetchOperatorMe } from '@/lib/api'

export function OperatorGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking')

  useEffect(() => {
    fetchOperatorMe()
      .then(() => setState('ok'))
      .catch(() => setState('denied'))
  }, [])

  if (state === 'checking') {
    return <div className="shimmer h-40 rounded-2xl" />
  }
  if (state === 'denied') {
    return (
      <div className="mx-auto max-w-md text-center py-16">
        <ShieldAlert size={28} className="mx-auto text-warning" />
        <h1 className="mt-3 text-xl font-semibold">Operator access required</h1>
        <p className="mt-2 text-sm text-ink-secondary leading-relaxed">
          This console is for platform operators. Sign in with an operator account to continue.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-family-400">
          Back to the product
        </Link>
      </div>
    )
  }
  return <>{children}</>
}
