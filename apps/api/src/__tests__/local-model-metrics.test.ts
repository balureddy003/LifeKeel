import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmFn } from '@lifekeel/platform'
import { renderMetrics } from '../routes/metrics.js'
import { withOutputGuard } from '../local-model.js'

async function metricsText(): Promise<string> {
  return renderMetrics()
}

describe('local model metrics', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('counts output-guard blocks by reason code only, never the figures or text', async () => {
    const llm: LlmFn = async () => 'Your surplus would be 640 GBP. The best insurer is Acme.'
    await expect(withOutputGuard(llm)('s', 'salary 3,200 GBP')).rejects.toBeDefined()
    const text = await metricsText()
    expect(text).toMatch(/lifekeel_output_guard_blocks_total\{reason="ungrounded_numbers"\} \d+/)
    expect(text).toMatch(/lifekeel_output_guard_blocks_total\{reason="provider_steering"\} \d+/)
    // Labels carry the reason code only: no figure detail, no model text.
    expect(text).not.toContain('ungrounded_numbers(')
    expect(text).not.toContain('Acme')
    expect(text).not.toMatch(/lifekeel_output_guard_blocks_total\{[^}]*640/)
  })

  it('exposes the model, queue-wait, classifier-failure and OCR-retry series', async () => {
    const { recordLocalModelCall, recordEmailClassifyFailure, recordDocumentExtractionRetries } = await import('../routes/metrics.js')
    recordLocalModelCall('judge', true, 12, 0.5)
    recordLocalModelCall('ocr', false, 30, 40)
    recordEmailClassifyFailure()
    recordDocumentExtractionRetries(2)
    const text = await metricsText()
    expect(text).toContain('lifekeel_local_model_calls_total{purpose="judge",outcome="ok"}')
    expect(text).toContain('lifekeel_local_model_calls_total{purpose="ocr",outcome="error"}')
    expect(text).toContain('lifekeel_local_model_latency_seconds_bucket{le="20",purpose="judge"}')
    expect(text).toContain('lifekeel_local_model_queue_wait_seconds_count{purpose="ocr"}')
    expect(text).toMatch(/lifekeel_email_classify_failures_total \d+/)
    expect(text).toMatch(/lifekeel_document_extraction_retries_total [2-9]/)
  })

  it('estimates cost from busy model time only when a rate is configured', async () => {
    const { recordLocalModelCall } = await import('../routes/metrics.js')
    recordLocalModelCall('judge', true, 10, 0, 0) // no rate configured: nothing recorded
    recordLocalModelCall('classifier', true, 3600, 0, 0.5) // one busy hour at $0.50/h
    const text = await metricsText()
    expect(text).toContain('lifekeel_local_model_estimated_cost_usd_total{purpose="classifier"} 0.5')
    expect(text).not.toContain('estimated_cost_usd_total{purpose="judge"}')
  })
})
