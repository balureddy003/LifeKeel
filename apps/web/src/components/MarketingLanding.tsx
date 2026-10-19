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
import { Security } from './landing/Security'
import { PlusSpotlight } from './landing/PlusSpotlight'
import { Pricing } from './landing/Pricing'
import { Faq } from './landing/Faq'
import { SiteFooter } from './landing/SiteFooter'
import { MarkedRoute } from './landing/MarkedRoute'
import { YearsTimelapse } from './landing/YearsTimelapse'
import { StickyCta } from './landing/StickyCta'
import { Menu, X } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { appUrl } from '@/lib/region'

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

      {/* The marked route and the years: previews of what is planned and how the chart grows. */}
      <div className="landing">
        <MarkedRoute />
        <YearsTimelapse />
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

      {/* Security, Keel Plus, pricing and FAQ in the landing look (PRD-209). */}
      <div className="landing">
        <Security />
        <PlusSpotlight />
        <Pricing />
        <Faq />
      </div>

      {/* The close: same sea at dawn, one signup link (PRD-209). */}
      <div className="landing">
        <DawnClose />
      </div>
      <div className="landing">
        <StickyCta />
      </div>

      <div className="landing">
        <SiteFooter />
      </div>
    </div>
  )
}
