'use client'

import { useState } from 'react'
import Link from 'next/link'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { Brand } from './Brand'
import './landing.css'
import './hero.css'
import './bands.css'

const LINKS: { href: string; label: string; page?: boolean }[] = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#security', label: 'Security' },
  { href: '#faq', label: 'FAQ' },
  { href: '/guides', label: 'Guides', page: true },
]

/**
 * The public header. Its inner box is the same width and side padding as every band
 * below it, so the logo and the page content share one left edge.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false)

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
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ),
          )}
        </nav>
        <div className="lk-header-actions">
          <a className="lk-signin" href={appUrl('/login')} onClick={signIn}>
            Sign in
          </a>
          <a className="lk-btn lk-btn-sm" href={appUrl('/signup')} onClick={start}>
            Get started
          </a>
          <button
            type="button"
            className="lk-menu-btn"
            aria-expanded={open}
            aria-controls="lk-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            <span aria-hidden="true">{open ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>
      {open && (
        <nav id="lk-menu" className="lk-menu" aria-label="Menu">
          {LINKS.map((l) =>
            l.page ? (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ) : (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            ),
          )}
          <a href={appUrl('/login')} onClick={signIn}>
            Sign in
          </a>
        </nav>
      )}
    </header>
  )
}
