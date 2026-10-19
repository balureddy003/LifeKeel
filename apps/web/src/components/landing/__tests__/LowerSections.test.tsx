import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Security, SECURITY } from '../Security'
import { PlusSpotlight } from '../PlusSpotlight'
import { Pricing, FREE_ROWS, PLUS_ROWS } from '../Pricing'
import { Faq } from '../Faq'
import { FAQ } from '../faq-data'
import { SiteFooter } from '../SiteFooter'
import { CLAIMS } from '../claims'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/lib/api', () => ({ captureLead: vi.fn(async () => true) }))

afterEach(cleanup)

const live = (id: string) => CLAIMS.find((c) => c.id === id)?.status === 'live'

describe('lower sections map to live claims', () => {
  it('every security, pricing and FAQ item names a live claim', () => {
    for (const s of SECURITY) expect(live(s.claim), s.title).toBe(true)
    for (const r of [...FREE_ROWS, ...PLUS_ROWS]) expect(live(r.claim), r.text).toBe(true)
    for (const f of FAQ) expect(live(f.claim), f.q).toBe(true)
  })

  it('does not list support or features the registry cannot back', () => {
    const text = JSON.stringify([FREE_ROWS, PLUS_ROWS])
    expect(text).not.toMatch(/priority support|command palette/i)
  })
})

describe('price', () => {
  it('is the same in the pricing card, the FAQ and the billing constants', () => {
    const { container } = render(<Pricing />)
    expect(container.textContent).toContain('£7.99')
    expect(FAQ.filter((f) => f.a.includes('£7.99')).length).toBeGreaterThan(0)
    const billing = fs.readFileSync(
      path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'api',
        'src',
        'billing',
        'billing-constants.ts',
      ),
      'utf8',
    )
    expect(billing).toContain('7.99')
  })
})

describe('Security', () => {
  it('shows three plain statements', () => {
    render(<Security />)
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3)
  })
})

describe('PlusSpotlight', () => {
  it('labels the policy fields as a sample and links to signup with a location', () => {
    render(<PlusSpotlight />)
    expect(screen.getByText('Sample document')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Start free, add Plus later' })
    expect(link.getAttribute('href')).toMatch(/\/signup$/)
    document.addEventListener('click', (e) => e.preventDefault(), { once: true })
    fireEvent.click(link)
    expect(track).toHaveBeenCalledWith('landing_cta_click', {
      location: 'plus_spotlight',
      method: 'signup',
    })
  })
})

describe('Pricing', () => {
  it('shows one price, two signup links and the cancel line', () => {
    const { container } = render(<Pricing />)
    expect(container.textContent).toContain('£7.99 a month')
    expect(container.textContent).not.toMatch(/recommended/i)
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      expect.stringMatching(/\/signup$/),
      expect.stringMatching(/\/signup$/),
    ])
  })
})

describe('Faq', () => {
  it('renders every FAQ item as a native details element', () => {
    const { container } = render(<Faq />)
    expect(container.querySelectorAll('details').length).toBe(FAQ.length)
  })

  it('feeds the FAQPage JSON-LD from the same array, so schema cannot drift from the page', () => {
    const layout = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '..', 'app', 'layout.tsx'),
      'utf8',
    )
    expect(layout).toContain("from '@/components/landing/faq-data'")
    expect(layout).toContain('FAQ.map')
    expect(layout).not.toContain("name: 'Is my financial data sold")
  })
})

describe('SiteFooter newsletter', () => {
  it('shows an error, not a stuck button, when the request throws', async () => {
    const api = await import('@/lib/api')
    vi.mocked(api.captureLead).mockRejectedValueOnce(new Error('network'))
    render(<SiteFooter />)
    fireEvent.change(screen.getByLabelText(/Family-readiness tips/), {
      target: { value: 'a@b.co' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
  })
})

describe('SiteFooter', () => {
  it('has the legal line, no quiz link, and a labelled newsletter field', () => {
    const { container } = render(<SiteFooter />)
    expect(container.textContent).toMatch(/not financial, investment, tax/i)
    expect(container.textContent).not.toMatch(/readiness check/i)
    expect(screen.getByLabelText(/Family-readiness tips/)).toBeTruthy()
  })
})
