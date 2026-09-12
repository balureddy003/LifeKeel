/**
 * Phase 1 strategy enhancement utilities.
 *
 * Evidence-based momentum improvements that use only price history:
 *   - Volatility scaling (Barroso & Santa-Clara 2015)
 *   - 52-week high signal (George & Hwang 2004)
 *   - Multi-timeframe momentum (Man AHL / Moskowitz, Ooi, Pedersen 2012)
 *   - Market state gate (Cooper, Gutierrez, Hameed 2004)
 *
 * All functions are pure and deterministic — no I/O, no side effects.
 */

import type { PricePoint } from './types.js'

const TRADING_DAYS_PER_YEAR = 252

/** Daily simple returns from a price history. */
export function dailyReturns(history: PricePoint[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]?.close
    const curr = history[i]?.close
    if (prev !== undefined && prev > 0 && curr !== undefined) {
      returns.push((curr - prev) / prev)
    }
  }
  return returns
}

/** Annualized realized volatility from daily returns. */
export function realizedVolatility(returns: number[]): number {
  if (returns.length === 0) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR)
}

/**
 * Volatility scaling factor (Barroso & Santa-Clara 2015).
 *
 * Scales position size inversely to realized volatility so the strategy
 * targets a constant volatility level. Capped to [min, max] to avoid
 * extreme leverage or complete de-risking from transient vol spikes.
 *
 * Evidence: nearly doubles Sharpe ratio (0.53 → 0.97) and virtually
 * eliminates momentum crashes.
 */
export function volatilityScale(
  history: PricePoint[],
  targetVol = 0.12,
  lookbackDays = 126,
  min = 0.2,
  max = 2.0,
): number {
  if (targetVol <= 0) return 1 // disabled
  const returns = dailyReturns(history.slice(-lookbackDays))
  const rv = realizedVolatility(returns)
  if (rv <= 0) return 1 // no data, no scaling
  const scale = targetVol / rv
  return Math.max(min, Math.min(max, scale))
}

/**
 * 52-week high ratio (George & Hwang 2004).
 *
 * Returns current price / 52-week high, in [0, 1]. Nearness to the
 * 52-week high is a stronger predictor of future returns than past
 * return momentum, and does not suffer long-run reversal.
 *
 * Maps the raw ratio (0.5–1.0) to a 0–1 score:
 *   - 1.0 (at high)    → 1.0
 *   - 0.9 (10% below)  → 0.8
 *   - 0.8 (20% below)  → 0.6
 *   - 0.5 (50% below)  → 0.0
 */
export function week52HighScore(history: PricePoint[]): number {
  if (history.length < 63) return 0.5 // neutral when insufficient data
  const window = history.slice(-TRADING_DAYS_PER_YEAR)
  let high = 0
  for (const p of window) {
    if (p.close > high) high = p.close
  }
  const current = history[history.length - 1]?.close
  if (high <= 0 || !current || current <= 0) return 0.5
  const ratio = current / high
  // Map [0.5, 1.0] → [0, 1]
  return Math.max(0, Math.min(1, (ratio - 0.5) / 0.5))
}

/**
 * Raw return over a lookback window, skipping recent days to avoid
 * short-term reversal noise.
 */
export function returnOverWindow(
  history: PricePoint[],
  lookbackDays: number,
  skipRecent = 21,
): number {
  if (history.length < lookbackDays + skipRecent) return 0
  const end = history.length - 1
  const past = history[end - lookbackDays - skipRecent]?.close
  const recent = history[end - skipRecent]?.close
  if (!past || !recent || past <= 0) return 0
  return (recent - past) / past
}

/**
 * Momentum score mapping — maps a raw return to a [0, 1] score.
 *
 * Uses a piecewise linear curve that preserves return magnitude at high
 * returns. The previous sigmoid saturated at ~30% return, so AMD (+190%)
 * and AAPL (+35%) got near-identical scores (~0.95). This curve continues
 * to reward higher returns linearly up to +200%, so a stock up 190%
 * scores meaningfully higher than one up 35%.
 *
 * Curve segments:
 *   return ≤ -25%  → 0 (unambiguously bearish)
 *   -25% to 0%     → linear 0 to 0.3 (mildly bearish zone)
 *   0% to +20%     → linear 0.3 to 0.6 (emerging momentum)
 *   +20% to +50%   → linear 0.6 to 0.8 (strong momentum)
 *   +50% to +200%  → linear 0.8 to 1.0 (exceptional momentum)
 *
 * Calibration: f(-20%)=0.06, f(0%)=0.30, f(+10%)=0.45, f(+30%)=0.70,
 * f(+50%)=0.80, f(+100%)=0.93, f(+190%)=1.0, f(+200%)=1.0.
 */
