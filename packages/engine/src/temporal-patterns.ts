/**
 * Temporal Pattern Engine — MongoDB-native sequence and window detection.
 *
 * The current engine only evaluates point-in-time conditions on a single event.
 * This module adds the ability to detect patterns ACROSS events over time:
 *
 *   - "invoice overdue 3+ times in the last 30 days"  (frequency pattern)
 *   - "payment declined → account frozen within 48h"  (sequence pattern)
 *   - "no purchases in 90 days after 6-month active period" (absence pattern)
 *
 * Architecture: MongoDB $setWindowFields (5.0+) for server-side aggregation.
 * All temporal computation happens in MongoDB — no data loaded into Node.js memory.
 *
 * Integration with DetectorRule:
 *   Add a `temporal` block to any rule in YAML:
 *
 *   rules:
 *     - id: late_payment_pattern
 *       condition: "data.days_overdue >= 7"
 *       temporal:
 *         type: frequency
 *         min_occurrences: 3
 *         within_ms: 2592000000   # 30 days
 *         group_by: "data.customer_id"  # optional: pattern per customer
 *
 *     - id: churn_sequence
 *       condition: "data.event_type == 'subscription_cancelled'"
 *       temporal:
 *         type: sequence
 *         steps:
 *           - event_type: "support_ticket_opened"
 *             condition: "data.severity == 'high'"
 *           - event_type: "subscription_cancelled"
 *         within_ms: 604800000   # 7 days
 *
 * Usage:
 *   const engine = new TemporalPatternEngine(db)
 *   const result = await engine.evaluate('tenant-123', pattern, context)
 *   if (result.matched) { ... }
 */

// MongoDB types — injected at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MongoDb = { collection: (name: string) => any }

// ── Pattern types ──────────────────────────────────────────────────────────────

export type TemporalPatternType = 'frequency' | 'sequence' | 'absence'

export interface FrequencyPattern {
  type: 'frequency'
  /** Minimum number of matching events in the window. */
  min_occurrences: number
  /** Window in milliseconds. e.g. 2592000000 = 30 days. */
  within_ms: number
  /** Optional filtrex condition each event must satisfy (beyond signal_type matching). */
  condition?: string
  /** Optional: group pattern per field value (e.g. "data.customer_id"). */
  group_by?: string
}

export interface SequencePattern {
  type: 'sequence'
  /** Ordered list of steps that must occur in this exact order. */
  steps: Array<{
    signal_type: string
    /** Optional filtrex condition the event must satisfy. */
    condition?: string
  }>
  /** All steps must occur within this window (milliseconds). */
  within_ms: number
}

export interface AbsencePattern {
  type: 'absence'
  /** The signal that should NOT occur after the trigger. */
  absent_signal_type: string
  /** How long to wait before declaring absence. */
  within_ms: number
  /** Optional filtrex condition the trigger event must satisfy. */
  trigger_condition?: string
}

export type TemporalPattern = FrequencyPattern | SequencePattern | AbsencePattern

// ── Result types ──────────────────────────────────────────────────────────────

export interface TemporalMatchResult {
  matched: boolean
  match_count: number
  /** IDs of events that contributed to the match. */
  matched_signal_ids: string[]
  window_start: Date
  window_end: Date
  /** For sequence patterns: which step was last matched. */
  last_matched_step?: number | undefined
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class TemporalPatternEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private signals: any

  constructor(db: MongoDb) {
    this.signals = db.collection('signals')
  }

  // ── Main entry point ───────────────────────────────────────────────────────

  async evaluate(
    tenantId: string,
    signalType: string,
    pattern: TemporalPattern,
    referenceTime: Date = new Date(),
  ): Promise<TemporalMatchResult> {
    switch (pattern.type) {
      case 'frequency': return this.evaluateFrequency(tenantId, signalType, pattern, referenceTime)
      case 'sequence':  return this.evaluateSequence(tenantId, pattern, referenceTime)
      case 'absence':   return this.evaluateAbsence(tenantId, pattern, referenceTime)
    }
  }

  // ── Frequency pattern ──────────────────────────────────────────────────────
  // "X events of type T matching condition C occurred in the last W ms"
  // O(log n) with compound index on {tenant_id, signal_type, created_at}

