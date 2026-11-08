/** Opening the what-if starts on the figure whose 10% move changes the answer most. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { WhatIf } from '../WhatIf'
import type { HouseholdBrief } from '@/lib/api'

const previewBrief = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  previewBrief: (b: { inputs: Record<string, number> }) => previewBrief(b),
}))
vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))

const brief = {
  problem_type: 'income_drop',
  result: { projectedRunwayMonths: 6 },
  inputs: {
    monthly_income_minor: 300000,
    new_income_minor: 100000,
    new_essentials_minor: 250000,
    liquid_savings_minor: 900000,
  },
} as unknown as HouseholdBrief

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WhatIf lead figure', () => {
  it('starts on the figure that moves the date most', async () => {
    previewBrief.mockImplementation(async ({ inputs }: { inputs: Record<string, number> }) => ({
      ok: true,
      data: {
        preview: {
          template_sentence: 'x',
          facts: [],
          result: { projectedRunwayMonths: inputs['new_essentials_minor']! < 250000 ? 9 : 6.2 },
        },
      },
    }))
    const { container } = render(<WhatIf brief={brief} />)
    const details = container.querySelector('details')!
    details.open = true
    details.dispatchEvent(new Event('toggle', { bubbles: true }))
    expect(await screen.findByText(/moves your date the most/)).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/money going out after the change/)).toBeTruthy())
  })
})
