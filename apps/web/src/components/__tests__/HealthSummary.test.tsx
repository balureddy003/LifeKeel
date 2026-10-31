/**
 * An overall health number is shown only when every area is assessed; with a
 * blank area it says how many are, instead of averaging the rest.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HealthSummary } from '../HealthSummary'

const domains = vi.fn()
vi.mock('@/lib/useFamilyData', () => ({
  useFamilyHealthDomains: () => ({ domains: domains(), loading: false }),
}))
vi.mock('@/components/Toast', () => ({ useToast: () => vi.fn() }))
vi.mock('@/lib/evaluate-profile', () => ({ evaluateSavedProfile: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

const d = (score: number, hasLiveData: boolean) => ({ score, hasLiveData })

afterEach(cleanup)

describe('HealthSummary overall score', () => {
  it('hides the number while an area is blank', () => {
    domains.mockReturnValue({
      protection: d(85, true),
      wealth: d(85, true),
      goals: d(0, false),
      savings: d(0, false),
      estate: d(85, true),
    })
    render(<HealthSummary />)
    expect(screen.getByText('3 of 5 areas assessed')).toBeTruthy()
    expect(screen.queryByText('85')).toBeNull()
  })

  it('shows the number once every area is assessed', () => {
    domains.mockReturnValue({
      protection: d(80, true),
      wealth: d(80, true),
      goals: d(80, true),
      savings: d(80, true),
      estate: d(80, true),
    })
    render(<HealthSummary />)
    expect(screen.getByText('80')).toBeTruthy()
  })
})
