'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { Brand } from './Brand'
import { Moon, Sun, Menu, X, ChevronRight } from 'lucide-react'
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
  const sheet = useRef<HTMLElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const [, setTheme] = useThemePreference()

  // The sheet stays mounted so it can slide out; closed, it is inert and hidden from
  // assistive tech. Open, it locks page scroll, takes focus, keeps Tab inside it and
  // closes on Escape, handing focus back to the menu button.
  useEffect(() => {
    if (sheet.current) sheet.current.inert = !open
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        menuBtn.current?.focus()
        return
      }
      if (e.key !== 'Tab' || !sheet.current) return
      const items = sheet.current.querySelectorAll<HTMLElement>('a[href], button')
      const first = items[0]
      const last = items[items.length - 1]
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
    }
  }, [open])

  const close = () => setOpen(false)

  const signIn = () => {
    haptic('light')
    track('landing_signin_click', { location: 'nav' })
  }
  const start = () => {
    haptic('light')
    track('landing_cta_click', { location: 'nav', method: 'signup' })
  }

  return (
    <>
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
            <button
              ref={menuBtn}
              type="button"
              className="lk-menu-btn"
              aria-expanded={open}
              aria-controls="lk-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => {
                haptic('light')
                setOpen((o) => !o)
              }}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      {/* A sibling of the header, not a child: the header's backdrop-filter would make it
        the containing block for this fixed sheet. */}
      <div className="landing lk-sheet" data-open={open ? 'true' : 'false'}>
        <div className="lk-sheet-backdrop" onClick={close} aria-hidden="true" />
        <nav
          ref={sheet}
          id="lk-menu"
          className="lk-sheet-panel"
          aria-label="Menu"
          aria-hidden={!open}
        >
          <div className="lk-sheet-top">
            <Brand />
            <button
              ref={closeBtn}
              type="button"
              className="lk-sheet-close"
              aria-label="Close"
              onClick={() => {
                close()
                menuBtn.current?.focus()
              }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <ul className="lk-sheet-links">
            {LINKS.map((l, i) => (
              <li key={l.href} style={{ '--i': i } as CSSProperties}>
                {l.page ? (
                  <Link href={l.href} onClick={close}>
                    {l.label}
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                ) : (
                  <a href={href(l.href)} onClick={close}>
                    {l.label}
                    <ChevronRight size={16} aria-hidden="true" />
                  </a>
                )}
              </li>
            ))}
          </ul>
          <div className="lk-sheet-cta">
            {signedIn ? (
              <Link className="lk-btn" href="/" onClick={close}>
                Open LifeKeel
              </Link>
            ) : (
              <>
                <a className="lk-btn" href={appUrl('/signup')} onClick={start}>
                  Get started
                </a>
                <a className="lk-btn lk-btn-quiet" href={appUrl('/login')} onClick={signIn}>
                  Sign in
                </a>
              </>
            )}
          </div>
        </nav>
      </div>
    </>
  )
}
