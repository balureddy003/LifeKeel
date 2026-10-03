/**
 * PRD-137 §8 — the /legacy surface: documents grouped by subject with
 * verification badges and review-due chips, property cards with/without
 * legacy detail, the Family map SVG + side-panel notes flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { LegacyDocument, LegacyGraph, FamilyAsset, LegacyContact } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  fetchLegacyDocuments: vi.fn(),
  createLegacyDocument: vi.fn(),
  updateLegacyDocument: vi.fn(),
  deleteLegacyDocument: vi.fn(),
  fetchLegacyContacts: vi.fn(),
  createLegacyContact: vi.fn(),
  fetchLegacyNotes: vi.fn(),
  createLegacyNote: vi.fn(),
  fetchLegacyGraph: vi.fn(),
  fetchFamilyAssets: vi.fn(),
  fetchFamilyGroup: vi.fn(),
  fetchFamilyReadiness: vi.fn(),
  fetchVaultDocuments: vi.fn(),
  updateAssetLegacy: vi.fn(),
}))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'm1' } }) }))
vi.mock('@/components/Toast', () => ({ useToast: () => vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/components/Glass', async () => {
  const React = await import('react')
  return {
    PageHeader: ({ title }: { title: string }) => React.createElement('h1', null, title),
    GlassCard: ({ children, className }: { children: React.ReactNode; className?: string }) => React.createElement('div', { className }, children),
    EmptyState: ({ title, description }: { title: string; description: string }) => React.createElement('div', null, title, ' ', description),
    Skeleton: ({ className }: { className?: string }) => React.createElement('div', { className }),
  }
})

import * as api from '@/lib/api'
import LegacyClient from '../LegacyClient'

const members = [
  { id: 'm1', name: 'Alex', role: 'organizer', status: 'active', userId: 'u1' },
  { id: 'm2', name: 'Sam', role: 'parent', status: 'active', userId: 'u2' },
]

const will: LegacyDocument = {
  id: 'd1', type: 'will', subject_member_id: 'm1', jurisdiction: 'England & Wales',
  signed_on: '2019-01-01', last_reviewed_on: '2019-01-01', original_location: 'Solicitor X Leeds',
  roles: [{ role: 'executor', member_id: 'm2', verification: 'user_declared' }],
  covers_asset_ids: ['a1'], verification: 'user_declared', visibility: 'adults',
  created_at: 'x', updated_at: 'x',
}

const property: FamilyAsset = {
  id: 'a1', kind: 'property', name: 'Ancestral home', value_minor: 0, notes: null,
  legacy: {
    ownership_basis: 'inherited', jurisdiction: 'Telangana IN',
    recorded_owners: [{ role: 'beneficiary', member_id: 'm2', share_pct: 50, verification: 'document_linked' }],
    claimed_owners: [], insured: 'unknown', dispute: 'possible', verification: 'family_understanding',
  },
  created_at: 'x', updated_at: 'x',
}

const graph: LegacyGraph = {
  nodes: [
    { id: 'member:m1', kind: 'member', label: 'Alex' },
    { id: 'document:d1', kind: 'document', label: 'Will for Alex', verification: 'user_declared' },
    { id: 'asset:a1', kind: 'asset', label: 'Ancestral home', verification: 'family_understanding' },
  ],
  edges: [
    { from: 'member:m1', to: 'document:d1', kind: 'subject_of' },
    { from: 'document:d1', to: 'asset:a1', kind: 'covers' },
  ],
}

const readiness = {
  score: 55, has_live_data: true, computed_at: 'x',
  components: [{
    key: 'estate', label: 'Estate', score: 55, weight: 20, detail: '',
    caption: "Completeness and freshness of what's recorded — not legal validity.",
    drivers: [], insights: [],
  }],
  insights: [],
}

function mockLoad() {
  vi.mocked(api.fetchLegacyDocuments).mockResolvedValue([will])
  vi.mocked(api.fetchLegacyContacts).mockResolvedValue([] as LegacyContact[])
  vi.mocked(api.fetchLegacyNotes).mockResolvedValue([])
  vi.mocked(api.fetchFamilyAssets).mockResolvedValue({ assets: [property], summary: { total_minor: 0, by_kind: {} } } as never)
  vi.mocked(api.fetchFamilyGroup).mockResolvedValue({ id: 'g', name: 'Fam', members } as never)
  vi.mocked(api.fetchFamilyReadiness).mockResolvedValue(readiness as never)
  vi.mocked(api.fetchVaultDocuments).mockResolvedValue({ documents: [], forbidden: false } as never)
  vi.mocked(api.fetchLegacyGraph).mockResolvedValue(graph)
}

describe('LegacyClient', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoad() })

  it('renders documents grouped by member with badges and a Review due chip', async () => {
    render(<LegacyClient />)
    await waitFor(() => expect(screen.getByText('will')).toBeTruthy())
    expect(screen.getByText('Alex')).toBeTruthy() // subject group header
    expect(screen.getByText('Review due')).toBeTruthy() // 2019 review > 36 months
    expect(screen.getByText(/Solicitor X Leeds/)).toBeTruthy()
    expect(screen.getByText(/Sam — executor/)).toBeTruthy()
    expect(screen.getAllByText('user declared').length).toBeGreaterThan(0)
    expect(screen.getByText('Estate readiness')).toBeTruthy()
    expect(screen.getByText("Completeness and freshness of what's recorded — not legal validity.")).toBeTruthy()
  })

  it('shows the medical-details helper under every notes field', async () => {
    render(<LegacyClient />)
    await waitFor(() => screen.getByText('will'))
    // Open the document sheet — its notes textarea carries the helper.
    fireEvent.click(screen.getByText('Record a document'))
    expect(screen.getAllByText(/please don't include medical details/i).length).toBeGreaterThan(0)
  })

  it('property tab shows legacy fields with verification badges', async () => {
    render(<LegacyClient />)
    await waitFor(() => screen.getByText('will'))
    fireEvent.click(screen.getByText('Property & land'))
    expect(screen.getByText('Ancestral home')).toBeTruthy()
    expect(screen.getByText(/Telangana IN/)).toBeTruthy()
    expect(screen.getByText('dispute possible')).toBeTruthy()
    expect(screen.getByText('document linked')).toBeTruthy()
    expect(screen.getByText('family understanding')).toBeTruthy()
  })

  it('map tab renders graph nodes and opens the side panel with notes', async () => {
    vi.mocked(api.createLegacyNote).mockResolvedValue({
      id: 'n1', node: { kind: 'document', id: 'd1' }, text: 'Ask gran about the deed',
      author_user_id: 'u1', created_at: 'x', verification: 'family_understanding',
    })
    render(<LegacyClient />)
    await waitFor(() => screen.getByText('will'))
    fireEvent.click(screen.getByText('Family map'))
    await waitFor(() => expect(screen.getByText('Will for Alex')).toBeTruthy())
    expect(api.fetchLegacyGraph).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Will for Alex'))
    await waitFor(() => expect(screen.getByText('Notes')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Something only you know/), { target: { value: 'Ask gran about the deed' } })
    fireEvent.click(screen.getByText('Add a note'))
    await waitFor(() =>
      expect(api.createLegacyNote).toHaveBeenCalledWith({ node: { kind: 'document', id: 'd1' }, text: 'Ask gran about the deed' }),
    )
    expect(screen.getByText(/please don't include medical details/i)).toBeTruthy()
  })
})