export function sigmoidMomentumScore(rawReturn: number): number {
  if (rawReturn <= -0.25) return 0
  if (rawReturn >= 2.0) return 1.0
  if (rawReturn <= 0) return 0.3 * (rawReturn + 0.25) / 0.25
  if (rawReturn <= 0.2) return 0.3 + 0.3 * (rawReturn / 0.2)
  if (rawReturn <= 0.5) return 0.6 + 0.2 * ((rawReturn - 0.2) / 0.3)
  return 0.8 + 0.2 * ((rawReturn - 0.5) / 1.5)
}

/**
 * Multi-timeframe momentum score (Man AHL / Moskowitz, Ooi, Pedersen 2012).
 *
 * Blends fast (8-week), medium (20-week), and slow (52-week) momentum
 * signals. The fast/slow correlation is only ~0.17, so combining them
 * diversifies whipsaw risk while keeping trend capture.
 */
export function multiTimeframeMomentumScore(
  history: PricePoint[],
  fastDays = 40,
  mediumDays = 100,
  slowDays = 252,
  fastWeight = 0.3,
  mediumWeight = 0.4,
  slowWeight = 0.3,
): number {
  const totalWeight = fastWeight + mediumWeight + slowWeight
  if (totalWeight === 0) return 0.5

  const fast = sigmoidMomentumScore(returnOverWindow(history, fastDays))
  const medium = sigmoidMomentumScore(returnOverWindow(history, mediumDays))
  const slow = sigmoidMomentumScore(returnOverWindow(history, slowDays))

  return (fast * fastWeight + medium * mediumWeight + slow * slowWeight) / totalWeight
}

/**
 * Market state gate (Cooper, Gutierrez, Hameed 2004).
 *
 * Returns a scale factor [0, 1] that reduces exposure when the broad
 * market 12-month return is negative. Most momentum crashes occur in
 * down markets — this gate halves exposure at -5% market return and
 * goes to cash at -20%.
 */
export function marketStateGate(
  marketHistory: PricePoint[],
  threshold = -0.05,
  cutoff = -0.20,
): number {
  if (marketHistory.length < TRADING_DAYS_PER_YEAR) return 1 // no data, no gate
  const market12mReturn = returnOverWindow(marketHistory, TRADING_DAYS_PER_YEAR, 0)
  if (market12mReturn >= threshold) return 1 // normal market, full exposure
  if (market12mReturn <= cutoff) return 0 // crash, go to cash
  // Linear interpolation between threshold (0.5) and cutoff (0.0)
  const t = (market12mReturn - cutoff) / (threshold - cutoff)
  return 0.5 * t
}

/**
 * ADX (Average Directional Index) — trend strength indicator.
 *
 * ADX > 25 indicates a trending market; ADX < 20 indicates a ranging
 * market. Used by the regime detector to avoid momentum trades in
 * choppy markets where trend-following whipsaws.
 *
 * IMPORTANT (review note PR #220): PricePoint only carries close prices,
 * so this is a CLOSE-ONLY APPROXIMATION of Welles Wilder's ADX, not the
 * canonical indicator. True Range degenerates to |Δclose| and directional
 * movement reduces to signed close-to-close moves. The result still
 * separates trending from ranging series (trends produce persistent
 * same-sign moves; chop alternates), but absolute values are lower than
 * true ADX and the 20/25 thresholds are approximate. If high/low data
 * becomes available, extend PricePoint and compute true TR here.
 */
