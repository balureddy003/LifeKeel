'use client'

import { useState } from 'react'
import Link from 'next/link'
import { captureLead } from '@/lib/api'
import { Brand } from './Brand'
import './landing.css'
import './hero.css'
import './bands.css'

function Newsletter() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error' | 'empty'>('idle')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'busy') return
    if (!email.trim()) {
      setState('empty')
      return
    }
    setState('busy')
    try {
      const ok = await captureLead({ email: email.trim(), source: 'landing_newsletter' })
      setState(ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  if (state === 'done')
    return (
      <p className="lk-fine" role="status">
        Subscribed. We will only send what matters.
      </p>
    )

  return (
    <form onSubmit={submit} className="lk-news">
      <label htmlFor="lk-news-email" className="lk-fine">
        Family-readiness tips and product updates. No spam.
      </label>
      <div className="lk-news-row">
        <input
          id="lk-news-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <button type="submit" disabled={state === 'busy'}>
          {state === 'busy' ? '...' : 'Join'}
        </button>
      </div>
      {(state === 'error' || state === 'empty') && (
        <p className="lk-fine" role="alert">
          {state === 'empty' ? 'Enter your email address.' : 'Could not subscribe. Try again.'}
        </p>
      )}
    </form>
  )
}

const PRODUCT = [
  { href: '#features', label: 'Features', local: true },
  { href: '#pricing', label: 'Pricing', local: true },
  { href: '/guides', label: 'Guides' },
]
const COMPANY = [
  { href: '/blog', label: 'Blog' },
  { href: '/support', label: 'Support' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
]

export function SiteFooter({ home = true }: { home?: boolean }) {
  return (
    <footer className="lk-band lk-footer">
      <div className="lk-foot-inner">
        <div className="lk-foot-grid">
          <div>
            <Brand />
            <p className="lk-fine">
              Your family&rsquo;s chart, kept current. Know what is on file, and where to start if
              something happens.
            </p>
          </div>
          <nav aria-label="Product">
            <p className="lk-foot-h">Product</p>
            {PRODUCT.map((l) =>
              l.local ? (
                <a key={l.href} href={home ? l.href : `/${l.href}`}>
                  {l.label}
                </a>
              ) : (
                <Link key={l.href} href={l.href}>
                  {l.label}
                </Link>
              ),
            )}
          </nav>
          <nav aria-label="Company">
            <p className="lk-foot-h">Company</p>
            {COMPANY.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div>
            <p className="lk-foot-h">Stay in touch</p>
            <Newsletter />
          </div>
        </div>
        <p className="lk-fine lk-legalline">
          For informational and educational purposes only. Not financial, investment, tax,
          insurance, or legal advice, and not a substitute for professional emergency services:
          always call your local emergency number (999, 112, 911, or the equivalent where you are)
          in a real emergency. Consult a qualified professional before making financial decisions.
        </p>
      </div>
    </footer>
  )
}
