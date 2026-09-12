import { describe, expect, it } from 'vitest'
import { buildPeriodPerformance } from '../shadow-backtest-runner.js'

describe('buildPeriodPerformance', () => {
  it('measures each calendar period from the same strategy and benchmark dates', () => {
    const result = buildPeriodPerformance(
      ['2024-01-02', '2024-06-28', '2025-01-02', '2025-06-30'],
      [100, 110, 110, 99],
      [100, 105, 105, 115.5],
    )

    expect(result).toEqual([
      {
        period: '2024',
        start_date: '2024-01-02',
        end_date: '2024-06-28',
        strategy_return_pct: 10,
        benchmark_return_pct: 5,
        excess_return_pct: 5,
        max_drawdown_pct: 0,
      },
      {
        period: '2025',
        start_date: '2025-01-02',
        end_date: '2025-06-30',
        strategy_return_pct: -10,
        benchmark_return_pct: 10,
        excess_return_pct: -20,
        max_drawdown_pct: 10,
      },
    ])
  })

  it('returns no periods for empty input', () => {
    expect(buildPeriodPerformance([], [], [])).toEqual([])
  })
})
