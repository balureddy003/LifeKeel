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
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouteParam } from '@/lib/useRouteParam'
import { getApiBase } from '@/lib/env'

interface SharedBrief {
  problem_type: string
  title?: string
  result_version?: string
  result: Record<string, unknown> | null
  template_sentence: string
  facts?: Array<{ label: string; value: string }>
  for_member_name: string | null
  can_confirm?: boolean
  confirmation?: {
    creator_at: string | null
    recipient_at: string | null
    both_confirmed: boolean
  }
  confirmed_opened_at: string | null
  created_at: string
  sections?: {
    adults?: Array<{ name: string | null; role: string | null }>
    key_papers?: Array<{ title: string; location: string }>
    accounts?: Array<{ name: string | null; kind: string | null }>
    policies?: Array<{ type: unknown; provider: unknown; renewal_date: unknown }>
  }
}

const gbp = (minor: unknown) =>
  typeof minor === 'number' ? `£${Math.round(Math.abs(minor) / 100).toLocaleString('en-GB')}` : null

export default function BriefShareClient() {
  const token = useRouteParam('/b')
  const [brief, setBrief] = useState<SharedBrief | null>(null)
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'open' | 'gone' | 'expired' | 'signin' | 'denied' | 'error'
  >('loading')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(`${getApiBase()}/b/${token}`, { cache: 'no-store', credentials: 'include' })
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 401) return setStatus('signin')
        if (r.status === 403) return setStatus('denied')
        if (r.status === 410) return setStatus('gone')
        if (!r.ok) return setStatus('expired')
        setBrief((await r.json()) as SharedBrief)
        setStatus('ready')
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
    }
  }, [token])

  async function confirmAndView() {
    if (!token || !brief?.result_version) return
    setConfirming(true)
    const r = await fetch(`${getApiBase()}/b/${token}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ result_version: brief.result_version }),
      cache: 'no-store',
    })
    setConfirming(false)
    if (r.status === 401) return setStatus('signin')
    if (r.status === 403) return setStatus('denied')
    if (!r.ok) return setStatus(r.status === 410 ? 'gone' : 'error')
    setStatus('open')
  }

  const name = brief?.for_member_name ?? 'the person this was sent to'

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="text-sm text-gray-500">A household brief from LifeKeel</p>

      {status === 'loading' && <p className="mt-8 text-gray-600">Loading…</p>}
      {status === 'signin' && (
        <>
          <h1 className="mt-6 text-2xl font-semibold">Sign in to read this brief</h1>
          <p className="mt-3 text-gray-600">
            This brief is shared with one named adult. Sign in as {name} — then come back to this
            link to view and confirm it.
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(`/b/${token}`)}`}
            className="mt-6 inline-block rounded-lg bg-gray-900 px-4 py-3 text-white"
          >
            Sign in
          </Link>
        </>
      )}
      {status === 'denied' && (
        <>
          <h1 className="mt-6 text-2xl font-semibold">This brief isn&apos;t addressed to you</h1>
          <p className="mt-3 text-gray-600">
            Only the two adults named on this brief can open it. Sign in as {name}, or ask the
            sender for a link made for you.
          </p>
        </>
      )}
      {status === 'gone' && (
        <>
          <h1 className="mt-6 text-2xl font-semibold">This link was revoked</h1>
          <p className="mt-3 text-gray-600">Ask the person who sent it for a fresh one.</p>
        </>
      )}
      {(status === 'expired' || status === 'error') && (
        <>
          <h1 className="mt-6 text-2xl font-semibold">This link has expired</h1>
          <p className="mt-3 text-gray-600">
            Links last 30 days. Ask the person who sent it to share a fresh one.
          </p>
        </>
      )}

      {status === 'ready' && brief && (
        <>
          <h1 className="mt-6 text-2xl font-semibold">
            {brief.title ?? 'This brief was prepared for you'}
          </h1>
          <p className="mt-3 text-gray-600">
            It answers one household question with the facts entered and one calculation. Nothing
            here is a product recommendation.
          </p>
          {brief.can_confirm ? (
            <button
              type="button"
              disabled={confirming}
              onClick={() => void confirmAndView()}
              className="mt-8 w-full rounded-lg bg-gray-900 px-4 py-3 text-white disabled:opacity-50"
            >
              {confirming ? 'Confirming…' : `I&apos;m ${name} — view the numbers`}
            </button>
          ) : (
            <p className="mt-6 text-sm text-gray-500">
              This brief can be viewed but not confirmed — it was shared before both-adult
              confirmation was introduced.
            </p>
          )}
        </>
      )}

      {status === 'open' && brief && (
        <>
          <p className="mt-8 text-lg leading-relaxed">{brief.template_sentence}</p>
          {brief.result?.['projectedRunwayMonths'] !== undefined &&
            typeof brief.result['projectedRunwayMonths'] === 'number' && (
              <dl className="mt-8 space-y-2 text-gray-700">
                <div className="flex justify-between border-b pb-2">
                  <dt>Months the household can run</dt>
                  <dd className="font-medium">{String(brief.result['projectedRunwayMonths'])}</dd>
                </div>
                {gbp(brief.result['savingsAtChangeMinor']) && (
                  <div className="flex justify-between border-b pb-2">
                    <dt>Savings in the calculation</dt>
                    <dd className="font-medium">{gbp(brief.result['savingsAtChangeMinor'])}</dd>
                  </div>
                )}
              </dl>
            )}
          {(brief.facts ?? []).length > 0 && (
            <dl className="mt-8 space-y-2 text-sm">
              {brief.facts!.map((x, i) => (
                <div key={i} className="flex justify-between gap-4 border-b pb-2">
                  <dt className="text-gray-500">{x.label}</dt>
                  <dd className="text-right text-gray-800">{x.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {brief.sections && (
            <section className="mt-10 space-y-6">
              {!!brief.sections.adults?.length && (
                <div>
                  <h2 className="font-medium">Who to call</h2>
                  <ul className="mt-2 list-disc pl-5 text-gray-700">
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
                  <h2 className="font-medium">Key papers</h2>
                  <ul className="mt-2 list-disc pl-5 text-gray-700">
                    {brief.sections.key_papers.map((p, i) => (
                      <li key={i}>
                        {p.title} <span className="text-gray-500">— {p.location}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!!brief.sections.policies?.length && (
                <div>
                  <h2 className="font-medium">Policies on file</h2>
                  <ul className="mt-2 list-disc pl-5 text-gray-700">
                    {brief.sections.policies.map((p, i) => (
                      <li key={i}>
                        {String(p.provider ?? p.type ?? 'Policy')}
                        {p.renewal_date ? ` — renews ${String(p.renewal_date)}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
          <p className="mt-10 text-xs text-gray-400">
            Worked out {new Date(brief.created_at).toLocaleDateString('en-GB')} from what the
            household entered. Your confirmation is recorded against this exact version. LifeKeel
            shows figures — it does not recommend products.
          </p>
        </>
      )}
    </main>
  )
}
