'use client'

import { useEffect } from 'react'
import { useReportWebVitals } from 'next/web-vitals'
import { initObservability, reportWebVital } from '@/lib/observability'

// A route's JS chunk failing to load (a flaky connection, or a stale
// service-worker/CDN cache still pointing at a build that's been replaced by
// a newer deploy) happens client-side during the initial hard-navigation
// hydration — before React has a working bundle to run error.tsx's boundary
// with, so that per-route "Something went wrong, try again" UI never gets a
// chance to mount. The user is left on whatever the server-rendered HTML
// happened to be (this app's routes are all client-rendered, so that's
// AuthGate's loading skeleton) forever, with no visible error and no way
// out short of guessing to reload. A plain top-level reload sidesteps
// React entirely and re-fetches the current chunk manifest, which is
// exactly what's needed. Guarded to fire once per navigation (a
// sessionStorage flag, not a counter) so a chunk that's genuinely missing
// — not just slow — fails visibly on the second load instead of looping.
const RELOAD_GUARD_KEY = 'lifekeel:chunk-reload-guard'

function isChunkLoadError(reason: unknown): boolean {
  const name = (reason as { name?: string } | undefined)?.name
  const message = (reason as { message?: string } | undefined)?.message ?? ''
  return name === 'ChunkLoadError' || /Loading chunk [\w./-]+ failed/.test(message)
}

// Plain DOM, not React — a chunk load failure means the app's own React
// tree may not be functioning, so this can't assume any component will
// ever render to show the message. Same visual language as error.tsx's
// boundary (full-screen, family-500 button) for consistency, without
// depending on either the framework or its styles being loaded.
function showManualReloadFallback(): void {
  if (document.getElementById('lifekeel-chunk-fallback')) return
  const el = document.createElement('div')
  el.id = 'lifekeel-chunk-fallback'
  el.setAttribute(
    'style',
    'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;text-align:center;padding:24px;' +
      'background:#d3b8f5;color:#302440;font-family:system-ui,-apple-system,sans-serif;',
  )
  el.innerHTML =
    '<h1 style="font-size:22px;font-weight:700;margin-bottom:8px;">Something went wrong</h1>' +
    '<p style="color:#473157;max-width:320px;margin-bottom:24px;">' +
    'This page couldn’t load. Your data is safe — try reloading.</p>' +
    '<button id="lifekeel-chunk-fallback-btn" style="width:100%;max-width:320px;background:#ffda87;' +
    'color:#302440;font-weight:600;border:none;border-radius:16px;padding:16px;font-size:16px;">Reload</button>'
  document.body.appendChild(el)
  document
    .getElementById('lifekeel-chunk-fallback-btn')
    ?.addEventListener('click', () => location.reload())
}

function recoverFromChunkLoadError(reason: unknown): void {
  if (!isChunkLoadError(reason)) return
  if (sessionStorage.getItem(RELOAD_GUARD_KEY) === location.href) {
    // Already reloaded once for this exact URL and it happened again —
    // a further reload would just loop, so hand the user a manual way out
    // instead of leaving the frozen skeleton as the last word.
    showManualReloadFallback()
    return
  }
  sessionStorage.setItem(RELOAD_GUARD_KEY, location.href)
  location.reload()
}

// Mounted once from the root layout. No visual output — just wires up error
// tracking (if configured), Core Web Vitals reporting, and the chunk-load
// recovery above.
export function Observability() {
  useEffect(() => {
    initObservability()

    const onError = (event: ErrorEvent) => recoverFromChunkLoadError(event.error)
    const onRejection = (event: PromiseRejectionEvent) => recoverFromChunkLoadError(event.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  useReportWebVitals((metric) => reportWebVital(metric))

  return null
}
