/**
 * The cover page states what is on the family list and who has seen it. Confirm is offered
 * only until this adult has confirmed, and a stale version reloads the page.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import DomainsPage from '../page'
import { cellText, confirmSummary, daysText } from '../domain-copy'
import type { DomainView } from '@/lib/api'

const getDomains = vi.fn()
const getDomainView = vi.fn()
const confirmDomain = vi.fn()
const getDomainPlaybook = vi.fn()
const addDomainRecord = vi.fn()
const deleteDomainRecord = vi.fn()
const toast = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  getDomains: () => getDomains(),
  getDomainView: (id: string) => getDomainView(id),
  getDomainPlaybook: (id: string, m: string) => getDomainPlaybook(id, m),
  addDomainRecord: (id: string, r: string, b: unknown) => addDomainRecord(id, r, b),
  deleteDomainRecord: (id: string, r: string) => deleteDomainRecord(id, r),
  confirmDomain: (id: string, v: string) => confirmDomain(id, v),
}))
vi.mock('@/components/Toast', () => ({ useToast: () => toast }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

const view = (
  over: Partial<DomainView['confirmation']> = {},
  gaps: DomainView['gaps'] = [],
): DomainView => ({
  domain_id: 'life_protection',
  can_edit: true,
  roster: [
    { id: 'sam', name: 'Sam' },
    { id: 'alex', name: 'Alex' },
  ],
  pack: {
    id: 'life_protection',
    title: 'Life and income protection',
    summary: 'Which policies are on the family list.',
    records: [
      {
        key: 'policy',
        label: 'Policy',
        person_attribution: 'holder',
        source: { kind: 'adapter', adapter: 'financial_profile_policies' },
        fields: [{ key: 'provider', label: 'Provider', kind: 'text' }],
      },
    ],
    playbook: { playbook: 'bereavement', label: 'If someone dies: what is on the family list' },
  },
  rows: [
    {
      id: 'p1',
      record: 'policy',
      holder_member_id: 'sam',
      covers_member_id: 'alex',
      values: { provider: 'Provider A' },
    },
  ],
  matrix: {
    label: 'Who is covered by what',
    columns: [
      { id: 'sam', name: 'Sam' },
      { id: 'alex', name: 'Alex' },
    ],
    rows: [{ id: 'p1', label: 'Policy · Provider A', cells: { sam: 'holds', alex: 'covers' } }],
  },
  gaps,
  upcoming: [],
  result_version: 'a'.repeat(64),
  confirmation: {
    required: [
      { id: 'sam', name: 'Sam' },
      { id: 'alex', name: 'Alex' },
    ],
    confirmed: [],
    both_confirmed: false,
    viewer_confirmed: false,
    ...over,
  },
})

beforeEach(() => {
  window.history.pushState({}, '', '/domains?d=life_protection')
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('domains page', () => {
  it('lists the packs when no domain is chosen', async () => {
    window.history.pushState({}, '', '/domains')
    getDomains.mockResolvedValue({
      domains: [
        {
          id: 'life_protection',
          title: 'Life and income protection',
          summary: 'Which policies are on the family list.',
          confirm: 'both_adults',
        },
      ],
    })
    render(<DomainsPage />)
    expect(await screen.findByText('Life and income protection')).toBeTruthy()
  })

  it('shows the matrix in words, the gaps, and who is still to confirm', async () => {
    getDomainView.mockResolvedValue(
      view({}, [{ row_id: 'p1', note: 'Not yet matched to a family member' }]),
    )
    render(<DomainsPage />)
    expect(await screen.findByText('Holds it')).toBeTruthy()
    expect(screen.getByText('Covered')).toBeTruthy()
    expect(screen.getByText(/Not yet matched to a family member/)).toBeTruthy()
    expect(
      screen.getByText('Waiting for Sam and Alex to confirm they have seen this version.'),
    ).toBeTruthy()
  })

  it('confirms the exact version shown, then hides the button', async () => {
    getDomainView.mockResolvedValue(view())
    confirmDomain.mockResolvedValue({
      ok: true,
      status: 200,
      data: view({
        viewer_confirmed: true,
        confirmed: [{ id: 'sam', name: 'Sam', confirmed_at: 'x' }],
      }),
    })
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'I have seen this' }))
    await waitFor(() =>
      expect(confirmDomain).toHaveBeenCalledWith('life_protection', 'a'.repeat(64)),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'I have seen this' })).toBeNull(),
    )
    expect(
      screen.getByText('Waiting for Alex to confirm they have seen this version.'),
    ).toBeTruthy()
  })

  it('offers no button to an adult who already confirmed', async () => {
    getDomainView.mockResolvedValue(view({ viewer_confirmed: true }))
    render(<DomainsPage />)
    await screen.findByText('Holds it')
    expect(screen.queryByRole('button', { name: 'I have seen this' })).toBeNull()
  })

  it('reloads the current version when the one confirmed has changed', async () => {
    getDomainView.mockResolvedValue(view())
    confirmDomain.mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: 'This changed since you opened it. Review it again.' },
    })
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'I have seen this' }))
    await waitFor(() => expect(getDomainView).toHaveBeenCalledTimes(2))
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })

  it('says so, without a button, when nothing is on the family list or it cannot load', async () => {
    getDomainView.mockResolvedValue({
      ...view(),
      rows: [],
      matrix: { label: 'x', columns: [], rows: [] },
    })
    render(<DomainsPage />)
    expect(await screen.findByText(/Nothing on the family list yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'I have seen this' })).toBeNull()
    cleanup()
    getDomainView.mockResolvedValue(null)
    render(<DomainsPage />)
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy()
  })
})

describe('planning and first steps', () => {
  it('lists dates that prompt a re-check', async () => {
    getDomainView.mockResolvedValue({
      ...view(),
      upcoming: [
        {
          trigger: 'renewal',
          label: 'A policy renewal date is coming up',
          row_id: 'p1',
          row_label: 'Policy · Provider A',
          date: '2026-12-01',
          days: 12,
        },
      ],
    })
    render(<DomainsPage />)
    expect(
      await screen.findByText(
        /Policy · Provider A: A policy renewal date is coming up, in 12 days \(2026-12-01\)/,
      ),
    ).toBeTruthy()
  })

  it('shows only the records for the chosen person, grouped, with the full steps linked', async () => {
    getDomainView.mockResolvedValue(view())
    getDomainPlaybook.mockResolvedValue({
      playbook: 'bereavement',
      member: { id: 'sam', name: 'Sam' },
      roster: [],
      groups: [
        {
          key: 'theirs',
          label: 'On the family list for Sam',
          rows: [
            {
              id: 'p1',
              label: 'Policy · Provider A',
              claims_contact: '0800 111',
              renewal_date: null,
            },
          ],
        },
        {
          key: 'others',
          label: 'Held by other family members, not part of this',
          rows: [
            { id: 'p2', label: 'Policy · Provider B', claims_contact: null, renewal_date: null },
          ],
        },
      ],
    })
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sam' }))
    expect(await screen.findByText('On the family list for Sam')).toBeTruthy()
    expect(getDomainPlaybook).toHaveBeenCalledWith('life_protection', 'sam')
    expect(screen.getByText(/claims contact: 0800 111/)).toBeTruthy()
    expect(screen.getByText('Held by other family members, not part of this')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'life events' }).getAttribute('href')).toBe(
      '/life-events',
    )
  })

  it('says so when the first steps cannot load', async () => {
    getDomainView.mockResolvedValue(view())
    getDomainPlaybook.mockResolvedValue(null)
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Alex' }))
    expect(await screen.findByText('This could not be loaded.')).toBeTruthy()
  })
})

const carView = (rows: DomainView['rows'] = []): DomainView => ({
  ...view(),
  domain_id: 'car',
  matrix: null,
  rows,
  pack: {
    id: 'car',
    title: 'Car and transport',
    summary: 'Which vehicles are on the family list.',
    records: [
      {
        key: 'vehicle',
        label: 'Vehicle',
        person_attribution: 'holder',
        source: { kind: 'store' },
        fields: [
          { key: 'reg', label: 'Registration', kind: 'text' },
          { key: 'mot_due', label: 'MOT due', kind: 'date' },
        ],
      },
    ],
    playbook: {
      playbook: 'car',
      label: 'If there is an accident or breakdown: what is on the family list',
    },
  },
})

describe('a second domain drawn by the same page', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/domains?d=car')
  })

  it('takes its title and first-steps heading from the pack, and says when nothing is on the family list', async () => {
    getDomainView.mockResolvedValue(carView())
    render(<DomainsPage />)
    expect(await screen.findByText('Car and transport')).toBeTruthy()
    expect(screen.getByText(/Nothing on the family list yet/)).toBeTruthy()
    expect(screen.queryByText(/financial profile/)).toBeNull()
    expect(screen.queryByText('If someone dies: what is on the family list')).toBeNull()
  })

  it('lists the records when there is no matrix, and removes one', async () => {
    getDomainView.mockResolvedValue(
      carView([
        {
          id: 'v1',
          record: 'vehicle',
          holder_member_id: null,
          covers_member_id: null,
          values: { reg: 'AB12 CDE', mot_due: '2027-02-01' },
        },
      ]),
    )
    deleteDomainRecord.mockResolvedValue({ ok: true, status: 204 })
    render(<DomainsPage />)
    expect(await screen.findByText('AB12 CDE')).toBeTruthy()
    expect(
      screen.getByText('If there is an accident or breakdown: what is on the family list'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Vehicle' }))
    expect(deleteDomainRecord).not.toHaveBeenCalled() // asks first
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(deleteDomainRecord).toHaveBeenCalledWith('car', 'v1'))
  })

  it('keeps the record when the person chooses Keep it, with Keep it focused first', async () => {
    getDomainView.mockResolvedValue(
      carView([
        {
          id: 'v1',
          record: 'vehicle',
          holder_member_id: null,
          covers_member_id: null,
          values: { reg: 'AB12 CDE' },
        },
      ]),
    )
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Vehicle' }))
    const keep = screen.getByRole('button', { name: 'Keep it' })
    expect(document.activeElement).toBe(keep)
    fireEvent.click(keep)
    expect(deleteDomainRecord).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Yes, remove' })).toBeNull()
    expect(screen.getByText('AB12 CDE')).toBeTruthy()
    // Focus goes back to the button that opened the question, not the document.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Vehicle' })),
    )
  })

  it('after a removal, focus moves to the line that says who has seen the new version', async () => {
    getDomainView
      .mockResolvedValueOnce(
        carView([
          {
            id: 'v1',
            record: 'vehicle',
            holder_member_id: null,
            covers_member_id: null,
            values: { reg: 'AB12 CDE' },
          },
        ]),
      )
      .mockResolvedValueOnce(carView([]))
    deleteDomainRecord.mockResolvedValue({ ok: true, status: 204 })
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Vehicle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }))
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('status'))
  })

  it('adds a record from a form drawn from the pack, sending only what was filled in', async () => {
    getDomainView.mockResolvedValue(carView())
    addDomainRecord.mockResolvedValue({ ok: true, status: 201, data: { id: 'x' } })
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add a vehicle/ }))
    fireEvent.change(screen.getByLabelText(/Registration/), { target: { value: 'AB12 CDE' } })
    fireEvent.change(screen.getByLabelText(/Whose is it/), { target: { value: 'sam' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(addDomainRecord).toHaveBeenCalledWith('car', 'vehicle', {
        holder_member_id: 'sam',
        values: { reg: 'AB12 CDE' },
      }),
    )
  })

  it('states what is not on file as a fact, with no advice, and stops when it is', async () => {
    getDomainView.mockResolvedValue({ ...carView(), absent: ['No travel policy on file.'] })
    const { unmount } = render(<DomainsPage />)
    const note = await screen.findByText('No travel policy on file.')
    expect(note.textContent).not.toMatch(/should|recommend|buy|consider|need/i)
    unmount()
    getDomainView.mockResolvedValue({ ...carView(), absent: [] })
    render(<DomainsPage />)
    await screen.findByText('Car and transport')
    expect(screen.queryByText('No travel policy on file.')).toBeNull()
  })

  it('offers no add form to a read-only adult', async () => {
    getDomainView.mockResolvedValue({ ...carView(), can_edit: false })
    render(<DomainsPage />)
    await screen.findByText('Car and transport')
    expect(screen.queryByRole('button', { name: /Add a vehicle/ })).toBeNull()
  })
})

describe('keyboard and touch access', () => {
  it('makes the matrix a labelled, focusable scroll region', async () => {
    getDomainView.mockResolvedValue(view())
    render(<DomainsPage />)
    const region = await screen.findByRole('region', { name: 'Who is covered by what' })
    expect(region.getAttribute('tabindex')).toBe('0')
  })

  it('keeps the policy name visible while the matrix scrolls sideways, and controls at 16px', async () => {
    getDomainView.mockResolvedValue(view())
    render(<DomainsPage />)
    const rowHeader = await screen.findByRole('rowheader', { name: 'Policy · Provider A' })
    expect(rowHeader.className).toContain('sticky')
    expect(rowHeader.className).toContain('left-0')
    expect(screen.getByRole('button', { name: 'Sam' }).className).toContain('text-base')
  })

  it('gives the person chips and the confirm button a 48px touch target', async () => {
    getDomainView.mockResolvedValue(view())
    render(<DomainsPage />)
    const chip = await screen.findByRole('button', { name: 'Sam' })
    expect(chip.className).toContain('min-h-[48px]')
    expect(screen.getByRole('button', { name: 'I have seen this' }).className).toContain(
      'min-h-[48px]',
    )
  })
})

describe('hardening (critic pass 2)', () => {
  it('moves focus to the confirmation line after I have seen this, so keyboard users are not dropped', async () => {
    getDomainView.mockResolvedValue(view())
    confirmDomain.mockResolvedValue({
      ok: true,
      status: 200,
      data: view({
        viewer_confirmed: true,
        confirmed: [{ id: 'sam', name: 'Sam', confirmed_at: 'x' }],
      }),
    })
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'I have seen this' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'I have seen this' })).toBeNull(),
    )
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('status'))
    expect(document.activeElement?.textContent).toMatch(/Waiting for Alex/)
  })

  it('tells a read-only adult why there is nothing to add, and says nothing to an editor', async () => {
    getDomainView.mockResolvedValue({ ...view(), can_edit: false })
    render(<DomainsPage />)
    expect(
      await screen.findByText(/This account cannot add or remove what is on the family list/),
    ).toBeTruthy()
    expect(screen.getByText(/The organizer can change that in Settings, under Family/)).toBeTruthy()
    cleanup()
    getDomainView.mockResolvedValue(view())
    render(<DomainsPage />)
    await screen.findByText('Holds it')
    expect(screen.queryByText(/cannot add or remove/)).toBeNull()
  })

  it('offers Try again when the page cannot load, and loads on the second try', async () => {
    getDomainView.mockResolvedValueOnce(null).mockResolvedValueOnce(view())
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Holds it')).toBeTruthy()
    expect(getDomainView).toHaveBeenCalledTimes(2)
  })
})

describe('easy capture, first step (no new processing)', () => {
  it('tells a person their phone keyboard can type what they say, says the phone does it, and does not call it private', async () => {
    window.history.pushState({}, '', '/domains?d=car')
    getDomainView.mockResolvedValue(carView())
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add a vehicle/ }))
    const tips = screen.getAllByText(/microphone on your phone's keyboard/i)
    expect(tips.length).toBeGreaterThanOrEqual(1)
    for (const tip of tips) {
      expect(tip.textContent).toMatch(/Your phone does this, not LifeKeel/)
      expect(tip.textContent).not.toMatch(/private|secure|encrypted|approved/i)
    }
  })

  it('makes text inputs friendly to dictation and autofill hints', async () => {
    window.history.pushState({}, '', '/domains?d=car')
    getDomainView.mockResolvedValue(carView())
    render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add a vehicle/ }))
    const reg = screen.getByLabelText(/Registration/) as HTMLInputElement
    expect(reg.getAttribute('autocomplete')).toBe('off')
    expect(reg.getAttribute('autocapitalize')).toBe('sentences')
    expect(reg.getAttribute('enterkeyhint')).toBe('next')
    expect((screen.getByLabelText(/MOT due/) as HTMLInputElement).type).toBe('date')
  })

  it('offers Photograph a letter or policy to an editor, linking to the existing upload, and not to a read-only adult', async () => {
    window.history.pushState({}, '', '/domains?d=life_protection')
    getDomainView.mockResolvedValue(view())
    render(<DomainsPage />)
    const link = await screen.findByRole('link', { name: /Photograph a letter or policy/ })
    expect(link.getAttribute('href')).toBe('/upload')
    expect(
      screen.getByText(/Nothing is added to the family list until you confirm it/),
    ).toBeTruthy()
    cleanup()
    getDomainView.mockResolvedValue({ ...view(), can_edit: false })
    render(<DomainsPage />)
    await screen.findByText('Holds it')
    expect(screen.queryByRole('link', { name: /Photograph a letter or policy/ })).toBeNull()
  })

  it('says where rows read from elsewhere are changed, and says nothing when every row is typed here', async () => {
    window.history.pushState({}, '', '/domains?d=life_protection')
    getDomainView.mockResolvedValue(view())
    render(<DomainsPage />)
    expect(await screen.findByText(/Some of this comes from your/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'financial profile' }).getAttribute('href')).toBe(
      '/financial-profile',
    )
    cleanup()
    window.history.pushState({}, '', '/domains?d=car')
    getDomainView.mockResolvedValue(
      carView([
        {
          id: 'v1',
          record: 'vehicle',
          holder_member_id: null,
          covers_member_id: null,
          values: { reg: 'AB12 CDE' },
        },
      ]),
    )
    render(<DomainsPage />)
    await screen.findByText('AB12 CDE')
    expect(screen.queryByText(/Some of this comes from your/)).toBeNull()
  })
})

describe('say or type one sentence', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/domains?d=car')
  })
  const sentence = (v: string) =>
    fireEvent.change(screen.getByLabelText('Tell us in one sentence'), { target: { value: v } })
  const prepare = () =>
    fireEvent.click(screen.getByRole('button', { name: /Show me what you understood/ }))

  it('shows what it understood and saves only when the person taps Save', async () => {
    getDomainView.mockResolvedValue(carView())
    addDomainRecord.mockResolvedValue({ ok: true, status: 201, data: { id: 'x' } })
    render(<DomainsPage />)
    await screen.findByLabelText('Tell us in one sentence')
    sentence("MOT due 9 May on AB12 CDE, Sam's car and my cousin likes jazz")
    prepare()
    expect(await screen.findByText('Check this before it is saved')).toBeTruthy()
    expect(screen.getByText('AB12 CDE')).toBeTruthy()
    expect(screen.getByText('Sam')).toBeTruthy()
    expect(screen.getByText(/^9 May \d{4}$/)).toBeTruthy() // said the way people say it, not 2027-05-09
    expect(screen.getByText(/We did not use: .*cousin likes jazz/)).toBeTruthy()
    expect(addDomainRecord).not.toHaveBeenCalled() // nothing saved yet
    fireEvent.click(screen.getByRole('button', { name: 'Save to the family list' }))
    await waitFor(() =>
      expect(addDomainRecord).toHaveBeenCalledWith('car', 'vehicle', {
        holder_member_id: 'sam',
        values: { mot_due: expect.stringMatching(/^\d{4}-05-09$/), reg: 'AB12 CDE' },
      }),
    )
    expect(await screen.findByText('Saved to the family list.')).toBeTruthy()
  })

  it('keeps the draft and does not say saved when the save fails', async () => {
    getDomainView.mockResolvedValue(carView())
    addDomainRecord.mockResolvedValue({
      ok: false,
      status: 400,
      data: { error: 'Enter MOT due as a real date' },
    })
    render(<DomainsPage />)
    await screen.findByLabelText('Tell us in one sentence')
    sentence('MOT due 9 May')
    prepare()
    fireEvent.click(await screen.findByRole('button', { name: 'Save to the family list' }))
    await waitFor(() => expect(addDomainRecord).toHaveBeenCalled())
    expect(screen.queryByText('Saved to the family list.')).toBeNull()
    expect(screen.getByText('Check this before it is saved')).toBeTruthy()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
  })

  it('"Not right" throws the draft away without saving', async () => {
    getDomainView.mockResolvedValue(carView())
    render(<DomainsPage />)
    await screen.findByLabelText('Tell us in one sentence')
    sentence('MOT due 9 May')
    prepare()
    fireEvent.click(await screen.findByRole('button', { name: 'Not right' }))
    expect(screen.queryByText('Check this before it is saved')).toBeNull()
    expect(addDomainRecord).not.toHaveBeenCalled()
  })

  it('says so, and offers the form, when it cannot read anything', async () => {
    getDomainView.mockResolvedValue(carView())
    render(<DomainsPage />)
    await screen.findByLabelText('Tell us in one sentence')
    sentence('hello there how are you today')
    prepare()
    expect(await screen.findByText('We could not read that')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save to the family list' })).toBeNull()
  })

  it('reads nothing until asked, keeps focus on the result, and uses no network to read', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    getDomainView.mockResolvedValue(carView())
    render(<DomainsPage />)
    await screen.findByLabelText('Tell us in one sentence')
    const before = fetchSpy.mock.calls.length
    sentence('MOT due 9 May')
    expect(screen.queryByText('Check this before it is saved')).toBeNull()
    prepare()
    const heading = await screen.findByText('Check this before it is saved')
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(fetchSpy.mock.calls.length).toBe(before)
    fetchSpy.mockRestore()
  })

  it('is not offered to a read-only adult or for a pack with nothing typed in', async () => {
    getDomainView.mockResolvedValue({ ...carView(), can_edit: false })
    render(<DomainsPage />)
    await screen.findByText('Car and transport')
    expect(screen.queryByLabelText('Tell us in one sentence')).toBeNull()
    cleanup()
    window.history.pushState({}, '', '/domains?d=life_protection')
    getDomainView.mockResolvedValue(view())
    render(<DomainsPage />)
    await screen.findByText('Holds it')
    expect(screen.queryByLabelText('Tell us in one sentence')).toBeNull()
  })
})

describe('domain copy', () => {
  it('words a date relative to today', () => {
    expect(daysText(0)).toBe('today')
    expect(daysText(1)).toBe('tomorrow')
    expect(daysText(12)).toBe('in 12 days')
    expect(daysText(-3)).toBe('3 days ago')
  })

  it('describes cells and confirmation as facts', () => {
    expect(cellText(null)).toBe('Not recorded')
    expect(cellText('holds_and_covers')).toBe('Holds it and is covered')
    expect(confirmSummary(view({ both_confirmed: true }).confirmation)).toBe(
      'All 2 adults have seen this version.',
    )
    expect(
      confirmSummary({
        required: [],
        confirmed: [],
        both_confirmed: false,
        viewer_confirmed: false,
      }),
    ).toMatch(/No adults/)
  })
})
