export interface FamilyMember {
  id: string
  name: string
  role: string
  emoji: string
  relation: 'owner' | 'spouse' | 'child'
  financialRole?: string
  netWorth?: string
  income?: string[]
  assets?: string[]
  protection?: string[]
  responsibilities?: string[]
  branches?: FamilyBranch[]
}

export interface FamilyBranch {
  label: string
  icon: string
  items: string[]
}
