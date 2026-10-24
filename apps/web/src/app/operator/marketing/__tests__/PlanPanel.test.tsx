import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { PlanPanel } from '../_components/PlanPanel'
import type { PlanWeekView } from '@/lib/api'

vi.mock('@/components/Toast', () => ({ useToast: () => vi.fn() }))

const ok = { ok: true, violations: [] }
const week: PlanWeekView = {
  week_key: '2026-10-26',
  available_channels: ['bluesky'],
  items: [
    {
      id: 'i1',
      week_key: '2026-10-26',
      slot: 0,
      pillar: 'chart',
      title: 'The chart',
      scheduled_at: '2026-10-26T09:00:00Z',
      status: 'planned',
      posts: [
        {
          id: 'p1',
          channel: 'bluesky',
          content: 'A good draft',
          content_hash: 'h1',
          state: 'draft',
          scheduled_at: '2026-10-26T09:00:00Z',
          copy_check: ok,
        },
      ],
    },
    {
      id: 'i2',
      week_key: '2026-10-26',
      slot: 1,
      pillar: 'cover_on_file',
      title: 'Cover on file',
      scheduled_at: '2026-10-28T09:00:00Z',
      status: 'planned',
      posts: [
        {
          id: 'p2',
          channel: 'bluesky',
          content: 'We recommend Aviva',
          content_hash: 'h2',
          state: 'draft',
          scheduled_at: '2026-10-28T09:00:00Z',
          copy_check: { ok: false, violations: [{ rule: 'named provider', match: 'Aviva' }] },
        },
      ],
    },
  ],
}

let current: PlanWeekView = week
const approve = vi.fn(async () => ({ approved: 1, refused: 0, results: [] }))
const generate = vi.fn(async () => week)
const updatePost = vi.fn(async () => ({}))
vi.mock('@/lib/api', async () => ({
  fetchPlanWeek: async () => current,
  generatePlanWeek: (...a: unknown[]) => generate(...(a as [])),
  approvePlanPosts: (...a: unknown[]) => approve(...(a as [])),
  skipPlanItem: vi.fn(async () => ({ ok: true })),
  updateMarketingPost: (...a: unknown[]) => updatePost(...(a as [])),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  current = week
})

describe('PlanPanel', () => {
  it('offers to draft an empty week, but not with no network to draft for', async () => {
    current = { ...week, items: [], available_channels: [] }
    render(<PlanPanel />)
    const btn = (await screen.findByRole('button', {
      name: 'Draft this week',
    })) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('does not let a draft that fails the guard be approved, and says why', async () => {
    render(<PlanPanel />)
    await screen.findByText('A good draft')
    const bad = screen.getByLabelText(
      'Approve the bluesky draft for Cover on file',
    ) as HTMLInputElement
    expect(bad.disabled).toBe(true)
    expect(bad.checked).toBe(false)
    expect(screen.getByRole('alert').textContent).toMatch(/named provider \("Aviva"\)/)
    const good = screen.getByLabelText(
      'Approve the bluesky draft for The chart',
    ) as HTMLInputElement
    expect(good.checked).toBe(true)
  })

  it('approves only the ticked posts, each with the hash of the text on screen', async () => {
    render(<PlanPanel />)
    await screen.findByText('A good draft')
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1 for the week' }))
    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith([{ post_id: 'p1', content_hash: 'h1' }]),
    )
  })

  it('lets the reviewer untick a draft before approving', async () => {
    render(<PlanPanel />)
    await screen.findByText('A good draft')
    fireEvent.click(screen.getByLabelText('Approve the bluesky draft for The chart'))
    expect(
      (screen.getByRole('button', { name: 'Approve 0 for the week' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  describe('across every platform', () => {
    const igWeek = (): PlanWeekView => ({
      ...week,
      available_channels: ['bluesky', 'instagram'],
      items: [
        {
          ...week.items[0]!,
          posts: [
            week.items[0]!.posts[0]!,
            {
              id: 'ig1',
              channel: 'instagram',
              content: 'A good Instagram draft',
              content_hash: 'hig',
              state: 'draft',
              scheduled_at: '2026-10-26T09:00:00Z',
              copy_check: ok,
              needs_image: true,
            },
          ],
        },
      ],
    })

    it('does not let an Instagram draft without an image be approved, and says so', async () => {
      current = igWeek()
      render(<PlanPanel />)
      await screen.findByText('A good Instagram draft')
      const box = screen.getByLabelText(
        'Approve the instagram draft for The chart',
      ) as HTMLInputElement
      expect(box.disabled).toBe(true)
      expect(box.checked).toBe(false)
      expect(screen.getByText(/Instagram needs an image before this can be approved/)).toBeTruthy()
      // The Bluesky draft in the same week is still ticked and approvable.
      expect(
        (screen.getByLabelText('Approve the bluesky draft for The chart') as HTMLInputElement)
          .checked,
      ).toBe(true)
      expect(screen.getByRole('button', { name: 'Approve 1 for the week' })).toBeTruthy()
    })

    it('attaches an image by URL (https only) and then reloads', async () => {
      current = igWeek()
      render(<PlanPanel />)
      await screen.findByText('A good Instagram draft')
      const attach = screen.getByRole('button', { name: 'Attach image' }) as HTMLButtonElement
      expect(attach.disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Image URL for post ig1'), {
        target: { value: 'http://insecure.example/a.png' },
      })
      expect(attach.disabled).toBe(true) // https only
      fireEvent.change(screen.getByLabelText('Image URL for post ig1'), {
        target: { value: 'https://cdn.example.com/a.png' },
      })
      expect(attach.disabled).toBe(false)
      fireEvent.click(attach)
      await waitFor(() =>
        expect(updatePost).toHaveBeenCalledWith('ig1', {
          media_url: 'https://cdn.example.com/a.png',
        }),
      )
    })

    it('says which connected platforms were left out of the plan, and why', async () => {
      current = {
        ...week,
        skipped_channels: [
          {
            channel: 'linkedin',
            status: 'needs_reauth',
            reason: 'linkedin token expired — reconnect',
          },
        ],
      }
      render(<PlanPanel />)
      await screen.findByText(/Left out of this plan/)
      expect(screen.getByText(/linkedin \(linkedin token expired — reconnect\)/)).toBeTruthy()
      expect(screen.getByText(/Reconnect in the Connections tab/)).toBeTruthy()
    })
  })
})
