/**
 * PRD-146 web: the receipt says only what is true, the account page keeps the
 * receipt for one view, and the API helpers carry the right request and result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { DeletionReceiptCard } from '../DeletionReceiptCard'
import AccountDeletedPage from '../../app/account-deleted/page'
import {
  RECEIPT_STORAGE_KEY,
  deleteAccount,
  deleteFamilyDocument,
  disconnectMailboxAndDelete,
  type DeletionReceipt,
} from '@/lib/api'
import * as copy from '@/lib/deletion-receipt-copy'

const receipt = (over: Partial<DeletionReceipt> = {}): DeletionReceipt => ({
  id: 'abcdef12-0000-0000-0000-000000000000',
  kind: 'account',
  status: 'completed',
  requested_at: '2026-10-20T10:00:00.000Z',
  completed_at: '2026-10-20T10:00:05.000Z',
  removed: [
    { category: 'account', count: 1 },
    { category: 'documents and what was read from them', count: 4 },
  ],
  kept: ['A record that this deletion happened, with counts and no content, is kept for 7 years.'],
  verification: { passed: true, residual: [] },
  live_data_erased: true,
  backups: {
    retention_days: null,
    statement:
      'Erasure also covers backups, but a backup taken before this deletion can keep a copy until it is overwritten. How long backups are kept is not yet confirmed.',
  },
  processors: [
    {
      id: 'anthropic',
      name: 'Anthropic API',
      stated_retention: 'Not confirmed: its terms have not been reviewed yet.',
    },
  ],
  ...over,
})

beforeEach(() => sessionStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DeletionReceiptCard', () => {
  it('lists counts by category, the backup statement and each provider’s stated retention', () => {
    render(<DeletionReceiptCard receipt={receipt()} />)
    expect(screen.getByText(copy.RECEIPT_TITLE.account)).toBeTruthy()
    expect(screen.getByText(copy.STATUS_LINE.erased)).toBeTruthy()
    expect(screen.getByText('4 × documents and what was read from them')).toBeTruthy()
    expect(screen.getByText(/How long backups are kept is not yet confirmed/)).toBeTruthy()
    expect(screen.getByText(/Anthropic API: Not confirmed/)).toBeTruthy()
    expect(screen.getByText(/kept for 7 years/)).toBeTruthy()
  })

  it('does not claim everything is gone while the check still finds data', () => {
    render(
      <DeletionReceiptCard
        receipt={receipt({
          status: 'partial',
          live_data_erased: false,
          verification: {
            passed: false,
            residual: [{ category: 'insights and alerts', count: 2 }],
          },
        })}
      />,
    )
    expect(screen.getByText(copy.STATUS_LINE.finishing)).toBeTruthy()
    expect(screen.queryByText(copy.STATUS_LINE.erased)).toBeNull()
  })
})

describe('/account-deleted', () => {
  it('shows the stored receipt once it exists, and a plain message when it does not', async () => {
    sessionStorage.setItem(RECEIPT_STORAGE_KEY, JSON.stringify(receipt()))
    render(<AccountDeletedPage />)
    expect(await screen.findByText(copy.STATUS_LINE.erased)).toBeTruthy()
    cleanup()
    sessionStorage.clear()
    render(<AccountDeletedPage />)
    expect(await screen.findByText(/no longer available on this device/)).toBeTruthy()
  })
})

describe('deletion API helpers', () => {
  const mockFetch = (status: number, body: unknown) => {
    const fn = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body })
    vi.stubGlobal('fetch', fn)
    return fn
  }

  it('deleteAccount hands back the receipt, and flags a deletion that is still finishing', async () => {
    mockFetch(200, { deleted: true, receipt: receipt() })
    expect(await deleteAccount('me@x.test')).toMatchObject({
      ok: true,
      inProgress: false,
      receipt: { kind: 'account' },
    })
    mockFetch(202, { deleted: false, in_progress: true, receipt: receipt({ status: 'partial' }) })
    expect(await deleteAccount('me@x.test')).toMatchObject({ ok: true, inProgress: true })
    mockFetch(400, { error: 'Type your account email to confirm deletion' })
    expect(await deleteAccount('x')).toEqual({
      ok: false,
      error: 'Type your account email to confirm deletion',
    })
  })

  it('disconnectMailboxAndDelete asks for the data to go and returns the receipt, or null on failure', async () => {
    const fn = mockFetch(200, { success: true, receipt: receipt({ kind: 'mailbox' }) })
    expect((await disconnectMailboxAndDelete('email'))?.kind).toBe('mailbox')
    const [url, init] = fn.mock.calls[0]!
    expect(String(url)).toMatch(/\/connectors\/email\/disconnect$/)
    expect(JSON.parse(init.body)).toEqual({ delete_data: true })
    mockFetch(500, {})
    expect(await disconnectMailboxAndDelete('email')).toBeNull()
  })

  it('deleteFamilyDocument returns the receipt, or the server’s reason', async () => {
    mockFetch(200, { success: true, receipt: receipt({ kind: 'document' }) })
    expect(await deleteFamilyDocument('d1')).toMatchObject({
      ok: true,
      receipt: { kind: 'document' },
    })
    mockFetch(404, { error: 'Document not found' })
    expect(await deleteFamilyDocument('d1')).toEqual({ ok: false, error: 'Document not found' })
  })
})

describe('deletion copy', () => {
  const all = [
    ...Object.values(copy.RECEIPT_TITLE),
    ...Object.values(copy.STATUS_LINE),
    copy.ACCOUNT_CLOSED_NOTE,
    copy.DOCUMENT_DELETE_MESSAGE,
    copy.MAILBOX_DELETE_TITLE,
    copy.MAILBOX_DELETE_MESSAGE,
    copy.ACCOUNT_DELETE_WARNING,
  ].join(' ')

  it('never says permanent, instant or that nothing exists anywhere', () => {
    expect(all).not.toMatch(/permanent|instant|none exist|nothing exists/i)
  })

  it('says backups can keep a copy for a while, and makes no recommendation', () => {
    expect(copy.ACCOUNT_DELETE_WARNING).toMatch(
      /Backups can keep a copy until they are overwritten/,
    )
    expect(all).not.toMatch(/\b(you should|we recommend|buy|switch to)\b/i)
  })
})
