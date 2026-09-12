import { describe, expect, it } from 'vitest'
import { CorrelationBuffer } from '../correlation-buffer.js'

describe('CorrelationBuffer', () => {
  it('isolates tenants and completes only when required evidence is present', () => {
    const buffer = new CorrelationBuffer()
    buffer.add({
      tenant_id: 'tenant-a',
      evidence_type: 'stripe.mrr',
      evidence_id: 'e1',
      data: { mrr_change_pct: -0.1 },
      observed_at: new Date(),
    })
    buffer.add({
      tenant_id: 'tenant-b',
      evidence_type: 'shopify.abandonment',
      evidence_id: 'other',
      data: { cart_abandonment_rate: 0.8 },
      observed_at: new Date(),
    })

    expect(buffer.aggregate('tenant-a', ['stripe.mrr', 'shopify.abandonment'], 72, 2, true).complete).toBe(false)

    buffer.add({
      tenant_id: 'tenant-a',
      evidence_type: 'shopify.abandonment',
      evidence_id: 'e2',
      data: { cart_abandonment_rate: 0.8 },
      observed_at: new Date(),
    })
    const result = buffer.aggregate('tenant-a', ['stripe.mrr', 'shopify.abandonment'], 72, 2, true)
    expect(result.complete).toBe(true)
    expect(result.evidence_ids).toEqual(['e1', 'e2'])
  })
})
