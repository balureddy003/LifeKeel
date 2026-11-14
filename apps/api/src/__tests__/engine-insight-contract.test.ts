/**
 * Engine → API contract test — the seam where schema-valid Insight objects
 * become persisted docs and notifications.
 *
 * The golden evals (detector-evals/) pin detector *behavior* inside the
 * engine; nothing pinned the field names the API's persistence and delivery
 * layers read off the emitted object — which is how `estimated_impact`
 * (nested) vs `estimated_impact_low/high` (flat, the real schema) and
 * `recommended_actions` vs `actions` drifted silently: typecheck passes,
 * the notification just quietly ships without the figures or next steps.
 *
 * This test runs a real Engine over the production detectors dir, fires a
 * known family rule, then asserts:
 *   1. the emitted insight carries every field insights-persist.ts reads
 *      (dedup key, lifecycle state, snapshot scalars, dedup window);
 *   2. a notification built from it (the real buildNotification code path)
 *      actually carries impact figures and actions — the two fields that
 *      drifted.
 */

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, type Insight } from '@lifekeel/engine'
import { DeliveryRouter } from '../delivery/delivery-router.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../detectors')

const URGENCY_VALUES = new Set(['low', 'medium', 'high', 'critical'])
const DISCLOSURE_VALUES = new Set(['household', 'member', 'organiser'])

/** Golden firing case: detector-evals/family_income_stops_runway.yaml. */
const FIRING_EVENT = {
  event_type: 'family.savings',
  tenant_id: 'contract-tenant',
  event_id: 'contract-case-1',
  data: {
    emergency_savings_minor: 600000,
    monthly_expenses_minor: 200000,
    income_protection_monthly_minor: 50000,
    runway_months_savings_only: 3,
    runway_months_with_income_protection: 4,
  },
}

async function fireOne(): Promise<Insight> {
  const engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
  const result = await engine.evaluate(FIRING_EVENT)
  expect(result.insights.length).toBeGreaterThan(0)
  return result.insights[0]!
}

describe('engine → persistence contract', () => {
  it('emits the fields insights-persist dedups and delivers on', async () => {
    const insight = await fireOne()

    // Dedup key: (detector_id, rule_id, entity_key) — entity_key optional,
    // persist reads it as `?? ''`.
    expect(typeof insight.id).toBe('string')
    expect(typeof insight.detector_id).toBe('string')
    expect(typeof insight.rule_id).toBe('string')
    expect(['string', 'undefined']).toContain(typeof insight.entity_key)

    // Lifecycle the persist/delivery state machine starts from.
    expect(insight.state).toBe('identified')
    expect(insight.created_at).toBeInstanceOf(Date)

    // Closed-insight suppression window.
    if (insight.dedup_window_ms !== undefined) {
      expect(Number.isInteger(insight.dedup_window_ms)).toBe(true)
    }

    // "What changed" copy (diffFeatureFields) and the feature-hash scorer
    // both read feature_snapshot as flat scalars — a nested object would
    // break both silently.
    if (insight.feature_snapshot !== undefined) {
      for (const v of Object.values(insight.feature_snapshot)) {
        expect(['string', 'number', 'boolean']).toContain(typeof v)
      }
    }

    // Delivery payload inputs.
    expect(URGENCY_VALUES).toContain(insight.urgency)
    expect(typeof insight.hypothesis).toBe('string')
    expect(typeof insight.reasoning).toBe('string')
    expect(typeof insight.confidence_breakdown.or_score).toBe('number')

    // Youth redaction join — enum only, when present.
    if (insight.disclosure !== undefined) {
      expect(DISCLOSURE_VALUES).toContain(insight.disclosure)
    }
  })
})

describe('insight → notification contract', () => {
  it('carries impact figures and actions into the built notification', async () => {
    const insight = await fireOne()

    // The fields that drifted before: engine emits them flat, the router
    // must map them onto the notification. Pinning the schema names here
    // keeps the router's read honest either way.
    expect(Number.isInteger(insight.estimated_impact_low)).toBe(true)
    expect(Number.isInteger(insight.estimated_impact_high)).toBe(true)
    expect(Array.isArray(insight.actions)).toBe(true)

    const router = new DeliveryRouter({} as never)
    // buildNotification is private: reached deliberately — this IS the seam
    // under test, and breaking it is what the test exists to catch.
    const notification = (
      router as unknown as {
        buildNotification(
          i: Record<string, unknown>,
          t: string,
        ): {
          estimated_impact_low?: number
          estimated_impact_high?: number
          recommended_actions?: string[]
        }
      }
    ).buildNotification(insight as unknown as Record<string, unknown>, 'contract-tenant')

    expect(notification.estimated_impact_low).toBe(insight.estimated_impact_low)
    expect(notification.estimated_impact_high).toBe(insight.estimated_impact_high)
    expect(notification.recommended_actions).toEqual(insight.actions)
  })
})
