/**
 * Content plan (PRD-210, phase 3): pillar briefs, content items and the weekly plan.
 *
 * A **brief** is a short, pre-checked set of facts on one of the story's pillars. A **content item**
 * is one brief placed on one slot of a week; its **variants** are the per-network draft posts.
 * Planning only ever creates drafts (Tier 0). Nothing is published until a person approves the week
 * (routes/marketing-plan.ts), and the existing cron sweep dispatches approved posts at their time.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import type { LlmFn } from '@lifekeel/platform'
import { checkCopy } from './copy-guard.js'
import {
  draftPostText,
  learningContextBlock,
  siteLink,
  type MarketingPostDoc,
} from '../routes/marketing-posts.js'

export const PILLARS = ['chart', 'hard_day', 'cover_on_file', 'your_data', 'guides'] as const
export type Pillar = (typeof PILLARS)[number]

export interface Brief {
  id: string
  pillar: Pillar
  title: string
  /** The only facts the draft may use. Every one is a live claim; a test runs them through the copy guard. */
  facts: string
  /** Where the post's link goes. */
  path: string
}

export const BRIEFS: Brief[] = [
  { id: 'chart-1', pillar: 'chart', title: 'The chart', path: '/signup',
    facts: "LifeKeel keeps a family's chart: what you hold on file across savings, cover and papers, what looks missing, and the steps if something happens. Free to start, no credit card." },
  { id: 'chart-2', pillar: 'chart', title: 'One home for the picture', path: '/signup',
    facts: "Savings, cover and papers usually live in different places. LifeKeel puts what you tell it in one place and shows what is on file and what is missing. A roster covers the whole family." },
  { id: 'hard-day-1', pillar: 'hard_day', title: 'A hard day', path: '/signup',
    facts: "If something happens, the first problem is finding the papers. LifeKeel has steps for seven kinds of bad day, built from what you have already entered." },
  { id: 'hard-day-2', pillar: 'hard_day', title: 'If you go quiet', path: '/signup',
    facts: "You can name people LifeKeel emails if you go quiet. Nothing is sent unless you switched it on or approve it." },
  { id: 'cover-1', pillar: 'cover_on_file', title: 'Cover on file', path: '/signup',
    facts: "LifeKeel shows the life, income and health cover you have on file against a rough household estimate, and where the picture looks light. It makes no product recommendations." },
  { id: 'cover-2', pillar: 'cover_on_file', title: 'Renewals and duplicates', path: '/signup',
    facts: "From the policies you enter, LifeKeel lists upcoming renewals and spots duplicate policies for the same person. It names no insurer and ranks no policy." },
  { id: 'cover-3', pillar: 'cover_on_file', title: 'How to claim', path: '/signup',
    facts: "A plain how-to-claim guide for each kind of policy, so the steps are written down before anyone needs them." },
  { id: 'runway-1', pillar: 'chart', title: 'Savings runway', path: '/signup',
    facts: "LifeKeel works out how many months your savings would last from the figures you enter, today and at a date you choose. Informational only." },
  { id: 'data-1', pillar: 'your_data', title: 'Your data', path: '/signup',
    facts: "Your details are never sold. You can export your data or delete your account yourself from Settings." },
  { id: 'data-2', pillar: 'your_data', title: 'What LifeKeel will not do', path: '/signup',
    facts: "LifeKeel never moves money or buys anything for you, takes no commissions, and names no insurer. Nothing leaves LifeKeel for you unless you approve it." },
  { id: 'guides-1', pillar: 'guides', title: 'The guides', path: '/guides',
    facts: "LifeKeel's guides explain, in plain words, the checks a family should know about, from emergency funds to education savings. Informational only, not financial advice." },
  { id: 'plus-1', pillar: 'guides', title: 'Keel Plus', path: '/signup',
    facts: "Free to start, no credit card. Keel Plus is £7.99 a month and can be cancelled; it reads policy details from an uploaded policy for you to confirm." },
]

/** Monday, Wednesday and Friday at 09:00 UTC. */
export const SLOT_DAYS = [0, 2, 4] as const
export const SLOT_HOUR_UTC = 9

export interface ContentItemDoc {
  id: string
  tenant_id: string
  week_key: string
  slot: number
  pillar: Pillar
  brief_id: string
  title: string
  scheduled_at: Date
  status: 'planned' | 'skipped'
  created_by: string
  created_at: Date
}

