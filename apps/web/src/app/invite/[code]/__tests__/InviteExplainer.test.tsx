/**
 * The page a second adult lands on explains, in plain words, what LifeKeel is and what they are
 * asked to do, and repeats the promises. It shows nothing from the list and no family name: the
 * link can reach the wrong person (see invite-copy.test.ts).
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { InviteExplainer } from '../InviteExplainer'

afterEach(cleanup)

describe('InviteExplainer', () => {
  it('says what it is, what the adult is asked to do, and the three promises', () => {
    render(<InviteExplainer />)
    expect(screen.getByText(/shared list/i)).toBeTruthy()
    expect(screen.getByText(/asked to look and confirm you have seen it/i)).toBeTruthy()
    expect(screen.getByText(/can be excused/i)).toBeTruthy()
    for (const promise of ['No commissions', 'Never moves money', 'Your details are not sold'])
      expect(screen.getByText(promise)).toBeTruthy()
  })

  it('shows no list content, no family name, no pressure and no advice wording', () => {
    const { container } = render(<InviteExplainer />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\bThe [A-Z]\w+ family\b/)
    expect(text).not.toMatch(/\bplan\b|you should|must|or else|hurry|urgent|cover(ed)?\b/i)
  })

  it('is used by both invite flows, and the join-by-code heading says list, not plan', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'InviteJoinClient.tsx'), 'utf8')
    expect(src.match(/<InviteExplainer \/>/g)?.length).toBe(2)
    expect(src).not.toMatch(/family's plan/)
  })
})
