'use client'

import { useAuth } from '@/lib/auth-context'
import { emergencyNumberFor } from '@/lib/emergency-numbers'

/** Inline text version of the emergency number, for static copy (e.g. the Support page) that isn't the full LifeSafetyNotice banner. */
export function EmergencyNumberText() {
  const { user } = useAuth()
  return <>{emergencyNumberFor(user?.country).label}</>
}
