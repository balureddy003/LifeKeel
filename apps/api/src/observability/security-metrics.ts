/**
 * Prometheus series for Turnstile, email OTP and the document scan pipeline
 * (CLOUDFLARE_INTEGRATION.md §11.3). Registered on the shared registry that
 * GET /metrics renders. Labels are low-cardinality enums only: never a
 * tenant, user, chain or document id.
 */
import { Counter, Gauge, Histogram, type Registry } from 'prom-client'
import { getMetricsRegistry } from '../routes/metrics.js'

interface Series {
  turnstile: Counter
  otpIssued: Counter
  otpVerify: Counter
  otpBudgetDenied: Counter
  otpChainState: Counter
  otpEmailLatency: Histogram
  docScan: Counter
  docScanDuration: Histogram
  docState: Counter
  docReconcilerRequeue: Counter
  docStuck: Gauge
  docQueueAge: Gauge
  quotaDrift: Gauge
  clamavDefinitionsAge: Gauge
}

let series: Series | null = null

function init(registry: Registry): Series {
  if (series) return series
  const registers = [registry]
  series = {
    turnstile: new Counter({
      name: 'lifekeel_turnstile_verify_total',
      help: 'Turnstile siteverify outcomes by route action',
      labelNames: ['action', 'result'],
      registers,
    }),
    otpIssued: new Counter({
      name: 'lifekeel_otp_issued_total',
      help: 'Email OTP codes issued (first send and resends)',
      labelNames: ['purpose', 'kind'],
      registers,
    }),
    otpVerify: new Counter({
      name: 'lifekeel_otp_verify_total',
      help: 'Email OTP verify outcomes',
      labelNames: ['purpose', 'result'],
      registers,
    }),
    otpBudgetDenied: new Counter({
      name: 'lifekeel_otp_send_budget_denied_total',
      help: 'OTP sends refused by the per-user budget',
      labelNames: ['reason'],
      registers,
    }),
    otpChainState: new Counter({
      name: 'lifekeel_otp_chain_state_total',
      help: 'OTP email delivery outcome per send',
      labelNames: ['delivery'],
      registers,
    }),
    otpEmailLatency: new Histogram({
      name: 'lifekeel_otp_email_latency_seconds',
      help: 'Time to hand an OTP email to the provider',
      buckets: [0.1, 0.25, 0.5, 1, 2, 5],
      registers,
    }),
    docScan: new Counter({
      name: 'lifekeel_doc_scan_total',
      help: 'Document scan outcomes',
      labelNames: ['result'],
      registers,
    }),
    docScanDuration: new Histogram({
      name: 'lifekeel_doc_scan_duration_seconds',
      help: 'Claim-to-terminal duration of a scan job',
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
      registers,
    }),
    docState: new Counter({
      name: 'lifekeel_doc_state_total',
      help: 'Document state transitions',
      labelNames: ['status'],
      registers,
    }),
    docReconcilerRequeue: new Counter({
      name: 'lifekeel_doc_reconciler_requeue_total',
      help: 'Rows the reconciler returned to the scan queue',
      labelNames: ['reason'],
      registers,
    }),
    docStuck: new Gauge({
      name: 'lifekeel_doc_stuck_total',
      help: 'Rows past their deadline in a non-terminal state',
      labelNames: ['status'],
      registers,
    }),
    docQueueAge: new Gauge({
      name: 'lifekeel_doc_scan_queue_age_seconds',
      help: 'Age of the oldest scan_queued row',
      registers,
    }),
    quotaDrift: new Gauge({
      name: 'lifekeel_quota_drift_bytes',
      help: 'Absolute committed-bytes drift corrected by the last quota reconcile',
      registers,
    }),
    clamavDefinitionsAge: new Gauge({
      name: 'lifekeel_clamav_definitions_age_seconds',
      help: 'Age of the ClamAV signature database reported by clamd VERSION',
      registers,
    }),
  }
  return series
}

const s = (): Series => init(getMetricsRegistry())

export const recordTurnstileVerify = (action: string, result: string): void =>
  void s().turnstile.inc({ action, result })
export const recordOtpIssued = (purpose: string, kind: 'first' | 'resend'): void =>
  void s().otpIssued.inc({ purpose, kind })
export const recordOtpVerify = (purpose: string, result: string): void =>
  void s().otpVerify.inc({ purpose, result })
export const recordOtpBudgetDenied = (reason: string): void =>
  void s().otpBudgetDenied.inc({ reason })
export const recordOtpDelivery = (delivery: string, seconds: number): void => {
  s().otpChainState.inc({ delivery })
  s().otpEmailLatency.observe(seconds)
}
export const recordDocScan = (result: string, seconds?: number): void => {
  s().docScan.inc({ result })
  if (seconds !== undefined) s().docScanDuration.observe(seconds)
}
export const recordDocState = (status: string): void => void s().docState.inc({ status })
export const recordReconcilerRequeue = (reason: string): void =>
  void s().docReconcilerRequeue.inc({ reason })
export const setDocStuck = (status: string, n: number): void => void s().docStuck.set({ status }, n)
export const setDocQueueAge = (seconds: number): void => void s().docQueueAge.set(seconds)
export const setQuotaDrift = (bytes: number): void => void s().quotaDrift.set(bytes)
export const setClamavDefinitionsAge = (seconds: number): void =>
  void s().clamavDefinitionsAge.set(seconds)
