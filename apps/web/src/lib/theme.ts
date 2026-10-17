'use client'

import { useCallback, useEffect, useState } from 'react'

// Light/dark appearance for the whole app. The visual tokens live in
// globals.css (`[data-theme='light']` overrides); this module owns the
// preference itself: stored in localStorage under `lifekeel-theme` as
// 'dark' | 'light' | 'system', resolved against prefers-color-scheme,
// and applied as `data-theme` on <html>.
//
// The same resolution runs inline in layout.tsx's <head> script before
// first paint so a light-mode user never sees a dark flash — keep the
// storage key and the resolution logic identical in both places.
export type ThemePreference = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

const THEME_KEY = 'lifekeel-theme'
const LIGHT_MEDIA = '(prefers-color-scheme: light)'

export function storedThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === 'dark' || raw === 'light' ? raw : 'system'
  } catch {
    return 'system'
  }
}

export function resolvedTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'system') return pref
  if (typeof window !== 'undefined' && window.matchMedia?.(LIGHT_MEDIA).matches) {
    return 'light'
  }
  return 'dark'
}

export function applyThemePreference(pref: ThemePreference): ResolvedTheme {
  const resolved = resolvedTheme(pref)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved
  }
  return resolved
}

/**
 * Reads and applies the stored theme preference, following the OS when set
 * to 'system'. No context needed — the DOM attribute is the source the CSS
 * actually consumes, so any component can call the setter directly.
 */
export function useThemePreference(): [ThemePreference, (p: ThemePreference) => void] {
  // Starts as 'system' on both server and first client render — reading
  // localStorage in the useState initializer would produce a different
  // first render than the SSR'd HTML (hydration mismatch). The stored
  // value is picked up in the effect below instead; the inline script in
  // layout.tsx has already applied the right data-theme by then, so the
  // only thing that lags a frame is which Settings row shows the check.
  const [pref, setPref] = useState<ThemePreference>('system')

  useEffect(() => {
    setPref(storedThemePreference())
  }, [])

  const set = useCallback((p: ThemePreference) => {
    setPref(p)
    try {
      localStorage.setItem(THEME_KEY, p)
    } catch {
      // ignore — the DOM attribute still updates for this session
    }
    applyThemePreference(p)
  }, [])

  // Follow the OS while the preference is 'system' so flipping macOS
  // appearance updates the app live, matching every other themed app.
  useEffect(() => {
    if (pref !== 'system' || typeof window === 'undefined') return
    const mq = window.matchMedia(LIGHT_MEDIA)
    const onChange = () => applyThemePreference('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  return [pref, set]
}
