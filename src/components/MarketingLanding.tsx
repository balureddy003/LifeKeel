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
} from 'lucide-react'
import { haptic } from '@/lib/haptics'

const RING_COLORS = {
  protection: '#f87171',
  wealth: '#fbbf24',
  goals: '#4ade80',
  savings: '#60a5fa',
} as const

function Ring({ pct, color, label, sample }: { pct: number; color: string; label: string; sample?: boolean }) {
  const r = 26
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <motion.circle
          cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          transform="rotate(-90 32 32)"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </svg>
      <span className="font-bold text-[13px]" style={{ color }}>{pct}%</span>
      <span className="text-[9.5px] font-semibold text-ink-tertiary flex items-center gap-1">
        {label}
        {sample && <span className="w-1 h-1 rounded-full bg-warning" />}
      </span>
    </div>
  )
}

const FEATURES = [
  { icon: HeartPulse, color: '#f87171', title: 'Four-part health check', body: 'Protection, wealth, goals, and savings, scored from what you’ve actually told Trellis — not a generic benchmark.' },
  { icon: Wand2, color: '#60a5fa', title: 'Upload a document, skip the retyping', body: 'Photograph an insurance policy or pension statement — Trellis reads the coverage amount and offers to fill in your profile for you.' },
  { icon: Mail, color: '#9c92ff', title: 'Connect any email, not just Gmail', body: 'Gmail, Outlook, Yahoo, iCloud, or your own domain — Trellis scans for financial mail and summarizes it in plain language.' },
  { icon: MessageCircle, color: '#4ade80', title: 'Ask, instead of hunting for a number', body: '"What happens if I lose my job?" gets a real, specific answer built from your data — not a canned FAQ.' },
  { icon: Siren, color: '#fbbf24', title: 'Emergency Mode', body: 'One tap, always reachable, drops straight into a guided checklist for the situation you’re actually in — no menu hunting under stress.' },
  { icon: Command, color: '#8b80f8', title: 'A command palette, if you want it', body: 'Cmd+K jumps anywhere in the app instantly. Built for the parent who wants an answer in three seconds, not three taps.' },
]

export function MarketingLanding() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div className="px-6 pt-14 pb-10">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-wide uppercase text-family-400 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_0_3px_rgba(74,222,128,0.18)]" />
          Free to start &middot; no credit card
        </div>
        <h1 className="text-[2.1rem] leading-[1.08] font-bold tracking-tight mb-4">
          See how your <span className="text-gradient">family&apos;s finances</span> connect.
        </h1>
        <p className="text-[1.05rem] text-ink-secondary leading-relaxed mb-7 max-w-sm">
          Insurance, savings, retirement, and your kids&apos; education funds &mdash; in one place, for the whole
          household. Not just your numbers. Your family&apos;s.
        </p>
        <div className="space-y-2.5 mb-4">
          <Link href="/welcome" onClick={() => haptic('light')} className="block">
            <motion.div
              whileTap={{ scale: 0.97 }}
              className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base text-center shadow-md shadow-family-500/15"
            >
              Get started free
            </motion.div>
          </Link>
          <Link href="/login" onClick={() => haptic('light')} className="block text-center">
            <span className="text-sm text-ink-tertiary">Already have an account? Sign in</span>
          </Link>
        </div>
        <p className="text-[11px] text-ink-tertiary">
          Works in your browser today. For informational purposes only &mdash; not financial advice.
        </p>
      </div>

      {/* Health rings demo */}
      <div className="px-6 mb-4">
        <div className="glass rounded-3xl p-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[13px] font-semibold text-ink-secondary">Family Health</span>
            <span className="text-[15px] font-bold text-success">80</span>
          </div>
          <p className="text-[11px] text-ink-tertiary mb-5">
            Across protection, wealth &amp; goals &middot; <span className="text-warning">some sample data</span>
          </p>
          <div className="flex items-center justify-around">
            <Ring pct={90} color={RING_COLORS.protection} label="Protection" />
            <Ring pct={65} color={RING_COLORS.wealth} label="Wealth" sample />
            <Ring pct={80} color={RING_COLORS.goals} label="Goals" />
            <Ring pct={85} color={RING_COLORS.savings} label="Savings" />
          </div>
        </div>
      </div>

      {/* Honesty section */}
      <div className="px-6 py-10">
        <h2 className="text-[1.4rem] font-bold text-center mb-3 leading-tight">
          Most finance apps fake confidence.<br />This one doesn&apos;t.
        </h2>
        <p className="text-sm text-ink-secondary text-center leading-relaxed mb-6 max-w-sm mx-auto">
          Before you connect anything, Trellis shows sample numbers so you can see what it does &mdash; clearly
          labeled as samples, not dressed up as yours. The moment real data replaces them, the label disappears.
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
      <div className="px-6 py-10">
        <h2 className="text-[1.4rem] font-bold text-center mb-2">What&apos;s actually in it</h2>
        <p className="text-sm text-ink-tertiary text-center mb-7 max-w-xs mx-auto">
          No feature here is aspirational &mdash; everything below is something you can do in the app today.
        </p>
        <div className="space-y-3">
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
      <div className="px-6 py-10">
        <h2 className="text-[1.3rem] font-bold mb-3 leading-tight">
          One household, one picture &mdash; not five separate apps.
        </h2>
        <p className="text-sm text-ink-secondary leading-relaxed mb-6">
          Add your partner and kids to your family&apos;s roster and every score, every insight, every &quot;what
          if&quot; scenario accounts for the whole household &mdash; not just the person who happened to sign up.
        </p>
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
      <div className="px-6 py-10">
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

      {/* Final CTA */}
      <div className="px-6 py-12 text-center">
        <h2 className="text-[1.5rem] font-bold mb-2">See your family&apos;s whole picture.</h2>
        <p className="text-sm text-ink-secondary mb-6">Free to start. No credit card. Two minutes to your first health check.</p>
        <Link href="/welcome" onClick={() => haptic('light')} className="block">
          <motion.div
            whileTap={{ scale: 0.97 }}
            className="w-full bg-family-500 text-white font-semibold rounded-2xl py-4 text-base text-center shadow-md shadow-family-500/15"
          >
            Get started free
          </motion.div>
        </Link>
      </div>

      {/* Footer */}
      <div className="px-6 py-8 border-t border-white/[0.06] flex flex-col items-center gap-4">
        <div className="flex gap-5 text-[13px] text-ink-secondary">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </div>
        <p className="text-[10.5px] text-ink-tertiary text-center leading-relaxed max-w-sm">
          For informational and educational purposes only. Not financial, investment, tax, or insurance advice.
          Consult a qualified professional before making financial decisions.
        </p>
      </div>
    </div>
  )
}
