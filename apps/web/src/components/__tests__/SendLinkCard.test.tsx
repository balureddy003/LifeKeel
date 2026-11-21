import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SendLinkCard } from '../SendLinkCard'

describe('SendLinkCard', () => {
  it('offers one obvious action naming the person and fires it with their id', () => {
    const onShare = vi.fn()
    render(
      <SendLinkCard
        name="Sam Lee"
        member={{ id: 'm2' }}
        busy={false}
        onShare={onShare}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Send Sam the link/ }))
    expect(onShare).toHaveBeenCalledWith('m2')
  })
  it('waits until the real member exists, and while busy', () => {
    const { rerender } = render(
      <SendLinkCard
        name="Sam"
        member={undefined}
        busy={false}
        onShare={() => {}}
        onClose={() => {}}
      />,
    )
    expect(
      (screen.getByRole('button', { name: /Send Sam the link/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
    rerender(
      <SendLinkCard name="Sam" member={{ id: 'm2' }} busy onShare={() => {}} onClose={() => {}} />,
    )
    expect(
      (screen.getByRole('button', { name: /Making the link/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
  it('can be put off', () => {
    const onClose = vi.fn()
    render(
      <SendLinkCard
        name="Sam"
        member={{ id: 'm2' }}
        busy={false}
        onShare={() => {}}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(onClose).toHaveBeenCalled()
  })
})
