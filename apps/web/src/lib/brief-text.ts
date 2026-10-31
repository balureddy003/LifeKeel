/**
 * The API appends a fixed "what this does not cover" note to every money
 * brief's sentence. Show it as a small caption under the answer so the answer
 * itself stays readable, without dropping the note.
 */
const NOTE_START = ' Figures are the household’s own entries'

export function splitBriefSentence(sentence: string): { main: string; note: string } {
  const at = sentence.indexOf(NOTE_START)
  if (at < 0) return { main: sentence, note: '' }
  return { main: sentence.slice(0, at), note: sentence.slice(at + 1) }
}

/** "October 2027" from "…savings would run out around October 2027 (about month 12.0…". */
export function runsOutAround(sentence: string): string | undefined {
  return sentence.match(/run out around ([A-Za-z]+ \d{4})/)?.[1]
}

/**
 * One line that carries the answer, with the full wording kept for people who
 * want it. Derived from the fixed sentence the API builds, so it adds no
 * figures of its own; anything it does not recognise falls back to the first
 * sentence.
 */
export function briefHeadline(main: string): string {
  const runsOut = main.match(/savings would run out around ([A-Za-z]+ \d{4})/)
  if (runsOut) return `Savings would run out around ${runsOut[1]}.`
  if (/savings last more than 50 years/.test(main)) return 'Savings would last more than 50 years.'
  if (/there are no savings to draw on/.test(main)) return 'There are no savings to draw on.'
  const clauses = main.split('. ').map((c) => c.replace(/\.$/, ''))
  const covered = clauses.filter((c) => /income covers the entered spending$/.test(c))
  if (covered.length >= 3) return 'Income covers the entered spending.'
  return `${clauses[0] ?? main}.`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Every ISO date in a string as "15 Jan 2027", the way the rest of the app
 * writes dates. Display only: the stored facts, and the version the household
 * confirmed, keep the original text. Anything that is not a real date is left
 * alone.
 */
export function plainDates(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (whole, y: string, m: string, d: string) => {
    const month = MONTHS[Number(m) - 1]
    const day = Number(d)
    if (!month || day < 1 || day > 31) return whole
    return `${day} ${month} ${y}`
  })
}
