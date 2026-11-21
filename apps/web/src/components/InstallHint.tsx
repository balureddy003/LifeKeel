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

/** Long enough for the screen to load clean and be read before anything is offered. */
const SHOW_DELAY_MS = 6000

export function InstallHint({ delayMs = SHOW_DELAY_MS }: { delayMs?: number } = {}) {
  const { isAuthenticated } = useAuth()
  const [ready, setReady] = useState(delayMs === 0)
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [visits, setVisits] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    if (delayMs === 0) return
    const t = setTimeout(() => setReady(true), delayMs)
    return () => clearTimeout(t)
  }, [delayMs])

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
    installed || !ready || typeof window === 'undefined'
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
      className="glass fixed inset-x-3 bottom-[calc(var(--app-dock-space)+64px)] z-40 mx-auto max-w-md animate-fade-in rounded-3xl py-3 pl-4 pr-1 shadow-lg desk:bottom-6"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink-primary">{INSTALL_TITLE}</div>
          {platform !== 'prompt' && (
            <p className="mt-0.5 flex items-start gap-1.5 text-sm text-ink-secondary">
              <Share size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
              {platform === 'ios' ? INSTALL_IOS_STEPS : INSTALL_IOS_IN_APP}
            </p>
          )}
        </div>
        {platform === 'prompt' && (
          <button
            type="button"
            onClick={install}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-family-500 px-4 text-sm font-semibold text-[rgb(var(--on-cta))]"
          >
            <Download size={14} aria-hidden /> {INSTALL_BUTTON}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label={INSTALL_DISMISS}
          className="flex min-h-[48px] min-w-[48px] flex-shrink-0 items-center justify-center text-ink-tertiary"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
