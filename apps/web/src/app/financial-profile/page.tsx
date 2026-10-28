'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Plus,
  X,
  ChevronLeft,
  Sparkles,
  Wallet,
  ChevronRight,
  Home,
} from 'lucide-react'
import { PageHeader, GlassCard, GlassButton, Skeleton, IfAdvanced } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useToast } from '@/components/Toast'
import { useAppStore } from '@/lib/store'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/ConfirmSheetProvider'
import { calculateAge, yearsUntil } from '@/lib/age'
import {
  fetchFinancialProfileWithVersion,
  fetchProfileReview,
  respondToProfileReview,
  submitFinancialProfile,
  type EmploymentStatus,
  type FinancialProfile,
  type FinancialProfileEducationFund,
  type FinancialProfilePolicy,
  type PolicyType,
} from '@/lib/api'
import { POLICY_TYPE_LABELS, PERSON_SCOPED_POLICY_TYPES } from '@/lib/policyTypes'
import { validateWizardStep, type WizardStepKey } from '@/lib/profile-validation'

// Whole-currency string state, converted to minor units (x100) on submit —
// the API and detectors work in minor units, but people think in whole amounts.
interface FormState {
  employmentStatus: EmploymentStatus
  monthlySalary: string
  annualLivingExpenses: string
  mortgageOutstanding: string
  lifeCover: string
  incomeProtectionMonthly: string
  // Intent 26: free-text context for income the numbers can't express —
  // seasonal work, irregular contracts, variable benefits. Stored verbatim
  // and read by Ask Keel as context; never parsed into figures.
  incomeNotes: string
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
  secondEarnerPensionBalance: string
  secondEarnerPensionMonthly: string
  emergencySavings: string
  monthlyExpenses: string
  hasHighInterestDebt: boolean
  highInterestDebtBalance: string
  // Total non-mortgage monthly debt service (cards, loans, finance
  // agreements) — feeds family_debt_health's DTI check. Mortgage is
  // captured separately above.
  monthlyDebtPayments: string
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
  // Optional link to a roster member (role 'child') — mirrors
  // PolicyForm.memberId below. '' means unset / not on the roster yet.
  memberId: string
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
  // Intent 38: server-appended premium trail — read-only in the form, but
  // must round-trip through toPayload or every save would erase it.
  premiumHistory?: Array<{ amount_minor: number; effective_from: string }>
  // Who the policy *protects* (pays out to) — a roster member. Distinct
  // from memberId (the holder): e.g. the organizer's life policy naming a
  // partner as beneficiary. '' = not recorded.
  beneficiaryMemberId: string
  // Claims/24-7-assistance line — display and tel:/mailto: only in the
  // crisis playbooks later, never dialed or sent automatically.
  contactPhone: string
  contactEmail: string
}

const EMPTY_POLICY: PolicyForm = {
  type: 'life',
  provider: '',
  coverageAmount: '',
  monthlyPremium: '',
  renewalDate: '',
  policyNumber: '',
  memberId: '',
  beneficiaryMemberId: '',
  contactPhone: '',
  contactEmail: '',
}

