import { Home, Briefcase, ShieldCheck, HeartPulse, Target, GraduationCap, House, TrendingUp, Landmark, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { FamilyMember } from './types'
import type { FinancialProfilePolicy, PolicyType } from './api'

// Duplicated from financial-profile/page.tsx rather than shared — this repo
// has no shared types package between call sites, matching the existing
// hand-mirrored-type convention elsewhere in apps/web.
const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  life: 'Life',
  income_protection: 'Income Protection',
  health: 'Health',
  critical_illness: 'Critical Illness',
  car: 'Car',
  home: 'Home',
}

const RENEWAL_WINDOW_DAYS = 60

// OAK-013: client-side mirror of family-financial-profile.ts's
// soonestPolicyRenewal — surfaces the same "days until renewal" data the
// policy_renewal_window detector already computes server-side, as a badge
// on the Protection story instead of leaving it uncomputed on the client.
function soonestRenewalWithinWindow(policies: FinancialProfilePolicy[]): number | null {
  const now = Date.now()
  let soonest: number | null = null
  for (const policy of policies) {
    if (!policy.renewal_date) continue
    const renewalMs = new Date(policy.renewal_date).getTime()
    if (Number.isNaN(renewalMs)) continue
    const days = Math.ceil((renewalMs - now) / 86_400_000)
    if (days < 0 || days > RENEWAL_WINDOW_DAYS) continue
    if (soonest === null || days < soonest) soonest = days
  }
  return soonest
}

export type GraphCategory = 'protection' | 'wealth' | 'goals' | 'family'

export interface MemberSection {
  id: string
  label: string
  icon: LucideIcon
  kind: 'asset' | 'category'
  navId?: string
  href?: string
  story?: string
  category: GraphCategory
}

export const CATEGORY_COLOR: Record<GraphCategory, string> = {
  family: '#7c6ef0',
  protection: '#f87171',
  wealth: '#fbbf24',
  goals: '#4ade80',
}

const BRANCH_ICONS: Record<string, LucideIcon> = {
  Briefcase,
  ShieldCheck,
  HeartPulse,
  Target,
  GraduationCap,
  Home,
}

const BRANCH_CATEGORY: Record<string, GraphCategory> = {
  Briefcase: 'wealth',
  ShieldCheck: 'protection',
  HeartPulse: 'protection',
  Target: 'goals',
  GraduationCap: 'goals',
  Home: 'wealth',
}

// Which Financial Profile step edits this branch's data — lets every
// category row link somewhere real instead of some rows being tappable
// (asset rows, which link to /asset/[id]) and others just sitting inert
// with no visual cue why, which read as an unexplained inconsistency.
const BRANCH_STEP: Record<string, string> = {
  Briefcase: 'household',
  ShieldCheck: 'household',
  HeartPulse: 'household',
  Target: 'retirement',
  GraduationCap: 'education',
}

const ASSET_ITEM_IDS: Record<string, string> = {
  Home: 'home',
  Investments: 'investments',
  Pension: 'pension',
}

const ASSET_ITEM_ICONS: Record<string, LucideIcon> = {
  Home: House,
  Investments: TrendingUp,
  Pension: Landmark,
}

export const ROLE_BRANCHES: Record<string, { label: string; icon: string; items: string[] }[]> = {
  organizer: [
    { label: 'Income', icon: 'Briefcase', items: ['Salary'] },
    { label: 'Protection', icon: 'ShieldCheck', items: ['Life Insurance', 'Health Insurance'] },
    { label: 'Assets', icon: 'Home', items: ['Home', 'Investments', 'Pension'] },
  ],
  parent: [
    { label: 'Career & Income', icon: 'Briefcase', items: ['Salary'] },
    { label: 'Health Cover', icon: 'HeartPulse', items: ['Medical', 'Dental'] },
    { label: 'Family Goals', icon: 'Target', items: ['Retirement', 'Education'] },
  ],
  adult: [
    { label: 'Income', icon: 'Briefcase', items: ['Salary'] },
    { label: 'Protection', icon: 'ShieldCheck', items: ['Health Insurance'] },
  ],
  child: [
    { label: 'Future', icon: 'GraduationCap', items: ['Education Fund', 'Future Goals'] },
  ],
}

/**
 * Flattens one family member's branches (custom, or the role default) into
 * the sections shown for them — asset sections link to a real /asset/[id]
 * page, category sections are informational only (no dedicated page exists
 * per category yet).
 *
 * `policies` (PRD-102) overrides the Protection branch's static
 * "Includes Life Insurance, Health Insurance" label with the household's
 * real policy data when any exists — an honest empty state (today's static
 * label, unchanged) when it doesn't, rather than a regression for
 * households that haven't filled the financial profile in yet.
 */
export function getMemberSections(member: FamilyMember, policies: FinancialProfilePolicy[] = []): MemberSection[] {
  const sections: MemberSection[] = []

  for (const branch of member.branches ?? ROLE_BRANCHES[member.role] ?? []) {
    const assetItems = branch.items.filter((item) => ASSET_ITEM_IDS[item])
    if (assetItems.length > 0) {
      for (const item of assetItems) {
        const assetId = ASSET_ITEM_IDS[item]!
        sections.push({
          id: `asset-${assetId}`,
          label: item,
          icon: ASSET_ITEM_ICONS[item] ?? Wallet,
          kind: 'asset',
          navId: assetId,
          category: 'wealth',
        })
      }
      continue
    }

    const cat = BRANCH_CATEGORY[branch.icon] ?? 'wealth'
    const isProtectionBranch = branch.icon === 'ShieldCheck'
    const renewalDays = isProtectionBranch ? soonestRenewalWithinWindow(policies) : null
    const story = isProtectionBranch && policies.length > 0
      ? `${policies.length} ${policies.length === 1 ? 'policy' : 'policies'}: ${[...new Set(policies.map((p) => POLICY_TYPE_LABELS[p.type]))].join(', ')}${renewalDays !== null ? ` · renews in ${renewalDays} ${renewalDays === 1 ? 'day' : 'days'}` : ''}`
      : `Includes ${branch.items.join(', ')}`
    const step = BRANCH_STEP[branch.icon]
    sections.push({
      id: `branch-${member.id}-${branch.label}`,
      label: branch.label,
      icon: BRANCH_ICONS[branch.icon] ?? Briefcase,
      kind: 'category',
      href: step ? `/financial-profile?step=${step}` : '/financial-profile',
      story,
      category: cat,
    })
  }

  return sections
}
