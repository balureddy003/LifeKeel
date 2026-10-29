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
