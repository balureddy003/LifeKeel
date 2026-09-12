/**
 * Phase 4: ML feature engineering and ensemble model.
 *
 * Implements a feature extraction pipeline and a linear ensemble model
 * that combines all Phase 1-3 signals into a single predicted return.
 *
 * Based on Gu, Kelly, Xiu (2020) "Empirical Asset Pricing via Machine
 * Learning" — even linear models with good features improve Sharpe
 * significantly. This implementation uses a regularized linear regression
 * (ridge) that can be trained via walk-forward validation.
 *
 * No external ML dependencies — pure TypeScript implementation of:
 *   - Feature extraction from price history + market data
 *   - Ridge regression (L2-regularized linear model)
 *   - Walk-forward training and prediction
 *   - Feature importance / coefficient inspection
 *
 * The model is designed to be retrained weekly on rolling 2-year windows
 * and produce a 5-day forward return prediction per ticker.
 */

import type { MarketData, PricePoint } from './types.js'
import {
  volatilityScale,
  week52HighScore,
  multiTimeframeMomentumScore,
  marketStateGate,
  computeADX,
  dailyReturns,
  realizedVolatility,
  returnOverWindow,
  sigmoidMomentumScore,
} from './strategy-enhancements.js'

/**
 * Feature vector extracted from a single ticker's market data.
 * All features are normalized to roughly [0, 1] or [-1, 1] for stable
 * regression training.
 */
export interface FeatureVector {
  ticker: string
  features: number[]
  featureNames: string[]
}

/**
 * Standard feature names (in order). Used for model serialization
 * and feature importance inspection.
 */
export const FEATURE_NAMES = [
  'momentum_fast',           // 40-day return (sigmoid-mapped)
  'momentum_medium',          // 100-day return (sigmoid-mapped)
  'momentum_slow',            // 252-day return (sigmoid-mapped)
  'week52_high',              // nearness to 52-week high [0, 1]
  'volatility_scale',         // vol scaling factor [0.2, 2.0]
  'realized_vol',             // annualized realized vol (raw)
  'adx',                      // trend strength [0, 100]
  'market_state_gate',        // market gate scale [0, 1]
  'sentiment',                // news sentiment [0, 1]
  'attention',                // Google Trends attention [0, 1]
  'quality_roe',              // ROE (raw fraction)
  'quality_margin',           // gross margin (raw fraction)
  'quality_leverage',         // 1 - debt/equity (clamped)
  'sharpe_proxy',             // momentum / volatility
] as const

/**
 * Extract a feature vector from a ticker's market data.
 *
 * Missing features (no fundamentals, no sentiment, etc.) are filled
 * with neutral values (0.5 for scores, 0 for raw values) so the model
 * can still make predictions with partial data.
 */
export function extractFeatures(
  ticker: string,
  md: MarketData,
  marketIndexHistory?: PricePoint[],
): FeatureVector {
  const history = md.history
  const features: number[] = []

  // Momentum signals (sigmoid-mapped to [0, 0.95])
  const fastRet = returnOverWindow(history, 40, 5)
  const mediumRet = returnOverWindow(history, 100, 21)
  const slowRet = returnOverWindow(history, 252, 21)
  features.push(sigmoidClamp(fastRet))
  features.push(sigmoidClamp(mediumRet))
  features.push(sigmoidClamp(slowRet))

  // 52-week high [0, 1]
  features.push(week52HighScore(history))

  // Volatility scale [0.2, 2.0] → normalize to [0, 1]
  const volScale = volatilityScale(history, 0.12, 126, 0.2, 2.0)
  features.push((volScale - 0.2) / 1.8)

  // Realized volatility, normalized (review fix PR #220: raw features with
  // larger scales dominate ridge regression — all features must be ~[0,1]).
  // 50% annualized vol = max score.
  const returns = dailyReturns(history.slice(-126))
  const realizedVol = realizedVolatility(returns)
  features.push(Math.max(0, Math.min(1, realizedVol / 0.50)))

  // ADX [0, 100] → normalize to [0, 1]
  const adx = computeADX(history, 14)
  features.push(adx / 100)

  // Market state gate [0, 1]
  const gate = marketIndexHistory
    ? marketStateGate(marketIndexHistory)
    : 1
  features.push(gate)

  // Sentiment [0, 1] — neutral 0.5 if no data
  features.push(md.sentimentScore ?? 0.5)

  // Attention [0, 1] — neutral 0.5 if no data
  features.push(md.attentionSignal ?? 0.5)

  // Quality metrics, normalized — neutral if no data (review fix PR #220:
  // these were raw fractions, e.g. ROE 0.25 vs [0,1] scores, biasing the
  // ridge weights toward whichever features happened to have larger scale).
  // 30% ROE and 80% gross margin are the max-score reference points.
  features.push(md.roe !== undefined ? Math.max(0, Math.min(1, md.roe / 0.30)) : 0.5)
  features.push(md.grossMargin !== undefined ? Math.max(0, Math.min(1, md.grossMargin / 0.80)) : 0.5)
  features.push(md.debtToEquity !== undefined ? Math.max(0, Math.min(1, 1 - md.debtToEquity / 2)) : 0.5)

  // Sharpe proxy: momentum / volatility (risk-adjusted momentum), soft-
  // clamped to [0, 1] via s/(1+|s|) remapped from (-1, 1).
  const sharpeRaw = realizedVol > 0 ? slowRet / realizedVol : 0
  const sharpeSoft = sharpeRaw / (1 + Math.abs(sharpeRaw))
  features.push((sharpeSoft + 1) / 2)

  return { ticker, features, featureNames: [...FEATURE_NAMES] }
}

