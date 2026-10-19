'use client'

/**
 * The public marketing page shown at "/" to a logged-out visitor, not the compact
 * fallback AuthGate shows for any OTHER route hit while logged out.
 *
 * The story is "The Chart" (docs/prd/209-landing-chart-story.md): hero, sample day,
 * story board, cover on file, crisis steps, six promises, then pricing, FAQ and a
 * dawn close. Those scenes live in ./landing; every claim they make maps to
 * ./landing/claims.ts. This page does NOT claim Keel acts autonomously on the
 * family's behalf. See ARCHITECTURE.md for what is actually shipped.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { LandingHero } from './landing/LandingHero'
import { LandingSymbols } from './landing/LandingSymbols'
import { SampleDay } from './landing/SampleDay'
import { StoryBoard } from './landing/StoryBoard'
import { CoverOnFile } from './landing/CoverOnFile'
import { CrisisSteps } from './landing/CrisisSteps'
import { Promises } from './landing/Promises'
import { DawnClose } from './landing/DawnClose'
import {
  Lock,
  ShieldCheck,
  Trash2,
  CheckCircle2,
  Sparkles,
  ScanLine,
  Menu,
  X,
  ChevronDown,
} from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { captureLead } from '@/lib/api'
import { appUrl } from '@/lib/region'

// Warms up the upgrade pitch right before the pricing decision, the same
// "show, don't tell" pattern /upgrade's own ExtractionPreview uses — a
// visitor sees what Keel Plus actually does instead of reading a bullet point.
function LifeKeelPlusSpotlight() {
  const fields = [
    { label: 'Provider', value: 'Example Insurance Co.' },
    { label: 'Policy number', value: 'HO-88213-A' },
    { label: 'Amount', value: '£1,240/yr' },
    { label: 'Renews', value: '14 Jun 2027' },
  ]

  return (
    <div className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-16 grid lg:grid-cols-2 gap-10 items-center">
      <div className="order-2 lg:order-1">
        <div className="inline-flex items-center gap-1.5 text-footnote font-bold uppercase tracking-wide text-family-400 mb-3">
          <Sparkles size={12} /> Keel Plus
        </div>
        <h2 className="text-title-sm lg:text-title-md font-bold mb-3 leading-tight">
          Skip the retyping &mdash; Keel reads your documents for you.
        </h2>
        <p className="text-sm text-ink-secondary leading-relaxed max-w-md mb-5">
          Photograph an insurance policy or pension statement and Keel Plus pulls out the provider,
          policy number, amount, and renewal date automatically &mdash; no manual entry, no
          re-typing numbers off a PDF.
        </p>
        {/* plain <a>: /welcome lives on the app host — a <Link>'s RSC fetch dies on the cross-origin redirect (see appUrl) */}
        <a
          href={appUrl('/welcome')}
          onClick={() => {
            haptic('light')
            track('landing_get_started_click', { location: 'plus_spotlight' })
          }}
          className="inline-block"
        >
          <motion.div
            whileTap={{ scale: 0.97 }}
            className="bg-family-500 text-white font-semibold rounded-2xl py-3 px-6 text-sm text-center shadow-md shadow-family-500/15"
          >
            Try it free, upgrade anytime
          </motion.div>
        </a>
      </div>
      <div className="order-1 lg:order-2 glass rounded-2xl p-5 max-w-sm w-full mx-auto lg:mx-0">
        <div className="flex items-center gap-2 mb-4">
          <ScanLine size={16} className="text-family-400" />
          <span className="text-subhead font-semibold text-family-400">See it in action</span>
        </div>
        <div className="space-y-2">
          {fields.map((f) => (
            <div
              key={f.label}
              className="flex items-center justify-between gap-3 rounded-lg bg-family-500/[0.06] px-3 py-2"
            >
              <span className="text-footnote text-ink-tertiary flex-shrink-0">{f.label}</span>
              <span className="text-footnote font-semibold text-ink-primary truncate">
                {f.value}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-warning/10 border border-warning/25 px-3 py-2 text-caption font-semibold text-warning leading-snug">
          &#9888; Sample document &mdash; upload your own to see it for real
        </div>
      </div>
    </div>
  )
}

function FooterNewsletter() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || state === 'busy') return
    setState('busy')
    const ok = await captureLead({ email: email.trim(), source: 'landing_newsletter' })
    setState(ok ? 'done' : 'error')
  }

  if (state === 'done') {
    return (
      <p className="text-footnote text-success">
        Subscribed &mdash; we&apos;ll only send what matters.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="text-footnote text-ink-secondary leading-relaxed">
        Family-readiness tips and product updates. No spam.
      </p>
      <div className="flex gap-1.5">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="glass-input min-w-0 flex-1 rounded-lg px-3 py-2 text-xs text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40"
        />
        <button
          disabled={state === 'busy' || !email.trim()}
          className="rounded-lg bg-family-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 flex-shrink-0"
        >
          {state === 'busy' ? '...' : 'Join'}
        </button>
      </div>
      {state === 'error' && (
        <p className="text-caption text-danger">Couldn&apos;t subscribe &mdash; try again.</p>
      )}
    </form>
  )
}

