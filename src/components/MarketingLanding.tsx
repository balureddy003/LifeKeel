'use client'

/**
 * The public marketing page shown at "/" to a logged-out visitor — not the
 * compact "Trellis / Get Started / I already have an account" fallback
 * AuthGate shows for any OTHER route hit while logged out (a shared link to
 * /inbox, say), which stays as-is; this is specifically the front door.
 *
 * Every claim here is something verified working in the app this session —
 * no feature list, no security claim, is aspirational.
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
} from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'

const FEATURES = [
  { icon: Siren, color: '#fbbf24', title: 'Emergency Mode', body: 'One tap, always reachable, drops straight into a guided checklist for the situation you’re actually in — no menu hunting under stress.' },
  { icon: MessageCircle, color: '#4ade80', title: '"What happens if...?" — answered', body: '"What happens if I lose my job?" gets a real, specific answer built from your data — not a canned FAQ, and not advice, just what you told Trellis.' },
  { icon: HeartPulse, color: '#f87171', title: 'A readiness snapshot, not a score to chase', body: 'Protection, wealth, goals, and savings, read from what you’ve told Trellis — a starting point for your own plan, not a recommendation.' },
  { icon: Wand2, color: '#60a5fa', title: 'Upload a document, skip the retyping', body: 'Photograph an insurance policy or pension statement — Trellis reads the coverage amount and offers to fill in your profile for you.' },
  { icon: Mail, color: '#9c92ff', title: 'Connect any email, not just Gmail', body: 'Gmail, Outlook, Yahoo, iCloud, or your own domain — Trellis scans for financial mail and summarizes it in plain language.' },
  { icon: Command, color: '#8b80f8', title: 'A command palette, if you want it', body: 'Cmd+K jumps anywhere in the app instantly. Built for the parent who wants an answer in three seconds, not three taps.' },
]

export function MarketingLanding() {
  useEffect(() => {
    track('landing_view')
  }, [])

  return (
    <div className="min-h-screen max-w-3xl mx-auto">
      {/* Hero */}
      <div className="px-6 sm:px-10 pt-10 sm:pt-14 pb-10">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-wide uppercase text-family-400 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_0_3px_rgba(74,222,128,0.18)]" />
          Free to start &middot; no credit card
        </div>
        <h1 className="text-[1.85rem] sm:text-[2.1rem] leading-[1.15] font-bold tracking-tight mb-3">
          Your family&apos;s <span className="text-gradient">first responder</span> for financial emergencies.
        </h1>
        <p className="text-[1.05rem] text-ink-secondary leading-relaxed mb-5 max-w-sm">
          Job loss. A new baby. Retirement. Trellis builds your household a step-by-step playbook
          for whatever comes &mdash; so you&apos;re never starting from zero.
        </p>
        <div className="space-y-3 mb-4">
          <Link href="/welcome" onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'hero' }) }} className="block">
            <motion.div
              whileTap={{ scale: 0.97 }}
              className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base text-center shadow-md shadow-family-500/15"
            >
              Get started free
            </motion.div>
          </Link>
          <Link href="/login" onClick={() => { haptic('light'); track('landing_signin_click') }} className="block text-center py-2.5">
            <span className="text-sm text-ink-tertiary">Already have an account? Sign in</span>
          </Link>
        </div>
        <p className="text-[11px] text-ink-tertiary leading-snug">
          Works in your browser today. Informational and educational only &mdash; not financial, investment,
          tax, or legal advice, and not a substitute for calling 911 in a real emergency.
        </p>
      </div>

      {/* Proof point */}
      <div className="px-6 sm:px-10 mb-4">
        <div className="glass rounded-2xl p-4 flex items-start gap-3">
          <span className="text-2xl font-bold text-family-400 leading-none flex-shrink-0">Only 30%</span>
          <p className="text-[12.5px] text-ink-secondary leading-relaxed">
            of U.S. households have the documents they&apos;d actually need ready for an emergency, per FEMA&apos;s
            2023 National Household Survey on Disaster Preparedness. Trellis exists to close that gap before you
            need it closed.
          </p>
        </div>
      </div>

      {/* Emergency Mode preview — the actual deliverable, not an abstract score.
          Mirrors the real scenario-detail screen (EventDetailClient) so a
          visitor sees the same checklist a signed-up user gets. */}
      <div className="px-6 sm:px-10 mb-4">
        <div className="glass rounded-3xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Siren size={14} className="text-danger flex-shrink-0" />
            <span className="text-[13px] font-semibold text-ink-secondary">Medical emergency &mdash; sample response plan</span>
          </div>
          <p className="text-[11px] text-ink-tertiary mb-4">
            This is what Emergency Mode hands you &mdash; not a score, a checklist.
          </p>
          <div className="space-y-2.5 mb-4">
            {[
              'Review your health insurance coverage details',
              'Check if pre-authorization is needed for treatment',
              'Confirm your annual out-of-pocket maximum',
            ].map((t) => (
              <div key={t} className="flex items-center gap-2.5">
                <span className="w-5 h-5 rounded-full border-2 border-white/15 flex-shrink-0" />
                <span className="text-[12.5px] text-ink-secondary leading-snug">{t}</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-warning/10 border border-warning/25 px-3 py-2 text-[11px] font-semibold text-warning leading-snug">
            &#9888; Sample scenario &mdash; connect your data for your family&apos;s real plan
          </div>
        </div>
      </div>

      {/* Honesty section */}
      <div className="px-6 sm:px-10 py-10">
        <h2 className="text-[1.4rem] font-bold text-center mb-3 leading-tight">
          Most finance apps fake confidence.<br />This one doesn&apos;t.
        </h2>
        <p className="text-sm text-ink-secondary text-center leading-relaxed mb-6 max-w-sm mx-auto">
          Before you connect anything, Trellis shows sample numbers so you can see what it does &mdash; clearly
          labeled as samples, not dressed up as yours. The moment real data replaces them, the label disappears.
          Trellis organizes what you tell it and helps you prepare &mdash; it doesn&apos;t recommend investments
          or tell you what to buy.
        </p>
        <div className="glass rounded-2xl p-4 max-w-xs mx-auto">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="font-bold text-success text-[15px]">90<span className="text-[10px] text-ink-tertiary font-normal"> / 100</span></span>
            <span className="text-[12px] text-ink-secondary">Protection</span>
          </div>
          <div className="rounded-lg bg-warning/10 border border-warning/25 px-3 py-2 text-[11.5px] font-semibold text-warning leading-snug">
            &#9888; Sample score &mdash; connect your data for a real one
          </div>
        </div>
      </div>

      {/* Feature grid */}
      <div className="px-6 sm:px-10 py-10">
        <h2 className="text-[1.4rem] font-bold text-center mb-2">What&apos;s actually in it</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 max-w-xs mx-auto">
          No feature here is aspirational &mdash; everything below is something you can do in the app today.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="glass rounded-2xl p-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: `${f.color}22` }}>
                <f.icon size={17} color={f.color} strokeWidth={1.8} />
              </div>
              <h3 className="text-[14.5px] font-bold mb-1">{f.title}</h3>
              <p className="text-[12.5px] text-ink-secondary leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Family strip */}
      <div className="px-6 sm:px-10 py-10">
        <h2 className="text-[1.3rem] font-bold mb-3 leading-tight">
          One household, one picture &mdash; not five separate apps.
        </h2>
        <p className="text-sm text-ink-secondary leading-relaxed mb-6">
          Add your partner and kids to your family&apos;s roster and every score, every insight, every &quot;what
          if&quot; scenario accounts for the whole household &mdash; not just the person who happened to sign up.
        </p>
        <p className="text-[11px] text-ink-tertiary mb-2.5">Sample family, shown for illustration:</p>
        <div className="flex gap-2.5">
          {[{ i: 'AC', n: 'Avery', r: 'Organizer', on: true }, { i: 'JC', n: 'Jordan', r: 'Partner' }, { i: 'SC', n: 'Sam', r: 'Child' }].map((m) => (
            <div key={m.i} className={`flex-1 rounded-2xl p-3.5 text-center border ${m.on ? 'border-family-500 bg-family-500/10' : 'border-white/[0.06] bg-white/[0.02]'}`}>
              <div className="w-8 h-8 rounded-full bg-white/[0.06] mx-auto mb-2 flex items-center justify-center text-[10.5px] font-bold text-family-400">{m.i}</div>
              <div className="text-[11px] font-bold">{m.n}</div>
              <div className="text-[9px] text-ink-tertiary">{m.r}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Trust strip */}
      <div className="px-6 sm:px-10 py-10">
        <h2 className="text-[1.3rem] font-bold text-center mb-2">What we actually do to protect your data</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7">Not a compliance-badge wall &mdash; just what&apos;s true.</p>
        <div className="space-y-4">
          <div className="flex gap-3">
            <Lock size={18} className="text-family-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] font-bold mb-0.5">Encrypted at rest</div>
              <p className="text-[12.5px] text-ink-tertiary leading-relaxed">Connector passwords and access tokens are encrypted before they&apos;re ever stored &mdash; not just in transit.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <ShieldCheck size={18} className="text-family-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] font-bold mb-0.5">Never sold</div>
              <p className="text-[12.5px] text-ink-tertiary leading-relaxed">Your financial data isn&apos;t sold, and it isn&apos;t used to train models beyond the request that needs it.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Trash2 size={18} className="text-family-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] font-bold mb-0.5">Yours to delete</div>
              <p className="text-[12.5px] text-ink-tertiary leading-relaxed">Ask, and we&apos;ll remove your account and data &mdash; not yet self-serve, so it&apos;s a real person who does it.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className="px-6 sm:px-10 py-10">
        <h2 className="text-[1.4rem] font-bold text-center mb-2">Free to start. Simple if you upgrade.</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 max-w-xs mx-auto">
          Every core feature above is free. One paid tier, one thing it does.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 items-start">
          <div className="glass rounded-2xl p-5">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-[15px] font-bold">Free</span>
              <span className="text-[13px] text-ink-tertiary">$0</span>
            </div>
            <ul className="space-y-2">
              {['Emergency Mode', '"What happens if...?" scenarios', 'Readiness snapshot', 'Document upload & storage', 'Connect any email', 'Family roster & command palette'].map((f) => (
                <li key={f} className="flex items-start gap-2 text-[12.5px] text-ink-secondary leading-relaxed">
                  <CheckCircle2 size={14} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="glass rounded-2xl p-5 border-family-500/30">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-[15px] font-bold text-family-400">Trellis Plus</span>
              <span className="text-[13px] text-ink-tertiary">£7.99<span className="text-[11px]">/mo</span></span>
            </div>
            <ul className="space-y-2">
              {[
                'Everything in Free',
                'AI reads your documents — provider, policy number, amount, and dates pulled automatically',
                'AI-summarized inbox — financial emails read and explained in plain language',
                'Priority support',
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-[12.5px] text-ink-secondary leading-relaxed">
                  <CheckCircle2 size={14} className="text-family-400 flex-shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="text-[11px] text-ink-tertiary text-center mt-4">Cancel anytime. No credit card to start free.</p>
      </div>

      {/* Final CTA */}
      <div className="px-6 sm:px-10 py-12 text-center">
        <h2 className="text-[1.5rem] font-bold mb-2">Be ready, before the emergency happens.</h2>
        <p className="text-sm text-ink-secondary mb-6">Free to start. No credit card. Two minutes to build your family&apos;s response plan.</p>
        <Link href="/welcome" onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'final_cta' }) }} className="block">
          <motion.div
            whileTap={{ scale: 0.97 }}
            className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base text-center shadow-md shadow-family-500/15"
          >
            Get started free
          </motion.div>
        </Link>
      </div>

      {/* Footer */}
      <div className="px-6 sm:px-10 py-8 border-t border-white/[0.06] flex flex-col items-center gap-4">
        <div className="flex gap-5 text-[13px] text-ink-secondary">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/support">Support</Link>
        </div>
        <p className="text-[10.5px] text-ink-tertiary text-center leading-snug max-w-sm">
          For informational and educational purposes only. Not financial, investment, tax, insurance, or legal
          advice, and not a substitute for professional emergency services &mdash; always call 911 in a real
          emergency. Consult a qualified professional before making financial decisions.
        </p>
      </div>
    </div>
  )
}
