import type { LifeNode, LifeEvent, TimelineEvent, RiskArea } from './modes'

export const FAMILY_STORY =
  "You're on track. Your children's education is funded. Retirement is 81% complete. Emergency savings cover 14 months. Your family is protected."

export const FAMILY_HEALTH_SCORE = 92

export const LIFE_MAP: LifeNode = {
  id: 'family',
  label: 'Our Family',
  emoji: '',
  type: 'family',
  status: 'green',
  story: "Your family is well protected. There's one area to improve: retirement savings.",
  children: [
    {
      id: 'protection',
      label: 'Protection',
      emoji: '',
      type: 'category',
      status: 'green',
      progress: 90,
      story:
        'Your family is well protected. Life insurance, health insurance, and income protection are all in place.',
      children: [
        {
          id: 'life-insurance',
          label: 'Life Insurance',
          emoji: '',
          type: 'detail',
          status: 'green',
          progress: 100,
          story:
            'Your family would receive $750,000. That covers mortgage, education, and 5 years of living expenses.',
          explanation:
            'Think of this like a safety net. If something happens to you, your family receives $750,000. No jargon, no complicated terms — just peace of mind.',
        },
        {
          id: 'health-insurance',
          label: 'Health Insurance',
          emoji: '',
          type: 'detail',
          status: 'green',
          progress: 95,
          story: 'Full medical coverage for the whole family. Includes dental and vision.',
          explanation:
            'This means if anyone in your family gets sick, the insurance pays for most of the medical bills. You only pay a small amount.',
        },
        {
          id: 'income-protection',
          label: 'Income Protection',
          emoji: '',
          type: 'detail',
          status: 'green',
          progress: 85,
          story:
            "If you can't work due to illness or injury, you'd receive $5,000/month for 2 years.",
          explanation:
            "If you get sick or hurt and can't work, this pays you money every month — like a substitute paycheck.",
        },
      ],
    },
    {
      id: 'wealth',
      label: 'Wealth',
      emoji: '',
      type: 'category',
      status: 'yellow',
      progress: 65,
      story: 'Your wealth is growing steadily. Home value and investments are up 12% this year.',
      children: [
        {
          id: 'home',
          label: 'Home',
          emoji: '',
          type: 'detail',
          status: 'green',
          progress: 78,
          story:
            'Your home is worth $850,000. Mortgage is 22% paid off. On track to be mortgage-free in 12 years.',
          explanation:
            "You own a home worth $850,000. You still owe the bank some money, but you're paying it off steadily every month.",
        },
        {
          id: 'investments',
          label: 'Investments',
          emoji: '',
          type: 'detail',
          status: 'green',
          progress: 72,
          story: "Your investments grew 12% this year. That's $45,000 in gains.",
          explanation:
            "You put money into stocks and funds, and they've been growing. Think of it like planting seeds that are now trees.",
        },
        {
          id: 'pension',
          label: 'Pension',
          emoji: '',
          type: 'detail',
          status: 'yellow',
          progress: 55,
          story:
            'Pension is building up. Adding $300/month could keep you on track for retirement at 60.',
          explanation:
            "A pension is money you'll get every month when you stop working. You're building it up now, like filling a piggy bank for the future.",
        },
      ],
    },
    {
      id: 'goals',
      label: 'Goals',
      emoji: '',
      type: 'category',
      status: 'green',
      progress: 80,
      story: "Your children's education is 72% funded. You're ahead of schedule.",
      children: [
        {
          id: 'daughter-education',
          label: "Emma's University",
          emoji: '',
          type: 'detail',
          status: 'green',
          progress: 72,
          story: "Emma's university fund is 72% complete. She'll have $120,000 when she turns 18.",
          explanation:
            "You've been saving for Emma's university since she was born. You're almost there — just 28% to go.",
        },
        {
          id: 'son-education',
          label: "Lucas's University",
          emoji: '',
          type: 'detail',
          status: 'yellow',
          progress: 45,
          story: "Lucas's fund is 45% complete. Adding $200/month would keep you on track.",
          explanation:
            "You're saving for Lucas's university too. He's younger, so you have more time, but a little extra each month would help.",
        },
        {
          id: 'retirement',
          label: 'Retirement',
          emoji: '',
          type: 'detail',
          status: 'red',
          progress: 40,
          story: "You're close. Adding $250/month could keep you on track for retirement at 60.",
          explanation:
            "Retirement is when you stop working and enjoy life. You're saving for it, but you need to save a bit more to be completely comfortable.",
        },
      ],
    },
  ],
}

