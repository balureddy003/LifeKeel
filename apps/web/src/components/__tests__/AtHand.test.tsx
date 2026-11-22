import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({ fetchFinancialProfile: vi.fn(), getDomainView: vi.fn() }))
import { fetchFinancialProfile, getDomainView } from '@/lib/api'
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
  it('home damage asks for the home policy and links to a form that can add one', async () => {
    vi.mocked(fetchFinancialProfile).mockResolvedValue({ policies: [] } as never)
    render(<AtHand eventType="property" />)
    const link = await screen.findByRole('link', { name: /Add a policy/ })
    expect(link.getAttribute('href')).toBe('/policies/new?type=home')
  })
  it('a car event leads with the car policy from the family list and a call button', async () => {
    vi.mocked(fetchFinancialProfile).mockResolvedValue({ policies: [] } as never)
    vi.mocked(getDomainView).mockResolvedValue({
      domain_id: 'car',
      rows: [
        {
          id: 'r1',
          record: 'policy',
          holder_member_id: null,
          covers_member_id: null,
          values: { provider: 'Example Motor', claims_contact: '0800 111 2222' },
        },
      ],
      pack: { records: [{ key: 'policy', label: 'Car policy' }] },
    } as never)
    render(<AtHand eventType="car" />)
    await waitFor(() => expect(screen.getByText('Example Motor')).toBeTruthy())
    expect(getDomainView).toHaveBeenCalledWith('car')
    expect(screen.getByRole('link', { name: /Call 0800 111 2222/ }).getAttribute('href')).toBe(
      'tel:08001112222',
    )
  })
  it('a car event with nothing on file guides to add one', async () => {
    vi.mocked(fetchFinancialProfile).mockResolvedValue({ policies: [] } as never)
    vi.mocked(getDomainView).mockResolvedValue({
      domain_id: 'car',
      rows: [],
      pack: { records: [] },
    } as never)
    render(<AtHand eventType="car" />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Add a policy' }).getAttribute('href')).toBe(
        '/domains?d=car',
      ),
    )
  })
})