export function isMonday(key: string): boolean {
  const d = new Date(`${key}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(d.getTime()) && d.getUTCDay() === 1
}

/** The Monday on or after `from`, as YYYY-MM-DD (UTC). */
export function nextMondayKey(from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const add = (8 - d.getUTCDay()) % 7
  d.setUTCDate(d.getUTCDate() + add)
  return d.toISOString().slice(0, 10)
}

export function slotTime(weekKey: string, slot: number): Date {
  const d = new Date(`${weekKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + SLOT_DAYS[slot]!)
  d.setUTCHours(SLOT_HOUR_UTC)
  return d
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** Choose a brief for each slot: the least-used briefs first, a different pillar per slot where possible. */
export function pickBriefs(usage: Map<string, number>, slots = SLOT_DAYS.length): Brief[] {
  const chosen: Brief[] = []
  const usedPillars = new Set<Pillar>()
  const order = (a: Brief, b: Brief) =>
    (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0) || BRIEFS.indexOf(a) - BRIEFS.indexOf(b)
  for (let i = 0; i < slots; i++) {
    const pool = BRIEFS.filter((b) => !chosen.includes(b)).sort(order)
    const fresh = pool.find((b) => !usedPillars.has(b.pillar)) ?? pool[0]
    if (!fresh) break
    chosen.push(fresh)
    usedPillars.add(fresh.pillar)
  }
  return chosen
}

export interface PlanWeekResult {
  week_key: string
  created_items: number
  created_posts: number
}

/** Create the week's content items and one draft post per network. Idempotent: a slot that already
 *  has an item for the week is left alone. Drafts only; failing copy is flagged, not hidden. */
export async function planWeek(
  db: Db,
  tenantId: string,
  weekKey: string,
  channels: string[],
  llm: LlmFn,
  createdBy: string,
): Promise<PlanWeekResult> {
  const items = db.collection<ContentItemDoc>('content_items')
  const posts = db.collection<MarketingPostDoc>('marketing_posts')
  const history = await items.find({ tenant_id: tenantId }).toArray()
  const usage = new Map<string, number>()
  for (const h of history) usage.set(h.brief_id, (usage.get(h.brief_id) ?? 0) + 1)
  const existingSlots = new Set(history.filter((h) => h.week_key === weekKey).map((h) => h.slot))

  const briefs = pickBriefs(usage)
  let createdItems = 0
  let createdPosts = 0
  for (let slot = 0; slot < briefs.length; slot++) {
    if (existingSlots.has(slot)) continue
    const brief = briefs[slot]!
    const when = slotTime(weekKey, slot)
    const item: ContentItemDoc = {
      id: randomUUID(),
      tenant_id: tenantId,
      week_key: weekKey,
      slot,
      pillar: brief.pillar,
      brief_id: brief.id,
      title: brief.title,
      scheduled_at: when,
      status: 'planned',
      created_by: createdBy,
      created_at: new Date(),
    }
    await items.insertOne(item)
    createdItems++
    for (const channel of channels) {
      const link = siteLink(channel, brief.path, brief.id, `pillar_${brief.pillar}`)
      const sourceBlock = `Topic: ${brief.title}\nFacts you may use (use nothing else):\n${brief.facts}${link ? `\nLink to include verbatim: ${link}` : ''}`
      const learning = await learningContextBlock(db, tenantId, channel)
      const { content, generated } = await draftPostText(llm, channel, sourceBlock, link, learning)
      await posts.insertOne({
        id: randomUUID(),
        tenant_id: tenantId,
        channel,
        integration_id: `${channel}:connection`,
        content,
        campaign: `pillar_${brief.pillar}`,
        scheduled_at: when,
        state: 'draft',
        generated,
        copy_check: checkCopy(content, 'social'),
        content_item_id: item.id,
        pillar: brief.pillar,
        created_by: createdBy,
        created_at: new Date(),
      } as MarketingPostDoc)
      createdPosts++
    }
  }
  return { week_key: weekKey, created_items: createdItems, created_posts: createdPosts }
}

/** Cron helper: make sure next week has a plan. Returns how many posts it drafted. */
export async function ensureNextWeekPlanned(
  db: Db,
  tenantId: string,
  channels: string[],
  llm: LlmFn,
  now = new Date(),
): Promise<number> {
  if (channels.length === 0) return 0
  const weekKey = nextMondayKey(new Date(now.getTime() + 24 * 3600_000))
  const r = await planWeek(db, tenantId, weekKey, channels, llm, 'daily-generator')
  return r.created_posts
}

/** Daily cron: for each opted-in tenant (the same flag as the daily blog drafts) with an active
 *  connection, make sure next week has a plan. Drafts only. Returns posts drafted. */
export async function ensureWeeklyPlans(db: Db, llmFor: (tenantId: string) => LlmFn, now = new Date()): Promise<number> {
  const optedIn = (await db.collection('tenant_settings').find({}).toArray()).filter(
    (d) => (d['automation'] as Record<string, unknown> | undefined)?.['daily_marketing_drafts_enabled'] === true,
  )
  let drafted = 0
  for (const s of optedIn) {
    const tenantId = s['tenant_id'] as string
    const channels = (await db.collection('social_connections').find({ tenant_id: tenantId, status: 'active' }).toArray()).map(
      (c) => c['channel'] as string,
    )
    drafted += await ensureNextWeekPlanned(db, tenantId, channels, llmFor(tenantId), now)
  }
  return drafted
}