function sigmoidClamp(rawReturn: number): number {
  // Shared continuous curve (review fix PR #220: the previous local copy of
  // the two-piece curve had the same zero-crossing discontinuity).
  return sigmoidMomentumScore(rawReturn)
}

/**
 * Ridge regression model (L2-regularized linear regression).
 *
 * Trained via the normal equation: w = (X^T X + λI)^-1 X^T y
 * No gradient descent needed — closed-form solution is exact and fast
 * for the small feature counts (~14 features) used here.
 */
export interface RidgeModel {
  weights: number[]
  bias: number
  featureNames: string[]
  lambda: number
  trainedAt: string
  samples: number
}

/**
 * Train a ridge regression model on a set of feature vectors and targets.
 *
 * @param X - Feature matrix [n_samples, n_features]
 * @param y - Target vector [n_samples] (e.g. 5-day forward returns)
 * @param lambda - L2 regularization strength (default 0.01)
 * @param featureNames - Feature names for serialization
 */
export function trainRidge(
  X: number[][],
  y: number[],
  lambda = 0.01,
  featureNames: string[] = [...FEATURE_NAMES],
): RidgeModel {
  const n = X.length
  const d = X[0]?.length ?? 0
  if (n === 0 || d === 0) {
    return { weights: [], bias: 0, featureNames, lambda, trainedAt: new Date().toISOString(), samples: 0 }
  }

  // Add bias term: augment X with a column of 1s
  const Xaug = X.map((row) => [1, ...row])

  // Compute X^T X (d+1 × d+1)
  const XtX = matMul(transpose(Xaug), Xaug)

  // Add L2 regularization (don't regularize the bias term)
  for (let i = 0; i <= d; i++) {
    XtX[i]![i]! += i === 0 ? 0 : lambda
  }

  // Compute X^T y
  const Xty = matVecMul(transpose(Xaug), y)

  // Solve (X^T X + λI) w = X^T y via Gaussian elimination
  const w = solveLinearSystem(XtX, Xty)

  return {
    weights: w.slice(1), // exclude bias
    bias: w[0] ?? 0,
    featureNames,
    lambda,
    trainedAt: new Date().toISOString(),
    samples: n,
  }
}

/**
 * Predict using a trained ridge model.
 */
export function predictRidge(model: RidgeModel, features: number[]): number {
  if (model.weights.length === 0) return 0
  let pred = model.bias
  for (let i = 0; i < model.weights.length && i < features.length; i++) {
    pred += model.weights[i]! * features[i]!
  }
  return pred
}

/**
 * Walk-forward training and prediction.
 *
 * Trains the model on the first `trainSize` samples, predicts the next
 * sample, then rolls forward by one sample. Returns predictions aligned
 * with the actual targets for out-of-sample evaluation.
 *
 * This is the correct way to evaluate a trading model — training on
 * past data only, never leaking future information.
 */
export function walkForwardPredict(
  X: number[][],
  y: number[],
  trainSize: number,
  lambda = 0.01,
  retrainEvery = 20,
): { predictions: number[]; actuals: number[]; model: RidgeModel } {
  const predictions: number[] = []
  const actuals: number[] = []
  let lastModel: RidgeModel = { weights: [], bias: 0, featureNames: [...FEATURE_NAMES], lambda, trainedAt: '', samples: 0 }

  // Retrain every `retrainEvery` steps rather than every step (review fix
  // PR #220: per-step retraining is O(n²) and unnecessary — model weights
  // drift slowly). Set retrainEvery = 1 for the strictest no-leakage
  // evaluation at higher compute cost.
  for (let i = trainSize; i < X.length; i++) {
    if (i === trainSize || (i - trainSize) % retrainEvery === 0) {
      const Xtrain = X.slice(0, i)
      const ytrain = y.slice(0, i)
      lastModel = trainRidge(Xtrain, ytrain, lambda)
    }
    const pred = predictRidge(lastModel, X[i]!)
    predictions.push(pred)
    actuals.push(y[i]!)
  }

  return { predictions, actuals, model: lastModel }
}

