/**
 * Marketing spend ledger — what each channel cost, entered by an operator.
 *
 * There is no ad-platform API in this slice: spend is typed in monthly per
 * channel so CAC and payback are real rather than guessed. Platform-level
 * data (no tenant, no family content); every change is audited at the route.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'

export interface SpendEntry {
  id: string
  /** YYYY-MM the money was spent in. */
  month: string
  /** Same normalised token as utm_source (bluesky, linkedin, google …). */
  channel: string
  amount_pence: number
  note?: string
  created_by: string
  created_at: Date
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/
export const MAX_SPEND_PENCE = 100_000_000 // £1m — a typo guard, not a policy

export function validateSpend(input: {
  month: unknown
  channel: unknown
  amount_pence: unknown
}): string | null {
  if (typeof input.month !== 'string' || !MONTH_RE.test(input.month))
    return 'month must look like 2026-10'
  if (typeof input.channel !== 'string' || !CHANNEL_RE.test(input.channel))
    return 'channel must be a lowercase token such as bluesky, linkedin or google'
  const n = input.amount_pence
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_SPEND_PENCE)
    return 'amount_pence must be a whole number of pence between 1 and 100000000'
  return null
}

export function spendCol(db: Db) {
  return db.collection<SpendEntry>('marketing_spend')
}

export async function ensureMarketingSpendIndexes(db: Db): Promise<void> {
  await spendCol(db)
    .createIndex({ id: 1 }, { unique: true })
    .catch(() => {})
  await spendCol(db)
    .createIndex({ month: -1, channel: 1 })
    .catch(() => {})
}

export async function addSpend(
  db: Db,
  input: { month: string; channel: string; amount_pence: number; note?: string },
  by: string,
  now = new Date(),
): Promise<SpendEntry> {
  const entry: SpendEntry = {
    id: randomUUID(),
    month: input.month,
    channel: input.channel,
    amount_pence: input.amount_pence,
    ...(input.note ? { note: input.note.slice(0, 200) } : {}),
    created_by: by,
    created_at: now,
  }
  await spendCol(db).insertOne(entry)
  return entry
}

export async function listSpend(db: Db, limit = 200): Promise<SpendEntry[]> {
  return spendCol(db)
    .find({}, { projection: { _id: 0 } })
    .sort({ month: -1, created_at: -1 })
    .limit(limit)
    .toArray()
}

export async function deleteSpend(db: Db, id: string): Promise<SpendEntry | null> {
  const doc = await spendCol(db).findOneAndDelete({ id }, { projection: { _id: 0 } })
  return doc ?? null
}

const dayMs = 86_400_000

/**
 * Spend attributable to the window [start, end] (UTC days, inclusive), per
 * channel. A month's spend is spread evenly over its days, so a 30-day window
 * that clips two months takes the right share of each.
 */
export function spendInWindow(
  entries: Pick<SpendEntry, 'month' | 'channel' | 'amount_pence'>[],
  start: Date,
  end: Date,
): Map<string, number> {
  const out = new Map<string, number>()
  const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  for (const entry of entries) {
    const [y, m] = entry.month.split('-').map(Number) as [number, number]
    const first = Date.UTC(y, m - 1, 1)
    const last = Date.UTC(y, m, 0)
    const days = (last - first) / dayMs + 1
    const overlap = Math.min(e, last) - Math.max(s, first)
    if (overlap < 0) continue
    const share = (overlap / dayMs + 1) / days
    out.set(entry.channel, (out.get(entry.channel) ?? 0) + Math.round(entry.amount_pence * share))
  }
  return out
}
