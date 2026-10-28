'use client'

/**
 * PRD-222 — the shared household brief, opened by the second adult.
 *
 * Two-step by design (the "opened_at is not seen by the partner" fix):
 *   1. GET /b/:token fetch — stamps link_fetched_at (telemetry only;
 *      WhatsApp/iMessage unfurlers and mail scanners land here).
 *   2. The visitor taps "View the numbers" — POST /b/:token/confirm —
 *      which stamps confirmed_opened_at, the timestamp the product
 *      promise is made on. The result only renders after that explicit
 *      action, so a scanner can never register as "the other adult
 *      has seen it".
 */
import { useEffect, useState } from 'react'
import { useRouteParam } from '@/lib/useRouteParam'
import { getApiBase } from '@/lib/env'

interface SharedBrief {
  problem_type: string
  result: Record<string, unknown> | null
  template_sentence: string
  for_member_name: string | null
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
  const [status, setStatus] = useState<'loading' | 'ready' | 'open' | 'gone' | 'expired' | 'error'>(
    'loading',
  )

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(`${getApiBase()}/b/${token}`, { cache: 'no-store' })
      .then(async (r) => {
        if (cancelled) return
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
    if (!token) return
    const r = await fetch(`${getApiBase()}/b/${token}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    })
    if (!r.ok) return setStatus(r.status === 410 ? 'gone' : 'expired')
    setStatus('open')
  }

  const name = brief?.for_member_name ?? 'the person this was sent to'

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="text-sm text-gray-500">A household brief from LifeKeel</p>

      {status === 'loading' && <p className="mt-8 text-gray-600">Loading…</p>}
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
          <h1 className="mt-6 text-2xl font-semibold">This brief was prepared for {name}</h1>
          <p className="mt-3 text-gray-600">
            It answers one household question with a number, worked out from what was on file.
            Nothing here is a product recommendation.
          </p>
          <button
            type="button"
            onClick={() => void confirmAndView()}
            className="mt-8 w-full rounded-lg bg-gray-900 px-4 py-3 text-white"
          >
            I&apos;m {name} — view the numbers
          </button>
        </>
      )}

      {status === 'open' && brief?.result && (
        <>
          <p className="mt-8 text-lg leading-relaxed">{brief.template_sentence}</p>
          <dl className="mt-8 space-y-2 text-gray-700">
            {typeof brief.result['projectedRunwayMonths'] === 'number' && (
              <div className="flex justify-between border-b pb-2">
                <dt>Months the household can run</dt>
                <dd className="font-medium">{String(brief.result['projectedRunwayMonths'])}</dd>
              </div>
            )}
            {gbp(brief.result['savingsAtChangeMinor']) && (
              <div className="flex justify-between border-b pb-2">
                <dt>Savings in the calculation</dt>
                <dd className="font-medium">{gbp(brief.result['savingsAtChangeMinor'])}</dd>
              </div>
            )}
          </dl>

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
            Worked out {new Date(brief.created_at).toLocaleDateString('en-GB')} from what was on
            file. LifeKeel shows figures — it does not recommend products.
          </p>
        </>
      )}
    </main>
  )
}
