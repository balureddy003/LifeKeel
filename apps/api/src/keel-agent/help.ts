/**
 * Reviewed product help — what each part of LifeKeel does and how to use it.
 * Static text only: no family data, no model. Covered by advice-rule.test.ts,
 * so it describes the app and never recommends a financial product.
 */
import type { RouteKey } from './route-keys.js'

export interface HelpTopic {
  id: string
  title: string
  /** Route prefixes where this topic is "this page". */
  routes: string[]
  keywords: string[]
  summary: string
  steps: string[]
  route_key: RouteKey
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'financial-profile',
    title: 'Financial profile',
    routes: ['/financial-profile'],
    keywords: [
      'profile',
      'income',
      'salary',
      'expenses',
      'savings',
      'emergency fund',
      'pension',
      'retirement',
      'wizard',
    ],
    summary:
      'The financial profile is where your household records income, living expenses, savings, protection already in place, retirement and education goals. Keel reads it to show what is on file and where there may be gaps.',
    steps: [
      'Open Financial profile and work through the steps in order: Income & Household, Protection, Emergency Fund, Retirement, Education.',
      'Enter figures you know. Leave a field empty rather than guessing; Keel marks unknown values as unknown.',
      'Save each step. Your progress is kept, so you can finish later.',
    ],
    route_key: 'financial-profile.income',
  },
  {
    id: 'family',
    title: 'Family',
    routes: ['/family', '/member'],
    keywords: [
      'family',
      'member',
      'invite',
      'partner',
      'child',
      'children',
      'roster',
      'household',
      'add',
    ],
    summary:
      'The Family screen lists everyone in the household. The organizer can invite the other adult and add children. Each adult confirms their own details after joining.',
    steps: [
      'Open Family and choose to invite the other adult by email.',
      'Add each child with a date of birth so age-based checks can run.',
      'Each adult enters their own income and cover once they have joined.',
    ],
    route_key: 'family',
  },
  {
    id: 'documents',
    title: 'Documents',
    routes: ['/documents', '/upload'],
    keywords: ['document', 'upload', 'policy', 'will', 'scan', 'vault', 'pdf', 'file'],
    summary:
      'Documents lets you upload a policy or estate document. Keel reads it, shows what it found, and nothing is added to your profile until you review and confirm it.',
    steps: [
      'Open Upload and choose the file.',
      'Wait for the scan and reading to finish.',
      'Review each field Keel found, correct anything wrong, then confirm.',
    ],
    route_key: 'upload',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    routes: ['/settings'],
    keywords: ['notification', 'digest', 'alert', 'email', 'push', 'quiet', 'heartbeat', 'remind'],
    summary:
      'Notification settings control how often and how Keel contacts the household. Only the organizer can change them. Critical safety notices cannot be switched off.',
    steps: [
      'Open Settings and find Notifications.',
      'Choose between individual messages and a digest, and set the lowest urgency you want to hear about.',
      'Save. The organizer can change these at any time.',
    ],
    route_key: 'settings.notifications',
  },
  {
    id: 'security',
    title: 'Account security',
    routes: ['/security'],
    keywords: [
      'mfa',
      'two-step',
      '2fa',
      'authenticator',
      'password',
      'secure',
      'security',
      'sign-in',
    ],
    summary:
      'Two-step sign-in adds a code from an authenticator app when you sign in. Each person turns it on for their own account.',
    steps: [
      'Open Settings and find Security.',
      'Choose to turn on two-step sign-in and scan the code with an authenticator app.',
      'Store your recovery codes somewhere safe, away from this device.',
    ],
    route_key: 'settings.security',
  },
  {
    id: 'automation',
    title: 'Automation settings',
    routes: ['/settings/automation'],
    keywords: ['automation', 'auto', 'reminder', 'renewal', 'dry run', 'trust'],
    summary:
      'Automation settings are off by default. Renewal reminders and automatic runs only start if a household member turns them on, and anything involving money stays with a person.',
    steps: [
      'Open Settings, then Automation.',
      'Read what each switch does before turning it on.',
      'Switch it off again at any time; the change takes effect straight away.',
    ],
    route_key: 'settings.automation',
  },
  {
    id: 'readiness',
    title: 'Readiness score',
    routes: ['/readiness'],
    keywords: ['readiness', 'score', 'quiz'],
    summary:
      'The readiness score summarises how complete and protected the household looks from the information on file. It is separate from setup progress and is not advice.',
    steps: [
      'Open Readiness to see the score and what moved it.',
      'Add or correct information in your profile to refresh it.',
    ],
    route_key: 'readiness',
  },
  {
    id: 'insights',
    title: 'Insights and inbox',
    routes: ['/insights', '/inbox'],
    keywords: ['insight', 'inbox', 'gap', 'flag', 'notification feed', 'finding'],
    summary:
      'Insights are possible gaps Keel noticed from what is on file. Each one explains why it was flagged. They are information, and a licensed professional can help with decisions.',
    steps: [
      'Open Inbox to see current items.',
      'Open an item to see the reasoning and the records behind it.',
      'Dismiss it, or update your profile if the record is out of date.',
    ],
    route_key: 'inbox',
  },
  {
    id: 'legacy',
    title: 'Emergency contacts and legacy',
    routes: ['/legacy'],
    keywords: ['legacy', 'emergency contact', 'guardian', 'estate', 'will', 'trusted contact'],
    summary:
      'The legacy register records who to contact in an emergency and where key estate documents are. It records what the family declares; it does not confirm legal validity.',
    steps: [
      'Open Legacy and add a contact with their role.',
      'Note where each estate document is kept.',
      'Review it each year.',
    ],
    route_key: 'legacy',
  },
  {
    id: 'keel',
    title: 'What Keel can do',
    routes: [],
    keywords: ['what can keel', 'what do you do', 'what does keel', 'features', 'help', 'about'],
    summary:
      'Keel explains what is on file for your household, points out possible gaps, and guides your setup step by step. Keel does not give financial advice, and it never makes changes on its own; anything it suggests, you confirm.',
    steps: [
      'Ask "Where do I start?" for the next setup step.',
      'Ask about any page for a short explanation.',
      'Ask about your own figures for an answer based on your saved records.',
    ],
    route_key: 'family',
  },
]

export interface HelpMatch {
  topic: HelpTopic
  score: number
}

/** Best topic for a question; the page the user is on breaks ties. */
export function findHelp(query: string, route?: string): HelpMatch | null {
  const q = query.toLowerCase()
  let best: HelpMatch | null = null
  for (const topic of HELP_TOPICS) {
    let score = topic.keywords.filter((k) => q.includes(k)).length * 2
    if (route && topic.routes.some((r) => route.startsWith(r)))
      score += /\b(this|here|page)\b/.test(q) ? 3 : 1
    if (score > 0 && (!best || score > best.score)) best = { topic, score }
  }
  return best
}

export function renderHelp(topic: HelpTopic): string {
  const steps = topic.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  return `**${topic.title}**\n\n${topic.summary}\n\n${steps}`
}
