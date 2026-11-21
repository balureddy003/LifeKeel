import { describe, it, expect } from 'vitest'
import { seenStatus, type SeenInput } from '../seen-status'

const sam = { id: 'm2', name: 'Sam' }
const priya = { id: 'm1', name: 'Priya' }

function input(over: Partial<SeenInput['confirmation']> = {}, records = 2): SeenInput {
  return {
    id: 'life_protection',
    title: 'Life cover',
    records,
    result_version: 'v1',
    confirmation: {
      required: [priya, sam],
      confirmed: [],
      both_confirmed: false,
      viewer_confirmed: false,
      ...over,
    },
  }
}

describe('seenStatus', () => {
  it('leaves out lists with nothing on file', () => {
    expect(seenStatus([input({}, 0)])).toEqual([])
  })

  it('asks the viewer first when they have not confirmed', () => {
    const [row] = seenStatus([input()])
    expect(row!.state).toBe('you')
    expect(row!.line).toBe('Not confirmed yet. Waiting for Priya and Sam.')
    expect(row!.canConfirm).toBe(true)
  })

  it('says who has looked and when, and who is still to come', () => {
    const [row] = seenStatus([
      input({
        confirmed: [{ ...priya, confirmed_at: '2026-12-03T10:00:00Z' }],
        viewer_confirmed: true,
      }),
    ])
    expect(row!.state).toBe('waiting')
    expect(row!.line).toBe('Priya confirmed on 3 Dec. Waiting for Sam.')
    expect(row!.canConfirm).toBe(false)
  })

  it('shows both dates when everyone has seen it', () => {
    const [row] = seenStatus([
      input({
        confirmed: [
          { ...priya, confirmed_at: '2026-12-03T10:00:00Z' },
          { ...sam, confirmed_at: '2026-12-04T09:00:00Z' },
        ],
        both_confirmed: true,
        viewer_confirmed: true,
      }),
    ])
    expect(row!.state).toBe('all')
    expect(row!.line).toBe('Priya confirmed on 3 Dec. Sam confirmed on 4 Dec.')
  })

  it('handles a single adult with nobody to wait for', () => {
    const [row] = seenStatus([
      input({
        required: [priya],
        confirmed: [{ ...priya, confirmed_at: '2026-12-03T10:00:00Z' }],
        both_confirmed: true,
        viewer_confirmed: true,
      }),
    ])
    expect(row!.line).toBe('You confirmed on 3 Dec.')
  })

  it('never produces an empty line when nobody is required', () => {
    const [row] = seenStatus([input({ required: [] })])
    expect(row!.line.length).toBeGreaterThan(0)
  })
})