export function computeADX(history: PricePoint[], period = 14): number {
  if (history.length < period * 2 + 1) return 0

  // True Range and directional movements
  const tr: number[] = []
  const plusDM: number[] = []
  const minusDM: number[] = []

  for (let i = 1; i < history.length; i++) {
    const high = history[i]!.close // using close as proxy (no high/low in PricePoint)
    const low = history[i]!.close
    const prevClose = history[i - 1]!.close

    const upMove = high - prevClose
    const downMove = prevClose - low

    tr.push(Math.max(Math.abs(high - low), Math.abs(upMove), Math.abs(downMove)))
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }

  // Wilder's smoothing: SMMA(i) = SMMA(i-1) × (period−1)/period + x(i),
  // initialized with the SUM of the first `period` values (Wilder's
  // original formulation — the first smoothed value is a sum, subsequent
  // values use the recurrence prev − prev/period + x).
  const smooth = (arr: number[]): number[] => {
    const out: number[] = []
    let prev = arr.slice(0, period).reduce((a, b) => a + b, 0)
    out.push(prev)
    for (let i = period; i < arr.length; i++) {
      prev = prev - prev / period + arr[i]!
      out.push(prev)
    }
    return out
  }

  const atr = smooth(tr)
  const sPlusDM = smooth(plusDM)
  const sMinusDM = smooth(minusDM)

  const dx: number[] = []
  for (let i = 0; i < atr.length; i++) {
    const pdi = atr[i]! > 0 ? (sPlusDM[i]! / atr[i]!) * 100 : 0
    const mdi = atr[i]! > 0 ? (sMinusDM[i]! / atr[i]!) * 100 : 0
    const sum = pdi + mdi
    dx.push(sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0)
  }

  if (dx.length < period) return 0
  // ADX = smoothed DX
  const adxSlice = dx.slice(-period)
  return adxSlice.reduce((a, b) => a + b, 0) / period
}

/**
 * Turnover reduction filter.
 *
 * Given a set of recommendations and the last-known scores/weights per
 * ticker, filter out recommendations where the score hasn't changed
 * enough to justify a trade. This reduces turnover by 30-50% with
 * minimal performance degradation.
 *
 * Sells and stop-losses are NEVER filtered — risk management always fires.
 */
export function filterByTurnover<T extends { ticker?: string; action: string; confidence?: number }>(
  recommendations: T[],
  lastScores: Map<string, number>,
  lastWeights: Map<string, number>,
  currentWeights: Map<string, number>,
  minScoreChange = 0.10,
  minWeightDrift = 0.20,
  minScoreChangeEntry: number | undefined = undefined,
): T[] {
  // If neither base nor asymmetric thresholds are set, pass everything through.
  if (minScoreChange <= 0 && minWeightDrift <= 0 && (!minScoreChangeEntry || minScoreChangeEntry <= 0)) return recommendations

  const alwaysFireActions = new Set(['sell', 'reduce_exposure'])
  // Entry actions: opening a new position requires a bigger score move than
  // maintaining or trimming an existing one. Evidence (JPM 2019): banding cuts
  // transaction costs more than reducing rebalance frequency.
  const entryActions = new Set(['buy', 'deploy_cash'])

  return recommendations.filter((rec) => {
    // Risk management actions always fire
    if (alwaysFireActions.has(rec.action)) return true
    if (!rec.ticker) return true

    const lastScore = lastScores.get(rec.ticker)
    const lastWeight = lastWeights.get(rec.ticker)
    const currentWeight = currentWeights.get(rec.ticker) ?? 0
    const currentScore = rec.confidence ?? 0

    // No history → always trade (first run or new ticker)
    if (lastScore === undefined || lastWeight === undefined) return true

    // Review fix PR #220: when the base is near zero, relative change
    // explodes (0 → 0.005 = 50% "change" on noise). Use absolute change in
    // that regime so tiny moves off zero don't trigger trades.
    const scoreChange = Math.abs(lastScore) < 0.05
      ? Math.abs(currentScore - lastScore)
      : Math.abs(currentScore - lastScore) / Math.abs(lastScore)
    const weightDrift = Math.abs(lastWeight) < 0.05
      ? Math.abs(currentWeight - lastWeight)
      : Math.abs(currentWeight - lastWeight) / Math.abs(lastWeight)

    // Asymmetric banding: require a larger score change to *enter* a new
    // position than to maintain/trim one. Exits and risk-management actions
    // always pass through above.
    if (minScoreChangeEntry && minScoreChangeEntry > 0 && entryActions.has(rec.action)) {
      return scoreChange > minScoreChangeEntry || weightDrift > minWeightDrift
    }

    return scoreChange > minScoreChange || weightDrift > minWeightDrift
  })
}

