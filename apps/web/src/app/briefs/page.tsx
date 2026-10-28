'use client'

/**
 * PRD-222 — the Stage 1 brief surface: pick one of the three problems,
 * a few inputs, one solver result, a share link, opened status.
 * No chart, no sample family, no document upload required.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  createBrief,
  listBriefs,
  reShareBrief,
  revokeBriefShare,
  type BriefInputs,
  type BriefProblemType,
  type HouseholdBrief,
} from '@/lib/api'

const PROBLEMS: Array<{ id: BriefProblemType; title: string; hint: string }> = [
  {
    id: 'income_stops',
    title: 'One of us might stop earning',
    hint: 'How many months could the household run if an income stopped?',
  },
  {
    id: 'earning_less',
    title: 'Someone is about to earn less',
    hint: 'A known drop is coming — how far do savings go after it lands?',
  },
  {
    id: 'handover_gap',
    title: 'The other adult does not know',
    hint: 'Runway plus the people, papers and policies they would need.',
  },
]

const toMinor = (pounds: string) => Math.round((Number(pounds) || 0) * 100)
const gbp = (minor: unknown) =>
  typeof minor === 'number' ? `£${Math.round(Math.abs(minor) / 100).toLocaleString('en-GB')}` : '—'

export default function BriefsPage() {
  const [briefs, setBriefs] = useState<HouseholdBrief[]>([])
  const [problem, setProblem] = useState<BriefProblemType>('income_stops')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<HouseholdBrief | null>(null)
  const [gateHit, setGateHit] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({
    income: '',
    essentials: '',
    savings: '',
    ip: '',
    defer: '',
    newIncome: '',
    until: '',
  })

  useEffect(() => {
    void listBriefs().then(setBriefs)
  }, [])

  async function submit() {
    setBusy(true)
    setError(null)
    setGateHit(false)
    const inputs: BriefInputs = {
      monthly_income_minor: toMinor(f.income),
      monthly_essentials_minor: toMinor(f.essentials),
      liquid_savings_minor: toMinor(f.savings),
      income_protection_monthly_minor: f.ip ? toMinor(f.ip) : undefined,
      deferred_period_months: f.defer ? Number(f.defer) : undefined,
      new_income_minor: f.newIncome ? toMinor(f.newIncome) : undefined,
      months_until_change: f.until ? Number(f.until) : undefined,
    }
    const res = await createBrief({ problem_type: problem, inputs })
    setBusy(false)
    if (!res.ok) {
      if (res.status === 402) return setGateHit(true)
      return setError((res.data as { error?: string })?.error ?? 'Could not create the brief')
    }
    setCreated(res.data!.brief)
    setBriefs(await listBriefs())
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareUrl = created?.share?.url ? `${origin}/b/${created.share.url}` : null

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Household briefs</h1>
      <p className="mt-2 text-gray-600">
        One problem, a few numbers, one answer both adults can see.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {PROBLEMS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setProblem(p.id)}
            className={`rounded-lg border p-3 text-left text-sm ${
              problem === p.id ? 'border-gray-900' : 'border-gray-200'
            }`}
          >
            <div className="font-medium">{p.title}</div>
            <div className="mt-1 text-xs text-gray-500">{p.hint}</div>
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Field
          label="Take-home income / month (£)"
          v={f.income}
          set={(v) => setF({ ...f, income: v })}
        />
        <Field
          label="Essentials / month (£)"
          v={f.essentials}
          set={(v) => setF({ ...f, essentials: v })}
        />
        <Field label="Liquid savings (£)" v={f.savings} set={(v) => setF({ ...f, savings: v })} />
        {problem === 'income_stops' && (
          <>
            <Field
              label="Income-protection cover / month (£, optional)"
              v={f.ip}
              set={(v) => setF({ ...f, ip: v })}
            />
            <Field
              label="Cover waiting period (months, optional)"
              v={f.defer}
              set={(v) => setF({ ...f, defer: v })}
            />
          </>
        )}
        {problem === 'earning_less' && (
          <>
            <Field
              label="New income / month (£)"
              v={f.newIncome}
              set={(v) => setF({ ...f, newIncome: v })}
            />
            <Field
              label="Months until the change"
              v={f.until}
              set={(v) => setF({ ...f, until: v })}
            />
          </>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="mt-6 rounded-lg bg-gray-900 px-5 py-2.5 text-white disabled:opacity-50"
      >
        {busy ? 'Working it out…' : 'Create the brief'}
      </button>

      {gateHit && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          Your first brief is free. Keeping the record and running further briefs needs the
          household record.
          <Link href="/upgrade" className="ml-2 font-medium underline">
            See the plan
          </Link>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {created && shareUrl && (
        <div className="mt-8 rounded-lg border p-5">
          <p className="text-lg leading-relaxed">{created.template_sentence}</p>
          <p className="mt-3 text-sm text-gray-600">
            Send this link to {created.share?.for_member_name ?? 'the other adult'}. They tap “view
            the numbers” — you’ll see when they’ve opened it.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-gray-100 px-2 py-1 text-xs">
              {shareUrl}
            </code>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(shareUrl)}
              className="rounded border px-3 py-1 text-sm"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {briefs.length > 0 && (
        <section className="mt-10">
          <h2 className="font-medium">Your briefs</h2>
          <ul className="mt-3 divide-y">
            {briefs.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">
                    {PROBLEMS.find((p) => p.id === b.problem_type)?.title ?? b.problem_type}
                    {b.stale ? (
                      <span className="ml-2 text-xs text-amber-600">(out of date)</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(b.created_at).toLocaleDateString('en-GB')}
                    {b.confirmed_opened_at
                      ? ` · opened ${new Date(b.confirmed_opened_at).toLocaleDateString('en-GB')}`
                      : ' · not opened yet'}
                  </p>
                </div>
                {b.share && !b.share.revoked && (
                  <button
                    type="button"
                    onClick={() =>
                      void revokeBriefShare(b.id).then(() => listBriefs().then(setBriefs))
                    }
                    className="text-xs text-gray-500 underline"
                  >
                    Revoke link
                  </button>
                )}
                {(b.share?.revoked || !b.share) && (
                  <button
                    type="button"
                    onClick={() =>
                      void reShareBrief(b.id).then((r) => {
                        if (r.ok && r.data?.share.url)
                          void navigator.clipboard.writeText(`${origin}/b/${r.data.share.url}`)
                      })
                    }
                    className="text-xs text-gray-500 underline"
                  >
                    New link
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function Field({ label, v, set }: { label: string; v: string; set: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-600">{label}</span>
      <input
        type="number"
        value={v}
        onChange={(e) => set(e.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        min={0}
      />
    </label>
  )
}
