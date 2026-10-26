'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { Brand } from './Brand'
import { Moon, Sun, Home, BookOpen, ShieldCheck, Menu } from 'lucide-react'
import { useThemePreference } from '@/lib/theme'
import './landing.css'
import './hero.css'
import './bands.css'

const LINKS: { href: string; label: string; page?: boolean }[] = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#security', label: 'Security' },
  { href: '/guides', label: 'Guides', page: true },
  { href: '/legal', label: 'Legal', page: true },
]

/**
 * The public header. Its inner box is the same width and side padding as every band
 * below it, so the logo and the page content share one left edge.
 */
/** `home` is false off the landing page, so the section links go to / first. */
export function SiteHeader({
  home = true,
  signedIn = false,
}: {
  home?: boolean
  signedIn?: boolean
}) {
  const href = (h: string) => (home || !h.startsWith('#') ? h : `/${h}`)
  const [open, setOpen] = useState(false)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const [, setTheme] = useThemePreference()

  // Escape closes the phone menu, as people expect from a disclosure.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      menuBtn.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const signIn = () => {
    haptic('light')
    track('landing_signin_click', { location: 'nav' })
  }
  const start = () => {
    haptic('light')
    track('landing_cta_click', { location: 'nav', method: 'signup' })
  }

  return (
    <header className="landing lk-header">
      <div className="lk-header-in">
        <Brand />
        <nav className="lk-nav" aria-label="Main">
          {LINKS.map((l) =>
            l.page ? (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ) : (
              <a key={l.href} href={href(l.href)}>
                {l.label}
              </a>
            ),
          )}
        </nav>
        <div className="lk-header-actions">
          <button
            type="button"
            className="lk-theme-btn"
            aria-label="Toggle light and dark theme"
            onClick={() =>
              setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
            }
          >
            <Sun className="lk-theme-sun" size={18} aria-hidden="true" />
            <Moon className="lk-theme-moon" size={18} aria-hidden="true" />
          </button>
          {signedIn ? (
            <Link className="lk-btn lk-btn-sm" href="/">
              Open LifeKeel
            </Link>
          ) : (
            <>
              <a className="lk-signin" href={appUrl('/login')} onClick={signIn}>
                Sign in
              </a>
              <a className="lk-btn lk-btn-sm" href={appUrl('/signup')} onClick={start}>
                Get started
              </a>
            </>
          )}
        </div>
      </div>
      <nav className="lk-mobile-nav" aria-label="Primary">
        <Link href="/" onClick={() => setOpen(false)}>
          <Home size={21} />
          <span>Home</span>
        </Link>
        <Link href="/guides" onClick={() => setOpen(false)}>
          <BookOpen size={21} />
          <span>Guides</span>
        </Link>
        <Link href="/security" onClick={() => setOpen(false)}>
          <ShieldCheck size={21} />
          <span>Security</span>
        </Link>
        <button
          ref={menuBtn}
          type="button"
          aria-expanded={open}
          aria-controls="lk-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          <Menu size={21} />
          <span>Menu</span>
        </button>
      </nav>
      <nav id="lk-menu" className="lk-menu" aria-label="Menu" hidden={!open}>
        {LINKS.map((l) =>
          l.page ? (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ) : (
            <a key={l.href} href={href(l.href)} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ),
        )}
        {!signedIn && (
          <>
            <a href={appUrl('/login')} onClick={signIn}>
              Sign in
            </a>
            <a href={appUrl('/signup')} onClick={start}>
              Get started
            </a>
          </>
        )}
      </nav>
    </header>
  )
}
