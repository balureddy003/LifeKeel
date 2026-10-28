/**
 * Unified external-spend ledger (Stage B8) — one collection for every
 * non-AI external cost, with AI usage unioned in from `llm_usage` at read
 * time. Before this, spend controls were three partial ledgers that could
 * each look healthy while the total ran away.
 *
 * What it records: per-message/channel external spend — Twilio SMS and
 * WhatsApp, SendGrid email, and anything else wired to recordSpend().
 * What it deliberately does NOT duplicate: AI token usage, which the task
 * gateway already writes to `llm_usage` with real provider token counts.
 *
 * Costs here are LIST-PRICE ESTIMATES (`estimated: true`) — the
 * estimated-vs-billed reconciliation gap is a known P2 register row; a
 * provider webhook or invoice import would replace the estimate without
 * changing the schema.
 *
 * Enforcement: checkPlanSpendBudget() runs inside the AI task gateway's
 * composed budget guard — `batch`-class tasks (background sweeps,
 * enrichment) are denied once a tenant's all-service monthly spend
 * crosses its plan cap; `interactive` tasks (family-facing, in-session)
 * are never hard-stopped by spend alone.
 */
import type { Db } from 'mongodb'
import type { AiTaskPolicy, LlmBudgetDecision } from '@lifekeel/platform'

export interface SpendEvent {
  tenant_id: string
  /** broad bucket: 'messaging' | 'email' | 'marketing' | 'ocr' | ... */
  service: string
  /** concrete provider: 'twilio' | 'sendgrid' | 'expo' | ... */
  provider: string
  /** provider resource kind, e.g. 'sms' | 'whatsapp' | 'email' */
  unit: string
  units: number
  cost_microdollars: number
  /** always true today — list-price estimate, not billed usage */
  estimated: boolean
  meta?: Record<string, unknown>
  created_at?: Date
}

export function spendEventsCol(db: Db) {
  return db.collection<SpendEvent>('spend_events')
}

export function ensureSpendIndexes(db: Db): Promise<void> {
  return Promise.all([
    spendEventsCol(db).createIndex({ tenant_id: 1, created_at: -1 }),
    spendEventsCol(db).createIndex({ service: 1, created_at: -1 }),
    // Spend events are telemetry, not records of authority — bounded TTL.
    spendEventsCol(db).createIndex({ created_at: 1 }, { expireAfterSeconds: 400 * 24 * 3600 }),
  ])
    .then(() => undefined)
    .catch(() => {})
}

// ── List-price estimates (micro-dollars per unit) ─────────────────────────
// 1 micro-dollar = $0.000001. Sources: provider list prices, Oct 2026 —
// override via LIFEKEEL_SPEND_PRICING_JSON='{"twilio.sms":8000,...}'.
const DEFAULT_UNIT_COSTS: Record<string, number> = {
  'twilio.sms': 7500, // ~$0.0075/segment US/UK average
  'twilio.whatsapp': 5000, // ~$0.005 utility/service message
  'sendgrid.email': 60, // ~$0.0006/message at Essentials volume
  'resend.email': 40, // ~$0.0004/message at Pro volume; free tier is $0
  'expo.push': 0,
}

function unitCosts(): Record<string, number> {
  try {
    const override = process.env['LIFEKEEL_SPEND_PRICING_JSON']
    if (override)
      return { ...DEFAULT_UNIT_COSTS, ...(JSON.parse(override) as Record<string, number>) }
  } catch {
    /* malformed override — defaults stand */
  }
  return DEFAULT_UNIT_COSTS
}

/** Cost of `units` of `provider.unit` in micro-dollars. */
export function spendCost(provider: string, unit: string, units = 1): number {
  return (unitCosts()[`${provider}.${unit}`] ?? 0) * units
}

/** Record a billable external action. Fire-and-forget safe — call sites
 *  wrap with .catch(() => {}) so telemetry never fails a delivery. */
export async function recordSpend(
  db: Db,
  event: Omit<SpendEvent, 'created_at' | 'estimated'>,
): Promise<void> {
  await spendEventsCol(db).insertOne({ ...event, estimated: true, created_at: new Date() })
}

// ── Summaries ─────────────────────────────────────────────────────────────

export interface TenantSpend {
  tenant_id: string
  microdollars: number
}

/** All-service spend for a tenant over `days`: spend_events + llm_usage. */
export async function tenantSpendMicrodollars(
  db: Db,
  tenantId: string,
  days = 31,
): Promise<number> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)
  const [events, llm] = await Promise.all([
    spendEventsCol(db)
      .aggregate<{ total: number }>([
        { $match: { tenant_id: tenantId, created_at: { $gte: since } } },
        { $group: { _id: null, total: { $sum: '$cost_microdollars' } } },
      ])
      .next(),
    db
      .collection('llm_usage')
      .aggregate<{ total: number }>([
        { $match: { tenant_id: tenantId, created_at: { $gte: since } } },
        { $group: { _id: null, total: { $sum: '$cost_microdollars' } } },
      ])
      .next(),
  ])
  return (events?.total ?? 0) + (llm?.total ?? 0)
}

// ── Plan cost budget ──────────────────────────────────────────────────────

/** Monthly all-service external-spend cap per plan, in USD. Free tier is
 *  capped hardest; paid tiers get headroom; 'unlimited' opts out. Override
 *  via LIFEKEEL_PLAN_SPEND_BUDGET_JSON='{"free":1.5,"starter":8}'. */
const DEFAULT_PLAN_BUDGET_USD: Record<string, number | null> = {
  free: 1,
  starter: 5,
  plus: 20,
  family: 20,
  pro: 50,
  unlimited: null,
}

