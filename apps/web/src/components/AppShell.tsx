'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Home, Inbox, Users, AlertTriangle, Settings, WifiOff, Siren, Network, Bot } from 'lucide-react'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import { useAuth } from '@/lib/auth-context'
import { useMode } from '@/lib/mode-context'
import { MeshGradient, Skeleton, SkeletonCard } from './Glass'
import { EmergencyMode } from './EmergencyMode'
import { CommandPalette } from './CommandPalette'
import { DisclaimerFooter } from './Disclaimer'
import { MarketingLanding } from './MarketingLanding'
import { NavRail } from './NavRail'
import { haptic } from '@/lib/haptics'

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/family', label: 'Family', icon: Users },
  { href: '/events', label: 'Events', icon: AlertTriangle },
  { href: '/settings', label: 'Settings', icon: Settings },
]

// Routes that live under a tab but aren't nested under its path segment,
// so the prefix match below can't find them on its own.
const ROUTE_TAB_OVERRIDES: Record<string, string> = {
  '/member': '/family',
  '/asset': '/family',
}

function LiquidTabBar() {
  const pathname = usePathname()
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const overrideEntry = Object.entries(ROUTE_TAB_OVERRIDES).find(([prefix]) =>
      pathname.startsWith(prefix)
    )
    const effectivePath = overrideEntry ? overrideEntry[1] : pathname
    const idx = NAV_ITEMS.findIndex((item) =>
      item.href === '/' ? effectivePath === '/' : effectivePath.startsWith(item.href)
    )
    setActiveIndex(idx >= 0 ? idx : 0)
  }, [pathname])

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 glass-nav safe-area-bottom">
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
                className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 relative z-10"
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
                  className="relative z-10"
                >
                  <item.icon
                    size={22}
                    strokeWidth={active ? 2.5 : 2}
                    // Inactive color is a hardcoded literal (not the
                    // text-ink-tertiary Tailwind class) so it silently drifted
                    // out of sync when ink.tertiary was fixed for contrast
                    // elsewhere — confirmed live via a contrast sweep on this
                    // exact nav: 3.85:1 against the dark surface, below WCAG
                    // AA's 4.5:1. Matches ink.tertiary's current value now.
                    // (Active color is a separate literal, not this token —
                    // left as-is: it already passes at 5.09:1, and syncing it
                    // to the current, deliberately-darkened family-500 token
                    // would drop it to 4.42:1, since that token was tuned for
                    // white-text-on-purple-background, a different pairing.)
                    color={active ? '#7c6ef0' : '#7b7b91'}
                  />
                </motion.div>
                <motion.span
                  className="text-[10px] font-semibold relative z-10"
                  animate={{ color: active ? '#7c6ef0' : '#7b7b91' }}
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
          className="fixed top-0 left-0 right-0 z-50 glass safe-area-top px-4 py-2 flex items-center justify-center gap-2"
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

