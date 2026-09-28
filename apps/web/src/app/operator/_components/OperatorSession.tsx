'use client'

/**
 * Shared /operator/me session for the whole console — one fetch on mount
 * feeds both the access gate and permission-scoped navigation. The backend
 * remains the enforcement boundary; permissions here only hide links that
 * would 403 anyway.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchOperatorMe, type OperatorMe } from '@/lib/api'

interface OperatorSession {
  status: 'checking' | 'ok' | 'denied'
  me: OperatorMe | null
}

const OperatorSessionContext = createContext<OperatorSession>({ status: 'checking', me: null })

export function OperatorSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OperatorSession>({ status: 'checking', me: null })
  useEffect(() => {
    fetchOperatorMe()
      .then((me) => setSession({ status: 'ok', me }))
      .catch(() => setSession({ status: 'denied', me: null }))
  }, [])
  return <OperatorSessionContext.Provider value={session}>{children}</OperatorSessionContext.Provider>
}

export function useOperatorSession(): OperatorSession {
  return useContext(OperatorSessionContext)
}

/** Convenience for nav/action visibility — true while checking keeps
 *  flicker down (links appear once known, nothing flips late). */
export function useHasPermission(permission: string): boolean {
  const { me } = useOperatorSession()
  return me?.permissions.includes(permission) ?? false
}