/**
 * Estimate transaction costs for a trade.
 *
 * Returns the cost in minor currency units. Used by the simulator to
 * skip trades where the cost exceeds the expected benefit.
 */
export function estimateTransactionCost(
  tradeValueMinor: number,
  spreadBps = 0,
  commissionBps = 0,
  marketImpactBps = 0,
): number {
  const totalBps = spreadBps + commissionBps + marketImpactBps
  return Math.round(tradeValueMinor * totalBps / 10000)
}

// ── Phase 3: Advanced techniques ────────────────────────────────────────────

/**
 * Cross-sectional momentum ranking (Jegadeesh & Titman 1993).
 *
 * Ranks all assets by their score and assigns buy/hold/sell actions
 * based on quartile position. Combined with time-series momentum, this
 * provides both absolute (is it going up?) and relative (is it going up
 * more than the alternatives?) signals.
 *
 * Evidence: +0.1 Sharpe improvement when combined with TS momentum.
 */
export function crossSectionalRank<T extends { ticker: string; score: number }>(
  assets: T[],
  topQuartileThreshold = 0.25,
  bottomQuartileThreshold = 0.75,
): Map<string, 'buy' | 'hold' | 'sell'> {
  const actions = new Map<string, 'buy' | 'hold' | 'sell'>()
  if (assets.length === 0) return actions

  const sorted = [...assets].sort((a, b) => b.score - a.score)
  const n = sorted.length
  const topN = Math.max(1, Math.floor(n * topQuartileThreshold))
  const bottomN = Math.max(1, Math.floor(n * (1 - bottomQuartileThreshold)))

  sorted.forEach((asset, i) => {
    if (i < topN) actions.set(asset.ticker, 'buy')
    else if (i >= n - bottomN) actions.set(asset.ticker, 'sell')
    else actions.set(asset.ticker, 'hold')
  })

  return actions
}

/**
 * Combine time-series and cross-sectional momentum signals.
 *
 * Returns a blended score [0, 1] where:
 * - 1.0 = strong by both TS and CS measures
 * - 0.5 = strong by one, neutral by the other
 * - 0.0 = weak by both
 *
 * The TS weight controls how much the absolute momentum matters vs
 * the relative ranking. Default 0.6/0.4 favors TS (which has stronger
 * academic support) while still rewarding cross-sectional outperformance.
 */
export function blendTsAndCsMomentum(
  tsScore: number,
  csAction: 'buy' | 'hold' | 'sell',
  tsWeight = 0.6,
): number {
  const csScore = csAction === 'buy' ? 0.8 : csAction === 'sell' ? 0.2 : 0.5
  const csWeight = 1 - tsWeight
  return tsScore * tsWeight + csScore * csWeight
}

/**
 * Diversification-adjusted portfolio volatility (review fix PR #220).
 *
 * A weighted average of individual volatilities assumes perfect pairwise
 * correlation (ρ = 1) between all holdings, overestimating the volatility
 * of a diversified equity portfolio by 40–70% and triggering unnecessary
 * de-risking. This applies the standard equal-weight approximation:
 *
 *   σ_p ≈ σ̄ × √(ρ̄ + (1 − ρ̄)/N)
 *
 * where ρ̄ is the assumed average pairwise correlation (default 0.4, typical
 * for large-cap equities) and N is the number of positions. Limits: N = 1
 * → σ̄ (no diversification), N → ∞ → σ̄√ρ̄ ≈ 0.63σ̄.
 */
export function diversificationAdjustedVol(
  weightedAverageVol: number,
  positionCount: number,
  avgPairwiseCorrelation = 0.4,
): number {
  if (positionCount <= 1 || weightedAverageVol <= 0) return weightedAverageVol
  const factor = Math.sqrt(avgPairwiseCorrelation + (1 - avgPairwiseCorrelation) / positionCount)
  return weightedAverageVol * factor
}

