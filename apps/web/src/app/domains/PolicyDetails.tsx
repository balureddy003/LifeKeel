'use client'

import { useEffect, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import {
  checkPolicyPremium,
  editFamilyPolicy,
  fetchFinancialProfile,
  type FinancialProfilePolicy,
  type PolicyCheck,
} from '@/lib/api'
import { describeChange } from '@/lib/policy-change-summary'
import { inputCls } from './AddRecordForm'

const TYPE_LABEL: Record<string, string> = {
  life: 'Life cover',
  income_protection: 'Income protection',
  critical_illness: 'Critical illness cover',
}

const gbp = (minor: number) =>
  `£${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

/** Digits and a leading plus only, so a number written "0800 000 0000" dials. */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

/**
 * What was typed for each policy, in one place: cover, premiums, whether the two premiums agree,
 * and who to call. The coverage table says who is covered by what; this says what the policy is.
 * Facts and arithmetic only. It never says whether the cover is enough.
 */
export function PolicyDetails({ types }: { types: string[] }) {
  const [policies, setPolicies] = useState<FinancialProfilePolicy[] | null>(null)
  const [checks, setChecks] = useState<Record<string, PolicyCheck | null>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ cover: '', monthly: '', annual: '' })
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [summary, setSummary] = useState<
    Record<string, { headline: string; stays: string | null }>
  >({})
  const [liveCheck, setLiveCheck] = useState<PolicyCheck | null>(null)

  const toMinor = (v: string): number | undefined => {
    const n = Number(v.replace(/[£,\s]/g, ''))
    return v.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined
  }
  const asPounds = (minor?: number) => (minor && minor > 0 ? String(minor / 100) : '')

  // The mismatch check reruns as the figures are typed.
  useEffect(() => {
    if (!editing) return
    const m = toMinor(draft.monthly)
    const a = toMinor(draft.annual)
    if (!m || !a) {
      setLiveCheck(null)
      return
    }
    const t = setTimeout(() => void checkPolicyPremium(m, a).then(setLiveCheck), 250)
    return () => clearTimeout(t)
  }, [editing, draft.monthly, draft.annual])

  const startEdit = (p: FinancialProfilePolicy, key: string) => {
    setEditing(key)
    setEditError(null)
    setLiveCheck(null)
    setDraft({
      cover: asPounds(p.coverage_amount_minor),
      monthly: asPounds(p.monthly_premium_minor),
      annual: asPounds(p.annual_premium_minor),
    })
  }

  const saveEdit = async (p: FinancialProfilePolicy, key: string) => {
    if (!p.id) return
    setSaving(true)
    setEditError(null)
    const r = await editFamilyPolicy(p.id, {
      ...(toMinor(draft.cover) !== undefined
        ? { coverage_amount_minor: toMinor(draft.cover)! }
        : {}),
      ...(toMinor(draft.monthly) !== undefined
        ? { monthly_premium_minor: toMinor(draft.monthly)! }
        : {}),
      ...(toMinor(draft.annual) !== undefined
        ? { annual_premium_minor: toMinor(draft.annual)! }
        : {}),
    })
    setSaving(false)
    if (!r.ok) {
      setEditError(r.error)
      return
    }
    // Show the new figures at once; no reload.
    const saved = r.result.policy
    setPolicies((cur) =>
      (cur ?? []).map((x) =>
        x.id === p.id
          ? {
              ...x,
              coverage_amount_minor: saved.coverage_amount_minor,
              monthly_premium_minor: saved.monthly_premium_minor,
              ...(saved.annual_premium_minor
                ? { annual_premium_minor: saved.annual_premium_minor }
                : {}),
            }
          : x,
      ),
    )
    setChecks((cur) => ({ ...cur, [key]: r.result.check }))
    setSummary((cur) => ({ ...cur, [key]: describeChange(r.result.changes) }))
    setEditing(null)
  }

  useEffect(() => {
    let cancelled = false
    void fetchFinancialProfile().then(async (p) => {
      const mine = (p?.policies ?? []).filter((x) => types.includes(x.type))
      if (cancelled) return
      setPolicies(mine)
      const entries = await Promise.all(
        mine.map(async (x, i): Promise<[string, PolicyCheck | null]> => [
          x.id ?? `i${i}`,
          x.monthly_premium_minor > 0 && (x.annual_premium_minor ?? 0) > 0
            ? await checkPolicyPremium(x.monthly_premium_minor, x.annual_premium_minor)
            : null,
        ]),
      )
      if (!cancelled) setChecks(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
    // `types` is a stable list from the pack; the policies load once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!policies || policies.length === 0) return null

  return (
    <GlassCard className="mt-6 p-4">
      <div data-testid="policy-details">
        <h2 className="text-base font-semibold text-ink-primary">Policies on the list</h2>
        <ul className="mt-3 divide-y divide-haze">
          {policies.map((p, i) => {
            const key = p.id ?? `i${i}`
            const check = checks[key]
            const figures = [
              p.coverage_amount_minor > 0 ? `Cover ${gbp(p.coverage_amount_minor)}` : null,
              p.monthly_premium_minor > 0 ? `${gbp(p.monthly_premium_minor)} a month` : null,
              (p.annual_premium_minor ?? 0) > 0 ? `${gbp(p.annual_premium_minor!)} a year` : null,
            ].filter(Boolean)
            return (
              <li key={key} className="py-3 first:pt-0 last:pb-0">
                <div className="text-base font-medium text-ink-primary">
                  {p.provider || 'Provider not entered'} · {TYPE_LABEL[p.type] ?? p.type}
                </div>
                {figures.length > 0 && (
                  <p className="mt-0.5 text-sm text-ink-secondary">{figures.join(' · ')}</p>
                )}
                {check?.status === 'mismatch' && (
                  <p className="mt-1 text-sm text-ink-secondary">{check.text}</p>
                )}
                {(p.contact_phone || p.contact_email) && (
                  <p className="mt-1 text-sm text-ink-secondary">
                    Claims:{' '}
                    {p.contact_phone && (
                      <a href={telHref(p.contact_phone)} className="underline">
                        {p.contact_phone}
                      </a>
                    )}
                    {p.contact_phone && p.contact_email && ' · '}
                    {p.contact_email && (
                      <a href={`mailto:${p.contact_email}`} className="underline">
                        {p.contact_email}
                      </a>
                    )}
                  </p>
                )}
                {summary[key] && editing !== key && (
                  <div
                    role="status"
                    className="mt-2 rounded-xl bg-success/10 px-3 py-2 text-sm text-ink-primary"
                  >
                    <div className="font-medium">Updated. {summary[key].headline}</div>
                    {summary[key].stays && (
                      <div className="text-ink-secondary">{summary[key].stays}</div>
                    )}
                  </div>
                )}
                {editing === key ? (
                  <div className="mt-3 space-y-2" data-testid="policy-edit">
                    {(
                      [
                        ['cover', 'Cover (£)'],
                        ['monthly', 'Monthly premium (£)'],
                        ['annual', 'Yearly premium (£)'],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="block text-sm text-ink-secondary">
                        {label}
                        <input
                          className={inputCls}
                          inputMode="decimal"
                          value={draft[k]}
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                        />
                      </label>
                    ))}
                    {liveCheck?.status === 'mismatch' && (
                      <p className="text-sm text-ink-secondary">{liveCheck.text}</p>
                    )}
                    {editError && (
                      <p role="alert" className="text-sm text-danger">
                        {editError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void saveEdit(p, key)}
                        className="min-h-[48px] flex-1 rounded-full bg-family-500 px-5 text-sm font-semibold text-[rgb(var(--on-cta))] disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="min-h-[48px] rounded-full px-4 text-sm font-medium text-ink-tertiary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  p.id && (
                    <button
                      type="button"
                      onClick={() => startEdit(p, key)}
                      className="mt-2 min-h-[48px] rounded-full px-1 text-sm font-semibold text-family-400"
                    >
                      Update figures
                    </button>
                  )
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </GlassCard>
  )
}
