/**
 * Onboarding routes — track first-run progress per tenant.
 *
 * GET  /onboarding/status          — return checklist state + next step
 * POST /onboarding/fire-test-event — fire a synthetic invoice.overdue event
 *                                    so new tenants see their first insight instantly
 * POST /onboarding/complete/:step  — manually mark a step done
 *
 * Steps (in order):
 *   1. connect_source    — at least one connector has credentials
 *   2. first_event       — at least one event has been ingested
 *   3. first_insight     — at least one insight has been produced
 *   4. first_approval    — at least one insight has been approved
 *   5. first_playbook_run — at least one playbook has actually been run
 *                           (playbook definitions themselves are shared YAML
 *                           templates, not per-tenant records, so "run" is
 *                           the real per-tenant milestone here, not "created")
 *   6. first_alert_rule  — at least one alert rule has been configured
 *
 * State is stored in MongoDB `onboarding_state` collection, one doc per tenant.
 * Steps are auto-detected on each GET (live counts) so they self-heal if data
 * is imported or events arrive out of order.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { Engine } from '@kairos/engine'
import { connectorRegistry, loadVerticals } from '@kairos/workflows'
import {
  repoRoot,
  PERSONA_VERTICALS,
  RISK_TIER_PRESETS,
  STRATEGY_DEFAULTS,
  isPersona,
  isRiskTier,
  getCurrencyForCountry,
  getLocaleForCountry,
  type Persona,
  type RiskTier,
} from '@kairos/platform'

export type OnboardingStep = 'connect_source' | 'first_event' | 'first_insight' | 'first_approval' | 'first_playbook_run' | 'first_alert_rule'

export interface OnboardingState {
  tenant_id: string
  steps: Record<OnboardingStep, boolean>
  completed: boolean
  started_at: Date
  completed_at?: Date
}

const STEP_ORDER: OnboardingStep[] = ['connect_source', 'first_event', 'first_insight', 'first_approval', 'first_playbook_run', 'first_alert_rule']

// ── Vertical-aware test events ─────────────────────────────────────────────────
// Each vertical registers a synthetic event that matches its detectors'
// signal_types. When a tenant fires a test event during onboarding, the
// event type and payload are chosen based on their active vertical.
// The default (no vertical set) is the original invoice.overdue event,
// preserving backward compatibility for existing tenants.
interface TestEvent {
  event_type: string
  data: Record<string, unknown>
}

const VERTICAL_TEST_EVENTS: Record<string, TestEvent> = {
  'smb-operations': {
    event_type: 'invoice.overdue',
    data: {
      amount_minor: 450_000,
      days_overdue: 14,
      customer_id: 'cust_demo',
      customer_name: 'Acme Corp (Demo)',
      invoice_ref: 'INV-DEMO-001',
    },
  },
  'trading-investment': {
    event_type: 'trading.position.update',
    data: {
      ticker: 'AAPL',
      position_weight_pct: 12.5,
      portfolio_concentration_max_pct: 10,
      position_value_minor: 250_000,
    },
  },
  'property-wealth': {
    event_type: 'property.valuation',
    data: {
      address: '14 Market Street',
      area: 'Manchester',
      net_yield_pct: 4.1,
      area_benchmark_yield_pct: 5.8,
      property_value_minor: 8_500_000,
      monthly_rent_minor: 29_000,
      void_days: 0,
    },
  },
  'audience-growth': {
    event_type: 'social.engagement.update',
    data: {
      platform: 'x',
      handle: '@demo_brand',
      engagement_rate: 0.008,
      previous_engagement_rate: 0.025,
      post_count: 3,
    },
  },
  'branding-marketing': {
    event_type: 'ecommerce.cart.abandoned',
    data: {
      cart_id: 'cart_demo_001',
      cart_value_minor: 12_500,
      customer_id: 'cust_demo_002',
      minutes_since_abandon: 45,
    },
  },
  'family': {
    event_type: 'family.policy',
    data: {
      life_cover_minor: 500_000,
      mortgage_outstanding_minor: 1_200_000,
      education_funding_gap_minor: 300_000,
      annual_living_expenses_minor: 480_000,
      income_protection_monthly_minor: 0,
      employed: true,
      monthly_salary_minor: 40_000,
    },
  },
}

const DEFAULT_TEST_EVENT: TestEvent = VERTICAL_TEST_EVENTS['smb-operations']!

function getTestEventForVertical(verticalId: string | undefined): TestEvent {
  if (!verticalId) return DEFAULT_TEST_EVENT
  return VERTICAL_TEST_EVENTS[verticalId] ?? DEFAULT_TEST_EVENT
}

const STEP_META: Record<OnboardingStep, { title: string; description: string; cta: string; href: string }> = {
  connect_source: {
    title: 'Connect your first data source',
    description: 'Link Xero, Stripe, Shopify, or upload a CSV to start detecting opportunities.',
    cta: 'Connect a source →',
    href: '/connectors',
  },
  first_event: {
    title: 'Send your first event',
    description: 'Kairos is now watching your data. Your first event will arrive automatically.',
    cta: 'Fire a test event →',
    href: '/console',
  },
  first_insight: {
    title: 'See your first insight',
    description: 'Kairos detected an opportunity from your data. Review it now.',
    cta: 'View insights →',
    href: '/insights',
  },
  first_approval: {
    title: 'Approve your first insight',
    description: 'Approve an insight to trigger the recommended action and complete onboarding.',
    cta: 'Approve an insight →',
    href: '/insights',
  },
  first_playbook_run: {
    title: 'Run a playbook',
    description: 'Trigger a playbook so Kairos can draft, route, and notify automatically.',
    cta: 'Go to Playbooks →',
    href: '/workflows',
  },
  first_alert_rule: {
    title: 'Set up an alert rule',
    description: 'Get notified in Slack, email, or SMS when an insight matches your conditions.',
    cta: 'Add an alert rule →',
    href: '/actions',
  },
}

/** Connect-source step copy for a tenant with an active vertical, naming the
 * vertical's own required connectors instead of the generic Xero/Stripe/Shopify
 * default — e.g. "Link Trading 212 to start detecting opportunities." */