function EmergencyButton() {
  const { config, activateEmergency } = useMode()
  if (!config.showEmergencyButton) return null

  return (
    <motion.button
      onClick={() => {
        haptic('heavy')
        activateEmergency()
      }}
      whileTap={{ scale: 0.9 }}
      className="fixed bottom-32 right-4 z-40 w-12 h-12 rounded-full flex items-center justify-center"
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
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <Siren size={20} color="#fff" />
      </motion.div>
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{ border: '2px solid rgba(248,113,113,0.4)' }}
        animate={{ scale: [1, 1.4], opacity: [0.6, 0] }}
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
// already existed in the repo — unused, imported by nothing — but it
// answered from a local hardcoded lookup table, not the real grounded
// PRD-101 endpoint /assistant/page.tsx correctly calls. Rather than
// resurrect a second, wrong chat implementation, this reuses the one real
// implementation by linking straight to it.
function AskOakButton({ stacked }: { stacked: boolean }) {
  const router = useRouter()
  return (
    <motion.button
      onClick={() => {
        haptic('light')
        router.push('/assistant')
      }}
      whileTap={{ scale: 0.9 }}
      className={`fixed right-4 z-40 w-12 h-12 rounded-full flex items-center justify-center ${stacked ? 'bottom-52' : 'bottom-32'}`}
      style={{
        background: 'linear-gradient(135deg, #8b80f8, #6b5ce0)',
        border: '1px solid rgba(255,255,255,0.2)',
        boxShadow: '0 12px 24px -6px rgba(0,0,0,0.55), 0 8px 20px rgba(139,128,248,0.3)',
      }}
      aria-label="Ask Oak"
    >
      <Bot size={20} color="#fff" />
    </motion.button>
  )
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, family } = useAuth()
  const pathname = usePathname()

  const isAuthRoute = pathname.startsWith('/welcome') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/family-setup') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/support') ||
    pathname.startsWith('/readiness') ||
    pathname.startsWith('/blog')

  if (isLoading) {
    return (
      <div className="max-w-md md:max-w-xl lg:max-w-2xl mx-auto px-5 pt-6 pb-20 space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
        <SkeletonCard lines={2} />
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-2xl border border-white/[0.05] bg-white/[0.03] p-4 flex items-center gap-3">
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
    return <MarketingLanding />
  }

  if (!isAuthenticated && !isAuthRoute) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center min-h-screen px-6 text-center"
      >
        <div className="w-16 h-16 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-6">
          <Network size={32} className="text-family-400" />
        </div>
        <h1 className="text-3xl font-bold mb-2 text-gradient">Agent Oak</h1>
        <p className="text-ink-tertiary mb-8 max-w-xs">
          Your family&apos;s first responder for financial emergencies &mdash; ready before you need it.
        </p>
        <div className="w-full max-w-xs space-y-3">
          <Link href="/welcome" className="block">
            <motion.button
              whileTap={{ scale: 0.96 }}
              className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base shadow-md shadow-family-500/15 active:opacity-90"
            >
              Get Started
            </motion.button>
          </Link>
          <Link href="/login" className="block">
            <motion.button
              whileTap={{ scale: 0.96 }}
              className="w-full glass text-ink-primary font-semibold rounded-2xl py-4 text-base"
            >
              I already have an account
            </motion.button>
          </Link>
        </div>
      </motion.div>
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

  return <>{children}</>
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { isAuthenticated, family } = useAuth()
  const { config, emergencyActive, deactivateEmergency } = useMode()
  const router = useRouter()

  const isAuthRoute = pathname.startsWith('/welcome') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/family-setup') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/support') ||
    pathname.startsWith('/readiness') ||
    pathname.startsWith('/blog')

  const showNav = isAuthenticated && family && !isAuthRoute
  const showEmergency = showNav && pathname !== '/assistant' && config.showEmergencyButton
  const showAskOak = showNav && pathname !== '/assistant'

  // Below md, LiquidTabBar owns the bottom band and this reserves scroll
  // room for it. At md+ NavRail replaces it (a left rail, no bottom band),
  // so only a small resting gutter is needed there — not the full
  // bottom-bar-sized one. When both floating buttons stack (Ask Oak above
  // Emergency), the reserved band needs to be taller than either alone.
  const bottomPadding =
    showEmergency && showAskOak ? 'pb-56 md:pb-10' :
    showEmergency || showAskOak ? 'pb-32 md:pb-10' :
    showNav ? 'pb-20 md:pb-10' : ''
  // The floating button(s) sit fixed bottom-right, independent of scroll
  // position — without a matching permanent gutter, any list row that
  // happens to render in that band sits underneath and gets its text/tap
  // target covered, not just during a scroll gesture but at rest on first
  // load. Reserving the space here (rather than hunting down every list row
  // across every page) guarantees it never happens.
  const emergencyGutter = showEmergency || showAskOak ? 'pr-16' : ''

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
  const widthClass = isMarketingPage ? '' : 'max-w-md md:max-w-xl lg:max-w-2xl mx-auto'
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
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-xl focus:bg-family-500 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <MeshGradient />
      <OfflineBanner />
      <ModeEffects />
      {showNav && <NavRail />}
      <div className={[railGutter, 'min-h-screen'].filter(Boolean).join(' ')}>
        <div id="main-content" tabIndex={-1} className={[widthClass, bottomPadding, emergencyGutter, 'pt-2 relative z-10 outline-none'].filter(Boolean).join(' ')}>
          <AuthGate>{children}</AuthGate>
          {showNav && <DisclaimerFooter />}
        </div>
      </div>
      {showNav && <LiquidTabBar />}
      {showEmergency && <EmergencyButton />}
      {showAskOak && <AskOakButton stacked={!!showEmergency} />}
      <EmergencyMode
        active={emergencyActive}
        onDeactivate={deactivateEmergency}
        onSelectEvent={(eventId) => router.push(`/events/${eventId}`)}
      />
      <CommandPalette />
      <PwaInit />
    </div>
  )
}
