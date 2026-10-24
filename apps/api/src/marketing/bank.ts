/**
 * The content bank (standing approvals, step 1).
 *
 * A bank entry is one exact post text a named human has reviewed. Approving an entry is the same act as
 * approving a post in the weekly plan: the approver names the hash of the text they saw, the text must pass
 * the copy guard, and an entry that needs an image must have one. What differs is only *when* the post
 * goes out: the standing scheduler (marketing/standing.ts) later turns approved entries into scheduled posts
 * within limits the human set, and the existing publish path sends them. Nothing in this file publishes,
 * schedules or contacts a platform.
 *
 * An approved entry's text is immutable. To change it, retire it and add a new one, so the hash the human
 * approved is always the hash the scheduler checks.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { checkCopy, describeViolations, type CopyCheck } from './copy-guard.js'
import { contentHash } from './content-plan.js'
import { IMAGE_REQUIRED_CHANNELS } from './channels.js'
import type { CardSpec } from './cards.js'

/** How long a human's approval of an entry stays good. After this it is retired, not reused. */
export const BANK_ENTRY_TTL_DAYS = 90

export type BankStatus = 'candidate' | 'approved' | 'retired'
export type BankSource = 'plan_draft' | 'candidate_job' | 'manual'

export interface BankEntryDoc {
  id: string
  tenant_id: string
  content: string
  /** Hash of `content` at the time it was last written; approval must name this exact value. */
  content_hash: string
  /** Networks this text may go to. Length limits are checked at scheduling time. */
  channels: string[]
  format?: string | null
  hook?: string | null
  pillar?: string | null
  brief_id?: string | null
  /** Brand-card spec; the scheduler signs a card URL per scheduled post from it. */
  card?: CardSpec
  /** A fixed image URL, when the entry does not use a card. */
  media_url?: string
  alt_text?: string
  /** Claims-registry ids the text relies on, for drift checks. */
  claim_ids?: string[]
  /**
   * Where the post's link goes. The approved text holds LINK_TOKEN where the link belongs; each scheduled
   * post gets its own freshly tagged link there, so per-post attribution still works. The only variable
   * part of what is published is this link, and the approver sees the path.
   */
  link_path?: string
  /** UTM campaign for the link, for example `pillar_chart`. */
  campaign?: string
  status: BankStatus
  source: BankSource
  created_by: string
  created_at: Date
  approved_by?: string
  approved_at?: Date
  expires_at?: Date
  retired_by?: string
  retired_at?: Date
  retired_reason?: string
  last_scheduled_at?: Date
  times_scheduled: number
  copy_check?: CopyCheck
}

export function bankCollection(db: Db) {
  return db.collection<BankEntryDoc>('content_bank')
}

export function ensureBankIndexes(db: Db): void {
  const col = bankCollection(db)
  col.createIndex({ id: 1 }, { unique: true }).catch(() => {})
  col.createIndex({ tenant_id: 1, status: 1, expires_at: 1 }).catch(() => {})
}

/** True when an entry could be posted to a channel that cannot post without an image. */
export function entryHasImage(e: Pick<BankEntryDoc, 'card' | 'media_url'>): boolean {
  return Boolean(e.card || e.media_url)
}

/** Channels in the entry that need an image the entry does not have. */
export function channelsMissingImage(
  e: Pick<BankEntryDoc, 'channels' | 'card' | 'media_url'>,
): string[] {
  return entryHasImage(e) ? [] : e.channels.filter((c) => IMAGE_REQUIRED_CHANNELS.has(c))
}

export interface NewBankEntry {
  content: string
  channels: string[]
  format?: string | null
  hook?: string | null
  pillar?: string | null
  brief_id?: string | null
  card?: CardSpec
  media_url?: string
  alt_text?: string
  claim_ids?: string[]
  link_path?: string
  campaign?: string
  source: BankSource
}

/** The place in an approved text where each scheduled post's own tagged link goes. */
export const LINK_TOKEN = '{{link}}'

/** Fill LINK_TOKEN with a link ('' removes the token and the space before it). */
export function renderBankContent(content: string, link: string): string {
  if (!content.includes(LINK_TOKEN)) return content
  return link
    ? content.replace(LINK_TOKEN, link)
    : content.replace(new RegExp(`\\s*${LINK_TOKEN.replace(/[{}]/g, '\\$&')}`), '')
}

/**
 * Turn a published-style post into a template: swap the post's own tagged link for LINK_TOKEN and keep its
 * path and campaign. Returns the text unchanged (no path) when the post carries no link of its own.
 */
export function templatizeLink(
  content: string,
  postTag: string | undefined,
): { content: string; link_path?: string } {
  if (!postTag) return { content }
  const m = new RegExp(`https?://[^\\s]*utm_content=${postTag}[^\\s]*`).exec(content)
  if (!m) return { content }
  let path = '/'
  try {
    path = new URL(m[0]).pathname || '/'
  } catch {
    return { content }
  }
  return { content: content.replace(m[0], LINK_TOKEN), link_path: path }
}