function connectSourceDescription(activeVerticalId: string | undefined): string {
  if (activeVerticalId) {
    const vertical = loadVerticals(repoRoot()).find((v) => v.id === activeVerticalId)
    if (vertical && vertical.required_connectors.length > 0) {
      const names = vertical.required_connectors.map((id) => connectorRegistry.get(id)?.name ?? id)
      return `Link ${names.join(' or ')} to start detecting opportunities.`
    }
  }
  return 'Link Xero, Stripe, Shopify, or upload a CSV to start detecting opportunities.'
}

export function isValidOnboardingProfile(persona: unknown, riskTier: unknown): boolean {
  if (!isPersona(persona)) return false
  const requiresRiskTier = PERSONA_VERTICALS[persona] === 'trading-investment'
  return (!requiresRiskTier || isRiskTier(riskTier)) && (riskTier === undefined || isRiskTier(riskTier))
}

export function registerOnboardingRoutes(app: FastifyInstance, db: Db, engine: Engine): void {
  const col = db.collection('onboarding_state')
  col.createIndex({ tenant_id: 1 }, { unique: true }).catch(() => {})

  // ── GET /onboarding/status ───────────────────────────────────────────────────
  app.get('/onboarding/status', async (req) => {
    const { tenant_id } = req.authContext

    // Live-detect step completion from actual data — self-healing
    const [connectedCount, eventCount, insightCount, approvedCount, playbookRunCount, alertRuleCount, tenantSettings] = await Promise.all([
      db.collection('connector_credentials').countDocuments({ tenant_id }),
      db.collection('event_dedup').countDocuments({ tenant_id }),
      db.collection('insights').countDocuments({ tenant_id }),
      db.collection('insights').countDocuments({ tenant_id, state: 'completed' }),
      db.collection('workflow_runs').countDocuments({ tenant_id }),
      db.collection('alert_rules').countDocuments({ tenant_id }),
      db.collection('tenant_settings').findOne({ tenant_id }),
    ])

    const steps: Record<OnboardingStep, boolean> = {
      connect_source: connectedCount > 0,
      first_event:    eventCount > 0,
      first_insight:  insightCount > 0,
      first_approval: approvedCount > 0,
      first_playbook_run: playbookRunCount > 0,
      first_alert_rule:   alertRuleCount > 0,
    }

    const allDone = STEP_ORDER.every(s => steps[s])

    // Persist state (upsert — create on first call)
    await col.updateOne(
      { tenant_id },
      {
        $set: { steps, completed: allDone, ...(allDone && { completed_at: new Date() }) },
        $setOnInsert: { tenant_id, started_at: new Date() },
      },
      { upsert: true },
    )

    // Find the first incomplete step
    const nextStep = STEP_ORDER.find(s => !steps[s])
    const activeVerticalId = tenantSettings?.['active_vertical'] as string | undefined

    return {
      tenant_id,
      completed: allDone,
      steps: STEP_ORDER.map(step => ({
        id: step,
        done: steps[step],
        ...STEP_META[step],
        ...(step === 'connect_source' && { description: connectSourceDescription(activeVerticalId) }),
        active: step === nextStep,
      })),
      next_step: nextStep ?? null,
      progress: `${STEP_ORDER.filter(s => steps[s]).length}/${STEP_ORDER.length}`,
    }
  })

  // ── POST /onboarding/fire-test-event ────────────────────────────────────────
  // Fires a realistic synthetic event so the tenant sees their first insight
  // without waiting for real data to arrive. The event type and payload are
  // chosen based on the tenant's active vertical — each vertical registers
  // a test event that matches its detectors' signal_types.
  app.post('/onboarding/fire-test-event', async (req, reply) => {
    const { tenant_id } = req.authContext

    // Don't fire if they already have real events
    const realEvents = await db.collection('event_dedup').countDocuments({ tenant_id })
    if (realEvents > 0) {
      return reply.status(200).send({ status: 'skipped', reason: 'Tenant already has events' })
    }

    // Look up the tenant's active vertical to pick the right test event
    const tenantSettings = await db.collection('tenant_settings').findOne({ tenant_id })
    const activeVertical = tenantSettings?.['active_vertical'] as string | undefined
    const testEvent = getTestEventForVertical(activeVertical)

    const syntheticEventId = `onboarding_test_${tenant_id}_${Date.now()}`

    const result = await engine.evaluate({
      event_type: testEvent.event_type,
      tenant_id,
      event_id: syntheticEventId,
      data: { ...testEvent.data, is_synthetic: true },
      business_context: { is_onboarding_demo: true },
    })

    // Persist any insights produced
    if (result.insights.length > 0) {
      const insightsCol = db.collection('insights')
      for (const insight of result.insights) {
        await insightsCol.updateOne(
          { id: insight.id },
          { $setOnInsert: { ...insight, is_synthetic: true } },
          { upsert: true },
        )
      }
    }

    return {
      status: 'fired',
      event_id: syntheticEventId,
      event_type: testEvent.event_type,
      vertical: activeVertical ?? 'default',
      insights_produced: result.insights.length,
      detectors_run: result.detectors_run,
      message: result.insights.length > 0
        ? 'Your first insight is ready — go to Insights to see it'
        : 'Event fired — install a detector to start producing insights',
    }
  })

  // ── POST /onboarding/complete/:step ─────────────────────────────────────────
  // Manual override — lets Studio mark a step done if detection is unreliable.
  app.post<{ Params: { step: string } }>('/onboarding/complete/:step', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { step } = req.params
    if (!STEP_ORDER.includes(step as OnboardingStep)) {
      return reply.status(400).send({ error: `Unknown step: ${step}` })
    }
    await col.updateOne(
      { tenant_id },
      { $set: { [`steps.${step}`]: true }, $setOnInsert: { tenant_id, started_at: new Date() } },
      { upsert: true },
    )
    return { ok: true, step }
  })

  // ── POST /onboarding/skip ────────────────────────────────────────────────────
  // Lets a user explicitly dismiss the wizard ("Skip for now" / "Adjust later")
  // without picking a vertical. Sets a flag distinct from active_vertical (which
  // would misattribute a vertical the user never actually chose) that the
  // frontend's AuthContext redirect check also honors — without this, skipping
  // only delayed the redirect back to /onboarding by one page load, since
  // active_vertical stayed null and every subsequent nav/login re-triggered it.
  app.post('/onboarding/skip', async (req) => {
    const { tenant_id } = req.authContext
    await db.collection('tenant_settings').updateOne(
      { tenant_id },
      { $set: { tenant_id, onboarding_skipped: true, updated_at: new Date() } },
      { upsert: true },
    )
    return { ok: true }
  })

  // ── POST /onboarding/profile ────────────────────────────────────────────────
  // Persists the persona + risk-tier choice from the Studio onboarding flow.
  // Writes the derived vertical into tenant_settings.active_vertical and the
  // risk-tier preset into both tenant_settings.defensive_trend_strategy and the
  // tenant's active goal KPIs so every detector reads a single source of truth.
  app.post<{ Body: { persona: Persona; riskTier?: RiskTier; country?: string } }>('/onboarding/profile', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { persona, riskTier, country } = req.body

    if (!isValidOnboardingProfile(persona, riskTier)) {
      return reply.status(400).send({ error: 'Invalid persona or riskTier' })
    }
    const verticalId = PERSONA_VERTICALS[persona]

    const preset = riskTier ? RISK_TIER_PRESETS[riskTier] : undefined
    const strategyValue = preset && {
      ...STRATEGY_DEFAULTS,
      ...preset.strategy,
      riskTier,
    }

    const settingsCol = db.collection('tenant_settings')
    const goalsCol = db.collection('goals')

    await Promise.all([
      // Active vertical — flat field on the tenant's main settings doc, same
      // convention as POST /verticals/:id/activate (verticals.ts). Every other
      // reader (auth-users.ts, onboarding status, verticals.ts) expects it
      // there; a keyed sub-doc here would be invisible to all of them.
      settingsCol.updateOne(
        { tenant_id },
        { $set: {
          tenant_id,
          active_vertical: verticalId,
          ...(country ? {
            country: country.trim().toUpperCase(),
            locale: getLocaleForCountry(country),
          } : {}),
          updated_at: new Date(),
        } },
        { upsert: true },
      ),
      // If country was provided, also update the tenant's billing currency
      // so all future charges use the correct currency.
      ...(country ? [db.collection('tenants').updateOne(
        { tenant_id },
        { $set: { country: country.trim().toUpperCase(), locale: getLocaleForCountry(country), 'billing.currency': getCurrencyForCountry(country), updated_at: new Date() } },
      )] : []),
      // Defensive trend strategy presets only apply to the trading vertical.
      ...(strategyValue ? [settingsCol.updateOne(
        { tenant_id, key: 'defensive_trend_strategy' },
        { $set: { tenant_id, key: 'defensive_trend_strategy', value: strategyValue, updated_at: new Date() } },
        { upsert: true },
      )] : []),
    ])

    // Update KPI targets on every active goal when a trading risk-tier preset
    // was selected. Non-trading personas do not have a risk tier to apply.
    const activeGoals = strategyValue ? await goalsCol.find({ tenant_id, status: 'active' }).toArray() : []
    for (const goal of activeGoals) {
      const existingKpis = Array.isArray(goal.kpis) ? goal.kpis : []
      const kpiMap = new Map(existingKpis.map((kpi: any) => [kpi.metric, kpi]))

      for (const [metric, target] of Object.entries(preset!.goalKpis)) {
        const existing = kpiMap.get(metric)
        if (existing) {
          existing.target = target
          existing.direction = metric === 'cash_allocation_max_pct' ? 'decrease' : 'increase'
        } else {
          kpiMap.set(metric, {
            metric,
            label: metric.replace(/_/g, ' '),
            unit: '%',
            target,
            start_value: 0,
            current: 0,
            direction: metric === 'cash_allocation_max_pct' ? 'decrease' : 'increase',
            source: 'signals',
          })
        }
      }

      await goalsCol.updateOne(
        { _id: goal._id },
        { $set: { kpis: Array.from(kpiMap.values()), updated_at: new Date() } },
      )
    }

    return {
      ok: true,
      vertical_id: verticalId,
      risk_tier: riskTier,
      strategy: strategyValue,
      goals_updated: activeGoals.length,
    }
  })
}