export const RISK_AREAS: RiskArea[] = [
  {
    id: 'protection',
    label: 'Protection',
    emoji: '',
    progress: 90,
    status: 'green',
    story: 'Your family is well protected.',
    detail: 'Life insurance, health insurance, and income protection are all active.',
  },
  {
    id: 'education',
    label: 'Education',
    emoji: '',
    progress: 60,
    status: 'yellow',
    story: "Emma's education is nearly funded. Lucas needs a bit more.",
    detail: "Emma's fund: 72% complete. Lucas's fund: 45% complete.",
  },
  {
    id: 'retirement',
    label: 'Retirement',
    emoji: '',
    progress: 40,
    status: 'red',
    story: "You're close. Adding $250/month could keep you on track.",
    detail: 'Current trajectory: retirement at 65. With $250/month more: retirement at 60.',
  },
  {
    id: 'emergency',
    label: 'Emergency Savings',
    emoji: '',
    progress: 85,
    status: 'green',
    story: 'Emergency savings cover 14 months of expenses.',
    detail: 'You have $55,000 saved. Average monthly expenses: $3,900.',
  },
]

export const LIFE_EVENTS: LifeEvent[] = [
  {
    id: 'bereavement',
    emoji: '',
    label: 'Family member passed away',
    category: 'protection',
    description: 'See exactly what happens and what to do',
  },
  {
    id: 'medical',
    emoji: '',
    label: 'Medical emergency',
    category: 'protection',
    description: 'Know your coverage before you need it',
  },
  {
    id: 'car',
    emoji: '',
    label: 'Car accident',
    category: 'protection',
    description: 'Your auto insurance explained simply',
  },
  {
    id: 'travel',
    emoji: '',
    label: 'Travel emergency',
    category: 'protection',
    description: 'Check your travel insurance coverage',
  },
  {
    id: 'property',
    emoji: '',
    label: 'Home damage',
    category: 'protection',
    description: 'What your home insurance covers',
  },
  {
    id: 'job-loss',
    emoji: '',
    label: 'Lost my job',
    category: 'wealth',
    description: 'See how long your savings last',
  },
  {
    id: 'new-child',
    emoji: '',
    label: 'New child',
    category: 'life',
    description: 'Plan for your growing family',
  },
  {
    id: 'marriage',
    emoji: '',
    label: 'Marriage',
    category: 'life',
    description: 'Merge your financial lives',
  },
  {
    id: 'university',
    emoji: '',
    label: 'University',
    category: 'goals',
    description: 'Education funding ready?',
  },
  {
    id: 'retirement',
    emoji: '',
    label: 'Retirement',
    category: 'goals',
    description: 'Are you ready to retire?',
  },
]

export const TIMELINE_EVENTS: TimelineEvent[] = [
  { id: 'now', emoji: '', label: 'Today', year: 2026, status: 'current' },
  { id: 'emma-uni', emoji: '', label: "Emma's University", year: 2032, status: 'future' },
  { id: 'mortgage-paid', emoji: '', label: 'Mortgage Paid Off', year: 2037, status: 'future' },
  { id: 'lucas-uni', emoji: '', label: "Lucas's University", year: 2035, status: 'future' },
  { id: 'retirement', emoji: '', label: 'Retirement', year: 2045, status: 'future' },
  { id: 'inheritance', emoji: '', label: 'Estate Planning', year: 2055, status: 'future' },
]

