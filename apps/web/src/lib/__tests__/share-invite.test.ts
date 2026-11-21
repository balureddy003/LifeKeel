import { describe, it, expect, vi } from 'vitest'
import { shareInviteLink } from '../share-invite'

describe('shareInviteLink', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    expect(await shareInviteLink('https://x/invite/abc', 'Sam', { share })).toBe('shared')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x/invite/abc' }))
  })
  it('treats cancelling the sheet as a normal exit and does not copy', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' })
    const writeText = vi.fn()
    expect(
      await shareInviteLink('u', 'Sam', {
        share: vi.fn().mockRejectedValue(abort),
        clipboard: { writeText },
      }),
    ).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })
  it('copies when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await shareInviteLink('u', 'Sam', { clipboard: { writeText } })).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('u')
  })
  it('copies when the share sheet fails for another reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(
      await shareInviteLink('u', 'Sam', {
        share: vi.fn().mockRejectedValue(new Error('boom')),
        clipboard: { writeText },
      }),
    ).toBe('copied')
  })
})
