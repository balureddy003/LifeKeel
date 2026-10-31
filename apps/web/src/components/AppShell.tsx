'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Home,
  Users,
  CalendarClock,
  Settings,
  WifiOff,
  Siren,
  Bot,
  MailWarning,
  X,
  Fingerprint,
} from 'lucide-react'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import { useAuth } from '@/lib/auth-context'
import { useMode } from '@/lib/mode-context'
import { useAppStore } from '@/lib/store'
import { MeshGradient, Skeleton, SkeletonCard } from './Glass'
import { AppHeroHeader } from './AppHeroHeader'
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
import { isKeelPanelEnabled } from '@/lib/keel/client'
import { PANEL_ID, useKeelPanel } from '@/lib/keel/store'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { isNativeShell, biometricLockEnabled, verifyBiometric } from '@/lib/native'

// Signed-in extras load after the first paint, so the first-time visitor's landing
// download stays inside its budget (PRD-209). None render on the signed-out landing.
const EmergencyMode = dynamic(() => import('./EmergencyMode').then((m) => m.EmergencyMode), {
  ssr: false,
})
const CommandPalette = dynamic(() => import('./CommandPalette').then((m) => m.CommandPalette), {
  ssr: false,
})
const InstallHint = dynamic(() => import('@/components/InstallHint').then((m) => m.InstallHint), {
  ssr: false,
})
// The dock pulls in the whole panel tree incl. react-markdown; keep it out
// of the landing's first-load JS (scripts/check-landing-size.mjs budget).
const KeelDock = dynamic(() => import('./keel/KeelDock').then((m) => m.KeelDock), { ssr: false })

// Intent 35: five items at 390px, not six — the multi-device review's own
// list (Home, Events, Ask Keel, Family, Settings). Inbox and Finances drop
// out of the bar: both are surfaced from Home (unread insights, the
// finances sections), and their routes still highlight Home below. Ask
// Keel earns a first-class slot — it was previously reachable only via
// deep links, which the same review flagged.
const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/events', label: 'Events', icon: CalendarClock },
  { href: '/assistant', label: 'Ask Keel', icon: Bot },
  { href: '/family', label: 'Family', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
]

