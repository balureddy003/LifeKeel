import type { Metadata } from 'next'
import { Pricing } from '@/components/landing/Pricing'

/**
 * Public pricing route.
 *
 * Owner-locked §9.1: "Free for a household. Honest plans for a team. £7.99
 * a month per subscription. One Keel Plus per team of two or more adults;
 * the household-side subscription stays at the same number."
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
    'Free for a household. Honest plans for a team. One Keel Plus subscription per unit, £7.99 a month, cancels any time. No commissions, no per-seat mystery.',
}

export default function PricingPage() {
  return <Pricing />
}