export const FAMILY_MEMBERS = [
  { id: 'dad', name: 'Dad', emoji: '', role: 'Organizer', status: 'green' as const },
  { id: 'mom', name: 'Mom', emoji: '', role: 'Parent', status: 'green' as const },
  { id: 'emma', name: 'Emma', emoji: '', role: 'Child', status: 'green' as const },
  { id: 'lucas', name: 'Lucas', emoji: '', role: 'Child', status: 'green' as const },
]

export const AI_SUGGESTIONS = [
  'Where is my travel insurance?',
  'What happens if I lose my job?',
  'Are my children fully protected?',
  'Can we retire at 55?',
  'What should my wife do if something happens to me?',
  "How much do we need for Emma's university?",
]

export const AI_RESPONSES: Record<string, string> = {
  'travel insurance':
    'Your travel insurance is with GlobalGuard Insurance. Policy #TR-2024-0042. It covers medical emergencies up to $500K, trip cancellation up to $10K, and lost baggage up to $3K. It expires in 18 days — would you like me to remind you to renew it before your trip?',
  'lose my job':
    "If you lose your job, your family is protected for 14 months. Here's the breakdown:\n\nEmergency savings: $55,000 (covers 14 months)\nIncome protection: $5,000/month for 2 years\nYour wife's salary covers basic expenses\n\nYou'd have enough time to find a new job without touching your investments or children's education funds.",
  'children protected':
    "Yes, your children are well protected!\n\n• Life insurance: $750,000 (covers their upbringing and education)\n• Emma's university fund: 72% complete ($120K target)\n• Lucas's university fund: 45% complete ($120K target)\n• Both have future goals insurance\n\nOne suggestion: consider adding critical illness coverage for Lucas. Would you like me to explain what that is?",
  'retire at 55':
    "You can retire at 55 with some adjustments!\n\nCurrent trajectory: retirement at 65\nWith $500/month more: retirement at 60\nWith $800/month more: retirement at 55\n\nAt 55, you'd have approximately $1.6M saved, giving you $64,000/year in retirement income. Your mortgage would be paid off by then too.\n\nWould you like me to show you how to adjust your savings?",
  'wife do':
    "If something happens to you, here's exactly what your wife should do, step by step:\n\n1. Call your life insurance provider (Policy #LI-2024-001) — she'll receive $750,000\n\n2. Contact your employer — survivor benefits of $200,000\n\n3. Call the pension provider — she'll get survivor pension payments\n\n4. The mortgage is protected — she won't need to pay it off\n\n5. Schedule a meeting with your financial advisor — everything is documented\n\nAll contact details are stored in your family profile. I can send these steps to her phone right now.",
  'emma university':
    "Emma's university fund is looking great!\n\nCurrent savings: $86,400 (72% of target)\nTarget: $120,000 (covers 4 years of university)\nMonthly contribution: $600\n\nAt this rate, you'll hit the target by 2030 — 2 years before she starts. You're ahead of schedule!\n\nWould you like to see a breakdown of how the money is invested?",
}

export const CHILD_GOALS = [
  {
    id: 'education',
    emoji: '',
    label: 'My Education',
    progress: 72,
    story: "You're doing great! Your university fund is 72% full!",
  },
  {
    id: 'savings',
    emoji: '',
    label: 'My Savings',
    progress: 45,
    story: 'Your piggy bank is growing! Keep it up!',
  },
  {
    id: 'achievements',
    emoji: '',
    label: 'My Achievements',
    progress: 80,
    story: "You've earned 8 badges this year!",
  },
  {
    id: 'dreams',
    emoji: '',
    label: 'My Dream Career',
    progress: 0,
    story: 'What do you want to be when you grow up?',
  },
]

export const CHILD_MESSAGES = [
  {
    id: '1',
    from: 'Dad',
    emoji: '',
    message: 'So proud of your grades this term!',
    time: '2h ago',
  },
  {
    id: '2',
    from: 'Mom',
    emoji: '',
    message: 'Your university fund is growing nicely!',
    time: '1d ago',
  },
]
