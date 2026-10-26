'use client'

import { useState } from 'react'
import Link from 'next/link'
import { captureLead } from '@/lib/api'
import { Turnstile, useTurnstile } from '@/components/security/Turnstile'
import { Brand } from './Brand'
import { Facebook, Instagram, Linkedin } from 'lucide-react'
import './landing.css'
import './hero.css'
import './bands.css'

function Newsletter() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error' | 'empty'>('idle')
  // The challenge script loads only once someone starts typing, so plain
  // page views of every marketing page never fetch it.
  const [engaged, setEngaged] = useState(false)
  const captcha = useTurnstile()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'busy') return
    if (!email.trim()) {
      setState('empty')
      return
    }
    if (!captcha.ready) return
    setState('busy')
    try {
      const ok = await captureLead(
        { email: email.trim(), source: 'landing_newsletter' },
        captcha.consume(),
      )
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
          maxLength={320}
          aria-describedby="lk-news-consent"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setEngaged(true)
          }}
          onFocus={() => setEngaged(true)}
          placeholder="you@example.com"
        />
        <button type="submit" disabled={state === 'busy' || (engaged && !captcha.ready)}>
          {state === 'busy' ? 'Joining…' : 'Join'}
        </button>
      </div>
      {engaged && (
        <Turnstile
          ref={captcha.ref}
          action="lead"
          appearance="interaction-only"
          onToken={captcha.onToken}
          onExpire={captcha.onExpire}
        />
      )}
      {(state === 'error' || state === 'empty') && (
        <p className="lk-fine" role="alert">
          {state === 'empty' ? 'Enter your email address.' : 'Could not subscribe. Try again.'}
        </p>
      )}
      <p id="lk-news-consent" className="lk-fine">
        By joining, you agree to receive emails from LifeKeel. Unsubscribe anytime. Read our{' '}
        <Link href="/privacy">privacy policy</Link>.
      </p>
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
  { href: '/legal', label: 'Legal & trust' },
]
const LEGAL = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/cookies', label: 'Cookies' },
  { href: '/security', label: 'Security' },
  { href: '/trust', label: 'Trust' },
  { href: '/legal/gdpr', label: 'GDPR' },
]

export function SiteFooter({ home = true }: { home?: boolean }) {
  return (
    <footer className="lk-band lk-footer">
      <div className="lk-foot-inner">
        <div className="lk-footer-intro">
          <div>
            <span className="lk-eyebrow">THE NEXT CHAPTER STARTS HERE</span>
            <h2>Life happens. Have a plan.</h2>
          </div>
          <div className="lk-footer-subscribe">
            <h3>Good things, in your inbox.</h3>
            <Newsletter />
          </div>
        </div>
        <div className="lk-foot-grid">
          <div>
            <Brand />
            <p className="lk-fine">
              Your family&rsquo;s chart, kept current. Know what is on file, and where to start if
              something happens.
            </p>
            <div className="lk-socials" role="group" aria-label="Social media — links coming soon">
              {[
                { name: 'Instagram', Icon: Instagram },
                { name: 'Facebook', Icon: Facebook },
                { name: 'LinkedIn', Icon: Linkedin },
              ].map(({ name, Icon }) => (
                <button
                  key={name}
                  type="button"
                  className="lk-social-icon"
                  disabled
                  title={`${name} — link coming soon`}
                  aria-label={`${name} — link coming soon`}
                >
                  <Icon size={19} aria-hidden="true" />
                </button>
              ))}
            </div>
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
          <nav aria-label="Legal">
            <p className="lk-foot-h">Legal</p>
            {LEGAL.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="lk-foot-bottom">
          <p className="lk-fine">
            © {new Date().getFullYear()} LifeKeel. Made for your family&rsquo;s next chapter.
          </p>
          <Link href="/cookies">Cookie settings</Link>
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
