import type {
  FamilyMember,
  HealthCategory,
  LifeEvent,
  ResponseAction,
  MoneySource,
  ChatSuggestion,
} from './types'

export const FAMILY_HEALTH_SCORE = 92

export const HEALTH_CATEGORIES: HealthCategory[] = [
  { label: 'Protection', status: 'green' },
  { label: 'Wealth', status: 'yellow' },
  { label: 'Education', status: 'green' },
  { label: 'Health', status: 'green' },
  { label: 'Retirement', status: 'red' },
]

export const AI_SUMMARY_TEXT =
  "Your family is well protected. Increase retirement savings by $300/month. Travel insurance expires in 18 days. Daughter's education fund is 72% complete."

export const NOTIFICATION_COUNT = 3

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

export const LIFE_EVENTS: LifeEvent[] = [
  { id: 'bereavement', emoji: '', label: 'Family member passed away' },
  { id: 'medical', emoji: '', label: 'Medical emergency' },
  { id: 'car', emoji: '', label: 'Car accident' },
  { id: 'travel', emoji: '', label: 'Travel emergency' },
  { id: 'property', emoji: '', label: 'Property damage' },
  { id: 'job-loss', emoji: '', label: 'Lost my job' },
]

export const RESPONSE_ACTIONS: ResponseAction[] = [
  { id: 'life-insurance', label: 'Contact Life Insurance', done: true },
  { id: 'employer', label: 'Contact Employer', done: true },
  { id: 'pension', label: 'Pension Survivor Benefits', done: true },
  { id: 'mortgage', label: 'Mortgage Protection', done: true },
  { id: 'bank', label: 'Notify Bank', done: true },
]

export const MONEY_SOURCES: MoneySource[] = [
  { label: 'Life Insurance', emoji: '', amount: '$750,000' },
  { label: 'Employer Benefit', emoji: '', amount: '$200,000' },
  { label: 'Savings', emoji: '', amount: '$55,000' },
]

export const FINANCIAL_STABILITY_SCORE = 82

export const CHAT_SUGGESTIONS: ChatSuggestion[] = [
  { id: 'retire', label: 'Can we retire at 55?' },
  { id: 'second-home', label: 'Can we buy a second home?' },
  { id: 'job-loss', label: 'What happens if I lose my job?' },
  { id: 'children-protected', label: 'Are my children fully protected?' },
  { id: 'insurance-cover', label: 'Which insurance covers this situation?' },
  { id: 'sell-first', label: 'Should we sell investments or property first?' },
  { id: 'wife-action', label: 'What should my wife do if something happens to me?' },
]
