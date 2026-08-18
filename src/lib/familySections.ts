import { Home, Briefcase, ShieldCheck, HeartPulse, Target, GraduationCap, House, TrendingUp, Landmark, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { FamilyMember } from './types'

export type GraphCategory = 'protection' | 'wealth' | 'goals' | 'family'

export interface MemberSection {
  id: string
  label: string
  icon: LucideIcon
  kind: 'asset' | 'category'
  navId?: string
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
 */
export function getMemberSections(member: FamilyMember): MemberSection[] {
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
    sections.push({
      id: `branch-${member.id}-${branch.label}`,
      label: branch.label,
      icon: BRANCH_ICONS[branch.icon] ?? Briefcase,
      kind: 'category',
      story: `Includes ${branch.items.join(', ')}`,
      category: cat,
    })
  }

  return sections
}
