'use client'

/**
 * The public marketing page shown at "/" to a logged-out visitor — not the
 * compact "Agent Oak / Get Started / I already have an account" fallback
 * AuthGate shows for any OTHER route hit while logged out (a shared link to
 * /inbox, say), which stays as-is; this is specifically the front door.
 *
 * Every claim here is something verified working in the app this session —
 * no feature list, no security claim, is aspirational. In particular: this
 * page does NOT claim Oak acts autonomously on the family's behalf (the
 * "Agent Oak" product vision's Act/Escalate layer) — that isn't built yet.
 * See ARCHITECTURE.md for the full vision and what's actually shipped.
 */

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  HeartPulse,
  Wand2,
  Mail,
  MessageCircle,
  Siren,
  Command,
  Lock,
  ShieldCheck,
  Trash2,
  CheckCircle2,
  Search,
  Sparkles,
  ScanLine,
} from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { ScoreRing } from '@/components/Glass'

// `plus` marks a card whose headline capability is Oak Plus-gated (verified
// against the same free/paid split /upload and /upgrade already enforce —
// upload/connect is free, the AI reading of what you uploaded/connected is
// not). Leaving these unmarked previously meant the free feature grid quietly
// promised a paid capability, which undercuts both the page's own "no feature
// here is aspirational" claim and the upgrade pitch itself.
const FEATURES = [
  { icon: Siren, color: '#fbbf24', title: 'Emergency Mode', body: 'One tap, always reachable, drops straight into a guided checklist for the situation you’re actually in — no menu hunting under stress.' },
  { icon: MessageCircle, color: '#4ade80', title: '"What happens if...?" — answered', body: '"What happens if I lose my job?" gets a real, specific answer built from your data — not a canned FAQ, and not advice, just what you told Oak.' },
  { icon: HeartPulse, color: '#f87171', title: 'A readiness snapshot, not a score to chase', body: 'Protection, wealth, goals, and savings, read from what you’ve told Oak — a starting point for your own plan, not a recommendation.' },
  { icon: Wand2, color: '#60a5fa', title: 'Upload a document, skip the retyping', body: 'Photograph an insurance policy or pension statement to store it securely, free. Oak Plus reads the provider, policy number, amount, and dates for you automatically.', plus: true },
  { icon: Mail, color: '#9c92ff', title: 'Connect any email, not just Gmail', body: 'Gmail, Outlook, Yahoo, iCloud, or your own domain — free to connect. Oak Plus summarizes every financial email in plain language as it arrives.', plus: true },
  { icon: Command, color: 'rgb(var(--family-400))', title: 'A command palette, if you want it', body: 'Cmd+K jumps anywhere in the app instantly. Built for the parent who wants an answer in three seconds, not three taps.' },
]

