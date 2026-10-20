/**
 * PRD-139 against a real MongoDB: tier caps, the monthly budget, exemptions,
 * recorded drops, the ask-first digest-only offer, and DeliveryRouter.deliver()
 * actually using the budget.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  BUDGET,
  decideSend,
  droppedByReason,
  maybeOfferDigestOnly,
  recordSent,
  type SendRequest,
} from '../notification-budget.js'
import { DeliveryRouter } from '../delivery-router.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const T = 't1'
const DAY = 86_400_000
const at = (iso: string) => new Date(`${iso}T09:00:00Z`)

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('budget-test')
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const alert = (key: string, now: Date, extra: Partial<SendRequest> = {}): SendRequest => ({
  tenantId: T,
  tier: 'A',
  kind: 'insight_alert',
  key,
  now,
  ...extra,
})
const ledger = () => db.collection('notification_ledger').find({}).sort({ at: 1 }).toArray()

/** Decide, and record the send when allowed, as the router does. */
async function send(req: SendRequest) {
  const d = await decideSend(db, req)
  if (d.allow) await recordSent(db, req)
  return d
}

describe('tier A cap', () => {
  it('allows one change alert per 14 days and records the drop with its reason', async () => {
    expect((await send(alert('i1', at('2026-10-01')))).allow).toBe(true)
    const second = await send(alert('i2', at('2026-10-10')))
    expect(second).toEqual({ allow: false, reason: 'tier_a_cap' })
    expect((await ledger()).filter((r) => r['outcome'] === 'dropped')).toEqual([
      expect.objectContaining({ key: 'i2', reason: 'tier_a_cap', tier: 'A' }),
    ])
    expect((await send(alert('i3', at('2026-10-16')))).allow).toBe(true)
  })

  it('a failed send does not use up the budget', async () => {
    expect((await decideSend(db, alert('i1', at('2026-10-01')))).allow).toBe(true) // never recorded
    expect((await decideSend(db, alert('i2', at('2026-10-02')))).allow).toBe(true)
  })
})

describe('exemptions', () => {
  it('critical, dated-obligation, safety and human-release messages are never capped, and do not use the budget', async () => {
    await send(alert('i1', at('2026-10-01')))
    await send(alert('i2', at('2026-10-20'))) // second of the month: budget now full
    for (const exempt of ['critical', 'dated_obligation', 'safety', 'human_release'] as const) {
      const d = await send(alert(`x-${exempt}`, at('2026-10-21'), { exempt }))
      expect(d).toEqual({ allow: true, exempt })
    }
    const exemptRows = (await ledger()).filter((r) => r['outcome'] === 'exempt')
    expect(exemptRows).toHaveLength(4)
    expect(exemptRows.every((r) => typeof r['reason'] === 'string')).toBe(true)
    // ...and a normal alert is still held back by the budget, not by the exempt ones.
    const next = await send(alert('i3', at('2026-10-25')))
    expect(next.allow).toBe(false)
  })

  it('the digest is exempt and counted for visibility only', async () => {
    const req: SendRequest = {
      tenantId: T,
      tier: 'B',
      kind: 'quiet_care_digest',
      now: at('2026-10-01'),
    }
    expect((await send(req)).allow).toBe(true)
    expect((await ledger())[0]).toMatchObject({ tier: 'B', outcome: 'exempt' })
    expect((await send(alert('i1', at('2026-10-02')))).allow).toBe(true)
  })
})

