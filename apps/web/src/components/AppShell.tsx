'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Home,
  Inbox,
  Users,
  CalendarClock,
  Settings,
  WifiOff,
  Siren,
  Bot,
  MailWarning,
  Wallet,
  X,
  Fingerprint,
} from 'lucide-react'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import { useAuth } from '@/lib/auth-context'
import { InstallHint } from '@/components/InstallHint'
import { useMode } from '@/lib/mode-context'
import { useAppStore } from '@/lib/store'
import { MeshGradient, Skeleton, SkeletonCard } from './Glass'
import { EmergencyMode } from './EmergencyMode'
import { CommandPalette } from './CommandPalette'
import { DisclaimerFooter } from './Disclaimer'
import {
  fetchInboxItems,
  fetchFamilyInsights,
  fetchPublicStatus,
  resendVerificationEmail,
  type PublicStatus,
} from '@/lib/api'
import { flushMutationQueue } from '@/lib/offline-queue'
import { warmCache } from '@/lib/fetch-cache'
import { useToast } from './Toast'
import { AuthShell } from '@/components/landing/AuthShell'
import { MarketingLanding } from './MarketingLanding'
import { NavRail } from './NavRail'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { isNativeShell, biometricLockEnabled, verifyBiometric } from '@/lib/native'

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/family', label: 'Family', icon: Users },
  { href: '/finances', label: 'Finances', icon: Wallet },
  { href: '/events', label: 'Events', icon: CalendarClock },
  { href: '/settings', label: 'Settings', icon: Settings },
]

// Routes that live under a tab but aren't nested under its path segment,
// so the prefix match below can't find them on its own.
const ROUTE_TAB_OVERRIDES: Record<string, string> = {
  '/member': '/family',
  '/asset': '/family',
  '/financial-profile': '/finances',
  '/vault': '/finances',
  '/cashflow': '/finances',
  '/assets': '/finances',
  '/documents': '/finances',
  '/upload': '/finances',
  '/connect': '/finances',
}

