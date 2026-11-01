'use client'

/**
 * The shared household brief. Two-step by design:
 *   1. GET /b/:token — stamps link_fetched_at (telemetry only; unfurlers and
 *      scanners land here). Catalogue briefs additionally require the
 *      intended adult's session.
 *   2. The adult taps "view the numbers" — POST /b/:token/confirm carrying the
 *      result_version they actually saw — which stamps their acknowledgement.
 *      Both named adults must confirm separately; neither can confirm for the
 *      other, and a stale version is refused.
 *
 * Both calls send the session cookie AND the Bearer token. The cookie alone is
 * not enough: a cross-site cookie is dropped by Safari and by any browser with
 * third-party cookies off, which would show a signed-in recipient "sign in".
 */
import { useCallback, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import { AlertCircle, Check, Clock, Lock, Printer, ShieldCheck } from 'lucide-react'
import { GlassCard, Skeleton } from '@/components/Glass'
import { useRouteParam } from '@/lib/useRouteParam'
import { getApiBase } from '@/lib/env'
import { getAuthToken } from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { briefHeadline, plainDates, splitBriefSentence } from '@/lib/brief-text'

interface Confirmation {
  creator_at: string | null
  recipient_at: string | null
  both_confirmed: boolean
}

interface SharedBrief {
  problem_type: string
  title?: string
  result_version?: string
  result: Record<string, unknown> | null
  template_sentence: string
  facts?: Array<{ label: string; value: string }>
  for_member_name: string | null
  from_name?: string | null
  can_confirm?: boolean
  confirmation?: Confirmation
  confirmed_opened_at: string | null
  created_at: string
  sections?: {
    adults?: Array<{ name: string | null; role: string | null }>
    key_papers?: Array<{ title: string; location: string }>
    accounts?: Array<{ name: string | null; kind: string | null }>
    policies?: Array<{ type: unknown; provider: unknown; renewal_date: unknown }>
  }
}

type Status = 'loading' | 'ready' | 'open' | 'gone' | 'expired' | 'signin' | 'denied' | 'error'

const gbp = (minor: unknown) =>
  typeof minor === 'number' ? `£${Math.round(Math.abs(minor) / 100).toLocaleString('en-GB')}` : null

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  const token = getAuthToken()
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children?: React.ReactNode
}) {
  return (
    <GlassCard className="mt-6 p-6">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-family-500/10 text-family-400">
        {icon}
      </div>
      <h1 className="text-xl font-semibold tracking-tight text-ink-primary">{title}</h1>
      <div className="mt-2 space-y-4 text-ink-secondary">{children}</div>
    </GlassCard>
  )
}

const primaryBtn =
  'inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-family-500 px-5 text-base font-semibold text-white disabled:opacity-50'

