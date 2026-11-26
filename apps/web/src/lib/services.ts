/**
 * One entry per service. A service says, in one place, what it adds to Home
 * (a setup card and a pinned tile) and what it offers in an emergency (the
 * facts and who to call). Home, the pinned tiles and the steps page read this
 * list, so a new service is one entry here, not an edit in three files.
 *
 * Everything states what is on file or that nothing is; nothing estimates,
 * and nothing says whether it is enough. The advice-rule scan covers this file.
 */
import type { DomainView, FinancialProfile, LifeEventType } from './api'
import type { PinnedTile } from './pinned-tiles'
import { emergencyPolicies, POLICY_TYPE_LABEL } from './emergency-policies'
import { coverMonths } from './months'

export interface ServiceCtx {
  profile: FinancialProfile | null
  documentCount: number
  /** Family-list views by pack id, once loaded. A pack missing here has not loaded, so it shows nothing. */
  domains?: Record<string, DomainView | null | undefined>
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
  /** Which family-list pack the emergency section reads, and for which event, so the page loads it. */
  emergencyDomain?: { domainId: string; eventType: LifeEventType }
}

const gbp = (minor: number) => `£${Math.round(minor / 100).toLocaleString('en-GB')}`

export function runwayMonths(savingsMinor: number, monthlyCostsMinor: number): number | null {
  if (!(savingsMinor > 0) || !(monthlyCostsMinor > 0)) return null
  return savingsMinor / monthlyCostsMinor
}

const looksLikeNumber = (s: string) => (s.match(/\d/g)?.length ?? 0) >= 6

/**
 * A service whose emergency section is the policy rows of one family-list pack: the provider, and the
 * claims contact as a call button when it is a number, else as a fact. States what is on file only.
 */
function packCover(
  id: string,
  domainId: string,
  eventType: LifeEventType,
  heading: string,
  emptyText: string,
): ServiceDef {
  return {
    id,
    emergencyDomain: { domainId, eventType },
    emergency: (event, { domains }) => {
      const view = domains?.[domainId]
      if (event !== eventType || !view) return null
      const rows = view.rows.filter((r) => r.record === 'policy')
      return {
        heading,
        items: rows.map((r) => {
          const contact = (r.values['claims_contact'] ?? '').trim()
          const isNumber = looksLikeNumber(contact)
          return {
            key: r.id,
            kicker: view.pack?.records.find((x) => x.key === 'policy')?.label ?? 'Policy',
            title: r.values['provider']?.trim() || 'Policy on file',
            facts: [
              ...(contact && !isNumber ? [`Claims contact: ${contact}`] : []),
              ...(r.values['renewal_date'] ? [`Renews: ${r.values['renewal_date']}`] : []),
            ],
            phone: isNumber ? contact : undefined,
          }
        }),
        empty: { text: emptyText, href: `/domains?d=${domainId}`, label: 'Add a policy' },
      }
    },
  }
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
          href: eventType === 'property' ? '/policies/new?type=home' : '/policies/new',
          label: 'Add a policy',
        },
      }
    },
  },
  packCover(
    'car',
    'car',
    'car',
    'Your car cover on file',
    'No car policy is on your list yet. If you have one to hand, you can add it now.',
  ),
  packCover(
    'travel',
    'travel',
    'travel',
    'Your travel cover on file',
    'No travel policy is on your list yet. If you have one to hand, you can add it now.',
  ),
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
        value: months === null ? null : coverMonths(months),
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
