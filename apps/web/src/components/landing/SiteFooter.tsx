'use client'

import { useState } from 'react'
import Link from 'next/link'
import { captureLead } from '@/lib/api'
import { Turnstile, useTurnstile } from '@/components/security/Turnstile'
import { Brand } from './Brand'
import { Facebook, Instagram, Linkedin, MessageCircle, type LucideIcon } from 'lucide-react'
import { socialLinks, type SocialName } from '@/lib/social-links'
import './landing.css'
import './hero.css'
import './bands.css'

// Next inlines NEXT_PUBLIC_* only for literal `process.env.X` reads, so each
// one is named here rather than passing process.env whole.
const LIVE_LINKS = new Map(
  socialLinks({
    NEXT_PUBLIC_SOCIAL_INSTAGRAM_URL: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM_URL,
    NEXT_PUBLIC_SOCIAL_FACEBOOK_URL: process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK_URL,
    NEXT_PUBLIC_SOCIAL_LINKEDIN_URL: process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN_URL,
    NEXT_PUBLIC_SOCIAL_X_URL: process.env.NEXT_PUBLIC_SOCIAL_X_URL,
    NEXT_PUBLIC_WHATSAPP_NUMBER: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER,
  }).map((l) => [l.name, l.href] as const),
)

// lucide has no X logo, so this draws the mark at the same size as its icons.
type IconProps = { size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }

function XIcon({ size = 19 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

const SOCIALS: Array<{ name: SocialName; Icon: LucideIcon | typeof XIcon }> = [
  { name: 'Instagram', Icon: Instagram },
  { name: 'Facebook', Icon: Facebook },
  { name: 'LinkedIn', Icon: Linkedin },
  { name: 'X', Icon: XIcon },
  // Shown only once a number is set: a disabled WhatsApp placeholder says nothing useful.
  ...(LIVE_LINKS.has('WhatsApp') ? [{ name: 'WhatsApp' as const, Icon: MessageCircle }] : []),
]

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
            <div className="lk-socials" role="group" aria-label="Social media">
              {SOCIALS.map(({ name, Icon }) => {
                const href = LIVE_LINKS.get(name)
                return href ? (
                  <a
                    key={name}
                    className="lk-social-icon"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer me"
                    title={name}
                    aria-label={`${name} (opens in a new tab)`}
                  >
                    <Icon size={19} aria-hidden="true" />
                  </a>
                ) : (
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
                )
              })}
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