/**
 * Compute out-of-sample Sharpe ratio from walk-forward predictions.
 *
 * The strategy: go long when prediction > 0, short when < 0 (or just
 * hold cash if long-only). Returns are prediction-aligned.
 */
export function computeOutOfSampleSharpe(
  predictions: number[],
  actuals: number[],
  longOnly = true,
  returnHorizonDays = 1,
): { sharpe: number; meanReturn: number; stdReturn: number; n: number } {
  if (predictions.length === 0) {
    return { sharpe: 0, meanReturn: 0, stdReturn: 0, n: 0 }
  }

  const strategyReturns: number[] = []
  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i]!
    const actual = actuals[i]!
    if (longOnly) {
      if (pred > 0) strategyReturns.push(actual)
      else strategyReturns.push(0) // hold cash
    } else {
      strategyReturns.push(pred > 0 ? actual : -actual)
    }
  }

  const n = strategyReturns.length
  const mean = strategyReturns.reduce((a, b) => a + b, 0) / n
  const variance = strategyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / n
  const std = Math.sqrt(variance)
  // Review fix PR #220: annualization must match the return horizon. The
  // model predicts `returnHorizonDays`-day forward returns, so there are
  // 252/horizon independent periods per year — using sqrt(252) for 5-day
  // returns overstates Sharpe by ~2.2x.
  const periodsPerYear = 252 / Math.max(1, returnHorizonDays)
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(periodsPerYear) : 0

  return { sharpe, meanReturn: mean, stdReturn: std, n }
}

// ── Linear algebra helpers ──────────────────────────────────────────────────

function transpose(m: number[][]): number[][] {
  if (m.length === 0 || m[0] === undefined || m[0].length === 0) return []
  return m[0]!.map((_, j) => m.map((row) => row[j]!))
}

function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length
  const cols = b[0]?.length ?? 0
  const inner = b.length
  if (rows > 0 && (a[0]?.length ?? 0) !== inner) {
    throw new Error(`Matrix dimension mismatch: a is ${rows}x${a[0]?.length ?? 0}, b is ${inner}x${cols}`)
  }
  const result: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      for (let k = 0; k < inner; k++) {
        result[i]![j]! += a[i]![k]! * b[k]![j]!
      }
    }
  }
  return result
}

function matVecMul(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((sum, val, j) => sum + val * (v[j] ?? 0), 0))
}

/**
 * Solve a linear system Ax = b via Gaussian elimination with partial pivoting.
 * Returns x. Handles small systems (d < 100) efficiently.
 *
 * Throws on a singular/near-singular matrix (review fix PR #220: the old
 * `pivot || 1` fallback silently returned wrong weights for collinear
 * features — dangerous in a financial model). With ridge regularization
 * (lambda > 0) the matrix is guaranteed non-singular, so this only fires
 * when lambda = 0 with collinear features — a configuration error worth
 * surfacing loudly.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length
  // Augmented matrix [A | b]
  const aug: number[][] = A.map((row, i) => [...row, b[i] ?? 0])

  // Forward elimination with partial pivoting
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k]![i]!) > Math.abs(aug[maxRow]![i]!)) maxRow = k
    }
    [aug[i], aug[maxRow]] = [aug[maxRow]!, aug[i]!]

    const pivot = aug[i]![i]!
    if (Math.abs(pivot) < 1e-10) {
      throw new Error('Singular or near-singular feature matrix — check for collinear features or increase lambda')
    }

    // Eliminate below
    for (let k = i + 1; k < n; k++) {
      const factor = aug[k]![i]! / pivot
      for (let j = i; j <= n; j++) {
        aug[k]![j]! -= factor * aug[i]![j]!
      }
    }
  }

  // Back substitution
  const x: number[] = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i]![n]!
    for (let j = i + 1; j < n; j++) {
      sum -= aug[i]![j]! * x[j]!
    }
    const pivot = aug[i]![i]!
    if (Math.abs(pivot) < 1e-10) {
      throw new Error('Singular or near-singular feature matrix — check for collinear features or increase lambda')
    }
    x[i] = sum / pivot
  }
  return x
}

/**
 * Reduced feature set for fast cross-sectional ML scoring inside the live
 * momentum engine. Uses only price-derived features so no external data is
 * required and the calculation stays fast enough for a Cloud Run rebalance.
 */
