/** AI Memory only ever shows what Keel found in the family's own documents. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

let docs: unknown[] = []
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  fetchDocuments: async () => ({ documents: docs }),
  fetchProfileSuggestions: async () => ({ suggestions: [], policySuggestion: null }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

import { MemoryPrompts } from '../Intelligence'

afterEach(cleanup)

describe('MemoryPrompts', () => {
  it('shows nothing, not canned examples, when no document has produced a finding', async () => {
    docs = []
    const { container } = render(<MemoryPrompts />)
    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(screen.queryByText('Sample')).toBeNull()
    expect(screen.queryByText(/new vehicle in your transactions/)).toBeNull()
    expect(screen.queryByText(/We found a pension statement/)).toBeNull()
  })
})
