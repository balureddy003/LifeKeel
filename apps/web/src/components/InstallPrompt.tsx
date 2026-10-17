'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, Share, X } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { isIOS, isStandalone } from '@/lib/platform'

// The browser fires this before showing its own install UI — capturing it
// lets the app offer install at a sensible moment instead of relying on the
// browser's ambient (often hidden) affordance. Not a standard Event type.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Snooze after dismiss — install is worth one prompt a month, not every
// visit. Keyed per-tenant like the other Home dismissals.
const SNOOZE_KEY = 'lifekeel:install-prompt-dismissed'
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

function snoozeKey(): string {
  const tenant = typeof window !== 'undefined' ? localStorage.getItem('lifekeel_tenant') ?? 'anon' : 'anon'
  return `${SNOOZE_KEY}:${tenant}`
}

/**
 * "Add LifeKeel to your home screen" — the install-discovery affordance the
 * PWA was missing. Three honest states, never more than one card:
 *  - installed already → nothing renders
 *  - Android/desktop with a captured beforeinstallprompt → real Install button
 *  - iOS Safari → written instructions (Share → Add to Home Screen), the only
 *    path that exists there
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const ios = isIOS()

  useEffect(() => {
    if (isStandalone()) return
    try {
      const snoozed = Number(localStorage.getItem(snoozeKey()) ?? 0)
      if (Date.now() - snoozed < SNOOZE_MS) return
    } catch { /* locked-down storage — still eligible to show */ }

    // iOS has no prompt event — show the instructions card immediately.
    if (isIOS()) {
      setVisible(true)
      return
    }

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (!visible) return null

  const dismiss = (snooze = true) => {
    haptic('light')
    if (snooze) {
      try { localStorage.setItem(snoozeKey(), String(Date.now())) } catch { /* best effort */ }
    }
    setVisible(false)
  }

  const install = async () => {
    haptic('light')
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    // Dismissed-at-OS-level counts as a snooze; accepted never shows again
    // (isStandalone flips on next launch anyway).
    dismiss(outcome === 'dismissed')
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
          <GlassCard className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
                {ios ? <Share size={16} className="text-family-400" /> : <Download size={16} className="text-family-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink-primary">Add LifeKeel to your home screen</div>
                <p className="text-xs text-ink-tertiary mt-0.5 leading-relaxed">
                  {ios
                    ? 'Tap the Share button in Safari, then "Add to Home Screen" — it opens like an app and can send you alerts.'
                    : 'Works like an app — quick access, full screen, and alerts on this device.'}
                </p>
                {deferred && (
                  <button
                    onClick={install}
                    className="mt-2 rounded-full px-4 py-1.5 text-xs font-semibold text-white bg-family-500 active:opacity-80"
                  >
                    Install
                  </button>
                )}
              </div>
              <button onClick={() => dismiss()} aria-label="Not now" className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-tertiary active:opacity-60 flex-shrink-0">
                <X size={16} />
              </button>
            </div>
          </GlassCard>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
