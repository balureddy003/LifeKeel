import { describe, it, expect } from 'vitest'
import {
  SERVICES,
  setupStepsFor,
  tilesFor,
  atHandFor,
  type ServiceDef,
  type ServiceCtx,
} from '../services'

const empty: ServiceCtx = { profile: null, documentCount: 0 }

// A second service, written only as one entry: no edit to any other file.
const schoolFees: ServiceDef = {
  id: 'school_fees',
  setup: {
    id: 'school_fees',
    label: 'Add school fees',
    description: 'Who is paid, how much, and when it is due',
    href: '/domains?d=school_fees',
    icon: 'shield',
    done: () => false,
  },
  tile: () => ({
    id: 'school_fees',
    title: 'School fees',
    value: null,
    detail: '',
    emptyHint: 'Add the first fee',
    href: '/domains?d=school_fees',
  }),
  emergency: (eventType) =>
    eventType === 'job_loss'
      ? {
          heading: 'School fees due',
          items: [{ key: 'f1', kicker: 'Autumn term', title: 'Example School', facts: [] }],
          empty: { text: 'None on file.', href: '/domains?d=school_fees', label: 'Add a fee' },
        }
      : null,
}

describe('services registry', () => {
  it('derives setup cards, tiles and emergency sections from one list', () => {
    const all = [...SERVICES, schoolFees]
    expect(setupStepsFor(all, empty).map((s) => s.id)).toContain('school_fees')
    expect(tilesFor(all, empty).map((t) => t.id)).toContain('school_fees')
    expect(atHandFor(all, 'job_loss', empty).map((s) => s.heading)).toContain('School fees due')
  })

  it('a service that does not apply to the event adds nothing', () => {
    expect(atHandFor([schoolFees], 'bereavement', empty)).toEqual([])
  })

  it('marks setup done from the household context', () => {
    const ctx: ServiceCtx = {
      profile: { policies: [{ id: 'p', type: 'life', provider: 'X' }] } as never,
      documentCount: 2,
    }
    const steps = setupStepsFor(SERVICES, ctx)
    expect(steps.find((s) => s.id === 'policy')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'upload')?.done).toBe(true)
    expect(setupStepsFor(SERVICES, empty).every((s) => !s.done)).toBe(true)
  })

  it('keeps ids unique so a new service cannot shadow another', () => {
    const ids = SERVICES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