// Routes that live under a tab but aren't nested under its path segment,
// so the prefix match below can't find them on its own.
const ROUTE_TAB_OVERRIDES: Record<string, string> = {
  '/member': '/family',
  '/asset': '/family',
  // Inbox and the Finances subpages were dropped from the bar in the 5-item
  // cut — Home is the surface that links to them, so it's the tab that
  // stays lit while the user is there.
  '/inbox': '/',
  '/finances': '/',
  '/financial-profile': '/',
  '/vault': '/',
  '/cashflow': '/',
  '/briefs': '/',
  '/assets': '/',
  '/documents': '/',
  '/upload': '/',
  '/connect': '/',
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
    <nav className="app-bottom-nav fixed z-nav glass-nav" aria-label="Primary">
      <div className="mx-auto px-2 py-1 relative">
        <div className="flex items-center justify-around h-16 relative">
          {NAV_ITEMS.map((item, i) => {
            const active = i === activeIndex
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => haptic('light')}
                className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 relative z-raised"
              >
                {active && (
                  <motion.div
                    layoutId="tab-pill"
                    className="absolute inset-x-1 inset-y-0 rounded-2xl bg-family-500/15"
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
                  {/* The unread badge moved with Inbox to Home when the bar
                      shrank to five items — Home is where inbox content is
                      surfaced from now. */}
                  {item.href === '/' && inboxUnreadCount > 0 && (
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
                  className={`text-[12px] font-semibold relative z-raised ${active ? 'text-family-accent' : 'text-ink-tertiary'}`}
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
      className="relative h-11 pl-3 pr-3 rounded-full flex items-center gap-1.5"
      style={{
        background: 'linear-gradient(135deg, #ffafa3, #ffafa3)',
        border: '1px solid rgba(211,184,245,0.5)',
        // Dark elevation shadow (not just the red glow) so this reads as a
        // layer floating above the page, not as part of whatever row it
        // happens to be scrolled over.
        boxShadow: '0 12px 24px -6px rgba(48,36,64,0.4), 0 8px 20px rgba(255,175,163,0.3)',
      }}
      aria-label="Emergency"
    >
      <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }}>
        <Siren size={18} color="#302440" />
      </motion.div>
      <span className="text-xs font-bold tracking-wide" style={{ color: '#302440' }}>
        SOS
      </span>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ border: '2px solid rgba(255,175,163,0.4)' }}
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
  const panelEnabled = isKeelPanelEnabled()
  const panelOpen = useKeelPanel((s) => s.open && !s.minimised)
  return (
    <motion.button
      onClick={() => {
        haptic('light')
        // With the inline panel on, Keel opens beside the page the user is on.
        // Off, it falls back to the full-page chat.
        if (panelEnabled) {
          const s = useKeelPanel.getState()
          if (s.open && !s.minimised) s.closePanel()
          else s.openPanel()
        } else
          router.push(context ? `/assistant?context=${encodeURIComponent(context)}` : '/assistant')
      }}
      whileTap={{ scale: 0.9 }}
      className="relative w-11 h-11 rounded-full flex items-center justify-center"
      style={{
        background: 'rgb(var(--family-500))',
        border: '1px solid rgb(var(--tint) / 0.15)',
        boxShadow: '0 12px 24px -6px rgba(48,36,64,0.3)',
      }}
      aria-label="Ask Keel"
      {...(panelEnabled ? { 'aria-expanded': panelOpen, 'aria-controls': PANEL_ID } : {})}
    >
      <Bot size={20} color="rgb(var(--on-cta))" />
    </motion.button>
  )
}

// Pages that do not depend on who is signed in, so they render straight away instead of
// waiting behind the auth check: the static HTML a search engine fetches then holds the page's
// text, not a loading skeleton (PRD-210, phase 1). Sign-in and sign-up are here so they never
// flash the dashboard skeleton first.
const PUBLIC_CONTENT_PREFIXES = [
  '/login',
  '/signup',
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
  const { isAuthenticated, isLoading, family, familyLoadFailed, user, createFamily, refresh } =
    useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const [skipping, setSkipping] = useState(false)
  const [skipFailed, setSkipFailed] = useState(false)
  const [retryingFamily, setRetryingFamily] = useState(false)
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
  // /b/<token> brief links show their own sign-in notice and return the reader to the brief.
  const isAuthRoute =
    pathname.startsWith('/b/') ||
    pathname.startsWith('/welcome') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/family-setup') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/verify-email') ||
    pathname.startsWith('/verify-otp') ||
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
        <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="lk-btn">
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

  // "Could not check" is not "does not exist": when the /family read failed,
  // an account that has a family must get a retry, never the create screen —
  // offering to create a second roster reads as account loss (intent 34).
  if (
    isAuthenticated &&
    !family &&
    familyLoadFailed &&
    !isAuthRoute &&
    !pathname.startsWith('/family-setup')
  ) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[65dvh] px-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-warning/10 border border-warning/20 flex items-center justify-center mb-6">
          <Users size={32} className="text-warning" />
        </div>
        <h1 className="text-2xl font-bold mb-2">We couldn&apos;t load your family</h1>
        <p className="text-ink-tertiary mb-8 max-w-xs">
          You&apos;re signed in — the family data just didn&apos;t come through. Check your
          connection and try again.
        </p>
        <button
          disabled={retryingFamily}
          onClick={() => {
            setRetryingFamily(true)
            refresh().finally(() => setRetryingFamily(false))
          }}
          className="w-full max-w-xs bg-gradient-to-b from-family-500 to-family-600 text-white font-semibold rounded-2xl py-4 text-base shadow-lg shadow-family-500/25 disabled:opacity-60"
        >
          {retryingFamily ? 'Checking…' : 'Try again'}
        </button>
      </div>
    )
  }

  if (isAuthenticated && !family && !isAuthRoute && !pathname.startsWith('/family-setup')) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center min-h-[65dvh] px-4 text-center"
      >
        <div className="w-16 h-16 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-6">
          <Users size={32} className="text-family-400" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Set up your family</h1>
        <p className="text-ink-tertiary mb-8 max-w-xs">
          Add your family now, or explore LifeKeel and add their details later.
        </p>
        <Link href="/family-setup" className="w-full max-w-xs">
          <motion.button
            whileTap={{ scale: 0.96 }}
            className="w-full bg-gradient-to-b from-family-500 to-family-600 text-white font-semibold rounded-2xl py-4 text-base shadow-lg shadow-family-500/25"
          >
            Create Family Group
          </motion.button>
        </Link>
        <button
          disabled={skipping}
          onClick={() => {
            setSkipping(true)
            setSkipFailed(false)
            createFamily(`${user?.name ?? 'My'}'s Family`)
              .then(() => {
                track('family_setup_skipped')
                router.replace('/')
              })
              .catch(() => setSkipFailed(true))
              .finally(() => setSkipping(false))
          }}
          className="mt-4 text-sm font-semibold text-ink-secondary disabled:opacity-40"
        >
          {skipping ? 'Skipping…' : 'Skip for now'}
        </button>
        {skipFailed && (
          <p className="mt-2 text-xs text-danger" role="alert">
            Couldn&apos;t skip right now — please try again.
          </p>
        )}
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
    <div className="flex flex-col items-center justify-center min-h-[65dvh] px-4 text-center">
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
  const { config, emergencyActive, activateEmergency, deactivateEmergency, setMode } = useMode()
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

  // /b/<token> brief links show their own sign-in notice and return the reader to the brief.
  const isAuthRoute =
    pathname.startsWith('/b/') ||
    pathname.startsWith('/welcome') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/family-setup') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/verify-email') ||
    pathname.startsWith('/verify-otp') ||
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
  // The panel works before a family exists (bootstrap) and on /family-setup, so it has its own rule.
  const keelEligible =
    isAuthenticated && !isOperatorRoute && (!isAuthRoute || pathname.startsWith('/family-setup'))
  // Open or minimised: the panel (or its "Resume Keel" pill) is the control, so the floating button steps aside.
  const keelOpen = useKeelPanel((st) => st.open)

  const bottomPadding = showNav ? 'app-nav-space' : ''

  const isMarketingPage = !isAuthenticated && pathname === '/'
  // The sign-in screens (AuthShell) and the public pages (PublicShell) frame themselves on the
  // same container as the landing page, so they must not inherit the phone-width wrapper.
  const ownsLayout = [
    '/welcome',
    '/signup',
    '/login',
    '/reset-password',
    '/verify-email',
    '/verify-otp',
    '/account-deleted',
    '/invite',
    '/auth/callback',
    '/terms',
    '/privacy',
    '/cookies',
    '/legal',
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
      : 'app-content mx-auto w-full'
  const railGutter = showNav ? 'desk:pl-[88px]' : ''
  const showHero = !isMarketingPage && !isOperatorRoute && !ownsLayout && !signedOutFallback

  return (
    <div className={`min-h-screen text-ink-primary ${showNav ? 'app-shell-with-rail' : ''}`}>
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
      <div
        className={[railGutter, 'min-h-screen'].filter(Boolean).join(' ')}
        style={{ paddingRight: 'var(--keel-panel-w, 0px)' }}
      >
        {/* in flow, inside the rail gutter, so it pushes the page down instead of covering its header */}
        {showHero && (
          <AppHeroHeader>
            {showEmergency && <EmergencyButton />}
            {showAskKeel && <AskKeelButton context={pathname} />}
          </AppHeroHeader>
        )}
        <VerifyEmailBanner />
        <div
          id="main-content"
          tabIndex={-1}
          className={[
            widthClass,
            bottomPadding,
            isMarketingPage || ownsLayout || signedOutFallback ? '' : 'pt-2',
            'relative z-raised outline-none',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <AuthGate>{children}</AuthGate>
          {showNav && pathname !== '/assistant' && <DisclaimerFooter />}
        </div>
      </div>
      {showNav && <LiquidTabBar />}
      {(showEmergency || (showAskKeel && !keelOpen)) && (
        <div
          className="hidden desk:flex fixed bottom-8 z-fab flex-col items-end gap-4"
          // Sits beside a docked Keel panel instead of on top of it.
          style={{ right: 'calc(1rem + var(--keel-panel-w, 0px))' }}
        >
          {showEmergency && <EmergencyButton />}
          {showAskKeel && !keelOpen && <AskKeelButton context={pathname} />}
        </div>
      )}
      {isKeelPanelEnabled() && keelEligible && (
        <KeelDock
          eligible={keelEligible}
          onEmergency={() => {
            useKeelPanel.getState().closePanel()
            activateEmergency()
          }}
        />
      )}
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