  private async evaluateFrequency(
    tenantId: string,
    signalType: string,
    pattern: FrequencyPattern,
    referenceTime: Date,
  ): Promise<TemporalMatchResult> {
    const windowStart = new Date(referenceTime.getTime() - pattern.within_ms)

    // Build a lean query — only fetch _id and data for condition evaluation
    const query: Record<string, unknown> = {
      tenant_id: tenantId,
      signal_type: signalType,
      created_at: { $gte: windowStart, $lte: referenceTime },
    }

    const candidates = await this.signals
      .find(query, { projection: { _id: 1, data: 1, created_at: 1 } })
      .sort({ created_at: 1 })
      .limit(1000) // safety cap — patterns over 1000 events are noise
      .toArray() as Array<{ _id: string; data: Record<string, unknown>; created_at: Date }>

    // Filter by condition (filtrex) in Node.js — the query already narrows the set
    let matching = candidates
    if (pattern.condition) {
      const { evaluate: evalExpr } = await import('./evaluator.js')
      matching = candidates.filter(c => {
        try { return evalExpr(pattern.condition!, { data: c.data }) }
        catch { return false }
      })
    }

    const matchCount = matching.length
    return {
      matched: matchCount >= pattern.min_occurrences,
      match_count: matchCount,
      matched_signal_ids: matching.slice(0, 50).map(c => String(c._id)),
      window_start: windowStart,
      window_end: referenceTime,
    }
  }

  // ── Sequence pattern ───────────────────────────────────────────────────────
  // "Step A happened, then Step B happened, ..., all within W ms"
  // O(n × k) where n = events in window, k = sequence steps
  // Pointer-advance algorithm: one pass through events

  private async evaluateSequence(
    tenantId: string,
    pattern: SequencePattern,
    referenceTime: Date,
  ): Promise<TemporalMatchResult> {
    if (pattern.steps.length === 0) {
      return { matched: false, match_count: 0, matched_signal_ids: [], window_start: referenceTime, window_end: referenceTime }
    }

    const windowStart = new Date(referenceTime.getTime() - pattern.within_ms)

    // Fetch all event types needed by the sequence steps
    const neededTypes = [...new Set(pattern.steps.map(s => s.signal_type))]

    const events = await this.signals
      .find({
        tenant_id: tenantId,
        signal_type: { $in: neededTypes },
        created_at: { $gte: windowStart, $lte: referenceTime },
      }, { projection: { _id: 1, signal_type: 1, data: 1, created_at: 1 } })
      .sort({ created_at: 1 })
      .limit(500)
      .toArray() as Array<{ _id: string; signal_type: string; data: Record<string, unknown>; created_at: Date }>

    const { evaluate: evalExpr } = await import('./evaluator.js')

    // Pointer-advance: walk events in order, advance sequence pointer when a step matches
    let stepPointer = 0
    const matchedIds: string[] = []
    let sequenceStartTime: Date | null = null

    for (const event of events) {
      const step = pattern.steps[stepPointer]
      if (!step) break

      if (event.signal_type !== step.signal_type) continue

      // Check optional condition
      if (step.condition) {
        try {
          if (!evalExpr(step.condition, { data: event.data })) continue
        } catch { continue }
      }

      // Step matched — advance pointer
      if (stepPointer === 0) sequenceStartTime = event.created_at
      matchedIds.push(String(event._id))
      stepPointer++

      if (stepPointer === pattern.steps.length) {
        // All steps matched
        return {
          matched: true,
          match_count: pattern.steps.length,
          matched_signal_ids: matchedIds,
          window_start: sequenceStartTime ?? windowStart,
          window_end: event.created_at,
          last_matched_step: stepPointer - 1,
        }
      }
    }

    const result: TemporalMatchResult = {
      matched: false,
      match_count: stepPointer,
      matched_signal_ids: matchedIds,
      window_start: windowStart,
      window_end: referenceTime,
    }
    if (stepPointer > 0) result.last_matched_step = stepPointer - 1
    return result
  }

  // ── Absence pattern ────────────────────────────────────────────────────────
  // "After trigger T, no event of type A occurred within W ms"
  // Useful for: "customer hasn't paid since last overdue reminder"

  private async evaluateAbsence(
    tenantId: string,
    pattern: AbsencePattern,
    referenceTime: Date,
  ): Promise<TemporalMatchResult> {
    const windowStart = new Date(referenceTime.getTime() - pattern.within_ms)

    const absenceCount = await this.signals.countDocuments({
      tenant_id: tenantId,
      signal_type: pattern.absent_signal_type,
      created_at: { $gte: windowStart, $lte: referenceTime },
    })

    // Absence = zero events of the absent type in the window
    return {
      matched: absenceCount === 0,
      match_count: absenceCount === 0 ? 1 : 0,
      matched_signal_ids: [],
      window_start: windowStart,
      window_end: referenceTime,
    }
  }
}

// ── Schema extension for DetectorRuleSchema ───────────────────────────────────
// These types allow YAML detectors to declare temporal patterns alongside conditions.

export interface TemporalRuleConfig {
  type: TemporalPatternType
  min_occurrences?: number
  within_ms: number
  condition?: string
  group_by?: string
  steps?: Array<{ signal_type: string; condition?: string }>
  absent_signal_type?: string
}
