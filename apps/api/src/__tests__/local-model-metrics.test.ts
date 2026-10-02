import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmFn } from '@agentoak/platform'
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
    expect(text).toMatch(/agentoak_output_guard_blocks_total\{reason="ungrounded_numbers"\} \d+/)
    expect(text).toMatch(/agentoak_output_guard_blocks_total\{reason="provider_steering"\} \d+/)
    expect(text).not.toContain('640')
  })

  it('exposes the model, queue-wait, classifier-failure and OCR-retry series', async () => {
    const { recordLocalModelCall, recordEmailClassifyFailure, recordDocumentExtractionRetries } = await import('../routes/metrics.js')
    recordLocalModelCall('judge', true, 12, 0.5)
    recordLocalModelCall('ocr', false, 30, 40)
    recordEmailClassifyFailure()
    recordDocumentExtractionRetries(2)
    const text = await metricsText()
    expect(text).toContain('agentoak_local_model_calls_total{purpose="judge",outcome="ok"}')
    expect(text).toContain('agentoak_local_model_calls_total{purpose="ocr",outcome="error"}')
    expect(text).toContain('agentoak_local_model_latency_seconds_bucket{le="20",purpose="judge"}')
    expect(text).toContain('agentoak_local_model_queue_wait_seconds_count{purpose="ocr"}')
    expect(text).toMatch(/agentoak_email_classify_failures_total \d+/)
    expect(text).toMatch(/agentoak_document_extraction_retries_total [2-9]/)
  })
})
