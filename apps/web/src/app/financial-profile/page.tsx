'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, AlertCircle, CheckCircle2, Plus, X, ChevronLeft } from 'lucide-react'
import { PageHeader, GlassCard, GlassButton, Skeleton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useToast } from '@/components/Toast'
import { useAppStore } from '@/lib/store'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/ConfirmSheetProvider'
import {
  fetchFinancialProfileWithVersion,
  submitFinancialProfile,
  type EmploymentStatus,
  type FinancialProfile,
  type FinancialProfileEducationFund,
  type FinancialProfilePolicy,
  type PolicyType,
} from '@/lib/api'
import { POLICY_TYPE_LABELS, PERSON_SCOPED_POLICY_TYPES } from '@/lib/policyTypes'

// Whole-currency string state, converted to minor units (x100) on submit —
// the API and detectors work in minor units, but people think in whole amounts.
interface FormState {
  employmentStatus: EmploymentStatus
  monthlySalary: string
  annualLivingExpenses: string
  mortgageOutstanding: string
  lifeCover: string
  incomeProtectionMonthly: string
  // PRD-104: optional second earner, linked to a real family-roster
  // member — a mixed-earner household (one partner retired, one still
  // working) had no way to be represented by the single
  // employmentStatus/monthlySalary pair above. Excluded from the submit
  // payload entirely unless hasSecondEarner is true — see toPayload()
  // below. secondEarnerMemberId is a FamilyMemberUser.id from the
  // roster (useAuth().family.members), not free text.
  hasSecondEarner: boolean
  secondEarnerMemberId: string
  secondEarnerEmploymentStatus: EmploymentStatus
  secondEarnerMonthlySalary: string
  secondEarnerIncomeProtectionMonthly: string
  emergencySavings: string
  monthlyExpenses: string
  hasHighInterestDebt: boolean
  highInterestDebtBalance: string
  currentAge: string
  targetRetirementAge: string
  pensionBalance: string
  monthlyContribution: string
  targetRetirementIncome: string
  expectedAnnualGrowthPct: string
}

interface EducationFundForm {
  childName: string
  childAge: string
  currentSavings: string
  targetSavings: string
  yearsRemaining: string
}

interface PolicyForm {
  type: PolicyType
  provider: string
  coverageAmount: string
  monthlyPremium: string
  renewalDate: string
  policyNumber: string
  // PRD-110: roster member this policy belongs to — '' means unset
  // (household-wide; the only option for car/home).
  memberId: string
}

const EMPTY_POLICY: PolicyForm = {
  type: 'life',
  provider: '',
  coverageAmount: '',
  monthlyPremium: '',
  renewalDate: '',
  policyNumber: '',
  memberId: '',
}


const EMPTY_FORM: FormState = {
  employmentStatus: 'employed',
  monthlySalary: '',
  annualLivingExpenses: '',
  mortgageOutstanding: '',
  lifeCover: '',
  incomeProtectionMonthly: '',
  hasSecondEarner: false,
  secondEarnerMemberId: '',
  secondEarnerEmploymentStatus: 'employed',
  secondEarnerMonthlySalary: '',
  secondEarnerIncomeProtectionMonthly: '',
  emergencySavings: '',
  monthlyExpenses: '',
  hasHighInterestDebt: false,
  highInterestDebtBalance: '',
  // Server requires both ages to be positive integers (even on autosave, before
  // the user has reached this step) — default to plausible values rather than
  // leaving them blank, same as expectedAnnualGrowthPct's '5' below.
  currentAge: '30',
  targetRetirementAge: '65',
  pensionBalance: '',
  monthlyContribution: '',
  targetRetirementIncome: '',
  expectedAnnualGrowthPct: '5',
}

function toWhole(minor: number): string {
  return String(Math.round(minor / 100))
}

