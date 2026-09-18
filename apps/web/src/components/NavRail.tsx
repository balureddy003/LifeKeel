'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { Home, Inbox, Users, CalendarClock, Settings } from 'lucide-react'
import { haptic } from '@/lib/haptics'

// Kept in sync with LiquidTabBar's NAV_ITEMS/ROUTE_TAB_OVERRIDES in
// AppShell.tsx by hand — both read the same five destinations, but living
// in two files (one bottom-bar-shaped, one rail-shaped) means duplicating
// the list rather than sharing a broken abstraction across two very
// different layouts.
const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/family', label: 'Family', icon: Users },
  { href: '/events', label: 'Events', icon: CalendarClock },
  { href: '/settings', label: 'Settings', icon: Settings },
]

const ROUTE_TAB_OVERRIDES: Record<string, string> = {
  '/member': '/family',
  '/asset': '/family',
}

/**
 * The medium/expanded-width counterpart to LiquidTabBar — Material Design
 * 3's navigation-rail pattern (a left-edge icon+label strip) rather than
 * the same bottom bar just stretched wider. Shown only at md: and up;
 * AppShell hides LiquidTabBar at that same breakpoint so exactly one
 * navigation surface is ever visible.
 *
 * This is also the only place the Oak mark appears anywhere in the
 * authenticated app — on a phone the bottom bar carries the app's
 * identity implicitly (it's the one thing on screen after the OS chrome);
 * on a wider screen there's room for the mark itself, so it gets one.
 */
export function NavRail() {
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
    <nav
      className="hidden md:flex fixed top-0 left-0 bottom-0 z-nav w-[88px] flex-col items-center safe-area-top"
      style={{
        background: 'rgba(8, 8, 12, 0.78)',
        backdropFilter: 'blur(24px) saturate(120%)',
        WebkitBackdropFilter: 'blur(24px) saturate(120%)',
        borderRight: '1px solid rgb(var(--tint) / 0.05)',
      }}
      aria-label="Primary"
    >
      <Link
        href="/"
        onClick={() => haptic('light')}
        aria-label="Agent Oak — Home"
        className="mt-6 mb-4 flex-shrink-0 active:opacity-70 transition-opacity"
      >
        <img src="/logo/logo-mono-white.svg" alt="" width={30} height={30} />
      </Link>

      <div className="flex flex-col items-center gap-1 mt-2">
        {NAV_ITEMS.map((item, i) => {
          const active = i === activeIndex
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => haptic('light')}
              className="relative flex flex-col items-center justify-center gap-1 w-16 h-16 rounded-2xl"
            >
              {active && (
                <motion.div
                  layoutId="rail-pill"
                  className="absolute inset-0 rounded-2xl bg-family-500/10"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              {/* Token classes, not literals — same drift fix as
                  AppShell's bottom nav. See its comment / tailwind.config.js. */}
              <item.icon
                size={22}
                strokeWidth={active ? 2.5 : 2}
                className={`relative z-raised ${active ? 'text-family-accent' : 'text-ink-tertiary'}`}
              />
              <span
                className={`relative z-raised text-caption font-semibold ${active ? 'text-family-accent' : 'text-ink-tertiary'}`}
              >
                {item.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
