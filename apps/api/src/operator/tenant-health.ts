import type { Db } from 'mongodb'

export interface HealthFactor {
  label: string
  points: number // negative = deduction
}

export interface TenantHealth {
  score: number // 0–100
  factors: HealthFactor[]
}

const FAILED_REMINDER_PTS = -10
const LOCKED_USER_PTS = -15
const EXPIRING_TOKEN_PTS = -20
const OPEN_CASE_PTS = -10
const STALE_PTS = -25
const STALE_DAYS = 14
const TOKEN_EXPIRY_HORIZON_MS = 7 * 24 * 60 * 60 * 1000

const cap = (pts: number, floor: number) => Math.max(pts, floor)

/**
 * Tenant health score — a transparent composite of operational signals the
 * operator console already tracks. Starts at 100, each observed problem
 * deducts a fixed amount (capped per signal so one bad queue can't zero a
 * tenant), and every deduction is listed verbatim in `factors` so the
 * score explains itself. Informational only — it ranks, it doesn't act.
 */
export async function computeTenantHealth(db: Db, tenantIds: string[]): Promise<Map<string, TenantHealth>> {
  const map = new Map<string, TenantHealth>()
  if (tenantIds.length === 0) return map

  const now = new Date()
  const staleHorizon = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000)
  const tokenHorizon = new Date(now.getTime() + TOKEN_EXPIRY_HORIZON_MS)

  const [failedReminders, lockedUsers, expiringTokens, openCases, recentLogins] = await Promise.all([
    db.collection('reminders').aggregate([
      { $match: { tenant_id: { $in: tenantIds }, status: 'failed' } },
      { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
    ]).toArray(),
    db.collection('users').aggregate([
      { $match: { tenant_id: { $in: tenantIds }, locked_until: { $gt: now } } },
      { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
    ]).toArray(),
    db.collection('connector_credentials').aggregate([
      { $match: { tenant_id: { $in: tenantIds }, token_expires_at: { $lt: tokenHorizon } } },
      { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
    ]).toArray(),
    db.collection('support_cases').aggregate([
      { $match: { tenant_id: { $in: tenantIds }, status: 'open' } },
      { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
    ]).toArray(),
    db.collection('login_events').aggregate([
      { $match: { tenant_id: { $in: tenantIds }, success: true, created_at: { $gte: staleHorizon } } },
      { $group: { _id: '$tenant_id' } },
    ]).toArray(),
  ])

  const counts = (rows: Record<string, unknown>[]) =>
    new Map(rows.map((r) => [r['_id'] as string, r['count'] as number]))
  const recentIds = new Set(recentLogins.map((r) => r['_id'] as string))

  const remindersCount = counts(failedReminders)
  const lockedCount = counts(lockedUsers)
  const tokenCount = counts(expiringTokens)
  const caseCount = counts(openCases)

  // Staleness only counts against tenants old enough to have had a chance
  // to return — a tenant created yesterday isn't "gone quiet".
  const ageRows = await db.collection('tenants')
    .find({ tenant_id: { $in: tenantIds }, created_at: { $lt: staleHorizon } }, { projection: { tenant_id: 1 } })
    .toArray()
  const staleEligible = new Set(ageRows.map((r) => r['tenant_id'] as string))

  for (const id of tenantIds) {
    const factors: HealthFactor[] = []

    const fr = remindersCount.get(id) ?? 0
    if (fr > 0) factors.push({ label: `${fr} failed reminder${fr === 1 ? '' : 's'}`, points: cap(fr * FAILED_REMINDER_PTS, -30) })
    const lu = lockedCount.get(id) ?? 0
    if (lu > 0) factors.push({ label: `${lu} locked user${lu === 1 ? '' : 's'}`, points: cap(lu * LOCKED_USER_PTS, -30) })
    const et = tokenCount.get(id) ?? 0
    if (et > 0) factors.push({ label: `${et} connector token${et === 1 ? '' : 's'} expiring within 7d`, points: cap(et * EXPIRING_TOKEN_PTS, -40) })
    const oc = caseCount.get(id) ?? 0
    if (oc > 0) factors.push({ label: `${oc} open support case${oc === 1 ? '' : 's'}`, points: cap(oc * OPEN_CASE_PTS, -30) })
    if (staleEligible.has(id) && !recentIds.has(id)) factors.push({ label: `No successful login in ${STALE_DAYS}d`, points: STALE_PTS })

    const score = Math.max(0, Math.min(100, 100 + factors.reduce((s, f) => s + f.points, 0)))
    map.set(id, { score, factors })
  }
  return map
}