function planBudgetUsd(): Record<string, number | null> {
  try {
    const override = process.env['LIFEKEEL_PLAN_SPEND_BUDGET_JSON']
    if (override)
      return {
        ...DEFAULT_PLAN_BUDGET_USD,
        ...(JSON.parse(override) as Record<string, number | null>),
      }
  } catch {
    /* malformed override — defaults stand */
  }
  return DEFAULT_PLAN_BUDGET_USD
}

/**
 * The spend gateway's plan-cap check. Composed behind LlmBudgetGuard in
 * initTaskGateway — runs after the per-tenant LLM budget passes.
 *
 * Only `budget_class: 'batch'` tasks are denied on cap breach: background
 * spend is deferrable; `interactive` tasks are the family's live session
 * and never hard-stop on platform cost (a budget breach surfaces in unit
 * economics and the threshold system event instead).
 */
export async function checkPlanSpendBudget(
  db: Db,
  tenantId: string,
  policy?: AiTaskPolicy,
): Promise<LlmBudgetDecision> {
  const tenant = await db
    .collection('tenants')
    .findOne({ tenant_id: tenantId }, { projection: { _id: 0, plan: 1 } })
  const plan = (tenant?.['plan'] as string | null) ?? 'free'
  const table = planBudgetUsd()
  // `in` not `??`: a plan explicitly capped at null (unlimited) must not
  // fall through to the free-tier cap.
  const capUsd = plan in table ? table[plan]! : table['free']!
  const spent = await tenantSpendMicrodollars(db, tenantId, 31)
  if (capUsd === null) {
    return {
      allowed: true,
      spent_microdollars: spent,
      limit_microdollars: null,
      threshold_reached: false,
    }
  }
  const limit = capUsd * 1_000_000
  const thresholdReached = spent >= limit * 0.8
  // PRD-226/Intent 76: on the free tier the cap is HARD for every budget
  // class — interactive calls included. Free tenants must not be able to
  // generate unbounded model/OCR cost while still paying nothing; paid
  // plans keep the old behaviour (batch blocked, interactive allowed past
  // cap) until a separate paid-tier policy decision.
  const exemptFromCap = plan !== 'free' && policy?.budget_class !== 'batch'
  if (spent < limit || exemptFromCap) {
    return {
      allowed: true,
      spent_microdollars: spent,
      limit_microdollars: limit,
      threshold_reached: thresholdReached,
    }
  }
  try {
    await db.collection('system_events').updateOne(
      {
        tenant_id: tenantId,
        type: 'plan_spend_budget_exceeded',
        month: new Date().toISOString().slice(0, 7),
      },
      {
        $setOnInsert: {
          tenant_id: tenantId,
          type: 'plan_spend_budget_exceeded',
          month: new Date().toISOString().slice(0, 7),
          plan,
          spent_microdollars: spent,
          limit_microdollars: limit,
          created_at: new Date(),
        },
      },
      { upsert: true },
    )
  } catch {
    /* telemetry must not break the budget check */
  }
  return {
    allowed: false,
    spent_microdollars: spent,
    limit_microdollars: limit,
    threshold_reached: true,
    reason: 'plan_spend_budget_exceeded',
  }
}

// ── Unit economics ────────────────────────────────────────────────────────

export interface UnitEconomics {
  period_days: number
  total_spend_microdollars: number
  by_service: Record<string, number>
  /** Tenants with at least one successful login in the window. */
  active_families: number
  /** Mean all-service spend per active family. */
  cost_per_active_family_microdollars: number
  top_tenants: TenantSpend[]
}

export async function platformUnitEconomics(db: Db, days = 30): Promise<UnitEconomics> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000)

  const [byService, topSpend, topLlm, activeUserIds] = await Promise.all([
    spendEventsCol(db)
      .aggregate<{ _id: string; total: number }>([
        { $match: { created_at: { $gte: since } } },
        { $group: { _id: '$service', total: { $sum: '$cost_microdollars' } } },
      ])
      .toArray(),
    spendEventsCol(db)
      .aggregate<{ _id: string; total: number }>([
        { $match: { created_at: { $gte: since } } },
        { $group: { _id: '$tenant_id', total: { $sum: '$cost_microdollars' } } },
      ])
      .toArray(),
    db
      .collection('llm_usage')
      .aggregate<{ _id: string; total: number }>([
        { $match: { created_at: { $gte: since } } },
        { $group: { _id: '$tenant_id', total: { $sum: '$cost_microdollars' } } },
      ])
      .toArray(),
    db
      .collection('login_events')
      .distinct('user_id', { success: true, created_at: { $gte: since } }),
  ])

  const services: Record<string, number> = {}
  for (const row of byService) services[row._id] = row.total
  const llmTotal = topLlm.reduce((s, r) => s + r.total, 0)
  if (llmTotal > 0) services['ai'] = (services['ai'] ?? 0) + llmTotal

  const perTenant = new Map<string, number>()
  for (const row of [...topSpend, ...topLlm]) {
    perTenant.set(row._id, (perTenant.get(row._id) ?? 0) + row.total)
  }
  const total = [...perTenant.values()].reduce((s, v) => s + v, 0)

  const userTenants = await db
    .collection('users')
    .find({ id: { $in: activeUserIds } }, { projection: { _id: 0, tenant_id: 1 } })
    .toArray()
  const activeFamilies = new Set(userTenants.map((u) => u['tenant_id'] as string)).size

  return {
    period_days: days,
    total_spend_microdollars: total,
    by_service: services,
    active_families: activeFamilies,
    cost_per_active_family_microdollars:
      activeFamilies > 0 ? Math.round(total / activeFamilies) : 0,
    top_tenants: [...perTenant.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tenant_id, microdollars]) => ({ tenant_id, microdollars })),
  }
}
