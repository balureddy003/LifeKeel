'use client'

/**
 * "Keep this result" (PRD-203): one email field, no password. Nothing is
 * stored until the visitor presses the button, and the copy says what then
 * happens to the address. The reply is the same for every address.
 */

import { useState } from 'react'
import { GlassCard, GlassButton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { requestMagicLink, type ReadinessQuizAnswers } from '@/lib/api'
import { appUrl } from '@/lib/region'
import {
  MARKETING_CONSENT_TEXT,
  SAVE_EXPLAINER,
  TRUST_LINES,
  TRUST_TITLE,
} from '@/lib/result-save-copy'

export function KeepResult({ answers }: { answers: ReadinessQuizAnswers }) {
  const [email, setEmail] = useState('')
  const [marketing, setMarketing] = useState(false)
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    haptic('light')
    setState('busy')
    setError(null)
    try {
      await requestMagicLink(email.trim(), answers, marketing)
      setState('sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send that — please try again.')
      setState('error')
    }
  }

  if (state === 'sent') {
    return (
      <GlassCard className="p-4 mt-4 w-full">
        <div role="status" aria-live="polite">
          <p className="text-sm font-semibold text-ink-primary">Check your email</p>
          <p className="text-sm text-ink-secondary mt-1 leading-relaxed">
            If that address can receive mail, a link and a 6-digit code are on their way. They work
            for 30 minutes. Opened it on another device? The link still works there, or you can
            enter the code instead.
          </p>
          <a
            href={appUrl('/keep-result')}
            className="text-xs text-family-400 font-semibold mt-2 inline-block"
          >
            Enter a code →
          </a>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="p-4 mt-4 w-full">
      <p className="text-sm font-semibold text-ink-primary">Keep this result</p>
      <p className="text-xs text-ink-tertiary mt-1 leading-relaxed">
        One email address. No password, no profile form.
      </p>
      <label className="block mt-3 text-xs font-medium text-ink-secondary" htmlFor="keep-email">
        Email address
      </label>
      <input
        id="keep-email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="glass-input w-full rounded-xl px-4 py-3 mt-1 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40"
      />
      <section aria-label={TRUST_TITLE} className="mt-3">
        <p className="text-xs font-semibold text-ink-primary">{TRUST_TITLE}</p>
        <ul className="text-xs text-ink-tertiary leading-relaxed space-y-1 mt-1">
          {TRUST_LINES.map((line) => (
            <li key={line}>• {line}</li>
          ))}
        </ul>
      </section>
      <label className="mt-3 flex items-start gap-2.5 text-xs text-ink-secondary leading-relaxed cursor-pointer">
        <input
          type="checkbox"
          checked={marketing}
          onChange={(e) => setMarketing(e.target.checked)}
          className="mt-0.5 accent-family-500"
        />
        {MARKETING_CONSENT_TEXT}
      </label>
      <p className="text-[11px] text-ink-tertiary mt-3 leading-relaxed">{SAVE_EXPLAINER}</p>
      {state === 'error' && error && <p className="text-xs text-danger mt-2">{error}</p>}
      <GlassButton onClick={submit} disabled={state === 'busy' || !email.trim()} className="mt-3">
        {state === 'busy' ? 'Sending…' : 'Email me a link to keep this'}
      </GlassButton>
    </GlassCard>
  )
}
