import { describe, it, expect } from 'vitest'
import { collectEventRefs, synthesizeSampleEventData } from '../routes/workflows.js'

// H2 regression: manual "Run now" of a detector-driven workflow used to start
// with empty event data, leaving every {{event.*}} template unresolved — the
// AI note then shipped raw "{{event.ticker}}" literals to the review queue.
// synthesizeSampleEventData fills placeholder values for any referenced field
// the caller didn't supply.

describe('collectEventRefs', () => {
  it('collects top-level {{event.X}} references from node configs', () => {
    const nodes = [
      {
        type: 'ai_drafted_note',
        config: {
          body: 'Review {{event.ticker}} — dropped {{event.drop_pct}}%',
          subject: 'Action: {{event.ticker}}',
        },
      },
    ]
    expect([...collectEventRefs(nodes)].sort()).toEqual(['drop_pct', 'ticker'])
  })

  it('walks nested arrays and objects', () => {
    const nodes = [
      {
        config: {
          sections: [
            { template: '{{event.ticker}} summary' },
            { template: 'weight {{event.position_weight}}' },
          ],
        },
      },
    ]
    expect([...collectEventRefs(nodes)].sort()).toEqual(['position_weight', 'ticker'])
  })

  it('ignores non-event template variables', () => {
    const nodes = [{ config: { body: '{{ticker}} and {{event.ticker}}' } }]
    expect([...collectEventRefs(nodes)]).toEqual(['ticker'])
  })

  it('returns an empty set when no event refs exist', () => {
    expect(collectEventRefs([{ config: { body: 'no templates here' } }]).size).toBe(0)
  })
})

describe('synthesizeSampleEventData', () => {
  it('fills placeholder values for referenced fields not supplied by the caller', () => {
    const nodes = [{ config: { body: 'Review {{event.ticker}} ({{event.drop_pct}}%)' } }]
    const data = synthesizeSampleEventData(nodes, { source: 'studio_manual' })
    expect(data['ticker']).toBe('SAMPLE')
    expect(data['drop_pct']).toBe(50)
    expect(data['_sample']).toBe(true)
    // The caller-supplied source is preserved.
    expect(data['source']).toBe('studio_manual')
  })

  it('does not overwrite fields the caller explicitly supplied', () => {
    const nodes = [{ config: { body: '{{event.ticker}}' } }]
    const data = synthesizeSampleEventData(nodes, { source: 'studio_manual', ticker: 'NVDA' })
    expect(data['ticker']).toBe('NVDA')
  })

  it('passes through a rich real detector payload unchanged (no synthesis)', () => {
    const nodes = [{ config: { body: '{{event.ticker}} {{event.drop_pct}}' } }]
    const realPayload = {
      ticker: 'AAPL',
      drop_pct: 12,
      price: 180,
      volume: 1_000_000,
      detector_id: 'trading_price_drop',
    }
    const data = synthesizeSampleEventData(nodes, realPayload)
    // Real detector signals carry the full feature_snapshot (>3 real fields),
    // so synthesis is skipped and the payload is returned untouched.
    expect(data).toEqual(realPayload)
    expect(data['_sample']).toBeUndefined()
  })

  it('marks synthesized data with _sample: true', () => {
    const nodes = [{ config: { body: '{{event.ticker}}' } }]
    const data = synthesizeSampleEventData(nodes, undefined)
    expect(data['_sample']).toBe(true)
    expect(data['ticker']).toBe('SAMPLE')
  })

  it('handles workflows with no event references', () => {
    const data = synthesizeSampleEventData([{ config: { body: 'static text' } }], { source: 'studio_manual' })
    // No refs to fill, but the caller's data is still returned.
    expect(data['source']).toBe('studio_manual')
    expect(data['_sample']).toBe(true) // marks the manual run as sample data
  })
})
