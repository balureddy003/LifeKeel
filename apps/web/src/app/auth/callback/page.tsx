'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

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
      setError(err)
      setTimeout(() => router.push('/login'), 2000)
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
        <div className="text-center">
          <p className="text-sm text-red-400 mb-2">Sign-in failed: {error}</p>
          <p className="text-xs text-ink-tertiary">Redirecting to login…</p>
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
