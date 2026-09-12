/**
 * Trading Holding Schema
 *
 * Per-holding fundamentals for the Trading & Investment vertical (GET
 * /portfolio/holdings). This is intentionally vertical-specific — a stock/ETF
 * position has no honest generic equivalent for property-wealth (a property)
 * or smb-operations (a customer/invoice) without lossy abstraction, and
 * neither of those verticals has a real entity screen yet to validate a
 * shared shape against.
 *
 * The actual cross-vertical generic layer is PotentialGap (decision-contract
 * composite, shared across all verticals) — see holding-to-gap.ts in Studio,
 * which converts a TradingHolding into PotentialGap objects for the shared
 * "Signals" rendering. This schema only exists to give the API route and the
 * Studio frontend one shared source of truth instead of two hand-duplicated
 * copies of the same shape.
 */

import { z } from 'zod'

export const AssetClassSchema = z.enum(['stock', 'etf', 'cash', 'commodity', 'cryptocurrency'])
export type AssetClass = z.infer<typeof AssetClassSchema>

export const TradingHoldingSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  name: z.string(),
  assetClass: AssetClassSchema,
  currentPriceMinor: z.number(),
  dayChangeMinor: z.number(),
  dayChangePercent: z.number(),
  portfolioWeightPercent: z.number(),
  concentrationFlag: z.boolean().optional(),
  dividendYieldPercent: z.number().optional(),
  newsSignal: z.string().optional(),
  opportunityDetector: z.string().optional(),
  /** Urgency of the flagged opportunity, from the underlying Insight. Unset when no detector has fired. */
  opportunityUrgency: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  /** Calibrated confidence (0..1) of the flagged opportunity, from the underlying Insight. */
  opportunityConfidence: z.number().min(0).max(1).optional(),
  currency: z.string(),
  /** Account type from the broker (e.g. 'isa', 'invest', 'cfd' for Trading 212;
   *  'cnc', 'mis', 'nrml' for Zerodha/Kite). Open-ended string to support
   *  any broker's account classification. */
  accountType: z.string().optional(),
  sector: z.string().optional(),
})

export type TradingHolding = z.infer<typeof TradingHoldingSchema>
