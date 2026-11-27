import type { Metadata } from 'next'
import { Pricing } from '@/components/landing/Pricing'

/**
 * Public pricing route.
 *
 * The family vertical's pricing. Small businesses are a separate vertical at
 * business.lifekeel.com with their own pricing (owner, 27 Nov 2026).
 *
 * The route re-uses the home-page Pricing component so the data arrays
 * (FREE_ROWS / PLUS_ROWS — both gated on `live` claim rows in claims.ts)
 * and the £7.99 number (gated on PLAN_QUOTAS['starter'] in
 * apps/api/src/billing/billing-constants.ts) stay in sync with the rest
 * of the marketing surface.
 */
export const metadata: Metadata = {
  title: 'Pricing — LifeKeel',
  description:
    'Free for a household. Keel Plus is £7.99 a month for the household and cancels any time. No commissions, no ads, no card needed to start.',
}

export default function PricingPage() {
  return <Pricing />
}
