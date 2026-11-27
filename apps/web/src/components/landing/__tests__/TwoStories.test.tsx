/**
 * Two doors, two stories (owner, 27 Nov 2026). Families and small businesses are separate verticals
 * (family.lifekeel.com, business.lifekeel.com). The business door is built but stays shut until that
 * vertical is live, so today the section tells the family story alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import {
  BUSINESS_ROWS,
  FAMILY_CAPTION,
  HOUSEHOLD_CLAIMS,
  HOUSEHOLD_ROWS,
  TWO_CLOSING,
  TwoStories,
} from '../TwoStories'
import { CLAIMS } from '../claims'
import { BUSINESS_SITE_URL, SHUT_DOOR_WORDS } from '../verticals'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const panel = (kind: 'gap' | 'business') =>
  document.querySelector(`.lk-fork-panel[data-kind='${kind}']`)

describe('the family story', () => {
  it('rests only on live claims', () => {
    expect(HOUSEHOLD_CLAIMS.length).toBeGreaterThan(0)
    for (const id of HOUSEHOLD_CLAIMS) {
      expect(CLAIMS.find((c) => c.id === id)?.status, id).toBe('live')
    }
  })

  it('is told as gaps in the record, not documents in one place, and never as advice', () => {
    render(<TwoStories />)
    const gap = panel('gap')!
    const text = gap.textContent ?? ''
    for (const r of HOUSEHOLD_ROWS) {
      expect(text).toContain(r.fact)
      expect(text).toContain(r.state)
    }
    expect(gap.getAttribute('data-claims')).toBe(HOUSEHOLD_CLAIMS.join(' '))
    expect(text).toMatch(/missing/i)
    expect(text).toMatch(/not a recommendation/i)
    expect(text).toMatch(/information only/i)
    expect(text).not.toMatch(/documents? in one place|filing cabinet|all your paperwork/i)
    expect(text).not.toMatch(/\b(you should|we recommend|consider|buy|switch)\b/i)
  })

  it('says only what the nomination check covers: a former partner, not anyone who left', () => {
    expect(HOUSEHOLD_ROWS[0]!.state).toBe('still names a former partner')
  })
})

describe('while the business door is shut (today)', () => {
  it('shows the family panel alone, with nothing to click', () => {
    const { container } = render(<TwoStories />)
    expect(panel('gap')).not.toBeNull()
    expect(panel('business')).toBeNull()
    expect(screen.getByRole('heading', { name: 'What the list is for.', level: 2 })).toBeTruthy()
    expect(screen.getByText(FAMILY_CAPTION)).toBeTruthy()
    expect(container.querySelector('.lk-fork')!.querySelectorAll('a, button')).toHaveLength(0)
  })

  it('leaves no business, team or co-founder story anywhere on the home page', () => {
    const { container } = render(<HomeExperience />)
    const text = container.querySelector('main')!.textContent ?? ''
    expect(text).not.toMatch(SHUT_DOOR_WORDS)
    expect(container.innerHTML).not.toContain(BUSINESS_SITE_URL)
  })

  it('sits between the list and the difficult day', () => {
    render(<HomeExperience />)
    const h = (name: string) => screen.getByRole('heading', { name })
    const list = h('The list is the quiet hero.')
    const fork = h('What the list is for.')
    const day = h('A difficult ordinary day.')
    expect(list.compareDocumentPosition(fork) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(fork.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('once the business door is open', () => {
  it('adds a separate small business story whose only link is business.lifekeel.com', () => {
    vi.stubEnv('NEXT_PUBLIC_BUSINESS_DOOR', 'on')
    const { container } = render(<TwoStories />)
    expect(screen.getByRole('heading', { name: 'Two stories, two lists.', level: 2 })).toBeTruthy()
    const biz = panel('business')!
    const text = biz.textContent ?? ''
    for (const r of BUSINESS_ROWS) {
      expect(text).toContain(r.fact)
      expect(text).toContain(r.state)
    }
    // A small business owner, never a team: no co-founders, staff or payroll.
    expect(text).toMatch(/owner/i)
    expect(text).not.toMatch(/\b(team|co-?founder|founder|payroll|staff)\b/i)
    // It names the problem only; features come with live business claims.
    expect(biz.getAttribute('data-claims')).toBeNull()
    expect(text).not.toMatch(/£|\d+%|guarantee/i)
    const links = [...container.querySelectorAll('.lk-fork a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual([BUSINESS_SITE_URL])
    expect(container.querySelector('.lk-fork-closing')!.textContent).toBe(TWO_CLOSING)
  })
})