function MarketingNav() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-nav border-b border-tint/[0.06] bg-navbg/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 sm:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 min-h-0">
          <img
            src="/icon.svg"
            alt=""
            width={30}
            height={30}
            className="rounded-[7px] flex-shrink-0"
          />
          <span className="text-callout font-bold tracking-tight">LifeKeel</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-subhead font-medium text-ink-secondary">
          <a href="#how-it-works" className="hover:text-ink-primary transition-colors">
            How it works
          </a>
          <a href="#features" className="hover:text-ink-primary transition-colors">
            Features
          </a>
          <a href="#pricing" className="hover:text-ink-primary transition-colors">
            Pricing
          </a>
          <a href="#security" className="hover:text-ink-primary transition-colors">
            Security
          </a>
          <a href="#faq" className="hover:text-ink-primary transition-colors">
            FAQ
          </a>
          <Link href="/guides" className="hover:text-ink-primary transition-colors">
            Guides
          </Link>
        </nav>
        <div className="flex items-center gap-4">
          <a
            href={appUrl('/login')}
            onClick={() => {
              haptic('light')
              track('landing_signin_click')
            }}
            className="hidden sm:block text-subhead font-semibold text-ink-secondary min-h-0"
          >
            Sign in
          </a>
          <a
            href={appUrl('/welcome')}
            onClick={() => {
              haptic('light')
              track('landing_get_started_click', { location: 'nav' })
            }}
          >
            <motion.div
              whileTap={{ scale: 0.96 }}
              className="bg-family-500 text-white text-subhead font-semibold rounded-xl px-4 py-2.5 whitespace-nowrap"
            >
              Get started
            </motion.div>
          </a>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden w-10 h-10 flex items-center justify-center text-ink-secondary"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {mobileOpen && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden border-t border-tint/[0.06] overflow-hidden"
          >
            <div className="px-6 py-4 space-y-3">
              {[
                { href: '#how-it-works', label: 'How it works' },
                { href: '#features', label: 'Features' },
                { href: '#pricing', label: 'Pricing' },
                { href: '#security', label: 'Security' },
                { href: '#faq', label: 'FAQ' },
                { href: '/blog', label: 'Blog' },
                { href: '/guides', label: 'Guides' },
                { href: appUrl('/login'), label: 'Sign in' },
              ].map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="block text-sm font-medium text-ink-secondary py-1.5"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}