/**
 * Google Trends attention signal scorer (Phase 3).
 *
 * Maps a search volume ratio (recent / baseline) to a [0, 1] score.
 * Rising search volume predicts short-term returns (evidence: 43/45
 * stocks in a study showed improved 1-week-ahead forecasts).
 *
 * Mapping:
 *   - 2.0x searches → 1.0 (strong attention spike)
 *   - 1.5x searches → 0.75
 *   - 1.0x searches → 0.5 (neutral, no change)
 *   - 0.5x searches → 0.0 (declining attention)
 */
export function attentionScore(searchVolumeRatio: number | undefined): number {
  if (searchVolumeRatio === undefined) return 0.5 // neutral
  // Map [0.5, 2.0] → [0, 1]
  return Math.max(0, Math.min(1, (searchVolumeRatio - 0.5) / 1.5))
}

/**
 * Residual momentum score (Blitz, Huij & Martens 2011).
 *
 * A stock's total return can be driven by the broad market. Residual
 * momentum ranks stocks by their return *in excess of the market average*,
 * isolating stock-specific momentum. Academic evidence: residual momentum
 * has about **twice the Sharpe ratio** of conventional total-return momentum
 * and suffers fewer momentum crashes, because it avoids stocks that are
 * simply riding a market bubble.
 *
 * This implementation uses the average return of the scored universe as a
 * practical proxy for the market factor. A more sophisticated version would
 * regress each stock against a market index (e.g. SPY) and use the residual.
 *
 * @param rawReturn - this asset's raw return over the lookback window
 * @param allReturns - raw returns of all assets in the scored universe
 * @returns residual return (total return minus average universe return)
 */
export function residualReturn(rawReturn: number, allReturns: number[]): number {
  if (allReturns.length === 0) return rawReturn
  const avg = allReturns.reduce((a, b) => a + b, 0) / allReturns.length
  return rawReturn - avg
}

/**
 * Percentile-rank momentum scoring.
 *
 * Replaces the saturating sigmoid score with a cross-sectional percentile
 * rank. Given an asset's raw return and the array of all raw returns in the
 * universe, returns a score in [0, 1] representing the fraction of assets
 * this asset outperforms.
 *
 * Unlike sigmoidMomentumScore (which saturates at ~0.95 for returns above
 * +30%), percentileRankScore preserves ordering in the tail: a stock up 150%
 * ranks higher than one up 35%, so it scores higher. This is critical for
 * momentum strategies that need to concentrate capital in the strongest
 * trends, not treat all "good" stocks as equal.
 *
 * Also regime-adaptive: in a bear market where everything is down, the
 * least-bad stocks still rank high. The sigmoid would score all of them
 * near zero, making the strategy unable to distinguish relative strength.
 *
 * Uses linear interpolation between ranks so the score is continuous (not
 * stepped), which avoids whipsaw at rank boundaries.
 *
 * @param rawReturn - this asset's raw return over the lookback window
 * @param allReturns - raw returns of all assets in the scored universe
 * @returns percentile score in [0, 1], or 0.5 if fewer than 2 assets
 */
export function percentileRankScore(rawReturn: number, allReturns: number[]) {
  if (allReturns.length < 2) return 0.5 // neutral when no peers to rank against
  const sorted = [...allReturns].sort((a, b) => a - b)
  // Count how many returns are strictly below this one
  let below = 0
  let equal = 0
  for (const r of sorted) {
    if (r < rawReturn) below++
    else if (r === rawReturn) equal++
  }
  // Linear interpolation: (below + 0.5 * equal) / n
  // This places tied assets at the midpoint of their rank group,
  // producing a continuous score rather than stepped.
  return (below + 0.5 * equal) / sorted.length
}

// ── Phase 4: Kelly criterion position sizing ─────────────────────────────────

/**
 * Trade outcome record for Kelly edge estimation.
 *
 * In a production system these would be populated from the closed-trade
 * history (fill price → eventual exit price). Until enough live trades
 * accumulate, the Kelly function falls back to academic default parameters
 * for cross-sectional momentum strategies.
 */
export interface TradeOutcome {
  ticker: string
  /** Realized return as a fraction (e.g. 0.05 = +5%, -0.03 = -3%). */
  return: number
  /** Whether the trade was profitable. */
  win: boolean
}

/**
 * Result of Kelly edge estimation.
 */
