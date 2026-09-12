import type { Db } from 'mongodb'

export type QuotaResource = 'events' | 'workflows' | 'llm_tokens'

export class QuotaExceededError extends Error {
  readonly statusCode = 429
  constructor(public readonly resource: QuotaResource, public readonly used: number, public readonly limit: number) {
    super(`${resource} monthly quota exceeded`)
    this.name = 'QuotaExceededError'
  }
}

export async function enforceQuota(db: Db, tenantId: string, resource: QuotaResource, amount = 1): Promise<number> {
  const tenant = await db.collection('tenants').findOne({ $or: [{ tenant_id: tenantId }, { id: tenantId }] })
  if (!tenant || tenant['status'] === 'suspended') throw new Error('Tenant is not active')
  const limit = Number((tenant['quotas'] as Record<string, unknown> | undefined)?.[`${resource}_per_month`] ?? -1)
  const month = new Date().toISOString().slice(0, 7)
  const result = await db.collection('tenant_usage').findOneAndUpdate(
    { tenant_id: tenantId, month },
    { $inc: { [resource]: amount }, $setOnInsert: { tenant_id: tenantId, month, created_at: new Date() }, $set: { updated_at: new Date() } },
    { upsert: true, returnDocument: 'after' },
  )
  const used = Number(result?.[resource] ?? amount)
  if (limit >= 0 && used > limit) {
    await db.collection('tenant_usage').updateOne({ tenant_id: tenantId, month }, { $inc: { [resource]: -amount } })
    throw new QuotaExceededError(resource, used - amount, limit)
  }
  return used
}