function LiquidTabBar() {
  const pathname = usePathname()
  const [activeIndex, setActiveIndex] = useState(0)
  const inboxUnreadCount = useAppStore((s) => s.inboxUnreadCount)

  useEffect(() => {
    const overrideEntry = Object.entries(ROUTE_TAB_OVERRIDES).find(([prefix]) =>
      pathname.startsWith(prefix),
    )
    const effectivePath = overrideEntry ? overrideEntry[1] : pathname
    const idx = NAV_ITEMS.findIndex((item) =>
      item.href === '/' ? effectivePath === '/' : effectivePath.startsWith(item.href),
    )
    setActiveIndex(idx >= 0 ? idx : 0)
  }, [pathname])

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-nav glass-nav safe-area-bottom">
      <div className="max-w-md mx-auto px-4 pb-1 pt-1.5 relative">
        <div className="flex items-center justify-around h-16 relative">
          {NAV_ITEMS.map((item, i) => {
            const active = i === activeIndex
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                onClick={() => haptic('light')}
                className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 relative z-raised"
              >
                {active && (
                  <motion.div
                    layoutId="tab-pill"
                    className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-10 h-8 rounded-full bg-family-500/10"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <motion.div
                  animate={{ scale: active ? 1.05 : 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="relative z-raised"
                >
                  {/* Token classes, not literals — the previous hardcoded
                      hexes drifted out of sync with ink.tertiary's contrast
                      fix once already. family.accent is deliberately lighter
                      than family-500 for icon/text-on-dark contrast; see
                      tailwind.config.js. */}
                  <item.icon
                    size={22}
                    strokeWidth={active ? 2.5 : 2}
                    className={active ? 'text-family-accent' : 'text-ink-tertiary'}
                  />
                  {item.href === '/inbox' && inboxUnreadCount > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold px-1 leading-none"
                    >
                      {inboxUnreadCount > 9 ? '9+' : inboxUnreadCount}
                    </motion.span>
                  )}
                </motion.div>
                <motion.span
                  className={`text-caption font-semibold relative z-raised ${active ? 'text-family-accent' : 'text-ink-tertiary'}`}
                >
                  {item.label}
                </motion.span>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

function OfflineBanner() {
  const { connected } = useNetworkStatus()
  return (
    <AnimatePresence>
      {!connected && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          role="status"
          aria-live="polite"
          className="fixed top-0 left-0 right-0 z-banner glass safe-area-top px-4 py-2 flex items-center justify-center gap-2"
        >
          <WifiOff size={16} className="text-warning flex-shrink-0" />
          <span className="text-sm text-warning font-medium">
            You&apos;re offline — your data is still available
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Operator-controlled maintenance mode 503s every non-operator API route,
// which without this banner surfaces as every page silently failing. /status
// is exempt from the 503 so this is the one signal that still gets through.
// Polls slowly — the flag flips rarely, and a 60s lag on a banner is fine.
function MaintenanceBanner() {
  const [status, setStatus] = useState<PublicStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = () =>
      fetchPublicStatus().then((s) => {
        if (!cancelled) setStatus(s)
      })
    check()
    const id = window.setInterval(check, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const win = status?.maintenance_window
  const windowText = win
    ? `${win.message} (${new Date(win.starts_at).toLocaleString()} – ${new Date(win.ends_at).toLocaleTimeString()})`
    : null

  return (
    <AnimatePresence>
      {status?.maintenance_mode && (
        <motion.div
          key="maintenance"
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          role="alert"
          className="fixed top-0 left-0 right-0 z-banner glass safe-area-top px-4 py-2 flex items-center justify-center gap-2"
        >
          <Siren size={16} className="text-warning flex-shrink-0" />
          <span className="text-sm text-warning font-medium">
            Scheduled maintenance — things may not load right now. Back shortly.
          </span>
        </motion.div>
      )}
      {!status?.maintenance_mode && windowText && (
        <motion.div
          key="window"
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          role="status"
          className="fixed top-0 left-0 right-0 z-banner glass safe-area-top px-4 py-2 flex items-center justify-center gap-2"
        >
          <Siren size={16} className="text-family-400 flex-shrink-0" />
          <span className="text-sm text-ink-secondary font-medium">{windowText}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Signed-in but unverified email — the other side of /verify-email.
// Without this the verification email is a dead end: nothing in the app
// ever told the user it existed or offered a resend. Dismisses per
// session (not permanently — it's a trust property, not a promo) and
// clears itself once the account flips to verified.
const VERIFY_BANNER_DISMISSED = 'keel:verify-banner-dismissed'

function VerifyEmailBanner() {
  const { isAuthenticated, user } = useAuth()
  const [dismissed, setDismissed] = useState(true)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(VERIFY_BANNER_DISMISSED) === '1')
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
      sessionStorage.setItem(VERIFY_BANNER_DISMISSED, '1')
    } catch {
      /* private mode */
    }
  }

  const show = isAuthenticated && user?.emailVerified === false && !dismissed

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          role="status"
          aria-live="polite"
          className="relative z-banner glass safe-area-top px-4 py-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center"
        >
          <MailWarning size={16} className="text-warning flex-shrink-0" />
          <span className="text-sm text-ink-secondary font-medium">
            {state === 'sent'
              ? 'Verification link sent — check your inbox'
              : state === 'error'
                ? "Couldn't send the link — try again in a moment"
                : 'Verify your email so invites and recovery reach you'}
          </span>
          {state !== 'sent' && (
            <button
              onClick={resend}
              disabled={state === 'sending'}
              className="text-sm text-family-400 font-semibold disabled:opacity-50"
            >
              {state === 'sending' ? 'Sending…' : 'Resend link'}
            </button>
          )}
          <button onClick={dismiss} aria-label="Dismiss" className="text-ink-tertiary">
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * PRD-141/139: a click from a Quiet Care digest lands with ?src=digest&v=<variant>;
 * a click from an alert with ?src=alert&i=<insight id>. Record it once and strip
 * the tag from the address bar. Clicks, not opens: no email carries a tracking
 * pixel. The alert click is what counts as a response to an alert.
 */
export function DigestClickTracker() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    const src = q.get('src')
    const v = q.get('v')
    const i = q.get('i')
    if (src === 'digest' && v) track('digest_click', { v })
    else if (src === 'alert' && i) track('alert_click', { i })
    else return
    q.delete('src')
    q.delete('v')
    q.delete('i')
    const rest = q.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
    )
  }, [])
  return null
}

function PwaInit() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  }, [])
  return null
}

function ModeEffects() {
  const { config } = useMode()
  useEffect(() => {
    document.documentElement.style.fontSize = `${config.fontSize}px`
    return () => {
      document.documentElement.style.fontSize = ''
    }
  }, [config.fontSize])
  return null
}

// Deliberately a wider labeled pill, not a same-size/same-shape circle
// like AskKeelButton below — the two floating buttons used to differ only
// by color (purple vs red), which fails colorblind users and is exactly
// the wrong differentiator under crisis stress, when a mis-tap matters
// most. Shape + a text label make this unmistakable at a glance.
//
// SOS also sits at the TOP of the floating stack (bottom-52), not beside
// the nav bar — Ask Keel owns the bottom-32 slot nearest the thumb. The
// dangerous mis-tap direction is wanting chat and hitting emergency; with
// SOS a full button-height above Ask Keel, a fumbled Ask Keel tap lands on
// the tab bar or empty space, never on the emergency sequence.
function EmergencyButton() {
  const { config, activateEmergency } = useMode()
  if (!config.showEmergencyButton) return null

  return (
    <motion.button
      onClick={() => {
        haptic('heavy')
        activateEmergency()
      }}
      whileTap={{ scale: 0.95 }}
      className="fixed bottom-52 right-4 z-fab h-12 pl-3 pr-4 rounded-full flex items-center gap-1.5"
      style={{
        background: 'linear-gradient(135deg, #f87171, #dc2626)',
        border: '1px solid rgba(255,255,255,0.2)',
        // Dark elevation shadow (not just the red glow) so this reads as a
        // layer floating above the page, not as part of whatever row it
        // happens to be scrolled over.
        boxShadow: '0 12px 24px -6px rgba(0,0,0,0.55), 0 8px 20px rgba(248,113,113,0.3)',
      }}
      aria-label="Emergency"
    >
      <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }}>
        <Siren size={18} color="#fff" />
      </motion.div>
      <span className="text-xs font-bold text-white tracking-wide">SOS</span>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ border: '2px solid rgba(248,113,113,0.4)' }}
        animate={{ scale: [1, 1.25], opacity: [0.6, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </motion.button>
  )
}

// The AI assistant — one of the product's two named differentiators — had
// no persistent entry point anywhere in the app. The only way in was the
// header search icon opening a Cmd+K-style command palette that displays
// desktop keyboard-shortcut hints ("G A") to a touch-only mobile user who
// can't use either. A component for exactly this (AIFloatingButton.tsx)
// existed in the repo — unused, imported by nothing, since deleted — but
// it answered from a local hardcoded lookup table, not the real grounded
// PRD-101 endpoint /assistant/page.tsx correctly calls. Rather than
// resurrect a second, wrong chat implementation, this reuses the one real
// implementation by linking straight to it.
function AskKeelButton({ context }: { context?: string }) {
  const router = useRouter()
  return (
    <motion.button
      onClick={() => {
        haptic('light')
        router.push(context ? `/assistant?context=${encodeURIComponent(context)}` : '/assistant')
      }}
      whileTap={{ scale: 0.9 }}
      // Always the bottom slot (bottom-32): the frequent, harmless action
      // stays nearest the thumb; SOS — the dangerous mis-tap — is above it.
      className="fixed bottom-32 right-4 z-fab w-12 h-12 rounded-full flex items-center justify-center"
      style={{
        background: 'rgb(var(--family-500))',
        border: '1px solid rgb(var(--tint) / 0.15)',
        boxShadow: '0 12px 24px -6px rgba(0,0,0,0.35)',
      }}
      aria-label="Ask Keel"
    >
      <Bot size={20} color="rgb(var(--on-cta))" />
    </motion.button>
  )
}

// Public content pages. They do not depend on who is signed in, so they render straight away
// instead of waiting behind the auth check: the static HTML a search engine fetches then holds
// the page's text, not a loading skeleton (PRD-210, phase 1).
const PUBLIC_CONTENT_PREFIXES = [
  '/blog',
  '/guides',
  '/terms',
  '/privacy',
  '/cookies',
  '/legal',
  '/support',
  '/readiness',
  '/trust',
  '/security',
]

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, family } = useAuth()
  const pathname = usePathname()
  const isPublicContent = PUBLIC_CONTENT_PREFIXES.some((p) => pathname.startsWith(p))

  // "/" also renders the marketing page while the auth check runs, so it is in the static HTML.
  // A device with a stored session gets the skeleton instead: the layout's inline script sets
  // data-session before first paint, which hides the landing wrapper in CSS (no flash). The hint
  // is cleared once the check says nobody is signed in, so a stale one cannot hide the page.
  const [sessionHint, setSessionHint] = useState(false)
  useEffect(() => {
    setSessionHint(document.documentElement.dataset.session === '1')
  }, [])
  useEffect(() => {
    if (!isLoading && !isAuthenticated) delete document.documentElement.dataset.session
  }, [isLoading, isAuthenticated])

  // /operator is exempt too: the operator shell has its own OperatorGate
  // (a logged-in operator with no family group would otherwise hit the
  // "Set up your family" wall and never reach the console).
  const isAuthRoute =
    pathname.startsWith('/welcome') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/family-setup') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/verify-email') ||
    pathname.startsWith('/account-deleted') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/cookies') ||
    pathname.startsWith('/legal') ||
    pathname.startsWith('/trust') ||
    pathname.startsWith('/security') ||
    pathname.startsWith('/support') ||
    pathname.startsWith('/readiness') ||
    pathname.startsWith('/blog') ||
    pathname.startsWith('/guides') ||
    pathname.startsWith('/operator') ||
    pathname.startsWith('/invite')

  if (isLoading && pathname === '/' && !sessionHint) {
    return (
      <div className="lk-landing-gate">
        <MarketingLanding />
      </div>
    )
  }

  if (isLoading && !isPublicContent && (pathname !== '/' || sessionHint)) {
    return (
      <div className="max-w-md md:max-w-xl lg:max-w-3xl xl:max-w-4xl mx-auto px-5 pt-6 pb-20 space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
        <SkeletonCard lines={2} />
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-tint/[0.05] bg-tint/[0.03] p-4 flex items-center gap-3"
            >
              <Skeleton className="h-10 w-10 rounded-2xl flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // The public front door — anyone landing on "/" logged out sees the real
  // marketing page instead of a bare "Get Started" screen, using the same
  // real navigation (/welcome, /login, /terms, /privacy) as the rest of the
  // app rather than a disconnected standalone page with dead-end links.
  if (!isAuthenticated && pathname === '/') {
    // Same wrapper as the loading render above, so the page is not remounted when the check ends.
    return (
      <div className="lk-landing-gate">
        <MarketingLanding />
      </div>
    )
  }

  if (!isAuthenticated && !isAuthRoute) {
    // Any app route (or unknown page) reached while signed out: a plain sign-in prompt in the
    // landing look, not the old purple screen.
    return (
      <AuthShell
        title="Sign in to continue"
        sub="This page is part of a LifeKeel account. If you followed a link, sign in or create an account to open it."
      >
        <Link href="/login" className="lk-btn">
          Sign in
        </Link>
        <Link href="/signup" className="lk-btn lk-btn-quiet">
          Create your free account
        </Link>
        <Link href="/" className="lk-textlink lk-textlink-muted">
          Back to home
        </Link>
      </AuthShell>
    )
  }

  if (isAuthenticated && !family && !isAuthRoute && !pathname.startsWith('/family-setup')) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center min-h-screen px-6 text-center"
      >
        <div className="w-16 h-16 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-6">
          <Users size={32} className="text-family-400" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Set up your family</h1>
        <p className="text-ink-tertiary mb-8 max-w-xs">
          Create your family group to start protecting what matters most.
        </p>
        <Link href="/family-setup" className="w-full max-w-xs">
          <motion.button
            whileTap={{ scale: 0.96 }}
            className="w-full bg-gradient-to-b from-family-500 to-family-600 text-white font-semibold rounded-2xl py-4 text-base shadow-lg shadow-family-500/25"
          >
            Create Family Group
          </motion.button>
        </Link>
      </motion.div>
    )
  }

  return <BiometricGate>{children}</BiometricGate>
}

/** Native-shell app lock — when the user enabled biometric unlock in
 *  Settings, the authenticated app is hidden behind a device-unlock
 *  prompt on every cold start. Web platforms never see this (no
 *  biometric API exists to gate on). */
function BiometricGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(() => isNativeShell() && biometricLockEnabled())
  const prompting = useRef(false)

  const prompt = () => {
    if (prompting.current) return
    prompting.current = true
    void verifyBiometric('Unlock LifeKeel to see your family\u2019s data').then((ok) => {
      prompting.current = false
      if (ok) setLocked(false)
    })
  }

  // prompt() is stable enough for this one-shot effect — it guards on
  // prompting.current, so re-runs can't double-fire the system prompt.
  useEffect(() => {
    if (locked) prompt()
  }, [locked])

  if (!locked) return <>{children}</>

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-6">
        <Fingerprint size={32} className="text-family-400" />
      </div>
      <h1 className="text-2xl font-bold mb-2">LifeKeel is locked</h1>
      <p className="text-ink-tertiary mb-8 max-w-xs">Verify it&apos;s you to continue.</p>
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={prompt}
        className="bg-family-500 text-white font-semibold rounded-2xl py-4 px-10 text-base"
      >
        Unlock
      </motion.button>
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { isAuthenticated, user, family } = useAuth()
  const { config, emergencyActive, deactivateEmergency, setMode } = useMode()
  const router = useRouter()
  const setInboxUnreadCount = useAppStore((s) => s.setInboxUnreadCount)

  // First-run mode suggestion: an invited member who accepted as role
  // 'child' was previously landing in organizer mode — the mode switcher
  // lives buried in Settings, so a child saw the full organizer UI on
  // their own device until an adult happened to change it. Mode is a
  // per-device setting (localStorage 'family-mode', written only by an
  // explicit pick), so an absent value means "never chosen" — safe to
  // apply the roster role's sensible default exactly once. There is no
  // 'elderly' roster role, so that mode remains manual-only.
  useEffect(() => {
    if (!isAuthenticated || !user || !family) return
    try {
      if (localStorage.getItem('family-mode')) return
      const self = family.members.find((m) => m.id === user.id || m.userId === user.id)
      if (self?.role === 'child') setMode('child')
    } catch {
      // locked-down storage — leave the organizer default alone
    }
  }, [isAuthenticated, user, family, setMode])

  // Pre-seed the inbox unread badge so it shows from the first page load
  // (not only after visiting Inbox).  The Inbox page later overrides this
  // with the precise count from its loaded/filtered items.
  useEffect(() => {
    if (!isAuthenticated || !family) return
    let cancelled = false
    fetchInboxItems().then(({ items }) => {
      if (cancelled) return
      setInboxUnreadCount(items.filter((i) => !i.read).length)
    })
    // Warm the next-most-likely read on idle so Home/insights paint from
    // cache on first navigation rather than skeletoning on the wire.
    const idleId = window.setTimeout(() => warmCache('family-insights', fetchFamilyInsights), 1500)
    return () => {
      cancelled = true
      clearTimeout(idleId)
    }
    // Only on mount (auth state changing triggers a re-render anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, !!family])

  // Mirror the unread count onto the installed-PWA app icon badge — the
  // same signal iOS/Android show on a native app's icon. No-ops in
  // browsers that don't support it (iOS Safari before 16.4, most desktop).
  const inboxUnreadCount = useAppStore((s) => s.inboxUnreadCount)
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return
    const nav = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    if (inboxUnreadCount > 0) {
      nav.setAppBadge?.(inboxUnreadCount).catch(() => {})
    } else {
      nav.clearAppBadge?.().catch(() => {})
    }
  }, [inboxUnreadCount])

  // Offline write queue — replay mutations that were queued while offline.
  // Runs on mount (app reopened after a dead-connection session) and on
  // every 'online' event; a toast names what landed so the save doesn't
  // feel like it silently happened behind the user's back.
  const toast = useToast()
  useEffect(() => {
    if (!isAuthenticated) return
    const flush = async () => {
      const replayed = await flushMutationQueue()
      if (replayed > 0) {
        toast({
          message: `Back online — ${replayed} change${replayed === 1 ? '' : 's'} saved`,
          variant: 'success',
        })
      }
    }
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [isAuthenticated, toast])

  const isAuthRoute =
    pathname.startsWith('/welcome') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/family-setup') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/verify-email') ||
    pathname.startsWith('/account-deleted') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/cookies') ||
    pathname.startsWith('/legal') ||
    pathname.startsWith('/trust') ||
    pathname.startsWith('/security') ||
    pathname.startsWith('/support') ||
    pathname.startsWith('/readiness') ||
    pathname.startsWith('/blog') ||
    pathname.startsWith('/guides') ||
    pathname.startsWith('/invite')

  // The operator console ships its own header/nav in app/operator/layout.
  // Without this exclusion an operator who is also a signed-in family
  // member gets the consumer rail, tab bar, SOS/Ask Keel buttons, and the
  // phone-width wrapper layered on top of it.
  const isOperatorRoute = pathname.startsWith('/operator')

  const showNav = isAuthenticated && family && !isAuthRoute && !isOperatorRoute
  const showEmergency = showNav && pathname !== '/assistant' && config.showEmergencyButton
  const showAskKeel = showNav && pathname !== '/assistant'

  // Below md, LiquidTabBar owns the bottom band and this reserves scroll
  // room for it. At md+ NavRail replaces it (a left rail, no bottom band),
  // so only a small resting gutter is needed there — not the full
  // bottom-bar-sized one. When both floating buttons stack (Ask Keel above
  // Emergency), the reserved band needs to be taller than either alone.
  const bottomPadding =
    showEmergency && showAskKeel
      ? 'pb-56 md:pb-10'
      : showEmergency || showAskKeel
        ? 'pb-32 md:pb-10'
        : showNav
          ? 'pb-20 md:pb-10'
          : ''
  // The floating button(s) sit fixed bottom-right, independent of scroll
  // position — without a matching permanent gutter, any list row that
  // happens to render in that band sits underneath and gets its text/tap
  // target covered, not just during a scroll gesture but at rest on first
  // load. Reserving the space here (rather than hunting down every list row
  // across every page) guarantees it never happens.
  const emergencyGutter = showEmergency || showAskKeel ? 'pr-16' : ''

  // The public marketing page manages its own responsive width (it's the
  // screen most likely to actually be opened on a laptop — a link from
  // email, a search result) rather than inheriting the phone-width wrapper.
  // The authenticated app stays phone-width at compact, but widens in step
  // with NavRail appearing at md+ — a deliberately modest scale-up (not
  // "use all the space"), so existing pages built at phone-width proportions
  // don't suddenly stretch into unreadably wide line lengths. railGutter
  // reserves NavRail's own width so the content centers in what's left of
  // the viewport, not in the full viewport underneath the rail.
  const isMarketingPage = !isAuthenticated && pathname === '/'
  // The sign-in screens (AuthShell) and the public pages (PublicShell) frame themselves on the
  // same container as the landing page, so they must not inherit the phone-width wrapper.
  const ownsLayout = [
    '/welcome',
    '/signup',
    '/login',
    '/reset-password',
    '/verify-email',
    '/account-deleted',
    '/terms',
    '/privacy',
    '/trust',
    '/security',
    '/cookies',
    '/legal',
    '/support',
    '/blog',
    '/guides',
    '/readiness',
  ].some((p) => pathname.startsWith(p))
  // Signed out on an app route (or an unknown page): AuthGate shows the sign-in prompt, which frames itself.
  const signedOutFallback = !isAuthenticated && !isAuthRoute && !isOperatorRoute
  const widthClass =
    isMarketingPage || isOperatorRoute || ownsLayout || signedOutFallback
      ? ''
      : 'max-w-md md:max-w-xl lg:max-w-3xl xl:max-w-4xl mx-auto'
  const railGutter = showNav ? 'md:pl-[88px]' : ''

  return (
    <div className="min-h-screen text-ink-primary">
      {/* Live-verification finding: at md+ widths NavRail renders before
          page content in DOM order, so a keyboard user tabs through the
          logo + all 5 nav links (6 stops) on every single page before
          reaching anything the page actually says — confirmed by tracing
          real Tab presses. Standard fix (WCAG 2.4.1 Bypass Blocks): a
          link, first in tab order, hidden until focused, that jumps
          straight to the content landmark below. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-skip focus:rounded-xl focus:bg-family-500 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <MeshGradient />
      <OfflineBanner />
      <MaintenanceBanner />
      <ModeEffects />
      {showNav && <NavRail />}
      <div className={[railGutter, 'min-h-screen'].filter(Boolean).join(' ')}>
        {/* in flow, inside the rail gutter, so it pushes the page down instead of covering its header */}
        <VerifyEmailBanner />
        <div
          id="main-content"
          tabIndex={-1}
          className={[
            widthClass,
            bottomPadding,
            emergencyGutter,
            isMarketingPage || ownsLayout || signedOutFallback ? '' : 'pt-2',
            'relative z-raised outline-none',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <AuthGate>{children}</AuthGate>
          {showNav && <DisclaimerFooter />}
        </div>
      </div>
      {showNav && <LiquidTabBar />}
      {showEmergency && <EmergencyButton />}
      {showAskKeel && <AskKeelButton context={pathname} />}
      <EmergencyMode
        active={emergencyActive}
        onDeactivate={deactivateEmergency}
        // Crisis tiles go to the REAL tracked flow (/life-events) with the
        // picked type carried through — they used to land on the
        // hypothetical /events simulator, and car/property/travel had no
        // real flow at all. ?type= preselects on the confirm screen.
        onSelectEvent={(eventId) => router.push(`/life-events?type=${eventId}`)}
      />
      <CommandPalette />
      <PwaInit />
      <InstallHint />
      <DigestClickTracker />
    </div>
  )
}
