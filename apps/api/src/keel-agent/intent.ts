/**
 * Deterministic intent classifier (design D4). Plain patterns, no model:
 * the same question always takes the same path. Anything that doesn't match
 * a setup, preset or help intent is `open` and goes to the governed
 * /assistant/ask pipeline (verified answers, quarantine, gateway).
 *
 * Patterns are anchored on the first sentence so a question that merely
 * contains a phrase ("What is next month's premium?") is not captured.
 */
import { findHelp } from './help.js'

export type KeelIntent = 'setup_next' | 'preset' | 'how_to' | 'open'

const LEAD = '(?:(?:so|ok|okay|hi|hey|please|thanks|thank you),? )*'

const SETUP = [
  new RegExp(`^${LEAD}(?:where|how) (?:do|should|can|could) (?:i|we) (?:start|begin|get started)$`),
  new RegExp(`^${LEAD}what(?:'s| is) (?:next|my next step|the next step)(?: for (?:me|us))?$`),
  new RegExp(`^${LEAD}what (?:do|should) (?:i|we) do next$`),
  new RegExp(
    `^${LEAD}(?:help me )?(?:finish|complete|continue|resume)(?: (?:my|our|the))? set ?up$`,
  ),
  new RegExp(
    `^${LEAD}(?:show|check)(?: me)?(?: (?:my|our|the))? set ?up (?:progress|status|checklist)$`,
  ),
  /^set ?up (?:progress|status|checklist)$/,
  new RegExp(`^${LEAD}(?:help me|let's) (?:set up|start|get started)(?: \\w+){0,3}$`),
  /^(?:getting started|get started)$/,
  new RegExp(`^${LEAD}what (?:have|did) (?:i|we) (?:done|finished|completed)(?: so far)?$`),
]

const HOW_TO = [
  /^how (?:do|can|should|to)\b/,
  /^what does (?:this|the|that) .+ (?:do|mean)$/,
  /^(?:explain|describe) (?:this|the) (?:page|screen|feature)/,
  /^what can (?:keel|you) do/,
  /^where (?:is|do i find|can i find)\b/,
]

/** Money and decision questions belong to the governed assistant, not product help. */
const FINANCIAL =
  /\b(improve|increase|reduce|lower|afford|save|invest|pay off|compare|cheaper|retire|how much|how many)\b/

function firstSentence(query: string): string {
  return (
    query
      .trim()
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .split(/[.?!\n]/)[0] ?? ''
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function isPreset(query: string): boolean {
  const q = query.toLowerCase()
  if (!/\bsettings?\b/.test(q)) return false
  return (
    /\b(recommended?|default|suggested?|starting|best)\b/.test(q) ||
    /\bfamily of\b/.test(q) ||
    /\bfor (?:my|our|a) (?:family|household)\b/.test(q)
  )
}

export function classifyIntent(query: string, route?: string): KeelIntent {
  const first = firstSentence(query)
  if (first.length > 0 && first.length <= 90 && SETUP.some((p) => p.test(first)))
    return 'setup_next'
  if (isPreset(query)) return 'preset'
  if (HOW_TO.some((p) => p.test(first)) && !FINANCIAL.test(first) && findHelp(query, route))
    return 'how_to'
  return 'open'
}
