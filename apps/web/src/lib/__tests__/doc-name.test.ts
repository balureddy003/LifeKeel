import { describe, it, expect } from 'vitest'
import { displayDocName } from '../doc-name'

describe('displayDocName', () => {
  it('passes real filenames through untouched', () => {
    expect(displayDocName({ filename: 'aviva-life-policy.pdf' })).toBe('aviva-life-policy.pdf')
    expect(displayDocName({ filename: 'IMG_2041.jpeg' })).toBe('IMG_2041.jpeg')
  })

  it('replaces extension-only names with a descriptive label', () => {
    expect(displayDocName({ filename: '-JPEG' })).toBe('Scanned image')
    expect(displayDocName({ filename: '.png' })).toBe('Scanned image')
    expect(displayDocName({ filename: '-pdf' })).toBe('Scanned document')
    expect(displayDocName({ filename: 'PDF' })).toBe('Scanned document')
  })

  it('replaces punctuation-only stems', () => {
    expect(displayDocName({ filename: '-.jpeg' })).toBe('Scanned image')
    expect(displayDocName({ filename: '—.pdf' })).toBe('Scanned document')
  })

  it('appends the upload date when known', () => {
    const name = displayDocName({ filename: '-JPEG', uploadedAt: '2026-10-02T09:00:00Z' })
    expect(name).toMatch(/^Scanned image · /)
    expect(name).toContain('Oct')
  })

  it('falls back to a bare label when the date is missing or invalid', () => {
    expect(displayDocName({ filename: '.jpeg' })).toBe('Scanned image')
    expect(displayDocName({ filename: '.jpeg', uploadedAt: 'not-a-date' })).toBe('Scanned image')
  })
})