export function MarketingLanding() {
  useEffect(() => {
    track('landing_view')
  }, [])

  return (
    <div className="min-h-screen">
      <MarketingNav />

      {/* Hero: the chart story (PRD-209). Signup goes straight to the existing sign-up page. */}
      <LandingSymbols />
      <LandingHero />

      {/* A read-only sample day (PRD-209). Keeps the #how-it-works anchor the nav links to. */}
      <div id="how-it-works" className="landing">
        <SampleDay />
      </div>

      {/* The story board, built from components/landing/capabilities.ts. Keeps the #features anchor. */}
      <div id="features" className="landing">
        <StoryBoard />
      </div>

      {/* Cover on file, crisis steps and the six promises (PRD-209). */}
      <div className="landing">
        <CoverOnFile />
        <CrisisSteps />
        <Promises />
      </div>

      {/* Trust strip */}
      <div id="security" className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <h2 className="text-title-sm lg:text-title-md font-bold text-center mb-2">
          What we actually do to protect your data
        </h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 sm:mb-10">
          Not a compliance-badge wall &mdash; just what&apos;s true.
        </p>
        <div className="grid gap-6 sm:gap-8 lg:grid-cols-3 max-w-4xl mx-auto">
          <div className="flex gap-3">
            <Lock size={18} className="text-family-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-subhead font-bold mb-0.5">Encrypted at rest</div>
              <p className="text-footnote text-ink-tertiary leading-relaxed">
                Connector passwords and access tokens are encrypted before they&apos;re ever stored
                &mdash; not just in transit.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <ShieldCheck size={18} className="text-family-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-subhead font-bold mb-0.5">Never sold</div>
              <p className="text-footnote text-ink-tertiary leading-relaxed">
                Your financial data isn&apos;t sold, and it isn&apos;t used to train models beyond
                the request that needs it.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Trash2 size={18} className="text-family-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-subhead font-bold mb-0.5">Yours to delete</div>
              <p className="text-footnote text-ink-tertiary leading-relaxed">
                Export your data or delete your account yourself from Settings &mdash; deletion is
                immediate and irreversible, no email-and-wait.
              </p>
            </div>
          </div>
        </div>
      </div>

      <LifeKeelPlusSpotlight />

      {/* Pricing — includes competitive context per market-positioning doc:
          "for less than what you pay for a streaming service, Keel watches
          whether your family is protected" */}
      <div id="pricing" className="max-w-4xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <h2 className="text-title-md lg:text-title-lg font-bold text-center mb-2">
          Less than a streaming service. More than a safety net.
        </h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 sm:mb-10 max-w-sm mx-auto">
          Continuous family protection monitoring starts free. The only paid tier adds AI document
          reading. No hidden fees, no commission revenue, no surprise charges.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 items-start">
          <div className="glass rounded-2xl p-5 sm:p-6 flex flex-col">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-callout font-bold">Free</span>
              <span className="text-subhead text-ink-tertiary">£0</span>
            </div>
            <ul className="space-y-2 flex-1">
              {[
                'Emergency Mode',
                '"What happens if...?" scenarios',
                'Readiness snapshot',
                'Document upload & storage',
                'Connect any email',
                'Family roster & command palette',
              ].map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-footnote text-ink-secondary leading-relaxed"
                >
                  <CheckCircle2 size={14} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <a
              href={appUrl('/welcome')}
              onClick={() => {
                haptic('light')
                track('landing_get_started_click', { location: 'pricing_free' })
              }}
              className="block mt-5"
            >
              <motion.div
                whileTap={{ scale: 0.97 }}
                className="w-full text-center rounded-xl py-3 text-subhead font-semibold border border-tint/[0.08] text-ink-primary"
              >
                Get started free
              </motion.div>
            </a>
          </div>
          <div className="glass rounded-2xl p-5 sm:p-6 border-family-500/30 relative flex flex-col">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-caption font-bold uppercase tracking-wide text-white bg-family-500 rounded-full px-3 py-1 shadow-md shadow-family-500/25 whitespace-nowrap">
              Recommended
            </span>
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-callout font-bold text-family-400">Keel Plus</span>
              <span className="text-subhead text-ink-tertiary">
                £7.99<span className="text-footnote">/mo</span>
              </span>
            </div>
            <ul className="space-y-2 flex-1">
              {[
                'Everything in Free',
                'AI reads your documents — provider, policy number, amount, and dates pulled automatically',
                'AI-summarized inbox — financial emails read and explained in plain language',
                'Priority support',
              ].map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-footnote text-ink-secondary leading-relaxed"
                >
                  <CheckCircle2 size={14} className="text-family-400 flex-shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href={appUrl('/welcome')}
              onClick={() => {
                haptic('light')
                track('landing_get_started_click', { location: 'pricing_plus' })
              }}
              className="block mt-5"
            >
              <motion.div
                whileTap={{ scale: 0.97 }}
                className="w-full text-center rounded-xl py-3 text-subhead font-semibold bg-family-500 text-white shadow-md shadow-family-500/15"
              >
                Start free, upgrade later
              </motion.div>
            </a>
            <p className="text-caption text-ink-tertiary text-center mt-2">
              No credit card &mdash; upgrade from your account once you&apos;re in
            </p>
          </div>
        </div>
        <p className="text-footnote text-ink-tertiary text-center mt-4">
          Cancel anytime. No credit card to start free &mdash; upgrade to Keel Plus from your
          account whenever you&apos;re ready.
        </p>
      </div>

      {/* FAQ */}
      <div id="faq" className="max-w-3xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <h2 className="text-title-md lg:text-title-lg font-bold text-center mb-2">
          Common questions
        </h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 sm:mb-10">
          Straight answers, no spin.
        </p>
        <div className="space-y-2">
          {[
            {
              q: 'Is LifeKeel financial advice?',
              a: 'No. LifeKeel is informational and educational only — not financial, investment, tax, or legal advice, and not a substitute for a licensed professional or for calling emergency services (999, 112, 911) in a real emergency.',
            },
            {
              q: 'Will Keel move money or act on my behalf?',
              a: 'No. Keel shows you what is on file and estimates possible gaps. It never moves money, buys products, or contacts anyone for you without you approving each step — and it has no commercial relationship with any insurer or provider.',
            },
            {
              q: 'How much does LifeKeel cost?',
              a: 'LifeKeel is free to start, no credit card required. Keel Plus is £7.99/month and adds AI document reading (provider, policy number, amount, and dates pulled automatically) and an AI-summarised inbox on top of everything in the free plan.',
            },
            {
              q: 'Is my financial data sold or used to train AI models?',
              a: "No. Your financial data isn't sold, and it isn't used to train models beyond the request that needs it. Connector passwords and access tokens are encrypted before they're ever stored.",
            },
            {
              q: 'Can I cancel Keel Plus anytime?',
              a: 'Yes. No credit card is required to start free, and you can cancel Keel Plus anytime from your account.',
            },
            {
              q: 'Does LifeKeel work for the whole family?',
              a: 'Yes. Add your partner and kids to your family\'s roster and every score, insight, and "what if" scenario accounts for the whole household, not just the person who signed up.',
            },
            {
              q: 'What happens to my data if I delete my account?',
              a: "You can delete your account yourself from Settings. Your family profile, documents, insights, and sign-in are deleted immediately and can't be recovered. Billing records and a minimal audit log are kept only as required.",
            },
          ].map((faq) => (
            <details key={faq.q} className="glass rounded-2xl border border-tint/[0.08] group">
              <summary className="cursor-pointer p-4 sm:p-5 flex items-center justify-between gap-3 text-sm font-semibold text-ink-primary">
                {faq.q}
                <ChevronDown
                  size={16}
                  className="text-ink-tertiary flex-shrink-0 transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="px-4 sm:px-5 pb-4 sm:pb-5 -mt-1 text-sm text-ink-secondary leading-relaxed">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </div>

      {/* The close: same sea at dawn, one signup link (PRD-209). */}
      <div className="landing">
        <DawnClose />
      </div>

      {/* Footer */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-8 border-t border-tint/[0.06]">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <img src="/icon.svg" alt="" width={24} height={24} className="rounded-[5px]" />
              <span className="text-sm font-bold">LifeKeel</span>
            </div>
            <p className="text-footnote text-ink-tertiary leading-relaxed">
              The always-on readiness system for your family. Know your numbers, have a plan, be
              ready.
            </p>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-tertiary mb-3">
              Product
            </div>
            <div className="space-y-2 text-footnote">
              <a href="#features" className="block text-ink-secondary hover:text-ink-primary">
                Features
              </a>
              <a href="#pricing" className="block text-ink-secondary hover:text-ink-primary">
                Pricing
              </a>
              <Link href="/readiness" className="block text-ink-secondary hover:text-ink-primary">
                Free readiness check
              </Link>
              <Link href="/guides" className="block text-ink-secondary hover:text-ink-primary">
                Guides
              </Link>
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-tertiary mb-3">
              Company
            </div>
            <div className="space-y-2 text-footnote">
              <Link href="/blog" className="block text-ink-secondary hover:text-ink-primary">
                Blog
              </Link>
              <Link href="/support" className="block text-ink-secondary hover:text-ink-primary">
                Support
              </Link>
              <Link href="/terms" className="block text-ink-secondary hover:text-ink-primary">
                Terms
              </Link>
              <Link href="/privacy" className="block text-ink-secondary hover:text-ink-primary">
                Privacy
              </Link>
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-tertiary mb-3">
              Stay in touch
            </div>
            <FooterNewsletter />
          </div>
        </div>
        <p className="text-caption text-ink-tertiary text-center leading-snug max-w-md mx-auto">
          For informational and educational purposes only. Not financial, investment, tax,
          insurance, or legal advice, and not a substitute for professional emergency services
          &mdash; always call your local emergency number (999, 112, 911, or the equivalent where
          you are) in a real emergency. Consult a qualified professional before making financial
          decisions.
        </p>
      </div>
    </div>
  )
}
