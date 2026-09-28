'use client'

/**
 * PRD-132: the scenario card generalized beyond job-loss. Each life event
 * with a defensible projection template gets a "what if" surface — an
 * earner's income stopping (bereavement), stopping then returning
 * (disability, the multi-step timeline), a temporary cost spike
 * (medical), a new ongoing cost (new-child), or a savings-pace check on
 * a child's fund (university). Events without a template keep their
 * static readiness card.
 *
 * All math is server-side (`/family/scenarios/preview`); this card only
 * chooses inputs and narrates the returned numbers.
 */

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Trash2 } from 'lucide-react'
import { GlassCard, GlassButton, Money, MoneyText } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import {
  fetchFamilyGroup,
  fetchFamilyScenarios,
  fetchFinancialProfile,
  previewScenario,
  saveFamilyScenario,
  deleteFamilyScenario,
  type FamilyScenario,
  type FinancialProfile,
  type ScenarioInputs,
  type ScenarioResult,
} from '@/lib/api'

function gbp(minor: number): string {
  return `£${Math.round(minor / 100).toLocaleString('en-GB')}`
}

interface EarnerOption {
  /** null = the organizer's salary (household-level income). */
  memberId: string | null
  name: string
  monthlySalaryMinor: number
}

interface Selections {
  earner: EarnerOption | null
  amountMinor: number
  horizonMonths: number
  childName: string | null
}

interface ScenarioTemplate {
  title: string
  /** Which selectors the card renders. */
  earners?: boolean
  /** Whole-£/month chips for a cost or savings amount. */
  amounts?: number[]
  /** "In N months" chips. */
  horizons?: number[]
  /** Education-fund target picker. */
  child?: boolean
  build: (sel: Selections, ctx: { totalIncomeMinor: number }) => { inputs: ScenarioInputs; name: string } | null
  /** One honest sentence for the preview result. */
  narrate: (result: ScenarioResult, sel: Selections) => string
}

const HORIZONS = [0, 3, 6, 12]
const MEDICAL_AMOUNTS = [50_000, 100_000, 200_000]
const CHILD_AMOUNTS = [80_000, 120_000, 180_000]
const SAVINGS_AMOUNTS = [20_000, 40_000, 80_000]
const DISABILITY_MONTHS = 12
const MEDICAL_MONTHS = 12

function runwayLine(result: ScenarioResult): string {
  return result.projectedRunwayMonths === null
    ? 'income would still cover expenses'
    : `savings would cover about ${result.projectedRunwayMonths} months of spending`
}