function toMinor(whole: string): number {
  const n = Number(whole)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

// Defensive against a partial document — the "apply a document's extracted
// field to your profile" flow (documents.ts's /apply-to-profile) can create
// a profile with, say, only household.life_cover_minor set, months before
// the user ever opens this wizard. A legacy document predating a schema
// field addition (e.g. high_interest_debt_balance_minor) is the same shape
// of gap. Every read here defaults rather than assumes the full shape.
function fromProfile(profile: FinancialProfile): { form: FormState; funds: EducationFundForm[]; policies: PolicyForm[] } {
  const household = profile.household ?? ({} as Partial<FinancialProfile['household']>)
  const emergencyFund = profile.emergency_fund ?? ({} as Partial<FinancialProfile['emergency_fund']>)
  const retirement = profile.retirement ?? ({} as Partial<FinancialProfile['retirement']>)
  return {
    form: {
      employmentStatus: household.employment_status ?? EMPTY_FORM.employmentStatus,
      monthlySalary: toWhole(household.monthly_salary_minor ?? 0),
      annualLivingExpenses: toWhole(household.annual_living_expenses_minor ?? 0),
      mortgageOutstanding: toWhole(household.mortgage_outstanding_minor ?? 0),
      lifeCover: toWhole(household.life_cover_minor ?? 0),
      incomeProtectionMonthly: toWhole(household.income_protection_monthly_minor ?? 0),
      // This UI only ever writes one members[] entry — see toPayload().
      hasSecondEarner: (household.members?.length ?? 0) > 0,
      secondEarnerMemberId: household.members?.[0]?.member_id ?? '',
      secondEarnerEmploymentStatus: household.members?.[0]?.employment_status ?? EMPTY_FORM.secondEarnerEmploymentStatus,
      secondEarnerMonthlySalary: toWhole(household.members?.[0]?.monthly_salary_minor ?? 0),
      secondEarnerIncomeProtectionMonthly: toWhole(household.members?.[0]?.income_protection_monthly_minor ?? 0),
      emergencySavings: toWhole(emergencyFund.emergency_savings_minor ?? 0),
      monthlyExpenses: toWhole(emergencyFund.monthly_expenses_minor ?? 0),
      hasHighInterestDebt: emergencyFund.has_high_interest_debt ?? false,
      highInterestDebtBalance: toWhole(emergencyFund.high_interest_debt_balance_minor ?? 0),
      currentAge: String(retirement.current_age ?? EMPTY_FORM.currentAge),
      targetRetirementAge: String(retirement.target_retirement_age ?? EMPTY_FORM.targetRetirementAge),
      pensionBalance: toWhole(retirement.pension_balance_minor ?? 0),
      monthlyContribution: toWhole(retirement.monthly_contribution_minor ?? 0),
      targetRetirementIncome: toWhole(retirement.target_retirement_income_minor ?? 0),
      expectedAnnualGrowthPct: String(retirement.expected_annual_growth_pct ?? EMPTY_FORM.expectedAnnualGrowthPct),
    },
    funds: (profile.education_funds ?? []).map((f) => ({
      childName: f.child_name,
      childAge: String(f.child_age),
      currentSavings: toWhole(f.current_savings_minor),
      targetSavings: toWhole(f.target_savings_minor),
      yearsRemaining: String(f.years_remaining),
    })),
    policies: (profile.policies ?? []).map((p) => ({
      type: p.type,
      provider: p.provider,
      coverageAmount: toWhole(p.coverage_amount_minor),
      monthlyPremium: toWhole(p.monthly_premium_minor),
      renewalDate: p.renewal_date ?? '',
      policyNumber: p.policy_number ?? '',
      memberId: p.member_id ?? '',
    })),
  }
}

function toPayload(form: FormState, funds: EducationFundForm[], policies: PolicyForm[]): FinancialProfile {
  const education_funds: FinancialProfileEducationFund[] = funds
    .filter((f) => f.childName.trim())
    .map((f) => ({
      child_name: f.childName.trim(),
      child_age: Number(f.childAge) || 0,
      current_savings_minor: toMinor(f.currentSavings),
      target_savings_minor: Math.max(1, toMinor(f.targetSavings)),
      years_remaining: Number(f.yearsRemaining) || 0,
    }))

  const policyPayloads: FinancialProfilePolicy[] = policies
    .filter((p) => p.provider.trim())
    .map((p) => ({
      type: p.type,
      provider: p.provider.trim(),
      coverage_amount_minor: toMinor(p.coverageAmount),
      monthly_premium_minor: toMinor(p.monthlyPremium),
      ...(p.renewalDate ? { renewal_date: p.renewalDate } : {}),
      ...(p.policyNumber.trim() ? { policy_number: p.policyNumber.trim() } : {}),
      ...(PERSON_SCOPED_POLICY_TYPES.has(p.type) && p.memberId ? { member_id: p.memberId } : {}),
    }))

  return {
    household: {
      employment_status: form.employmentStatus,
      monthly_salary_minor: toMinor(form.monthlySalary),
      annual_living_expenses_minor: toMinor(form.annualLivingExpenses),
      mortgage_outstanding_minor: toMinor(form.mortgageOutstanding),
      life_cover_minor: toMinor(form.lifeCover),
      income_protection_monthly_minor: toMinor(form.incomeProtectionMonthly),
      members:
        form.hasSecondEarner && form.secondEarnerMemberId
          ? [
              {
                member_id: form.secondEarnerMemberId,
                employment_status: form.secondEarnerEmploymentStatus,
                monthly_salary_minor: toMinor(form.secondEarnerMonthlySalary),
                income_protection_monthly_minor: toMinor(form.secondEarnerIncomeProtectionMonthly),
              },
            ]
          : [],
    },
    emergency_fund: {
      emergency_savings_minor: toMinor(form.emergencySavings),
      monthly_expenses_minor: toMinor(form.monthlyExpenses),
      has_high_interest_debt: form.hasHighInterestDebt,
      high_interest_debt_balance_minor: form.hasHighInterestDebt ? toMinor(form.highInterestDebtBalance) : 0,
    },
    retirement: {
      current_age: Number(form.currentAge) || 0,
      target_retirement_age: Number(form.targetRetirementAge) || 0,
      pension_balance_minor: toMinor(form.pensionBalance),
      monthly_contribution_minor: toMinor(form.monthlyContribution),
      target_retirement_income_minor: Math.max(1, toMinor(form.targetRetirementIncome)),
      expected_annual_growth_pct: Number(form.expectedAnnualGrowthPct) || 5,
    },
    education_funds,
    policies: policyPayloads,
  }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  prefix,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  suffix?: string
  prefix?: string
}) {
  return (
    <label className="block">
      <div className="text-xs text-ink-tertiary mb-1.5">{label}</div>
      <div className="relative">
        {prefix && (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base text-ink-tertiary">{prefix}</span>
        )}
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? '0'}
          className={`glass-input w-full rounded-xl py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all ${prefix ? 'pl-8 pr-4' : 'px-4'}`}
        />
        {suffix && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-ink-tertiary">{suffix}</span>
        )}
      </div>
    </label>
  )
}

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <div className="text-xs text-ink-tertiary mb-1.5">{label}</div>
      <div className="flex gap-2">
        {[true, false].map((opt) => (
          <button
            key={String(opt)}
            type="button"
            onClick={() => { haptic('light'); onChange(opt) }}
            aria-pressed={value === opt}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${
              value === opt
                ? 'bg-family-500 text-white'
                : 'glass text-ink-secondary'
            }`}
          >
            {opt ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </div>
  )
}

const EMPLOYMENT_STATUS_OPTIONS: { value: EmploymentStatus; label: string }[] = [
  { value: 'employed', label: 'Employed' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'unemployed', label: 'Unemployed' },
  { value: 'retired', label: 'Retired' },
]

function EmploymentStatusPicker({ value, onChange }: { value: EmploymentStatus; onChange: (v: EmploymentStatus) => void }) {
  return (
    <div>
      <div className="text-xs text-ink-tertiary mb-1.5">Employment status</div>
      <div className="grid grid-cols-2 gap-2">
        {EMPLOYMENT_STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => { haptic('light'); onChange(opt.value) }}
            aria-pressed={value === opt.value}
            className={`rounded-xl py-2.5 text-sm font-semibold transition-all ${
              value === opt.value
                ? 'bg-family-500 text-white'
                : 'glass text-ink-secondary'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PolicyTypePicker({ value, onChange }: { value: PolicyType; onChange: (v: PolicyType) => void }) {
  return (
    <div>
      <div className="text-xs text-ink-tertiary mb-1.5">Policy type</div>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(POLICY_TYPE_LABELS) as PolicyType[]).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => { haptic('light'); onChange(opt) }}
            aria-pressed={value === opt}
            className={`rounded-xl py-2.5 text-sm font-semibold transition-all ${
              value === opt
                ? 'bg-family-500 text-white'
                : 'glass text-ink-secondary'
            }`}
          >
            {POLICY_TYPE_LABELS[opt]}
          </button>
        ))}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold text-family-400 mb-3">{children}</div>
}

