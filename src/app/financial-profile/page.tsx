'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, AlertCircle, CheckCircle2, Plus, X, ChevronLeft } from 'lucide-react'
import { PageHeader, GlassCard, GlassButton } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useAppStore } from '@/lib/store'
import { useAuth } from '@/lib/auth-context'
import {
  fetchFinancialProfile,
  submitFinancialProfile,
  type EmploymentStatus,
  type FinancialProfile,
  type FinancialProfileEducationFund,
} from '@/lib/api'

// Whole-currency string state, converted to minor units (x100) on submit —
// the API and detectors work in minor units, but people think in whole amounts.
interface FormState {
  employmentStatus: EmploymentStatus
  monthlySalary: string
  annualLivingExpenses: string
  mortgageOutstanding: string
  lifeCover: string
  incomeProtectionMonthly: string
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

const EMPTY_FORM: FormState = {
  employmentStatus: 'employed',
  monthlySalary: '',
  annualLivingExpenses: '',
  mortgageOutstanding: '',
  lifeCover: '',
  incomeProtectionMonthly: '',
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

function fromProfile(profile: FinancialProfile): { form: FormState; funds: EducationFundForm[] } {
  return {
    form: {
      employmentStatus: profile.household.employment_status,
      monthlySalary: toWhole(profile.household.monthly_salary_minor),
      annualLivingExpenses: toWhole(profile.household.annual_living_expenses_minor),
      mortgageOutstanding: toWhole(profile.household.mortgage_outstanding_minor),
      lifeCover: toWhole(profile.household.life_cover_minor),
      incomeProtectionMonthly: toWhole(profile.household.income_protection_monthly_minor),
      emergencySavings: toWhole(profile.emergency_fund.emergency_savings_minor),
      monthlyExpenses: toWhole(profile.emergency_fund.monthly_expenses_minor),
      hasHighInterestDebt: profile.emergency_fund.has_high_interest_debt,
      highInterestDebtBalance: toWhole(profile.emergency_fund.high_interest_debt_balance_minor),
      currentAge: String(profile.retirement.current_age),
      targetRetirementAge: String(profile.retirement.target_retirement_age),
      pensionBalance: toWhole(profile.retirement.pension_balance_minor),
      monthlyContribution: toWhole(profile.retirement.monthly_contribution_minor),
      targetRetirementIncome: toWhole(profile.retirement.target_retirement_income_minor),
      expectedAnnualGrowthPct: String(profile.retirement.expected_annual_growth_pct),
    },
    funds: profile.education_funds.map((f) => ({
      childName: f.child_name,
      childAge: String(f.child_age),
      currentSavings: toWhole(f.current_savings_minor),
      targetSavings: toWhole(f.target_savings_minor),
      yearsRemaining: String(f.years_remaining),
    })),
  }
}

function toPayload(form: FormState, funds: EducationFundForm[]): FinancialProfile {
  const education_funds: FinancialProfileEducationFund[] = funds
    .filter((f) => f.childName.trim())
    .map((f) => ({
      child_name: f.childName.trim(),
      child_age: Number(f.childAge) || 0,
      current_savings_minor: toMinor(f.currentSavings),
      target_savings_minor: Math.max(1, toMinor(f.targetSavings)),
      years_remaining: Number(f.yearsRemaining) || 0,
    }))

  return {
    household: {
      employment_status: form.employmentStatus,
      monthly_salary_minor: toMinor(form.monthlySalary),
      annual_living_expenses_minor: toMinor(form.annualLivingExpenses),
      mortgage_outstanding_minor: toMinor(form.mortgageOutstanding),
      life_cover_minor: toMinor(form.lifeCover),
      income_protection_monthly_minor: toMinor(form.incomeProtectionMonthly),
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
  }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  suffix,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  suffix?: string
}) {
  return (
    <label className="block">
      <div className="text-xs text-ink-tertiary mb-1.5">{label}</div>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? '0'}
          className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
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
  const { family } = useAuth()
  const setFinancialProfileSubmitted = useAppStore((s) => s.setFinancialProfileSubmitted)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [funds, setFunds] = useState<EducationFundForm[]>([])
  const [loading, setLoading] = useState(true)
  const [stepIndex, setStepIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((profile) => {
      if (cancelled) return
      const { form: f, funds: e } = profile ? fromProfile(profile) : { form: EMPTY_FORM, funds: [] as EducationFundForm[] }
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
      setLoading(false)
    })
    return () => { cancelled = true }
    // Deliberately mount-once (family is already loaded by the time this
    // page renders — AuthGate blocks routes until it is) — re-running this
    // on every family change would overwrite in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const addChild = () => {
    haptic('light')
    setFunds((prev) => [...prev, { childName: '', childAge: '', currentSavings: '', targetSavings: '', yearsRemaining: '' }])
  }

  const removeChild = (i: number) => {
    haptic('light')
    setFunds((prev) => prev.filter((_, idx) => idx !== i))
  }

  const updateChild = (i: number, patch: Partial<EducationFundForm>) => {
    setFunds((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
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
      await submitFinancialProfile(toPayload(form, funds))
    } catch {
      // Best-effort — don't trap the user on this step if the autosave
      // fails; the full submit on the last step will surface a real error.
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
      const { insightsGenerated } = await submitFinancialProfile(toPayload(form, funds), true)
      haptic('success')
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
      <div className="px-5 pt-2">
        <PageHeader title="Financial Profile" backHref="/settings" />
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-family-400" />
        </div>
      </div>
    )
  }

  const step = STEPS[stepIndex]!
  const progress = ((stepIndex + 1) / STEPS.length) * 100

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader
        title="Financial Profile"
        backHref="/settings"
        subtitle="This replaces sample scenarios with real, personalized readiness scores"
      />

      {result !== null && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-4 border-success/20 flex items-start gap-3">
            <CheckCircle2 size={20} className="text-success flex-shrink-0 mt-0.5" />
            <div className="text-sm text-ink-secondary">
              Saved. {result > 0
                ? `${result} personalized insight${result === 1 ? '' : 's'} generated — check Home and your Events.`
                : 'No gaps found in what you entered — nice work.'}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {error && (
        <GlassCard className="p-4 border-danger/20 flex items-start gap-3">
          <AlertCircle size={20} className="text-danger flex-shrink-0 mt-0.5" />
          <div className="text-sm text-ink-secondary">{error}</div>
        </GlassCard>
      )}

      {/* Step progress */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-ink-tertiary font-semibold">
            Step {stepIndex + 1} of {STEPS.length}
          </span>
          <span className="text-xs text-family-400 font-bold">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-family-400 to-family-500"
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>
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
                <Field label="Monthly salary" value={form.monthlySalary} onChange={(v) => set('monthlySalary', v)} />
                <Field label="Annual living expenses" value={form.annualLivingExpenses} onChange={(v) => set('annualLivingExpenses', v)} />
                <Field label="Mortgage outstanding" value={form.mortgageOutstanding} onChange={(v) => set('mortgageOutstanding', v)} placeholder="0 if none" />
                <Field label="Life insurance cover" value={form.lifeCover} onChange={(v) => set('lifeCover', v)} placeholder="0 if none" />
                <Field label="Income protection (monthly payout)" value={form.incomeProtectionMonthly} onChange={(v) => set('incomeProtectionMonthly', v)} placeholder="0 if none" />
              </div>
            </GlassCard>
          )}

          {step.key === 'emergency' && (
            <GlassCard className="p-5">
              <SectionTitle>Emergency Fund</SectionTitle>
              <div className="space-y-3">
                <Field label="Emergency savings" value={form.emergencySavings} onChange={(v) => set('emergencySavings', v)} />
                <Field label="Monthly expenses" value={form.monthlyExpenses} onChange={(v) => set('monthlyExpenses', v)} />
                <YesNo label="Any high-interest debt?" value={form.hasHighInterestDebt} onChange={(v) => set('hasHighInterestDebt', v)} />
                {form.hasHighInterestDebt && (
                  <Field
                    label="Rough outstanding balance"
                    value={form.highInterestDebtBalance}
                    onChange={(v) => set('highInterestDebtBalance', v)}
                    placeholder="e.g. credit cards, payday loans"
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
                <Field label="Pension balance" value={form.pensionBalance} onChange={(v) => set('pensionBalance', v)} placeholder="0 if none" />
                <Field label="Monthly pension contribution" value={form.monthlyContribution} onChange={(v) => set('monthlyContribution', v)} placeholder="0 if none" />
                <Field label="Target annual retirement income" value={form.targetRetirementIncome} onChange={(v) => set('targetRetirementIncome', v)} />
                <Field label="Assumed annual growth rate" value={form.expectedAnnualGrowthPct} onChange={(v) => set('expectedAnnualGrowthPct', v)} suffix="%" />
              </div>
            </GlassCard>
          )}

          {step.key === 'education' && (
            <GlassCard className="p-5">
              <SectionTitle>Education Funds</SectionTitle>
              <div className="space-y-4">
                {funds.map((f, i) => (
                  <div key={i} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-3">
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
                      <Field label="Current savings" value={f.currentSavings} onChange={(v) => updateChild(i, { currentSavings: v })} />
                      <Field label="Target amount" value={f.targetSavings} onChange={(v) => updateChild(i, { targetSavings: v })} />
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

      <div className="flex gap-2">
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
