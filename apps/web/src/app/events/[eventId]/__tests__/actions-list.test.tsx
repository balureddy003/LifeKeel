/**
 * The route id arrives after the first render (static export). The checklist must switch to that event's own
 * list then, not stay on the generic one (hands-on review: Lost my job showed "Contact your financial advisor").
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const route = vi.hoisted(() => ({ id: undefined as string | undefined }))
vi.mock('@/lib/useRouteParam', () => ({ useRouteParam: () => route.id }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, family: null }) }))
vi.mock('@/lib/useFamilyData', () => ({
  useEventReadiness: (_id: string, stability: number, explanation: string) => ({
    stability: null,
    explanation,
    live: false,
    missingInputs: [],
    insightId: null,
    ruleId: null,
  }),
}))
vi.mock('@/components/IncomeStopBrief', () => ({ IncomeStopBrief: () => null }))
vi.mock('../ScenarioCard', () => ({ default: () => null, eventHasScenario: () => false }))
vi.mock('../RetirementEstimate', () => ({ default: () => null }))
vi.mock('@/lib/api', () => ({
  prepareInsightDraft: vi.fn(),
  fetchFinancialProfile: vi.fn().mockResolvedValue(null),
  fetchLifeEvents: vi.fn().mockResolvedValue([]),
}))

import EventDetailClient from '../EventDetailClient'

afterEach(cleanup)

describe('event checklist', () => {
  it('shows the job-loss list once the route id resolves', async () => {
    route.id = undefined
    const { rerender } = render(<EventDetailClient />)
    route.id = 'job-loss'
    rerender(<EventDetailClient />)
    expect(
      await screen.findByText('Review how many months your emergency savings cover'),
    ).toBeTruthy()
    expect(screen.queryByText(/financial advisor/i)).toBeNull()
  })
})
