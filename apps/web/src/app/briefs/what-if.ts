import type { BriefInputs } from '@/lib/api'

/**
 * "What if" exploration on a finished brief. The sliders move the household's
 * own entered figures; the answer is recalculated by the same solver through
 * the preview endpoint. Nothing here is saved.
 */
export type SliderKey =
  'new_income_minor' | 'new_essentials_minor' | 'monthly_essentials_minor' | 'liquid_savings_minor'

export interface Slider {
  key: SliderKey
  label: string
  /** The household's entered value, in pence. */
  base: number
  min: number
  max: number
  step: number
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

function slider(key: SliderKey, label: string, base: number, scale: number): Slider | null {
  const reference = base > 0 ? base : scale
  if (reference <= 0) return null
  const min = base > 0 ? Math.round(base * 0.5) : 0
  const max = base > 0 ? Math.round(base * 1.5) : reference
  const range = max - min
  // £10 steps for small ranges, £50 for large ones, so a slider never has hundreds of stops.
  const step = range > 1_000_000 ? 5_000 : 1_000
  return { key, label, base, min, max, step }
}

/** The figures a household can reasonably play with, given what this brief holds. */
export function whatIfSliders(inputs: BriefInputs): Slider[] {
  const income = num(inputs.monthly_income_minor) ?? 0
  const out: Array<Slider | null> = []
  const newIncome = num(inputs.new_income_minor)
  if (newIncome !== undefined)
    out.push(slider('new_income_minor', 'Money coming in after the change', newIncome, income))
  const newSpend = num(inputs.new_essentials_minor)
  const spend = num(inputs.monthly_essentials_minor)
  if (newSpend !== undefined)
    out.push(
      slider('new_essentials_minor', 'Money going out after the change', newSpend, spend ?? 0),
    )
  else if (spend !== undefined)
    out.push(slider('monthly_essentials_minor', 'Money going out each month', spend, 0))
  const savings = num(inputs.liquid_savings_minor)
  if (savings !== undefined)
    out.push(slider('liquid_savings_minor', 'Savings you could use now', savings, 0))
  return out.filter((s): s is Slider => s !== null)
}

export function applyWhatIf(
  inputs: BriefInputs,
  changes: Partial<Record<SliderKey, number>>,
): BriefInputs {
  return { ...inputs, ...changes }
}

/** True when any slider differs from the household's entered figure. */
export function hasChanged(sliders: Slider[], values: Partial<Record<SliderKey, number>>): boolean {
  return sliders.some((s) => values[s.key] !== undefined && values[s.key] !== s.base)
}

/** Whole days from `today` to `date` (negative if it has passed). */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000)
}

/** A plain-words countdown for the "at a glance" card. */
export function countdownText(days: number): string {
  if (days === 0) return 'starts today'
  if (days === 1) return 'starts tomorrow'
  if (days > 1) return `starts in ${days} days`
  if (days === -1) return 'started yesterday'
  return `started ${Math.abs(days)} days ago`
}
