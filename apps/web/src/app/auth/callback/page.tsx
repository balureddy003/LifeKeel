'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { reportError } from '@/lib/observability'

export default function AuthCallbackPage() {
  const router = useRouter()
  const { refresh } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    const token = params.get('token')
    const tenant = params.get('tenant')
    const err = params.get('error')

    if (err) {
      // Keep the real error on screen — auto-redirecting after 2s discarded
      // it before the user could read or report what actually failed.
      reportError(new Error(`OAuth callback error: ${err}`), { path: '/auth/callback' })
      setError(err)
      return
    }

    if (token) {
      localStorage.setItem('agentoak_token', token)
      if (tenant) localStorage.setItem('agentoak_tenant', tenant)
      refresh().then(() => router.push('/'))
    } else {
      router.push('/login')
    }
  }, [router, refresh])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-xs">
          <p className="text-sm text-red-400 mb-4">Sign-in failed: {error}</p>
          <button
            onClick={() => router.push('/login')}
            className="w-full bg-family-500 text-white font-semibold rounded-2xl py-3 text-sm"
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <p className="text-sm text-ink-tertiary">Signing you in…</p>
    </div>
  )
}
