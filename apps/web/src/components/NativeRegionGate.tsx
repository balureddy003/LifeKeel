'use client'

import { useEffect } from 'react'
import { decideRegion } from '@/lib/region'
import {
  getSavedRegion,
  hideKeyboardAccessoryBar,
  hideNativeSplash,
  isNativeShell,
  saveRegion,
} from '@/lib/native'

/**
 * Inside the Capacitor shell, sends the user to their region's app host.
 * The shell's server.url is fixed at build time (apps/mobile), so the first
 * page always loads from the uk host and this redirects from there. A no-op
 * in a plain browser. Renders nothing.
 */
export function NativeRegionGate() {
  // While a text field has focus the keyboard is up: let the CSS hide the floating tab bar, as native apps do.
  useEffect(() => {
    if (!isNativeShell()) return
    const root = document.documentElement
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
    const on = (e: FocusEvent) => {
      if (isField(e.target)) root.dataset['keyboard'] = '1'
    }
    const off = () => {
      delete root.dataset['keyboard']
    }
    document.addEventListener('focusin', on)
    document.addEventListener('focusout', off)
    return () => {
      document.removeEventListener('focusin', on)
      document.removeEventListener('focusout', off)
      off()
    }
  }, [])

  useEffect(() => {
    if (!isNativeShell()) return
    void hideKeyboardAccessoryBar()
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
      if (!decision) return void hideNativeSplash()
      if (decision.persist) await saveRegion(decision.region)
      if (decision.redirectTo && !cancelled) window.location.replace(decision.redirectTo)
      else void hideNativeSplash()
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