describe('monthly budget and tier C', () => {
  it('holds a third non-digest message in a month, and resets next month', async () => {
    await send(alert('i1', at('2026-10-01')))
    await send(alert('i2', at('2026-10-20')))
    const c = await send({
      tenantId: T,
      tier: 'C',
      kind: 'data_needed',
      key: 'retirement:age',
      now: at('2026-10-22'),
    })
    expect(c).toEqual({ allow: false, reason: 'monthly_budget' })
    const nov = await send({
      tenantId: T,
      tier: 'C',
      kind: 'data_needed',
      key: 'retirement:age',
      now: at('2026-11-02'),
    })
    expect(nov.allow).toBe(true)
  })

  it('tier C: never the same input twice in a quarter, and at most two a quarter', async () => {
    const c = (key: string, iso: string): SendRequest => ({
      tenantId: T,
      tier: 'C',
      kind: 'data_needed',
      key,
      now: at(iso),
    })
    expect((await send(c('a', '2026-10-01'))).allow).toBe(true)
    expect(await send(c('a', '2026-11-05'))).toEqual({ allow: false, reason: 'tier_c_repeat' })
    expect((await send(c('b', '2026-11-06'))).allow).toBe(true)
    expect(await send(c('c', '2026-12-10'))).toEqual({ allow: false, reason: 'tier_c_cap' })
    expect((await send(c('c', '2027-01-10'))).allow).toBe(true) // new quarter
  })

  it('tier D is in-app only and never sent outbound', async () => {
    const d = await send({ tenantId: T, tier: 'D', kind: 'life_event', now: at('2026-10-01') })
    expect(d).toEqual({ allow: false, reason: 'tier_d_in_app_only' })
  })

  it('summarises drops by reason across families, for the operator view', async () => {
    await db.collection('notification_ledger').insertMany([
      {
        tenant_id: 'a',
        tier: 'A',
        kind: 'x',
        outcome: 'dropped',
        reason: 'tier_a_cap',
        at: at('2026-10-01'),
      },
      {
        tenant_id: 'b',
        tier: 'A',
        kind: 'x',
        outcome: 'dropped',
        reason: 'tier_a_cap',
        at: at('2026-10-02'),
      },
      {
        tenant_id: 'b',
        tier: 'C',
        kind: 'x',
        outcome: 'dropped',
        reason: 'monthly_budget',
        at: at('2026-10-02'),
      },
      {
        tenant_id: 'a',
        tier: 'A',
        kind: 'x',
        outcome: 'dropped',
        reason: 'tier_a_cap',
        at: at('2025-01-01'),
      },
    ])
    expect(await droppedByReason(db, at('2026-09-01'))).toEqual({
      by_reason: { tier_a_cap: 2, monthly_budget: 1 },
      families: 2,
    })
  })
})

describe('ask-first digest-only offer', () => {
  const sentAlerts = async (...keys: string[]) => {
    for (const [i, key] of keys.entries()) {
      await db.collection('notification_ledger').insertOne({
        tenant_id: T,
        tier: 'A',
        kind: 'insight_alert',
        key,
        outcome: 'sent',
        at: at(`2026-09-${String(1 + i * 15).padStart(2, '0')}`),
      })
    }
  }
  const now = at('2026-10-20')
  const prefs = () => db.collection('delivery_preferences').findOne({ tenant_id: T })

  it('offers after two unanswered alerts, changes nothing else, and is idempotent', async () => {
    await db
      .collection('delivery_preferences')
      .insertOne({ tenant_id: T, enabled: true, digest_mode: false })
    await sentAlerts('i1', 'i2')
    expect(await maybeOfferDigestOnly(db, T, now)).toBe(true)
    expect(await maybeOfferDigestOnly(db, T, now)).toBe(true)
    const p = await prefs()
    expect(p?.['digest_offer']).toEqual({ offered_at: now })
    expect(p?.['digest_mode']).toBe(false) // asked, never demoted
  })

  it('does not offer when an alert was clicked, or its insight was acted on', async () => {
    await db.collection('delivery_preferences').insertOne({ tenant_id: T, enabled: true })
    await sentAlerts('i1', 'i2')
    await db
      .collection('value_events')
      .insertOne({ tenant_id: T, kind: 'alert_click', key: 'i2', at: at('2026-09-17') })
    expect(await maybeOfferDigestOnly(db, T, now)).toBe(false)
    await db.collection('value_events').deleteMany({})
    await db.collection('insights').insertOne({ id: 'i1', tenant_id: T, state: 'resolved' })
    expect(await maybeOfferDigestOnly(db, T, now)).toBe(false)
  })

  it('does not offer on too little history, a too-recent alert, digest-only already, or a recent "no"', async () => {
    await db.collection('delivery_preferences').insertOne({ tenant_id: T, enabled: true })
    await sentAlerts('i1')
    expect(await maybeOfferDigestOnly(db, T, now)).toBe(false) // one alert
    await db.collection('notification_ledger').insertOne({
      tenant_id: T,
      tier: 'A',
      kind: 'insight_alert',
      key: 'fresh',
      outcome: 'sent',
      at: new Date(now.getTime() - 2 * DAY),
    })
    expect(await maybeOfferDigestOnly(db, T, now)).toBe(false) // newest is inside the response window
    await db.collection('notification_ledger').deleteOne({ key: 'fresh' })
    await sentAlerts('i2')
    await db
      .collection('delivery_preferences')
      .updateOne(
        { tenant_id: T },
        { $set: { digest_offer_declined_at: new Date(now.getTime() - 10 * DAY) } },
      )
    expect(await maybeOfferDigestOnly(db, T, now)).toBe(false) // said no recently
    await db.collection('delivery_preferences').updateOne(
      { tenant_id: T },
      {
        $set: {
          digest_offer_declined_at: new Date(
            now.getTime() - (BUDGET.offer_cooldown_days + 1) * DAY,
          ),
          digest_mode: true,
        },
      },
    )
    expect(await maybeOfferDigestOnly(db, T, now)).toBe(false) // already digest-only
  })

  it('exempt reminders and digests never count toward unanswered alerts', async () => {
    await db.collection('delivery_preferences').insertOne({ tenant_id: T, enabled: true })
    await db.collection('notification_ledger').insertMany([
      {
        tenant_id: T,
        tier: 'A',
        kind: 'renewal_reminder',
        key: 'r1',
        outcome: 'exempt',
        at: at('2026-09-01'),
      },
      {
        tenant_id: T,
        tier: 'A',
        kind: 'renewal_reminder',
        key: 'r2',
        outcome: 'exempt',
        at: at('2026-09-02'),
      },
      {
        tenant_id: T,
        tier: 'B',
        kind: 'quiet_care_digest',
        outcome: 'exempt',
        at: at('2026-09-03'),
      },
    ])
    expect(await maybeOfferDigestOnly(db, T, now)).toBe(false)
  })
})

