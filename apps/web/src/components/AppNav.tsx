'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { Home, Users, CalendarClock, Settings, Bot } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { haptic } from '@/lib/haptics'

// Intent 35: five items at 390px, not six — the multi-device review's own
// list (Home, What If, Ask Keel, Family, Settings). Inbox and Finances drop
// out of the bar: both are surfaced from Home (unread insights, the
// finances sections), and their routes still highlight Home below. Ask
// Keel earns a first-class slot — it was previously reachable only via
// deep links, which the same review flagged.
const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/events', label: 'What If', icon: CalendarClock },
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
  '/resilience': '/',
  '/resilience/businesses': '/',
  '/resilience/sharing': '/',
  '/briefs': '/',
  '/assets': '/',
  '/documents': '/',
  '/upload': '/',
  '/connect': '/',
}

function activeTabIndex(pathname: string): number {
  const overrideEntry = Object.entries(ROUTE_TAB_OVERRIDES).find(([prefix]) =>
    pathname.startsWith(prefix),
  )
  const effectivePath = overrideEntry ? overrideEntry[1] : pathname
  const idx = NAV_ITEMS.findIndex((item) =>
    item.href === '/' ? effectivePath === '/' : effectivePath.startsWith(item.href),
  )
  return idx >= 0 ? idx : 0
}

function UnreadBadge({ count, className }: { count: number; className: string }) {
  return (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className={`min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold px-1 leading-none ${className}`}
    >
      {count > 9 ? '9+' : count}
    </motion.span>
  )
}

export function LiquidTabBar() {
  const pathname = usePathname()
  const [activeIndex, setActiveIndex] = useState(0)
  const inboxUnreadCount = useAppStore((s) => s.inboxUnreadCount)

  useEffect(() => {
    setActiveIndex(activeTabIndex(pathname))
  }, [pathname])

  return (
    <nav className="app-bottom-nav fixed z-nav" aria-label="Primary">
      <div className="flex items-center justify-around h-[52px] relative">
        {NAV_ITEMS.map((item, i) => {
          const active = i === activeIndex
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => haptic('light')}
              className="flex min-h-[48px] h-full flex-1 flex-col items-center justify-center gap-px relative z-raised"
            >
              {active && (
                <motion.div
                  layoutId="tab-pill"
                  className="app-tab-pill absolute inset-x-0.5 inset-y-0"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <motion.div
                animate={{ scale: active ? 1.06 : 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="relative z-raised"
              >
                {/* Token classes, not literals — the previous hardcoded
                    hexes drifted out of sync with ink.tertiary's contrast
                    fix once already. family.accent is deliberately lighter
                    than family-500 for icon/text-on-dark contrast; see
                    tailwind.config.js. */}
                <item.icon
                  size={20}
                  strokeWidth={active ? 2.4 : 2}
                  className={active ? 'text-family-accent' : 'text-ink-tertiary'}
                />
                {/* The unread badge moved with Inbox to Home when the bar
                    shrank to five items — Home is where inbox content is
                    surfaced from now. */}
                {item.href === '/' && inboxUnreadCount > 0 && (
                  <UnreadBadge count={inboxUnreadCount} className="absolute -top-1.5 -right-2.5" />
                )}
              </motion.div>
              <span
                className={`text-[12px] leading-tight font-semibold relative z-raised ${active ? 'text-family-accent' : 'text-ink-tertiary'}`}
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