interface Step {
  key: string
  title: string
}

const STEPS: Step[] = [
  { key: 'household', title: 'Household & Protection' },
  { key: 'emergency', title: 'Emergency Fund' },
  { key: 'retirement', title: 'Retirement' },
  { key: 'education', title: 'Education Funds' },
]

export default function FinancialProfilePage() {
  const router = useRouter()
  const { family, user } = useAuth()
  const confirm = useConfirm()
  // PRD-104: adults on the roster other than the signed-in user — the
  // Second Earner section only makes sense, and is only shown, when at
  // least one exists (i.e. the household has more than one adult).
  const otherAdults = (family?.members ?? []).filter((m) => m.role !== 'child' && m.id !== user?.id)
  const setFinancialProfileSubmitted = useAppStore((s) => s.setFinancialProfileSubmitted)
  const toast = useToast()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [funds, setFunds] = useState<EducationFundForm[]>([])
  const [policies, setPolicies] = useState<PolicyForm[]>([])
  const [loading, setLoading] = useState(true)
  const [stepIndex, setStepIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<number | null>(null)
  // OAK-006: tracked from the initial GET and updated after every
  // successful save — sent back on the next save so the server can tell
  // a concurrent edit from another tab/device apart from this tab's own
  // sequential autosaves, instead of silently last-writer-wins overwriting.
  const [version, setVersion] = useState<number | undefined>(undefined)
  // Set when a step-autosave fails for any reason other than a 409
  // conflict (which already surfaces as `error`) — the catch used to be
  // fully silent, so a user could walk through every step believing their
  // answers were persisted when nothing was. Cleared on the next
  // successful save.
  const [autosaveFailed, setAutosaveFailed] = useState(false)

  // Remediation item 27: reached straight from onboarding — the flow ends
  // on this form instead of a blank dashboard, because saving it is what
  // generates the family's first real insight. Read via window.location —
  // same static-export workaround as the ?add=1 handling in settings.
  const [fromOnboarding] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('source') === 'onboarding',
  )

  // Live-verification finding: advancing/going back a step only scrolled
  // the page to top — no aria-live announcement and no focus movement, so
  // a keyboard/screen-reader user got no indication a step change happened
  // at all (the visible "Step X of Y" label updated, but silently to
  // anyone not looking at the screen). Making this label a live region and
  // moving focus to it on every step change (skipping the very first
  // render, so initial page load isn't affected) gives both an
  // announcement and a stable, findable landmark — the standard pattern
  // for a multi-step wizard.
  const stepLabelRef = useRef<HTMLSpanElement>(null)
  const isFirstStepRender = useRef(true)
  useEffect(() => {
    if (isFirstStepRender.current) {
      isFirstStepRender.current = false
      return
    }
    stepLabelRef.current?.focus()
  }, [stepIndex])

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfileWithVersion().then(({ profile, version: v }) => {
      if (cancelled) return
      setVersion(v)
      const { form: f, funds: e, policies: p } = profile
        ? fromProfile(profile)
        : { form: EMPTY_FORM, funds: [] as EducationFundForm[], policies: [] as PolicyForm[] }
      // Pre-fill an education fund entry for each child already on the
      // family roster (collected once at onboarding) that isn't already
      // represented here — no reason to make the user retype a name that's
      // already on file. Only names, since age/savings/target are specific
      // to this form and weren't collected anywhere else.
      const existingNames = new Set(e.map((fund) => fund.childName.trim().toLowerCase()))
      const knownChildren = (family?.members ?? []).filter(
        (m) => m.role === 'child' && !existingNames.has(m.name.trim().toLowerCase()),
      )
      const funds = [
        ...e,
        ...knownChildren.map((c) => ({ childName: c.name, childAge: '', currentSavings: '', targetSavings: '', yearsRemaining: '' })),
      ]
      setForm(f)
      setFunds(funds)
      setPolicies(p)
      setLoading(false)
    })
    return () => { cancelled = true }
    // Deliberately mount-once (family is already loaded by the time this
    // page renders — AuthGate blocks routes until it is) — re-running this
    // on every family change would overwrite in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // ?step=household etc. — lets links from Family (the category rows
    // for Income/Protection/Health Cover/etc.) land directly on the step
    // that edits that data instead of always starting at step 1. Read via
    // window.location rather than useSearchParams to match this app's
    // existing convention (see upgrade/page.tsx) for a static export with
    // no Suspense boundary requirement.
    const step = new URLSearchParams(window.location.search).get('step')
    const idx = STEPS.findIndex((s) => s.key === step)
    if (idx >= 0) setStepIndex(idx)
  }, [])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const addChild = () => {
    haptic('light')
    setFunds((prev) => [...prev, { childName: '', childAge: '', currentSavings: '', targetSavings: '', yearsRemaining: '' }])
  }

  const removeChild = async (i: number) => {
    const name = funds[i]?.childName || `Child ${i + 1}`
    const ok = await confirm({
      title: `Remove ${name}'s education fund?`,
      message: `This can't be undone.`,
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    haptic('light')
    setFunds((prev) => prev.filter((_, idx) => idx !== i))
  }

  const updateChild = (i: number, patch: Partial<EducationFundForm>) => {
    setFunds((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  const addPolicy = () => {
    haptic('light')
    setPolicies((prev) => [...prev, { ...EMPTY_POLICY }])
  }

  const removePolicy = async (i: number) => {
    const name = policies[i]?.provider || `Policy ${i + 1}`
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: `This can't be undone.`,
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    haptic('light')
    setPolicies((prev) => prev.filter((_, idx) => idx !== i))
  }

  const updatePolicy = (i: number, patch: Partial<PolicyForm>) => {
    setPolicies((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  const isLastStep = stepIndex === STEPS.length - 1

  // Autosaves whatever's been entered so far whenever the user moves to the
  // next step — closing the tab mid-form used to lose everything, since the
  // old single-page form only ever saved on the final submit.
  const handleContinue = async () => {
    haptic('light')
    setError(null)
    setSaving(true)
    try {
      const { version: newVersion } = await submitFinancialProfile(toPayload(form, funds, policies), false, version)
      setVersion(newVersion)
      setAutosaveFailed(false)
    } catch (err) {
      // Best-effort — don't trap the user on this step if the autosave
      // fails; the full submit on the last step will surface a real error.
      // The one exception: a 409 conflict means someone else's edits are
      // sitting in this profile right now — silently continuing would let
      // the final submit clobber them, so surface it immediately instead.
      // Every other failure still gets a persistent "not saved" indicator
      // (below the progress bar) so silent data loss can't masquerade as a
      // saved draft.
      if (err instanceof Error && err.message.includes('updated elsewhere')) {
        setError(err.message)
      } else {
        setAutosaveFailed(true)
      }
    } finally {
      setSaving(false)
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleBack = () => {
    haptic('light')
    setStepIndex((i) => Math.max(i - 1, 0))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async () => {
    haptic('light')
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const { insightsGenerated, version: newVersion } = await submitFinancialProfile(toPayload(form, funds, policies), true, version)
      setVersion(newVersion)
      setAutosaveFailed(false)
      haptic('success')
      toast({ message: insightsGenerated ? 'Profile saved — new insights generated' : 'Financial profile saved' })
      setResult(insightsGenerated)
      setFinancialProfileSubmitted()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      haptic('warning')
      setError(err instanceof Error ? err.message : 'Could not save your financial profile. Please try again.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="px-5 pt-2 pb-10 space-y-5">
        <PageHeader
          title="Financial Profile"
          backHref="/settings"
          subtitle="This replaces sample scenarios with real, personalized readiness scores"
        />
        <div>
          <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-8" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
        <GlassCard className="p-4 space-y-4">
          <Skeleton className="h-4 w-36" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </GlassCard>
      </div>
    )
  }

  const step = STEPS[stepIndex]!
  const progress = ((stepIndex + 1) / STEPS.length) * 100

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader
        title="Financial Profile"
        backHref={fromOnboarding ? '/' : '/settings'}
        subtitle="This replaces sample scenarios with real, personalized readiness scores"
      />

      {fromOnboarding && result === null && (
        <GlassCard className="p-4 border-family-500/20">
          <p className="text-sm text-ink-secondary leading-relaxed">
            Last step — this is what turns the family you just set up into your first real insight.
            The names you gave us are already filled in.
          </p>
        </GlassCard>
      )}

      {result !== null && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} role="status" aria-live="polite">
          <GlassCard className="p-4 border-success/20 flex items-start gap-3">
            <CheckCircle2 size={20} className="text-success flex-shrink-0 mt-0.5" />
            <div className="text-sm text-ink-secondary">
              Saved. {result > 0
                ? `${result} personalized insight${result === 1 ? '' : 's'} generated — check Home and your Events.`
                : 'No gaps found in what you entered — nice work.'}
              {fromOnboarding && (
                <Link href="/" className="block mt-2 font-semibold text-family-400">
                  {result > 0 ? 'See your first insights →' : 'Continue to Home →'}
                </Link>
              )}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {error && (
        <div role="status" aria-live="polite">
          <GlassCard className="p-4 border-danger/20 flex items-start gap-3">
            <AlertCircle size={20} className="text-danger flex-shrink-0 mt-0.5" />
            <div className="text-sm text-ink-secondary">{error}</div>
          </GlassCard>
        </div>
      )}

      {/* Step progress */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span
            ref={stepLabelRef}
            tabIndex={-1}
            aria-live="polite"
            className="text-xs text-ink-tertiary font-semibold outline-none"
          >
            Step {stepIndex + 1} of {STEPS.length}: {step.title}
          </span>
          <span className="text-xs text-family-400 font-bold">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 rounded-full bg-tint/5 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-family-400 to-family-500"
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>
        {autosaveFailed && (
          <div role="status" aria-live="polite" className="flex items-center gap-1.5 mt-2 text-xs text-warning">
            <AlertCircle size={12} className="flex-shrink-0" />
            <span>Couldn&apos;t save the previous step — your answers are still here and will be saved when you continue.</span>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step.key}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.2 }}
        >
          {step.key === 'household' && (
            <GlassCard className="p-5">
              <SectionTitle>Household & Protection</SectionTitle>
              <div className="space-y-3">
                <EmploymentStatusPicker value={form.employmentStatus} onChange={(v) => set('employmentStatus', v)} />
                <Field label="Monthly salary" value={form.monthlySalary} onChange={(v) => set('monthlySalary', v)} prefix="£" />
                <Field label="Annual living expenses" value={form.annualLivingExpenses} onChange={(v) => set('annualLivingExpenses', v)} prefix="£" />
                <Field label="Mortgage outstanding" value={form.mortgageOutstanding} onChange={(v) => set('mortgageOutstanding', v)} placeholder="0 if none" prefix="£" />
                <Field label="Life insurance cover" value={form.lifeCover} onChange={(v) => set('lifeCover', v)} placeholder="0 if none" prefix="£" />
                <Field label="Income protection (monthly payout)" value={form.incomeProtectionMonthly} onChange={(v) => set('incomeProtectionMonthly', v)} placeholder="0 if none" prefix="£" />
              </div>
            </GlassCard>
          )}

          {step.key === 'household' && otherAdults.length > 0 && (
            <GlassCard className="p-5 mt-4">
              <SectionTitle>Second Earner</SectionTitle>
              <div className="space-y-3">
                <YesNo
                  label="Does your household have a second earner?"
                  value={form.hasSecondEarner}
                  onChange={(v) => {
                    // Pre-populate from the family roster rather than
                    // asking for a name — PRD-104.
                    if (v && !form.secondEarnerMemberId) set('secondEarnerMemberId', otherAdults[0]!.id)
                    set('hasSecondEarner', v)
                  }}
                />
                {form.hasSecondEarner && (
                  <>
                    <label className="block">
                      <div className="text-xs text-ink-tertiary mb-1.5">Who?</div>
                      <select
                        value={form.secondEarnerMemberId}
                        onChange={(e) => set('secondEarnerMemberId', e.target.value)}
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      >
                        {otherAdults.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </label>
                    <EmploymentStatusPicker
                      value={form.secondEarnerEmploymentStatus}
                      onChange={(v) => set('secondEarnerEmploymentStatus', v)}
                    />
                    <Field
                      label="Their monthly salary"
                      value={form.secondEarnerMonthlySalary}
                      onChange={(v) => set('secondEarnerMonthlySalary', v)}
                      prefix="£"
                    />
                    <Field
                      label="Their income protection (monthly payout)"
                      value={form.secondEarnerIncomeProtectionMonthly}
                      onChange={(v) => set('secondEarnerIncomeProtectionMonthly', v)}
                      placeholder="0 if none"
                      prefix="£"
                    />
                  </>
                )}
              </div>
            </GlassCard>
          )}

          {step.key === 'household' && (
            <GlassCard className="p-5 mt-4">
              <SectionTitle>Insurance Policies</SectionTitle>
              <div className="space-y-4">
                {policies.map((p, i) => (
                  <div key={i} className="rounded-2xl bg-tint/[0.02] border border-tint/[0.06] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink-tertiary">Policy {i + 1}</span>
                      <button type="button" onClick={() => removePolicy(i)} aria-label="Remove policy" className="w-7 h-7 rounded-full flex items-center justify-center text-ink-tertiary active:opacity-60">
                        <X size={14} />
                      </button>
                    </div>
                    <PolicyTypePicker value={p.type} onChange={(v) => updatePolicy(i, { type: v })} />
                    {PERSON_SCOPED_POLICY_TYPES.has(p.type) && (family?.members ?? []).length > 0 && (
                      <label className="block">
                        <div className="text-xs text-ink-tertiary mb-1.5">Who is this policy for?</div>
                        <select
                          value={p.memberId}
                          onChange={(e) => updatePolicy(i, { memberId: e.target.value })}
                          className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all bg-transparent"
                        >
                          <option value="">The whole household / not sure</option>
                          {(family?.members ?? []).map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="block">
                      <div className="text-xs text-ink-tertiary mb-1.5">Provider</div>
                      <input
                        type="text"
                        value={p.provider}
                        onChange={(e) => updatePolicy(i, { provider: e.target.value })}
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-ink-tertiary mb-1.5">Policy number (if known)</div>
                      <input
                        type="text"
                        value={p.policyNumber}
                        onChange={(e) => updatePolicy(i, { policyNumber: e.target.value })}
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Coverage amount" value={p.coverageAmount} onChange={(v) => updatePolicy(i, { coverageAmount: v })} placeholder="0 if none" prefix="£" />
                      <Field label="Monthly premium" value={p.monthlyPremium} onChange={(v) => updatePolicy(i, { monthlyPremium: v })} placeholder="0 if none" prefix="£" />
                    </div>
                    <label className="block">
                      <div className="text-xs text-ink-tertiary mb-1.5">Renewal date (if known)</div>
                      <input
                        type="date"
                        value={p.renewalDate}
                        onChange={(e) => updatePolicy(i, { renewalDate: e.target.value })}
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      />
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addPolicy}
                  className="w-full glass rounded-2xl py-3 text-sm font-semibold text-family-400 flex items-center justify-center gap-1"
                >
                  <Plus size={14} /> Add a policy
                </button>
              </div>
            </GlassCard>
          )}

          {step.key === 'emergency' && (
            <GlassCard className="p-5">
              <SectionTitle>Emergency Fund</SectionTitle>
              <div className="space-y-3">
                <Field label="Emergency savings" value={form.emergencySavings} onChange={(v) => set('emergencySavings', v)} prefix="£" />
                <Field label="Monthly expenses" value={form.monthlyExpenses} onChange={(v) => set('monthlyExpenses', v)} prefix="£" />
                <YesNo label="Any high-interest debt?" value={form.hasHighInterestDebt} onChange={(v) => set('hasHighInterestDebt', v)} />
                {form.hasHighInterestDebt && (
                  <Field
                    label="Rough outstanding balance"
                    value={form.highInterestDebtBalance}
                    onChange={(v) => set('highInterestDebtBalance', v)}
                    placeholder="e.g. credit cards, payday loans"
                    prefix="£"
                  />
                )}
              </div>
            </GlassCard>
          )}

          {step.key === 'retirement' && (
            <GlassCard className="p-5">
              <SectionTitle>Retirement</SectionTitle>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Your current age" value={form.currentAge} onChange={(v) => set('currentAge', v)} />
                  <Field label="Target retirement age" value={form.targetRetirementAge} onChange={(v) => set('targetRetirementAge', v)} />
                </div>
                <Field label="Pension balance" value={form.pensionBalance} onChange={(v) => set('pensionBalance', v)} placeholder="0 if none" prefix="£" />
                <Field label="Monthly pension contribution" value={form.monthlyContribution} onChange={(v) => set('monthlyContribution', v)} placeholder="0 if none" prefix="£" />
                <Field label="Target annual retirement income" value={form.targetRetirementIncome} onChange={(v) => set('targetRetirementIncome', v)} prefix="£" />
                <Field label="Assumed annual growth rate" value={form.expectedAnnualGrowthPct} onChange={(v) => set('expectedAnnualGrowthPct', v)} suffix="%" />
              </div>
            </GlassCard>
          )}

          {step.key === 'education' && (
            <GlassCard className="p-5">
              <SectionTitle>Education Funds</SectionTitle>
              <div className="space-y-4">
                {funds.map((f, i) => (
                  <div key={i} className="rounded-2xl bg-tint/[0.02] border border-tint/[0.06] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink-tertiary">Child {i + 1}</span>
                      <button type="button" onClick={() => removeChild(i)} aria-label="Remove child" className="w-7 h-7 rounded-full flex items-center justify-center text-ink-tertiary active:opacity-60">
                        <X size={14} />
                      </button>
                    </div>
                    <label className="block">
                      <div className="text-xs text-ink-tertiary mb-1.5">Child's name</div>
                      <input
                        type="text"
                        value={f.childName}
                        onChange={(e) => updateChild(i, { childName: e.target.value })}
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Child's age" value={f.childAge} onChange={(v) => updateChild(i, { childAge: v })} />
                      <Field label="Years until university" value={f.yearsRemaining} onChange={(v) => updateChild(i, { yearsRemaining: v })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Current savings" value={f.currentSavings} onChange={(v) => updateChild(i, { currentSavings: v })} prefix="£" />
                      <Field label="Target amount" value={f.targetSavings} onChange={(v) => updateChild(i, { targetSavings: v })} prefix="£" />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addChild}
                  className="w-full glass rounded-2xl py-3 text-sm font-semibold text-family-400 flex items-center justify-center gap-1"
                >
                  <Plus size={14} /> Add a child's education fund
                </button>
              </div>
            </GlassCard>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Sticky rather than inline-after-the-form — on a long step (Insurance
          Policies, with several policy cards), the primary action used to
          sit wherever the form happened to end, so reaching it meant
          scrolling all the way down first. A fixed thumb-reachable footer
          is the standard mobile-form pattern for exactly this reason. */}
      <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-3 mt-2 flex gap-2 bg-navbg/90 backdrop-blur-xl border-t border-tint/[0.05] safe-area-bottom">
        {stepIndex > 0 && (
          <button
            type="button"
            onClick={handleBack}
            className="glass rounded-2xl px-5 py-3.5 flex items-center justify-center text-ink-secondary font-semibold flex-shrink-0"
            aria-label="Back"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        <div className="flex-1">
          {isLastStep ? (
            <GlassButton onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 size={18} className="animate-spin" /> : 'Save & Generate Insights'}
            </GlassButton>
          ) : (
            <GlassButton onClick={handleContinue} disabled={saving}>
              {saving ? <Loader2 size={18} className="animate-spin" /> : 'Continue'}
            </GlassButton>
          )}
        </div>
      </div>
    </div>
  )
}
