/** Blind check (innovation scan idea 1): the form sends three amounts; the comparison says who typed what. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const answerBlindCheck = vi.fn()
vi.mock('@/lib/api', () => ({
  answerBlindCheck: (id: string, v: unknown) => answerBlindCheck(id, v),
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

import { BlindCheckCompare, BlindCheckForm, differenceText } from '../BlindCheck'
import { briefNextLine } from '@/lib/brief-status'
import type { BlindCheckView, HouseholdBrief } from '@/lib/api'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const rows: BlindCheckView['rows'] = [
  {
    field: 'monthly_income_minor',
    label: 'Take-home income',
    creator_minor: 300000,
    recipient_minor: 300000,
    difference_pct: 0,
  },
  {
    field: 'monthly_essentials_minor',
    label: 'Spending',
    creator_minor: 200000,
    recipient_minor: 160000,
    difference_pct: -20,
  },
  {
    field: 'liquid_savings_minor',
    label: 'Liquid savings',
    creator_minor: 600000,
    recipient_minor: 660000,
    difference_pct: 10,
  },
]

describe('BlindCheckForm', () => {
  it('asks for all three, then sends whole pence and hands back the revealed brief', async () => {
    answerBlindCheck.mockResolvedValue({ ok: true, status: 200, data: { brief: { id: 'b1' } } })
    const onAnswered = vi.fn()
    render(<BlindCheckForm briefId="b1" fromName="Sam" onAnswered={onAnswered} />)
    expect(screen.getByText(/Before you see Sam's figures/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: "Show Sam's figures" }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Enter an amount for each/)
    expect(answerBlindCheck).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Take-home income/), { target: { value: '3000' } })
    fireEvent.change(screen.getByLabelText(/Spending each month/), { target: { value: '1600.50' } })
    fireEvent.change(screen.getByLabelText(/Savings you could use now/), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: "Show Sam's figures" }))
    await vi.waitFor(() => expect(onAnswered).toHaveBeenCalledWith({ id: 'b1' }))
    expect(answerBlindCheck).toHaveBeenCalledWith('b1', {
      monthly_income_minor: 300000,
      monthly_essentials_minor: 160050,
      liquid_savings_minor: 0,
    })
  })
})

describe('BlindCheckCompare', () => {
  it('puts each adult in their own column, with the gap under the other adult’s own figure', () => {
    render(
      <BlindCheckCompare view={{ status: 'answered', rows }} viewerIsCreator otherName="Alex" />,
    )
    const spending = screen.getByText('Spending').closest('tr')!
    const cells = within(spending).getAllByRole('cell')
    expect(cells[1]!.textContent).toBe('£2,000') // the creator, "You"
    expect(cells[2]!.textContent).toBe('£1,60020% lower than the brief') // Alex
    expect(screen.getByText(/Different figures are normal/)).toBeTruthy()
  })

  it('for the other adult, their own figure (and its gap) is under "You"', () => {
    render(
      <BlindCheckCompare
        view={{ status: 'answered', rows }}
        viewerIsCreator={false}
        otherName="Sam"
      />,
    )
    const savings = screen.getByText('Liquid savings').closest('tr')!
    const cells = within(savings).getAllByRole('cell')
    expect(cells[1]!.textContent).toBe('£6,60010% higher than the brief')
    expect(cells[2]!.textContent).toBe('£6,000')
  })

  it('says so when nobody differs, and renders nothing before an answer', () => {
    const same = rows!.map((r) => ({ ...r, recipient_minor: r.creator_minor, difference_pct: 0 }))
    const { unmount } = render(
      <BlindCheckCompare
        view={{ status: 'answered', rows: same }}
        viewerIsCreator
        otherName="Alex"
      />,
    )
    expect(screen.getByText('You both entered the same figures.')).toBeTruthy()
    unmount()
    const { container } = render(
      <BlindCheckCompare view={{ status: 'waiting_for_them' }} viewerIsCreator otherName="Alex" />,
    )
    expect(container.innerHTML).toBe('')
    expect(differenceText(null)).toBe('')
  })
})

describe('status line', () => {
  const brief = (blind: BlindCheckView) =>
    ({
      blind_check: blind,
      share: { for_member_name: 'Alex Stone' },
      confirmation: null,
    }) as unknown as HouseholdBrief
  it('names what each adult is waiting for', () => {
    expect(briefNextLine(brief({ status: 'waiting_for_them' }))).toBe(
      'Waiting for Alex to give their own figures.',
    )
    expect(briefNextLine(brief({ status: 'waiting_for_you' }))).toBe(
      'Give your own figures first, then you will see theirs.',
    )
  })
})