// A real product mockup, not another icon tile — reuses the same ScoreRing
// component the actual signed-in dashboard renders (apps/web/src/app/page.tsx),
// with clearly-labeled sample scores, so the desktop hero shows the honest
// equivalent of a screenshot instead of an abstract illustration.
function HeroPreview() {
  const rings = [
    { label: 'Protection', score: 82 },
    { label: 'Wealth', score: 68 },
    { label: 'Goals', score: 91 },
    { label: 'Savings', score: 74 },
  ]
  const checklist = [
    'Review health insurance coverage details',
    'Check pre-authorization requirements',
    'Confirm annual out-of-pocket maximum',
  ]

  return (
    <div className="glass rounded-3xl p-5 sm:p-6 w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-callout font-bold">Your Family</div>
          <div className="text-footnote text-ink-tertiary">Sample dashboard</div>
        </div>
        <div className="w-9 h-9 rounded-full bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
          <Search size={15} className="text-family-400" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 mb-5">
        {rings.map((r) => (
          <div key={r.label} className="flex flex-col items-center gap-1.5">
            <ScoreRing score={r.score} size={56} />
            <span className="text-caption text-ink-tertiary text-center">{r.label}</span>
          </div>
        ))}
      </div>
      <div className="rounded-2xl bg-tint/[0.02] border border-tint/[0.05] p-3.5">
        <div className="flex items-center gap-2 mb-2.5">
          <Siren size={13} className="text-danger flex-shrink-0" />
          <span className="text-footnote font-semibold text-ink-secondary">Medical emergency &mdash; response plan</span>
        </div>
        <div className="space-y-2">
          {checklist.map((t) => (
            <div key={t} className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-tint/15 flex-shrink-0" />
              <span className="text-footnote text-ink-secondary leading-snug">{t}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 rounded-lg bg-warning/10 border border-warning/25 px-3 py-2 text-caption font-semibold text-warning leading-snug">
        &#9888; Sample data &mdash; connect your accounts for your family&apos;s real picture
      </div>
    </div>
  )
}

// Warms up the upgrade pitch right before the pricing decision, the same
// "show, don't tell" pattern /upgrade's own ExtractionPreview uses — a
// visitor sees what Oak Plus actually does instead of reading a bullet point.
function OakPlusSpotlight() {
  const fields = [
    { label: 'Provider', value: 'AllState Insurance' },
    { label: 'Policy number', value: 'HO-88213-A' },
    { label: 'Amount', value: '£1,240/yr' },
    { label: 'Renews', value: 'Jun 14, 2027' },
  ]

  return (
    <div className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-16 grid lg:grid-cols-2 gap-10 items-center">
      <div className="order-2 lg:order-1">
        <div className="inline-flex items-center gap-1.5 text-footnote font-bold uppercase tracking-wide text-family-400 mb-3">
          <Sparkles size={12} /> Oak Plus
        </div>
        <h2 className="text-title-sm lg:text-title-md font-bold mb-3 leading-tight">
          Skip the retyping &mdash; Oak reads your documents for you.
        </h2>
        <p className="text-sm text-ink-secondary leading-relaxed max-w-md mb-5">
          Photograph an insurance policy or pension statement and Oak Plus pulls out the provider, policy
          number, amount, and renewal date automatically &mdash; no manual entry, no re-typing numbers off a PDF.
        </p>
        <Link href="/welcome" onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'plus_spotlight' }) }} className="inline-block">
          <motion.div
            whileTap={{ scale: 0.97 }}
            className="bg-family-500 text-white font-semibold rounded-2xl py-3 px-6 text-sm text-center shadow-md shadow-family-500/15"
          >
            Try it free, upgrade anytime
          </motion.div>
        </Link>
      </div>
      <div className="order-1 lg:order-2 glass rounded-2xl p-5 max-w-sm w-full mx-auto lg:mx-0">
        <div className="flex items-center gap-2 mb-4">
          <ScanLine size={16} className="text-family-400" />
          <span className="text-subhead font-semibold text-family-400">See it in action</span>
        </div>
        <div className="space-y-2">
          {fields.map((f) => (
            <div key={f.label} className="flex items-center justify-between gap-3 rounded-lg bg-family-500/[0.06] px-3 py-2">
              <span className="text-footnote text-ink-tertiary flex-shrink-0">{f.label}</span>
              <span className="text-footnote font-semibold text-ink-primary truncate">{f.value}</span>
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

function MarketingNav() {
  return (
    <header className="sticky top-0 z-nav border-b border-tint/[0.06] bg-navbg/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 sm:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 min-h-0">
          <img src="/icon.svg" alt="" width={30} height={30} className="rounded-[7px] flex-shrink-0" />
          <span className="text-callout font-bold tracking-tight">Agent Oak</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-subhead font-medium text-ink-secondary">
          <a href="#features" className="hover:text-ink-primary transition-colors">Features</a>
          <a href="#pricing" className="hover:text-ink-primary transition-colors">Pricing</a>
          <a href="#security" className="hover:text-ink-primary transition-colors">Security</a>
          <Link href="/blog" className="hover:text-ink-primary transition-colors">Blog</Link>
          <Link href="/guides" className="hover:text-ink-primary transition-colors">Guides</Link>
        </nav>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            onClick={() => { haptic('light'); track('landing_signin_click') }}
            className="hidden sm:block text-subhead font-semibold text-ink-secondary min-h-0"
          >
            Sign in
          </Link>
          <Link href="/welcome" onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'nav' }) }}>
            <motion.div
              whileTap={{ scale: 0.96 }}
              className="bg-family-500 text-white text-subhead font-semibold rounded-xl px-4 py-2.5 whitespace-nowrap"
            >
              Get started
            </motion.div>
          </Link>
        </div>
      </div>
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

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-10 sm:pt-16 pb-10 sm:pb-20 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="max-w-lg">
          <div className="flex items-center gap-2 text-footnote font-bold tracking-wide uppercase text-family-400 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_0_3px_rgba(74,222,128,0.18)]" />
            Free to start &middot; no credit card
          </div>
          <h1 className="text-title-lg sm:text-display-sm lg:text-display leading-[1.15] font-bold tracking-tight mb-4">
            When life doesn&apos;t go to plan, <span className="text-gradient">Oak knows what to do next</span>.
          </h1>
          <p className="text-lead text-ink-secondary leading-relaxed mb-6">
            Job loss. A new baby. Retirement. Agent Oak builds your household a step-by-step playbook
            for whatever comes &mdash; so you&apos;re never starting from zero.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <Link href="/welcome" onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'hero' }) }} className="block sm:inline-block">
              <motion.div
                whileTap={{ scale: 0.97 }}
                className="sm:w-auto bg-family-500 text-white font-semibold rounded-2xl py-4 px-8 text-base text-center shadow-md shadow-family-500/15"
              >
                Get started free
              </motion.div>
            </Link>
            <Link href="/login" onClick={() => { haptic('light'); track('landing_signin_click') }} className="block sm:inline-block text-center py-2.5">
              <span className="text-sm text-ink-tertiary">Already have an account? Sign in</span>
            </Link>
          </div>
          <p className="text-footnote text-ink-tertiary leading-snug">
            Works in your browser today. Informational and educational only &mdash; not financial, investment,
            tax, or legal advice, and not a substitute for calling 911 in a real emergency.
          </p>
        </div>

        <HeroPreview />
      </div>

      {/* Proof point */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mb-16">
        <div className="glass rounded-2xl p-4 sm:p-5 flex items-start gap-3 max-w-xl mx-auto sm:mx-0">
          <span className="text-2xl font-bold text-family-400 leading-none flex-shrink-0">Only 30%</span>
          <p className="text-footnote text-ink-secondary leading-relaxed">
            of U.S. households have the documents they&apos;d actually need ready for an emergency, per FEMA&apos;s
            2023 National Household Survey on Disaster Preparedness. Agent Oak exists to close that gap before you
            need it closed.
          </p>
        </div>
        <Link
          href="/readiness"
          onClick={() => haptic('light')}
          className="mt-3 block text-center text-footnote font-semibold text-family-400"
        >
          Find your own number in 60 seconds →
        </Link>
      </div>

      {/* Honesty section */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-16 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <h2 className="text-title-md lg:text-title-lg font-bold mb-3 leading-tight">
            Most finance apps fake confidence.<br />This one doesn&apos;t.
          </h2>
          <p className="text-sm text-ink-secondary leading-relaxed max-w-md">
            Before you connect anything, Agent Oak shows sample numbers so you can see what it does &mdash; clearly
            labeled as samples, not dressed up as yours. The moment real data replaces them, the label disappears.
            Oak organizes what you tell it and helps you prepare &mdash; it doesn&apos;t recommend investments
            or tell you what to buy.
          </p>
        </div>
        <div className="glass rounded-2xl p-4 max-w-xs mx-auto lg:mx-0">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="font-bold text-success text-callout">90<span className="text-caption text-ink-tertiary font-normal"> / 100</span></span>
            <span className="text-footnote text-ink-secondary">Protection</span>
          </div>
          <div className="rounded-lg bg-warning/10 border border-warning/25 px-3 py-2 text-footnote font-semibold text-warning leading-snug">
            &#9888; Sample score &mdash; connect your data for a real one
          </div>
        </div>
      </div>

      {/* Feature grid */}
      <div id="features" className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <h2 className="text-title-md lg:text-title-lg font-bold text-center mb-2">What&apos;s actually in it</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 sm:mb-10 max-w-xs mx-auto">
          No feature here is aspirational &mdash; everything below is something you can do in the app today.
        </p>
        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="glass rounded-2xl p-4 sm:p-5 relative">
              {f.plus && (
                <span className="absolute top-4 right-4 text-caption font-bold uppercase tracking-wide text-family-400 bg-family-500/10 border border-family-500/20 rounded-full px-2 py-0.5">
                  Oak Plus
                </span>
              )}
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: `${f.color}22` }}>
                <f.icon size={17} color={f.color} strokeWidth={2} />
              </div>
              <h3 className="text-callout font-bold mb-1 pr-16">{f.title}</h3>
              <p className="text-footnote text-ink-secondary leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Family strip */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-16 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <h2 className="text-title-sm lg:text-title-md font-bold mb-3 leading-tight">
            One household, one picture &mdash; not five separate apps.
          </h2>
          <p className="text-sm text-ink-secondary leading-relaxed max-w-md">
            Add your partner and kids to your family&apos;s roster and every score, every insight, every &quot;what
            if&quot; scenario accounts for the whole household &mdash; not just the person who happened to sign up.
          </p>
        </div>
        <div>
          <p className="text-footnote text-ink-tertiary mb-2.5">Sample family, shown for illustration:</p>
          <div className="flex gap-2.5 max-w-sm">
            {[{ i: 'AC', n: 'Avery', r: 'Organizer', on: true }, { i: 'JC', n: 'Jordan', r: 'Partner' }, { i: 'SC', n: 'Sam', r: 'Child' }].map((m) => (
              <div key={m.i} className={`flex-1 rounded-2xl p-3.5 text-center border ${m.on ? 'border-family-500 bg-family-500/10' : 'border-tint/[0.06] bg-tint/[0.02]'}`}>
                <div className="w-8 h-8 rounded-full bg-tint/[0.06] mx-auto mb-2 flex items-center justify-center text-caption font-bold text-family-400">{m.i}</div>
                <div className="text-footnote font-bold">{m.n}</div>
                <div className="text-caption text-ink-tertiary">{m.r}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Trust strip */}
      <div id="security" className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <h2 className="text-title-sm lg:text-title-md font-bold text-center mb-2">What we actually do to protect your data</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 sm:mb-10">Not a compliance-badge wall &mdash; just what&apos;s true.</p>
        <div className="grid gap-6 sm:gap-8 lg:grid-cols-3 max-w-4xl mx-auto">
          <div className="flex gap-3">
            <Lock size={18} className="text-family-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-subhead font-bold mb-0.5">Encrypted at rest</div>
              <p className="text-footnote text-ink-tertiary leading-relaxed">Connector passwords and access tokens are encrypted before they&apos;re ever stored &mdash; not just in transit.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <ShieldCheck size={18} className="text-family-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-subhead font-bold mb-0.5">Never sold</div>
              <p className="text-footnote text-ink-tertiary leading-relaxed">Your financial data isn&apos;t sold, and it isn&apos;t used to train models beyond the request that needs it.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Trash2 size={18} className="text-family-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-subhead font-bold mb-0.5">Yours to delete</div>
              <p className="text-footnote text-ink-tertiary leading-relaxed">Ask, and we&apos;ll remove your account and data &mdash; not yet self-serve, so it&apos;s a real person who does it.</p>
            </div>
          </div>
        </div>
      </div>

      <OakPlusSpotlight />

      {/* Pricing */}
      <div id="pricing" className="max-w-4xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <h2 className="text-title-md lg:text-title-lg font-bold text-center mb-2">Free to start. Simple if you upgrade.</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 sm:mb-10 max-w-xs mx-auto">
          Every core feature above is free. One paid tier, one thing it does.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 items-start">
          <div className="glass rounded-2xl p-5 sm:p-6 flex flex-col">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-callout font-bold">Free</span>
              <span className="text-subhead text-ink-tertiary">£0</span>
            </div>
            <ul className="space-y-2 flex-1">
              {['Emergency Mode', '"What happens if...?" scenarios', 'Readiness snapshot', 'Document upload & storage', 'Connect any email', 'Family roster & command palette'].map((f) => (
                <li key={f} className="flex items-start gap-2 text-footnote text-ink-secondary leading-relaxed">
                  <CheckCircle2 size={14} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/welcome"
              onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'pricing_free' }) }}
              className="block mt-5"
            >
              <motion.div
                whileTap={{ scale: 0.97 }}
                className="w-full text-center rounded-xl py-3 text-subhead font-semibold border border-tint/[0.08] text-ink-primary"
              >
                Get started free
              </motion.div>
            </Link>
          </div>
          <div className="glass rounded-2xl p-5 sm:p-6 border-family-500/30 relative flex flex-col">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-caption font-bold uppercase tracking-wide text-white bg-family-500 rounded-full px-3 py-1 shadow-md shadow-family-500/25 whitespace-nowrap">
              Recommended
            </span>
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-callout font-bold text-family-400">Oak Plus</span>
              <span className="text-subhead text-ink-tertiary">£7.99<span className="text-footnote">/mo</span></span>
            </div>
            <ul className="space-y-2 flex-1">
              {[
                'Everything in Free',
                'AI reads your documents — provider, policy number, amount, and dates pulled automatically',
                'AI-summarized inbox — financial emails read and explained in plain language',
                'Priority support',
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-footnote text-ink-secondary leading-relaxed">
                  <CheckCircle2 size={14} className="text-family-400 flex-shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/welcome"
              onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'pricing_plus' }) }}
              className="block mt-5"
            >
              <motion.div
                whileTap={{ scale: 0.97 }}
                className="w-full text-center rounded-xl py-3 text-subhead font-semibold bg-family-500 text-white shadow-md shadow-family-500/15"
              >
                Get started free
              </motion.div>
            </Link>
            <p className="text-caption text-ink-tertiary text-center mt-2">No credit card &mdash; upgrade from your account once you&apos;re in</p>
          </div>
        </div>
        <p className="text-footnote text-ink-tertiary text-center mt-4">Cancel anytime. No credit card to start free &mdash; upgrade to Oak Plus from your account whenever you&apos;re ready.</p>
      </div>

      {/* Final CTA */}
      <div className="max-w-2xl mx-auto px-6 sm:px-10 py-12 sm:py-20 text-center">
        <h2 className="text-title-md lg:text-title-lg font-bold mb-2">Be ready, before the emergency happens.</h2>
        <p className="text-sm text-ink-secondary mb-6">Free to start. No credit card. Two minutes to build your family&apos;s response plan.</p>
        <Link href="/welcome" onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'final_cta' }) }} className="inline-block">
          <motion.div
            whileTap={{ scale: 0.97 }}
            className="bg-family-500 text-white font-semibold rounded-2xl py-4 px-10 text-base text-center shadow-md shadow-family-500/15"
          >
            Get started free
          </motion.div>
        </Link>
      </div>

      {/* Footer */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-8 border-t border-tint/[0.06] flex flex-col items-center gap-4">
        <div className="flex gap-5 text-subhead text-ink-secondary">
          <Link href="/blog">Blog</Link>
          <Link href="/guides">Guides</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/support">Support</Link>
        </div>
        <p className="text-caption text-ink-tertiary text-center leading-snug max-w-sm">
          For informational and educational purposes only. Not financial, investment, tax, insurance, or legal
          advice, and not a substitute for professional emergency services &mdash; always call your local
          emergency number (911, 999, 112, or the equivalent where you are) in a real emergency. Consult a
          qualified professional before making financial decisions.
        </p>
      </div>
    </div>
  )
}
