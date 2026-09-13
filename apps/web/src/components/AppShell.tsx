'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Home, Inbox, Users, AlertTriangle, Settings, WifiOff, Siren, Loader2, Network } from 'lucide-react'
import { useNetworkStatus } from '@/lib/useNetworkStatus'
import { useAuth } from '@/lib/auth-context'
import { useMode } from '@/lib/mode-context'
import { MeshGradient } from './Glass'
import { EmergencyMode } from './EmergencyMode'
import { CommandPalette } from './CommandPalette'
import { DisclaimerFooter } from './Disclaimer'
import { MarketingLanding } from './MarketingLanding'
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
    <nav className="fixed bottom-0 left-0 right-0 z-30 glass-nav safe-area-bottom">
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
                    color={active ? '#7c6ef0' : '#6b6b80'}
                  />
                </motion.div>
                <motion.span
                  className="text-[10px] font-semibold relative z-10"
                  animate={{ color: active ? '#7c6ef0' : '#6b6b80' }}
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
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 size={40} className="animate-spin text-family-400" />
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

  const bottomPadding = showEmergency ? 'pb-32' : showNav ? 'pb-20' : ''
  // The Emergency button floats fixed at bottom-32 right-4 (a 48px circle),
  // independent of scroll position — without a matching permanent gutter,
  // any list row that happens to render in that band sits underneath it and
  // gets its text/tap-target covered, not just during a scroll gesture but
  // at rest on first load. Reserving the space here (rather than hunting
  // down every list row across every page) guarantees it never happens.
  const emergencyGutter = showEmergency ? 'pr-16' : ''

  // Every other screen in this app is deliberately phone-width even in a
  // desktop browser — that's the right call for an authenticated app shell
  // with a bottom tab bar. The public marketing page is the one screen most
  // likely to actually be opened on a laptop (a link from email, a search
  // result), so it manages its own responsive width instead of inheriting
  // the phone-width wrapper, which otherwise left it stranded as a narrow
  // column in a sea of empty space on anything wider than a phone.
  const isMarketingPage = !isAuthenticated && pathname === '/'
  const widthClass = isMarketingPage ? '' : 'max-w-md mx-auto'

  return (
    <div className="min-h-screen text-ink-primary">
      <MeshGradient />
      <OfflineBanner />
      <ModeEffects />
      <div className={[widthClass, bottomPadding, emergencyGutter, 'pt-2 relative z-10'].filter(Boolean).join(' ')}>
        <AuthGate>{children}</AuthGate>
        {showNav && <DisclaimerFooter />}
      </div>
      {showNav && <LiquidTabBar />}
      {showEmergency && <EmergencyButton />}
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
