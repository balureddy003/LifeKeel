'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MailWarning, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { resendVerificationEmail } from '@/lib/api'
import { bannerDismissed } from './verify-banner'

// Signed-in but unverified email — the other side of /verify-email.
// Without this the verification email is a dead end: nothing in the app
// ever told the user it existed or offered a resend. A dismissal holds for
// three days (not permanently — it's a trust property, not a promo; see
// verify-banner.ts) and the banner clears itself once the account flips to verified.
const VERIFY_BANNER_DISMISSED = 'keel:verify-banner-dismissed'

/**
 * One slim line, inset and rounded like the cards below it, so it reads as a quiet notice rather
 * than a block that pushes the page down. The dismiss control is a full 48-point target.
 */
export function VerifyEmailBanner() {
  const { isAuthenticated, user } = useAuth()
  const [dismissed, setDismissed] = useState(true)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  useEffect(() => {
    try {
      setDismissed(bannerDismissed(localStorage.getItem(VERIFY_BANNER_DISMISSED), Date.now()))
    } catch {
      /* private mode */
    }
  }, [])

  const resend = async () => {
    setState('sending')
    try {
      await resendVerificationEmail()
      setState('sent')
    } catch {
      setState('error')
    }
  }

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(VERIFY_BANNER_DISMISSED, String(Date.now()))
    } catch {
      /* private mode */
    }
  }

  const show = isAuthenticated && user?.emailVerified === false && !dismissed

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: -24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -24, opacity: 0 }}
          role="status"
          aria-live="polite"
          className="relative z-banner safe-area-top mx-3 mt-2"
        >
          <div className="glass flex min-h-[48px] items-center gap-2 rounded-full pl-4 pr-1">
            <MailWarning size={16} className="flex-shrink-0 text-warning" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-secondary">
              {state === 'sent'
                ? 'Link sent — check your inbox'
                : state === 'error'
                  ? "Couldn't send — try again"
                  : 'Verify your email'}
              {state === 'idle' && (
                <span className="hidden sm:inline"> so invites and recovery reach you</span>
              )}
            </span>
            {state !== 'sent' && (
              <button
                onClick={resend}
                disabled={state === 'sending'}
                className="min-h-[48px] flex-shrink-0 px-2 text-sm font-semibold text-family-400 disabled:opacity-50"
              >
                {state === 'sending' ? 'Sending…' : 'Resend'}
              </button>
            )}
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="flex min-h-[48px] min-w-[48px] flex-shrink-0 items-center justify-center text-ink-tertiary"
            >
              <X size={16} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
