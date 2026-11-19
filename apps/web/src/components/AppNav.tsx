'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Home,
  Users,
  CalendarClock,
  Settings,
  Bot,
  Inbox,
  Wallet,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { haptic } from '@/lib/haptics'

// Primary navigation, rendered two ways by AppShell: a tab bar in the
// installed app (html[data-app], see layout.tsx) and a slide-in menu in a
// browser tab, where Safari's own toolbar already crowds the bottom edge.
// globals.css decides which one shows; both stay mounted so the switch
// needs no JS.

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

// The menu has room the five-slot bar doesn't, so the two surfaces cut
// from the bar come back here.
const MENU_EXTRA_ITEMS = [
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/finances', label: 'Finances', icon: Wallet },
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

const MENU_ID = 'app-menu'

export function MobileMenu() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const inboxUnreadCount = useAppStore((s) => s.inboxUnreadCount)
  const reduceMotion = useReducedMotion()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const activeIndex = activeTabIndex(pathname)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('a[href], button')
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
      trigger?.focus()
    }
  }, [open])

  const slide = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { x: '105%' }, animate: { x: 0 }, exit: { x: '105%' } }

  const renderItem = (
    item: (typeof NAV_ITEMS)[number],
    i: number,
    active: boolean,
    badge: number,
  ) => (
    <motion.li
      key={item.href}
      initial={reduceMotion ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: reduceMotion ? 0 : 0.06 + i * 0.035,
        type: 'spring',
        stiffness: 380,
        damping: 30,
      }}
    >
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          haptic('light')
          setOpen(false)
        }}
        className={`app-menu-item ${active ? 'is-active' : ''} flex items-center gap-3 rounded-2xl px-3 py-2.5`}
      >
        <span className="app-menu-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
          <item.icon
            size={19}
            strokeWidth={active ? 2.4 : 2}
            className={active ? 'text-family-accent' : 'text-ink-secondary'}
          />
        </span>
        <span
          className={`flex-1 text-base font-semibold ${active ? 'text-family-accent' : 'text-ink-primary'}`}
        >
          {item.label}
        </span>
        {badge > 0 && <UnreadBadge count={badge} className="" />}
        <ChevronRight size={16} className="text-ink-tertiary" />
      </Link>
    </motion.li>
  )

  return (
    <>
      <motion.button
        ref={triggerRef}
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={() => {
          haptic('light')
          setOpen(true)
        }}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls={MENU_ID}
        className="app-menu-btn relative h-11 w-11 items-center justify-center rounded-full no-min-h"
      >
        <Menu size={20} className="text-ink-primary" />
        {inboxUnreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-[rgb(var(--nav-bg))]" />
        )}
      </motion.button>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-modal" id={MENU_ID}>
            <motion.div
              className="absolute inset-0 bg-black/35 backdrop-blur-[3px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              aria-hidden
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="app-menu-panel absolute flex flex-col"
              {...slide}
              transition={{ type: 'spring', stiffness: 360, damping: 36 }}
              drag={reduceMotion ? false : 'x'}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0, right: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.x > 80 || info.velocity.x > 500) setOpen(false)
              }}
            >
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <div className="flex items-center gap-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon.svg" alt="" width={28} height={28} className="rounded-lg" />
                  <span className="text-lg font-semibold tracking-tight">LifeKeel</span>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="app-menu-icon flex h-10 w-10 items-center justify-center rounded-full no-min-h"
                >
                  <X size={18} className="text-ink-secondary" />
                </button>
              </div>
              <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-4">
                <ul className="space-y-1">
                  {NAV_ITEMS.map((item, i) =>
                    renderItem(
                      item,
                      i,
                      i === activeIndex &&
                        !MENU_EXTRA_ITEMS.some((x) => pathname.startsWith(x.href)),
                      0,
                    ),
                  )}
                </ul>
                <div className="px-3 pt-5 pb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  More
                </div>
                <ul className="space-y-1">
                  {MENU_EXTRA_ITEMS.map((item, i) =>
                    renderItem(
                      item,
                      NAV_ITEMS.length + i,
                      pathname.startsWith(item.href),
                      item.href === '/inbox' ? inboxUnreadCount : 0,
                    ),
                  )}
                </ul>
              </nav>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
