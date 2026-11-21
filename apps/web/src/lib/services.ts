/**
 * One entry per service. A service says, in one place, what it adds to Home
 * (a setup card and a pinned tile) and what it offers in an emergency (the
 * facts and who to call). Home, the pinned tiles and the steps page read this
 * list, so a new service is one entry here, not an edit in three files.
 *
 * Everything states what is on file or that nothing is; nothing estimates,
 * and nothing says whether it is enough. The advice-rule scan covers this file.
 */
import type { FinancialProfile, LifeEventType } from './api'
import type { PinnedTile } from './pinned-tiles'
import { emergencyPolicies, POLICY_TYPE_LABEL } from './emergency-policies'

export interface ServiceCtx {
  profile: FinancialProfile | null
  documentCount: number
}

export type SetupIcon = 'shield' | 'upload'

export interface SetupCardDef {
  id: string
  label: string
  description: string
  href: string
  icon: SetupIcon
  done: (ctx: ServiceCtx) => boolean
}

export interface AtHandItem {
  key: string
  kicker: string
  title: string
  facts: string[]
  phone?: string | undefined
  email?: string | undefined
}

export interface AtHandSection {
  heading: string
  items: AtHandItem[]
  empty: { text: string; href: string; label: string }
}

export interface ServiceDef {
  id: string
  setup?: SetupCardDef
  tile?: (ctx: ServiceCtx) => PinnedTile
  emergency?: (eventType: LifeEventType, ctx: ServiceCtx) => AtHandSection | null
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

export const SERVICES: ServiceDef[] = [
  {
    id: 'cover',
    setup: {
      id: 'policy',
      label: 'Add a policy',
      description: 'Life or income cover. One short form, and it checks the numbers as you type',
      href: '/policies/new',
      icon: 'shield',
      done: (c) => (c.profile?.policies?.length ?? 0) > 0,
    },
    tile: ({ profile }) => {
      const n = profile?.policies?.length ?? 0
      return {
        id: 'policies',
        title: 'Policies on file',
        value: n === 0 ? null : `${n}`,
        detail: n === 0 ? '' : n === 1 ? '1 policy recorded' : `${n} policies recorded`,
        emptyHint: 'Add the first policy',
        href: '/policies/new',
      }
    },
    emergency: (eventType, { profile }) => {
      const { applies, matches } = emergencyPolicies(eventType, profile?.policies)
      if (!applies) return null
      return {
        heading: 'Your cover on file',
        items: matches.map((p, i) => ({
          key: p.id ?? String(i),
          kicker: POLICY_TYPE_LABEL[p.type] ?? p.type,
          title: p.provider,
          facts: [
            ...(p.coverage_amount_minor > 0
              ? [`Cover on file: ${gbp(p.coverage_amount_minor)}`]
              : []),
            ...(p.policy_number ? [`Policy number: ${p.policy_number}`] : []),
          ],
          phone: p.contact_phone,
          email: p.contact_email,
        })),
        empty: {
          text: 'No matching policy is on your list yet. If you have one to hand, you can add it now.',
          href: '/policies/new',
          label: 'Add a policy',
        },
      }
    },
  },
  {
    id: 'documents',
    setup: {
      id: 'upload',
      label: 'Upload a document',
      description: 'Insurance policy, will, or bank statement',
      href: '/upload',
      icon: 'upload',
      done: (c) => c.documentCount > 0,
    },
  },
  {
    id: 'runway',
    tile: ({ profile }) => {
      const fund = profile?.emergency_fund
      const months = runwayMonths(
        fund?.emergency_savings_minor ?? 0,
        fund?.monthly_expenses_minor ?? 0,
      )
      return {
        id: 'runway',
        title: 'Savings and monthly costs',
        value: months === null ? null : monthsLabel(months),
        detail:
          months === null
            ? ''
            : `${gbp(fund!.emergency_savings_minor)} savings, ${gbp(fund!.monthly_expenses_minor)} a month in costs`,
        emptyHint: 'Add savings and monthly costs',
        href: '/financial-profile',
      }
    },
  },
  {
    id: 'pension',
    tile: ({ profile }) => {
      const pension = profile?.retirement?.pension_balance_minor ?? 0
      return {
        id: 'pension',
        title: 'Pension balance',
        value: pension > 0 ? gbp(pension) : null,
        detail: pension > 0 ? 'As entered in your list' : '',
        emptyHint: 'Add a pension balance',
        href: '/financial-profile',
      }
    },
  },
]

export function setupStepsFor(services: readonly ServiceDef[], ctx: ServiceCtx) {
  return services.flatMap((s) => (s.setup ? [{ ...s.setup, done: s.setup.done(ctx) }] : []))
}

export function tilesFor(services: readonly ServiceDef[], ctx: ServiceCtx): PinnedTile[] {
  return services.flatMap((s) => (s.tile ? [s.tile(ctx)] : []))
}

export function atHandFor(
  services: readonly ServiceDef[],
  eventType: LifeEventType,
  ctx: ServiceCtx,
): AtHandSection[] {
  return services.flatMap((s) => {
    const section = s.emergency?.(eventType, ctx)
    return section ? [section] : []
  })
}
