import type { FamilyMember } from './types'

export const FAMILY_MEMBERS: FamilyMember[] = [
  {
    id: 'dad',
    name: 'Dad',
    role: 'Organizer',
    emoji: '',
    relation: 'owner',
    financialRole: 'Primary Income Provider',
    netWorth: '$1.3M',
    income: ['Salary $180K', 'Bonus', 'RSUs'],
    assets: ['Home', 'Investments', 'Pension', 'Vehicle'],
    protection: ['Life Insurance', 'Health Insurance', 'Income Protection'],
    responsibilities: ['Mortgage', 'Family Expenses', 'Education'],
    branches: [
      { label: 'Income', icon: 'Briefcase', items: ['Salary $180K', 'Bonus', 'RSUs'] },
      { label: 'Protection', icon: 'ShieldCheck', items: ['Life Insurance', 'Health Insurance', 'Income Protection'] },
      { label: 'Assets', icon: 'Home', items: ['Home', 'Investments', 'Pension', 'Vehicle'] },
    ],
  },
  {
    id: 'mom',
    name: 'Mom',
    role: 'Parent',
    emoji: '',
    relation: 'spouse',
    branches: [
      { label: 'Career & Income', icon: 'Briefcase', items: ['Salary'] },
      { label: 'Health Cover', icon: 'HeartPulse', items: ['Medical', 'Dental'] },
      { label: 'Family Goals', icon: 'Target', items: ['Retirement', 'Travel', 'Education'] },
    ],
  },
  {
    id: 'emma',
    name: 'Emma',
    role: 'Child',
    emoji: '',
    relation: 'child',
    branches: [
      { label: 'Future', icon: 'GraduationCap', items: ['Education Fund', 'Trust', 'Future Goals', 'Insurance'] },
    ],
  },
  {
    id: 'lucas',
    name: 'Lucas',
    role: 'Child',
    emoji: '',
    relation: 'child',
    branches: [
      { label: 'Future', icon: 'GraduationCap', items: ['Education Fund', 'Trust', 'Future Goals', 'Insurance'] },
    ],
  },
]
