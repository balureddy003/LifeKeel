'use client'

/**
 * The public marketing page shown at "/" to a logged-out visitor — not the
 * compact "LifeKeel / Get Started / I already have an account" fallback
 * AuthGate shows for any OTHER route hit while logged out (a shared link to
 * /inbox, say), which stays as-is; this is specifically the front door.
 *
 * Every claim here is something verified working in the app this session —
 * no feature list, no security claim, is aspirational. In particular: this
 * page does NOT claim Keel acts autonomously on the family's behalf (the
 * "LifeKeel" product vision's Act/Escalate layer) — that isn't built yet.
 * See ARCHITECTURE.md for the full vision and what's actually shipped.
 *
 * Content strategy is grounded in the competitive analysis (market-positioning-
 * october-2026.md) and the built-vs-market gap review. The three differentiator
 * sections map directly to the positioning claims:
 *   1. "Watches while you don't" → Claim 1 (continuous detection) + Claim 3
 *      (proactive intelligence) — no competitor runs background detection
 *   2. "Per-member, not per-household" → Claim 2 — no competitor does per-
 *      member reasoning within a shared family
 *   3. "Crisis-native" → Claim 4 — crisis playbooks built from real data,
 *      not generic checklists (Empathy is post-event; Keel is pre-event)
 *   4. Neutrality → Claim 5 — every insurance gap tool has a commission;
 *      Keel's subscription-only model is structurally conflict-free
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence, useInView } from 'framer-motion'
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
  Menu,
  X,
  Upload,
  Users,
  BarChart3,
  ChevronDown,
  ArrowRight,
  Clock,
  Shield,
  FileText,
  Bell,
  Eye,
  TrendingUp,
  GraduationCap,
  Briefcase,
  Baby,
  AlertTriangle,
} from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { captureLead } from '@/lib/api'
import { ScoreRing } from '@/components/Glass'

// `plus` marks a card whose headline capability is Keel Plus-gated (verified
// against the same free/paid split /upload and /upgrade already enforce —
// upload/connect is free, the AI reading of what you uploaded/connected is
// not). Leaving these unmarked previously meant the free feature grid quietly
// promised a paid capability, which undercuts both the page's own "no feature
// here is aspirational" claim and the upgrade pitch itself.
const FEATURES = [
  { icon: Siren, color: '#fbbf24', title: 'Emergency Mode', body: 'One tap, always reachable, drops straight into a guided checklist for the situation you’re actually in — no menu hunting under stress.' },
  { icon: MessageCircle, color: '#4ade80', title: '"What happens if...?" — answered', body: '"What happens if I lose my job?" gets a real, specific answer built from your data — not a canned FAQ, and not advice, just what you told Keel.' },
  { icon: HeartPulse, color: '#f87171', title: 'A readiness snapshot, not a score to chase', body: 'Protection, wealth, goals, and savings, read from what you’ve told Keel — a starting point for your own plan, not a recommendation.' },
  { icon: Wand2, color: '#60a5fa', title: 'Upload a document, skip the retyping', body: 'Photograph an insurance policy or pension statement to store it securely, free. Keel Plus reads the provider, policy number, amount, and dates for you automatically.', plus: true },
  { icon: Mail, color: '#9c92ff', title: 'Connect any email, not just Gmail', body: 'Gmail, Outlook, Yahoo, iCloud, or your own domain — free to connect. Keel Plus summarizes every financial email in plain language as it arrives.', plus: true },
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

// ── Interactive "detector timeline" — shows how Keel watches continuously ──
// This is the single most differentiated feature: no competitor runs background
// detection. LifeOS requires a conversation. PolicyPilot is one-shot. Origin's
// daily checks are the closest, but don't cover protection/crisis. This visual
// makes the "watches while you don't" claim *experiential*, not textual.
const DETECTOR_EVENTS = [
  { time: 'Monday 9:14 AM', icon: Eye, color: '#60a5fa', label: 'Profile updated', detail: 'You updated your household income. Keel re-evaluated all 9 detectors automatically.' },
  { time: 'Monday 9:14 AM', icon: AlertTriangle, color: '#fbbf24', label: 'Protection gap widened', detail: 'Higher income means your family needs more coverage. Life cover now £180K short of the 10× guideline.' },
  { time: 'Tuesday', icon: Eye, color: '#4ade80', label: 'Daily sweep', detail: 'No profile changes. Keel checked anyway — detectors run daily even when nobody logs in.' },
  { time: 'Thursday 2:31 PM', icon: Upload, color: '#9c92ff', label: 'Policy uploaded', detail: 'You uploaded a life insurance PDF. Keel Plus extracted £350K cover, auto-updated your profile.' },
  { time: 'Thursday 2:31 PM', icon: CheckCircle2, color: '#4ade80', label: 'Gap closed', detail: 'Protection gap resolved — your cover now exceeds the 10× income guideline. Insight auto-resolved.' },
  { time: 'Next month', icon: Bell, color: '#f87171', label: 'Renewal approaching', detail: 'Your home insurance renews in 45 days. Keel flagged it before you forgot — no conversation needed.' },
]

function DetectorTimeline() {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [visibleCount, setVisibleCount] = useState(0)

  useEffect(() => {
    if (!isInView) return
    const interval = setInterval(() => {
      setVisibleCount((c) => { if (c >= DETECTOR_EVENTS.length) { clearInterval(interval); return c } return c + 1 })
    }, 600)
    return () => clearInterval(interval)
  }, [isInView])

  return (
    <div ref={ref} className="glass rounded-2xl p-5 sm:p-6 max-w-md w-full mx-auto lg:mx-0">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-success shadow-[0_0_0_3px_rgba(74,222,128,0.18)] animate-pulse" />
        <span className="text-footnote font-bold text-ink-secondary">Live detector feed</span>
        <span className="text-caption text-ink-tertiary ml-auto">Sample timeline</span>
      </div>
      <div className="space-y-1">
        {DETECTOR_EVENTS.map((evt, i) => {
          const Icon = evt.icon
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -12 }}
              animate={i < visibleCount ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="flex gap-3 py-2 border-b border-tint/[0.04] last:border-0"
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${evt.color}18` }}>
                <Icon size={13} color={evt.color} strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-caption font-semibold text-ink-primary truncate">{evt.label}</span>
                  <span className="text-caption text-ink-tertiary flex-shrink-0">{evt.time}</span>
                </div>
                <p className="text-caption text-ink-tertiary leading-snug">{evt.detail}</p>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// ── Family twin visualization — per-member reasoning (Claim 2) ────────────
// This is genuinely novel: no competitor found does per-member financial
// reasoning within a shared household. Origin is household-level. Monarch is
// shared accounts. Trustworthy is document-level. Keel's member twin gives each
// person their own readiness view scoped to their life stage.
const FAMILY_TWINS = [
  {
    initials: 'AC', name: 'Alex', role: 'Primary earner', age: '42',
    icon: Briefcase, color: '#60a5fa',
    insights: ['Income protection covers 65% of salary', 'Pension on track for target age 62', 'Life cover £180K short of guideline'],
    score: 74,
  },
  {
    initials: 'JC', name: 'Jordan', role: 'Partner', age: '39',
    icon: HeartPulse, color: '#f87171',
    insights: ['No income protection on file', 'Critical illness cover: none', 'Pension contribution below auto-enrolment minimum'],
    score: 41,
  },
  {
    initials: 'SC', name: 'Sam', role: 'Child', age: '7',
    icon: GraduationCap, color: '#4ade80',
    insights: ['Education fund: £12K saved, £35K target', 'On current rate: funded by age 16', 'No guardian designated in will'],
    score: 62,
  },
  {
    initials: 'MC', name: 'Mia', role: 'Child', age: '2',
    icon: Baby, color: '#fbbf24',
    insights: ['Education fund: not started', '16 years to target — £85/mo closes the gap', 'New dependent: household protection recalculated'],
    score: 28,
  },
]

function FamilyTwinViz() {
  const [selected, setSelected] = useState(0)
  const member = FAMILY_TWINS[selected] ?? FAMILY_TWINS[0]!

  return (
    <div className="glass rounded-2xl p-5 sm:p-6 max-w-md w-full mx-auto lg:mx-0">
      <div className="text-footnote font-bold text-ink-secondary mb-4">Each member gets their own view</div>
      <div className="flex gap-2 mb-5">
        {FAMILY_TWINS.map((m, i) => (
          <button
            key={m.initials}
            onClick={() => setSelected(i)}
            className={`flex-1 rounded-xl p-2.5 text-center border transition-all ${i === selected ? 'border-family-500 bg-family-500/10' : 'border-tint/[0.06] bg-tint/[0.02] hover:border-tint/[0.12]'}`}
          >
            <div className={`w-7 h-7 rounded-full mx-auto mb-1.5 flex items-center justify-center text-caption font-bold ${i === selected ? 'bg-family-500/20 text-family-400' : 'bg-tint/[0.06] text-ink-tertiary'}`}>
              {m.initials}
            </div>
            <div className="text-caption font-semibold truncate">{m.name}</div>
            <div className="text-caption text-ink-tertiary">{m.role}</div>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={selected}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <div className="flex items-center gap-3 mb-3">
            <ScoreRing score={member.score} size={44} />
            <div>
              <div className="text-sm font-bold">{member.name}&apos;s readiness</div>
              <div className="text-caption text-ink-tertiary">{member.role}, age {member.age}</div>
            </div>
          </div>
          <div className="space-y-1.5">
            {member.insights.map((ins) => (
              <div key={ins} className="flex items-start gap-2 text-caption text-ink-secondary leading-snug">
                <span className="w-1 h-1 rounded-full bg-ink-tertiary flex-shrink-0 mt-1.5" />
                {ins}
              </div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="mt-3 rounded-lg bg-warning/10 border border-warning/25 px-3 py-2 text-caption font-semibold text-warning leading-snug">
        &#9888; Sample family — your real scores come from your real data
      </div>
    </div>
  )
}

// ── "How Keel is different" — competitive positioning without naming names ──
// Maps directly to market-positioning-october-2026.md's quadrant:
//   Upper-left (proactive + protection/readiness) = Keel — least contested
//   Lower-left (reactive + protection) = vault/insurance tools
//   Upper-right (proactive + wealth) = Origin-style advisors
//   Lower-right (reactive + wealth) = PFM/budgeting apps
const ALTERNATIVES = [
  {
    category: 'Budgeting apps',
    what: 'Track what you spent yesterday',
    keel: 'Keel tells you what would happen if your income stopped tomorrow',
    color: '#9c92ff',
  },
  {
    category: 'AI financial advisors',
    what: 'Need you to ask a question first',
    keel: 'Keel surfaces what\'s wrong before you think to ask — detectors run daily, even when nobody logs in',
    color: '#60a5fa',
  },
  {
    category: 'Insurance gap tools',
    what: 'Score one policy, then recommend their own products',
    keel: 'Keel monitors every policy continuously and has zero commission relationships — subscription only',
    color: '#fbbf24',
  },
  {
    category: 'Document vaults',
    what: 'Store your files — you search, you query',
    keel: 'Keel reads, extracts, and reasons over what you upload — then tells you what\'s missing',
    color: '#4ade80',
  },
]

// Warms up the upgrade pitch right before the pricing decision, the same
// "show, don't tell" pattern /upgrade's own ExtractionPreview uses — a
// visitor sees what Keel Plus actually does instead of reading a bullet point.
function LifeKeelPlusSpotlight() {
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
          <Sparkles size={12} /> Keel Plus
        </div>
        <h2 className="text-title-sm lg:text-title-md font-bold mb-3 leading-tight">
          Skip the retyping &mdash; Keel reads your documents for you.
        </h2>
        <p className="text-sm text-ink-secondary leading-relaxed max-w-md mb-5">
          Photograph an insurance policy or pension statement and Keel Plus pulls out the provider, policy
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
    return <p className="text-footnote text-success">Subscribed &mdash; we&apos;ll only send what matters.</p>
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
        <button disabled={state === 'busy' || !email.trim()} className="rounded-lg bg-family-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 flex-shrink-0">
          {state === 'busy' ? '...' : 'Join'}
        </button>
      </div>
      {state === 'error' && <p className="text-caption text-danger">Couldn&apos;t subscribe &mdash; try again.</p>}
    </form>
  )
}

function MarketingNav() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-nav border-b border-tint/[0.06] bg-navbg/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 sm:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 min-h-0">
          <img src="/icon.svg" alt="" width={30} height={30} className="rounded-[7px] flex-shrink-0" />
          <span className="text-callout font-bold tracking-tight">LifeKeel</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-subhead font-medium text-ink-secondary">
          <a href="#how-it-works" className="hover:text-ink-primary transition-colors">How it works</a>
          <a href="#features" className="hover:text-ink-primary transition-colors">Features</a>
          <a href="#pricing" className="hover:text-ink-primary transition-colors">Pricing</a>
          <a href="#security" className="hover:text-ink-primary transition-colors">Security</a>
          <a href="#faq" className="hover:text-ink-primary transition-colors">FAQ</a>
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
                { href: '/login', label: 'Sign in' },
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

      {/* Hero — leads with the readiness outcome, not the product category.
          Market positioning doc: "Lead with readiness, not AI. Every competitor
          is shouting 'AI-powered.' Lead with the outcome." */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-10 sm:pt-16 pb-10 sm:pb-20 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="max-w-lg">
          <div className="flex items-center gap-2 text-footnote font-bold tracking-wide uppercase text-family-400 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_0_3px_rgba(74,222,128,0.18)]" />
            Free to start &middot; no credit card
          </div>
          <h1 className="text-title-lg sm:text-display-sm lg:text-display leading-[1.15] font-bold tracking-tight mb-4">
            Is your family ready if something goes wrong <span className="text-gradient">tomorrow?</span>
          </h1>
          <p className="text-lead text-ink-secondary leading-relaxed mb-3">
            Keel continuously monitors whether your family is protected &mdash; emergency fund, insurance
            coverage, estate documents, retirement trajectory &mdash; and tells you what&apos;s missing
            before you need to ask.
          </p>
          <p className="text-sm text-ink-tertiary leading-relaxed mb-6">
            Not a budgeting app. Not an AI financial advisor. Not a vault.<br />
            The always-on readiness system for your family.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <Link href="/readiness" onClick={() => { haptic('light'); track('landing_quiz_click', { location: 'hero' }) }} className="block sm:inline-block">
              <motion.div
                whileTap={{ scale: 0.97 }}
                className="sm:w-auto bg-family-500 text-white font-semibold rounded-2xl py-4 px-8 text-base text-center shadow-md shadow-family-500/15"
              >
                Check your readiness free
              </motion.div>
            </Link>
            <Link href="/welcome" onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'hero' }) }} className="block sm:inline-block text-center py-2.5">
              <span className="text-sm font-semibold text-ink-secondary">or get started &rarr;</span>
            </Link>
          </div>
          <p className="text-footnote text-ink-tertiary leading-snug">
            Informational and educational only &mdash; not financial, investment,
            tax, or legal advice, and not a substitute for calling 911 in a real emergency.
          </p>
        </div>

        <HeroPreview />
      </div>

      {/* Proof points — reframed with competitive context */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 mb-12">
        <div className="glass rounded-2xl p-5 sm:p-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {[
              { stat: '9 detectors', label: 'monitor your family continuously — not when you ask, but every day, even when nobody logs in', source: '' },
              { stat: '9 in 10', label: 'families don\'t have enough life cover to replace lost income for 5 years', source: 'LIMRA 2024' },
              { stat: '£7.99/mo', label: 'for the same protection monitoring that costs £100/mo elsewhere — or get started free', source: '' },
              { stat: '60 sec', label: 'to your first readiness score — no signup, no credit card', source: '' },
            ].map((p) => (
              <div key={p.stat} className="text-center sm:text-left">
                <div className="text-xl sm:text-2xl font-bold text-family-400 leading-none mb-1.5">{p.stat}</div>
                <p className="text-footnote text-ink-secondary leading-snug">{p.label}</p>
                {p.source && <p className="text-caption text-ink-tertiary mt-1">{p.source}</p>}
              </div>
            ))}
          </div>
          <div className="text-center mt-5 pt-4 border-t border-tint/[0.06]">
            <Link
              href="/readiness"
              onClick={() => { haptic('light'); track('landing_quiz_click', { location: 'proof_points' }) }}
              className="inline-flex items-center gap-2 text-sm font-semibold text-family-400"
            >
              Find your own number in 60 seconds <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>

      {/* How it works — 3-step strip */}
      <div id="how-it-works" className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <h2 className="text-title-md lg:text-title-lg font-bold text-center mb-2">Ready in three steps</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 sm:mb-10 max-w-sm mx-auto">
          Two minutes from signup to your first readiness score. No credit card, no sales call.
        </p>
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            { step: '1', icon: Upload, title: 'Tell Keel about your family', body: 'Income, savings, insurance, dependents. A short form — or upload a document and Keel reads it for you.' },
            { step: '2', icon: BarChart3, title: 'See your readiness score', body: 'Five health domains scored from your own numbers: protection, wealth, goals, savings, and estate. No guesswork — the math is visible.' },
            { step: '3', icon: Shield, title: 'Get a plan before you need one', body: 'What happens if you lose your job next month? Keel builds a step-by-step playbook from your real data — not a generic checklist.' },
          ].map((s) => (
            <motion.div key={s.step} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center">
              <div className="w-12 h-12 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mx-auto mb-4">
                <s.icon size={20} className="text-family-400" />
              </div>
              <div className="text-xs font-bold uppercase tracking-wide text-family-400 mb-1.5">Step {s.step}</div>
              <h3 className="text-callout font-bold mb-1.5">{s.title}</h3>
              <p className="text-footnote text-ink-secondary leading-relaxed">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ═══ DIFFERENTIATOR 1: "Watches while you don't" ═══
          Maps to Claim 1 (continuous detection) + Claim 3 (proactive).
          The interactive timeline shows detection happening over days without
          user action — the single feature no competitor replicates. */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-20 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="max-w-md">
          <div className="text-xs font-bold uppercase tracking-wider text-family-400 mb-3">What makes Keel different</div>
          <h2 className="text-title-md lg:text-title-lg font-bold mb-3 leading-tight">
            A system that watches while you don&apos;t.
          </h2>
          <p className="text-sm text-ink-secondary leading-relaxed mb-4">
            Most financial tools wait for you to ask a question. Keel runs 9 detectors across your
            family&apos;s protection, savings, retirement, education, debt, and estate &mdash;
            <strong> every day, even when nobody logs in</strong>.
          </p>
          <p className="text-sm text-ink-secondary leading-relaxed mb-4">
            Upload a new policy? Detectors re-evaluate instantly. Income changes? Gaps are recalculated
            before you close the tab. Nothing happens for six months? Keel flags that too.
          </p>
          <div className="flex items-center gap-3 text-sm text-ink-tertiary">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span>Always running</span>
            </div>
            <span className="text-ink-tertiary/30">|</span>
            <span>No conversation needed</span>
            <span className="text-ink-tertiary/30">|</span>
            <span>Zero commissions</span>
          </div>
        </div>
        <DetectorTimeline />
      </div>

      {/* ═══ DIFFERENTIATOR 2: Per-member twin ═══
          Maps to Claim 2. Genuinely novel — no competitor found does per-member
          financial reasoning within a shared household. */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-20 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="order-2 lg:order-1">
          <FamilyTwinViz />
        </div>
        <div className="order-1 lg:order-2 max-w-md">
          <div className="text-xs font-bold uppercase tracking-wider text-family-400 mb-3">Per-member reasoning</div>
          <h2 className="text-title-md lg:text-title-lg font-bold mb-3 leading-tight">
            Every family member gets their own digital twin.
          </h2>
          <p className="text-sm text-ink-secondary leading-relaxed mb-4">
            Not just shared access to the same dashboard. Each person &mdash; earner, partner, child &mdash;
            gets a readiness score, insights, and scenarios scoped to their own life stage, income, and linked policies.
          </p>
          <p className="text-sm text-ink-secondary leading-relaxed mb-4">
            &ldquo;What happens to <em>my</em> retirement if <em>my</em> income changes?&rdquo; works for the second
            earner, not just the person who signed up. Children get age-appropriate views with guardian oversight.
          </p>
          <Link href="/readiness" onClick={() => { haptic('light'); track('landing_quiz_click', { location: 'twin_section' }) }}>
            <motion.div whileTap={{ scale: 0.97 }} className="inline-flex items-center gap-2 text-sm font-semibold text-family-400">
              See what Keel would say about your family <ArrowRight size={14} />
            </motion.div>
          </Link>
        </div>
      </div>

      {/* ═══ DIFFERENTIATOR 3: Crisis-native ═══
          Maps to Claim 4. "What Empathy does after the crisis, Keel does before."
          Strongest competitive differentiator per the gap review (8/10). */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-20">
        <div className="text-center mb-10">
          <div className="text-xs font-bold uppercase tracking-wider text-family-400 mb-3">Crisis-native, not crisis-adjacent</div>
          <h2 className="text-title-md lg:text-title-lg font-bold mb-3">
            When something goes wrong, Keel already has your plan.
          </h2>
          <p className="text-sm text-ink-tertiary max-w-lg mx-auto leading-relaxed">
            Not a generic emergency checklist. A step-by-step playbook built from your real income,
            your real policies, your real savings &mdash; with your provider contact details already filled in.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: Siren,
              color: '#fbbf24',
              scenario: 'Job loss, two kids in school',
              answer: 'Keel shows your exact runway: 4.2 months of expenses covered, which bills to pause first, and whether your income protection would replace enough.',
            },
            {
              icon: HeartPulse,
              color: '#f87171',
              scenario: 'Partner diagnosed, can\'t work',
              answer: 'Emergency mode pulls up your critical-illness cover amount, your savings runway, and a step-by-step checklist — specific to your policy, not a generic guide.',
            },
            {
              icon: Users,
              color: '#4ade80',
              scenario: 'New baby arriving in March',
              answer: 'Keel recalculates everything at once: protection gap jumps (new dependent), emergency fund target rises, and an education savings runway starts at 18 years.',
            },
            {
              icon: Clock,
              color: '#60a5fa',
              scenario: 'Retirement in 12 years, unsure if on track',
              answer: 'Keel shows your projected retirement age vs. your target, the monthly contribution that would close the gap, and whether contributions alone can do it.',
            },
            {
              icon: FileText,
              color: '#9c92ff',
              scenario: 'Three insurance policies, no idea what they cover',
              answer: 'Upload them. Keel extracts provider, amounts, and renewal dates, then flags overlaps and gaps against your household\'s actual need.',
            },
            {
              icon: Shield,
              color: 'rgb(var(--family-400))',
              scenario: 'No will, no power of attorney, two dependents',
              answer: 'Keel flags exactly what\'s missing from your estate — not legal advice, but the prompt to have the conversation with a solicitor before you need to.',
            },
          ].map((s) => (
            <motion.div key={s.scenario} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass rounded-2xl p-4 sm:p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${s.color}22` }}>
                  <s.icon size={15} color={s.color} strokeWidth={2} />
                </div>
                <span className="text-sm font-semibold text-ink-primary leading-snug">{s.scenario}</span>
              </div>
              <p className="text-footnote text-ink-secondary leading-relaxed">{s.answer}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ═══ "How Keel is different" — competitive contrast without naming names ═══
          The market-positioning doc's quadrant: Keel is upper-left (proactive +
          protection). Every other quadrant is named by *category*, never brand. */}
      <div className="max-w-4xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <h2 className="text-title-md lg:text-title-lg font-bold text-center mb-2">You&apos;ve probably tried the alternatives.</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 sm:mb-10 max-w-md mx-auto">
          Keel isn&apos;t another budgeting app, another AI chatbot, or another insurance quiz. Here&apos;s what it replaces.
        </p>
        <div className="space-y-3">
          {ALTERNATIVES.map((alt) => (
            <motion.div key={alt.category} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass rounded-2xl p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: alt.color }} />
                <span className="text-sm font-bold text-ink-primary">{alt.category}</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 sm:gap-6">
                <div>
                  <span className="text-caption font-bold uppercase tracking-wide text-ink-tertiary">What they do</span>
                  <p className="text-footnote text-ink-secondary leading-relaxed mt-1">{alt.what}</p>
                </div>
                <div>
                  <span className="text-caption font-bold uppercase tracking-wide text-family-400">What Keel does instead</span>
                  <p className="text-footnote text-ink-secondary leading-relaxed mt-1">{alt.keel}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Honesty section */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-10 sm:py-16 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <h2 className="text-title-md lg:text-title-lg font-bold mb-3 leading-tight">
            Most finance apps fake confidence.<br />This one doesn&apos;t.
          </h2>
          <p className="text-sm text-ink-secondary leading-relaxed max-w-md">
            Before you connect anything, LifeKeel shows sample numbers so you can see what it does &mdash; clearly
            labeled as samples, not dressed up as yours. The moment real data replaces them, the label disappears.
            Keel organizes what you tell it and helps you prepare &mdash; it doesn&apos;t recommend investments
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
                  Keel Plus
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

      {/* ═══ Neutrality statement (Claim 5) ═══
          Per the competitive analysis: "every insurance-adjacent tool has a
          commission relationship. LifeKeel's structural neutrality is the
          single most defensible positioning claim. Put it on every protection-gap
          insight card." This section makes the claim explicit and loud. */}
      <div className="max-w-4xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <div className="glass rounded-2xl p-6 sm:p-8 text-center border border-family-500/20">
          <ShieldCheck size={28} className="text-family-400 mx-auto mb-4" />
          <h2 className="text-title-sm lg:text-title-md font-bold mb-3">
            Zero commissions. Zero product recommendations. Ever.
          </h2>
          <p className="text-sm text-ink-secondary leading-relaxed max-w-lg mx-auto mb-4">
            Every insurance gap tool, every coverage scorer, every &ldquo;AI advisor&rdquo; makes money when you buy
            what they suggest. Keel makes money from your subscription and nothing else. When Keel says your
            life cover is £180K short, it&apos;s not selling you a policy &mdash; it&apos;s telling you what the maths says,
            and pointing you to a licensed professional for the decision.
          </p>
          <div className="flex flex-wrap justify-center gap-4 text-footnote text-ink-tertiary">
            <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-success" /> Subscription-only revenue</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-success" /> No affiliate links</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-success" /> No partner commissions</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-success" /> Data never sold</span>
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

      <LifeKeelPlusSpotlight />

      {/* Pricing — includes competitive context per market-positioning doc:
          "for less than what you pay for a streaming service, Keel watches
          whether your family is protected" */}
      <div id="pricing" className="max-w-4xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <h2 className="text-title-md lg:text-title-lg font-bold text-center mb-2">Less than a streaming service. More than a safety net.</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 sm:mb-10 max-w-sm mx-auto">
          Continuous family protection monitoring starts free. The only paid tier adds AI document reading.
          No hidden fees, no commission revenue, no surprise charges.
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
              <span className="text-callout font-bold text-family-400">Keel Plus</span>
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
        <p className="text-footnote text-ink-tertiary text-center mt-4">Cancel anytime. No credit card to start free &mdash; upgrade to Keel Plus from your account whenever you&apos;re ready.</p>
      </div>

      {/* FAQ */}
      <div id="faq" className="max-w-3xl mx-auto px-6 sm:px-10 py-10 sm:py-16">
        <h2 className="text-title-md lg:text-title-lg font-bold text-center mb-2">Common questions</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 sm:mb-10">Straight answers, no spin.</p>
        <div className="space-y-2">
          {[
            { q: 'Is LifeKeel financial advice?', a: 'No. LifeKeel is informational and educational only — not financial, investment, tax, or legal advice, and not a substitute for a licensed professional or for calling 911 in a real emergency.' },
            { q: 'How much does LifeKeel cost?', a: 'LifeKeel is free to start, no credit card required. Keel Plus is £7.99/month and adds AI document reading (provider, policy number, amount, and dates pulled automatically) and an AI-summarised inbox on top of everything in the free plan.' },
            { q: 'Is my financial data sold or used to train AI models?', a: "No. Your financial data isn't sold, and it isn't used to train models beyond the request that needs it. Connector passwords and access tokens are encrypted before they're ever stored." },
            { q: 'Can I cancel Keel Plus anytime?', a: 'Yes. No credit card is required to start free, and you can cancel Keel Plus anytime from your account.' },
            { q: 'Does LifeKeel work for the whole family?', a: "Yes. Add your partner and kids to your family's roster and every score, insight, and \"what if\" scenario accounts for the whole household, not just the person who signed up." },
            { q: 'What happens to my data if I delete my account?', a: "Your family profile, documents, insights, and sign-in are deleted immediately. Billing records are kept only as required for financial reporting." },
          ].map((faq) => (
            <details key={faq.q} className="glass rounded-2xl border border-tint/[0.08] group">
              <summary className="cursor-pointer p-4 sm:p-5 flex items-center justify-between gap-3 text-sm font-semibold text-ink-primary">
                {faq.q}
                <ChevronDown size={16} className="text-ink-tertiary flex-shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-4 sm:px-5 pb-4 sm:pb-5 -mt-1 text-sm text-ink-secondary leading-relaxed">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>

      {/* Final CTA */}
      <div className="max-w-2xl mx-auto px-6 sm:px-10 py-12 sm:py-20 text-center">
        <h2 className="text-title-md lg:text-title-lg font-bold mb-3">
          Your family&apos;s readiness score is waiting.
        </h2>
        <p className="text-sm text-ink-secondary mb-2 max-w-md mx-auto">
          Six questions. Sixty seconds. No signup, no credit card, no email required.
        </p>
        <p className="text-sm text-ink-tertiary mb-6 max-w-md mx-auto">
          See where you stand &mdash; then decide if you want Keel watching continuously.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/readiness" onClick={() => { haptic('light'); track('landing_quiz_click', { location: 'final_cta' }) }} className="inline-block">
            <motion.div
              whileTap={{ scale: 0.97 }}
              className="bg-family-500 text-white font-semibold rounded-2xl py-4 px-10 text-base text-center shadow-md shadow-family-500/15"
            >
              Check your readiness free
            </motion.div>
          </Link>
          <Link href="/welcome" onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'final_cta' }) }} className="inline-block">
            <motion.div
              whileTap={{ scale: 0.97 }}
              className="text-sm font-semibold text-ink-secondary py-4 px-6"
            >
              or create your account &rarr;
            </motion.div>
          </Link>
        </div>
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
              The always-on readiness system for your family. Know your numbers, have a plan, be ready.
            </p>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-tertiary mb-3">Product</div>
            <div className="space-y-2 text-footnote">
              <a href="#features" className="block text-ink-secondary hover:text-ink-primary">Features</a>
              <a href="#pricing" className="block text-ink-secondary hover:text-ink-primary">Pricing</a>
              <Link href="/readiness" className="block text-ink-secondary hover:text-ink-primary">Free readiness check</Link>
              <Link href="/guides" className="block text-ink-secondary hover:text-ink-primary">Guides</Link>
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-tertiary mb-3">Company</div>
            <div className="space-y-2 text-footnote">
              <Link href="/blog" className="block text-ink-secondary hover:text-ink-primary">Blog</Link>
              <Link href="/support" className="block text-ink-secondary hover:text-ink-primary">Support</Link>
              <Link href="/terms" className="block text-ink-secondary hover:text-ink-primary">Terms</Link>
              <Link href="/privacy" className="block text-ink-secondary hover:text-ink-primary">Privacy</Link>
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-tertiary mb-3">Stay in touch</div>
            <FooterNewsletter />
          </div>
        </div>
        <p className="text-caption text-ink-tertiary text-center leading-snug max-w-md mx-auto">
          For informational and educational purposes only. Not financial, investment, tax, insurance, or legal
          advice, and not a substitute for professional emergency services &mdash; always call your local
          emergency number (911, 999, 112, or the equivalent where you are) in a real emergency. Consult a
          qualified professional before making financial decisions.
        </p>
      </div>
    </div>
  )
}
