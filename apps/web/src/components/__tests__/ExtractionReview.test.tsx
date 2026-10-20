/**
 * PRD-143 review screen: every value is shown with its source quote and an
 * honest note on how well it was grounded, nothing counts until a person
 * decides, the type question gates everything, and a failed read offers manual
 * entry instead of implying anything was saved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ExtractionReview, type ExtractionReviewApi } from '../ExtractionReview'
import type { DocumentCandidate, FamilyDocumentDetail } from '@/lib/api'
import * as copy from '@/lib/extraction-review-copy'

const field = (over: Partial<DocumentCandidate> = {}): DocumentCandidate => ({
  key: 'coverage_amount',
  value: '£250,000',
  confidence: 0.95,
  grounding: 'verbatim_unique',
  span: { start: 10, end: 18 },
  snippet: 'Sum assured: £250,000 payable on death',
  needs_review: false,
  status: 'proposed',
  ...over,
})

const doc = (over: Partial<FamilyDocumentDetail> = {}): FamilyDocumentDetail => ({
  id: 'd1',
  filename: 'policy.pdf',
  category: 'insurance',
  status: 'extracted',
  uploadedAt: '2026-10-01T00:00:00Z',
  rawText: '',
  classification: {
    category: 'insurance',
    confidence: 0.9,
    needs_confirmation: false,
    confirmed: false,
  },
  scan: 'not_performed',
  candidates: [field()],
  ...over,
})

function fakeApi(): ExtractionReviewApi & {
  review: ReturnType<typeof vi.fn>
  confirmType: ReturnType<typeof vi.fn>
} {
  return {
    confirmType: vi.fn(async () => ({ ok: true as const })),
    review: vi.fn(async () => ({
      ok: true as const,
      candidates: [field({ status: 'confirmed' })],
    })),
  } as never
}

afterEach(cleanup)

describe('what each value shows', () => {
  it('the value, a quote with the value picked out, and a plain note that it was found', () => {
    render(<ExtractionReview doc={doc()} onChange={() => {}} api={fakeApi()} />)
    expect(screen.getByText('Amount covered')).toBeTruthy()
    const mark = document.querySelector('mark')!
    expect(mark.textContent).toBe('£250,000')
    expect(screen.getByText(/From the document:/)).toBeTruthy()
    expect(screen.getByText(copy.GROUNDING_TEXT.verbatim_unique)).toBeTruthy()
    expect(screen.getByText(copy.REVIEW_INTRO)).toBeTruthy()
  })

  it('marks a value Keel could not find, and one read from an image, as needing a check, with no invented quote', () => {
    render(
      <ExtractionReview
        doc={doc({
          candidates: [
            field({
              key: 'provider',
              value: 'Acme',
              grounding: 'not_found',
              confidence: 0.2,
              snippet: null,
              span: null,
              needs_review: true,
            }),
            field({
              key: 'premium',
              value: '£30',
              grounding: 'image_only',
              confidence: 0.5,
              snippet: null,
              span: null,
              needs_review: true,
            }),
          ],
        })}
        onChange={() => {}}
        api={fakeApi()}
      />,
    )
    expect(screen.getByText(copy.GROUNDING_TEXT.not_found)).toBeTruthy()
    expect(screen.getByText(copy.GROUNDING_TEXT.image_only)).toBeTruthy()
    expect(screen.getAllByText('Needs your check')).toHaveLength(2)
    expect(screen.queryByText(/From the document:/)).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(copy.FIRST_ADDED(2, 2))
  })

  it('shows how old the document is, and says old figures may have changed', () => {
    render(
      <ExtractionReview
        doc={doc({ documentDate: '12 March 2024' })}
        onChange={() => {}}
        api={fakeApi()}
        now={new Date('2026-10-20')}
      />,
    )
    expect(
      screen.getByText(/Dated 12 March 2024, 2 years ago. Figures this old may have changed./),
    ).toBeTruthy()
    expect(copy.documentAgeText('not a date')).toBeNull()
    expect(copy.documentAgeText(null)).toBeNull()
  })
})

describe('deciding', () => {
  it('confirm sends one decision and hands the updated candidates back', async () => {
    const api = fakeApi()
    const onChange = vi.fn()
    render(<ExtractionReview doc={doc()} onChange={onChange} api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }))
    await waitFor(() =>
      expect(api.review).toHaveBeenCalledWith('d1', [
        { key: 'coverage_amount', action: 'confirm' },
      ]),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0]![0].candidates[0].status).toBe('confirmed')
  })

  it('reject sends a reject, and an edit sends the typed value', async () => {
    const api = fakeApi()
    render(<ExtractionReview doc={doc()} onChange={() => {}} api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /Reject/ }))
    await waitFor(() =>
      expect(api.review).toHaveBeenLastCalledWith('d1', [
        { key: 'coverage_amount', action: 'reject' },
      ]),
    )

    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    fireEvent.change(screen.getByLabelText('Edit Amount covered'), {
      target: { value: ' £300,000 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))
    await waitFor(() =>
      expect(api.review).toHaveBeenLastCalledWith('d1', [
        { key: 'coverage_amount', action: 'edit', value: '£300,000' },
      ]),
    )
  })

  it('shows the server’s reason when a decision is refused, and keeps the field as it was', async () => {
    const api = fakeApi()
    api.review.mockResolvedValue({
      ok: false,
      error: 'That value does not look right for this field.',
    })
    const onChange = vi.fn()
    render(<ExtractionReview doc={doc()} onChange={onChange} api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    fireEvent.change(screen.getByLabelText('Edit Amount covered'), { target: { value: 'lots' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'That value does not look right for this field.',
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Edit Amount covered')).toBeTruthy() // still editing
  })

  it('shows confirmed, edited and rejected values distinctly, and the edited one in place of the original', () => {
    render(
      <ExtractionReview
        doc={doc({
          candidates: [
            field({ key: 'provider', value: 'Acme', status: 'confirmed' }),
            field({ key: 'premium', value: '£30', status: 'edited', edited_value: '£35' }),
            field({ key: 'net_pay', value: '£2,000', status: 'rejected' }),
          ],
        })}
        onChange={() => {}}
        api={fakeApi()}
      />,
    )
    expect(screen.getByText('Confirmed')).toBeTruthy()
    expect(screen.getByText('Edited by you')).toBeTruthy()
    expect(screen.getByText('Rejected')).toBeTruthy()
    expect(screen.getByText('£35')).toBeTruthy()
    expect(screen.queryByText('£30')).toBeNull()
  })
})

describe('what is this document?', () => {
  const unsure = () =>
    doc({
      classification: {
        category: 'insurance',
        confidence: 0.7,
        needs_confirmation: true,
        confirmed: false,
      },
    })

  it('asks before showing any value, and records the answer', async () => {
    const api = fakeApi()
    const onChange = vi.fn()
    render(<ExtractionReview doc={unsure()} onChange={onChange} api={api} />)
    expect(screen.getByText(copy.TYPE_CARD_TITLE)).toBeTruthy()
    expect(screen.queryByText('Amount covered')).toBeNull()

    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'pension' } })
    fireEvent.click(screen.getByRole('button', { name: /This is a pension document/ }))
    await waitFor(() => expect(api.confirmType).toHaveBeenCalledWith('d1', 'pension'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0]![0]).toMatchObject({
      category: 'pension',
      classification: { confirmed: true, category: 'pension' },
    })
  })

  it('does not ask once the type is confirmed or the model was sure', () => {
    render(
      <ExtractionReview
        doc={doc({
          classification: {
            category: 'insurance',
            confidence: 0.7,
            needs_confirmation: true,
            confirmed: true,
          },
        })}
        onChange={() => {}}
        api={fakeApi()}
      />,
    )
    expect(screen.queryByText(copy.TYPE_CARD_TITLE)).toBeNull()
    expect(screen.getByText('Amount covered')).toBeTruthy()
  })

  it('shows the reason when the type cannot be saved', async () => {
    const api = fakeApi()
    api.confirmType.mockResolvedValue({ ok: false, error: 'Choose one of the document types' })
    render(<ExtractionReview doc={unsure()} onChange={() => {}} api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /This is a/ }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Choose one of the document types',
    )
  })
})

describe('when nothing could be read', () => {
  it('a failed read says nothing was saved and offers manual entry', () => {
    render(
      <ExtractionReview
        doc={doc({ status: 'error', candidates: [] })}
        onChange={() => {}}
        api={fakeApi()}
      />,
    )
    expect(screen.getByText(copy.READ_FAILED_TITLE)).toBeTruthy()
    expect(screen.getByText(copy.READ_FAILED_TEXT)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Enter the details myself' }).getAttribute('href'),
    ).toBe('/financial-profile')
    expect(screen.queryByText('Amount covered')).toBeNull()
  })

  it('a file the scanner could not check says it was kept but not read', () => {
    render(
      <ExtractionReview
        doc={doc({ scan: 'error', status: 'stored', candidates: [] })}
        onChange={() => {}}
        api={fakeApi()}
      />,
    )
    expect(screen.getByText(copy.SCAN_FAILED_TEXT)).toBeTruthy()
  })

  it('a document with no recognised details says so, with the same way out', () => {
    render(<ExtractionReview doc={doc({ candidates: [] })} onChange={() => {}} api={fakeApi()} />)
    expect(screen.getByText(copy.NO_FIELDS_TEXT)).toBeTruthy()
    expect(
      within(document.body).getByRole('link', { name: 'Enter the details myself' }),
    ).toBeTruthy()
  })
})

describe('review copy', () => {
  const all = [
    copy.REVIEW_TITLE,
    copy.REVIEW_INTRO,
    ...Object.values(copy.FIELD_LABELS),
    ...Object.values(copy.GROUNDING_TEXT),
    copy.TYPE_CARD_TITLE,
    copy.TYPE_CARD_TEXT,
    copy.READ_FAILED_TITLE,
    copy.READ_FAILED_TEXT,
    copy.SCAN_FAILED_TEXT,
    copy.NO_FIELDS_TEXT,
    copy.SAVE_HINT,
    copy.FIRST_ADDED(0, 3),
    copy.FIRST_ADDED(2, 3),
  ].join(' ')

  it('says plainly that a read can be wrong and only confirmed values are saved (amendment 3)', () => {
    expect(copy.REVIEW_INTRO).toMatch(/a read can be wrong/i)
    expect(copy.REVIEW_INTRO).toMatch(/only saves what you confirm/i)
  })

  it('makes no recommendation, compares no product and never calls a read safe or certain', () => {
    expect(all).not.toMatch(
      /\b(you should|we recommend|buy|switch to|better policy|best (policy|provider))\b/i,
    )
    expect(all).not.toMatch(/\b(guarantee|certain|always correct|verified by)\b/i)
  })

  it('covers every field the API can return', () => {
    for (const k of [
      'provider',
      'policy_type',
      'policy_number',
      'coverage_amount',
      'premium',
      'renewal_date',
      'has_beneficiary',
      'claims_phone',
      'claims_email',
      'balance',
      'net_pay',
      'gross_pay',
      'document_date',
    ]) {
      expect(copy.FIELD_LABELS[k], `no label for ${k}`).toBeTruthy()
    }
  })
})