const FAST_ML_FEATURE_NAMES = [
  'momentum_fast',    // 21-day sigmoid-mapped return
  'momentum_medium',  // 63-day sigmoid-mapped return
  'momentum_slow',    // 126-day sigmoid-mapped return
  'week52_high',      // nearness to 52-week high
  'realized_vol',     // annualized realized vol [0,1]
  'adx',              // trend strength [0,1]
  'sharpe_proxy',     // momentum / volatility
]

/**
 * Compute a fast, cross-sectional ML signal for every ticker in the universe.
 *
 * Methodology (Phase 3):
 * 1. For each ticker, compute a small set of price-derived features using the
 *    most recent history.
 * 2. Use the most recent `forwardDays` return as the target (momentum
 *    continuation assumption: features that explained recent relative returns
 *    are likely to continue explaining them over the next rebalance horizon).
 * 3. Train a ridge regression across all tickers on the current cross-section.
 * 4. Return the predicted return for each ticker, normalized to [0, 1].
 *
 * This is a lightweight, no-dependency ensemble signal. It does not require a
 * persisted model or historical training database because it retrains on every
 * rebalance using only the current price histories.
 *
 * @param marketData - Market data for all tickers
 * @param forwardDays - Forward return horizon used as target (default 5)
 * @param lambda - Ridge regularization strength (default 0.1)
 * @param minSamples - Minimum tickers required to train (default 8)
 */
export function computeCrossSectionalMlSignal(
  marketData: Map<string, MarketData>,
  forwardDays = 5,
  lambda = 0.1,
  minSamples = 8,
): Map<string, number> {
  const scores = new Map<string, number>()
  const samples: { ticker: string; features: number[]; target: number }[] = []

  for (const [ticker, md] of marketData) {
    const history = md.history
    if (history.length < forwardDays + 22) continue

    const fastRet = returnOverWindow(history, 21, 0)
    const mediumRet = returnOverWindow(history, 63, 0)
    const slowRet = returnOverWindow(history, 126, 0)
    const features: number[] = [
      sigmoidClamp(fastRet),
      sigmoidClamp(mediumRet),
      sigmoidClamp(slowRet),
      week52HighScore(history),
      Math.max(0, Math.min(1, realizedVolatility(dailyReturns(history.slice(-126))) / 0.50)),
      computeADX(history, 14) / 100,
      (() => {
        const vol = realizedVolatility(dailyReturns(history.slice(-126)))
        const sharpeRaw = vol > 0 ? slowRet / vol : 0
        const sharpeSoft = sharpeRaw / (1 + Math.abs(sharpeRaw))
        return (sharpeSoft + 1) / 2
      })(),
    ]

    // Target: most recent forwardDays return (momentum continuation)
    const startPrice = history[history.length - forwardDays - 1]?.close
    const endPrice = history[history.length - 1]?.close
    if (!startPrice || !endPrice || startPrice <= 0) continue
    const target = (endPrice - startPrice) / startPrice

    samples.push({ ticker, features, target })
  }

  if (samples.length < minSamples) {
    // Not enough data: return neutral scores
    for (const s of samples) scores.set(s.ticker, 0.5)
    return scores
  }

  // Train ridge regression on the cross-section
  const X = samples.map((s) => s.features)
  const y = samples.map((s) => s.target)
  const model = trainRidge(X, y, lambda, FAST_ML_FEATURE_NAMES)

  if (model.weights.length === 0) {
    for (const s of samples) scores.set(s.ticker, 0.5)
    return scores
  }

  // Predict and collect predictions
  const predictions: { ticker: string; pred: number }[] = []
  for (const s of samples) {
    predictions.push({ ticker: s.ticker, pred: predictRidge(model, s.features) })
  }

  // Normalize predictions to [0, 1] using min-max across the universe
  const minPred = Math.min(...predictions.map((p) => p.pred))
  const maxPred = Math.max(...predictions.map((p) => p.pred))
  const range = maxPred - minPred
  for (const p of predictions) {
    const normalized = range > 1e-10 ? (p.pred - minPred) / range : 0.5
    scores.set(p.ticker, Math.max(0, Math.min(1, normalized)))
  }

  return scores
}

/**
 * Get feature importance from a trained model.
 * Returns the absolute weight of each feature, normalized to sum to 1.
 */
export function featureImportance(model: RidgeModel): Map<string, number> {
  const importances = new Map<string, number>()
  const absWeights = model.weights.map((w) => Math.abs(w))
  const total = absWeights.reduce((a, b) => a + b, 0)
  if (total === 0) {
    for (const name of model.featureNames) importances.set(name, 0)
    return importances
  }
  model.featureNames.forEach((name, i) => {
    importances.set(name, absWeights[i]! / total)
  })
  return importances
}
