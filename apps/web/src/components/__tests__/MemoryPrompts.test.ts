import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchDocuments = vi.fn()
const fetchProfileSuggestions = vi.fn()

vi.mock('@/lib/api', () => ({
  fetchDocuments: (...a: unknown[]) => fetchDocuments(...a),
  fetchProfileSuggestions: (...a: unknown[]) => fetchProfileSuggestions(...a),
  fetchFinancialProfile: vi.fn(),
  fetchConnectorStatuses: vi.fn(),
}))

import { loadDocumentPrompts } from '../Intelligence'

const doc = (over: Record<string, unknown>) => ({
  id: 'd1',
  filename: 'pension.pdf',
  category: 'pension',
  status: 'extracted',
  uploadedAt: '2026-09-19T10:00:00Z',
  ...over,
})

beforeEach(() => {
  fetchDocuments.mockReset()
  fetchProfileSuggestions.mockReset()
})

describe('loadDocumentPrompts — real, document-driven AI Memory', () => {
  it('builds a prompt linking to the real document when extraction produced a suggestion', async () => {
    fetchDocuments.mockResolvedValue({ documents: [doc({})], aiExtractionEnabled: true })
    fetchProfileSuggestions.mockResolvedValue({ suggestions: [{ path: 'retirement.pension_balance_minor' }], policySuggestion: null })
    const prompts = await loadDocumentPrompts()
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({ id: 'd1', route: '/documents/d1', action: 'Review' })
    expect(prompts[0]!.message).toContain('pension.pdf')
  })

  it('skips documents with nothing actionable, non-extracted status, or unmapped categories', async () => {
    fetchDocuments.mockResolvedValue({
      documents: [
        doc({ id: 'a' }),
        doc({ id: 'b', status: 'stored' }),
        doc({ id: 'c', category: 'other' }),
      ],
      aiExtractionEnabled: true,
    })
    fetchProfileSuggestions.mockResolvedValue({ suggestions: [], policySuggestion: null })
    expect(await loadDocumentPrompts()).toEqual([])
    expect(fetchProfileSuggestions).toHaveBeenCalledTimes(1)
  })

  it('surfaces an insurance document that only yielded a policy suggestion with a provider', async () => {
    fetchDocuments.mockResolvedValue({ documents: [doc({ id: 'p', category: 'insurance' })], aiExtractionEnabled: true })
    fetchProfileSuggestions.mockResolvedValue({ suggestions: [], policySuggestion: { provider: 'Aviva' } })
    const prompts = await loadDocumentPrompts()
    expect(prompts[0]).toMatchObject({ id: 'p', title: 'We found an insurance document' })
  })

  it('only scans the three most recent documents', async () => {
    fetchDocuments.mockResolvedValue({
      documents: [1, 2, 3, 4, 5].map((n) => doc({ id: `d${n}`, uploadedAt: `2026-09-0${n}T00:00:00Z` })),
      aiExtractionEnabled: true,
    })
    fetchProfileSuggestions.mockResolvedValue({ suggestions: [{ path: 'x' }], policySuggestion: null })
    const prompts = await loadDocumentPrompts()
    expect(prompts.map((p) => p.id)).toEqual(['d5', 'd4', 'd3'])
  })
})