export default function BriefShareClient() {
  const token = useRouteParam('/b')
  const [brief, setBrief] = useState<SharedBrief | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [confirming, setConfirming] = useState(false)
  const reduce = useReducedMotion()
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const load = useCallback(() => {
    if (!token) return () => {}
    let cancelled = false
    setStatus('loading')
    fetch(`${getApiBase()}/b/${token}`, {
      cache: 'no-store',
      credentials: 'include',
      headers: headers(),
    })
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 401) return setStatus('signin')
        if (r.status === 403) return setStatus('denied')
        if (r.status === 410) return setStatus('gone')
        if (r.status === 404) return setStatus('expired')
        if (!r.ok) return setStatus('error')
        const data = (await r.json()) as SharedBrief
        setBrief(data)
        setConfirmation(data.confirmation ?? null)
        setStatus('ready')
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => load(), [load])

  async function confirmAndView() {
    if (!token || !brief?.result_version) return
    setConfirming(true)
    setConfirmError(null)
    try {
      const r = await fetch(`${getApiBase()}/b/${token}/confirm`, {
        method: 'POST',
        headers: headers(true),
        credentials: 'include',
        body: JSON.stringify({ result_version: brief.result_version }),
        cache: 'no-store',
      })
      if (r.status === 401) return setStatus('signin')
      if (r.status === 403) return setStatus('denied')
      if (r.status === 410) return setStatus('gone')
      if (r.status === 409) {
        setConfirmError(
          'This brief was updated while you had it open. Reloading the latest version.',
        )
        return void load()
      }
      if (!r.ok) return setConfirmError('We could not record your confirmation. Please try again.')
      const data = (await r.json().catch(() => ({}))) as { confirmation?: Confirmation }
      if (data.confirmation) setConfirmation(data.confirmation)
      haptic('success')
      setStatus('open')
    } catch {
      setConfirmError('We could not reach LifeKeel. Check your connection and try again.')
    } finally {
      setConfirming(false)
    }
  }

  const name = brief?.for_member_name ?? null
  const runway = brief?.result?.['projectedRunwayMonths']
  const confirmed = confirmation?.recipient_at
  const sentence = splitBriefSentence(brief?.template_sentence ?? '')

  return (
    <main className="mx-auto max-w-xl px-4 py-8" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-ink-tertiary">
        <ShieldCheck size={16} aria-hidden="true" /> A household brief from LifeKeel
      </p>

      {status === 'loading' && (
        <div className="mt-6 space-y-3" role="status" aria-label="Loading the brief">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {status === 'signin' && (
        <Notice icon={<Lock size={20} />} title="Sign in to see this brief">
          <p>
            This brief was shared with one named adult in a household. Sign in as that adult and you
            will come straight back here. If you have not set up your account yet, use the invite
            email or link from the person who sent this.
          </p>
          <Link href={`/login?next=${encodeURIComponent(`/b/${token}`)}`} className={primaryBtn}>
            Sign in
          </Link>
        </Notice>
      )}

      {status === 'denied' && (
        <Notice icon={<Lock size={20} />} title="This brief was sent to someone else">
          <p>
            You are signed in, but this link was made for another adult in the household. Ask the
            sender for a link addressed to you.
          </p>
        </Notice>
      )}

      {status === 'gone' && (
        <Notice icon={<AlertCircle size={20} />} title="This link was turned off">
          <p>The person who sent it stopped sharing it. Ask them for a fresh link.</p>
        </Notice>
      )}

      {status === 'expired' && (
        <Notice icon={<Clock size={20} />} title="This link has expired">
          <p>Links last 30 days. Ask the person who sent it to share a fresh one.</p>
        </Notice>
      )}

      {status === 'error' && (
        <Notice icon={<AlertCircle size={20} />} title="We couldn’t load this brief">
          <p>Check your connection and try again.</p>
          <button type="button" onClick={() => void load()} className={primaryBtn}>
            Try again
          </button>
        </Notice>
      )}

      {status === 'ready' && brief && (
        <GlassCard className="mt-6 p-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-primary">
            {brief.title ?? 'A brief prepared for you'}
          </h1>
          {name && (
            <p className="mt-1 text-sm text-ink-tertiary">
              {brief.from_name
                ? `${brief.from_name} prepared this for ${name}`
                : `Prepared for ${name}`}
            </p>
          )}
          <p className="mt-4 text-ink-secondary">
            The months and the date are on the next screen. Tapping records that you have seen this
            exact version.
          </p>
          {brief.can_confirm ? (
            <button
              type="button"
              disabled={confirming}
              onClick={() => void confirmAndView()}
              className={`${primaryBtn} mt-6`}
            >
              {confirming
                ? 'Confirming…'
                : name
                  ? `I’m ${name} — view the numbers`
                  : 'View the numbers'}
            </button>
          ) : (
            <p className="mt-6 text-sm text-ink-tertiary">
              This brief can be viewed but not confirmed: it was shared before two-adult
              confirmation was introduced.
            </p>
          )}
          {confirmError && (
            <p role="alert" className="mt-3 text-sm text-red-500">
              {confirmError}
            </p>
          )}
        </GlassCard>
      )}

      {status === 'open' && brief && (
        <div className="mt-6 space-y-4">
          <GlassCard className="p-6">
            <h1 className="text-sm font-medium text-ink-tertiary">{brief.title}</h1>
            <p className="mt-3 text-2xl font-semibold leading-snug text-ink-primary">
              {briefHeadline(sentence.main)}
            </p>
            {typeof runway === 'number' ? (
              <p className="mt-2 text-ink-primary">
                <span className="text-3xl font-semibold tracking-tight">{runway}</span>
                <span className="ml-2 text-base text-ink-secondary">
                  months of savings after the change
                </span>
              </p>
            ) : null}
            <details className="mt-2">
              <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-medium text-family-400">
                How this was worked out
              </summary>
              <p className="text-ink-secondary">{sentence.main}</p>
              {sentence.note && <p className="mt-2 text-xs text-ink-tertiary">{sentence.note}</p>}
            </details>
            {gbp(brief.result?.['savingsAtChangeMinor']) && (
              <p className="mt-3 text-sm text-ink-tertiary">
                Savings in the calculation: {gbp(brief.result?.['savingsAtChangeMinor'])}
              </p>
            )}
          </GlassCard>

          {brief.sections && (
            <GlassCard className="space-y-6 p-6">
              {!!brief.sections.adults?.length && (
                <div>
                  <h2 className="font-medium text-ink-primary">Who to call</h2>
                  <ul className="mt-2 list-disc pl-5 text-ink-secondary">
                    {brief.sections.adults.map((a, i) => (
                      <li key={i}>
                        {a.name ?? 'Household member'}
                        {a.role ? ` — ${a.role}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!brief.sections.key_papers?.length && (
                <div>
                  <h2 className="font-medium text-ink-primary">Key papers</h2>
                  <ul className="mt-2 list-disc pl-5 text-ink-secondary">
                    {brief.sections.key_papers.map((p, i) => (
                      <li key={i}>
                        {p.title} <span className="text-ink-tertiary">— {p.location}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!brief.sections.policies?.length && (
                <div>
                  <h2 className="font-medium text-ink-primary">Policies on file</h2>
                  <ul className="mt-2 list-disc pl-5 text-ink-secondary">
                    {brief.sections.policies.map((p, i) => (
                      <li key={i}>
                        {String(p.provider ?? p.type ?? 'Policy')}
                        {p.renewal_date ? ` — renews ${String(p.renewal_date)}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </GlassCard>
          )}

          <div
            className={`flex items-start gap-3 rounded-2xl border p-4 ${
              confirmation?.both_confirmed
                ? 'border-green-500/30 bg-green-500/10'
                : 'border-haze bg-surface-1'
            }`}
          >
            {confirmation?.both_confirmed ? (
              <motion.span
                className="mt-0.5 shrink-0"
                initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
              >
                <Check className="text-green-500" size={20} aria-hidden="true" />
              </motion.span>
            ) : (
              <Clock className="mt-0.5 shrink-0 text-ink-tertiary" size={20} aria-hidden="true" />
            )}
            <p className="text-sm text-ink-secondary">
              {confirmation?.both_confirmed
                ? 'You and the sender have both confirmed this version.'
                : confirmed
                  ? 'You have confirmed this version. The sender has not confirmed yet.'
                  : 'Your confirmation has been recorded.'}
            </p>
          </div>

          {(brief.facts ?? []).length > 0 && (
            <GlassCard className="p-6">
              <h2 className="font-medium text-ink-primary">What was entered</h2>
              <dl className="mt-3 space-y-2 text-sm">
                {brief.facts!.map((x, i) => (
                  <div key={i} className="flex justify-between gap-4 border-b border-haze pb-2">
                    <dt className="text-ink-tertiary">{plainDates(x.label)}</dt>
                    <dd
                      className={`text-right text-ink-primary ${
                        x.value.length <= 24 ? 'shrink-0 whitespace-nowrap' : 'min-w-0 break-words'
                      }`}
                    >
                      {plainDates(x.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </GlassCard>
          )}

          <GlassCard className="p-5 print:hidden">
            <p className="font-medium text-ink-primary">What happens next</p>
            <ul className="mt-2 space-y-2 text-sm text-ink-secondary">
              <li>Take a moment to talk it over together. This is information, not a decision.</li>
              <li>
                Figures change.{' '}
                {brief.from_name
                  ? `Ask ${brief.from_name} to update them when something moves.`
                  : 'Ask the sender to update them when something moves.'}
              </li>
            </ul>
            <Link
              href="/"
              className="mt-4 inline-flex min-h-[44px] items-center rounded-full border border-haze px-4 text-sm font-medium text-ink-secondary"
            >
              Open LifeKeel
            </Link>
          </GlassCard>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-haze px-4 text-sm font-medium text-ink-secondary print:hidden"
          >
            <Printer size={16} aria-hidden="true" /> Print or save as PDF
          </button>

          <p className="text-xs text-ink-tertiary">
            Worked out {plainDates(brief.created_at.slice(0, 10))} from what the household entered.
            Your confirmation is recorded against this exact version. LifeKeel shows figures — it
            does not recommend products.
          </p>
        </div>
      )}
    </main>
  )
}
