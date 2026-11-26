'use client'

/**
 * /policies/new: add one policy (life, income protection, critical illness or home) in one short form.
 * Shows at once whether twelve monthly premiums equal the yearly one (the server does the arithmetic, so there
 * is one rule), then the contact details. Says what is on the page, never whether the cover is enough.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, GlassCard } from '@/components/Glass'
import {
  addFamilyPolicy,
  checkPolicyPremium,
  fetchFamilyGroup,
  type ApiFamilyGroup,
  type NewPolicyInput,
  type PolicyCheck,
  type SavedPolicy,
} from '@/lib/api'
import { PERSON_SCOPED_POLICY_TYPES } from '@/lib/policyTypes'
import { inputCls, primaryBtn } from '../../domains/AddRecordForm'

const TYPES: Array<{ v: NewPolicyInput['type']; l: string }> = [
  { v: 'life', l: 'Life cover' },
  { v: 'income_protection', l: 'Income protection' },
  { v: 'critical_illness', l: 'Critical illness cover' },
  { v: 'home', l: 'Home insurance' },
]

/** Pounds typed by a person to whole pence; undefined when blank or not a sensible amount. */
const toMinor = (s: string): number | undefined => {
  const n = Number(s.replace(/[£,\s]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined
}
const gbp = (minor: number) =>
  `£${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

export default function NewPolicyPage() {
  const [people, setPeople] = useState<ApiFamilyGroup['members']>([])
  const [type, setType] = useState<NewPolicyInput['type']>('life')
  const [provider, setProvider] = useState('')
  const [covers, setCovers] = useState('')
  const [heldBy, setHeldBy] = useState('')
  const [cover, setCover] = useState('')
  const [monthly, setMonthly] = useState('')
  const [annual, setAnnual] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [number, setNumber] = useState('')
  const [renewal, setRenewal] = useState('')
  const [check, setCheck] = useState<PolicyCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ policy: SavedPolicy; check: PolicyCheck } | null>(null)

  useEffect(() => {
    void fetchFamilyGroup().then((g) => setPeople(g?.members ?? []))
    // A link can open the form on one type, e.g. the home-damage steps asking for the home policy.
    const want = new URLSearchParams(window.location.search).get('type')
    const match = TYPES.find((t) => t.v === want)
    if (match) setType(match.v)
  }, [])
  // Household-wide types (home) cover the home, not a person: no person pickers, as in the wizard.
  const forPerson = PERSON_SCOPED_POLICY_TYPES.has(type)

  // The check runs as the two premiums are typed; the server owns the rule.
  useEffect(() => {
    const m = toMinor(monthly)
    const a = toMinor(annual)
    if (!m || !a) {
      setCheck(null)
      return
    }
    const t = setTimeout(() => void checkPolicyPremium(m, a).then(setCheck), 300)
    return () => clearTimeout(t)
  }, [monthly, annual])

  const save = async () => {
    setBusy(true)
    setError(null)
    const c = toMinor(cover)
    const m = toMinor(monthly)
    const a = toMinor(annual)
    const r = await addFamilyPolicy({
      type,
      provider: provider.trim(),
      ...(covers && forPerson ? { covers_member_id: covers } : {}),
      ...(heldBy && forPerson ? { member_id: heldBy } : {}),
      ...(c ? { coverage_amount_minor: c } : {}),
      ...(m ? { monthly_premium_minor: m } : {}),
      ...(a ? { annual_premium_minor: a } : {}),
      ...(phone.trim() ? { contact_phone: phone.trim() } : {}),
      ...(email.trim() ? { contact_email: email.trim() } : {}),
      ...(number.trim() ? { policy_number: number.trim() } : {}),
      ...(renewal ? { renewal_date: renewal } : {}),
    })
    setBusy(false)
    if (r.ok) setSaved({ policy: r.policy, check: r.check })
    else setError(r.error)
  }

  const again = () => {
    for (const set of [
      setProvider,
      setCovers,
      setHeldBy,
      setCover,
      setMonthly,
      setAnnual,
      setPhone,
      setEmail,
      setNumber,
      setRenewal,
    ])
      set('')
    setCheck(null)
    setSaved(null)
  }

  if (saved) return <Saved saved={saved} people={people} onAgain={again} />

  const field = (id: string, label: string, el: React.ReactNode) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-primary">
        {label}
      </label>
      {el}
    </div>
  )

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader
        title="Add a policy"
        backHref="/domains?d=life_protection"
        subtitle="What is on the policy, in one go"
      />
      <GlassCard className="p-4 space-y-4">
        {field(
          'pol-type',
          'Type',
          <select
            id="pol-type"
            className={inputCls}
            value={type}
            onChange={(e) => setType(e.target.value as NewPolicyInput['type'])}
          >
            {TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.l}
              </option>
            ))}
          </select>,
        )}
        {field(
          'pol-provider',
          'Provider',
          <input
            id="pol-provider"
            className={inputCls}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            autoComplete="off"
          />,
        )}
        {forPerson && (
          <>
            {field(
              'pol-covers',
              'Who it covers (optional)',
              <select
                id="pol-covers"
                className={inputCls}
                value={covers}
                onChange={(e) => setCovers(e.target.value)}
              >
                <option value="">Not stated</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>,
            )}
            <p className="-mt-2 text-sm text-ink-secondary">
              Pick a person and the policy shows under their name on the family list. Left blank, it
              shows as not yet matched.
            </p>
          </>
        )}
        {field(
          'pol-cover',
          'Cover amount in £ (optional)',
          <input
            id="pol-cover"
            className={inputCls}
            inputMode="decimal"
            value={cover}
            onChange={(e) => setCover(e.target.value)}
          />,
        )}
        <div className="grid grid-cols-2 gap-3">
          {field(
            'pol-monthly',
            'Monthly premium (£)',
            <input
              id="pol-monthly"
              className={inputCls}
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />,
          )}
          {field(
            'pol-annual',
            'Yearly premium (£)',
            <input
              id="pol-annual"
              className={inputCls}
              inputMode="decimal"
              value={annual}
              onChange={(e) => setAnnual(e.target.value)}
            />,
          )}
        </div>
        {check?.status === 'mismatch' && (
          <p
            role="status"
            data-testid="premium-warning"
            className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-ink-primary"
          >
            {check.text}
          </p>
        )}
        {check?.status === 'match' && (
          <p role="status" data-testid="premium-match" className="text-sm text-success">
            The monthly and yearly premiums match.
          </p>
        )}
        {field(
          'pol-phone',
          'Claims phone number (optional)',
          <input
            id="pol-phone"
            className={inputCls}
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />,
        )}
        {field(
          'pol-email',
          'Claims email (optional)',
          <input
            id="pol-email"
            className={inputCls}
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />,
        )}
        <details className="text-sm">
          <summary className="min-h-[48px] cursor-pointer py-3 text-ink-secondary">
            More details (optional)
          </summary>
          <div className="space-y-4">
            {forPerson &&
              field(
                'pol-held',
                'Held by',
                <select
                  id="pol-held"
                  className={inputCls}
                  value={heldBy}
                  onChange={(e) => setHeldBy(e.target.value)}
                >
                  <option value="">Not stated</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>,
              )}
            {field(
              'pol-number',
              'Policy number',
              <input
                id="pol-number"
                className={inputCls}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />,
            )}
            {field(
              'pol-renewal',
              'Renewal date',
              <input
                id="pol-renewal"
                type="date"
                className={inputCls}
                value={renewal}
                onChange={(e) => setRenewal(e.target.value)}
              />,
            )}
          </div>
        </details>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || provider.trim() === ''}
          onClick={save}
        >
          Save this policy
        </button>
      </GlassCard>
    </div>
  )
}

/** Where a saved policy shows: the life-protection list holds person cover; a home policy lives on the profile. */
function familyListHref(type: string): string {
  return type === 'home' ? '/financial-profile?step=protection' : '/domains?d=life_protection'
}

function Saved({
  saved,
  people,
  onAgain,
}: {
  saved: { policy: SavedPolicy; check: PolicyCheck }
  people: ApiFamilyGroup['members']
  onAgain: () => void
}) {
  const { policy, check } = saved
  const covered = people.find((p) => p.id === policy.beneficiary_member_id)
  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader
        title="Policy saved"
        backHref="/domains?d=life_protection"
        subtitle="It is on the family list"
      />
      <div data-testid="saved-policy">
        <GlassCard className="p-4 space-y-3">
          <p className="text-base font-medium text-ink-primary">
            {policy.provider}
            {covered ? `, covers ${covered.name}` : ''}
          </p>
          <dl className="space-y-1 text-sm">
            {policy.coverage_amount_minor > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Cover amount</dt>
                <dd className="text-ink-primary">{gbp(policy.coverage_amount_minor)}</dd>
              </div>
            )}
            {policy.monthly_premium_minor > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Monthly premium</dt>
                <dd className="text-ink-primary">{gbp(policy.monthly_premium_minor)}</dd>
              </div>
            )}
            {policy.annual_premium_minor ? (
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Yearly premium</dt>
                <dd className="text-ink-primary">{gbp(policy.annual_premium_minor)}</dd>
              </div>
            ) : null}
          </dl>
          {check.status === 'mismatch' && (
            <p
              role="status"
              data-testid="saved-warning"
              className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-ink-primary"
            >
              {check.text}
            </p>
          )}
          {check.status === 'match' && (
            <p className="text-sm text-success">The monthly and yearly premiums match.</p>
          )}
          {(policy.contact_phone || policy.contact_email) && (
            <div className="space-y-1 text-sm">
              <p className="text-ink-secondary">Claims contact</p>
              {policy.contact_phone && (
                <a
                  className="block min-h-[48px] py-3 text-family-400 underline"
                  href={`tel:${policy.contact_phone.replace(/\s+/g, '')}`}
                >
                  {policy.contact_phone}
                </a>
              )}
              {policy.contact_email && (
                <a
                  className="block min-h-[48px] py-3 text-family-400 underline"
                  href={`mailto:${policy.contact_email}`}
                >
                  {policy.contact_email}
                </a>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href={familyListHref(policy.type)}
              className="min-h-[48px] py-3 text-family-400 underline"
            >
              See the family list
            </Link>
            <button
              type="button"
              className="min-h-[48px] py-3 text-family-400 underline"
              onClick={onAgain}
            >
              Add another policy
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
