import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/components/EmergencyRow', () => ({ EmergencyRow: () => null }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

import EventsPage from '../page'
import { LIFE_EVENTS } from '@/lib/life-data'

afterEach(cleanup)

const links = () =>
  screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/events/'))

describe('What If screen', () => {
  it('leads with four situations and keeps the rest one tap away', () => {
    render(<EventsPage />)
    expect(links()).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: /show every situation/i }))
    expect(links()).toHaveLength(LIFE_EVENTS.length)
    fireEvent.click(screen.getByRole('button', { name: /show fewer/i }))
    expect(links()).toHaveLength(4)
  })

  it('describes what is on the list for each situation, never a grade or a promise', () => {
    for (const e of LIFE_EVENTS) {
      expect(e.description).not.toMatch(/\?|exactly|ready|explained simply|know your coverage/i)
    }
  })
})
