import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CoverOnFile } from '../CoverOnFile'
import { CrisisSteps } from '../CrisisSteps'
import { Promises, PROMISES } from '../Promises'
import { DawnClose } from '../DawnClose'
import { CLAIMS } from '../claims'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

afterEach(cleanup)

describe('CoverOnFile', () => {
  it('labels the table as a made-up household and names no insurer', () => {
    const { container } = render(<CoverOnFile />)
    expect(screen.getAllByText(/Sample household|Made-up figures/).length).toBeGreaterThan(1)
    expect(container.querySelectorAll('tbody tr').length).toBe(5)
    expect(container.querySelectorAll('th[scope="col"]').length).toBe(3)
    expect(screen.getByText('Planned check')).toBeTruthy()
  })
})

describe('CrisisSteps', () => {
  it('shows four sample steps labelled as sample, and states who can open the papers', () => {
    const { container } = render(<CrisisSteps />)
    expect(container.querySelectorAll('.lk-pb li').length).toBe(4)
    expect(screen.getByText(/Sample steps for a made-up household/)).toBeTruthy()
    expect(screen.getByText(/adults who have joined your family/)).toBeTruthy()
  })
})

describe('Promises', () => {
  it('lists six promises and each names a live claim in the registry', () => {
    render(<Promises />)
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6)
    for (const p of PROMISES) {
      const claim = CLAIMS.find((c) => c.id === p.claim)
      expect(claim?.status, p.title).toBe('live')
    }
  })

  it('does not promise that nothing is ever sent for the visitor', () => {
    const { container } = render(<Promises />)
    expect(container.textContent).not.toMatch(/never sends/i)
    expect(container.textContent).toMatch(/switch them on/)
  })
})

describe('DawnClose', () => {
  it('has one signup link, no fields, and reports the click as the final CTA', () => {
    const { container } = render(<DawnClose />)
    expect(container.querySelector('input')).toBeNull()
    const link = screen.getByRole('link', { name: 'Create your free account' })
    expect(link.getAttribute('href')).toMatch(/\/signup$/)
    document.addEventListener('click', (e) => e.preventDefault(), { once: true })
    fireEvent.click(link)
    expect(track).toHaveBeenCalledWith('landing_cta_click', { location: 'final', method: 'signup' })
  })
})