/** Add a candidate. It is never usable until a human approves it. */
export async function addCandidate(
  db: Db,
  tenantId: string,
  createdBy: string,
  input: NewBankEntry,
  now = new Date(),
): Promise<BankEntryDoc> {
  const doc: BankEntryDoc = {
    id: randomUUID(),
    tenant_id: tenantId,
    content: input.content,
    content_hash: contentHash(input.content),
    channels: [...new Set(input.channels)],
    format: input.format ?? null,
    hook: input.hook ?? null,
    pillar: input.pillar ?? null,
    brief_id: input.brief_id ?? null,
    ...(input.card ? { card: input.card } : {}),
    ...(input.media_url ? { media_url: input.media_url } : {}),
    ...(input.alt_text ? { alt_text: input.alt_text } : {}),
    ...(input.claim_ids ? { claim_ids: input.claim_ids } : {}),
    ...(input.link_path ? { link_path: input.link_path } : {}),
    ...(input.campaign ? { campaign: input.campaign } : {}),
    status: 'candidate',
    source: input.source,
    created_by: createdBy,
    created_at: now,
    times_scheduled: 0,
    copy_check: checkCopy(input.content, 'social'),
  }
  await bankCollection(db).insertOne(doc)
  return doc
}

/** Edit a candidate's text. Approved entries are immutable by design. */
export async function editCandidate(
  db: Db,
  tenantId: string,
  id: string,
  content: string,
): Promise<'ok' | 'not_found' | 'not_a_candidate'> {
  const col = bankCollection(db)
  const existing = await col.findOne({ id, tenant_id: tenantId })
  if (!existing) return 'not_found'
  if (existing.status !== 'candidate') return 'not_a_candidate'
  await col.updateOne(
    { id, tenant_id: tenantId, status: 'candidate' },
    {
      $set: {
        content,
        content_hash: contentHash(content),
        copy_check: checkCopy(content, 'social'),
      },
    },
  )
  return 'ok'
}

export interface ApproveResult {
  id: string
  ok: boolean
  error?: string
}

/**
 * Approve candidates by the hash the reviewer saw. Each entry is checked on its own and refused with a
 * reason; one refusal never blocks the others.
 */
export async function approveEntries(
  db: Db,
  tenantId: string,
  userId: string,
  items: { id: string; content_hash: string }[],
  now = new Date(),
): Promise<ApproveResult[]> {
  const col = bankCollection(db)
  const results: ApproveResult[] = []
  for (const { id, content_hash: seen } of items) {
    const entry = await col.findOne({ id, tenant_id: tenantId, status: 'candidate' })
    if (!entry) {
      results.push({ id, ok: false, error: 'not_a_candidate' })
      continue
    }
    if (contentHash(entry.content) !== seen || entry.content_hash !== seen) {
      results.push({ id, ok: false, error: 'text_changed_since_review' })
      continue
    }
    const check = checkCopy(entry.content, 'social')
    if (!check.ok) {
      results.push({ id, ok: false, error: `copy_guard_failed: ${describeViolations(check)}` })
      continue
    }
    if (entry.channels.length === 0) {
      results.push({ id, ok: false, error: 'no_channels' })
      continue
    }
    const missing = channelsMissingImage(entry)
    if (missing.length > 0) {
      results.push({ id, ok: false, error: `image_required: ${missing.join(', ')}` })
      continue
    }
    const expires = new Date(now.getTime() + BANK_ENTRY_TTL_DAYS * 86_400_000)
    const claimed = await col.updateOne(
      { id, tenant_id: tenantId, status: 'candidate', content_hash: seen },
      {
        $set: {
          status: 'approved',
          approved_by: userId,
          approved_at: now,
          expires_at: expires,
          copy_check: check,
        },
      },
    )
    results.push(
      claimed.modifiedCount === 1 ? { id, ok: true } : { id, ok: false, error: 'already_decided' },
    )
  }
  return results
}

export async function retireEntry(
  db: Db,
  tenantId: string,
  id: string,
  userId: string,
  reason: string,
  now = new Date(),
): Promise<boolean> {
  const res = await bankCollection(db).updateOne(
    { id, tenant_id: tenantId, status: { $in: ['candidate', 'approved'] } },
    { $set: { status: 'retired', retired_by: userId, retired_at: now, retired_reason: reason } },
  )
  return res.modifiedCount === 1
}

export async function listEntries(
  db: Db,
  tenantId: string,
  status?: BankStatus,
): Promise<BankEntryDoc[]> {
  return bankCollection(db)
    .find({ tenant_id: tenantId, ...(status ? { status } : {}) })
    .sort({ created_at: -1 })
    .limit(500)
    .toArray()
}
