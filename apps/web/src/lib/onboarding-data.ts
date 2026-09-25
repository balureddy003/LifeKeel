export interface OnboardingAnswer {
  questionId: string
  question: string
  answer: string
}

export interface FamilyMemberDraft {
  id: string
  emoji: string
  name: string
  role: string
  completion: number
}

export interface OnboardingState {
  step: number
  members: FamilyMemberDraft[]
  country: string
  hasHouse: boolean
  hasMortgage: boolean
  employment: string
  married: boolean
  hasChildren: boolean
  answers: OnboardingAnswer[]
}

export interface OnboardingQuestion {
  id: string
  question: string
  hint: string
  type: 'text' | 'choice' | 'boolean' | 'multi-text'
  choices?: string[]
  followUp?: string
  graphUpdate?: (answer: string) => Partial<OnboardingState>
}

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: 'name',
    question: "What's your name?",
    hint: 'This is how the AI will address you',
    type: 'text',
  },
  {
    id: 'email',
    question: "What's your email? In case you ever need to get back in.",
    hint: 'We only use this for account recovery',
    type: 'text',
  },
  {
    id: 'married',
    question: 'Are you married or in a partnership?',
    hint: 'This helps us understand your family structure',
    type: 'boolean',
    choices: ['Yes, married', 'Yes, partnered', 'No, single'],
  },
  {
    id: 'spouse-name',
    question: "What's your partner's name?",
    hint: 'They\'ll be added to your family graph',
    type: 'text',
    followUp: 'married',
  },
  {
    id: 'children',
    question: 'Do you have children?',
    hint: 'We\'ll add them to your family graph',
    type: 'boolean',
    choices: ['Yes', 'No'],
  },
  {
    id: 'children-names',
    question: "What are your children's names?",
    hint: 'Add each child — they\'ll get their own profile',
    type: 'multi-text',
    followUp: 'children',
  },
]

// Country, home ownership, mortgage, and employment used to be asked here
// too, but the answers were only ever held in local state and discarded —
// nothing downstream ever read them. Real financial context now belongs in
// the Financial Profile, which actually powers detectors and insights;
// asking for it twice (once for nothing, once for real) was the tax.

export interface TrustLadderStep {
  id: string
  emoji: string
  label: string
  description: string
  timeframe: string
  status: 'done' | 'available' | 'locked'
  action: string
}

export const TRUST_LADDER: TrustLadderStep[] = [
  {
    id: 'family',
    emoji: '👨‍👩‍👧',
    label: 'Add Your Family',
    description: 'Tell us who\'s in your household',
    timeframe: 'Day 1',
    status: 'done',
    action: 'Completed',
  },
  {
    id: 'documents',
    emoji: '📄',
    label: 'Upload Documents',
    description: 'Snap a photo or upload any financial document',
    timeframe: 'Week 1',
    status: 'available',
    action: 'Upload Now',
  },
  {
    id: 'bank',
    emoji: '🏦',
    label: 'Connect Bank',
    description: 'Securely connect your bank accounts',
    timeframe: 'Week 2',
    status: 'locked',
    action: 'Connect',
  },
  {
    id: 'email',
    emoji: '📧',
    label: 'Connect Email',
    description: 'AI scans for financial documents only',
    timeframe: 'Week 3',
    status: 'locked',
    action: 'Connect',
  },
  {
    id: 'investments',
    emoji: '📈',
    label: 'Connect Investments',
    description: 'Link your investment and pension accounts',
    timeframe: 'Month 2',
    status: 'locked',
    action: 'Connect',
  },
  {
    id: 'estate',
    emoji: '⚖️',
    label: 'Estate Planning',
    description: 'Connect your lawyer for will and estate docs',
    timeframe: 'Month 3',
    status: 'locked',
    action: 'Connect',
  },
]

export interface InboxItem {
  id: string
  emoji: string
  source: string
  subject: string
  aiSummary: string
  actionLabel: string
  actionType: 'review' | 'renew' | 'compare' | 'update' | 'info'
  priority: 'high' | 'medium' | 'low'
  date: string
  read: boolean
  /** Messages in the conversation this item stands for (email items). */
  threadCount?: number
  /** Where the action button goes (Oak-generated recommendations). */
  route?: string
  /** Policy facts the source email stated. */
  policy?: { provider?: string; type?: string; policyNumber?: string; coverAmount?: number; currency?: string; monthlyPremium?: number; renewalDate?: string }
}

