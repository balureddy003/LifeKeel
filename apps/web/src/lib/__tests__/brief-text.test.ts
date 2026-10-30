import { describe, expect, it } from 'vitest'
import { briefHeadline, runsOutAround, splitBriefSentence } from '../brief-text'

const NOTE =
  ' Figures are the household’s own entries — tax, benefits, investment returns and price rises are not covered. Free guidance: MoneyHelper; for bigger decisions, a licensed professional.'

describe('splitBriefSentence', () => {
  it('moves the fixed note out of the answer', () => {
    const s = `Before the change, income covers the entered spending.${NOTE}`
    expect(splitBriefSentence(s)).toEqual({
      main: 'Before the change, income covers the entered spending.',
      note: NOTE.trim(),
    })
  })
  it('leaves handover text alone', () => {
    const s = 'These are the household’s recorded facts.'
    expect(splitBriefSentence(s)).toEqual({ main: s, note: '' })
  })
})

describe('briefHeadline', () => {
  it('leads with when savings run out', () => {
    const main =
      'Before the change, income covers the entered spending. At the first change, savings last about 11.1 months. After the last entered change, savings last about 11.1 months. On these figures savings would run out around October 2027 (about month 12.1 from the calculation date).'
    expect(briefHeadline(main)).toBe('Savings would run out around October 2027.')
    expect(runsOutAround(main)).toBe('October 2027')
  })
  it('says income covers spending when it does throughout', () => {
    const main =
      'Before the change, income covers the entered spending. At the first change, income covers the entered spending. After the last entered change, income covers the entered spending.'
    expect(briefHeadline(main)).toBe('Income covers the entered spending.')
  })
  it('handles the very long and the empty cases', () => {
    expect(
      briefHeadline(
        'Before the change, income covers the entered spending. At the first change, savings last more than 50 years. After the last entered change, savings last more than 50 years.',
      ),
    ).toBe('Savings would last more than 50 years.')
    expect(
      briefHeadline(
        'Before the change, there are no savings to draw on. At the first change, there are no savings to draw on. After the last entered change, there are no savings to draw on.',
      ),
    ).toBe('There are no savings to draw on.')
  })
  it('falls back to the first sentence for anything else', () => {
    expect(
      briefHeadline('These are the household’s recorded facts. Missing details are marked.'),
    ).toBe('These are the household’s recorded facts.')
  })
})
