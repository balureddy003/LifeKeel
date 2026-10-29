'use client'

/**
 * Factual household briefs — pick a question from the catalogue, enter the
 * household's facts, get one deterministic answer both adults can confirm.
 * New briefs are addressed to a named adult; both sign in to acknowledge the
 * same stored result.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  createBrief,
  deleteBrief,
  getBriefCatalogue,
  listBriefs,
  reShareBrief,
  revokeBriefShare,
  type BriefCatalogueEntry,
  type BriefInputs,
  type HouseholdBrief,
} from '@/lib/api'
import { track } from '@/lib/growth-track'

const toMinor = (pounds: string) => Math.round((Number(pounds) || 0) * 100)

/** Intent 80 front doors — the four moments; the rest of the catalogue is
 *  reachable from the search box. */
const DOORS: ReadonlyArray<{ key: 'baby' | 'job' | 'care' | 'fix'; label: string }> = [
  { key: 'job', label: 'A job is changing' },
  { key: 'baby', label: 'A baby is coming' },
  { key: 'care', label: 'A parent needs care' },
  { key: 'fix', label: 'A fix is ending' },
]

function buildInputs(e: BriefCatalogueEntry, f: Record<string, string>): BriefInputs {
  const money = (k: string) => (f[k] ? toMinor(f[k]) : undefined)
  if (e.mode === 'handover') {
    const facts: Record<string, string> = {}
    for (const label of e.fields ?? []) {
      const v = (f[`fact:${label}`] ?? '').trim()
      if (v) facts[label] = v
    }
    return { change_date: f['change_date'], facts }
  }
  const i: BriefInputs = {
    monthly_income_minor: money('income'),
    monthly_essentials_minor: money('essentials'),
    liquid_savings_minor: money('savings'),
    change_date: f['change_date'],
  }
  if (f['new_income']) i.new_income_minor = money('new_income')
  if (f['new_essentials']) i.new_essentials_minor = money('new_essentials')
  if (f['cash_out']) i.cash_out_minor = money('cash_out')
  if (f['cash_in']) i.cash_in_minor = money('cash_in')
  if (f['return_date']) {
    i.return_date = f['return_date']
    i.return_income_minor = money('return_income')
    i.return_essentials_minor = money('return_essentials')
  }
  if (e.mode === 'stop' && f['ip']) {
    i.income_protection_monthly_minor = money('ip')
    if (f['defer']) i.deferred_period_months = Number(f['defer'])
    if (f['cover_end']) i.cover_end_date = f['cover_end']
  }
  const steps: Array<{
    date: string
    monthly_income_minor: number
    monthly_essentials_minor?: number
  }> = []
  for (let n = 0; f[`step_date:${n}`]; n++) {
    const inc = money(`step_income:${n}`)
    if (inc === undefined) continue
    const step: (typeof steps)[number] = {
      date: f[`step_date:${n}`]!,
      monthly_income_minor: inc,
    }
    const se = money(`step_essentials:${n}`)
    if (se !== undefined) step.monthly_essentials_minor = se
    steps.push(step)
  }
  if (steps.length) i.income_steps = steps
  if (f['decision_deadline']) i.decision_deadline = f['decision_deadline']
  if (f['recorded_cover']?.trim()) i.recorded_cover = f['recorded_cover'].trim()
  return i
}

