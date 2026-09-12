/**
 * GET /analytics/* — insight trend data for the Studio dashboard
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getInsightsCollection } from '../db.js'

export async function registerAnalyticsRoutes(app: FastifyInstance, db?: Db): Promise<void> {
  /** GET /analytics/trend?days=14 — daily insight counts + value */
  app.get('/analytics/trend', async (request, reply) => {
    const { tenant_id } = request.authContext
    const days = Number((request.query as Record<string, string>).days ?? 14)

    const col = await getInsightsCollection()
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const raw = await col
      .find({ tenant_id, created_at: { $gte: since } } as Parameters<typeof col.find>[0])
      .toArray()

    // Build day buckets
    const buckets: Record<string, { date: string; total: number; approved: number; dismissed: number; value_low: number; value_high: number }> = {}
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10)
      buckets[key] = { date: key, total: 0, approved: 0, dismissed: 0, value_low: 0, value_high: 0 }
    }

    for (const doc of raw) {
      // created_at is stored as a native BSON Date, not a string — String(dateObj)
      // produces JS's verbose toString() format ("Fri Jul 11 2026 GMT+...")
      // rather than ISO, which never matched the ISO-format bucket keys above,
      // so every doc was silently dropped and the trend chart always read zero.
      const createdAt = doc['created_at'] instanceof Date ? doc['created_at'] : new Date(String(doc['created_at']))
      const key = createdAt.toISOString().slice(0, 10)
      if (!buckets[key]) continue
      buckets[key]!.total++
      if (doc['state'] === 'completed') buckets[key]!.approved++
      if (doc['state'] === 'dismissed') buckets[key]!.dismissed++
      buckets[key]!.value_low += Number(doc['estimated_impact_low'] ?? 0)
      buckets[key]!.value_high += Number(doc['estimated_impact_high'] ?? 0)
    }

    return reply.send({ trend: Object.values(buckets) })
  })

  /** GET /analytics/by-category — breakdown per category */
  app.get('/analytics/by-category', async (request, reply) => {
    const { tenant_id } = request.authContext
    const col = await getInsightsCollection()

    const pipeline = [
      { $match: { tenant_id } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          value_low: { $sum: '$estimated_impact_low' },
          value_high: { $sum: '$estimated_impact_high' },
          approved: { $sum: { $cond: [{ $eq: ['$state', 'completed'] }, 1, 0] } },
        },
      },
      { $sort: { count: -1 } },
    ]

    const docs = await col.aggregate(pipeline).toArray()
    return reply.send({
      categories: docs.map((d) => ({
        category: d['_id'],
        count: d['count'],
        value_low: d['value_low'],
        value_high: d['value_high'],
        approved: d['approved'],
      })),
    })
  })

  /** GET /analytics/by-urgency — breakdown per urgency */
  app.get('/analytics/by-urgency', async (request, reply) => {
    const { tenant_id } = request.authContext
    const col = await getInsightsCollection()

    const pipeline = [
      { $match: { tenant_id } },
      {
        $group: {
          _id: '$urgency',
          count: { $sum: 1 },
          value_low: { $sum: '$estimated_impact_low' },
          value_high: { $sum: '$estimated_impact_high' },
        },
      },
    ]

    const docs = await col.aggregate(pipeline).toArray()
    return reply.send({
      urgencies: docs.map((d) => ({
        urgency: d['_id'],
        count: d['count'],
        value_low: d['value_low'],
        value_high: d['value_high'],
      })),
    })
  })

  /** GET /analytics/by-detector — per-detector insight counts */
  app.get('/analytics/by-detector', async (request, reply) => {
    const { tenant_id } = request.authContext
    const col = await getInsightsCollection()

    const pipeline = [
      { $match: { tenant_id } },
      {
        $group: {
          _id: '$detector_id',
          count: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$state', 'completed'] }, 1, 0] } },
          dismissed: { $sum: { $cond: [{ $eq: ['$state', 'dismissed'] }, 1, 0] } },
          avg_confidence: { $avg: '$confidence_breakdown.combined_score' },
        },
      },
      { $sort: { count: -1 } },
    ]

    const docs = await col.aggregate(pipeline).toArray()
    return reply.send({
      detectors: docs.map((d) => ({
        detector_id: d['_id'],
        count: d['count'],
        approved: d['approved'],
        dismissed: d['dismissed'],
        avg_confidence: d['avg_confidence'] ?? 0,
        approval_rate: d['count'] > 0 ? d['approved'] / d['count'] : 0,
      })),
    })
  })

  /** GET /analytics/summary — headline KPIs */
  app.get('/analytics/summary', async (request, reply) => {
    const { tenant_id } = request.authContext
    const col = await getInsightsCollection()

    const [totals] = await col.aggregate([
      { $match: { tenant_id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$state', 'completed'] }, 1, 0] } },
          dismissed: { $sum: { $cond: [{ $eq: ['$state', 'dismissed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $in: ['$state', ['identified', 'sent']] }, 1, 0] } },
          total_value_low: { $sum: '$estimated_impact_low' },
          total_value_high: { $sum: '$estimated_impact_high' },
          // Detector rules commonly hardcode impact_low: 0 as a conservative
          // floor ("at minimum, £0"), so summing low alone renders "Total
          // Value" as a permanent £0 regardless of real upside — the
          // midpoint (same convention insights/page.tsx's computeKPIs()
          // already uses for its own total) is the meaningful headline figure.
          total_value_mid: { $sum: { $divide: [{ $add: ['$estimated_impact_low', '$estimated_impact_high'] }, 2] } },
        },
      },
    ]).toArray()

    // Calculate safe action rate from action_receipts
    let safeActionRate: number | null = null
    let actionReceiptCount30d = 0
    
    if (db) {
      const receiptSummary = await db.collection('action_receipts').aggregate([
        { $match: { tenant_id, executed_at: { $gte: new Date(Date.now() - 30 * 864e5) } } },
        { $group: {
          _id: null,
          total: { $sum: 1 },
          safe: { $sum: { $cond: [{ $in: ['$status', ['accepted', 'confirmed']] }, 1, 0] } },
        }},
      ]).toArray()
      
      if (receiptSummary.length > 0 && receiptSummary[0].total > 0) {
        safeActionRate = receiptSummary[0].safe / receiptSummary[0].total
        actionReceiptCount30d = receiptSummary[0].total
      }
    }

    return reply.send({
      total: totals?.['total'] ?? 0,
      approved: totals?.['approved'] ?? 0,
      dismissed: totals?.['dismissed'] ?? 0,
      pending: totals?.['pending'] ?? 0,
      total_value_low: totals?.['total_value_low'] ?? 0,
      total_value_high: totals?.['total_value_high'] ?? 0,
      total_value_mid: Math.round(totals?.['total_value_mid'] ?? 0),
      approval_rate: (totals?.['total'] ?? 0) > 0 ? (totals?.['approved'] ?? 0) / (totals?.['total'] ?? 1) : 0,
      safe_action_rate: safeActionRate,
      action_receipt_count_30d: actionReceiptCount30d,
    })
  })

  /** GET /analytics/convergence-score — composite score (0-100) */
  app.get('/analytics/convergence-score', async (request, reply) => {
    const { tenant_id } = request.authContext
    const col = await getInsightsCollection()

    // Get 30-day stats
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [stats] = await col.aggregate([
      { $match: { tenant_id, created_at: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$state', 'completed'] }, 1, 0] } },
          dismissed: { $sum: { $cond: [{ $eq: ['$state', 'dismissed'] }, 1, 0] } },
          avg_confidence: { $avg: '$confidence_breakdown.combined_score' },
        },
      },
    ]).toArray()

    const total = stats?.['total'] ?? 0
    const approved = stats?.['approved'] ?? 0
    const approvalRate = total > 0 ? approved / total : 0
    const calibrationAccuracy = stats?.['avg_confidence'] ?? 0

    // Get detector evaluations for F1 trend
    let f1Trend = 0
    if (db) {
      const evals = await db.collection('detector_evaluations')
        .find({ tenant_id })
        .sort({ evaluated_at: -1 })
        .limit(2)
        .toArray()
      if (evals.length >= 2) {
        f1Trend = evals[0]!.f1 - evals[1]!.f1
      } else if (evals.length === 1) {
        f1Trend = evals[0]!.f1 - 0.5 // compare to baseline
      }
    }

    // Compute score components
    const approvalScore = Math.min(30, Math.round(approvalRate * 30))
    const calibrationScore = Math.min(25, Math.round(calibrationAccuracy * 25))
    const f1TrendScore = Math.min(20, Math.max(0, Math.round((f1Trend + 0.2) * 50)))
    const costEfficiencyScore = 20 // placeholder — would compute from actual cost data

    const score = approvalScore + calibrationScore + f1TrendScore + costEfficiencyScore

    const trend: 'up' | 'down' | 'stable' = f1Trend > 0.05 ? 'up' : f1Trend < -0.05 ? 'down' : 'stable'
    const interpretation = trend === 'up'
      ? 'Your system is improving quickly'
      : trend === 'down'
      ? 'System performance needs attention'
      : 'Your system is holding steady'

    // Store weekly snapshot
    if (db) {
      await db.collection('convergence_scores').insertOne({
        tenant_id,
        score,
        components: {
          approval_rate: approvalScore,
          calibration_accuracy: calibrationScore,
          f1_trend: f1TrendScore,
          cost_efficiency: costEfficiencyScore,
        },
        trend,
        interpretation,
        created_at: new Date(),
      })
    }

    return reply.send({
      score,
      components: {
        approval_rate: approvalScore,
        calibration_accuracy: calibrationScore,
        f1_trend: f1TrendScore,
        cost_efficiency: costEfficiencyScore,
      },
      trend,
      interpretation,
    })
  })

  /** GET /analytics/trust-metrics — per-detector accuracy, calibration, and track record
   *  D5/D6: Aggregation layer for trust indicators. Used by both the internal
   *  analytics dashboard and user-facing trust badges on insight cards. */
  app.get('/analytics/trust-metrics', async (request, reply) => {
    const { tenant_id } = request.authContext
    if (!db) return reply.status(503).send({ error: 'Database not available' })

    const col = await getInsightsCollection()
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    // Per-detector insight stats (last 30 days)
    const detectorStats = await col.aggregate([
      { $match: { tenant_id, created_at: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: '$detector_id',
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$state', 'completed'] }, 1, 0] } },
          dismissed: { $sum: { $cond: [{ $eq: ['$state', 'dismissed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$state', 'identified'] }, 1, 0] } },
          avg_confidence: { $avg: '$confidence_breakdown.combined_score' },
        },
      },
    ]).toArray() as unknown as Array<{
      _id: string
      total: number
      approved: number
      dismissed: number
      pending: number
      avg_confidence: number
    }>

    // Per-detector calibration params (ECE, temperature, sample count)
    const calibParams = await db.collection('calibration_params')
      .find({ tenant_id })
      .toArray() as unknown as Array<{
        detector_id: string
        ece: number
        temperature: number
        sample_count: number
        active_calibrator: string
        fitted_at: Date
      }>

    const calibByDetector = new Map(calibParams.map(p => [p.detector_id, p]))

    // Avoided losses from trade outcomes (pending_trades with receipt)
    const tradeOutcomes = await db.collection('pending_trades')
      .aggregate([
        { $match: { tenant_id, status: { $in: ['executed', 'logged'] }, created_at: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: '$source_insight_id',
            trade_value: { $sum: '$value' },
          },
        },
      ]).toArray() as unknown as Array<{ _id: string; trade_value: number }>

    // All-time totals for track record
    const allTimeStats = await col.aggregate([
      { $match: { tenant_id } },
      {
        $group: {
          _id: '$detector_id',
          total_all_time: { $sum: 1 },
          approved_all_time: { $sum: { $cond: [{ $eq: ['$state', 'completed'] }, 1, 0] } },
        },
      },
    ]).toArray() as unknown as Array<{
      _id: string
      total_all_time: number
      approved_all_time: number
    }>

    const allTimeMap = new Map(allTimeStats.map(s => [s._id, s]))

    // Build per-detector trust record
    const detectors = detectorStats.map(stat => {
      const detectorId = stat._id ?? 'unknown'
      const calib = calibByDetector.get(detectorId)
      const allTime = allTimeMap.get(detectorId)
      const accuracyRate = stat.total > 0 ? stat.approved / stat.total : 0
      const dismissRate = stat.total > 0 ? stat.dismissed / stat.total : 0

      return {
        detector_id: detectorId,
        // 30-day window
        insights_30d: stat.total,
        approved_30d: stat.approved,
        dismissed_30d: stat.dismissed,
        pending_30d: stat.pending,
        accuracy_rate: Math.round(accuracyRate * 100) / 100,
        dismiss_rate: Math.round(dismissRate * 100) / 100,
        avg_confidence: Math.round((stat.avg_confidence ?? 0) * 100) / 100,
        // Calibration
        calibration_ece: calib?.ece ?? null,
        calibration_temperature: calib?.temperature ?? null,
        calibration_samples: calib?.sample_count ?? 0,
        calibration_active: calib?.active_calibrator ?? 'none',
        calibration_fitted_at: calib?.fitted_at ?? null,
        // All-time track record
        total_all_time: allTime?.total_all_time ?? stat.total,
        approved_all_time: allTime?.approved_all_time ?? stat.approved,
        // Trust label for user-facing UI
        trust_label: trustLabelFor(accuracyRate, stat.total),
      }
    })

    // Summary totals
    const totalInsights = detectors.reduce((sum, d) => sum + d.insights_30d, 0)
    const totalApproved = detectors.reduce((sum, d) => sum + d.approved_30d, 0)
    const totalDismissed = detectors.reduce((sum, d) => sum + d.dismissed_30d, 0)
    const totalAvoidedLossMinor = tradeOutcomes.reduce((sum, t) => sum + t.trade_value, 0)
    const avgEce = detectors.filter(d => d.calibration_ece !== null).length > 0
      ? detectors.reduce((sum, d) => sum + (d.calibration_ece ?? 0), 0) / detectors.filter(d => d.calibration_ece !== null).length
      : null

    return reply.send({
      summary: {
        total_insights_30d: totalInsights,
        total_approved_30d: totalApproved,
        total_dismissed_30d: totalDismissed,
        approval_rate: totalInsights > 0 ? Math.round((totalApproved / totalInsights) * 100) / 100 : 0,
        avg_calibration_ece: avgEce !== null ? Math.round(avgEce * 1000) / 1000 : null,
        avoided_loss_minor: totalAvoidedLossMinor,
      },
      detectors,
    })
  })
}

/** Trust label for user-facing UI — based on accuracy rate and sample size. */
function trustLabelFor(accuracyRate: number, sampleSize: number): string {
  if (sampleSize < 5) return 'New — gathering data'
  if (accuracyRate >= 0.8) return 'Highly reliable'
  if (accuracyRate >= 0.6) return 'Reliable'
  if (accuracyRate >= 0.4) return 'Moderate'
  return 'Needs calibration'
}
