'use client'

/**
 * /resilience/businesses — the businesses a household member runs and the income each pays the household.
 * Tier 0. The server (PUT /family/businesses) validates and stores it, and (GET) works out what the
 * household's estimate says if each business stops. This page only collects the figures and shows the result.
 */

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PageHeader, GlassCard } from '@/components/Glass'
import { fetchFamilyBusinesses, saveFamilyBusinesses, type FamilyBusinesses } from '@/lib/api'

interface Row {
  id: string
  name: string
  /** Pounds per month, as typed, by adult id. */
  income: Record<string, string>
}

const toRows = (d: FamilyBusinesses): Row[] =>
  d.businesses.map((b) => ({
    id: b.id,
    name: b.name,
    income: Object.fromEntries(
      d.incomeEdges
        .filter((e) => e.businessId === b.id)
        .map((e) => [e.memberId, String(e.monthlyMinor / 100)]),
    ),
  }))

export default function BusinessesPage() {
  const [data, setData] = useState<FamilyBusinesses | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const reload = () =>
    fetchFamilyBusinesses()
      .then((d) => {
        setData(d)
        if (d) setRows(toRows(d))
      })
      .finally(() => setLoaded(true))
  useEffect(() => {
    void reload()
  }, [])

  const save = async () => {
    if (!data) return
    setBusy(true)
    setFailed(false)
    const named = rows.filter((r) => r.name.trim() !== '')
    const ok = await saveFamilyBusinesses({
      businesses: named.map((r) => ({ id: r.id, name: r.name.trim() })),
      incomeEdges: named.flatMap((r) =>
        data.adults
          .map((a) => ({ a, pounds: Number(r.income[a.id] ?? '') }))
          .filter(({ pounds }) => Number.isFinite(pounds) && pounds > 0)
          .map(({ a, pounds }) => ({
            businessId: r.id,
            memberId: a.id,
            monthlyMinor: Math.round(pounds * 100),
          })),
      ),
    })
    if (ok) await reload()
    else setFailed(true)
    setBusy(false)
  }

  const update = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader
        title="Businesses"
        backHref="/resilience"
        subtitle="What a business pays your household each month"
      />

      {!loaded && (
        <div className="flex justify-center py-10 text-ink-tertiary">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
        </div>
      )}

      {loaded && !data && (
        <GlassCard className="p-4 text-sm text-ink-secondary">
          This is for adults in your family.
        </GlassCard>
      )}

      {loaded && data && (
        <>
          {rows.map((r) => (
            <GlassCard key={r.id} className="p-4 space-y-3">
              <label className="block text-sm text-ink-secondary">
                Business name
                <input
                  className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-ink-primary"
                  value={r.name}
                  onChange={(e) => update(r.id, { name: e.target.value })}
                />
              </label>
              {data.adults.map((a) => (
                <label key={a.id} className="block text-sm text-ink-secondary">
                  {a.name} receives per month (£)
                  <input
                    inputMode="decimal"
                    className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-ink-primary"
                    value={r.income[a.id] ?? ''}
                    onChange={(e) =>
                      update(r.id, { income: { ...r.income, [a.id]: e.target.value } })
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                className="text-sm text-ink-tertiary underline"
                onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
              >
                Remove this business
              </button>
            </GlassCard>
          ))}
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-xl border border-line px-4 py-2 text-sm text-ink-primary"
              onClick={() =>
                setRows((rs) => [...rs, { id: crypto.randomUUID(), name: '', income: {} }])
              }
            >
              Add a business
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="rounded-xl bg-family-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Save
            </button>
          </div>
          {failed && (
            <p className="text-sm text-danger">
              Could not save that. Check the figures and try again.
            </p>
          )}

          {data.shocks.length > 0 && (
            <GlassCard className="p-4 space-y-3">
              <h2 className="text-sm font-semibold text-ink-tertiary uppercase tracking-wide">
                If a business stops
              </h2>
              {data.shocks.map((s) => (
                <div key={s.businessId} className="space-y-1">
                  <p className="text-sm font-medium text-ink-primary">{s.name}</p>
                  <p className="text-sm text-ink-secondary">{s.text}</p>
                </div>
              ))}
            </GlassCard>
          )}
        </>
      )}
    </div>
  )
}
