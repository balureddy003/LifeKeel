'use client'

import { useEffect } from 'react'
import { decideRegion } from '@/lib/region'
import { getSavedRegion, isNativeShell, saveRegion } from '@/lib/native'

/**
 * Inside the Capacitor shell, sends the user to their region's app host.
 * The shell's server.url is fixed at build time (apps/mobile), so the first
 * page always loads from the uk host and this redirects from there. A no-op
 * in a plain browser. Renders nothing.
 */
export function NativeRegionGate() {
  useEffect(() => {
    if (!isNativeShell()) return
    let cancelled = false
    void (async () => {
      const saved = await getSavedRegion()
      if (cancelled) return
      const hasSession = (() => {
        try {
          return Boolean(
            localStorage.getItem('lifekeel_token') || localStorage.getItem('family-auth'),
          )
        } catch {
          return false
        }
      })()
      const decision = decideRegion({
        saved,
        language: navigator.language,
        hasSession,
        loc: window.location,
      })
      if (!decision) return
      if (decision.persist) await saveRegion(decision.region)
      if (decision.redirectTo && !cancelled) window.location.replace(decision.redirectTo)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
