// Lightweight client-side error/perf reporting. A no-op until
// NEXT_PUBLIC_SENTRY_DSN is set — this app has no error tracking configured
// yet, but every call site (fetch failures swallowed for offline-first
// behavior, render errors, web vitals) is already wired through here so
// turning on real reporting later is a one-line env change, not a grep.
//
// Deliberately NOT using Sentry's Session Replay: this app displays
// household financial data on screen, and replay would capture it.
import * as Sentry from '@sentry/browser'

let initialized = false

function stripUrl(url: string): string {
  return url.split(/[?#]/)[0] ?? ''
}

export function initObservability(): void {
  if (initialized || typeof window === 'undefined') return
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    // URLs can carry reset/invite tokens and OAuth codes (R22): drop query
    // strings and fragments everywhere Sentry records a URL, and drop
    // breadcrumbs' request bodies.
    beforeSend(event) {
      if (event.request?.url) event.request.url = stripUrl(event.request.url)
      if (event.request) {
        delete event.request.query_string
        delete event.request.cookies
        delete event.request.data
      }
      return event
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data) {
        for (const key of ['url', 'from', 'to']) {
          const value = crumb.data[key]
          if (typeof value === 'string') crumb.data[key] = stripUrl(value)
        }
        delete crumb.data['body']
      }
      return crumb
    },
  })
  initialized = true
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error(error, context)
  }
  if (initialized) {
    Sentry.captureException(error, context ? { extra: context } : undefined)
  }
}

interface WebVitalMetric {
  name: string
  value: number
  id: string
}

export function reportWebVital(metric: WebVitalMetric): void {
  if (process.env.NODE_ENV !== 'production') {
    console.debug(`[web-vital] ${metric.name}`, metric.value)
    return
  }
  if (initialized) {
    Sentry.captureMessage(`web-vital:${metric.name}`, { level: 'info', extra: { ...metric } })
  }
}
