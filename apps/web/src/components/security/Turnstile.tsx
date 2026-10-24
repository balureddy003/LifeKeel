'use client'

/**
 * Cloudflare Turnstile widget (CLOUDFLARE_INTEGRATION.md §5.1).
 *
 * Loaded explicitly, and only on the pages that render this component — it
 * is deliberately not in the root layout. The script comes only from
 * challenges.cloudflare.com (allowed by the CSP in firebase.json); no SRI
 * because Cloudflare serves the live script.
 *
 * The parent owns the token: `onToken` fires when a token is ready,
 * `onExpire` when it lapses (tokens last 300 s). Call `reset()` through the
 * ref after every submit — a token is single use.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { turnstileSiteKey, type TurnstileAction } from '@/lib/turnstile'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<TurnstileApi> | null = null

function loadScript(): Promise<TurnstileApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('no api')))
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('Turnstile failed to load'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

export interface TurnstileHandle {
  reset: () => void
}

interface Props {
  action: TurnstileAction
  onToken: (token: string) => void
  onExpire?: () => void
  /** 'interaction-only' shows nothing unless Cloudflare needs the visitor to act. */
  appearance?: 'always' | 'interaction-only'
}

export const Turnstile = forwardRef<TurnstileHandle, Props>(function Turnstile(
  { action, onToken, onExpire, appearance = 'always' },
  ref,
) {
  const siteKey = turnstileSiteKey()
  const container = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking')
  // Latest callbacks without re-rendering the widget.
  const cb = useRef({ onToken, onExpire })
  cb.current = { onToken, onExpire }

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetId.current && window.turnstile) {
        window.turnstile.reset(widgetId.current)
        setStatus('checking')
      }
    },
  }))

  useEffect(() => {
    if (!siteKey || !container.current) return
    let cancelled = false
    loadScript()
      .then((api) => {
        if (cancelled || !container.current) return
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          action,
          appearance,
          callback: (token: string) => {
            setStatus('ready')
            cb.current.onToken(token)
          },
          'expired-callback': () => {
            setStatus('checking')
            cb.current.onExpire?.()
          },
          'error-callback': () => {
            setStatus('error')
            cb.current.onExpire?.()
          },
        })
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
  }, [siteKey, action, appearance])

  if (!siteKey) return null
  return (
    <div className="lk-turnstile">
      <div ref={container} />
      <p className="lk-hint" aria-live="polite">
        {status === 'checking'
          ? "Checking you're human..."
          : status === 'error'
            ? "The security check couldn't load. Check your connection, or reload the page."
            : ''}
      </p>
    </div>
  )
})

/**
 * Token state for one form. `ready` is true once a token exists, or always
 * when Turnstile isn't configured. `consume()` returns the token and resets
 * the widget, since each token is single use.
 */
export function useTurnstile() {
  const ref = useRef<TurnstileHandle>(null)
  const [token, setToken] = useState<string | null>(null)
  const enabled = turnstileSiteKey() !== null
  return {
    ref,
    token,
    ready: !enabled || token !== null,
    onToken: setToken,
    onExpire: () => setToken(null),
    consume: (): string | null => {
      const t = token
      setToken(null)
      ref.current?.reset()
      return t
    },
  }
}
