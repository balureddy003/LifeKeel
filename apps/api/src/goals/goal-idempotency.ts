import type { Db } from 'mongodb'

export const GOAL_CREATION_DEBOUNCE_MS = 5 * 60 * 1000

interface GoalCreationReservation<T> {
  tenant_id: string
  identity_key: string
  goal: T
  expires_at: Date
  updated_at: Date
}

export function buildGoalIdentityKey(goalTemplateId: string, vertical: string): string {
  return `${goalTemplateId.trim().toLowerCase()}::${vertical.trim().toLowerCase()}`
}

export async function findIdempotentGoal<T>(
  db: Db,
  tenantId: string,
  goalTemplateId: string,
  vertical: string,
  now = new Date(),
): Promise<T | null> {
  const reservation = await db.collection<GoalCreationReservation<T>>('goal_creation_idempotency').findOne({
    tenant_id: tenantId,
    identity_key: buildGoalIdentityKey(goalTemplateId, vertical),
    expires_at: { $gt: now },
  })
  return reservation?.goal ?? null
}

export async function createGoalIdempotently<T extends { id: string }>(
  db: Db,
  tenantId: string,
  goalTemplateId: string,
  vertical: string,
  candidate: T,
  now = new Date(),
): Promise<{ goal: T; created: boolean }> {
  const reservations = db.collection<GoalCreationReservation<T>>('goal_creation_idempotency')
  const identityKey = buildGoalIdentityKey(goalTemplateId, vertical)
  await Promise.all([
    reservations.createIndex({ tenant_id: 1, identity_key: 1 }, { unique: true }),
    reservations.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
  ])

  let reservation: GoalCreationReservation<T> | null = null
  try {
    reservation = await reservations.findOneAndUpdate(
      {
        tenant_id: tenantId,
        identity_key: identityKey,
        $or: [{ expires_at: { $lte: now } }, { expires_at: { $exists: false } }],
      },
      {
        $set: {
          tenant_id: tenantId,
          identity_key: identityKey,
          goal: candidate,
          expires_at: new Date(now.getTime() + GOAL_CREATION_DEBOUNCE_MS),
          updated_at: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 11000) throw error
  }

  if (!reservation) {
    reservation = await reservations.findOne({
      tenant_id: tenantId,
      identity_key: identityKey,
      expires_at: { $gt: now },
    })
  }
  if (!reservation) throw new Error('Goal idempotency reservation could not be acquired')

  const created = reservation.goal.id === candidate.id
  if (created) {
    await db.collection('goals').updateOne(
      { id: candidate.id, tenant_id: tenantId },
      { $setOnInsert: candidate },
      { upsert: true },
    )
  }
  return { goal: reservation.goal, created }
}
