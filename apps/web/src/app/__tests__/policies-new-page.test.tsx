import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fetchFamilyGroup = vi.fn()
const checkPolicyPremium = vi.fn()
const addFamilyPolicy = vi.fn()
vi.mock('@/lib/api', () => ({
  fetchFamilyGroup: () => fetchFamilyGroup(),
  checkPolicyPremium: (m?: number, a?: number) => checkPolicyPremium(m, a),
  addFamilyPolicy: (i: unknown) => addFamilyPolicy(i),
}))

import NewPolicyPage from '../policies/new/page'

const MISMATCH = {
  status: 'mismatch',
  yearlyFromMonthlyMinor: 50400,
  differenceMinor: -400,
  text: '£42 a month adds up to £504 a year. You entered £500 a year, £4 less. Check both figures against your policy document.',
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  fetchFamilyGroup.mockReset()
  checkPolicyPremium.mockReset()
  addFamilyPolicy.mockReset()
})

const setup = () => {
  fetchFamilyGroup.mockResolvedValue({
    id: 'f',
    name: 'F',
    inviteCode: 'x',
    members: [
      { id: 'tom', name: 'Tom', role: 'adult' },
      { id: 'me', name: 'Alex', role: 'organizer' },
    ],
  })
  render(<NewPolicyPage />)
}
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('/policies/new', () => {
  it('warns as the premiums are typed when twelve months do not equal the year', async () => {
    checkPolicyPremium.mockResolvedValue(MISMATCH)
    setup()
    type(/Monthly premium/, '42')
    type(/Yearly premium/, '500')
    await waitFor(() => expect(screen.getByTestId('premium-warning')).toBeTruthy())
    expect(screen.getByTestId('premium-warning').textContent).toMatch(/£4 less/)
    expect(checkPolicyPremium).toHaveBeenLastCalledWith(4200, 50000)
  })

  it('says they match, and asks nothing while one box is empty', async () => {
    checkPolicyPremium.mockResolvedValue({ status: 'match' })
    setup()
    type(/Monthly premium/, '42')
    expect(checkPolicyPremium).not.toHaveBeenCalled()
    type(/Yearly premium/, '504')
    await waitFor(() => expect(screen.getByTestId('premium-match')).toBeTruthy())
    expect(screen.queryByTestId('premium-warning')).toBeNull()
  })

  it('needs a provider before it saves, then shows the saved policy, the warning and the contact links', async () => {
    checkPolicyPremium.mockResolvedValue(MISMATCH)
    addFamilyPolicy.mockResolvedValue({
      ok: true,
      check: MISMATCH,
      policy: {
        id: 'pol_1',
        type: 'life',
        provider: 'Example Life',
        coverage_amount_minor: 25_000_000,
        monthly_premium_minor: 4200,
        annual_premium_minor: 50_000,
        contact_phone: '0800 000 000',
        contact_email: 'claims@example.test',
        beneficiary_member_id: 'tom',
      },
    })
    setup()
    const save = screen.getByRole('button', { name: /Save this policy/ }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    type(/Provider/, 'Example Life')
    type(/Cover amount/, '250,000')
    type(/Monthly premium/, '42')
    type(/Yearly premium/, '500')
    type(/Claims phone/, '0800 000 000')
    await waitFor(() => expect(save.disabled).toBe(false))
    await act(async () => {
      fireEvent.click(save)
    })
    expect(addFamilyPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'life',
        provider: 'Example Life',
        coverage_amount_minor: 25_000_000,
        monthly_premium_minor: 4200,
        annual_premium_minor: 50_000,
        contact_phone: '0800 000 000',
      }),
    )
    const box = (await screen.findByTestId('saved-policy')).textContent ?? ''
    expect(box).toMatch(/Example Life, covers Tom/)
    expect(box).toMatch(/£250,000/)
    expect(screen.getByTestId('saved-warning').textContent).toMatch(/£4 less/)
    expect(screen.getByRole('link', { name: '0800 000 000' }).getAttribute('href')).toBe(
      'tel:0800000000',
    )
    expect(screen.getByRole('link', { name: 'claims@example.test' }).getAttribute('href')).toBe(
      'mailto:claims@example.test',
    )
  })

  it('shows the server reason when saving fails and keeps the form', async () => {
    addFamilyPolicy.mockResolvedValue({
      ok: false,
      error: 'Only household editors can add policies',
    })
    setup()
    type(/Provider/, 'Example Life')
    fireEvent.click(screen.getByRole('button', { name: /Save this policy/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/household editors/))
    expect((screen.getByLabelText(/Provider/) as HTMLInputElement).value).toBe('Example Life')
  })
})