export interface KellyEstimate {
  /** Fraction of capital to allocate per position (0-1). */
  kellyFraction: number
  /** Estimated win rate (0-1). */
  winRate: number
  /** Estimated win/loss ratio (average win / average loss). */
  winLossRatio: number
  /** Number of trades used for estimation. */
  sampleSize: number
  /** True when using fallback defaults rather than live trade history. */
  usingDefaults: boolean
}

/**
 * Default momentum strategy parameters from academic literature.
 *
 * - Win rate ~55%: Jegadeesh & Titman (1993, 2001) find that 55-60% of
 *   momentum trades are profitable.
 * - Win/loss ratio ~1.3: Asness, Moskowitz, Pedersen (2013) find average
 *   winner return is ~1.3x average loser return for cross-sectional momentum.
 *
 * These yield a full Kelly fraction of ~20% per position, which is
 * consistent with the academic momentum literature's recommended
 * concentration level.
 */
const DEFAULT_WIN_RATE = 0.55
const DEFAULT_WIN_LOSS_RATIO = 1.3

/**
 * Compute the Kelly criterion fraction from trade history.
 *
 * f* = (p * b - q) / b
 *
 * where p = win rate, q = 1-p, b = win/loss ratio.
 *
 * The result is scaled by `kellyScale` (default 0.5 = Half-Kelly) to
 * reduce drawdown risk while capturing most of the growth rate. Half-Kelly
 * achieves ~75% of the optimal growth rate with ~50% of the drawdown.
 *
 * When fewer than `minTrades` outcomes are provided, falls back to the
 * academic default parameters above.
 *
 * @param outcomes - Closed trade history (filled + exited trades)
 * @param kellyScale - Fraction of full Kelly to use (0.5 = half, 1.0 = full)
 * @param minTrades - Minimum trades required before using live data
 */
export function computeKellyFraction(
  outcomes: TradeOutcome[],
  kellyScale = 0.5,
  minTrades = 20,
): KellyEstimate {
  if (outcomes.length < minTrades) {
    // Use academic defaults
    const p = DEFAULT_WIN_RATE
    const b = DEFAULT_WIN_LOSS_RATIO
    const q = 1 - p
    const fullKelly = (p * b - q) / b
    return {
      kellyFraction: Math.max(0, fullKelly * kellyScale),
      winRate: p,
      winLossRatio: b,
      sampleSize: outcomes.length,
      usingDefaults: true,
    }
  }

  // Compute from live trade history
  const wins = outcomes.filter((o) => o.win)
  const losses = outcomes.filter((o) => !o.win)
  const winRate = wins.length / outcomes.length
  const avgWin = wins.length > 0
    ? wins.reduce((s, o) => s + o.return, 0) / wins.length
    : 0
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((s, o) => s + o.return, 0) / losses.length)
    : 0
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 2.0 : 1.0

  const p = winRate
  const b = winLossRatio
  const q = 1 - p
  const fullKelly = (p * b - q) / b

  return {
    kellyFraction: Math.max(0, fullKelly * kellyScale),
    winRate,
    winLossRatio,
    sampleSize: outcomes.length,
    usingDefaults: false,
  }
}

/**
 * Kelly-scaled target weight for a position.
 *
 * Scales the base target weight (from maxPositionWeight) by the Kelly
 * fraction, but never exceeds the base target. Kelly reduces position
 * sizes when the edge is small or uncertain, and increases them toward
 * the full target when the edge is strong.
 *
 * @param baseWeightPct - Base target weight as a percentage (e.g. 40 = 40%)
 * @param kelly - Kelly estimate from computeKellyFraction
 * @param confidence - Per-ticker confidence score [0, 1]
 * @returns Target weight as a percentage of portfolio
 */
export function kellyScaledWeight(
  baseWeightPct: number,
  kelly: KellyEstimate,
  confidence = 0.5,
): number {
  // Kelly fraction is the optimal fraction of capital per position.
  // Scale it by the ticker's confidence so higher-conviction picks get
  // a larger fraction of the Kelly allocation.
  const scaledFraction = kelly.kellyFraction * (0.5 + 0.5 * confidence)
  // Convert to a percentage and cap at the base weight
  const kellyWeightPct = scaledFraction * 100
  return Math.min(kellyWeightPct, baseWeightPct)
}

// ── Phase 5: Advanced risk management ────────────────────────────────────────

