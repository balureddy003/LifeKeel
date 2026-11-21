/**
 * Pinned tiles on home, in the style of Apple Health's Summary: each tile shows
 * one figure from the household's own file, or says plainly that it has no data
 * and what would fill it. Nothing is estimated or invented; every line states
 * what is on file.
 */
import type { FinancialProfile } from './api'

export interface PinnedTile {
  id: 'runway' | 'policies' | 'pension'
  title: string
  /** null = nothing on file yet. */
  value: string | null
  detail: string
  /** What fills an empty tile. */
  emptyHint: string
  href: string
}

const gbp = (minor: number) => `£${Math.round(minor / 100).toLocaleString('en-GB')}`

export function runwayMonths(savingsMinor: number, monthlyCostsMinor: number): number | null {
  if (!(savingsMinor > 0) || !(monthlyCostsMinor > 0)) return null
  return savingsMinor / monthlyCostsMinor
}

function monthsLabel(m: number): string {
  const rounded = m < 10 ? Math.round(m * 10) / 10 : Math.round(m)
  return `${rounded} ${rounded === 1 ? 'month' : 'months'}`
}

export function pinnedTiles(profile: FinancialProfile | null): PinnedTile[] {
  const fund = profile?.emergency_fund
  const months = runwayMonths(fund?.emergency_savings_minor ?? 0, fund?.monthly_expenses_minor ?? 0)
  const policies = profile?.policies ?? []
  const pension = profile?.retirement?.pension_balance_minor ?? 0

  return [
    {
      id: 'runway',
      title: 'Savings and monthly costs',
      value: months === null ? null : monthsLabel(months),
      detail:
        months === null
          ? ''
          : `${gbp(fund!.emergency_savings_minor)} savings, ${gbp(fund!.monthly_expenses_minor)} a month in costs`,
      emptyHint: 'Add savings and monthly costs',
      href: '/financial-profile',
    },
    {
      id: 'policies',
      title: 'Policies on file',
      value: policies.length === 0 ? null : `${policies.length}`,
      detail:
        policies.length === 0
          ? ''
          : policies.length === 1
            ? '1 policy recorded'
            : `${policies.length} policies recorded`,
      emptyHint: 'Add the first policy',
      href: '/policies/new',
    },
    {
      id: 'pension',
      title: 'Pension balance',
      value: pension > 0 ? gbp(pension) : null,
      detail: pension > 0 ? 'As entered in your list' : '',
      emptyHint: 'Add a pension balance',
      href: '/financial-profile',
    },
  ]
}