const EMPTY_FORM: FormState = {
  employmentStatus: 'employed',
  monthlySalary: '',
  annualLivingExpenses: '',
  // These six default to '0' rather than '' — every one of them is
  // labeled "0 if none" in the form, so a family without a mortgage,
  // life cover, income protection, or a pension wouldn't otherwise know
  // that without typing "0" themselves just to move past a field that
  // doesn't apply to them. Fields with no such hint (salary, expenses,
  // targets) stay blank on purpose — those need a real answer.
  mortgageOutstanding: '0',
  lifeCover: '0',
  incomeProtectionMonthly: '0',
  incomeNotes: '',
  hasSecondEarner: false,
  secondEarnerMemberId: '',
  secondEarnerEmploymentStatus: 'employed',
  secondEarnerMonthlySalary: '',
  secondEarnerIncomeProtectionMonthly: '0',
  secondEarnerPensionBalance: '',
  secondEarnerPensionMonthly: '',
  emergencySavings: '',
  monthlyExpenses: '',
  hasHighInterestDebt: false,
  highInterestDebtBalance: '',
  monthlyDebtPayments: '0',
  // Server requires both ages to be positive integers (even on autosave, before
  // the user has reached this step) — default to plausible values rather than
  // leaving them blank, same as expectedAnnualGrowthPct's '5' below.
  currentAge: '30',
  targetRetirementAge: '65',
  pensionBalance: '0',
  monthlyContribution: '0',
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
function fromProfile(profile: FinancialProfile): {
  form: FormState
  funds: EducationFundForm[]
  policies: PolicyForm[]
} {
  const household = profile.household ?? ({} as Partial<FinancialProfile['household']>)
  const emergencyFund =
    profile.emergency_fund ?? ({} as Partial<FinancialProfile['emergency_fund']>)
  const retirement = profile.retirement ?? ({} as Partial<FinancialProfile['retirement']>)
  return {
    form: {
      employmentStatus: household.employment_status ?? EMPTY_FORM.employmentStatus,
      monthlySalary: toWhole(household.monthly_salary_minor ?? 0),
      annualLivingExpenses: toWhole(household.annual_living_expenses_minor ?? 0),
      mortgageOutstanding: toWhole(household.mortgage_outstanding_minor ?? 0),
      lifeCover: toWhole(household.life_cover_minor ?? 0),
      incomeProtectionMonthly: toWhole(household.income_protection_monthly_minor ?? 0),
      incomeNotes: household.income_notes ?? '',
      // This UI only ever writes one members[] entry — see toPayload().
      hasSecondEarner: (household.members?.length ?? 0) > 0,
      secondEarnerMemberId: household.members?.[0]?.member_id ?? '',
      secondEarnerEmploymentStatus:
        household.members?.[0]?.employment_status ?? EMPTY_FORM.secondEarnerEmploymentStatus,
      secondEarnerMonthlySalary: toWhole(household.members?.[0]?.monthly_salary_minor ?? 0),
      secondEarnerIncomeProtectionMonthly: toWhole(
        household.members?.[0]?.income_protection_monthly_minor ?? 0,
      ),
      // Pension fields are optional — leave blank when never collected so
      // "not on file" stays distinguishable from "declared £0".
      secondEarnerPensionBalance:
        household.members?.[0]?.pension_balance_minor != null
          ? toWhole(household.members?.[0]?.pension_balance_minor ?? 0)
          : '',
      secondEarnerPensionMonthly:
        household.members?.[0]?.monthly_pension_contribution_minor != null
          ? toWhole(household.members?.[0]?.monthly_pension_contribution_minor ?? 0)
          : '',
      emergencySavings: toWhole(emergencyFund.emergency_savings_minor ?? 0),
      monthlyExpenses: toWhole(emergencyFund.monthly_expenses_minor ?? 0),
      hasHighInterestDebt: emergencyFund.has_high_interest_debt ?? false,
      highInterestDebtBalance: toWhole(emergencyFund.high_interest_debt_balance_minor ?? 0),
      monthlyDebtPayments: toWhole(household.monthly_debt_payments_minor ?? 0),
      currentAge: String(retirement.current_age ?? EMPTY_FORM.currentAge),
      targetRetirementAge: String(
        retirement.target_retirement_age ?? EMPTY_FORM.targetRetirementAge,
      ),
      pensionBalance: toWhole(retirement.pension_balance_minor ?? 0),
      monthlyContribution: toWhole(retirement.monthly_contribution_minor ?? 0),
      targetRetirementIncome: toWhole(retirement.target_retirement_income_minor ?? 0),
      expectedAnnualGrowthPct: String(
        retirement.expected_annual_growth_pct ?? EMPTY_FORM.expectedAnnualGrowthPct,
      ),
    },
    funds: (profile.education_funds ?? []).map((f) => ({
      childName: f.child_name,
      childAge: String(f.child_age),
      currentSavings: toWhole(f.current_savings_minor),
      targetSavings: toWhole(f.target_savings_minor),
      yearsRemaining: String(f.years_remaining),
      memberId: f.member_id ?? '',
    })),
    policies: (profile.policies ?? []).map((p) => ({
      type: p.type,
      provider: p.provider,
      coverageAmount: toWhole(p.coverage_amount_minor),
      monthlyPremium: toWhole(p.monthly_premium_minor),
      renewalDate: p.renewal_date ?? '',
      policyNumber: p.policy_number ?? '',
      memberId: p.member_id ?? '',
      beneficiaryMemberId: p.beneficiary_member_id ?? '',
      contactPhone: p.contact_phone ?? '',
      contactEmail: p.contact_email ?? '',
      ...(p.premium_history ? { premiumHistory: p.premium_history } : {}),
    })),
  }
}

function toPayload(
  form: FormState,
  funds: EducationFundForm[],
  policies: PolicyForm[],
): FinancialProfile {
  const education_funds: FinancialProfileEducationFund[] = funds
    .filter((f) => f.childName.trim())
    .map((f) => ({
      child_name: f.childName.trim(),
      child_age: Number(f.childAge) || 0,
      current_savings_minor: toMinor(f.currentSavings),
      target_savings_minor: toMinor(f.targetSavings),
      years_remaining: Number(f.yearsRemaining) || 0,
      ...(f.memberId ? { member_id: f.memberId } : {}),
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
      ...(p.premiumHistory ? { premium_history: p.premiumHistory } : {}),
      ...(PERSON_SCOPED_POLICY_TYPES.has(p.type) && p.memberId ? { member_id: p.memberId } : {}),
      ...(PERSON_SCOPED_POLICY_TYPES.has(p.type) && p.beneficiaryMemberId
        ? { beneficiary_member_id: p.beneficiaryMemberId }
        : {}),
      ...(p.contactPhone.trim() ? { contact_phone: p.contactPhone.trim() } : {}),
      ...(p.contactEmail.trim() ? { contact_email: p.contactEmail.trim() } : {}),
    }))

  return {
    household: {
      employment_status: form.employmentStatus,
      monthly_salary_minor: toMinor(form.monthlySalary),
      annual_living_expenses_minor: toMinor(form.annualLivingExpenses),
      mortgage_outstanding_minor: toMinor(form.mortgageOutstanding),
      life_cover_minor: toMinor(form.lifeCover),
      income_protection_monthly_minor: toMinor(form.incomeProtectionMonthly),
      monthly_debt_payments_minor: toMinor(form.monthlyDebtPayments),
      ...(form.incomeNotes.trim() ? { income_notes: form.incomeNotes.trim() } : {}),
      members:
        form.hasSecondEarner && form.secondEarnerMemberId
          ? [
              {
                member_id: form.secondEarnerMemberId,
                employment_status: form.secondEarnerEmploymentStatus,
                monthly_salary_minor: toMinor(form.secondEarnerMonthlySalary),
                income_protection_monthly_minor: toMinor(form.secondEarnerIncomeProtectionMonthly),
                ...(form.secondEarnerPensionBalance !== ''
                  ? { pension_balance_minor: toMinor(form.secondEarnerPensionBalance) }
                  : {}),
                ...(form.secondEarnerPensionMonthly !== ''
                  ? { monthly_pension_contribution_minor: toMinor(form.secondEarnerPensionMonthly) }
                  : {}),
              },
            ]
          : [],
    },
    emergency_fund: {
      emergency_savings_minor: toMinor(form.emergencySavings),
      monthly_expenses_minor: toMinor(form.monthlyExpenses),
      has_high_interest_debt: form.hasHighInterestDebt,
      high_interest_debt_balance_minor: form.hasHighInterestDebt
        ? toMinor(form.highInterestDebtBalance)
        : 0,
    },
    retirement: {
      current_age: Number(form.currentAge) || 0,
      target_retirement_age: Number(form.targetRetirementAge) || 0,
      pension_balance_minor: toMinor(form.pensionBalance),
      monthly_contribution_minor: toMinor(form.monthlyContribution),
      target_retirement_income_minor: toMinor(form.targetRetirementIncome),
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
  onBlur,
  placeholder,
  suffix,
  prefix,
  hint,
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  suffix?: string
  prefix?: string
  hint?: string
  error?: string | undefined
}) {
  return (
    <label className="block">
      <div className="text-xs text-ink-tertiary mb-1.5">{label}</div>
      {hint && <div className="text-xs text-ink-tertiary/70 mb-1.5 -mt-1">{hint}</div>}
      <div className="relative">
        {prefix && (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base text-ink-tertiary">
            {prefix}
          </span>
        )}
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder ?? '0'}
          aria-invalid={Boolean(error) || undefined}
          className={`glass-input w-full rounded-xl py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 transition-all ${prefix ? 'pl-8 pr-4' : 'px-4'} ${
            error
              ? 'ring-2 ring-red-400/50 border-red-400/40 focus:ring-red-400/50 focus:border-red-400/40'
              : 'focus:ring-family-500/40 focus:border-family-500/30'
          }`}
        />
        {suffix && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-ink-tertiary">
            {suffix}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
    </label>
  )
}

// Drops every error belonging to one list row (a `fund.${i}.` or
// `policy.${i}.` key) when the row itself is edited — a correction clears
// the row's messages immediately rather than waiting for the next
// Continue-click revalidation.
function clearRowErrors(errors: Record<string, string>, prefix: string) {
  const next = { ...errors }
  let changed = false
  for (const k of Object.keys(next)) {
    if (k.startsWith(prefix)) {
      delete next[k]
      changed = true
    }
  }
  return changed ? next : errors
}

function YesNo({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div>
      <div className="text-xs text-ink-tertiary mb-1.5">{label}</div>
      <div className="flex gap-2">
        {[true, false].map((opt) => (
          <button
            key={String(opt)}
            type="button"
            onClick={() => {
              haptic('light')
              onChange(opt)
            }}
            aria-pressed={value === opt}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${
              value === opt ? 'bg-family-500 text-white' : 'glass text-ink-secondary'
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

function EmploymentStatusPicker({
  value,
  onChange,
}: {
  value: EmploymentStatus
  onChange: (v: EmploymentStatus) => void
}) {
  return (
    <div>
      <div className="text-xs text-ink-tertiary mb-1.5">Employment status</div>
      <div className="grid grid-cols-2 gap-2">
        {EMPLOYMENT_STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              haptic('light')
              onChange(opt.value)
            }}
            aria-pressed={value === opt.value}
            className={`rounded-xl py-2.5 text-sm font-semibold transition-all ${
              value === opt.value ? 'bg-family-500 text-white' : 'glass text-ink-secondary'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PolicyTypePicker({
  value,
  onChange,
}: {
  value: PolicyType
  onChange: (v: PolicyType) => void
}) {
  return (
    <div>
      <div className="text-xs text-ink-tertiary mb-1.5">Policy type</div>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(POLICY_TYPE_LABELS) as PolicyType[]).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => {
              haptic('light')
              onChange(opt)
            }}
            aria-pressed={value === opt}
            className={`rounded-xl py-2.5 text-sm font-semibold transition-all ${
              value === opt ? 'bg-family-500 text-white' : 'glass text-ink-secondary'
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
  { key: 'household', title: 'Income & Household' },
  // Household used to carry income, expenses, the second-earner block,
  // cover totals, AND every policy field — most of the wizard's inputs in
  // a single "25% done" step. Protection is its own step now so progress
  // is real and each screen stays one mental model.
  { key: 'protection', title: 'Protection & Policies' },
  { key: 'emergency', title: 'Emergency Fund' },
  { key: 'retirement', title: 'Retirement' },
  { key: 'education', title: 'Education Funds' },
]

// Lightweight completeness estimate — counts how many of the key input
// fields have meaningful (non-default, non-zero) values.  Used to show
// a progress ring on Home and Settings without re-fetching the profile.
function computeCompleteness(
  form: FormState,
  funds: EducationFundForm[],
  policies: PolicyForm[] = [],
): number {
  const filled = (v: string) => v !== '' && v !== '0'
  // Count every section the wizard actually asks for, not a fixed
  // subset — a profile saved through all the income/debt/cover steps
  // used to read ~18% because debts, mortgage, policies and the second
  // earner never entered the numerator (intent 54).
  const fields: boolean[] = [
    filled(form.monthlySalary),
    filled(form.annualLivingExpenses),
    filled(form.mortgageOutstanding),
    filled(form.lifeCover),
    filled(form.incomeProtectionMonthly),
    filled(form.emergencySavings),
    filled(form.monthlyExpenses),
    filled(form.monthlyDebtPayments),
    filled(form.currentAge),
    filled(form.targetRetirementAge),
    filled(form.pensionBalance),
    filled(form.monthlyContribution),
  ]
  if (form.hasSecondEarner) {
    fields.push(filled(form.secondEarnerMonthlySalary))
  }
  if (funds.length > 0) {
    fields.push(funds.some((f) => filled(f.currentSavings)))
  }
  if (policies.length > 0) {
    fields.push(policies.some((p) => filled(p.provider) || filled(p.coverageAmount)))
  }
  const done = fields.filter(Boolean).length
  return Math.round((done / fields.length) * 100)
}

export default function FinancialProfilePage() {
  const router = useRouter()
  const { family, user, updateMemberDateOfBirth } = useAuth()
  const confirm = useConfirm()
  // PRD-104: adults on the roster other than the signed-in user — the
  // Second Earner section only makes sense, and is only shown, when at
  // least one exists (i.e. the household has more than one adult).
  const otherAdults = (family?.members ?? []).filter((m) => m.role !== 'child' && m.id !== user?.id)
  const setFinancialProfileSubmitted = useAppStore((s) => s.setFinancialProfileSubmitted)
  const setProfileCompleteness = useAppStore((s) => s.setProfileCompleteness)
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
  // KEEL-006: tracked from the initial GET and updated after every
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
  // Inline per-field errors from validateWizardStep — checked before every
  // step autosave and again before the final submit, since a server 400 on
  // bad input otherwise surfaces only as the generic "couldn't save"
  // banner while the wizard keeps advancing.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  // Annual review prompt — due once a year since the last explicit
  // confirmation; 'confirm' stamps reviewed_at server-side, 'later'
  // snoozes 30 days. Null until fetched; hidden unless due.
  const [reviewDue, setReviewDue] = useState<{ due: boolean; changed: string[] } | null>(null)
  // A failed profile load must never render as an empty form — that reads
  // as "your data was lost" and the next autosave would overwrite the real
  // profile with blanks. failure → dedicated retry state; retryTick bumps
  // re-run the load effect.
  const [loadFailed, setLoadFailed] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const [loadedSavedProfile, setLoadedSavedProfile] = useState(false)

  // Remediation item 27: reached straight from onboarding — the flow ends
  // on this form instead of a blank dashboard, because saving it is what
  // generates the family's first real insight. Read via window.location —
  // same static-export workaround as the ?add=1 handling in settings.
  const [fromOnboarding] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('source') === 'onboarding',
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
    void fetchProfileReview().then((r) => setReviewDue({ due: r.due, changed: r.changed }))
  }, [])

  // Live-verification finding: "Annual living expenses" (step 1) and
  // "Monthly expenses" (step 2, used for the emergency-fund-months
  // calculation) are genuinely different numbers to two different
  // detectors — not a duplicate field — but asked cold on separate
  // screens with nothing connecting them, it reads as "didn't I just
  // answer this?" and invites inconsistent answers. Prefilling an
  // editable /12 estimate removes the re-entry friction while still
  // letting the user correct it if their real monthly spend differs
  // (e.g. annual expenses includes costs that don't recur monthly).
  useEffect(() => {
    if (STEPS[stepIndex]?.key !== 'emergency') return
    if (form.monthlyExpenses !== '' || form.annualLivingExpenses === '') return
    const estimate = Math.round(Number(form.annualLivingExpenses) / 12)
    if (Number.isFinite(estimate) && estimate > 0) set('monthlyExpenses', String(estimate))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex])

  // "Your current age" is otherwise the one blank/default-30 number in the
  // wizard with a knowable real answer — the signed-in user's own roster
  // birthday, once one exists. Keeps form.currentAge (what actually gets
  // submitted) in sync so toPayload needs no change; the retirement step's
  // JSX below shows this as a derived, read-only value instead of a Field
  // whenever it's available.
  // m.id covers the organizer/join-request members; m.userId covers
  // invite-accepted members (PRD-123) whose roster id isn't their user id.
  const selfMember = (family?.members ?? []).find((m) => m.id === user?.id || m.userId === user?.id)
  useEffect(() => {
    if (!selfMember?.dateOfBirth) return
    set('currentAge', String(calculateAge(selfMember.dateOfBirth)))
  }, [selfMember?.dateOfBirth])

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfileWithVersion()
      .then(({ profile, version: v }) => {
        if (cancelled) return
        setVersion(v)
        if (profile) setLoadedSavedProfile(true)
        const {
          form: f,
          funds: e,
          policies: p,
        } = profile
          ? fromProfile(profile)
          : { form: EMPTY_FORM, funds: [] as EducationFundForm[], policies: [] as PolicyForm[] }
        // Pre-fill an education fund entry for each child already on the
        // family roster that isn't already represented here — no reason to
        // make the user retype a name that's already on file. Linked by
        // memberId (not just a one-time name copy) so a birthday added later
        // on the roster (see MemberProfileClient.tsx) still derives age/years
        // here automatically instead of going stale.
        const existingMemberIds = new Set(e.map((fund) => fund.memberId).filter(Boolean))
        const existingNames = new Set(e.map((fund) => fund.childName.trim().toLowerCase()))
        const knownChildren = (family?.members ?? []).filter(
          (m) =>
            m.role === 'child' &&
            !existingMemberIds.has(m.id) &&
            !existingNames.has(m.name.trim().toLowerCase()),
        )
        const funds = [
          ...e,
          ...knownChildren.map((c) => ({
            childName: c.name,
            childAge: c.dateOfBirth ? String(calculateAge(c.dateOfBirth)) : '',
            currentSavings: '',
            targetSavings: '',
            yearsRemaining: c.dateOfBirth ? String(yearsUntil(c.dateOfBirth, 18)) : '',
            memberId: c.id,
          })),
        ]
        setForm(f)
        setFunds(funds)
        setPolicies(p)
        setProfileCompleteness(computeCompleteness(f, funds, p))
        // Intent 37: cross-device resume — the draft is server-stored, so a
        // returning session (on any device) should land on the first
        // incomplete step, not back at step 1 re-reading finished work. An
        // explicit ?step= link still wins over the computed resume.
        if (!new URLSearchParams(window.location.search).get('step')) {
          const firstIncomplete = STEPS.findIndex(
            (s) => validateWizardStep(s.key as WizardStepKey, f, funds, p).length > 0,
          )
          if (firstIncomplete > 0) setStepIndex(firstIncomplete)
        }
        setLoading(false)
      })
      .catch(() => {
        // Network/server failure — NOT "no profile on file". Showing
        // EMPTY_FORM here would let an autosave overwrite the real saved
        // answers; the loadFailed branch renders a retry prompt instead.
        if (!cancelled) {
          setLoadFailed(true)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
    // retryTick re-runs the load on "Try again". Deliberately NOT re-run on
    // family changes (family is already loaded by the time this page
    // renders — AuthGate blocks routes until it is) — that would overwrite
    // in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick])

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

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    // A correction clears that field's inline error the moment the user
    // types, not on the next Continue-click revalidation.
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const addChild = () => {
    haptic('light')
    setFunds((prev) => [
      ...prev,
      {
        childName: '',
        childAge: '',
        currentSavings: '',
        targetSavings: '',
        yearsRemaining: '',
        memberId: '',
      },
    ])
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
    // Row indexes shift on remove — a stale `fund.${i}.*` error would land
    // on whichever row slid into that slot, so clear them all.
    setFieldErrors((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) if (k.startsWith('fund.')) delete next[k]
      return next
    })
    setFunds((prev) => prev.filter((_, idx) => idx !== i))
  }

  const updateChild = (i: number, patch: Partial<EducationFundForm>) => {
    setFieldErrors((prev) => clearRowErrors(prev, `fund.${i}.`))
    setFunds((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  // Linking to a roster child (mirrors the Policy form's member picker):
  // '' means "someone not listed yet" — clears the link and falls back to
  // the free-text name field. Picking a real member also derives age/years
  // when that member already has a birthday on file, instead of asking.
  const handleChildMemberSelect = (i: number, memberId: string) => {
    if (!memberId) {
      updateChild(i, { memberId: '' })
      return
    }
    const member = (family?.members ?? []).find((m) => m.id === memberId)
    if (!member) return
    updateChild(i, {
      memberId,
      childName: member.name,
      ...(member.dateOfBirth
        ? {
            childAge: String(calculateAge(member.dateOfBirth)),
            yearsRemaining: String(yearsUntil(member.dateOfBirth, 18)),
          }
        : {}),
    })
  }

  // A DOB entered here writes back to the roster member (so it's known
  // everywhere else too, e.g. the Retirement step) and immediately derives
  // this fund's age/years — same "ask once, at the point it's needed"
  // pattern as the member's own profile page.
  const handleChildDobChange = async (i: number, memberId: string, dob: string) => {
    if (!dob) return
    updateChild(i, {
      childAge: String(calculateAge(dob)),
      yearsRemaining: String(yearsUntil(dob, 18)),
    })
    try {
      await updateMemberDateOfBirth(memberId, dob)
    } catch {
      // Best-effort — the derived age/years above still apply locally even
      // if the roster write fails; the user can retry from the member's
      // own profile page later.
    }
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
    setFieldErrors((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) if (k.startsWith('policy.')) delete next[k]
      return next
    })
    setPolicies((prev) => prev.filter((_, idx) => idx !== i))
  }

  const updatePolicy = (i: number, patch: Partial<PolicyForm>) => {
    setFieldErrors((prev) => clearRowErrors(prev, `policy.${i}.`))
    setPolicies((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  const isLastStep = stepIndex === STEPS.length - 1

  // Intent 28: per-field validation on blur — the same rule set
  // handleContinue runs at step level, so a bad value is named the
  // moment the field loses focus instead of at step transition (which,
  // on mobile, means after the keyboard closes and the user scrolled).
  const validateOnBlur = (key: string) => {
    const issues = validateWizardStep(step.key as WizardStepKey, form, funds, policies)
    const mine = issues.find((i) => i.key === key)
    setFieldErrors((prev) => {
      const next = { ...prev }
      if (mine) next[key] = mine.message
      else delete next[key]
      return next
    })
  }

  // Autosaves whatever's been entered so far whenever the user moves to the
  // next step — closing the tab mid-form used to lose everything, since the
  // old single-page form only ever saved on the final submit.
  const handleContinue = async () => {
    haptic('light')
    setError(null)
    // Validate before autosave: the API rejects negatives/non-integers with
    // a bare 400, which used to land here as the generic "couldn't save"
    // banner while the step still advanced — the user never learned which
    // field failed. Block and name the offending fields instead.
    const issues = validateWizardStep(step.key as WizardStepKey, form, funds, policies)
    if (issues.length > 0) {
      setFieldErrors((prev) => ({
        ...prev,
        ...Object.fromEntries(issues.map((i) => [i.key, i.message])),
      }))
      setError("Check the highlighted fields — this step hasn't been saved.")
      haptic('warning')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setSaving(true)
    try {
      const { version: newVersion } = await submitFinancialProfile(
        toPayload(form, funds, policies),
        false,
        version,
      )
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
    // Same gate as handleContinue, across every step — an earlier step's
    // value could still be invalid if it was typed after that step's
    // autosave. Jump back to the first bad step so the errors are visible.
    const allIssues = STEPS.flatMap((s, idx) =>
      validateWizardStep(s.key as WizardStepKey, form, funds, policies).map((i) => ({
        ...i,
        stepIndex: idx,
      })),
    )
    if (allIssues.length > 0) {
      setFieldErrors(Object.fromEntries(allIssues.map((i) => [i.key, i.message])))
      setStepIndex(allIssues[0]!.stepIndex)
      setError('Check the highlighted fields — nothing has been saved yet.')
      haptic('warning')
      setSubmitting(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    try {
      const { insightsGenerated, version: newVersion } = await submitFinancialProfile(
        toPayload(form, funds, policies),
        true,
        version,
      )
      setVersion(newVersion)
      setAutosaveFailed(false)
      haptic('success')
      toast({
        message: insightsGenerated
          ? 'Profile saved — new insights generated'
          : 'Financial profile saved',
      })
      setResult(insightsGenerated)
      setFinancialProfileSubmitted()
      setProfileCompleteness(computeCompleteness(form, funds, policies))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      haptic('warning')
      setError(
        err instanceof Error
          ? err.message
          : "Your answers didn't save — they're still on this screen. Try again in a moment.",
      )
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

  if (loadFailed) {
    return (
      <div className="px-5 pt-2 pb-10 space-y-5">
        <PageHeader
          title="Financial Profile"
          backHref={fromOnboarding ? '/' : '/settings'}
          subtitle="This replaces sample scenarios with real, personalized readiness scores"
        />
        <GlassCard className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-error flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-primary mb-0.5">
                Couldn&apos;t load your profile
              </div>
              <p className="text-xs text-ink-tertiary leading-relaxed">
                Your saved answers are still on file — we just couldn&apos;t reach them right now.
                Check your connection and try again.
              </p>
              <GlassButton
                className="mt-3 w-full py-2.5 text-sm"
                onClick={() => {
                  haptic('light')
                  setLoadFailed(false)
                  setLoading(true)
                  setRetryTick((t) => t + 1)
                }}
              >
                Try again
              </GlassButton>
            </div>
          </div>
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

      {loadedSavedProfile && stepIndex === 0 && result === null && (
        <div className="flex items-center gap-2 text-xs text-ink-tertiary" role="status">
          <CheckCircle2 size={13} className="text-family-400 flex-shrink-0" />
          Your saved answers are filled in below — update anything that&apos;s changed.
        </div>
      )}

      {reviewDue?.due && result === null && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-4 border-warning/20">
            <div className="text-sm font-semibold text-ink-primary mb-0.5">A yearly check-in</div>
            <p className="text-xs text-ink-tertiary leading-relaxed">
              It&apos;s been over a year since you confirmed these figures. Everything below is
              what&apos;s currently on file
              {reviewDue.changed.length > 0
                ? ' — and since your last review, ' +
                  reviewDue.changed.slice(0, 5).join(', ') +
                  (reviewDue.changed.length > 5
                    ? ` and ${reviewDue.changed.length - 5} more`
                    : '') +
                  ' changed'
                : ''}
              .
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={async () => {
                  haptic('light')
                  if (await respondToProfileReview('confirm')) setReviewDue(null)
                }}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold bg-family-500 text-white"
              >
                Still accurate
              </button>
              <button
                onClick={async () => {
                  haptic('light')
                  if (await respondToProfileReview('later')) setReviewDue(null)
                }}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold glass text-ink-secondary"
              >
                Remind me later
              </button>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {fromOnboarding && result === null && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-4 border-family-500/20 flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Sparkles size={16} className="text-family-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink-primary mb-0.5">
                This powers your readiness score
              </div>
              <p className="text-xs text-ink-tertiary leading-relaxed">
                The more you share, the more specific Keel&apos;s insights become — your family
                names are already filled in. You can skip steps and come back later.
              </p>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {result !== null && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
          aria-live="polite"
        >
          <GlassCard className="p-4 border-success/20 flex items-start gap-3">
            <CheckCircle2 size={20} className="text-success flex-shrink-0 mt-0.5" />
            <div className="text-sm text-ink-secondary">
              Saved.{' '}
              {result > 0
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

      {/* PRD-131 + gap 8: the cash-flow ledger and the assets register
          live next to the profile — the monthly and ownership pictures
          these figures feed into. */}
      <Link href="/cashflow" onClick={() => haptic('light')} className="block">
        <GlassCard className="p-3.5 border-family-500/20 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
            <Wallet size={16} className="text-family-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink-primary">Monthly cash flow</div>
            <div className="text-xs text-ink-tertiary">
              Track what comes in and goes out — feeds your runway picture
            </div>
          </div>
          <ChevronRight size={14} className="text-ink-tertiary flex-shrink-0" />
        </GlassCard>
      </Link>
      <Link href="/assets" onClick={() => haptic('light')} className="block">
        <GlassCard className="p-3.5 border-tint/[0.06] flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-tint/[0.05] border border-tint/[0.08] flex items-center justify-center flex-shrink-0">
            <Home size={16} className="text-ink-secondary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink-primary">Assets register</div>
            <div className="text-xs text-ink-tertiary">
              Property, vehicles, valuables — what your family owns
            </div>
          </div>
          <ChevronRight size={14} className="text-ink-tertiary flex-shrink-0" />
        </GlassCard>
      </Link>

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
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-1.5 mt-2 text-xs text-warning"
          >
            <AlertCircle size={12} className="flex-shrink-0" />
            <span>
              Couldn&apos;t save the previous step — your answers are still here and will be saved
              when you continue.
            </span>
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
              <SectionTitle>Income & Household</SectionTitle>
              <div className="space-y-3">
                <EmploymentStatusPicker
                  value={form.employmentStatus}
                  onChange={(v) => set('employmentStatus', v)}
                />
                <Field
                  label="Monthly salary"
                  value={form.monthlySalary}
                  onChange={(v) => set('monthlySalary', v)}
                  prefix="£"
                  error={fieldErrors.monthlySalary}
                  onBlur={() => validateOnBlur('monthlySalary')}
                />
                <Field
                  label="Annual living expenses"
                  hint="Everyday household spending only — food, bills, transport. Exclude mortgage payments; that's counted separately below."
                  value={form.annualLivingExpenses}
                  onChange={(v) => set('annualLivingExpenses', v)}
                  prefix="£"
                  error={fieldErrors.annualLivingExpenses}
                  onBlur={() => validateOnBlur('annualLivingExpenses')}
                />
                <Field
                  label="Mortgage outstanding"
                  value={form.mortgageOutstanding}
                  onChange={(v) => set('mortgageOutstanding', v)}
                  placeholder="0 if none"
                  prefix="£"
                  error={fieldErrors.mortgageOutstanding}
                  onBlur={() => validateOnBlur('mortgageOutstanding')}
                />
                {/* Intent 26: a seasonal or irregular income can't be
                    expressed as one monthly number — let the family say so
                    in words, which Ask Keel then reads as context. */}
                <label className="block">
                  <div className="text-sm font-medium text-ink-secondary mb-1">
                    Income notes (optional)
                  </div>
                  <textarea
                    value={form.incomeNotes}
                    onChange={(e) => set('incomeNotes', e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="e.g. seasonal work, irregular contracts, income varies month to month"
                    className="glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 transition-all resize-none"
                  />
                </label>
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
                    if (v && !form.secondEarnerMemberId)
                      set('secondEarnerMemberId', otherAdults[0]!.id)
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
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
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
                      error={fieldErrors.secondEarnerMonthlySalary}
                      onBlur={() => validateOnBlur('secondEarnerMonthlySalary')}
                    />
                    <Field
                      label="Their income protection (monthly payout)"
                      value={form.secondEarnerIncomeProtectionMonthly}
                      onChange={(v) => set('secondEarnerIncomeProtectionMonthly', v)}
                      placeholder="0 if none"
                      prefix="£"
                      error={fieldErrors.secondEarnerIncomeProtectionMonthly}
                      onBlur={() => validateOnBlur('secondEarnerIncomeProtectionMonthly')}
                    />
                    <Field
                      label="Their pension balance (optional)"
                      value={form.secondEarnerPensionBalance}
                      onChange={(v) => set('secondEarnerPensionBalance', v)}
                      placeholder="Leave blank if unknown"
                      prefix="£"
                      error={fieldErrors.secondEarnerPensionBalance}
                      onBlur={() => validateOnBlur('secondEarnerPensionBalance')}
                    />
                    <Field
                      label="Their monthly pension contribution (optional)"
                      value={form.secondEarnerPensionMonthly}
                      onChange={(v) => set('secondEarnerPensionMonthly', v)}
                      placeholder="Leave blank if unknown"
                      prefix="£"
                      error={fieldErrors.secondEarnerPensionMonthly}
                      onBlur={() => validateOnBlur('secondEarnerPensionMonthly')}
                    />
                  </>
                )}
              </div>
            </GlassCard>
          )}

          {step.key === 'protection' && (
            <GlassCard className="p-5">
              <SectionTitle>Your Cover</SectionTitle>
              <div className="space-y-3">
                <Field
                  label="Life insurance cover"
                  value={form.lifeCover}
                  onChange={(v) => set('lifeCover', v)}
                  placeholder="0 if none"
                  prefix="£"
                  error={fieldErrors.lifeCover}
                  onBlur={() => validateOnBlur('lifeCover')}
                />
                <Field
                  label="Income protection (monthly payout)"
                  value={form.incomeProtectionMonthly}
                  onChange={(v) => set('incomeProtectionMonthly', v)}
                  placeholder="0 if none"
                  prefix="£"
                  error={fieldErrors.incomeProtectionMonthly}
                  onBlur={() => validateOnBlur('incomeProtectionMonthly')}
                />
              </div>
            </GlassCard>
          )}

          {step.key === 'protection' && (
            <GlassCard className="p-5 mt-4">
              <div data-keel-anchor="policies">
                <SectionTitle>Insurance Policies</SectionTitle>
              </div>
              <div className="space-y-4">
                {policies.map((p, i) => (
                  <div
                    key={i}
                    className="rounded-2xl bg-tint/[0.02] border border-tint/[0.06] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink-tertiary">
                        Policy {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePolicy(i)}
                        aria-label="Remove policy"
                        className="w-7 h-7 rounded-full flex items-center justify-center text-ink-tertiary active:opacity-60"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <PolicyTypePicker
                      value={p.type}
                      onChange={(v) => updatePolicy(i, { type: v })}
                    />
                    {PERSON_SCOPED_POLICY_TYPES.has(p.type) &&
                      (family?.members ?? []).length > 0 && (
                        <label className="block">
                          <div className="text-xs text-ink-tertiary mb-1.5">
                            Who is this policy for?
                          </div>
                          <select
                            value={p.memberId}
                            onChange={(e) => updatePolicy(i, { memberId: e.target.value })}
                            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all bg-transparent"
                          >
                            <option value="">The whole household / not sure</option>
                            {(family?.members ?? []).map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    {PERSON_SCOPED_POLICY_TYPES.has(p.type) &&
                      (family?.members ?? []).length > 0 && (
                        <label className="block">
                          <div className="text-xs text-ink-tertiary mb-1.5">
                            Who does it protect? (beneficiary — optional)
                          </div>
                          <select
                            value={p.beneficiaryMemberId}
                            onChange={(e) =>
                              updatePolicy(i, { beneficiaryMemberId: e.target.value })
                            }
                            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all bg-transparent"
                          >
                            <option value="">Not recorded</option>
                            {(family?.members ?? []).map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
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
                      <div className="text-xs text-ink-tertiary mb-1.5">
                        Policy number (if known)
                      </div>
                      <input
                        type="text"
                        value={p.policyNumber}
                        onChange={(e) => updatePolicy(i, { policyNumber: e.target.value })}
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        label="Coverage amount"
                        value={p.coverageAmount}
                        onChange={(v) => updatePolicy(i, { coverageAmount: v })}
                        placeholder="0 if none"
                        prefix="£"
                        error={fieldErrors[`policy.${i}.coverageAmount`]}
                      />
                      <Field
                        label="Monthly premium"
                        value={p.monthlyPremium}
                        onChange={(v) => updatePolicy(i, { monthlyPremium: v })}
                        placeholder="0 if none"
                        prefix="£"
                        error={fieldErrors[`policy.${i}.monthlyPremium`]}
                      />
                      {/* Intent 38: surface the recorded premium trail so a
                          creeping renewal is visible, not just the latest
                          number. History is server-appended on save. */}
                      {p.premiumHistory && p.premiumHistory.length > 0 && (
                        <p className="text-xs text-ink-tertiary -mt-1">
                          Previously £
                          {(
                            p.premiumHistory[p.premiumHistory.length - 1]!.amount_minor / 100
                          ).toFixed(2)}
                          /mo
                          {p.premiumHistory.length > 1 &&
                            ` (${p.premiumHistory.length} changes on file)`}
                        </p>
                      )}
                    </div>
                    <label className="block">
                      <div className="text-xs text-ink-tertiary mb-1.5">
                        Renewal date (if known)
                      </div>
                      <input
                        type="date"
                        value={p.renewalDate}
                        onChange={(e) => updatePolicy(i, { renewalDate: e.target.value })}
                        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <div className="text-xs text-ink-tertiary mb-1.5">
                          Claims/assistance phone
                        </div>
                        <input
                          type="tel"
                          value={p.contactPhone}
                          onChange={(e) => updatePolicy(i, { contactPhone: e.target.value })}
                          placeholder="If known"
                          className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                        />
                      </label>
                      <label className="block">
                        <div className="text-xs text-ink-tertiary mb-1.5">
                          Claims/assistance email
                        </div>
                        <input
                          type="email"
                          value={p.contactEmail}
                          onChange={(e) => updatePolicy(i, { contactEmail: e.target.value })}
                          placeholder="If known"
                          className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                        />
                      </label>
                    </div>
                    <div className="text-[11px] text-ink-tertiary">
                      Shown in your emergency playbooks so the family can call or email fast — Keel
                      never contacts anyone for you.
                    </div>
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
                <Field
                  label="Emergency savings"
                  value={form.emergencySavings}
                  onChange={(v) => set('emergencySavings', v)}
                  prefix="£"
                  error={fieldErrors.emergencySavings}
                  onBlur={() => validateOnBlur('emergencySavings')}
                />
                <Field
                  label="Monthly expenses"
                  value={form.monthlyExpenses}
                  onChange={(v) => set('monthlyExpenses', v)}
                  prefix="£"
                  error={fieldErrors.monthlyExpenses}
                  onBlur={() => validateOnBlur('monthlyExpenses')}
                />
                <YesNo
                  label="Any high-interest debt?"
                  value={form.hasHighInterestDebt}
                  onChange={(v) => set('hasHighInterestDebt', v)}
                />
                {form.hasHighInterestDebt && (
                  <Field
                    label="Rough outstanding balance"
                    value={form.highInterestDebtBalance}
                    onChange={(v) => set('highInterestDebtBalance', v)}
                    placeholder="e.g. credit cards, payday loans"
                    prefix="£"
                    error={fieldErrors.highInterestDebtBalance}
                    onBlur={() => validateOnBlur('highInterestDebtBalance')}
                  />
                )}
                <Field
                  label="Monthly debt payments (not counting the mortgage)"
                  value={form.monthlyDebtPayments}
                  onChange={(v) => set('monthlyDebtPayments', v)}
                  placeholder="0 if none — cards, loans, car finance"
                  prefix="£"
                  error={fieldErrors.monthlyDebtPayments}
                  onBlur={() => validateOnBlur('monthlyDebtPayments')}
                />
              </div>
            </GlassCard>
          )}

          {step.key === 'retirement' && (
            <GlassCard className="p-5">
              <SectionTitle>Retirement</SectionTitle>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {selfMember?.dateOfBirth ? (
                    <div>
                      <div className="text-xs text-ink-tertiary mb-1.5">Your current age</div>
                      <div className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary">
                        {form.currentAge}
                      </div>
                      <Link
                        href={`/member/${selfMember.id}`}
                        className="text-xs text-family-400 font-medium mt-1 inline-block"
                      >
                        From your birthday on file — not right?
                      </Link>
                    </div>
                  ) : (
                    <Field
                      label="Your current age"
                      value={form.currentAge}
                      onChange={(v) => set('currentAge', v)}
                      error={fieldErrors.currentAge}
                      onBlur={() => validateOnBlur('currentAge')}
                    />
                  )}
                  <Field
                    label="Target retirement age"
                    value={form.targetRetirementAge}
                    onChange={(v) => set('targetRetirementAge', v)}
                    error={fieldErrors.targetRetirementAge}
                    onBlur={() => validateOnBlur('targetRetirementAge')}
                  />
                </div>
                <Field
                  label="Pension balance"
                  value={form.pensionBalance}
                  onChange={(v) => set('pensionBalance', v)}
                  placeholder="0 if none"
                  prefix="£"
                  error={fieldErrors.pensionBalance}
                  onBlur={() => validateOnBlur('pensionBalance')}
                />
                <Field
                  label="Monthly pension contribution"
                  value={form.monthlyContribution}
                  onChange={(v) => set('monthlyContribution', v)}
                  placeholder="0 if none"
                  prefix="£"
                  error={fieldErrors.monthlyContribution}
                  onBlur={() => validateOnBlur('monthlyContribution')}
                />
                <Field
                  label="Target annual retirement income"
                  value={form.targetRetirementIncome}
                  onChange={(v) => set('targetRetirementIncome', v)}
                  prefix="£"
                  error={fieldErrors.targetRetirementIncome}
                  onBlur={() => validateOnBlur('targetRetirementIncome')}
                />
                {/* Already defaults sensibly to 5% — the one genuinely
                    jargon-y field in this wizard, so it only shows in
                    modes that opt into advanced detail (config.showAdvanced,
                    already false for adult/child/elderly modes), rather
                    than asking everyone to understand "growth rate." */}
                <IfAdvanced>
                  <Field
                    label="Assumed annual growth rate"
                    value={form.expectedAnnualGrowthPct}
                    onChange={(v) => set('expectedAnnualGrowthPct', v)}
                    suffix="%"
                    error={fieldErrors.expectedAnnualGrowthPct}
                    onBlur={() => validateOnBlur('expectedAnnualGrowthPct')}
                  />
                </IfAdvanced>
              </div>
            </GlassCard>
          )}

          {step.key === 'education' && (
            <GlassCard className="p-5">
              <SectionTitle>Education Funds</SectionTitle>
              <div className="space-y-4">
                {funds.map((f, i) => {
                  const rosterChildren = (family?.members ?? []).filter((m) => m.role === 'child')
                  const linkedMember = f.memberId
                    ? rosterChildren.find((m) => m.id === f.memberId)
                    : undefined
                  // Free text is the only option when the roster has no
                  // children yet, or once "Someone not listed yet" is chosen.
                  const showFreeTextName =
                    rosterChildren.length === 0 || (f.memberId === '' && !f.childName)
                  return (
                    <div
                      key={i}
                      className="rounded-2xl bg-tint/[0.02] border border-tint/[0.06] p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-ink-tertiary">
                          Child {i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeChild(i)}
                          aria-label="Remove child"
                          className="w-7 h-7 rounded-full flex items-center justify-center text-ink-tertiary active:opacity-60"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {rosterChildren.length > 0 && (
                        <label className="block">
                          <div className="text-xs text-ink-tertiary mb-1.5">Which child?</div>
                          <select
                            value={f.memberId}
                            onChange={(e) => handleChildMemberSelect(i, e.target.value)}
                            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all bg-transparent"
                          >
                            <option value="">Someone not listed yet</option>
                            {rosterChildren.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      {showFreeTextName && (
                        <label className="block">
                          <div className="text-xs text-ink-tertiary mb-1.5">Child's name</div>
                          <input
                            type="text"
                            value={f.childName}
                            onChange={(e) => updateChild(i, { childName: e.target.value })}
                            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                          />
                        </label>
                      )}

                      {linkedMember && !linkedMember.dateOfBirth && (
                        <label className="block">
                          <div className="text-xs text-ink-tertiary mb-1.5">
                            {linkedMember.name}&apos;s date of birth
                          </div>
                          <input
                            type="date"
                            max={new Date().toISOString().slice(0, 10)}
                            onBlur={(e) => handleChildDobChange(i, linkedMember.id, e.target.value)}
                            className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                          />
                          <p className="text-xs text-ink-tertiary mt-1.5">
                            Fills in age and years-until-university automatically.
                          </p>
                        </label>
                      )}

                      {linkedMember?.dateOfBirth ? (
                        <div className="rounded-xl bg-tint/[0.03] border border-tint/[0.06] px-4 py-3 text-sm text-ink-secondary">
                          {calculateAge(linkedMember.dateOfBirth)} years old,{' '}
                          {yearsUntil(linkedMember.dateOfBirth, 18)} years until 18 — from{' '}
                          {linkedMember.name}&apos;s birthday on file.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <Field
                            label="Child's age"
                            value={f.childAge}
                            onChange={(v) => updateChild(i, { childAge: v })}
                            error={fieldErrors[`fund.${i}.childAge`]}
                          />
                          <Field
                            label="Years until university"
                            value={f.yearsRemaining}
                            onChange={(v) => updateChild(i, { yearsRemaining: v })}
                            error={fieldErrors[`fund.${i}.yearsRemaining`]}
                          />
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <Field
                          label="Current savings"
                          value={f.currentSavings}
                          onChange={(v) => updateChild(i, { currentSavings: v })}
                          prefix="£"
                          error={fieldErrors[`fund.${i}.currentSavings`]}
                        />
                        <Field
                          label="Target amount"
                          value={f.targetSavings}
                          onChange={(v) => updateChild(i, { targetSavings: v })}
                          prefix="£"
                          error={fieldErrors[`fund.${i}.targetSavings`]}
                        />
                      </div>
                    </div>
                  )
                })}
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

      <div className="sticky bottom-[var(--app-dock-space)] desk:bottom-0 z-raised -mx-5 px-5 pt-3 pb-3 mt-2 flex gap-2 bg-navbg/90 backdrop-blur-xl border-t border-tint/[0.05] safe-area-bottom">
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
              {submitting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                'Save & Generate Insights'
              )}
            </GlassButton>
          ) : (
            <div>
              <GlassButton onClick={handleContinue} disabled={saving}>
                {saving ? <Loader2 size={18} className="animate-spin" /> : 'Continue'}
              </GlassButton>
              {/* The intro banner already claims "you can skip steps and
                  come back later" (Continue never actually blocks on
                  validation), but nothing made that visible on the least
                  time-critical step. Education Funds is the wizard's last
                  step, where "Save & Generate Insights" above already is
                  that same low-commitment action — a second "skip" link
                  next to a terminal submit button would be redundant, so
                  this only needs to exist here, on Retirement. */}
              {step.key === 'retirement' && (
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={saving}
                  className="w-full text-center text-xs text-ink-tertiary font-medium mt-2 py-1"
                >
                  Skip for now — I&apos;ll fill this in later
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
