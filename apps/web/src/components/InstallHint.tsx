'use client'

/**
 * PRD-147: a dismissible hint to install the app. Android and desktop Chrome
 * use the captured beforeinstallprompt; iOS has no prompt, so it explains
 * Share → Add to Home Screen. Runs under the strict CSP (a normal bundled
 * component, no inline script). Hidden when already installed or inside the
 * native shell. Dismissal is a per-device preference kept for 90 days.
 */
import { useEffect, useState } from 'react'
import { Download, Share, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { isIOS, isStandalone } from '@/lib/platform'
import { isNativeShell } from '@/lib/native'
import { track } from '@/lib/growth-track'
import { DISMISS_KEY, VISITS_KEY, chooseHint, type InstallPlatform } from '@/lib/install-hint'
import {
  INSTALL_BODY,
  INSTALL_BUTTON,
  INSTALL_DISMISS,
  INSTALL_IOS_IN_APP,
  INSTALL_IOS_STEPS,
  INSTALL_TITLE,
} from '@/lib/install-copy'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function read(key: string, store: Storage | undefined): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

function countVisit(): number {
  try {
    const seen = sessionStorage.getItem('lifekeel_visit_counted')
    const n = Number(localStorage.getItem(VISITS_KEY) ?? '0') || 0
    if (seen) return n
    sessionStorage.setItem('lifekeel_visit_counted', '1')
    localStorage.setItem(VISITS_KEY, String(n + 1))
    return n + 1
  } catch {
    return 0
  }
}

export function InstallHint() {
  const { isAuthenticated } = useAuth()
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [visits, setVisits] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    setVisits(countVisit())
    setDismissedAt(read(DISMISS_KEY, typeof window === 'undefined' ? undefined : localStorage))
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPrompt(null)
      track('pwa_install_installed', { p: 'prompt' })
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const platform: InstallPlatform | null =
    installed || typeof window === 'undefined'
      ? null
      : chooseHint({
          authenticated: isAuthenticated,
          standalone: isStandalone(),
          nativeShell: isNativeShell(),
          ios: isIOS(),
          ua: navigator.userAgent,
          visits,
          dismissedAt,
          now: Date.now(),
          hasPrompt: prompt !== null,
        })

  useEffect(() => {
    if (platform) track('pwa_install_shown', { p: platform })
  }, [platform])

  if (!platform) return null

  function dismiss() {
    const now = String(Date.now())
    try {
      localStorage.setItem(DISMISS_KEY, now)
    } catch {
      // Storage can be blocked; the hint then simply returns next visit.
    }
    setDismissedAt(now)
  }

  async function install() {
    if (!prompt) return
    track('pwa_install_clicked', { p: 'prompt' })
    await prompt.prompt()
    await prompt.userChoice.catch(() => null)
    setPrompt(null)
  }

  return (
    <div
      role="region"
      aria-label={INSTALL_TITLE}
      className="fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md rounded-2xl border border-tint/[0.1] bg-surface-1 p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink-primary">{INSTALL_TITLE}</div>
          {platform === 'prompt' ? (
            <p className="mt-1 text-xs text-ink-secondary">{INSTALL_BODY}</p>
          ) : (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-ink-secondary">
              <Share size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
              {platform === 'ios' ? INSTALL_IOS_STEPS : INSTALL_IOS_IN_APP}
            </p>
          )}
          {platform === 'prompt' && (
            <button
              type="button"
              onClick={install}
              className="mt-3 flex items-center gap-1.5 rounded-lg bg-family-500/20 border border-family-500/30 px-3 py-1.5 text-xs font-semibold text-family-300"
            >
              <Download size={12} aria-hidden /> {INSTALL_BUTTON}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={INSTALL_DISMISS}
          className="flex-shrink-0 rounded-lg p-1 text-ink-tertiary"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