/**
 * Average True Range (ATR) — measures average price movement per period.
 *
 * Since PricePoint only has close prices (no high/low), we approximate TR
 * as the daily absolute return. This is a lower bound on true ATR but
 * captures the same volatility information for stop-loss purposes.
 *
 * @param history Price history
 * @param period ATR lookback period (default 14 days)
 * @returns ATR as a fraction of current price (e.g. 0.03 = 3% daily move)
 */
export function averageTrueRangePct(history: PricePoint[], period = 14): number {
  if (history.length < period + 1) return 0
  const returns = dailyReturns(history.slice(-period - 1))
  if (returns.length === 0) return 0
  const avgAbsReturn = returns.reduce((s, r) => s + Math.abs(r), 0) / returns.length
  return avgAbsReturn
}

/**
 * ATR-based trailing stop level for a given stock.
 *
 * Instead of a fixed percentage (e.g. 30%), the stop adapts to each stock's
 * volatility. A calm stock (ATR 1%) gets a tighter stop (e.g. 15%), while
 * a volatile stock (ATR 4%) gets a wider stop (e.g. 50%).
 *
 * Formula: stopPct = max(minStop, min(maxStop, atrMultiplier * ATR * sqrt(holdingDays)))
 *
 * The sqrt(holdingDays) term scales the stop for the expected holding period
 * — a longer hold needs a wider stop because price ranges widen over time.
 *
 * @param history Price history
 * @param atrMultiplier Multiplier on ATR (default 3.0 = 3x ATR)
 * @param holdingDays Expected holding period in days (default 63 = ~3 months)
 * @param minStop Minimum stop percentage (default 0.10 = 10%)
 * @param maxStop Maximum stop percentage (default 0.50 = 50%)
 * @returns Stop percentage (e.g. 0.25 = sell if price drops 25% from HWM)
 */
export function atrBasedStopPct(
  history: PricePoint[],
  atrMultiplier = 3.0,
  holdingDays = 63,
  minStop = 0.10,
  maxStop = 0.50,
): number {
  const atr = averageTrueRangePct(history, 14)
  if (atr <= 0) return minStop
  // Scale ATR by sqrt of holding days (volatility scales with sqrt of time)
  const scaledAtr = atr * Math.sqrt(holdingDays) * atrMultiplier
  return Math.max(minStop, Math.min(maxStop, scaledAtr))
}

/**
 * Market volatility regime detector for dynamic rebalancing.
 *
 * Returns the recommended rebalance frequency based on market volatility:
 * - Low vol (VIX < 15): monthly (calm markets, less churn)
 * - Medium vol (15-25): bi-weekly (normal conditions)
 * - High vol (VIX > 25): weekly (fast-moving markets, react quicker)
 *
 * Uses the benchmark index's realized volatility as a VIX proxy.
 *
 * @param indexHistory Price history of the market index (e.g. SPY)
 * @returns Recommended days between rebalances
 */
export function dynamicRebalanceIntervalDays(indexHistory: PricePoint[]): number {
  if (indexHistory.length < 21) return 30 // default monthly
  const returns = dailyReturns(indexHistory.slice(-21))
  const rv = realizedVolatility(returns)
  // Annualized vol: daily vol * sqrt(252)
  const annualizedVol = rv * Math.sqrt(252)
  if (annualizedVol > 0.35) return 7   // high vol → weekly
  if (annualizedVol > 0.20) return 14  // medium vol → bi-weekly
  return 30                              // low vol → monthly
}

/**
 * Bear regime hedge allocation.
 *
 * When the market regime detector indicates a bear market, this function
 * returns the recommended allocation to an inverse ETF (e.g. SH, PSQ)
 * to hedge long exposure. Returns 0 in non-bear regimes.
 *
 * @param regime Market regime ('bull', 'bear', 'sideways')
 * @param maxHedgePct Maximum hedge allocation (default 0.30 = 30%)
 * @returns Recommended hedge allocation as a fraction (0-1)
 */
export function bearRegimeHedgeAllocation(
  regime: 'bull' | 'bear' | 'sideways',
  maxHedgePct = 0.30,
): number {
  if (regime === 'bear') return maxHedgePct
  if (regime === 'sideways') return maxHedgePct * 0.3 // small hedge in sideways
  return 0 // no hedge in bull market
}
