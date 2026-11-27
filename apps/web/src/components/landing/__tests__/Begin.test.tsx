import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import { BEGIN_BODY, BEGIN_CLOSING } from '../Begin'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
afterEach(cleanup)

describe('the closing breath', () => {
  it('ends on one word, the promise folded into a sentence, then the honest line', () => {
    const { container } = render(<HomeExperience />)
    expect(screen.getByRole('heading', { name: 'Begin.' })).toBeTruthy()
    const body = container.querySelector('.lk-begin-body')!
    expect(body.textContent).toBe(BEGIN_BODY)
    const closing = container.querySelector('.lk-begin-closing')!
    expect(closing.textContent).toBe(BEGIN_CLOSING)
    const h = screen.getByRole('heading', { name: 'Begin.' })
    expect(h.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(body.compareDocumentPosition(closing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('offers one invitation and no form while the business door is shut', () => {
    const { container } = render(<HomeExperience />)
    const section = container.querySelector('.lk-begin')!
    expect(section.querySelectorAll('input, textarea, select')).toHaveLength(0)
    const links = [...section.querySelectorAll('a')]
    expect(links).toHaveLength(1)
    expect(links[0]!.textContent?.trim()).toBe('Start your free list')
    expect(links[0]!.getAttribute('href')).toMatch(/\/signup$/)
  })

  it('once the business door is open, adds a quiet second door to the business vertical', () => {
    vi.stubEnv('NEXT_PUBLIC_BUSINESS_DOOR', 'on')
    const { container } = render(<HomeExperience />)
    const links = [...container.querySelector('.lk-begin')!.querySelectorAll('a')]
    expect(links).toHaveLength(2)
    expect(links[1]!.textContent?.trim()).toBe('Running a small business? LifeKeel for business →')
    expect(links[1]!.getAttribute('href')).toBe('https://business.lifekeel.com')
    vi.unstubAllEnvs()
  })

  it('reports the primary as the final CTA', () => {
    render(<HomeExperience />)
    const link = screen.getByRole('link', { name: 'Start your free list' })
    document.addEventListener('click', (e) => e.preventDefault(), { once: true })
    fireEvent.click(link)
    expect(track).toHaveBeenCalledWith('landing_cta_click', { location: 'final', method: 'signup' })
  })

  it('keeps the anchor StickyCta watches, once', () => {
    const { container } = render(<HomeExperience />)
    expect(container.querySelectorAll('#signup-final')).toHaveLength(1)
    expect(container.querySelector('#signup-final')!.classList.contains('lk-begin')).toBe(true)
  })

  it('is the last thing on the page, after the questions', () => {
    render(<HomeExperience />)
    const h = (name: string) => screen.getByRole('heading', { name })
    const faq = h('Straight answers.')
    const begin = h('Begin.')
    expect(faq.compareDocumentPosition(begin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