export const INBOX_ITEMS: InboxItem[] = [
  {
    id: '1',
    emoji: '🏠',
    source: 'AllState Insurance',
    subject: 'Home insurance renewal notice',
    aiSummary: 'Your home insurance renews next month. The premium increased by 12%. Based on your coverage, it may be worth comparing alternatives.',
    actionLabel: 'Compare alternatives',
    actionType: 'compare',
    priority: 'high',
    date: '2h ago',
    read: false,
  },
  {
    id: '2',
    emoji: '🏦',
    source: 'First National Bank',
    subject: 'Mortgage rate change notification',
    aiSummary: 'Your mortgage rate will adjust from 3.2% to 3.8% in 60 days. This increases your monthly payment by $180. Consider locking in a fixed rate.',
    actionLabel: 'Review options',
    actionType: 'review',
    priority: 'high',
    date: '5h ago',
    read: false,
  },
  {
    id: '3',
    emoji: '💰',
    source: 'Vanguard',
    subject: 'Quarterly investment statement',
    aiSummary: 'Your investments grew 4.2% this quarter — that\'s $15,600 in gains. Your portfolio is well diversified. No action needed.',
    actionLabel: 'View details',
    actionType: 'info',
    priority: 'low',
    date: '1d ago',
    read: false,
  },
  {
    id: '4',
    emoji: '✈️',
    source: 'GlobalGuard Insurance',
    subject: 'Travel insurance expires in 18 days',
    aiSummary: 'Your travel insurance expires before your upcoming trip. I recommend renewing it now to stay covered.',
    actionLabel: 'Renew now',
    actionType: 'renew',
    priority: 'high',
    date: '2d ago',
    read: false,
  },
  {
    id: '5',
    emoji: '💳',
    source: 'Chase',
    subject: 'Credit card statement',
    aiSummary: 'Your monthly spending was $3,240 — 8% lower than last month. Good progress! Your rewards points earned: 1,240.',
    actionLabel: 'View breakdown',
    actionType: 'info',
    priority: 'low',
    date: '3d ago',
    read: true,
  },
  {
    id: '6',
    emoji: '🚗',
    source: 'DMV',
    subject: 'Vehicle tax reminder',
    aiSummary: 'Your vehicle tax is due in 2 weeks. The amount is $340. I can set up a reminder for you.',
    actionLabel: 'Set reminder',
    actionType: 'update',
    priority: 'medium',
    date: '4d ago',
    read: true,
  },
]

export interface MemoryPrompt {
  id: string
  emoji: string
  title: string
  message: string
  actionLabel: string
  dismissible: boolean
}

export const MEMORY_PROMPTS: MemoryPrompt[] = [
  {
    id: 'car',
    emoji: '🚗',
    title: 'I noticed something new',
    message: 'I see a new vehicle in your transactions. Would you like to add insurance and update your family profile?',
    actionLabel: 'Add vehicle',
    dismissible: true,
  },
  {
    id: 'pension',
    emoji: '🏦',
    title: 'We found a pension statement',
    message: 'I found a pension document in your uploads. Should I add it to your retirement planning?',
    actionLabel: 'Review',
    dismissible: true,
  },
  {
    id: 'completion',
    emoji: '⚠️',
    title: 'Your profile is 81% complete',
    message: 'Add your pension details and travel insurance to reach 100%. This helps me give you better advice.',
    actionLabel: 'Complete now',
    dismissible: true,
  },
]

export interface ConfidenceArea {
  id: string
  label: string
  emoji: string
  status: 'complete' | 'partial' | 'missing'
  progress: number
  missingItems?: string[]
}

export const CONFIDENCE_AREAS: ConfidenceArea[] = [
  {
    id: 'family',
    label: 'Family',
    emoji: '👨‍👩‍👧‍👦',
    status: 'complete',
    progress: 100,
  },
  {
    id: 'protection',
    label: 'Protection',
    emoji: '❤️',
    status: 'partial',
    progress: 75,
    missingItems: ['Travel insurance', 'Critical illness coverage'],
  },
  {
    id: 'wealth',
    label: 'Wealth',
    emoji: '💰',
    status: 'partial',
    progress: 60,
    missingItems: ['Pension details', 'Investment account'],
  },
  {
    id: 'goals',
    label: 'Goals',
    emoji: '🎯',
    status: 'complete',
    progress: 90,
  },
  {
    id: 'documents',
    label: 'Documents',
    emoji: '📄',
    status: 'partial',
    progress: 40,
    missingItems: ['Will', 'Tax returns', 'Insurance policies'],
  },
  {
    id: 'estate',
    label: 'Estate Planning',
    emoji: '⚖️',
    status: 'missing',
    progress: 0,
    missingItems: ['Not started'],
  },
]

export const OVERALL_CONFIDENCE = 81