describe('DeliveryRouter.deliver uses the budget', () => {
  const insight = (id: string, urgency = 'medium') => ({
    id,
    urgency,
    hypothesis: 'x',
    created_at: new Date(),
    confidence_breakdown: {},
  })
  const mkRouter = async () => {
    await db.collection('delivery_preferences').insertOne({
      tenant_id: T,
      enabled: true,
      channels: ['email'],
      email_to: 'a@x.test',
      min_urgency: 'low',
    })
    const router = new DeliveryRouter(db as never)
    const sent: string[] = []
    ;(router as unknown as { email: unknown }).email = {
      send: async (_to: string, _n: string, n: { insight_id: string; action_url: string }) => {
        sent.push(n.action_url)
        return { channel: 'email', success: true, delivered_at: new Date() }
      },
    }
    return { router, sent }
  }

  it('sends the first alert, holds the second into the digest queue, and records both', async () => {
    const { router, sent } = await mkRouter()
    expect((await router.deliver(insight('i1'), T))?.success).toBe(true)
    expect(await router.deliver(insight('i2'), T)).toBeNull()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('?src=alert&i=i1')
    expect(await db.collection('digest_queue').countDocuments({ insight_id: 'i2' })).toBe(1)
    const rows = await ledger()
    expect(rows.map((r) => `${r['outcome']}:${r['key']}`)).toEqual(['sent:i1', 'dropped:i2'])
  })

  it('always sends a critical alert, even over the cap, and logs it as exempt', async () => {
    const { router, sent } = await mkRouter()
    await router.deliver(insight('i1'), T)
    expect((await router.deliver(insight('crit', 'critical'), T))?.success).toBe(true)
    expect(sent).toHaveLength(2)
    expect((await ledger()).at(-1)).toMatchObject({
      key: 'crit',
      outcome: 'exempt',
      reason: 'critical',
    })
  })

  it('an organizer-released alert (skipJudge) is exempt from the cap', async () => {
    const { router } = await mkRouter()
    await router.deliver(insight('i1'), T)
    expect((await router.deliver(insight('rel'), T, { skipJudge: true }))?.success).toBe(true)
    expect((await ledger()).at(-1)).toMatchObject({ key: 'rel', reason: 'human_release' })
  })

  it('renewal reminders are logged as exempt dated obligations and never capped', async () => {
    const { router } = await mkRouter()
    await db
      .collection('delivery_preferences')
      .updateOne({ tenant_id: T }, { $set: { channels: ['web_push'], web_push_enabled: true } })
    ;(router as unknown as { webPush: unknown }).webPush = {
      send: async () => ({ channel: 'web_push', success: true, delivered_at: new Date() }),
    }
    await db
      .collection('web_push_subscriptions')
      .insertOne({ tenant_id: T, endpoint: 'e', keys: { p256dh: 'x', auth: 'y' } })
    for (const id of ['r1', 'r2', 'r3']) {
      expect(await router.deliverReminder(T, { id, title: 't', body: 'b', url: 'u' })).toBe('sent')
    }
    expect((await ledger()).filter((r) => r['reason'] === 'dated_obligation')).toHaveLength(3)
  })
})
