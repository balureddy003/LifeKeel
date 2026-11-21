import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({ fetchFinancialProfile: vi.fn() }))
import { fetchFinancialProfile } from '@/lib/api'
import { AtHand } from '../AtHand'

describe('AtHand', () => {
  it('leads with the matching policy and a call button', async () => {
    vi.mocked(fetchFinancialProfile).mockResolvedValue({
      policies: [
        {
          type: 'critical_illness',
          provider: 'Acme',
          coverage_amount_minor: 10000000,
          contact_phone: '0800 000 0000',
        },
      ],
    } as never)
    render(<AtHand eventType="medical" />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())
    const call = screen.getByRole('link', { name: /Call 0800 000 0000/ })
    expect(call.getAttribute('href')).toBe('tel:08000000000')
    expect(screen.getByText('Cover on file: £100,000')).toBeTruthy()
  })
  it('says there is no phone number rather than showing a dead button', async () => {
    vi.mocked(fetchFinancialProfile).mockResolvedValue({
      policies: [{ type: 'life', provider: 'Acme', coverage_amount_minor: 0 }],
    } as never)
    render(<AtHand eventType="bereavement" />)
    await waitFor(() => expect(screen.getByText('No phone number on file.')).toBeTruthy())
  })
  it('guides to add one when nothing matches', async () => {
    vi.mocked(fetchFinancialProfile).mockResolvedValue({ policies: [] } as never)
    render(<AtHand eventType="medical" />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Add a policy' }).getAttribute('href')).toBe(
        '/policies/new',
      ),
    )
  })
  it('renders nothing for an event these policies do not bear on', async () => {
    vi.mocked(fetchFinancialProfile).mockResolvedValue({ policies: [] } as never)
    const { container } = render(<AtHand eventType="car" />)
    await new Promise((r) => setTimeout(r, 30))
    expect(container.firstChild).toBeNull()
  })
})