function Fields({
  entry,
  f,
  set,
}: {
  entry: BriefCatalogueEntry
  f: Record<string, string>
  set: (v: Record<string, string>) => void
}) {
  const upd = (k: string) => (v: string) => set({ ...f, [k]: v })
  const num = (label: string, k: string) => (
    <label className="block text-sm" key={k}>
      <span className="text-gray-600">{label}</span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={f[k] ?? ''}
        onChange={(e) => upd(k)(e.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
      />
    </label>
  )
  const date = (label: string, k: string) => (
    <label className="block text-sm" key={k}>
      <span className="text-gray-600">{label}</span>
      <input
        type="date"
        value={f[k] ?? ''}
        onChange={(e) => upd(k)(e.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
      />
    </label>
  )
  const text = (label: string, k: string) => (
    <label className="block text-sm" key={k}>
      <span className="text-gray-600">{label}</span>
      <input
        type="text"
        maxLength={600}
        value={f[k] ?? ''}
        onChange={(e) => upd(k)(e.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
      />
    </label>
  )
  if (entry.mode === 'handover') {
    return (
      <div className="mt-6 space-y-4">
        {date(entry.trigger, 'change_date')}
        {(entry.fields ?? []).map((label) => (
          <label className="block text-sm" key={label}>
            <span className="text-gray-600">{label}</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={f[`fact:${label}`] ?? ''}
              onChange={(e) => set({ ...f, [`fact:${label}`]: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>
        ))}
        {entry.sensitive && (
          <p className="text-xs text-gray-500">
            These details are sensitive. Record only what the household chooses to share with the
            named adult — where things are, never a password or code.
          </p>
        )}
      </div>
    )
  }
  const moneyFields = [
    num('Take-home income / month (£)', 'income'),
    num('Spending / month (£)', 'essentials'),
    num('Liquid savings (£)', 'savings'),
  ]
  if (entry.mode !== 'cost' && entry.mode !== 'cash')
    moneyFields.push(num('Household income after change / month (£)', 'new_income'))
  if (entry.mode !== 'income')
    moneyFields.push(num('Spending after change / month (£)', 'new_essentials'))
  if (entry.mode === 'cash') {
    moneyFields.push(num('One-off payment from savings (£)', 'cash_out'))
    moneyFields.push(num('One-off cash received (£, optional)', 'cash_in'))
  }
  const stepsN = Number(f['steps_n'] ?? 0)
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {moneyFields}
      {date(entry.trigger, 'change_date')}
      <details
        className="sm:col-span-2"
        onToggle={(e) => {
          if ((e.target as HTMLDetailsElement).open)
            track('brief_form_step', { step: 'optional_opened', problem_type: entry.id })
        }}
      >
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          More detail (optional — cover, later changes, dated steps)
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {entry.mode === 'stop' && (
            <>
              {num('Recorded cover payment / month (£, optional)', 'ip')}
              {num('Cover waiting period (months)', 'defer')}
              {date('Cover payments end (optional)', 'cover_end')}
            </>
          )}
          {(entry.id === 'unpaid_leave' ||
            entry.id === 'self_employed' ||
            entry.id === 'pregnancy') && (
            <>
              {date('Return / end date (optional)', 'return_date')}
              {f['return_date'] && (
                <>
                  {num('Income from then / month (£)', 'return_income')}
                  {num('Spending from then / month (£)', 'return_essentials')}
                </>
              )}
            </>
          )}
          {text('Recorded cover or end-date notes (optional)', 'recorded_cover')}
          {date('Household-entered deadline (optional)', 'decision_deadline')}
          <div className="sm:col-span-2">
            {Array.from({ length: stepsN }).map((_, n) => (
              <div key={n} className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {date(`Step ${n + 1} date`, `step_date:${n}`)}
                {num(`Step ${n + 1} income / month (£)`, `step_income:${n}`)}
                {num(`Step ${n + 1} spending (£, optional)`, `step_essentials:${n}`)}
              </div>
            ))}
            <button
              type="button"
              onClick={() => set({ ...f, steps_n: String(stepsN + 1) })}
              className="mt-2 text-sm font-medium text-gray-700 underline"
            >
              + Add a dated step
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}

export default function BriefsPage() {
  const [catalogue, setCatalogue] = useState<BriefCatalogueEntry[]>([])
  const [recipients, setRecipients] = useState<Array<{ id: string; name: string }>>([])
  const [briefs, setBriefs] = useState<HouseholdBrief[]>([])
  const [entry, setEntry] = useState<BriefCatalogueEntry | null>(null)
  const [forMember, setForMember] = useState('')
  const [f, setF] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<HouseholdBrief | null>(null)
  const [gateHit, setGateHit] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getBriefCatalogue().then((c) => {
      setCatalogue(c.catalogue)
      setRecipients(c.recipients)
      setEntry(c.catalogue.find((e) => e.id === 'income_stops') ?? c.catalogue[0] ?? null)
      setForMember(c.recipients[0]?.id ?? '')
    })
    void listBriefs().then(setBriefs)
  }, [])

  async function submit() {
    if (!entry) return
    setBusy(true)
    setError(null)
    setGateHit(false)
    const res = await createBrief({
      contract_version: 2,
      problem_type: entry.id,
      inputs: buildInputs(entry, f),
      for_member_id: forMember || null,
    })
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
  const [door, setDoor] = useState<'baby' | 'job' | 'care' | 'fix' | null>(null)
  const [query, setQuery] = useState('')
  const visible = query
    ? catalogue.filter((e) => e.title.toLowerCase().includes(query.toLowerCase()))
    : door
      ? catalogue.filter((e) => e.moment === door)
      : catalogue
  const groups = [...new Set(visible.map((e) => e.group))]

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Household briefs</h1>
      <p className="mt-2 text-gray-600">
        One question, a few facts, one answer both adults confirm they have seen. Nothing here is a
        recommendation.
      </p>

      {catalogue.length > 0 && (
        <div className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="text-gray-600">Share with</span>
            <select
              value={forMember}
              onChange={(e) => setForMember(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">Choose the other adult</option>
              {recipients.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Pick the moment"
          >
            {DOORS.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => {
                  const next = door === d.key ? null : d.key
                  setDoor(next)
                  if (next) track('brief_door_used', { door: d.key })
                }}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  door === d.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300'
                }`}
              >
                {d.label}
              </button>
            ))}
            <input
              type="search"
              placeholder="Search all briefs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              aria-label="Search briefs"
            />
          </div>
          {groups.map((g) => (
            <section key={g}>
              <h2 className="text-sm font-medium text-gray-500">{g}</h2>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {visible
                  .filter((e) => e.group === g)
                  .map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => {
                        setEntry(e)
                        setF({})
                      }}
                      className={`rounded-lg border p-3 text-left text-sm ${
                        entry?.id === e.id ? 'border-gray-900' : 'border-gray-200'
                      }`}
                    >
                      {e.title}
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {entry && <Fields entry={entry} f={f} set={setF} />}

      <button
        type="button"
        disabled={busy || !entry}
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
          {(created.facts ?? []).length > 0 && (
            <dl className="mt-4 space-y-1 text-sm">
              {created.facts!.map((x, i) => (
                <div key={i} className="flex justify-between gap-4 border-b pb-1">
                  <dt className="text-gray-500">{x.label}</dt>
                  <dd className="text-right">{x.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-3 text-sm text-gray-600">
            Send this link to {created.share?.for_member_name ?? 'the other adult'}. You each
            confirm separately once you&apos;ve read it.
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
              <li key={b.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {b.title ??
                      catalogue.find((e) => e.id === b.problem_type)?.title ??
                      b.problem_type}
                    {b.stale ? (
                      <span className="ml-2 text-xs text-amber-600">(out of date)</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(b.created_at).toLocaleDateString('en-GB')}
                    {b.confirmation?.both_confirmed
                      ? ' · confirmed by both adults'
                      : b.confirmation?.recipient_at || b.confirmed_opened_at
                        ? ' · opened — your confirmation pending'
                        : ' · waiting for both confirmations'}
                  </p>
                </div>
                <div className="flex gap-3 text-xs">
                  {b.share && !b.share.revoked && (
                    <button
                      type="button"
                      onClick={() =>
                        void revokeBriefShare(b.id).then(() => listBriefs().then(setBriefs))
                      }
                      className="text-gray-500 underline"
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
                      className="text-gray-500 underline"
                    >
                      New link
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteBrief(b.id).then(() => listBriefs().then(setBriefs))}
                    className="text-red-500 underline"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
