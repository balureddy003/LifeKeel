import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SampleDay } from '../SampleDay'
import { StoryBoard } from '../StoryBoard'
import { CAPABILITIES } from '../capabilities'

afterEach(cleanup)

describe('SampleDay', () => {
  it('is a read-only radio group with the four sample days and no other input', () => {
    const { container } = render(<SampleDay />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)
    expect(container.querySelectorAll('input').length).toBe(4)
    expect(screen.getByRole('radio', { name: 'One income drops' })).toHaveProperty('checked', true)
    expect(container.querySelector('[aria-live]')).toBeNull()
  })

  it('shows the maths and announces one sentence through role=status when a day is picked', () => {
    render(<SampleDay />)
    expect(screen.getByText(/Runway = £8,200/)).toBeTruthy()
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')
    fireEvent.click(screen.getByRole('radio', { name: 'Income stops' }))
    expect(status.textContent).toContain('income stops')
    expect(status.textContent).toContain('2.8')
    expect(status.textContent).toContain('Under 3 months')
    expect(screen.getByText('If income stops')).toBeTruthy()
  })

  it('draws the earner scenario as 24+ rather than an unbounded number, and shows its hard-day note', () => {
    render(<SampleDay />)
    fireEvent.click(screen.getByRole('radio', { name: 'Losing a main earner' }))
    expect(screen.getByText('24+')).toBeTruthy()
    expect(screen.getByText(/hard one to look at/)).toBeTruthy()
  })
})

describe('StoryBoard', () => {
  it('renders every capability with a text Live or Planned tag, and a qualifier on each Live item', () => {
    const { container } = render(<StoryBoard />)
    const items = container.querySelectorAll('li')
    expect(items.length).toBe(CAPABILITIES.length)
    for (const c of CAPABILITIES) {
      const li = [...items].find((el) => el.textContent?.includes(c.text))!
      expect(li, c.text).toBeTruthy()
      expect(li.querySelector('.lk-st')!.textContent).toBe(c.live ? 'Live' : 'Planned')
      expect(!!li.querySelector('.lk-q'), c.text).toBe(c.live)
    }
  })

  it('uses the word platform once and never in a heading', () => {
    const { container } = render(<StoryBoard />)
    expect((container.textContent!.match(/platform/gi) ?? []).length).toBe(1)
    expect(
      [...container.querySelectorAll('h2,h3')].some((h) => /platform/i.test(h.textContent!)),
    ).toBe(false)
  })
})