const SCENARIO_TEMPLATES: Record<string, ScenarioTemplate> = {
  'job-loss': {
    title: 'If it happened later',
    horizons: HORIZONS,
    build: ({ horizonMonths }, { totalIncomeMinor }) => ({
      inputs: { monthlyIncomeDeltaMinor: -totalIncomeMinor, monthsUntilChange: horizonMonths },
      name: horizonMonths === 0 ? 'Job loss starting now' : `Job loss in ${horizonMonths} months`,
    }),
    narrate: (r, { horizonMonths }) =>
      horizonMonths > 0
        ? `If your household income stopped in ${horizonMonths} months, savings would reach about ${gbp(r.savingsAtChangeMinor)} by then — ${runwayLine(r)}.`
        : `If income stopped now, ${runwayLine(r)}.`,
  },
  bereavement: {
    title: 'If one income stopped',
    earners: true,
    build: ({ earner }) =>
      earner
        ? {
            inputs: { steps: [{ atMonth: 0, monthlyIncomeDeltaMinor: -earner.monthlySalaryMinor }] },
            name: `If ${earner.name}'s income stopped`,
          }
        : null,
    narrate: (r, { earner }) =>
      `Without ${earner?.name ?? 'that'}'s income, ${runwayLine(r)} — life cover and survivor benefits are what change this picture.`,
  },
  disability: {
    title: 'If someone couldn’t work for a year',
    earners: true,
    build: ({ earner }) =>
      earner
        ? {
            inputs: {
              steps: [
                { atMonth: 0, monthlyIncomeDeltaMinor: -earner.monthlySalaryMinor },
                { atMonth: DISABILITY_MONTHS, monthlyIncomeDeltaMinor: earner.monthlySalaryMinor },
              ],
            },
            name: `${earner.name} unable to work for ${DISABILITY_MONTHS} months`,
          }
        : null,
    narrate: (r, { earner }) => {
      if (r.fundDepletedAtMonth !== null) {
        return `${earner?.name ?? 'Their'}'s income pauses for a year — but the emergency fund would run out around month ${r.fundDepletedAtMonth}, before they're back. Income protection cover is what fills that gap.`
      }
      const dip = r.timeline?.[r.timeline.length - 1]
      return `${earner?.name ?? 'Their'}'s income pauses for a year — savings would dip to about ${gbp(r.savingsAtChangeMinor)} by the time they're back, ${dip?.runwayMonths == null ? 'with the remaining income covering costs' : `leaving roughly ${dip.runwayMonths} months of cover`}.`
    },
  },
  medical: {
    title: 'If treatment costs piled up for a year',
    amounts: MEDICAL_AMOUNTS,
    build: ({ amountMinor }) => ({
      inputs: {
        steps: [
          { atMonth: 0, monthlyExpenseDeltaMinor: amountMinor },
          { atMonth: MEDICAL_MONTHS, monthlyExpenseDeltaMinor: -amountMinor },
        ],
      },
      name: `Extra medical costs of ${gbp(amountMinor)}/mo for ${MEDICAL_MONTHS} months`,
    }),
    narrate: (r, { amountMinor }) => {
      if (r.fundDepletedAtMonth !== null) {
        return `An extra ${gbp(amountMinor)}/mo for a year would drain the emergency fund around month ${r.fundDepletedAtMonth} — before the costs stop.`
      }
      return `A year of extra costs would leave savings at about ${gbp(r.savingsAtChangeMinor)} when they settle — ${runwayLine(r)}.`
    },
  },
  'new-child': {
    title: 'When the baby arrives',
    amounts: CHILD_AMOUNTS,
    horizons: [0, 3, 6, 9],
    build: ({ amountMinor, horizonMonths }) => ({
      inputs: { steps: [{ atMonth: horizonMonths, monthlyExpenseDeltaMinor: amountMinor }] },
      name: `New child: ${gbp(amountMinor)}/mo starting ${horizonMonths === 0 ? 'now' : `in ${horizonMonths} months`}`,
    }),
    narrate: (r, { horizonMonths }) => {
      const point = r.timeline?.[0]
      return horizonMonths > 0
        ? `By the time costs step up in ${horizonMonths} months, savings would be about ${gbp(point?.savingsMinor ?? r.savingsAtChangeMinor)} — and the new monthly total would ${point?.runwayMonths == null ? 'still be covered by income' : `leave roughly ${point.runwayMonths} months of runway`}.`
        : `With the new costs starting now, ${runwayLine(r)}.`
    },
  },
  university: {
    title: 'Saving for the fund',
    child: true,
    amounts: SAVINGS_AMOUNTS,
    build: ({ amountMinor, childName }) =>
      childName
        ? {
            inputs: { monthlyExtraSavingsMinor: amountMinor, targetChildName: childName },
            name: `Save ${gbp(amountMinor)}/mo toward ${childName}'s fund`,
          }
        : null,
    narrate: (r) => {
      const p = r.educationFundProjection
      if (!p) return 'Set an amount and pick a fund to see the projection.'
      if (p.projectedMonthsToTarget === null) return 'That pace can’t be projected — try an amount.'
      const years = Math.floor(p.projectedMonthsToTarget / 12)
      const months = p.projectedMonthsToTarget % 12
      const pace = years > 0 ? `${years}y ${months}m` : `${months} months`
      return p.onTrack
        ? `At that pace ${p.childName}'s fund reaches its target in about ${pace} — inside the ${p.yearsRemaining}-year window.`
        : `At that pace ${p.childName}'s fund needs about ${pace} — beyond the ${p.yearsRemaining}-year window. A higher monthly amount or a lower target closes it.`
    },
  },
}

export function eventHasScenario(eventId: string): boolean {
  return eventId in SCENARIO_TEMPLATES
}

