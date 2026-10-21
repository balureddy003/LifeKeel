/**
 * PRD-137 §4 — the estate component's "not legal validity" caption must
 * reach the page: the server puts it on the component so clients can't
 * omit it. HealthDomainClient renders it under the domain title.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { DomainHealth } from '@/lib/useFamilyData'

const useFamilyHealthDomains = vi.fn()

vi.mock('next/navigation', () => ({
  // HealthDomainClient resolves its domain from the URL path (useRouteParam)
  // rather than useParams — the static export bakes 'placeholder' into params.
  usePathname: () => '/health/estate',
}))
vi.mock('@/lib/useFamilyData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/useFamilyData')>()
  return { ...actual, useFamilyHealthDomains: () => useFamilyHealthDomains() }
})

import HealthDomainClient from '../HealthDomainClient'

const CAPTION = "Completeness and freshness of what's recorded — not legal validity."

function domain(overrides: Partial<DomainHealth> = {}): DomainHealth {
  return { score: 68, hasLiveData: true, insights: [], ...overrides }
}

function domains(estate: DomainHealth) {
  return {
    protection: domain(),
    wealth: domain(),
    goals: domain(),
    savings: domain(),
    estate,
  }
}

describe('estate caption rendering', () => {
  it('renders the component caption under the domain title', () => {
    useFamilyHealthDomains.mockReturnValue({
      domains: domains(domain({ detail: '1 of 2 checks need attention.', caption: CAPTION })),
      loading: false,
      error: null,
    })
    render(<HealthDomainClient />)
    expect(screen.getByText(CAPTION)).toBeTruthy()
    expect(screen.getByText('1 of 2 checks need attention.')).toBeTruthy()
  })

  it('renders nothing extra when the component has no caption', () => {
    useFamilyHealthDomains.mockReturnValue({
      domains: domains(domain({ detail: 'Will and power of attorney are both in the vault.' })),
      loading: false,
      error: null,
    })
    render(<HealthDomainClient />)
    expect(screen.queryByText(CAPTION)).toBeNull()
  })
})