function chipRow<T>(options: readonly T[], selected: T, label: (v: T) => string, onPick: (v: T) => void) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((v) => (
        <button
          key={String(v)}
          onClick={() => { haptic('light'); onPick(v) }}
          aria-pressed={selected === v}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            selected === v
              ? 'bg-family-500/20 text-family-400 border border-family-500/40'
              : 'bg-tint/5 text-ink-tertiary border border-tint/10'
          }`}
        >
          {label(v)}
        </button>
      ))}
    </div>
  )
}

export default function EventScenarioCard({ eventId }: { eventId: string }) {
  const template = SCENARIO_TEMPLATES[eventId]
  const [profile, setProfile] = useState<FinancialProfile | null>(null)
  const [earners, setEarners] = useState<EarnerOption[]>([])
  const [children, setChildren] = useState<string[]>([])
  const [earnerIdx, setEarnerIdx] = useState(0)
  const [amountIdx, setAmountIdx] = useState(1)
  const [horizon, setHorizon] = useState(6)
  const [childIdx, setChildIdx] = useState(0)
  const [result, setResult] = useState<ScenarioResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState<FamilyScenario[]>([])
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([fetchFinancialProfile(), fetchFamilyGroup()]).then(([p, family]) => {
      if (cancelled || !p) return
      setProfile(p)
      const byId = new Map((family?.members ?? []).map((m) => [m.id, m]))
      const organizerName = (family?.members ?? []).find((m) => m.role === 'organizer')?.name ?? 'You'
      const list: EarnerOption[] = []
      if (p.household.monthly_salary_minor > 0) {
        list.push({ memberId: null, name: organizerName, monthlySalaryMinor: p.household.monthly_salary_minor })
      }
      for (const m of p.household.members ?? []) {
        if (m.monthly_salary_minor > 0) {
          list.push({ memberId: m.member_id, name: byId.get(m.member_id)?.name ?? 'Family member', monthlySalaryMinor: m.monthly_salary_minor })
        }
      }
      setEarners(list)
      setChildren((p.education_funds ?? []).map((f) => f.child_name).filter((n): n is string => Boolean(n)))
    })
    void fetchFamilyScenarios().then((s) => { if (!cancelled) setSaved(s) })
    return () => { cancelled = true }
  }, [])

  const totalIncomeMinor = profile
    ? profile.household.monthly_salary_minor + (profile.household.members ?? []).reduce((s, m) => s + m.monthly_salary_minor, 0)
    : 0

  const sel: Selections = {
    earner: earners[earnerIdx] ?? earners[0] ?? null,
    amountMinor: template?.amounts?.[amountIdx] ?? template?.amounts?.[0] ?? 0,
    horizonMonths: horizon,
    childName: children[childIdx] ?? children[0] ?? null,
  }
  const built = template?.build(sel, { totalIncomeMinor }) ?? null

  useEffect(() => {
    if (!built) { setResult(null); return }
    let cancelled = false
    setLoading(true)
    setJustSaved(false)
    previewScenario(built.inputs).then((r) => {
      if (cancelled) return
      setResult(r?.result ?? null)
      setLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earnerIdx, amountIdx, horizon, childIdx, earners.length, children.length, totalIncomeMinor])

  if (!template || !profile) return null
  if (template.earners && earners.length === 0) return null
  if (template.child && children.length === 0) return null
  if (eventId === 'job-loss' && totalIncomeMinor <= 0) return null

  const handleSave = async () => {
    if (!built) return
    haptic('light')
    const s = await saveFamilyScenario(built.name, built.inputs)
    if (s) {
      setSaved((prev) => [s, ...prev])
      setJustSaved(true)
      haptic('success')
    }
  }

  const handleDelete = async (id: string) => {
    haptic('light')
    if (await deleteFamilyScenario(id)) setSaved((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <GlassCard className="p-5">
      <span className="text-sm font-semibold text-ink-secondary">{template.title}</span>

      <div className="space-y-3 mt-3">
        {template.earners && (
          <div>
            <div className="text-xs text-ink-tertiary mb-1.5">Whose income?</div>
            {chipRow(earners.map((_, i) => i), earnerIdx, (i) => earners[i]?.name ?? '', setEarnerIdx)}
          </div>
        )}
        {template.amounts && (
          <div>
            <div className="text-xs text-ink-tertiary mb-1.5">{eventId === 'university' ? 'Monthly amount' : 'Rough monthly cost'}</div>
            {chipRow(template.amounts.map((_, i) => i), amountIdx, (i) => gbp(template.amounts![i]!), setAmountIdx)}
          </div>
        )}
        {template.child && (
          <div>
            <div className="text-xs text-ink-tertiary mb-1.5">Whose fund?</div>
            {chipRow(children.map((_, i) => i), childIdx, (i) => children[i] ?? '', setChildIdx)}
          </div>
        )}
        {template.horizons && (
          <div>
            {template.horizons === HORIZONS && <div className="text-xs text-ink-tertiary mb-1.5">When?</div>}
            {chipRow([...template.horizons], horizon, (m) => (m === 0 ? 'Now' : `${m} mo`), setHorizon)}
          </div>
        )}
      </div>

      <div className="mt-3 min-h-[3rem]">
        {loading ? (
          <Loader2 size={16} className="animate-spin text-ink-tertiary mt-2" />
        ) : result ? (
          <div className="space-y-2">
            <MoneyText text={template.narrate(result, sel)} className="text-sm text-ink-secondary leading-relaxed" />
            {result.timeline && result.timeline.length > 1 && (
              <div className="flex items-center gap-1.5 text-xs text-ink-tertiary flex-wrap">
                {result.timeline.map((p, i) => (
                  <span key={p.atMonth} className="flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden>→</span>}
                    <span>
                      mo {p.atMonth}: <Money value={gbp(p.savingsMinor)} />
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-tertiary">Couldn’t project this right now — try again in a moment.</p>
        )}
      </div>

      {result && !justSaved && built && (
        <GlassButton variant="secondary" onClick={handleSave}>
          <span>Save this scenario</span>
        </GlassButton>
      )}
      {justSaved && (
        <p className="text-xs text-success mt-2 flex items-center gap-1.5">
          <CheckCircle2 size={12} /> Saved — it stays updated as your numbers change
        </p>
      )}

      {saved.length > 0 && (
        <div className="mt-4 pt-3 border-t border-tint/10 space-y-1.5">
          <span className="text-xs font-semibold text-ink-tertiary">Saved scenarios</span>
          {saved.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2">
              <span className="text-xs text-ink-secondary truncate">{s.name}</span>
              <span className="text-xs text-ink-tertiary whitespace-nowrap">
                {s.result?.projectedRunwayMonths != null
                  ? `${s.result.projectedRunwayMonths} mo runway`
                  : s.result?.fundDepletedAtMonth != null
                    ? `fund out at mo ${s.result.fundDepletedAtMonth}`
                    : '—'}
              </span>
              <button
                onClick={() => handleDelete(s.id)}
                aria-label={`Delete ${s.name}`}
                className="text-xs text-ink-tertiary hover:text-danger transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}
